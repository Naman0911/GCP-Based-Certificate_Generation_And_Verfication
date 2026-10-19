"""Shared fixtures and in-memory fakes of Firestore and Cloud Storage.

No test needs a real Google Cloud project: Firestore, Cloud Storage and Cloud
KMS are replaced by fakes (KMS by the test-only in-memory signer).
"""

from __future__ import annotations

import copy
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any, Dict, List, Optional, Tuple

import pytest
from google.api_core import exceptions as gexc

from shared.audit_service import AuditService
from shared.certificate_service import CertificateService
from shared.config import Settings
from shared.crypto_service import CryptoService
from shared.dev_signer import LocalDevSigner
from shared.exceptions import ConflictError, NotFoundError
from shared.firestore_repository import FirestoreRepository
from shared.models import AdminPrincipal, utc_now
from shared.pdf_service import PdfService
from shared.validators import CreateCertificateRequest

BASE_ENV = {
    "GOOGLE_CLOUD_PROJECT": "test-project",
    "GOOGLE_CLOUD_LOCATION": "us-central1",
    "GCS_BUCKET_NAME": "test-bucket",
    "KMS_KEY_RING": "ring",
    "KMS_KEY_NAME": "key",
    "KMS_KEY_VERSION": "1",
    "IDENTITY_PLATFORM_PROJECT_ID": "test-project",
    "ADMIN_EMAILS": "admin@example.com",
    "PUBLIC_VERIFICATION_BASE_URL": "https://certs.example.com/verify",
    "ENVIRONMENT": "test",
    "USE_LOCAL_DEV_SIGNER": "true",
    "MAX_UPLOAD_SIZE_MB": "1",
}


def make_settings(**overrides: str) -> Settings:
    return Settings.from_env({**BASE_ENV, **overrides})


# ---------------------------------------------------------------------- #
# Fake Firestore
# ---------------------------------------------------------------------- #
class FakeSnapshot:
    def __init__(self, doc_id: str, data: Optional[Dict[str, Any]]):
        self.id = doc_id
        self._data = data
        self.exists = data is not None

    def to_dict(self) -> Optional[Dict[str, Any]]:
        return copy.deepcopy(self._data) if self._data is not None else None


class FakeDocRef:
    def __init__(self, client: "FakeFirestore", collection: str, doc_id: str):
        self._client = client
        self._collection = collection
        self.id = doc_id

    @property
    def _store(self) -> Dict[str, Dict[str, Any]]:
        return self._client.data.setdefault(self._collection, {})

    def create(self, data: Dict[str, Any], **_: Any) -> None:
        self._client.check("create")
        if self.id in self._store:
            raise gexc.AlreadyExists("document exists")
        self._store[self.id] = copy.deepcopy(data)

    def get(self, transaction: Any = None, **_: Any) -> FakeSnapshot:
        self._client.check("get")
        return FakeSnapshot(self.id, self._store.get(self.id))

    def update(self, changes: Dict[str, Any]) -> None:
        self._client.check("update")
        if self.id not in self._store:
            raise gexc.NotFound("missing")
        self._store[self.id].update(copy.deepcopy(changes))


class FakeQuery:
    def __init__(self, client: "FakeFirestore", collection: str):
        self._client = client
        self._collection = collection
        self._filters: List[Tuple[str, str, Any]] = []
        self._order: Optional[Tuple[str, str]] = None
        self._after: Optional[FakeSnapshot] = None
        self._limit: Optional[int] = None

    def _clone(self) -> "FakeQuery":
        clone = FakeQuery(self._client, self._collection)
        clone._filters, clone._order = list(self._filters), self._order
        clone._after, clone._limit = self._after, self._limit
        return clone

    def where(self, *, filter: Any) -> "FakeQuery":  # noqa: A002 - mirrors the real API
        clone = self._clone()
        clone._filters.append((filter.field_path, filter.op_string, filter.value))
        return clone

    def order_by(self, field: str, direction: str = "ASCENDING") -> "FakeQuery":
        clone = self._clone()
        clone._order = (field, direction)
        return clone

    def start_after(self, snapshot: FakeSnapshot) -> "FakeQuery":
        clone = self._clone()
        clone._after = snapshot
        return clone

    def limit(self, count: int) -> "FakeQuery":
        clone = self._clone()
        clone._limit = count
        return clone

    def stream(self, **_: Any) -> List[FakeSnapshot]:
        self._client.check("stream")
        rows = list(self._client.data.get(self._collection, {}).items())
        for field, op, value in self._filters:
            assert op == "==", "fake supports == only"
            rows = [(i, d) for i, d in rows if d.get(field) == value]
        if self._order:
            field, direction = self._order
            # Firestore adds the document name as the final tie-breaker, in the same direction.
            rows.sort(key=lambda r: (r[1].get(field), r[0]), reverse=direction == "DESCENDING")
        if self._after is not None:
            ids = [i for i, _ in rows]
            rows = rows[ids.index(self._after.id) + 1:] if self._after.id in ids else []
        if self._limit is not None:
            rows = rows[: self._limit]
        return [FakeSnapshot(i, d) for i, d in rows]


class FakeCollection(FakeQuery):
    def document(self, doc_id: Optional[str] = None) -> FakeDocRef:
        return FakeDocRef(self._client, self._collection, doc_id or uuid.uuid4().hex)


