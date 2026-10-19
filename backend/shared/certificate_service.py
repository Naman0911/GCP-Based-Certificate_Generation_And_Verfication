"""Business logic: issuing, verifying, listing, revoking and downloading certificates."""

# Contains the main business logic for generating, verifying, listing, retrieving, revoking and downloading certificates.




from __future__ import annotations

import hmac
import logging
import uuid
from datetime import datetime
from typing import Any, Callable, Dict, Optional

from shared import audit_service as audit_events
from shared.crypto_service import (
    CryptoService,
    build_canonical_metadata,
    metadata_digest_hex,
    sha256_hex,
)
from shared.exceptions import (
    ConflictError,
    CryptoError,
    MalformedRecordError,
    NotFoundError,
    ValidationFailedError,
)
from shared.logging_utils import get_logger, log_event
from shared.models import (
    AdminPrincipal,
    CertificateRecord,
    CertificateStatus,
    VerificationOutcome,
    effective_status,
    iso_z,
    utc_now,
)
from shared.qr_service import build_verification_url, generate_qr_png
from shared.storage_service import object_name_for
from shared.validators import (
    CreateCertificateRequest,
    validate_certificate_id,
    validate_pdf_bytes,
)

logger = get_logger("certificate.service")


def generate_certificate_id(now: datetime) -> str:
    """``CERT-<year>-<20 hex>`` built from UUID4 randomness.

    The fixed UUID version/variant nibbles are removed so every character is random.
    """
    hex_chars = uuid.uuid4().hex
    random_part = (hex_chars[:12] + hex_chars[13:16] + hex_chars[17:])[:20].upper()
    return f"CERT-{now.year:04d}-{random_part}"


