"""Firestore access layer (the only primary database).

Firestore is used to store the metadata for any certificates not an actual certificate bytes

Collections
-----------
``certificates``  document ID = ``certificate_id``; metadata, hashes, signatures,
                  status and storage reference (never PDF bytes).
``audit_events``  append-only audit trail (auto IDs).

All writes use create-only semantics, batches or transactions.
"""
# This file is used to Create , Retrives , Revoke and list the Certificate's metadata and also use for writing the audit logs


from __future__ import annotations

import base64
import binascii
import logging
from contextlib import contextmanager
from datetime import datetime
from typing import Any, Callable, Dict, Iterator, List, Mapping, Optional, Tuple

from google.api_core import exceptions as gexc

from shared.exceptions import (
    AppError,
    CloudServiceError,
    ConflictError,
    NotFoundError,
    ValidationFailedError,
)
from shared.logging_utils import get_logger, log_event
from shared.models import CertificateStatus, utc_now
from shared.validators import CERTIFICATE_ID_RE

logger = get_logger("certificate.repository")

CERTIFICATES_COLLECTION = "certificates"
AUDIT_COLLECTION = "audit_events"

TransactionRunner = Callable[[Any, Callable[[Any], Any]], Any]


def default_transaction_runner(client: Any, func: Callable[[Any], Any]) -> Any:
    """Run ``func(transaction)`` in a Firestore transaction (automatic retries)."""
    from google.cloud import firestore

    transaction = client.transaction()
    return firestore.transactional(func)(transaction)


def encode_page_token(certificate_id: str) -> str:
    return base64.urlsafe_b64encode(certificate_id.encode("ascii")).decode("ascii").rstrip("=")


def decode_page_token(token: str) -> str:
    try:
        padded = token + "=" * (-len(token) % 4)
        value = base64.urlsafe_b64decode(padded.encode("ascii")).decode("ascii")
    except (binascii.Error, UnicodeError, ValueError) as exc:
        raise ValidationFailedError(
            "The page token is invalid.", details=[{"field": "page_token", "message": "is invalid"}]
        ) from exc
    if not CERTIFICATE_ID_RE.match(value):
        raise ValidationFailedError(
            "The page token is invalid.", details=[{"field": "page_token", "message": "is invalid"}]
        )
    return value


@contextmanager
def _translate_errors(operation: str) -> Iterator[None]:
    """Map Google API errors to application errors without leaking details."""
    try:
        yield
    except AppError:
        raise
    except gexc.AlreadyExists as exc:
        raise ConflictError("The resource already exists.") from exc
    except (gexc.GoogleAPICallError, gexc.RetryError) as exc:
        log_event(logger, logging.ERROR, "firestore_error", operation=operation, error_type=type(exc).__name__)
        raise CloudServiceError(f"Firestore {operation} failed") from exc


