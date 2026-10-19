"""Administrator authentication (Identity Platform ID tokens) and authorisation.

Authentication: the bearer token is verified with the Firebase Admin SDK
(signature, issuer, audience = ``IDENTITY_PLATFORM_PROJECT_ID``, expiry).

Authorisation: a valid token is **not** enough.  The caller must either

* carry the custom claim ``admin: true`` (set server-side with
  ``scripts/grant_admin_claim.py``), or
* have a *verified* email that appears in the ``ADMIN_EMAILS`` allow-list.

Roles/emails/user IDs submitted in request bodies are never consulted.

Behind API Gateway the original ``Authorization`` header is moved to
``X-Forwarded-Authorization`` (the gateway's own token replaces it), so that
header is preferred when present.
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Mapping, Optional

from shared.exceptions import CloudServiceError, ForbiddenError, UnauthorizedError
from shared.logging_utils import get_logger, log_event
from shared.models import AdminPrincipal

logger = get_logger("certificate.auth")

TokenVerifier = Callable[[str], Mapping[str, Any]]


def extract_bearer_token(headers: Mapping[str, str]) -> str:
    """Return the bearer token from ``X-Forwarded-Authorization`` or ``Authorization``."""
    for header in ("X-Forwarded-Authorization", "Authorization"):
        value = headers.get(header)
        if value:
            parts = value.strip().split(None, 1)
            if len(parts) == 2 and parts[0].lower() == "bearer" and parts[1].strip():
                return parts[1].strip()
            break
    raise UnauthorizedError(
        "A valid bearer token is required.", headers={"WWW-Authenticate": 'Bearer realm="certificates"'}
    )


class AuthService:
    def __init__(self, settings: Any, token_verifier: Optional[TokenVerifier] = None) -> None:
        self._settings = settings
        self._verifier = token_verifier
        self._admin_emails = frozenset(settings.admin_emails)

    # ------------------------------------------------------------------ #
    def _get_verifier(self) -> TokenVerifier:
        if self._verifier is None:
            self._verifier = self._build_firebase_verifier()
        return self._verifier

    def _build_firebase_verifier(self) -> TokenVerifier:
        import firebase_admin
        from firebase_admin import auth as fb_auth

        try:
            app = firebase_admin.get_app()
        except ValueError:
            # Uses Application Default Credentials / the runtime service account.
            app = firebase_admin.initialize_app(
                options={"projectId": self._settings.identity_platform_project_id}
            )

        def verify(token: str) -> Mapping[str, Any]:
            try:
                return fb_auth.verify_id_token(token, app=app)
            except fb_auth.CertificateFetchError as exc:
                raise CloudServiceError("Could not fetch token signing certificates") from exc
            except (ValueError, fb_auth.InvalidIdTokenError) as exc:
                raise UnauthorizedError(
                    "The credentials are invalid or have expired.",
                    headers={"WWW-Authenticate": 'Bearer error="invalid_token"'},
                ) from exc

        return verify

    # ------------------------------------------------------------------ #
    def authenticate_admin(self, headers: Mapping[str, str]) -> AdminPrincipal:
        """Return the verified administrator or raise 401 / 403."""
        token = extract_bearer_token(headers)
        try:
            claims = self._get_verifier()(token)
        except UnauthorizedError as exc:
            log_event(logger, logging.WARNING, "authentication_failed")
            raise UnauthorizedError(
                exc.message, headers={"WWW-Authenticate": 'Bearer error="invalid_token"', **exc.headers}
            ) from exc
        except CloudServiceError:
            log_event(logger, logging.WARNING, "authentication_failed")
            raise
        except Exception as exc:  # unexpected verifier failure -> treat as unauthenticated
            log_event(logger, logging.WARNING, "authentication_failed", error_type=type(exc).__name__)
            raise UnauthorizedError(
                "The credentials are invalid or have expired.",
                headers={"WWW-Authenticate": 'Bearer error="invalid_token"'},
            ) from exc

        uid = claims.get("uid") or claims.get("user_id") or claims.get("sub")
        if not uid or not isinstance(uid, str):
            log_event(logger, logging.WARNING, "authentication_failed", reason="missing_uid")
            raise UnauthorizedError("The credentials are invalid.")

        email = claims.get("email")
        email = email.lower() if isinstance(email, str) else None
        has_admin_claim = claims.get("admin") is True
        allow_listed = bool(
            email and claims.get("email_verified") is True and email in self._admin_emails
        )
        if not (has_admin_claim or allow_listed):
            log_event(logger, logging.WARNING, "unauthorized_admin_access", uid=uid)
            raise ForbiddenError("This account is not authorised to administer certificates.")
        return AdminPrincipal(uid=uid, email=email)
