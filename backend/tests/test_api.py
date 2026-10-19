"""HTTP layer: function entry points, auth, errors, CORS, and OpenAPI/deployment consistency."""

from __future__ import annotations

import importlib.util
import io
import json
import re
import subprocess
import sys
from pathlib import Path

import flask
import pytest
import yaml

from shared.auth_service import AuthService
from shared.container import Services, set_services
from shared.exceptions import CloudServiceError, UnauthorizedError

ROOT = Path(__file__).resolve().parent.parent
FUNCTIONS = ["create_certificate", "verify_certificate", "verify_certificate_file", "list_certificates",
             "get_certificate", "revoke_certificate", "download_certificate"]
SAMPLE_ID = "CERT-2026-0123456789ABCDEF0123"
MISSING_ID = "CERT-2026-FFFFFFFFFFFFFFFFFFFF"
ADMIN = {"Authorization": "Bearer admin-token"}
STRANGER = {"Authorization": "Bearer stranger"}
APP = flask.Flask("tests")

CLAIMS = {
    "admin-token": {"uid": "uid-admin", "email": "admin@example.com", "email_verified": True},
    "stranger": {"uid": "uid-x", "email": "stranger@example.com", "email_verified": True},
}


def _verifier(token):
    if token not in CLAIMS:
        raise UnauthorizedError("invalid")
    return CLAIMS[token]


_modules = {}