class FakeBatch:
    def __init__(self, client: "FakeFirestore"):
        self._client = client
        self._ops: List[Tuple[FakeDocRef, Dict[str, Any]]] = []

    def create(self, ref: FakeDocRef, data: Dict[str, Any]) -> None:
        self._ops.append((ref, data))

    def commit(self, **_: Any) -> None:
        self._client.check("batch_commit")
        for ref, _data in self._ops:  # all-or-nothing
            if ref.id in ref._store:
                raise gexc.AlreadyExists("document exists")
        for ref, data in self._ops:
            ref._store[ref.id] = copy.deepcopy(data)


class FakeTransaction:
    def __init__(self, client: "FakeFirestore"):
        self._client = client

    def update(self, ref: FakeDocRef, changes: Dict[str, Any]) -> None:
        self._client.check("transaction_write")
        ref.update(changes)

    def create(self, ref: FakeDocRef, data: Dict[str, Any]) -> None:
        self._client.check("transaction_write")
        ref.create(data)


class FakeFirestore:
    def __init__(self) -> None:
        self.data: Dict[str, Dict[str, Dict[str, Any]]] = {}
        self.failures: Dict[str, Exception] = {}

    def check(self, operation: str) -> None:
        if operation in self.failures:
            raise self.failures[operation]

    def collection(self, name: str) -> FakeCollection:
        return FakeCollection(self, name)

    def batch(self) -> FakeBatch:
        return FakeBatch(self)

    def transaction(self) -> FakeTransaction:
        return FakeTransaction(self)


# ---------------------------------------------------------------------- #
# Fake storage service (service-level interface)
# ---------------------------------------------------------------------- #
class FakeStorage:
    bucket_name = "test-bucket"

    def __init__(self) -> None:
        self.objects: Dict[str, Tuple[bytes, int]] = {}
        self.failures: Dict[str, Exception] = {}
        self._generation = 1000
        self.deleted: List[str] = []

    def upload_certificate_pdf(self, object_name: str, data: bytes) -> int:
        if "upload" in self.failures:
            raise self.failures["upload"]
        if object_name in self.objects:
            raise ConflictError("exists")
        self._generation += 1
        self.objects[object_name] = (data, self._generation)
        return self._generation

    def download_certificate_pdf(self, object_name: str) -> bytes:
        if object_name not in self.objects:
            raise NotFoundError("missing")
        return self.objects[object_name][0]

    def delete_object_if_generation_matches(self, object_name: str, generation: int) -> bool:
        if "delete" in self.failures:
            raise self.failures["delete"]
        entry = self.objects.get(object_name)
        if entry is None or entry[1] != generation:
            return False
        del self.objects[object_name]
        self.deleted.append(object_name)
        return True

    def generate_download_url(self, object_name: str, *, filename: str, expiration_minutes: Optional[int] = None):
        if "signed_url" in self.failures:
            raise self.failures["signed_url"]
        minutes = expiration_minutes or 10
        return (
            f"https://storage.example/signed/{object_name}?X-Goog-Expires={minutes * 60}",
            datetime.now(timezone.utc).replace(microsecond=0) + timedelta(minutes=minutes),
        )


class Clock:
    """Controllable clock injected into the service."""

    def __init__(self) -> None:
        self.now = utc_now()

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **kwargs: int) -> None:
        self.now = self.now + timedelta(**kwargs)


# ---------------------------------------------------------------------- #
# Fixtures
# ---------------------------------------------------------------------- #
@pytest.fixture(scope="session")
def signer() -> LocalDevSigner:
    return LocalDevSigner()  # generating an RSA key is slow; share one per test session


@pytest.fixture()
def settings() -> Settings:
    return make_settings()


@pytest.fixture()
def crypto(signer: LocalDevSigner) -> CryptoService:
    return CryptoService(signer)


@pytest.fixture()
def firestore_client() -> FakeFirestore:
    return FakeFirestore()


@pytest.fixture()
def repo(settings: Settings, firestore_client: FakeFirestore) -> FirestoreRepository:
    return FirestoreRepository(
        settings,
        client=firestore_client,
        transaction_runner=lambda client, func: func(client.transaction()),
    )


@pytest.fixture()
def storage() -> FakeStorage:
    return FakeStorage()


@pytest.fixture()
def clock() -> Clock:
    return Clock()


@pytest.fixture()
def audit(repo: FirestoreRepository) -> AuditService:
    return AuditService(repo)


@pytest.fixture()
def service(settings, repo, storage, crypto, audit, clock) -> CertificateService:
    return CertificateService(settings, repo, storage, crypto, audit, pdf_service=PdfService(), clock=clock)


@pytest.fixture()
def admin() -> AdminPrincipal:
    return AdminPrincipal(uid="uid-admin", email="admin@example.com")


def valid_request(**overrides: Any) -> CreateCertificateRequest:
    payload = {
        "recipient_name": "Asha Verma",
        "recipient_email": "asha@example.com",
        "course_name": "Cloud Architecture Fundamentals",
        "organization_name": "Example Academy",
    }
    payload.update(overrides)
    return CreateCertificateRequest(**payload)


@pytest.fixture()
def issued(service, admin, storage):
    """An issued certificate: (create result, stored PDF bytes)."""
    result = service.create_certificate(valid_request(), admin)
    pdf = storage.objects[f"certificates/{result['certificate_id']}.pdf"][0]
    return result, pdf


def fake_namespace(**kwargs: Any) -> SimpleNamespace:
    return SimpleNamespace(**kwargs)
