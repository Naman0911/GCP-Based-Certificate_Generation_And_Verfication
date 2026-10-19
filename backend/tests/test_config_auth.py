"""Configuration validation and administrator authentication."""

import pytest

from shared.auth_service import AuthService, extract_bearer_token
from shared.config import Settings
from shared.exceptions import CloudServiceError, ConfigurationError, ForbiddenError, UnauthorizedError
from tests.conftest import BASE_ENV, make_settings


# ---- configuration --------------------------------------------------- #
def test_settings_load_and_derive_values():
    s = make_settings(MAX_UPLOAD_SIZE_MB="5", ADMIN_EMAILS="A@Example.com, b@example.com")
    assert s.max_upload_bytes == 5 * 1024 * 1024
    assert s.admin_emails == ("a@example.com", "b@example.com")
    assert s.kms_key_version_name == "projects/test-project/locations/us-central1/keyRings/ring/cryptoKeys/key/cryptoKeyVersions/1"
    assert s.public_verification_base_url == "https://certs.example.com/verify"


@pytest.mark.parametrize("missing", ["GOOGLE_CLOUD_PROJECT", "GCS_BUCKET_NAME", "KMS_KEY_NAME", "PUBLIC_VERIFICATION_BASE_URL"])
def test_missing_required_variable_names_the_variable(missing):
    env = {k: v for k, v in BASE_ENV.items() if k != missing}
    with pytest.raises(ConfigurationError) as exc:
        Settings.from_env(env)
    assert missing in exc.value.message


@pytest.mark.parametrize("name,value", [
    ("PUBLIC_VERIFICATION_BASE_URL", "javascript:alert(1)"), ("PUBLIC_VERIFICATION_BASE_URL", "https://x.com/v?a=1"),
    ("KMS_KEY_VERSION", "latest"), ("MAX_UPLOAD_SIZE_MB", "0"), ("MAX_UPLOAD_SIZE_MB", "500"),
    ("ENVIRONMENT", "qa"), ("GCS_BUCKET_NAME", "UPPER_case"), ("ADMIN_EMAILS", "not-an-email"),
    ("SIGNED_URL_EXPIRATION_MINUTES", "0"),
])
def test_invalid_values_rejected_without_echoing_them(name, value):
    with pytest.raises(ConfigurationError) as exc:
        Settings.from_env({**BASE_ENV, name: value})
    assert name in exc.value.message and value not in exc.value.message


def test_production_forbids_local_signer_and_plain_http():
    with pytest.raises(ConfigurationError):
        make_settings(ENVIRONMENT="production", USE_LOCAL_DEV_SIGNER="true")
    with pytest.raises(ConfigurationError):
        make_settings(ENVIRONMENT="production", USE_LOCAL_DEV_SIGNER="false", PUBLIC_VERIFICATION_BASE_URL="http://x.example.com/v")
    assert make_settings(ENVIRONMENT="production", USE_LOCAL_DEV_SIGNER="false").is_production


def test_local_dev_signer_refuses_to_run_in_production(monkeypatch):
    from shared.dev_signer import LocalDevSigner
    monkeypatch.setenv("ENVIRONMENT", "production")
    with pytest.raises(ConfigurationError):
        LocalDevSigner()


def test_dev_signer_is_stripped_from_deployments():
    script = open("scripts/deploy_functions.sh", encoding="utf-8").read()
    assert "rm -f \"${stage}/shared/dev_signer.py\"" in script


# ---- authentication / authorisation ---------------------------------- #
def verifier(claims_by_token):
    def verify(token):
        if token not in claims_by_token:
            raise UnauthorizedError("invalid")
        return claims_by_token[token]
    return verify


CLAIMS = {
    "admin-token": {"uid": "u1", "email": "admin@example.com", "email_verified": True},
    "unverified": {"uid": "u2", "email": "admin@example.com", "email_verified": False},
    "stranger": {"uid": "u3", "email": "stranger@example.com", "email_verified": True},
    "claim-admin": {"uid": "u4", "email": "other@example.com", "email_verified": False, "admin": True},
    "claim-string": {"uid": "u5", "email": "other@example.com", "email_verified": True, "admin": "true"},
    "no-uid": {"email": "admin@example.com", "email_verified": True},
    "upper": {"uid": "u6", "email": "ADMIN@EXAMPLE.COM", "email_verified": True},
}


@pytest.fixture()
def auth():
    return AuthService(make_settings(), token_verifier=verifier(CLAIMS))


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def test_allow_listed_verified_email_is_admin(auth):
    principal = auth.authenticate_admin(bearer("admin-token"))
    assert (principal.uid, principal.email) == ("u1", "admin@example.com")
    assert auth.authenticate_admin(bearer("upper")).uid == "u6"


def test_admin_custom_claim_is_enough(auth):
    assert auth.authenticate_admin(bearer("claim-admin")).uid == "u4"


@pytest.mark.parametrize("token", ["unverified", "stranger", "claim-string"])
def test_authenticated_non_admins_are_forbidden(auth, token):
    with pytest.raises(ForbiddenError):
        auth.authenticate_admin(bearer(token))


def test_token_without_uid_is_unauthorized(auth):
    with pytest.raises(UnauthorizedError):
        auth.authenticate_admin(bearer("no-uid"))


@pytest.mark.parametrize("headers", [{}, {"Authorization": ""}, {"Authorization": "Basic abc"},
                                     {"Authorization": "Bearer"}, {"Authorization": "Bearer   "}, bearer("bogus")])
def test_missing_or_invalid_tokens_are_unauthorized(auth, headers):
    with pytest.raises(UnauthorizedError) as exc:
        auth.authenticate_admin(headers)
    assert "WWW-Authenticate" in exc.value.headers


def test_forwarded_header_from_api_gateway_is_preferred(auth):
    headers = {"Authorization": "Bearer gateway-google-token", "X-Forwarded-Authorization": "Bearer admin-token"}
    assert auth.authenticate_admin(headers).uid == "u1"
    assert extract_bearer_token(headers) == "admin-token"


def test_unexpected_verifier_errors_are_unauthorized_and_infra_errors_propagate():
    def boom(token):
        raise RuntimeError("x")

    with pytest.raises(UnauthorizedError):
        AuthService(make_settings(), token_verifier=boom).authenticate_admin(bearer("t"))

    def infra(token):
        raise CloudServiceError("certs")

    with pytest.raises(CloudServiceError):
        AuthService(make_settings(), token_verifier=infra).authenticate_admin(bearer("t"))


def test_emails_in_the_body_or_headers_are_never_trusted(auth):
    headers = {**bearer("stranger"), "X-User-Email": "admin@example.com", "X-Admin": "true"}
    with pytest.raises(ForbiddenError):
        auth.authenticate_admin(headers)
