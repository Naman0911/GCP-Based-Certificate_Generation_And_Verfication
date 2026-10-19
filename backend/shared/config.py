"""Validated application configuration loaded from environment variables.

Locally, Application Default Credentials (``gcloud auth application-default
login``) are used for Google Cloud access; in production the function's
runtime service account is used.  No credentials or keys are ever read from
configuration.

Reads the environment variables and validates the GCP project , bucket , KMS and other settings 
"""

from __future__ import annotations

import os
import re
from functools import lru_cache
from typing import Literal, Mapping, Optional, Tuple
from urllib.parse import urlparse
from pydantic import BaseModel , ConfigDict, Field, ValidationError, field_validator, model_validator

from shared.exceptions import ConfigurationError

_PROJECT_RE = re.compile(r"^[a-z][a-z0-9\-]{4,28}[a-z0-9]$")
_LOCATION_RE = re.compile(r"^[a-z0-9\-]{2,40}$")
_BUCKET_RE = re.compile(r"^[a-z0-9][a-z0-9._\-]{1,220}[a-z0-9]$")
_KMS_NAME_RE = re.compile(r"^[A-Za-z0-9_\-]{1,63}$")
_KMS_VERSION_RE = re.compile(r"^[0-9]{1,6}$")
_DATABASE_RE = re.compile(r"^(\(default\)|[a-z][a-z0-9\-]{2,62}[a-z0-9])$")
_SA_EMAIL_RE = re.compile(r"^[a-z0-9\-]{6,30}@[a-z0-9\-]{4,30}\.iam\.gserviceaccount\.com$")


def _csv(value: object) -> Tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, (list, tuple)):
        items = [str(v) for v in value]
    else:
        items = str(value).split(",")
    return tuple(i.strip() for i in items if i.strip())


class Settings(BaseModel):
    """Immutable, validated settings (one field per environment variable)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    google_cloud_project: str
    google_cloud_location: str
    firestore_database: str = "(default)"
    gcs_bucket_name: str
    kms_key_ring: str
    kms_key_name: str
    kms_key_version: str
    identity_platform_project_id: str
    admin_emails: Tuple[str, ...] = ()
    public_verification_base_url: str
    max_upload_size_mb: int = Field(default=10, ge=1, le=25)
    signed_url_expiration_minutes: int = Field(default=10, ge=1, le=60)
    environment: Literal["development", "test", "staging", "production"] = "development"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"

    # Optional settings (not required by every deployment).
    use_local_dev_signer: bool = False
    signed_url_service_account: Optional[str] = None
    pdf_font_path: Optional[str] = None
    pdf_font_bold_path: Optional[str] = None

    # ------------------------------------------------------------------ #
    # Field validators
    # ------------------------------------------------------------------ #
    @field_validator("admin_emails", mode="before")
    @classmethod
    def _parse_admin_emails(cls, value: object) -> Tuple[str, ...]:
        emails = tuple(e.lower() for e in _csv(value))
        for email in emails:
            if "@" not in email or email.startswith("@") or email.endswith("@"):
                raise ValueError("must be a comma separated list of email addresses")
        return emails

    @field_validator("environment", mode="before")
    @classmethod
    def _lower_env(cls, value: object) -> object:
        return value.lower() if isinstance(value, str) else value

    @field_validator("log_level", mode="before")
    @classmethod
    def _upper_level(cls, value: object) -> object:
        return value.upper() if isinstance(value, str) else value

    @field_validator("google_cloud_project", "identity_platform_project_id")
    @classmethod
    def _check_project(cls, value: str) -> str:
        if not _PROJECT_RE.match(value):
            raise ValueError("is not a valid Google Cloud project ID")
        return value

    @field_validator("google_cloud_location")
    @classmethod
    def _check_location(cls, value: str) -> str:
        if not _LOCATION_RE.match(value):
            raise ValueError("is not a valid Google Cloud location")
        return value

    @field_validator("firestore_database")
    @classmethod
    def _check_database(cls, value: str) -> str:
        if not _DATABASE_RE.match(value):
            raise ValueError("is not a valid Firestore database ID")
        return value

    @field_validator("gcs_bucket_name")
    @classmethod
    def _check_bucket(cls, value: str) -> str:
        if not _BUCKET_RE.match(value):
            raise ValueError("is not a valid Cloud Storage bucket name")
        return value

    @field_validator("kms_key_ring", "kms_key_name")
    @classmethod
    def _check_kms_name(cls, value: str) -> str:
        if not _KMS_NAME_RE.match(value):
            raise ValueError("is not a valid Cloud KMS resource name")
        return value

    @field_validator("kms_key_version")
    @classmethod
    def _check_kms_version(cls, value: str) -> str:
        if not _KMS_VERSION_RE.match(value):
            raise ValueError("must be a numeric Cloud KMS key version (for example 1)")
        return value

    @field_validator("signed_url_service_account")
    @classmethod
    def _check_sa(cls, value: Optional[str]) -> Optional[str]:
        if value is not None and not _SA_EMAIL_RE.match(value):
            raise ValueError("is not a valid service account email")
        return value

    @field_validator("public_verification_base_url")
    @classmethod
    def _check_base_url(cls, value: str) -> str:
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("must be an absolute http(s) URL")
        if parsed.query or parsed.fragment or parsed.username or parsed.password:
            raise ValueError("must not contain credentials, a query string or a fragment")
        return value.rstrip("/")

    @model_validator(mode="after")
    def _production_rules(self) -> "Settings":
        if self.environment == "production":
            if self.use_local_dev_signer:
                raise ValueError("USE_LOCAL_DEV_SIGNER is forbidden when ENVIRONMENT=production")
            if not self.public_verification_base_url.startswith("https://"):
                raise ValueError("PUBLIC_VERIFICATION_BASE_URL must use https in production")
        return self

    # ------------------------------------------------------------------ #
    # Derived values
    # ------------------------------------------------------------------ #
    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_size_mb * 1024 * 1024

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def kms_key_prefix(self) -> str:
        """Resource-name prefix shared by every version of the signing key."""
        return (
            f"projects/{self.google_cloud_project}/locations/{self.google_cloud_location}"
            f"/keyRings/{self.kms_key_ring}/cryptoKeys/{self.kms_key_name}/cryptoKeyVersions/"
        )

    @property
    def kms_key_version_name(self) -> str:
        """Full resource name of the key version used for NEW signatures."""
        return f"{self.kms_key_prefix}{self.kms_key_version}"

    # ------------------------------------------------------------------ #
    # Loading
    # ------------------------------------------------------------------ #
    @classmethod
    def from_env(cls, env: Optional[Mapping[str, str]] = None) -> "Settings":
        """Build settings from environment variables (``FIELD_NAME`` upper-cased)."""
        source = os.environ if env is None else env
        raw = {}
        for name in cls.model_fields:
            value = source.get(name.upper())
            if value is not None and value.strip() != "":
                raw[name] = value.strip()
        try:
            return cls(**raw)
        except ValidationError as exc:
            problems = []
            for err in exc.errors():
                variable = str(err["loc"][0]).upper() if err["loc"] else "SETTINGS"
                message = str(err["msg"]).removeprefix("Value error, ")
                problems.append(f"{variable}: {message}")
            # Values are intentionally never echoed back.
            raise ConfigurationError(
                "Invalid or missing configuration - " + "; ".join(sorted(set(problems)))
            ) from exc


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide settings (cached)."""
    return Settings.from_env()


def clear_settings_cache() -> None:
    get_settings.cache_clear()
