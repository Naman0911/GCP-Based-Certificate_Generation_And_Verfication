"""Domain models, enums and time helpers.

Defines certificate data structure , UTC dates handling and effective certificate status
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, Mapping, Optional

from shared.exceptions import MalformedRecordError


# ---------------------------------------------------------------------- #
# Time helpers (everything is UTC, second precision)
# ---------------------------------------------------------------------- #
def utc_now() -> datetime:
    """Current UTC time truncated to whole seconds."""
    return datetime.now(timezone.utc).replace(microsecond=0)


def to_utc(value: datetime) -> datetime:
    """Return ``value`` as an aware UTC datetime (naive values are taken as UTC)."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def iso_z(value: Optional[datetime]) -> Optional[str]:
    """ISO 8601 UTC string with a ``Z`` suffix, e.g. ``2026-10-15T09:30:00Z``."""
    if value is None:
        return None
    return to_utc(value).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------- #
# Enums
# ---------------------------------------------------------------------- #
class CertificateStatus(str, Enum):
    VALID = "VALID"
    REVOKED = "REVOKED"
    EXPIRED = "EXPIRED"


class VerificationOutcome(str, Enum):
    VALID = "VALID"
    INVALID = "INVALID"
    REVOKED = "REVOKED"
    EXPIRED = "EXPIRED"
    TAMPERED = "TAMPERED"


@dataclass(frozen=True)
class AdminPrincipal:
    """An authenticated, authorised administrator (derived from a verified token)."""

    uid: str
    email: Optional[str] = None


def effective_status(
    stored_status: CertificateStatus, expiry_date: Optional[datetime], now: datetime
) -> CertificateStatus:
    """Status that is true *right now* (revocation wins, then expiry)."""
    if stored_status == CertificateStatus.REVOKED:
        return CertificateStatus.REVOKED
    if stored_status == CertificateStatus.EXPIRED:
        return CertificateStatus.EXPIRED
    if expiry_date is not None and to_utc(expiry_date) <= to_utc(now):
        return CertificateStatus.EXPIRED
    return CertificateStatus.VALID


# ---------------------------------------------------------------------- #
# Certificate record
# ---------------------------------------------------------------------- #
_REQUIRED_STRINGS = (
    "certificate_id",
    "recipient_name",
    "course_name",
    "organization_name",
    "storage_bucket",
    "storage_object",
    "pdf_sha256",
    "pdf_signature",
    "metadata_sha256",
    "metadata_signature",
    "signature_algorithm",
    "kms_key_version",
    "created_by",
)
_OPTIONAL_STRINGS = ("recipient_email", "revoked_by", "revocation_reason")
_REQUIRED_TIMES = ("issue_date", "created_at")
_OPTIONAL_TIMES = ("expiry_date", "revoked_at")


@dataclass
class CertificateRecord:
    """The Firestore document stored for each certificate (never holds PDF bytes)."""

    certificate_id: str
    recipient_name: str
    course_name: str
    organization_name: str
    issue_date: datetime
    status: CertificateStatus
    storage_bucket: str
    storage_object: str
    pdf_sha256: str
    pdf_signature: str
    metadata_sha256: str
    metadata_signature: str
    signature_algorithm: str
    kms_key_version: str
    created_by: str
    created_at: datetime
    recipient_email: Optional[str] = None
    expiry_date: Optional[datetime] = None
    revoked_at: Optional[datetime] = None
    revoked_by: Optional[str] = None
    revocation_reason: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Firestore representation (datetimes become native Firestore timestamps)."""
        return {
            "certificate_id": self.certificate_id,
            "recipient_name": self.recipient_name,
            "recipient_email": self.recipient_email,
            "course_name": self.course_name,
            "organization_name": self.organization_name,
            "issue_date": to_utc(self.issue_date),
            "expiry_date": to_utc(self.expiry_date) if self.expiry_date else None,
            "status": self.status.value,
            "storage_bucket": self.storage_bucket,
            "storage_object": self.storage_object,
            "pdf_sha256": self.pdf_sha256,
            "pdf_signature": self.pdf_signature,
            "metadata_sha256": self.metadata_sha256,
            "metadata_signature": self.metadata_signature,
            "signature_algorithm": self.signature_algorithm,
            "kms_key_version": self.kms_key_version,
            "created_by": self.created_by,
            "created_at": to_utc(self.created_at),
            "revoked_at": to_utc(self.revoked_at) if self.revoked_at else None,
            "revoked_by": self.revoked_by,
            "revocation_reason": self.revocation_reason,
        }

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "CertificateRecord":
        """Parse a stored document; raises :class:`MalformedRecordError` if invalid."""
        missing = [k for k in (*_REQUIRED_STRINGS, *_REQUIRED_TIMES, "status") if data.get(k) is None]
        if missing:
            raise MalformedRecordError(f"Stored record is missing fields: {', '.join(missing)}")
        for key in _REQUIRED_STRINGS:
            if not isinstance(data[key], str):
                raise MalformedRecordError(f"Stored field {key} has an unexpected type")
        for key in _OPTIONAL_STRINGS:
            if data.get(key) is not None and not isinstance(data[key], str):
                raise MalformedRecordError(f"Stored field {key} has an unexpected type")
        for key in (*_REQUIRED_TIMES, *_OPTIONAL_TIMES):
            if data.get(key) is not None and not isinstance(data[key], datetime):
                raise MalformedRecordError(f"Stored field {key} has an unexpected type")
        try:
            status = CertificateStatus(data["status"])
        except ValueError as exc:
            raise MalformedRecordError("Stored status is not recognised") from exc

        def _opt_time(key: str) -> Optional[datetime]:
            return to_utc(data[key]) if data.get(key) is not None else None

        return cls(
            certificate_id=data["certificate_id"],
            recipient_name=data["recipient_name"],
            recipient_email=data.get("recipient_email"),
            course_name=data["course_name"],
            organization_name=data["organization_name"],
            issue_date=to_utc(data["issue_date"]),
            expiry_date=_opt_time("expiry_date"),
            status=status,
            storage_bucket=data["storage_bucket"],
            storage_object=data["storage_object"],
            pdf_sha256=data["pdf_sha256"],
            pdf_signature=data["pdf_signature"],
            metadata_sha256=data["metadata_sha256"],
            metadata_signature=data["metadata_signature"],
            signature_algorithm=data["signature_algorithm"],
            kms_key_version=data["kms_key_version"],
            created_by=data["created_by"],
            created_at=to_utc(data["created_at"]),
            revoked_at=_opt_time("revoked_at"),
            revoked_by=data.get("revoked_by"),
            revocation_reason=data.get("revocation_reason"),
        )
