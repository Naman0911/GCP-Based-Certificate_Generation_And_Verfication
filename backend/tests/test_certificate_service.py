"""Issuing certificates, failure compensation, uniqueness, listing and pagination."""

import hashlib

import pytest
from google.api_core import exceptions as gexc

from shared.certificate_service import generate_certificate_id
from shared.crypto_service import build_canonical_metadata, canonical_json_bytes, sha256_hex
from shared.exceptions import CloudServiceError, ConflictError, CryptoError, NotFoundError, ValidationFailedError
from shared.models import CertificateStatus, utc_now
from shared.validators import CERTIFICATE_ID_RE
from tests.conftest import valid_request


def stored(firestore_client, cid):
    return firestore_client.data["certificates"][cid]


def test_create_stores_pdf_record_and_returns_safe_result(service, admin, storage, firestore_client, crypto):
    result = service.create_certificate(valid_request(), admin)
    cid = result["certificate_id"]
    assert CERTIFICATE_ID_RE.match(cid)
    assert result["verification_url"] == f"https://certs.example.com/verify/{cid}"
    assert result["download"]["url"].startswith("https://storage.example/signed/")
    assert result["download_path"] == f"/admin/certificates/{cid}/download"

    pdf, _generation = storage.objects[f"certificates/{cid}.pdf"]
    record = stored(firestore_client, cid)
    # Digest is over the exact stored PDF bytes, signature verifies, bytes never land in Firestore.
    assert record["pdf_sha256"] == hashlib.sha256(pdf).hexdigest()
    assert crypto.verify_signature(record["pdf_sha256"], record["pdf_signature"], record["kms_key_version"])
    assert not any(isinstance(v, (bytes, bytearray)) for v in record.values())
    # Metadata digest/signature match the documented canonical form.
    metadata = build_canonical_metadata(
        certificate_id=cid, recipient_name="Asha Verma", recipient_email="asha@example.com",
        course_name="Cloud Architecture Fundamentals", organization_name="Example Academy",
        issue_date=record["issue_date"], expiry_date=None)
    assert record["metadata_sha256"] == sha256_hex(canonical_json_bytes(metadata))
    assert crypto.verify_signature(record["metadata_sha256"], record["metadata_signature"], record["kms_key_version"])
    assert record["status"] == "VALID" and record["created_by"] == admin.uid
    assert record["storage_object"] == f"certificates/{cid}.pdf" and record["storage_bucket"] == "test-bucket"
    assert record["signature_algorithm"] and record["kms_key_version"]


def test_create_writes_audit_event_atomically_without_personal_data(service, admin, firestore_client):
    cid = service.create_certificate(valid_request(), admin)["certificate_id"]
    events = list(firestore_client.data["audit_events"].values())
    assert len(events) == 1
    event = events[0]
    assert event["event_type"] == "CERTIFICATE_CREATED" and event["certificate_id"] == cid
    assert event["actor_uid"] == admin.uid
    assert "asha" not in str(event).lower() and "Verma" not in str(event)


def test_create_with_expiry_and_without_email(service, admin, firestore_client):
    from datetime import timedelta
    expiry = utc_now() + timedelta(days=30)
    cid = service.create_certificate(valid_request(recipient_email=None, expiry_date=expiry), admin)["certificate_id"]
    record = stored(firestore_client, cid)
    assert record["recipient_email"] is None and record["expiry_date"] == expiry


def test_certificate_ids_are_unique_and_well_formed(service, admin):
    ids = {service.create_certificate(valid_request(), admin)["certificate_id"] for _ in range(15)}
    assert len(ids) == 15
    many = {generate_certificate_id(utc_now()) for _ in range(5000)}
    assert len(many) == 5000 and all(CERTIFICATE_ID_RE.match(i) for i in many)


def test_two_certificates_for_same_person_have_different_pdfs(service, admin, storage):
    a = service.create_certificate(valid_request(), admin)["certificate_id"]
    b = service.create_certificate(valid_request(), admin)["certificate_id"]
    assert storage.objects[f"certificates/{a}.pdf"][0] != storage.objects[f"certificates/{b}.pdf"][0]


