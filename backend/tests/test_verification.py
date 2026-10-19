"""Record/metadata verification and PDF file verification."""

from datetime import timedelta

import pytest
from google.api_core import exceptions as gexc

from shared.exceptions import CloudServiceError, InvalidPdfError, PayloadTooLargeError, ValidationFailedError
from shared.models import utc_now
from tests.conftest import valid_request

MISSING = "CERT-2026-FFFFFFFFFFFFFFFFFFFF"
PUBLIC_KEYS = {"certificate_id", "recipient_name", "course_name", "organization_name", "issue_date",
               "expiry_date", "status", "revoked_at"}


def tamper(firestore_client, cid, **changes):
    firestore_client.data["certificates"][cid].update(changes)


def test_valid_record_id_only_never_claims_pdf_was_checked(service, issued):
    cid = issued[0]["certificate_id"]
    result = service.verify_certificate(cid)
    assert result["status"] == "VALID" and result["certificate_status"] == "VALID"
    assert result["record_found"] is True and result["metadata_signature_valid"] is True
    assert result["pdf_integrity_verified"] is None
    assert result["message"] == "Certificate record and metadata signature verified"


def test_public_view_contains_no_private_data(service, issued):
    result = service.verify_certificate(issued[0]["certificate_id"])
    assert set(result["certificate"]) == PUBLIC_KEYS
    blob = str(result["certificate"]).lower()
    for secret in ("asha@example.com", "signature", "storage", "created_by", "uid-admin", "kms", "sha256"):
        assert secret not in blob
    assert "asha@example.com" not in str(result).lower()


def test_missing_certificate_is_invalid(service):
    result = service.verify_certificate(MISSING)
    assert result["status"] == "INVALID" and result["record_found"] is False
    assert result["metadata_signature_valid"] is None and result["pdf_integrity_verified"] is None
    assert result["certificate"] is None


def test_malformed_id_is_rejected(service):
    with pytest.raises(ValidationFailedError):
        service.verify_certificate("../../etc/passwd")


def test_revoked_is_never_reported_valid(service, admin, issued):
    cid = issued[0]["certificate_id"]
    service.revoke_certificate(cid, "Issued in error", admin)
    result = service.verify_certificate(cid)
    assert result["status"] == "REVOKED" and result["certificate_status"] == "REVOKED"
    assert result["metadata_signature_valid"] is True  # integrity is separate from status
    assert result["certificate"]["status"] == "REVOKED" and "Issued in error" not in str(result)


def test_expired_certificate(service, admin, clock):
    cid = service.create_certificate(valid_request(expiry_date=utc_now() + timedelta(days=10)), admin)["certificate_id"]
    assert service.verify_certificate(cid)["status"] == "VALID"
    clock.advance(days=11)
    result = service.verify_certificate(cid)
    assert result["status"] == "EXPIRED" and result["metadata_signature_valid"] is True


def test_revocation_takes_precedence_over_expiry(service, admin, clock):
    cid = service.create_certificate(valid_request(expiry_date=utc_now() + timedelta(days=2)), admin)["certificate_id"]
    service.revoke_certificate(cid, "Issued in error", admin)
    clock.advance(days=5)
    assert service.verify_certificate(cid)["status"] == "REVOKED"


@pytest.mark.parametrize("field,value", [
    ("recipient_name", "Mallory"), ("course_name", "Other course"), ("organization_name", "Evil Corp"),
    ("recipient_email", "mallory@example.com"),
])
def test_modified_metadata_is_tampered(service, firestore_client, issued, field, value):
    cid = issued[0]["certificate_id"]
    tamper(firestore_client, cid, **{field: value})
    result = service.verify_certificate(cid)
    assert result["status"] == "TAMPERED" and result["metadata_signature_valid"] is False
    assert result["certificate"] is None  # untrusted data is never displayed


def test_modified_dates_are_tampered(service, firestore_client, issued):
    cid = issued[0]["certificate_id"]
    tamper(firestore_client, cid, expiry_date=utc_now() + timedelta(days=9999))
    assert service.verify_certificate(cid)["status"] == "TAMPERED"


def test_consistently_rewritten_metadata_with_stale_signature_is_tampered(service, firestore_client, issued):
    from shared.crypto_service import build_canonical_metadata, metadata_digest_hex
    cid = issued[0]["certificate_id"]
    record = firestore_client.data["certificates"][cid]
    new = build_canonical_metadata(
        certificate_id=cid, recipient_name="Mallory", recipient_email=record["recipient_email"],
        course_name=record["course_name"], organization_name=record["organization_name"],
        issue_date=record["issue_date"], expiry_date=None)
    tamper(firestore_client, cid, recipient_name="Mallory", metadata_sha256=metadata_digest_hex(new))
    result = service.verify_certificate(cid)  # digest matches but the signature does not
    assert result["status"] == "TAMPERED" and result["metadata_signature_valid"] is False


