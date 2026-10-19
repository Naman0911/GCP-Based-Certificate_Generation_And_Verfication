"""Audit trail: durable events in Firestore plus structured log entries.

Audit events never contain secrets, tokens, PDF content or recipient personal
data - only the actor, the action, the target certificate ID and the outcome.
High-volume, unauthenticated events (public verification, rejected requests)
are written to Cloud Logging only, not to Firestore.
"""
# This is used to log the important events such as Certifcate generation , revokation and Verification


from __future__ import annotations

import logging
from typing import Any, Dict, Mapping, Optional

from shared.logging_utils import get_logger, log_event
from shared.models import AdminPrincipal, utc_now

logger = get_logger("certificate.audit")

CERTIFICATE_CREATED = "CERTIFICATE_CREATED"
CERTIFICATE_REVOKED = "CERTIFICATE_REVOKED"
DOWNLOAD_URL_ISSUED = "DOWNLOAD_URL_ISSUED"
STATUS_MATERIALISED = "STATUS_MATERIALISED"

_MAX_DETAIL_LENGTH = 200


def _clean_details(details: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
    clean: Dict[str, Any] = {}
    for key, value in (details or {}).items():
        if isinstance(value, (bool, int, float)) or value is None:
            clean[str(key)] = value
        else:
            clean[str(key)] = str(value)[:_MAX_DETAIL_LENGTH]
    return clean


class AuditService:
    def __init__(self, repository: Any) -> None:
        self._repository = repository

    def build_event(
        self,
        event_type: str,
        actor: Optional[AdminPrincipal],
        certificate_id: Optional[str],
        *,
        outcome: str = "SUCCESS",
        details: Optional[Mapping[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Build an event document (used for atomic writes with the data change)."""
        return {
            "event_type": event_type,
            "actor_uid": actor.uid if actor else None,
            "actor_email": actor.email if actor else None,
            "certificate_id": certificate_id,
            "outcome": outcome,
            "details": _clean_details(details),
            "created_at": utc_now(),
        }

    def log_written(self, event: Mapping[str, Any]) -> None:
        """Emit the structured log line for an event persisted elsewhere."""
        log_event(
            logger,
            logging.INFO,
            "audit_event",
            event_type=event["event_type"],
            actor_uid=event.get("actor_uid"),
            certificate_id=event.get("certificate_id"),
            outcome=event.get("outcome"),
        )

    def record(
        self,
        event_type: str,
        actor: Optional[AdminPrincipal],
        certificate_id: Optional[str],
        *,
        outcome: str = "SUCCESS",
        details: Optional[Mapping[str, Any]] = None,
    ) -> bool:
        """Persist an audit event (best effort).  Returns whether it was stored.

        A failure to write the audit trail is logged at ERROR level and does not
        undo the already-completed action.
        """
        event = self.build_event(event_type, actor, certificate_id, outcome=outcome, details=details)
        try:
            self._repository.record_audit_event(event)
        except Exception as exc:  # noqa: BLE001 - audit must not break the request
            log_event(
                logger,
                logging.ERROR,
                "audit_write_failed",
                event_type=event_type,
                certificate_id=certificate_id,
                error_type=type(exc).__name__,
            )
            return False
        self.log_written(event)
        return True
