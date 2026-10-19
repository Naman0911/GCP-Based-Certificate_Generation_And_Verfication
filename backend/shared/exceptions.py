"""Centralised application exceptions.

Every error that may reach a client derives from :class:`AppError`.  Each class
carries the HTTP status code and a stable machine-readable ``error_code``.
Server-side errors (5xx) never expose their internal message to clients; the
generic ``default_message`` is returned instead and the real cause is logged.
"""

from __future__ import annotations

from typing import Any, Mapping, Optional


class AppError(Exception):
    """Base class for all errors that are translated into HTTP responses."""

    status_code: int = 500
    error_code: str = "internal_error"
    default_message: str = "An internal error occurred."
    #: When False the internal message is replaced by ``default_message``
    #: in responses (used for 5xx errors that may contain infrastructure text).
    expose_message: bool = True

    def __init__(
        self,
        message: Optional[str] = None,
        *,
        details: Any = None,
        headers: Optional[Mapping[str, str]] = None,
    ) -> None:
        self.message = message or self.default_message
        self.details = details
        self.headers = dict(headers or {})
        super().__init__(self.message)

    @property
    def public_message(self) -> str:
        """Message that is safe to return to API clients."""
        return self.message if self.expose_message else self.default_message


class BadRequestError(AppError):
    status_code = 400
    error_code = "bad_request"
    default_message = "The request could not be understood."


class UnauthorizedError(AppError):
    status_code = 401
    error_code = "unauthorized"
    default_message = "Authentication is required."


class ForbiddenError(AppError):
    status_code = 403
    error_code = "forbidden"
    default_message = "You do not have permission to perform this action."


class NotFoundError(AppError):
    status_code = 404
    error_code = "not_found"
    default_message = "The requested resource was not found."


class MethodNotAllowedError(AppError):
    status_code = 405
    error_code = "method_not_allowed"
    default_message = "This HTTP method is not allowed for this resource."


class ConflictError(AppError):
    status_code = 409
    error_code = "conflict"
    default_message = "The request conflicts with the current state of the resource."


class PayloadTooLargeError(AppError):
    status_code = 413
    error_code = "payload_too_large"
    default_message = "The uploaded payload is too large."


class ValidationFailedError(AppError):
    status_code = 422
    error_code = "validation_error"
    default_message = "The request failed validation."


class InvalidPdfError(ValidationFailedError):
    error_code = "invalid_pdf"
    default_message = "The uploaded file is not a valid PDF document."


class CloudServiceError(AppError):
    """A Google Cloud dependency (Firestore, Storage, KMS, ...) failed."""

    status_code = 500
    error_code = "service_error"
    default_message = "A backend service failed. Please try again later."
    expose_message = False


class ConfigurationError(AppError):
    status_code = 500
    error_code = "configuration_error"
    default_message = "The service is not configured correctly."
    expose_message = False


class CryptoError(AppError):
    status_code = 500
    error_code = "crypto_error"
    default_message = "A cryptographic operation failed."
    expose_message = False


class MalformedRecordError(AppError):
    """A stored record is missing fields or has unexpected types."""

    status_code = 500
    error_code = "malformed_record"
    default_message = "A stored record is malformed."
    expose_message = False
