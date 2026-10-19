"""Structured (JSON) logging compatible with Google Cloud Logging.

Cloud Run functions forward stdout to Cloud Logging; JSON lines containing
``severity`` and ``message`` become structured log entries.  Sensitive keys
are always dropped before a field reaches the log line.

This file is used to format the logs and everytime any sensitive information is dropped before the log happens
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone
from typing import Any, Dict

_SENSITIVE_KEYS = frozenset(
    {
        "authorization",
        "x-forwarded-authorization",
        "token",
        "id_token",
        "access_token",
        "password",
        "secret",
        "private_key",
        "pdf_bytes",
        "pdf",
        "signature",
    }
)
_MAX_FIELD_LENGTH = 500
_HANDLER_FLAG = "_certificate_json_handler"


def _sanitize(fields: Dict[str, Any]) -> Dict[str, Any]:
    clean: Dict[str, Any] = {}
    for key, value in fields.items():
        if key.lower() in _SENSITIVE_KEYS:
            continue
        if isinstance(value, (bytes, bytearray)):
            clean[key] = f"<{len(value)} bytes>"
        elif isinstance(value, str) and len(value) > _MAX_FIELD_LENGTH:
            clean[key] = value[:_MAX_FIELD_LENGTH] + "...[truncated]"
        else:
            clean[key] = value
    return clean


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: Dict[str, Any] = {
            "severity": record.levelname,
            "message": record.getMessage(),
            "logger": record.name,
            "time": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
        }
        fields = getattr(record, "fields", None)
        if isinstance(fields, dict):
            payload.update(_sanitize(fields))
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str, ensure_ascii=False)


def configure_logging(level: str = "INFO") -> None:
    """Install the JSON handler on the root logger (idempotent)."""
    root = logging.getLogger()
    root.setLevel(level.upper())
    for handler in list(root.handlers):
        if getattr(handler, _HANDLER_FLAG, False):
            root.removeHandler(handler)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    setattr(handler, _HANDLER_FLAG, True)
    root.addHandler(handler)


def get_logger(name: str = "certificate") -> logging.Logger:
    return logging.getLogger(name)


def log_event(
    logger: logging.Logger,
    level: int,
    event: str,
    *,
    exc_info: bool = False,
    **fields: Any,
) -> None:
    """Emit one structured log entry named ``event`` with extra ``fields``."""
    logger.log(level, event, exc_info=exc_info, extra={"fields": {"event": event, **fields}})
