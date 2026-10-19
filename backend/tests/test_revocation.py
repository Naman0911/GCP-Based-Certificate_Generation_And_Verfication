import pytest
from google.api_core import exceptions as gexc

from shared.exceptions import CloudServiceError, ConflictError, NotFoundError, ValidationFailedError
from shared.models import CertificateStatus
from tests.conftest import valid_request


def test_revoke_updates_record_and_preserves_pdf(service, admin, issued, firestore_client, storage, clock):
    cid = issued[0]["certificate_id"]
    pdf_before = storage.objects[f"certificates/{cid}.pdf"]
    out = service.revoke_certificate(cid, "Issued in error", admin)
    assert out["status"] == "REVOKED" and out["revoked_by"] == admin.uid
    assert out["revocation_reason"] == "Issued in error" and out["revoked_at"]
    record = firestore_client.data["certificates"][cid]
    assert record["status"] == "REVOKED" and record["revoked_at"] == clock.now
    assert storage.objects[f"certificates/{cid}.pdf"] == pdf_before  # original PDF preserved
    assert record["pdf_signature"] and record["metadata_signature"]  # evidence preserved


def test_revoke_records_audit_event_in_same_transaction(service, admin, issued, firestore_client):
    cid = issued[0]["certificate_id"]
    service.revoke_certificate(cid, "Issued in error", admin)
    events = [e for e in firestore_client.data["audit_events"].values() if e["event_type"] == "CERTIFICATE_REVOKED"]
    assert len(events) == 1 and events[0]["actor_uid"] == admin.uid and events[0]["certificate_id"] == cid


def test_double_revoke_conflicts_and_keeps_first_revocation(service, admin, issued, firestore_client):
    from shared.models import AdminPrincipal
    cid = issued[0]["certificate_id"]
    service.revoke_certificate(cid, "First reason", admin)
    with pytest.raises(ConflictError):
        service.revoke_certificate(cid, "Second reason", AdminPrincipal("other-admin", "o@example.com"))
    record = firestore_client.data["certificates"][cid]
    assert record["revocation_reason"] == "First reason" and record["revoked_by"] == admin.uid
    revoke_events = [e for e in firestore_client.data["audit_events"].values() if e["event_type"] == "CERTIFICATE_REVOKED"]
    assert len(revoke_events) == 1


def test_revoke_unknown_or_malformed_id(service, admin):
    with pytest.raises(NotFoundError):
        service.revoke_certificate("CERT-2026-FFFFFFFFFFFFFFFFFFFF", "Issued in error", admin)
    with pytest.raises(ValidationFailedError):
        service.revoke_certificate("bad", "Issued in error", admin)


def test_failed_transaction_leaves_certificate_valid(service, admin, issued, firestore_client):
    cid = issued[0]["certificate_id"]
    firestore_client.failures["transaction_write"] = gexc.Aborted("contention")
    with pytest.raises(CloudServiceError):
        service.revoke_certificate(cid, "Issued in error", admin)
    firestore_client.failures.clear()
    assert firestore_client.data["certificates"][cid]["status"] == "VALID"
    assert service.verify_certificate(cid)["status"] == "VALID"


def test_revoked_status_is_sticky(service, admin, issued, repo):
    cid = issued[0]["certificate_id"]
    service.revoke_certificate(cid, "Issued in error", admin)
    with pytest.raises(ConflictError):
        repo.update_certificate_status(cid, CertificateStatus.EXPIRED)
    with pytest.raises(ValidationFailedError):
        repo.update_certificate_status(cid, CertificateStatus.REVOKED)
    assert service.verify_certificate(cid)["status"] == "REVOKED"


def test_revoking_an_expired_certificate_is_allowed(service, admin, clock):
    from datetime import timedelta
    from shared.models import utc_now
    cid = service.create_certificate(valid_request(expiry_date=utc_now() + timedelta(days=1)), admin)["certificate_id"]
    clock.advance(days=3)
    assert service.revoke_certificate(cid, "Issued in error", admin)["status"] == "REVOKED"
    assert service.verify_certificate(cid)["status"] == "REVOKED"