def test_storage_failure_leaves_no_record(service, admin, storage, firestore_client):
    storage.failures["upload"] = CloudServiceError("boom")
    with pytest.raises(CloudServiceError):
        service.create_certificate(valid_request(), admin)
    assert not firestore_client.data.get("certificates")
    assert not firestore_client.data.get("audit_events")


def test_firestore_failure_deletes_uploaded_pdf(service, admin, storage, firestore_client):
    firestore_client.failures["batch_commit"] = gexc.ServiceUnavailable("down")
    with pytest.raises(CloudServiceError):
        service.create_certificate(valid_request(), admin)
    assert storage.objects == {} and len(storage.deleted) == 1  # no orphan, no valid record
    assert not firestore_client.data.get("certificates")


def test_failed_compensation_still_raises_original_error_and_logs(service, admin, storage, firestore_client, caplog):
    firestore_client.failures["batch_commit"] = gexc.ServiceUnavailable("down")
    storage.failures["delete"] = CloudServiceError("cannot delete")
    with caplog.at_level("CRITICAL"):
        with pytest.raises(CloudServiceError):
            service.create_certificate(valid_request(), admin)
    assert any(r.getMessage() == "orphaned_storage_object" for r in caplog.records)
    assert not firestore_client.data.get("certificates")


def test_id_collision_never_overwrites_and_cleans_up(settings, repo, storage, crypto, audit, clock, admin, firestore_client):
    from shared.certificate_service import CertificateService
    from shared.pdf_service import PdfService
    fixed = "CERT-2026-AAAAAAAAAAAAAAAAAAAA"
    svc = CertificateService(settings, repo, storage, crypto, audit, pdf_service=PdfService(), clock=clock,
                             id_factory=lambda now: fixed)
    svc.create_certificate(valid_request(), admin)
    original = dict(firestore_client.data["certificates"][fixed])
    with pytest.raises(ConflictError):
        svc.create_certificate(valid_request(recipient_name="Someone Else"), admin)
    assert firestore_client.data["certificates"][fixed] == original
    assert list(storage.objects) == [f"certificates/{fixed}.pdf"]


def test_signing_failure_stores_nothing(service, admin, storage, firestore_client, monkeypatch):
    def fail(_digest):
        raise CryptoError("kms down")
    monkeypatch.setattr(service._crypto, "sign_hex_digest", fail)
    with pytest.raises(CryptoError):
        service.create_certificate(valid_request(), admin)
    assert storage.objects == {} and not firestore_client.data.get("certificates")


def test_signed_url_failure_does_not_undo_creation(service, admin, storage, firestore_client):
    storage.failures["signed_url"] = CloudServiceError("iam")
    result = service.create_certificate(valid_request(), admin)
    assert result["download"] is None and result["download_path"]
    assert result["certificate_id"] in firestore_client.data["certificates"]


def test_expired_expiry_is_rejected_by_service(service, admin, clock):
    from datetime import timedelta
    request = valid_request(expiry_date=utc_now() + timedelta(days=1))
    clock.advance(days=5)
    with pytest.raises(ValidationFailedError):
        service.create_certificate(request, admin)


# ---------------------------------------------------------------------- #
# Listing / pagination / details / download
# ---------------------------------------------------------------------- #
def make_many(service, admin, clock, count):
    ids = []
    for i in range(count):
        clock.advance(seconds=1)
        ids.append(service.create_certificate(valid_request(recipient_name=f"Person {i}"), admin)["certificate_id"])
    return ids


def test_pagination_walks_all_items_newest_first_without_duplicates(service, admin, clock):
    ids = make_many(service, admin, clock, 5)
    seen, token, pages = [], None, 0
    while True:
        page = service.list_certificates(page_size=2, page_token=token, status=None)
        seen += [i["certificate_id"] for i in page["items"]]
        pages += 1
        token = page["next_page_token"]
        if not token:
            break
    assert pages == 3 and seen == list(reversed(ids))


