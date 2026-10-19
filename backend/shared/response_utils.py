"""Safe, consistent HTTP responses and the endpoint decorator.

Every response is JSON.  Errors share one shape::

    {"error": {"code": "...", "message": "...", "details": [...], "request_id": "..."}}

Stack traces, internal messages and infrastructure details are never returned.
"""

# Handles HTTP responses, errors, CORS and common request-processing behavior.

from __future__ import annotations

import functools
import json
import logging
import os
import time
import uuid
from typing import Any, Callable, Dict, Iterable, Mapping, Optional, Tuple

from shared.exceptions import AppError, MethodNotAllowedError, NotFoundError
from shared.logging_utils import get_logger, log_event

logger = get_logger("certificate.api")

_BASE_HEADERS = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
}

FlaskResponse = Tuple[str, int, Dict[str, str]]


def get_request_id(request: Any) -> str:
    trace = request.headers.get("X-Cloud-Trace-Context", "")
    trace_id = trace.split("/")[0].strip()
    if trace_id and len(trace_id) <= 64 and trace_id.isalnum():
        return trace_id
    return uuid.uuid4().hex


def _allowed_origins() -> Tuple[str, ...]:
    raw = os.environ.get("CORS_ALLOWED_ORIGINS", "")
    return tuple(o.strip() for o in raw.split(",") if o.strip())


#: Methods used anywhere in the API.  A preflight for e.g. POST /admin/certificates
#: may be answered by a different function than the one handling the POST, so the
#: advertised list is API-wide rather than per function.
API_METHODS = ("GET", "POST", "PATCH", "OPTIONS")


def cors_headers(request: Any, methods: Iterable[str] = API_METHODS) -> Dict[str, str]:
    """CORS headers for the configured origins (none are sent by default)."""
    origins = _allowed_origins()
    origin = request.headers.get("Origin")
    if not origin or not origins:
        return {}
    if "*" in origins:
        allow_origin = "*"
    elif origin in origins:
        allow_origin = origin
    else:
        return {}
    return {
        "Access-Control-Allow-Origin": allow_origin,
        "Vary": "Origin",
        "Access-Control-Allow-Methods": ", ".join(API_METHODS),
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "3600",
    }


def json_response(
    body: Any, status: int = 200, headers: Optional[Mapping[str, str]] = None
) -> FlaskResponse:
    merged = {**_BASE_HEADERS, **(headers or {})}
    return json.dumps(body, ensure_ascii=False, default=str), status, merged


def error_response(
    error: AppError, request_id: str, headers: Optional[Mapping[str, str]] = None
) -> FlaskResponse:
    payload: Dict[str, Any] = {
        "error": {
            "code": error.error_code,
            "message": error.public_message,
            "request_id": request_id,
        }
    }
    if error.details is not None and error.expose_message:
        payload["error"]["details"] = error.details
    return json_response(payload, error.status_code, {**error.headers, **(headers or {})})


def match_route(path: str, pattern: "Any") -> Optional["Any"]:
    """Match ``path`` (trailing slash tolerated) against a compiled regex."""
    return pattern.match(path.rstrip("/") or "/")


def require_route(path: str, pattern: "Any") -> "Any":
    match = match_route(path, pattern)
    if match is None:
        raise NotFoundError("Route not found.")
    return match


def api_endpoint(*, name: str, methods: Tuple[str, ...]) -> Callable[[Callable[[Any], Any]], Callable[[Any], FlaskResponse]]:
    """Decorator turning ``handler(request) -> (body, status[, headers])`` into a safe endpoint.

    Handles CORS preflight, method checks, request IDs, structured request logs
    and the translation of every exception into a sanitised JSON error.
    """

    def decorator(handler: Callable[[Any], Any]) -> Callable[[Any], FlaskResponse]:
        @functools.wraps(handler)
        def wrapper(request: Any) -> FlaskResponse:
            started = time.monotonic()
            request_id = get_request_id(request)
            cors = cors_headers(request)
            extra = {"X-Request-Id": request_id, **cors}
            status = 500
            try:
                if request.method == "OPTIONS":
                    status = 204
                    return "", 204, {**extra, "Allow": ", ".join([*methods, "OPTIONS"])}
                if request.method not in methods:
                    raise MethodNotAllowedError(headers={"Allow": ", ".join([*methods, "OPTIONS"])})
                result = handler(request)
                body, status = result[0], result[1]
                response_headers = {**extra, **(result[2] if len(result) > 2 else {})}
                return json_response(body, status, response_headers)
            except AppError as exc:
                status = exc.status_code
                if status >= 500:
                    log_event(
                        logger, logging.ERROR, "request_failed", function=name, request_id=request_id,
                        error_code=exc.error_code, internal_message=exc.message, exc_info=True,
                    )
                return error_response(exc, request_id, extra)
            except Exception:  # noqa: BLE001 - last line of defence, never leak details
                status = 500
                log_event(
                    logger, logging.ERROR, "unhandled_exception", function=name,
                    request_id=request_id, exc_info=True,
                )
                return error_response(AppError(), request_id, extra)
            finally:
                log_event(
                    logger, logging.INFO, "request_completed", function=name, method=request.method,
                    status=status, request_id=request_id,
                    duration_ms=int((time.monotonic() - started) * 1000),
                )

        return wrapper

    return decorator
