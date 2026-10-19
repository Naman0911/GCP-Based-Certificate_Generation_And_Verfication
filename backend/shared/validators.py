"""Request validation (Pydantic), certificate-ID checks and upload handling."""

from __future__ import annotations

import json
import re
import unicodedata
from datetime import datetime, timedelta
from typing import Any, Mapping, Optional, Type, TypeVar

from pydantic import BaseModel, ConfigDict, EmailStr, Field, ValidationError, field_validator

from shared.exceptions import (
    BadRequestError,
    InvalidPdfError,
    PayloadTooLargeError,
    ValidationFailedError,
)
from shared.models import CertificateStatus, to_utc, utc_now

CERTIFICATE_ID_RE = re.compile(r"^CERT-\d{4}-[0-9A-F]{20}$")
MAX_JSON_BODY_BYTES = 64 * 1024
#: Allowance for multipart framing on top of the maximum PDF size.
MULTIPART_OVERHEAD_BYTES = 64 * 1024

# Control characters / unassigned / private-use code points are rejected.
# Zero-width joiners (category Cf) are kept because Indic scripts need them.
_FORBIDDEN_CATEGORIES = {"Cc", "Cs", "Co", "Cn"}
# Bidirectional override/isolate characters can be used to spoof names.
_BIDI_CONTROLS = set("‪‫‬‭‮⁦⁧⁨⁩")

M = TypeVar("M", bound=BaseModel)


# ---------------------------------------------------------------------- #
# Generic helpers
# ---------------------------------------------------------------------- #
def _clean_text(value: Any) -> Any:
    """Trim, collapse whitespace, NFC-normalise and reject control characters."""
    if not isinstance(value, str):
        return value
    value = unicodedata.normalize("NFC", " ".join(value.split()))
    for char in value:
        if unicodedata.category(char) in _FORBIDDEN_CATEGORIES or char in _BIDI_CONTROLS:
            raise ValueError("must not contain control or invisible formatting characters")
    return value


def format_validation_errors(exc: ValidationError) -> list:
    """Convert Pydantic errors to client-safe dictionaries (input values omitted)."""
    errors = []
    for err in exc.errors():
        errors.append(
            {
                "field": ".".join(str(p) for p in err["loc"]) or "body",
                "message": str(err["msg"]).removeprefix("Value error, "),
                "type": err["type"],
            }
        )
    return errors


def parse_model(model: Type[M], data: Any) -> M:
    """Validate ``data`` against ``model`` raising :class:`ValidationFailedError`."""
    try:
        return model.model_validate(data)
    except ValidationError as exc:
        raise ValidationFailedError(details=format_validation_errors(exc)) from exc


def validate_certificate_id(value: Any) -> str:
    if not isinstance(value, str) or not CERTIFICATE_ID_RE.match(value):
        raise ValidationFailedError(
            "The certificate ID is malformed.",
            details=[{"field": "certificate_id", "message": "must look like CERT-2026-0123456789ABCDEF0123"}],
        )
    return value


# ---------------------------------------------------------------------- #
# Request models
# ---------------------------------------------------------------------- #
class CreateCertificateRequest(BaseModel):
    """Body of ``POST /admin/certificates``.

    Unknown fields (``created_by``, ``status``, ``issue_date``, roles, ...) are
    rejected: identity and server-controlled values are never taken from the body.
    """

    model_config = ConfigDict(extra="forbid")

    recipient_name: str = Field(min_length=1, max_length=120)
    recipient_email: Optional[EmailStr] = None
    course_name: str = Field(min_length=1, max_length=200)
    organization_name: str = Field(min_length=1, max_length=200)
    expiry_date: Optional[datetime] = None

    @field_validator("recipient_name", "course_name", "organization_name", mode="before")
    @classmethod
    def _clean_names(cls, value: Any) -> Any:
        return _clean_text(value)

    @field_validator("recipient_email", mode="before")
    @classmethod
    def _clean_email(cls, value: Any) -> Any:
        if isinstance(value, str):
            value = value.strip()
            if value == "":
                return None
            if len(value) > 254:
                raise ValueError("must be at most 254 characters")
        return value

    @field_validator("expiry_date")
    @classmethod
    def _check_expiry(cls, value: Optional[datetime]) -> Optional[datetime]:
        if value is None:
            return None
        expiry = to_utc(value).replace(microsecond=0)
        now = utc_now()
        if expiry <= now + timedelta(minutes=1):
            raise ValueError("must be in the future")
        if expiry > now + timedelta(days=36500):
            raise ValueError("must be within 100 years from now")
        return expiry