def test_pagination_exact_multiple_has_no_trailing_page(service, admin, clock):
    make_many(service, admin, clock, 4)
    first = service.list_certificates(page_size=2, page_token=None, status=None)
    second = service.list_certificates(page_size=2, page_token=first["next_page_token"], status=None)
    assert len(second["items"]) == 2 and second["next_page_token"] is None


def test_pagination_with_identical_timestamps_does_not_skip(service, admin):
    ids = [service.create_certificate(valid_request(), admin)["certificate_id"] for _ in range(5)]
    seen, token = [], None
    while True:
        page = service.list_certificates(page_size=2, page_token=token, status=None)
        seen += [i["certificate_id"] for i in page["items"]]
        token = page["next_page_token"]
        if not token:
            break
    assert sorted(seen) == sorted(ids) and len(set(seen)) == 5


def test_list_filters_by_status_and_rejects_bad_tokens(service, admin, clock):
    ids = make_many(service, admin, clock, 3)
    service.revoke_certificate(ids[1], "Issued in error", admin)
    revoked = service.list_certificates(page_size=10, page_token=None, status=CertificateStatus.REVOKED)
    assert [i["certificate_id"] for i in revoked["items"]] == [ids[1]]
    with pytest.raises(ValidationFailedError):
        service.list_certificates(page_size=10, page_token="garbage!!", status=None)
    from shared.firestore_repository import encode_page_token
    with pytest.raises(ValidationFailedError):  # well-formed but unknown cursor
        service.list_certificates(page_size=10, page_token=encode_page_token("CERT-2026-FFFFFFFFFFFFFFFFFFFF"), status=None)


def test_list_items_expose_admin_fields_but_no_signatures_or_storage(service, admin, clock):
    make_many(service, admin, clock, 1)
    item = service.list_certificates(page_size=5, page_token=None, status=None)["items"][0]
    assert item["recipient_email"] == "asha@example.com" and item["effective_status"] == "VALID"
    for hidden in ("pdf_signature", "metadata_signature", "storage_bucket", "storage_object"):
        assert hidden not in item


def test_get_certificate_details_and_not_found(service, admin, issued):
    cid = issued[0]["certificate_id"]
    detail = service.get_certificate(cid)
    assert detail["pdf_sha256"] and detail["kms_key_version"] and "pdf_signature" not in detail
    with pytest.raises(NotFoundError):
        service.get_certificate("CERT-2026-FFFFFFFFFFFFFFFFFFFF")
    with pytest.raises(ValidationFailedError):
        service.get_certificate("nope")


def test_get_materialises_expiry_but_never_overrides_revocation(service, admin, clock, firestore_client):
    from datetime import timedelta
    cid = service.create_certificate(valid_request(expiry_date=utc_now() + timedelta(days=1)), admin)["certificate_id"]
    clock.advance(days=3)
    assert service.get_certificate(cid)["status"] == "EXPIRED"
    assert stored(firestore_client, cid)["status"] == "EXPIRED"
    cid2 = service.create_certificate(valid_request(expiry_date=clock.now + timedelta(days=1)), admin)["certificate_id"]
    service.revoke_certificate(cid2, "Issued in error", admin)
    assert service.get_certificate(cid2)["status"] == "REVOKED"


def test_download_url_is_short_lived_and_audited(service, admin, issued, firestore_client):
    cid = issued[0]["certificate_id"]
    result = service.get_download_url(cid, admin)
    assert "X-Goog-Expires=600" in result["url"] and result["method"] == "GET"
    types = [e["event_type"] for e in firestore_client.data["audit_events"].values()]
    assert "DOWNLOAD_URL_ISSUED" in types
    with pytest.raises(NotFoundError):
        service.get_download_url("CERT-2026-FFFFFFFFFFFFFFFFFFFF", admin)