class FirestoreRepository:
    def __init__(
        self,
        settings: Any,
        client: Any = None,
        transaction_runner: Optional[TransactionRunner] = None,
        timeout: float = 15.0,
    ) -> None:
        self._settings = settings
        self._client = client
        self._runner = transaction_runner or default_transaction_runner
        self._timeout = timeout

    @property
    def client(self) -> Any:
        if self._client is None:
            from google.cloud import firestore

            self._client = firestore.Client(
                project=self._settings.google_cloud_project,
                database=self._settings.firestore_database,
            )
        return self._client

    def _certificates(self) -> Any:
        return self.client.collection(CERTIFICATES_COLLECTION)

    def _audit_ref(self) -> Any:
        return self.client.collection(AUDIT_COLLECTION).document()

    # ------------------------------------------------------------------ #
    def create_certificate_record(
        self, record: Mapping[str, Any], audit_event: Optional[Mapping[str, Any]] = None
    ) -> None:
        """Create a certificate document (and its audit event atomically).

        Raises :class:`ConflictError` if the ID already exists (never overwrites).
        """
        doc_ref = self._certificates().document(record["certificate_id"])
        with _translate_errors("create"):
            if audit_event is None:
                doc_ref.create(dict(record), timeout=self._timeout)
            else:
                batch = self.client.batch()
                batch.create(doc_ref, dict(record))
                batch.create(self._audit_ref(), dict(audit_event))
                batch.commit(timeout=self._timeout)

    def get_certificate_by_id(self, certificate_id: str) -> Optional[Dict[str, Any]]:
        with _translate_errors("get"):
            snapshot = self._certificates().document(certificate_id).get(timeout=self._timeout)
            return snapshot.to_dict() if snapshot.exists else None

    def list_certificates(
        self,
        *,
        page_size: int,
        page_token: Optional[str] = None,
        status: Optional[CertificateStatus] = None,
    ) -> Tuple[List[Dict[str, Any]], Optional[str]]:
        """Cursor-paginated listing, newest first.  Returns ``(records, next_token)``.

        The token is the ID of the last returned document; the query resumes
        *after* that document so ties on ``created_at`` never skip or repeat rows.
        Filtering by status uses the composite index in ``firestore.indexes.json``.
        """
        from google.cloud.firestore_v1.base_query import FieldFilter

        with _translate_errors("list"):
            query = self._certificates()
            if status is not None:
                query = query.where(filter=FieldFilter("status", "==", status.value))
            query = query.order_by("created_at", direction="DESCENDING")
            if page_token:
                cursor_id = decode_page_token(page_token)
                cursor = self._certificates().document(cursor_id).get(timeout=self._timeout)
                if not cursor.exists:
                    raise ValidationFailedError(
                        "The page token is invalid.",
                        details=[{"field": "page_token", "message": "is invalid"}],
                    )
                query = query.start_after(cursor)
            documents = list(query.limit(page_size + 1).stream(timeout=self._timeout))
        has_more = len(documents) > page_size
        page = documents[:page_size]
        records = [doc.to_dict() for doc in page]
        next_token = encode_page_token(page[-1].id) if has_more and page else None
        return records, next_token

    def revoke_certificate(
        self,
        certificate_id: str,
        *,
        revoked_by: str,
        reason: str,
        revoked_at: Optional[datetime] = None,
        audit_event: Optional[Mapping[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Atomically mark a certificate REVOKED (transaction; safe under concurrency).

        Raises :class:`NotFoundError` or :class:`ConflictError` (already revoked).
        The PDF object and the record are preserved.
        """
        doc_ref = self._certificates().document(certificate_id)
        timestamp = revoked_at or utc_now()

        def _revoke(transaction: Any) -> Dict[str, Any]:
            snapshot = doc_ref.get(transaction=transaction)
            if not snapshot.exists:
                raise NotFoundError("Certificate not found.")
            current = snapshot.to_dict()
            if current.get("status") == CertificateStatus.REVOKED.value:
                raise ConflictError("The certificate is already revoked.")
            changes = {
                "status": CertificateStatus.REVOKED.value,
                "revoked_at": timestamp,
                "revoked_by": revoked_by,
                "revocation_reason": reason,
            }
            transaction.update(doc_ref, changes)
            if audit_event is not None:
                transaction.create(self._audit_ref(), dict(audit_event))
            return {**current, **changes}

        with _translate_errors("revoke"):
            return self._runner(self.client, _revoke)

    def update_certificate_status(self, certificate_id: str, new_status: CertificateStatus) -> bool:
        """Persist VALID -> EXPIRED (a REVOKED certificate can never be changed here).

        Returns ``True`` if the document changed.
        """
        if new_status == CertificateStatus.REVOKED:
            raise ValidationFailedError("Use revoke_certificate to revoke a certificate.")
        doc_ref = self._certificates().document(certificate_id)

        def _update(transaction: Any) -> bool:
            snapshot = doc_ref.get(transaction=transaction)
            if not snapshot.exists:
                raise NotFoundError("Certificate not found.")
            current = snapshot.to_dict().get("status")
            if current == CertificateStatus.REVOKED.value:
                raise ConflictError("A revoked certificate cannot change status.")
            if current == new_status.value:
                return False
            transaction.update(doc_ref, {"status": new_status.value})
            return True

        with _translate_errors("update_status"):
            return self._runner(self.client, _update)

    def record_audit_event(self, event: Mapping[str, Any]) -> str:
        """Append an audit event; returns its document ID."""
        ref = self._audit_ref()
        with _translate_errors("audit"):
            ref.create(dict(event), timeout=self._timeout)
        return ref.id