def load(name):
    if name not in _modules:
        spec = importlib.util.spec_from_file_location(f"fn_{name}", ROOT / "functions" / name / "main.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _modules[name] = module
    return _modules[name]


@pytest.fixture(autouse=True)
def wired_services(settings, service, audit):
    set_services(Services(settings=settings, auth=AuthService(settings, token_verifier=_verifier),
                          certificates=service, audit=audit))
    yield
    set_services(None)


def call(name, method, path, *, headers=None, body=None, raw=None, content_type=None, query=None):
    kwargs = {"method": method, "headers": headers or {}, "query_string": query}
    if body is not None:
        kwargs.update(json=body)
    elif raw is not None:
        kwargs.update(data=raw, content_type=content_type)
    with APP.test_request_context(path, **kwargs):
        text, status, response_headers = getattr(load(name), name)(flask.request)
    return status, (json.loads(text) if text else None), response_headers


def multipart(pdf, filename="certificate.pdf"):
    return {"raw": {"file": (io.BytesIO(pdf), filename)}, "content_type": "multipart/form-data"}


# ---------------------------------------------------------------------- #
# Authentication / authorisation of every admin route
# ---------------------------------------------------------------------- #
ADMIN_ROUTES = [
    ("create_certificate", "POST", "/admin/certificates", {"json": {}}),
    ("list_certificates", "GET", "/admin/certificates", {}),
    ("get_certificate", "GET", f"/admin/certificates/{SAMPLE_ID}", {}),
    ("revoke_certificate", "PATCH", f"/admin/certificates/{SAMPLE_ID}/revoke", {"json": {"reason": "x" * 5}}),
    ("download_certificate", "GET", f"/admin/certificates/{SAMPLE_ID}/download", {}),
]


@pytest.mark.parametrize("name,method,path,extra", ADMIN_ROUTES)
def test_admin_routes_reject_missing_invalid_and_non_admin_tokens(name, method, path, extra):
    body = extra.get("json")
    status, payload, headers = call(name, method, path, body=body)
    assert status == 401 and payload["error"]["code"] == "unauthorized" and "WWW-Authenticate" in headers
    assert call(name, method, path, body=body, headers={"Authorization": "Bearer nonsense"})[0] == 401
    status, payload, _ = call(name, method, path, body=body, headers=STRANGER)
    assert status == 403 and payload["error"]["code"] == "forbidden"


def test_unauthorised_requests_have_no_side_effects(firestore_client, storage):
    call("create_certificate", "POST", "/admin/certificates", headers=STRANGER,
         body={"recipient_name": "A", "course_name": "B", "organization_name": "C"})
    assert not firestore_client.data.get("certificates") and not storage.objects


# ---------------------------------------------------------------------- #
# Create
# ---------------------------------------------------------------------- #
def create_via_api(**overrides):
    body = {"recipient_name": "Asha Verma", "recipient_email": "asha@example.com",
            "course_name": "Cloud Architecture", "organization_name": "Example Academy", **overrides}
    return call("create_certificate", "POST", "/admin/certificates", headers=ADMIN, body=body)


def test_create_returns_201_with_safe_metadata_and_download(storage):
    status, payload, headers = create_via_api()
    assert status == 201 and payload["certificate"]["status"] == "VALID"
    assert payload["verification_url"].endswith(payload["certificate_id"])
    assert payload["download"]["url"].startswith("https://") and payload["download_path"].endswith("/download")
    assert headers["Cache-Control"] == "no-store" and headers["X-Request-Id"]
    assert headers["Content-Type"].startswith("application/json")
    assert "pdf_signature" not in json.dumps(payload) and "storage_bucket" not in json.dumps(payload)
    assert len(storage.objects) == 1


def test_create_validation_errors_are_422_with_field_details():
    status, payload, _ = create_via_api(recipient_name="", recipient_email="bad")
    fields = {d["field"] for d in payload["error"]["details"]}
    assert status == 422 and payload["error"]["code"] == "validation_error" and {"recipient_name", "recipient_email"} <= fields


def test_create_ignores_identity_supplied_in_body():
    status, payload, _ = create_via_api(created_by="someone-else")
    assert status == 422


def test_create_records_the_token_identity_as_creator(firestore_client):
    _, payload, _ = create_via_api()
    assert firestore_client.data["certificates"][payload["certificate_id"]]["created_by"] == "uid-admin"


@pytest.mark.parametrize("raw,ctype,expected", [
    pytest.param(b"{not json", "application/json", 400, id="invalid-json"),
    pytest.param(b"", "application/json", 400, id="empty-body"),
    pytest.param(b"[1,2]", "application/json", 422, id="json-array"),
    pytest.param(b"x" * 40000, "application/json", 413, id="oversized-body"),
])
def test_create_malformed_bodies(raw, ctype, expected):
    status, payload, _ = call("create_certificate", "POST", "/admin/certificates", headers=ADMIN, raw=raw, content_type=ctype)
    assert status == expected and "error" in payload


# ---------------------------------------------------------------------- #
# Error behaviour
# ---------------------------------------------------------------------- #
def test_cloud_failures_return_generic_500_without_internals(storage):
    storage.failures["upload"] = CloudServiceError("bucket secret-bucket-name exploded at 10.0.0.5")
    status, payload, _ = create_via_api()
    text = json.dumps(payload)
    assert status == 500 and payload["error"]["code"] == "service_error" and payload["error"]["request_id"]
    assert "secret-bucket-name" not in text and "10.0.0.5" not in text and "Traceback" not in text


def test_unexpected_exceptions_return_generic_500(service, monkeypatch):
    def explode(*a, **k):
        raise RuntimeError("password=hunter2 /srv/app/main.py line 3")
    monkeypatch.setattr(service, "list_certificates", explode)
    status, payload, _ = call("list_certificates", "GET", "/admin/certificates", headers=ADMIN)
    text = json.dumps(payload)
    assert status == 500 and payload["error"]["code"] == "internal_error"
    assert "hunter2" not in text and "Traceback" not in text and "/srv/app" not in text


def test_method_not_allowed_and_unknown_route():
    status, payload, headers = call("create_certificate", "DELETE", "/admin/certificates", headers=ADMIN)
    assert status == 405 and "POST" in headers["Allow"]
    status, payload, _ = call("create_certificate", "POST", "/admin/other", headers=ADMIN, body={})
    assert status == 404 and payload["error"]["code"] == "not_found"


def test_cloud_trace_header_becomes_request_id():
    _, payload, headers = call("verify_certificate", "GET", f"/verify/{MISSING_ID}",
                               headers={"X-Cloud-Trace-Context": "abc123def456/789;o=1"})
    assert headers["X-Request-Id"] == "abc123def456"


def test_no_sensitive_values_are_logged(caplog):
    with caplog.at_level("DEBUG"):
        create_via_api()
        call("list_certificates", "GET", "/admin/certificates", headers=ADMIN)
    logged = " ".join(r.getMessage() + str(getattr(r, "fields", "")) for r in caplog.records)
    for secret in ("admin-token", "Bearer", "asha@example.com", "%PDF"):
        assert secret not in logged


# ---------------------------------------------------------------------- #
# Public verification
# ---------------------------------------------------------------------- #
def test_verify_endpoint_is_public_and_shaped_like_the_spec():
    _, created, _ = create_via_api()
    status, payload, _ = call("verify_certificate", "GET", f"/verify/{created['certificate_id']}")
    assert status == 200 and payload["status"] == "VALID" and payload["record_found"] is True
    assert payload["metadata_signature_valid"] is True and payload["pdf_integrity_verified"] is None
    assert "recipient_email" not in json.dumps(payload)


def test_verify_unknown_is_404_invalid_and_malformed_is_422():
    status, payload, _ = call("verify_certificate", "GET", f"/verify/{MISSING_ID}")
    assert status == 404 and payload["status"] == "INVALID"
    assert call("verify_certificate", "GET", "/verify/not-an-id")[0] == 422
    assert call("verify_certificate", "POST", f"/verify/{SAMPLE_ID}")[0] == 405


def test_verify_file_multipart_and_raw(storage):
    _, created, _ = create_via_api()
    cid = created["certificate_id"]
    pdf = storage.objects[f"certificates/{cid}.pdf"][0]
    status, payload, _ = call("verify_certificate_file", "POST", f"/verify/{cid}/file", **multipart(pdf))
    assert status == 200 and payload["status"] == "VALID" and payload["pdf_integrity_verified"] is True
    status, payload, _ = call("verify_certificate_file", "POST", f"/verify/{cid}/file", raw=pdf, content_type="application/pdf")
    assert status == 200 and payload["pdf_integrity_verified"] is True


def test_verify_file_detects_modified_pdf(storage):
    _, created, _ = create_via_api()
    cid = created["certificate_id"]
    pdf = bytearray(storage.objects[f"certificates/{cid}.pdf"][0])
    pdf[len(pdf) // 2] ^= 0x01
    status, payload, _ = call("verify_certificate_file", "POST", f"/verify/{cid}/file", **multipart(bytes(pdf)))
    assert status == 200 and payload["status"] == "TAMPERED" and payload["pdf_integrity_verified"] is False


def test_verify_file_rejects_bad_uploads(storage):
    _, created, _ = create_via_api()
    cid = created["certificate_id"]
    path = f"/verify/{cid}/file"
    assert call("verify_certificate_file", "POST", path, **multipart(b"<html>not a pdf</html>" * 5, "x.pdf"))[0] == 422
    assert call("verify_certificate_file", "POST", path, raw={"other": (io.BytesIO(b"x"), "x.pdf")},
                content_type="multipart/form-data")[0] == 422
    assert call("verify_certificate_file", "POST", path, raw=b"{}", content_type="application/json")[0] == 422
    assert call("verify_certificate_file", "POST", "/verify/bad/file", **multipart(b"%PDF" * 20))[0] == 422
    big = b"%PDF-1.4\n" + b"0" * (2 * 1024 * 1024) + b"\n%%EOF"
    status, payload, _ = call("verify_certificate_file", "POST", path, **multipart(big))
    assert status == 413 and payload["error"]["code"] == "payload_too_large"
    status, _, _ = call("verify_certificate_file", "POST", path, raw=b"%PDF-1.4\n" + b"0" * 1_200_000 + b"\n%%EOF",
                        content_type="application/pdf")
    assert status == 413


def test_verify_file_wrong_extension_but_valid_pdf_content_is_accepted(storage):
    _, created, _ = create_via_api()
    cid = created["certificate_id"]
    pdf = storage.objects[f"certificates/{cid}.pdf"][0]
    status, payload, _ = call("verify_certificate_file", "POST", f"/verify/{cid}/file", **multipart(pdf, "renamed.txt"))
    assert status == 200 and payload["status"] == "VALID"  # content is validated, not the name


# ---------------------------------------------------------------------- #
# Admin read / revoke / download
# ---------------------------------------------------------------------- #
def test_list_pagination_over_http(clock):
    ids = []
    for _ in range(3):
        clock.advance(seconds=1)
        ids.append(create_via_api()[1]["certificate_id"])
    status, first, _ = call("list_certificates", "GET", "/admin/certificates", headers=ADMIN, query={"page_size": "2"})
    assert status == 200 and len(first["items"]) == 2 and first["next_page_token"]
    status, second, _ = call("list_certificates", "GET", "/admin/certificates", headers=ADMIN,
                             query={"page_size": "2", "page_token": first["next_page_token"]})
    assert [i["certificate_id"] for i in first["items"] + second["items"]] == list(reversed(ids))
    assert second["next_page_token"] is None


@pytest.mark.parametrize("query", [{"page_size": "0"}, {"page_size": "x"}, {"status": "BOGUS"}, {"page_token": "!!"}, {"foo": "1"}])
def test_list_rejects_invalid_queries(query):
    assert call("list_certificates", "GET", "/admin/certificates", headers=ADMIN, query=query)[0] == 422


def test_get_details_and_404():
    cid = create_via_api()[1]["certificate_id"]
    status, payload, _ = call("get_certificate", "GET", f"/admin/certificates/{cid}", headers=ADMIN)
    assert status == 200 and payload["pdf_sha256"] and payload["kms_key_version"]
    assert call("get_certificate", "GET", f"/admin/certificates/{MISSING_ID}", headers=ADMIN)[0] == 404
    assert call("get_certificate", "GET", "/admin/certificates/zzz", headers=ADMIN)[0] == 422


def test_revoke_flow_and_conflict_over_http():
    cid = create_via_api()[1]["certificate_id"]
    path = f"/admin/certificates/{cid}/revoke"
    assert call("revoke_certificate", "PATCH", path, headers=ADMIN, body={})[0] == 422
    assert call("revoke_certificate", "PATCH", path, headers=ADMIN, body={"reason": "no"})[0] == 422
    status, payload, _ = call("revoke_certificate", "PATCH", path, headers=ADMIN, body={"reason": "Issued in error"})
    assert status == 200 and payload["status"] == "REVOKED" and payload["revoked_by"] == "uid-admin"
    assert call("revoke_certificate", "PATCH", path, headers=ADMIN, body={"reason": "Again"})[0] == 409
    status, verified, _ = call("verify_certificate", "GET", f"/verify/{cid}")
    assert status == 200 and verified["status"] == "REVOKED"
    assert call("revoke_certificate", "PATCH", f"/admin/certificates/{MISSING_ID}/revoke",
                headers=ADMIN, body={"reason": "Issued in error"})[0] == 404


def test_download_returns_short_lived_signed_url():
    cid = create_via_api()[1]["certificate_id"]
    status, payload, _ = call("download_certificate", "GET", f"/admin/certificates/{cid}/download", headers=ADMIN)
    assert status == 200 and payload["url"].startswith("https://") and payload["expires_at"].endswith("Z")
    assert call("download_certificate", "GET", f"/admin/certificates/{MISSING_ID}/download", headers=ADMIN)[0] == 404


# ---------------------------------------------------------------------- #
# CORS
# ---------------------------------------------------------------------- #
def test_preflight_needs_no_auth_and_honours_allowed_origins(monkeypatch):
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "http://localhost:5173")
    status, _, headers = call("list_certificates", "OPTIONS", "/admin/certificates",
                              headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"})
    assert status == 204 and headers["Access-Control-Allow-Origin"] == "http://localhost:5173"
    assert "POST" in headers["Access-Control-Allow-Methods"] and "Authorization" in headers["Access-Control-Allow-Headers"]
    _, _, headers = call("list_certificates", "OPTIONS", "/admin/certificates", headers={"Origin": "https://evil.example"})
    assert "Access-Control-Allow-Origin" not in headers


def test_no_cors_headers_by_default(monkeypatch):
    monkeypatch.delenv("CORS_ALLOWED_ORIGINS", raising=False)
    _, _, headers = call("verify_certificate", "GET", f"/verify/{MISSING_ID}", headers={"Origin": "http://localhost:5173"})
    assert "Access-Control-Allow-Origin" not in headers


# ---------------------------------------------------------------------- #
# OpenAPI <-> handlers <-> deployment scripts consistency
# ---------------------------------------------------------------------- #
def spec():
    return yaml.safe_load((ROOT / "api" / "openapi.yaml").read_text())


def test_openapi_is_valid_before_and_after_rendering(tmp_path):
    from openapi_spec_validator import validate
    validate(spec())
    env = {f"{n.upper()}_URL": f"https://{n.replace('_', '-')}-abc.a.run.app" for n in FUNCTIONS}
    env["IDENTITY_PLATFORM_PROJECT_ID"] = "my-project-123"
    sys.path.insert(0, str(ROOT / "scripts"))
    try:
        import render_openapi
        rendered = render_openapi.render((ROOT / "api" / "openapi.yaml").read_text(), env)
    finally:
        sys.path.pop(0)
    assert "${" not in rendered
    validate(yaml.safe_load(rendered))
    with pytest.raises(SystemExit):
        render_openapi.render((ROOT / "api" / "openapi.yaml").read_text(), {})


def test_every_openapi_operation_matches_a_real_handler():
    document = spec()
    covered = set()
    for template, item in document["paths"].items():
        concrete = template.replace("{certificate_id}", SAMPLE_ID)
        for method, operation in item.items():
            if method == "parameters":
                continue
            backend = operation["x-google-backend"]
            assert backend in document["x-google-api-management"]["backends"]
            module = load(backend.replace("-", "_"))
            assert module.ROUTE_PATTERN.match(concrete), f"{method} {template} does not match {backend}"
            if method.upper() == "OPTIONS":
                continue
            assert method.upper() in module.ALLOWED_METHODS, f"{method} {template} not allowed by {backend}"
            covered.add(backend.replace("-", "_"))
            secured = bool(operation.get("security"))
            assert secured == template.startswith("/admin"), f"security mismatch for {method} {template}"
    assert covered == set(FUNCTIONS)


def test_every_handler_route_is_documented():
    document = spec()
    documented = {(m.upper(), re.sub(r"\{certificate_id\}", SAMPLE_ID, t))
                  for t, item in document["paths"].items() for m in item if m not in ("parameters", "options")}
    for name in FUNCTIONS:
        module = load(name)
        for method in module.ALLOWED_METHODS:
            assert any(m == method and module.ROUTE_PATTERN.match(p) for m, p in documented), (name, method)


def test_gateway_backends_match_deployed_function_names():
    script = (ROOT / "scripts" / "_common.sh").read_text()
    specs = re.findall(r'"(cert-[a-z\-]+):([a-z_]+):\$\{SA_[A-Z]+\}"', script)
    assert {entry for _, entry in specs} == set(FUNCTIONS)
    api_script = (ROOT / "scripts" / "deploy_api.sh").read_text()
    for service_name, entry in specs:
        assert f"function_url {service_name}" in api_script
        url_var = f"{entry.upper()}_URL"
        assert url_var in api_script and f"${{{url_var}}}" in (ROOT / "api" / "openapi.yaml").read_text()
        assert (ROOT / "functions" / entry / "main.py").exists() and (ROOT / "functions" / entry / "requirements.txt").exists()
        assert f"def {entry}(request)" in (ROOT / "functions" / entry / "main.py").read_text()


BLOCKED = {
    "verify_certificate": ["reportlab", "qrcode", "PIL", "google.cloud.storage", "firebase_admin"],
    "verify_certificate_file": ["reportlab", "qrcode", "PIL", "google.cloud.storage", "firebase_admin"],
    "list_certificates": ["reportlab", "qrcode", "PIL", "google.cloud.storage", "google.cloud.kms"],
    "get_certificate": ["reportlab", "qrcode", "PIL", "google.cloud.storage", "google.cloud.kms"],
    "revoke_certificate": ["reportlab", "qrcode", "PIL", "google.cloud.storage", "google.cloud.kms"],
    "download_certificate": ["reportlab", "qrcode", "PIL", "google.cloud.kms"],
    "create_certificate": [],
}


@pytest.mark.parametrize("name", FUNCTIONS)
def test_function_packages_do_not_need_unrelated_dependencies(name):
    """Each function must import with only the packages its requirements.txt installs."""
    code = f"""
import sys, importlib.abc, importlib.util
BLOCKED = {BLOCKED[name]!r}
class Block(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path, target=None):
        if any(fullname == b or fullname.startswith(b + '.') for b in BLOCKED):
            raise ImportError('blocked: ' + fullname)
sys.meta_path.insert(0, Block())
sys.path.insert(0, {str(ROOT)!r})
spec = importlib.util.spec_from_file_location('main', {str(ROOT / 'functions' / name / 'main.py')!r})
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
assert callable(getattr(module, {name!r}))
"""
    result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, cwd=str(ROOT / "functions"))
    assert result.returncode == 0, result.stderr