class CertificateService:
    def __init__(
        self,
        settings: Any,
        repository: Any,
        storage: Any,
        crypto: CryptoService,
        audit: Any,
        pdf_service: Any = None,
        clock: Callable[[], datetime] = utc_now,
        id_factory: Callable[[datetime], str] = generate_certificate_id,
    ) -> None:
        self._settings = settings
        self._repository = repository
        self._storage = storage
        self._crypto = crypto
        self._audit = audit
        self._pdf_service = pdf_service
        self._clock = clock
        self._id_factory = id_factory

    def _pdf(self) -> Any:
        if self._pdf_service is None:
            from shared.pdf_service import PdfService

            self._pdf_service = PdfService(
                self._settings.pdf_font_path, self._settings.pdf_font_bold_path
            )
        return self._pdf_service

    # ================================================================== #
    # Views
    # ================================================================== #
    @staticmethod
    def _public_view(record: CertificateRecord, status: CertificateStatus) -> Dict[str, Any]:
        """Only information that is safe to show to anyone."""
        return {
            "certificate_id": record.certificate_id,
            "recipient_name": record.recipient_name,
            "course_name": record.course_name,
            "organization_name": record.organization_name,
            "issue_date": iso_z(record.issue_date),
            "expiry_date": iso_z(record.expiry_date),
            "status": status.value,
            "revoked_at": iso_z(record.revoked_at),
        }

    def _admin_summary(self, record: CertificateRecord) -> Dict[str, Any]:
        status = effective_status(record.status, record.expiry_date, self._clock())
        return {
            "certificate_id": record.certificate_id,
            "recipient_name": record.recipient_name,
            "recipient_email": record.recipient_email,
            "course_name": record.course_name,
            "organization_name": record.organization_name,
            "issue_date": iso_z(record.issue_date),
            "expiry_date": iso_z(record.expiry_date),
            "status": record.status.value,
            "effective_status": status.value,
            "created_at": iso_z(record.created_at),
            "created_by": record.created_by,
            "revoked_at": iso_z(record.revoked_at),
        }

    def _admin_detail(self, record: CertificateRecord) -> Dict[str, Any]:
        detail = self._admin_summary(record)
        detail.update(
            {
                "pdf_sha256": record.pdf_sha256,
                "metadata_sha256": record.metadata_sha256,
                "signature_algorithm": record.signature_algorithm,
                "kms_key_version": record.kms_key_version,
                "revoked_by": record.revoked_by,
                "revocation_reason": record.revocation_reason,
            }
        )
        return detail

    # ================================================================== #
    # Create
    # ================================================================== #
    def create_certificate(self, request: CreateCertificateRequest, actor: AdminPrincipal) -> Dict[str, Any]:
        now = self._clock()
        expiry = request.expiry_date
        if expiry is not None and expiry <= now:
            raise ValidationFailedError(
                details=[{"field": "expiry_date", "message": "must be in the future"}]
            )

        certificate_id = self._id_factory(now)
        email = str(request.recipient_email) if request.recipient_email else None
        metadata = build_canonical_metadata(
            certificate_id=certificate_id,
            recipient_name=request.recipient_name,
            recipient_email=email,
            course_name=request.course_name,
            organization_name=request.organization_name,
            issue_date=now,
            expiry_date=expiry,
        )
        # Store exactly what was signed (already NFC-normalised).
        metadata_digest = metadata_digest_hex(metadata)
        metadata_signature = self._crypto.sign_hex_digest(metadata_digest)

        verification_url = build_verification_url(
            self._settings.public_verification_base_url, certificate_id
        )
        qr_png = generate_qr_png(verification_url)
        pdf_bytes = self._pdf().generate_certificate_pdf(
            certificate_id=certificate_id,
            recipient_name=metadata["recipient_name"],
            course_name=metadata["course_name"],
            organization_name=metadata["organization_name"],
            issue_date=now,
            expiry_date=expiry,
            verification_url=verification_url,
            qr_png=qr_png,
        )
        # The PDF is final from here on: hash and sign exactly these bytes.
        pdf_digest = sha256_hex(pdf_bytes)
        pdf_signature = self._crypto.sign_hex_digest(pdf_digest)
        if pdf_signature.key_version != metadata_signature.key_version:
            raise CryptoError("Signatures were produced by different key versions")

        object_name = object_name_for(certificate_id)
        record = CertificateRecord(
            certificate_id=certificate_id,
            recipient_name=metadata["recipient_name"],
            recipient_email=metadata["recipient_email"],
            course_name=metadata["course_name"],
            organization_name=metadata["organization_name"],
            issue_date=now,
            expiry_date=expiry,
            status=CertificateStatus.VALID,
            storage_bucket=self._storage.bucket_name,
            storage_object=object_name,
            pdf_sha256=pdf_digest,
            pdf_signature=pdf_signature.signature_b64,
            metadata_sha256=metadata_digest,
            metadata_signature=metadata_signature.signature_b64,
            signature_algorithm=pdf_signature.algorithm,
            kms_key_version=pdf_signature.key_version,
            created_by=actor.uid,
            created_at=now,
        )

        # Multi-service write with compensation:
        #   1. upload the PDF (create-only);  2. create the Firestore record (+audit).
        # If (2) fails the uploaded object is deleted so nothing is orphaned and no
        # record exists that could be mistaken for a valid certificate.
        generation = self._storage.upload_certificate_pdf(object_name, pdf_bytes)
        event = self._audit.build_event(
            audit_events.CERTIFICATE_CREATED, actor, certificate_id,
            details={"kms_key_version": record.kms_key_version},
        )
        try:
            self._repository.create_certificate_record(record.to_dict(), audit_event=event)
        except Exception:
            self._compensate_upload(object_name, generation, certificate_id)
            raise
        self._audit.log_written(event)
        log_event(logger, logging.INFO, "certificate_created", certificate_id=certificate_id, actor_uid=actor.uid)

        result: Dict[str, Any] = {
            "certificate_id": certificate_id,
            "verification_url": verification_url,
            "certificate": self._admin_summary(record),
            "download_path": f"/admin/certificates/{certificate_id}/download",
            "download": None,
        }
        try:
            url, expires_at = self._storage.generate_download_url(object_name, filename=f"{certificate_id}.pdf")
            result["download"] = {"url": url, "expires_at": iso_z(expires_at)}
        except Exception as exc:  # noqa: BLE001 - the certificate exists; link can be re-requested
            log_event(
                logger, logging.WARNING, "download_url_unavailable_after_create",
                certificate_id=certificate_id, error_type=type(exc).__name__,
            )
        return result

    def _compensate_upload(self, object_name: str, generation: int, certificate_id: str) -> None:
        try:
            self._storage.delete_object_if_generation_matches(object_name, generation)
            log_event(logger, logging.WARNING, "create_rolled_back", certificate_id=certificate_id)
        except Exception as exc:  # noqa: BLE001
            log_event(
                logger, logging.CRITICAL, "orphaned_storage_object",
                certificate_id=certificate_id, object_name=object_name, generation=generation,
                error_type=type(exc).__name__,
            )

    # ================================================================== #
    # Verification
    # ================================================================== #
    def verify_certificate(self, certificate_id: str) -> Dict[str, Any]:
        """Record + metadata verification.  Never claims the PDF was checked."""
        return self._verify(certificate_id, None)

    def verify_certificate_file(self, certificate_id: str, pdf_bytes: bytes) -> Dict[str, Any]:
        """Verify an uploaded PDF against the stored digest and signature."""
        validate_pdf_bytes(pdf_bytes, self._settings.max_upload_bytes)
        return self._verify(certificate_id, pdf_bytes)

    def _verify(self, certificate_id: str, pdf_bytes: Optional[bytes]) -> Dict[str, Any]:
        validate_certificate_id(certificate_id)
        now = self._clock()
        data = self._repository.get_certificate_by_id(certificate_id)
        base = {
            "certificate_id": certificate_id,
            "record_found": data is not None,
            "verified_at": iso_z(now),
        }
        if data is None:
            log_event(logger, logging.INFO, "certificate_verified", certificate_id=certificate_id, outcome="INVALID")
            return {
                **base,
                "status": VerificationOutcome.INVALID.value,
                "certificate_status": None,
                "metadata_signature_valid": None,
                "pdf_integrity_verified": None,
                "message": "No certificate was found with this ID.",
                "certificate": None,
            }

        try:
            record = CertificateRecord.from_dict(data)
        except MalformedRecordError:
            log_event(logger, logging.ERROR, "malformed_certificate_record", certificate_id=certificate_id)
            return self._tampered(base, "The certificate record failed integrity verification.", False, None)

        metadata_ok = self._metadata_is_authentic(record, certificate_id)
        pdf_ok: Optional[bool] = None
        if pdf_bytes is not None:
            pdf_ok = self._pdf_is_authentic(record, pdf_bytes)

        status = effective_status(record.status, record.expiry_date, now)
        file_note = " and the uploaded PDF matches the issued file" if pdf_ok else ""

        if not metadata_ok:
            return self._tampered(
                base, "The certificate record failed integrity verification.", False, pdf_ok
            )
        if pdf_ok is False:
            return self._tampered(
                base, "The uploaded PDF does not match the issued certificate file.", True, False,
                record=record, status=status,
            )

        if status == CertificateStatus.REVOKED:
            outcome, message = VerificationOutcome.REVOKED, "This certificate has been revoked and is no longer valid."
        elif status == CertificateStatus.EXPIRED:
            outcome, message = VerificationOutcome.EXPIRED, "This certificate has expired."
        else:
            outcome = VerificationOutcome.VALID
            message = (
                "Certificate record verified" + file_note
                if pdf_bytes is not None
                else "Certificate record and metadata signature verified"
            )
        log_event(
            logger, logging.INFO, "certificate_verified", certificate_id=certificate_id,
            outcome=outcome.value, file_checked=pdf_bytes is not None,
        )
        return {
            **base,
            "status": outcome.value,
            "certificate_status": status.value,
            "metadata_signature_valid": True,
            "pdf_integrity_verified": pdf_ok,
            "message": message,
            "certificate": self._public_view(record, status),
        }

    def _tampered(
        self,
        base: Dict[str, Any],
        message: str,
        metadata_ok: bool,
        pdf_ok: Optional[bool],
        *,
        record: Optional[CertificateRecord] = None,
        status: Optional[CertificateStatus] = None,
    ) -> Dict[str, Any]:
        log_event(
            logger, logging.WARNING, "certificate_tamper_detected",
            certificate_id=base["certificate_id"], metadata_ok=metadata_ok, pdf_ok=pdf_ok,
        )
        return {
            **base,
            "status": VerificationOutcome.TAMPERED.value,
            "certificate_status": status.value if status else None,
            "metadata_signature_valid": metadata_ok,
            "pdf_integrity_verified": pdf_ok,
            "message": message,
            # Data from a record that failed verification is never displayed.
            "certificate": self._public_view(record, status) if record and status and metadata_ok else None,
        }

    def _metadata_is_authentic(self, record: CertificateRecord, requested_id: str) -> bool:
        if record.certificate_id != requested_id:
            return False
        metadata = build_canonical_metadata(
            certificate_id=record.certificate_id,
            recipient_name=record.recipient_name,
            recipient_email=record.recipient_email,
            course_name=record.course_name,
            organization_name=record.organization_name,
            issue_date=record.issue_date,
            expiry_date=record.expiry_date,
        )
        recomputed = metadata_digest_hex(metadata)
        if not hmac.compare_digest(recomputed, record.metadata_sha256):
            log_event(logger, logging.WARNING, "metadata_digest_mismatch", certificate_id=requested_id)
            return False
        valid = self._crypto.verify_signature(
            record.metadata_sha256, record.metadata_signature, record.kms_key_version,
            expected_algorithm=record.signature_algorithm,
        )
        if not valid:
            log_event(logger, logging.WARNING, "metadata_signature_invalid", certificate_id=requested_id)
        return valid

    def _pdf_is_authentic(self, record: CertificateRecord, pdf_bytes: bytes) -> bool:
        uploaded_digest = sha256_hex(pdf_bytes)
        if not hmac.compare_digest(uploaded_digest, record.pdf_sha256):
            log_event(logger, logging.WARNING, "pdf_digest_mismatch", certificate_id=record.certificate_id)
            return False
        valid = self._crypto.verify_signature(
            record.pdf_sha256, record.pdf_signature, record.kms_key_version,
            expected_algorithm=record.signature_algorithm,
        )
        if not valid:
            log_event(logger, logging.WARNING, "pdf_signature_invalid", certificate_id=record.certificate_id)
        return valid

    # ================================================================== #
    # Admin reads
    # ================================================================== #
    def list_certificates(
        self, *, page_size: int, page_token: Optional[str], status: Optional[CertificateStatus]
    ) -> Dict[str, Any]:
        records, next_token = self._repository.list_certificates(
            page_size=page_size, page_token=page_token, status=status
        )
        items = [self._admin_summary(CertificateRecord.from_dict(r)) for r in records]
        return {"items": items, "page_size": page_size, "next_page_token": next_token}

    def get_certificate(self, certificate_id: str) -> Dict[str, Any]:
        validate_certificate_id(certificate_id)
        record = self._load_record(certificate_id)
        status = effective_status(record.status, record.expiry_date, self._clock())
        if status == CertificateStatus.EXPIRED and record.status == CertificateStatus.VALID:
            # Lazily persist the expiry so stored status filters become accurate.
            try:
                if self._repository.update_certificate_status(certificate_id, CertificateStatus.EXPIRED):
                    record.status = CertificateStatus.EXPIRED
            except ConflictError:
                record = self._load_record(certificate_id)  # revoked concurrently
            except Exception as exc:  # noqa: BLE001 - read must still succeed
                log_event(
                    logger, logging.WARNING, "status_materialisation_failed",
                    certificate_id=certificate_id, error_type=type(exc).__name__,
                )
        return self._admin_detail(record)

    def _load_record(self, certificate_id: str) -> CertificateRecord:
        data = self._repository.get_certificate_by_id(certificate_id)
        if data is None:
            raise NotFoundError("Certificate not found.")
        return CertificateRecord.from_dict(data)

    # ================================================================== #
    # Revoke / download
    # ================================================================== #
    def revoke_certificate(self, certificate_id: str, reason: str, actor: AdminPrincipal) -> Dict[str, Any]:
        validate_certificate_id(certificate_id)
        event = self._audit.build_event(audit_events.CERTIFICATE_REVOKED, actor, certificate_id)
        updated = self._repository.revoke_certificate(
            certificate_id,
            revoked_by=actor.uid,
            reason=reason,
            revoked_at=self._clock(),
            audit_event=event,
        )
        self._audit.log_written(event)
        log_event(logger, logging.INFO, "certificate_revoked", certificate_id=certificate_id, actor_uid=actor.uid)
        return self._admin_detail(CertificateRecord.from_dict(updated))

    def get_download_url(self, certificate_id: str, actor: AdminPrincipal) -> Dict[str, Any]:
        validate_certificate_id(certificate_id)
        record = self._load_record(certificate_id)
        url, expires_at = self._storage.generate_download_url(
            record.storage_object, filename=f"{certificate_id}.pdf"
        )
        self._audit.record(audit_events.DOWNLOAD_URL_ISSUED, actor, certificate_id)
        return {
            "certificate_id": certificate_id,
            "url": url,
            "expires_at": iso_z(expires_at),
            "method": "GET",
        }
