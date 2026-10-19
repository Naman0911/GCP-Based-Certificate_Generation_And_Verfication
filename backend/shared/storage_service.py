"""Private Cloud Storage access for certificate PDFs.

* Objects are written with ``if_generation_match=0`` so an existing object can
  never be overwritten.
* Download links are short-lived V4 signed URLs.  On Cloud Run the runtime
  service account signs through the IAM Credentials ``signBlob`` API, so it
  needs ``roles/iam.serviceAccountTokenCreator`` **on itself** (no key file).
"""

# Uploads and downloads PDFs, prevents accidental overwrites and creates signed download URLs.

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional, Tuple

from google.api_core import exceptions as gexc

from shared.exceptions import CloudServiceError, ConfigurationError, ConflictError, NotFoundError
from shared.logging_utils import get_logger, log_event

logger = get_logger("certificate.storage")

_SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]")


def _transport_errors() -> tuple:
    errors: list = [gexc.GoogleAPICallError, gexc.RetryError, ConnectionError, TimeoutError]
    try:
        from google.auth.exceptions import GoogleAuthError

        errors.append(GoogleAuthError)
    except ImportError:  # pragma: no cover
        pass
    try:
        from requests.exceptions import RequestException

        errors.append(RequestException)
    except ImportError:  # pragma: no cover
        pass
    return tuple(errors)


def object_name_for(certificate_id: str) -> str:
    return f"certificates/{certificate_id}.pdf"


class StorageService:
    def __init__(
        self,
        settings: Any,
        client: Any = None,
        credentials_provider: Optional[Callable[[], Any]] = None,
    ) -> None:
        self._settings = settings
        self._client = client
        self._credentials_provider = credentials_provider

    # ------------------------------------------------------------------ #
    @property
    def client(self) -> Any:
        if self._client is None:
            from google.cloud import storage

            self._client = storage.Client(project=self._settings.google_cloud_project)
        return self._client

    @property
    def bucket_name(self) -> str:
        return self._settings.gcs_bucket_name

    def _blob(self, object_name: str) -> Any:
        return self.client.bucket(self.bucket_name).blob(object_name)

    # ------------------------------------------------------------------ #
    def upload_certificate_pdf(self, object_name: str, data: bytes) -> int:
        """Upload ``data`` only if the object does not exist; returns its generation."""
        blob = self._blob(object_name)
        blob.cache_control = "private, no-store"
        try:
            blob.upload_from_string(
                data, content_type="application/pdf", if_generation_match=0, timeout=60
            )
        except gexc.PreconditionFailed as exc:
            raise ConflictError("A certificate file with this name already exists.") from exc
        except _transport_errors() as exc:
            log_event(logger, logging.ERROR, "storage_upload_failed", error_type=type(exc).__name__)
            raise CloudServiceError("Cloud Storage upload failed") from exc
        return int(blob.generation)

    def download_certificate_pdf(self, object_name: str) -> bytes:
        blob = self._blob(object_name)
        try:
            return blob.download_as_bytes(timeout=60)
        except gexc.NotFound as exc:
            raise NotFoundError("The certificate file was not found.") from exc
        except _transport_errors() as exc:
            log_event(logger, logging.ERROR, "storage_download_failed", error_type=type(exc).__name__)
            raise CloudServiceError("Cloud Storage download failed") from exc

    def delete_object_if_generation_matches(self, object_name: str, generation: int) -> bool:
        """Delete the object only if it is still the generation we uploaded.

        Returns ``True`` if deleted; ``False`` if it was already gone or replaced.
        """
        blob = self._blob(object_name)
        try:
            blob.delete(if_generation_match=generation, timeout=30)
            return True
        except (gexc.NotFound, gexc.PreconditionFailed):
            return False
        except _transport_errors() as exc:
            log_event(logger, logging.ERROR, "storage_delete_failed", error_type=type(exc).__name__)
            raise CloudServiceError("Cloud Storage delete failed") from exc

    # ------------------------------------------------------------------ #
    def _signing_identity(self) -> Tuple[str, str]:
        """Return ``(service_account_email, access_token)`` used for IAM signing."""
        if self._credentials_provider is not None:
            credentials = self._credentials_provider()
        else:
            import google.auth

            credentials, _ = google.auth.default(
                scopes=["https://www.googleapis.com/auth/cloud-platform"]
            )
        from google.auth.transport.requests import Request

        if not getattr(credentials, "token", None) or getattr(credentials, "expired", False):
            credentials.refresh(Request())
        email = self._settings.signed_url_service_account or getattr(
            credentials, "service_account_email", None
        )
        if not email or email == "default":
            raise ConfigurationError(
                "Cannot determine a service account for signed URLs; set SIGNED_URL_SERVICE_ACCOUNT"
            )
        return email, credentials.token

    def generate_download_url(
        self,
        object_name: str,
        *,
        filename: str,
        expiration_minutes: Optional[int] = None,
    ) -> Tuple[str, datetime]:
        """Create a short-lived V4 signed GET URL; returns ``(url, expires_at_utc)``."""
        minutes = expiration_minutes or self._settings.signed_url_expiration_minutes
        safe_name = _SAFE_FILENAME_RE.sub("_", filename)[:100] or "certificate.pdf"
        try:
            email, token = self._signing_identity()
            url = self._blob(object_name).generate_signed_url(
                version="v4",
                expiration=timedelta(minutes=minutes),
                method="GET",
                service_account_email=email,
                access_token=token,
                response_disposition=f'attachment; filename="{safe_name}"',
                response_type="application/pdf",
            )
        except ConfigurationError:
            raise
        except _transport_errors() as exc:
            log_event(logger, logging.ERROR, "signed_url_failed", error_type=type(exc).__name__)
            raise CloudServiceError("Could not create a signed download URL") from exc
        expires_at = (datetime.now(timezone.utc) + timedelta(minutes=minutes)).replace(microsecond=0)
        return url, expires_at