def test_swapped_signature_from_another_certificate_is_tampered(service, admin, firestore_client, issued):
    other = service.create_certificate(valid_request(recipient_name="Other"), admin)["certificate_id"]
    cid = issued[0]["certificate_id"]
    tamper(firestore_client, cid, metadata_signature=firestore_client.data["certificates"][other]["metadata_signature"])
    assert service.verify_certificate(cid)["status"] == "TAMPERED"


def test_record_moved_to_another_document_id_is_tampered(service, firestore_client, issued):
    cid = issued[0]["certificate_id"]
    other = "CERT-2026-BBBBBBBBBBBBBBBBBBBB"
    firestore_client.data["certificates"][other] = dict(firestore_client.data["certificates"][cid])
    assert service.verify_certificate(other)["status"] == "TAMPERED"


@pytest.mark.parametrize("field", ["metadata_signature", "kms_key_version", "signature_algorithm"])
def test_corrupted_crypto_fields_fail_closed(service, firestore_client, issued, field):
    cid = issued[0]["certificate_id"]
    tamper(firestore_client, cid, **{field: "garbage"})
    assert service.verify_certificate(cid)["status"] == "TAMPERED"


def test_malformed_record_is_reported_tampered_not_crash(service, firestore_client, issued):
    cid = issued[0]["certificate_id"]
    del firestore_client.data["certificates"][cid]["pdf_sha256"]
    result = service.verify_certificate(cid)
    assert result["status"] == "TAMPERED" and result["certificate"] is None


def test_infrastructure_errors_are_not_reported_as_tampering(service, firestore_client, issued):
    firestore_client.failures["get"] = gexc.ServiceUnavailable("down")
    with pytest.raises(CloudServiceError):
        service.verify_certificate(issued[0]["certificate_id"])


# ---------------------------------------------------------------------- #
# File verification
# ---------------------------------------------------------------------- #
def test_original_pdf_verifies(service, issued):
    result, pdf = issued
    out = service.verify_certificate_file(result["certificate_id"], pdf)
    assert out["status"] == "VALID" and out["pdf_integrity_verified"] is True
    assert out["metadata_signature_valid"] is True and out["certificate_status"] == "VALID"


@pytest.mark.parametrize("mutation", ["flip_byte", "append", "truncate_eof_kept", "replace_text"])
def test_modified_pdf_bytes_are_tampered(service, issued, mutation):
    result, pdf = issued
    data = bytearray(pdf)
    if mutation == "flip_byte":
        data[len(data) // 2] ^= 0x01
    elif mutation == "append":
        data += b"\n% added comment\n"
    elif mutation == "truncate_eof_kept":
        data = data[: len(data) // 2] + b"\n%%EOF\n"
    else:
        data = bytearray(bytes(data).replace(b"%PDF-1.4", b"%PDF-1.5", 1))
    out = service.verify_certificate_file(result["certificate_id"], bytes(data))
    assert out["status"] == "TAMPERED" and out["pdf_integrity_verified"] is False
    assert out["metadata_signature_valid"] is True  # the record itself is fine


def test_pdf_of_a_different_certificate_is_tampered(service, admin, storage, issued):
    other = service.create_certificate(valid_request(recipient_name="Other"), admin)["certificate_id"]
    other_pdf = storage.objects[f"certificates/{other}.pdf"][0]
    out = service.verify_certificate_file(issued[0]["certificate_id"], other_pdf)
    assert out["status"] == "TAMPERED" and out["pdf_integrity_verified"] is False


def test_unmodified_pdf_of_revoked_certificate_reports_revoked_with_integrity_true(service, admin, issued):
    result, pdf = issued
    service.revoke_certificate(result["certificate_id"], "Issued in error", admin)
    out = service.verify_certificate_file(result["certificate_id"], pdf)
    assert out["status"] == "REVOKED" and out["pdf_integrity_verified"] is True


def test_stored_pdf_signature_corruption_is_tampered(service, firestore_client, issued):
    result, pdf = issued
    firestore_client.data["certificates"][result["certificate_id"]]["pdf_signature"] = "AAAA"
    out = service.verify_certificate_file(result["certificate_id"], pdf)
    assert out["status"] == "TAMPERED" and out["pdf_integrity_verified"] is False


def test_file_verification_for_missing_certificate(service, issued):
    out = service.verify_certificate_file(MISSING, issued[1])
    assert out["status"] == "INVALID" and out["pdf_integrity_verified"] is None


def test_invalid_and_oversized_uploads_are_rejected(service, issued):
    cid = issued[0]["certificate_id"]
    with pytest.raises(InvalidPdfError):
        service.verify_certificate_file(cid, b"MZ" + b"\x00" * 200)
    with pytest.raises(InvalidPdfError):
        service.verify_certificate_file(cid, b"")
    with pytest.raises(PayloadTooLargeError):  # test settings allow 1 MB
        service.verify_certificate_file(cid, b"%PDF-1.4\n" + b"0" * (1024 * 1024) + b"\n%%EOF")
