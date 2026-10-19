"""Lazy wiring of services for the function entry points.

Each Cloud Run function process builds its services once (cold start) and
reuses them.  Tests replace them with :func:`set_services`.
"""

# This file is used to initialize the shared services so that the function can use them all 

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Optional

from shared.audit_service import AuditService
from shared.auth_service import AuthService
from shared.certificate_service import CertificateService
from shared.config import Settings, get_settings
from shared.crypto_service import CryptoService, KmsSigningBackend
from shared.exceptions import ConfigurationError
from shared.firestore_repository import FirestoreRepository
from shared.logging_utils import configure_logging
from shared.storage_service import StorageService


@dataclass
class Services:
    settings: Settings
    auth: AuthService
    certificates: CertificateService
    audit: AuditService


_lock = threading.Lock()
_services: Optional[Services] = None


def _build_signing_backend(settings: Settings):
    if settings.use_local_dev_signer:
        if settings.is_production:  # defence in depth (Settings already rejects this)
            raise ConfigurationError("The local development signer is forbidden in production")
        try:
            from shared.dev_signer import LocalDevSigner
        except ImportError as exc:  # removed from deployed packages on purpose
            raise ConfigurationError("The local development signer is not available") from exc
        return LocalDevSigner()
    return KmsSigningBackend(settings)


def build_services(settings: Optional[Settings] = None) -> Services:
    settings = settings or get_settings()
    configure_logging(settings.log_level)
    repository = FirestoreRepository(settings)
    storage = StorageService(settings)
    crypto = CryptoService(_build_signing_backend(settings))
    audit = AuditService(repository)
    certificates = CertificateService(settings, repository, storage, crypto, audit)
    return Services(settings=settings, auth=AuthService(settings), certificates=certificates, audit=audit)


def get_services() -> Services:
    global _services
    if _services is None:
        with _lock:
            if _services is None:
                _services = build_services()
    return _services


def set_services(services: Optional[Services]) -> None:
    """Install (or clear, with ``None``) the process-wide services - used by tests."""
    global _services
    _services = services