class RevokeCertificateRequest(BaseModel):
    """Body of ``PATCH /admin/certificates/{id}/revoke``."""

    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=3, max_length=500)

    @field_validator("reason", mode="before")
    @classmethod
    def _clean_reason(cls, value: Any) -> Any:
        return _clean_text(value)


class ListCertificatesQuery(BaseModel):
    """Query string of ``GET /admin/certificates``."""

    model_config = ConfigDict(extra="forbid")

    page_size: int = Field(default=25, ge=1, le=100)
    page_token: Optional[str] = Field(default=None, min_length=1, max_length=256)
    status: Optional[CertificateStatus] = None


# ---------------------------------------------------------------------- #
# Request body / upload helpers
# ---------------------------------------------------------------------- #
def get_json_body(request: Any) -> Mapping[str, Any]:
    """Read a bounded JSON object from a Flask request."""
    length = request.content_length
    if length is not None and length > MAX_JSON_BODY_BYTES:
        raise PayloadTooLargeError("The JSON body is too large.")
    raw = request.get_data(cache=False)
    if len(raw) > MAX_JSON_BODY_BYTES:
        raise PayloadTooLargeError("The JSON body is too large.")
    if not raw.strip():
        raise BadRequestError("A JSON request body is required.")
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BadRequestError("The request body is not valid JSON.") from exc
    if not isinstance(data, dict):
        raise ValidationFailedError(
            details=[{"field": "body", "message": "must be a JSON object", "type": "type_error"}]
        )
    return data


def validate_pdf_bytes(data: bytes, max_bytes: int) -> bytes:
    """Validate that ``data`` looks like a PDF and is within the size limit.

    The check is deliberately structural (header + end-of-file marker) and not a
    full parse: a *modified* PDF must still be accepted so that it can be reported
    as ``TAMPERED`` by the digest comparison rather than rejected as malformed.
    """
    if len(data) > max_bytes:
        raise PayloadTooLargeError(f"The PDF exceeds the maximum size of {max_bytes // (1024 * 1024)} MB.")
    if len(data) < 32:
        raise InvalidPdfError("The uploaded file is empty or too small to be a PDF.")
    if b"%PDF-" not in data[:1024]:
        raise InvalidPdfError("The uploaded file does not start with a PDF header.")
    if b"%%EOF" not in data[-1024:]:
        raise InvalidPdfError("The uploaded PDF is truncated (missing end-of-file marker).")
    return data


def extract_pdf_upload(request: Any, max_bytes: int) -> bytes:
    """Return the uploaded PDF bytes from multipart (``file`` field) or a raw body.

    Size limits are enforced before and while reading.  The content is validated
    structurally; the declared MIME type and file extension are *not* trusted.
    """
    length = request.content_length
    if length is not None and length > max_bytes + MULTIPART_OVERHEAD_BYTES:
        raise PayloadTooLargeError(f"The upload exceeds the maximum size of {max_bytes // (1024 * 1024)} MB.")

    content_type = (request.content_type or "").lower()
    if content_type.startswith("multipart/form-data"):
        upload = request.files.get("file")
        if upload is None:
            raise ValidationFailedError(
                details=[{"field": "file", "message": "a PDF must be uploaded in the 'file' form field"}]
            )
        data = upload.stream.read(max_bytes + 1)
    elif content_type.startswith(("application/pdf", "application/octet-stream")):
        data = request.stream.read(max_bytes + 1)
    else:
        raise ValidationFailedError(
            details=[{"field": "file", "message": "send multipart/form-data with a 'file' field or an application/pdf body"}]
        )
    return validate_pdf_bytes(data, max_bytes)
