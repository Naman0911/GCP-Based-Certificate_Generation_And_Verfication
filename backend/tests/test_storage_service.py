"""StorageService against a fake google-cloud-storage client."""

from datetime import timedelta

import pytest
from google.api_core import exceptions as gexc

from shared.exceptions import CloudServiceError, ConfigurationError, ConflictError, NotFoundError
from shared.storage_service import StorageService, object_name_for
from tests.conftest import make_settings


class FakeBlob:
    def __init__(self, bucket, name):
        self.bucket, self.name = bucket, name
        self.generation = None
        self.cache_control = None

    def upload_from_string(self, data, **kwargs):
        self.bucket.calls.append(("upload", kwargs))
        if self.bucket.error:
            raise self.bucket.error
        if kwargs.get("if_generation_match") == 0 and self.name in self.bucket.objects:
            raise gexc.PreconditionFailed("exists")
        self.generation = 4242
        self.bucket.objects[self.name] = data

    def download_as_bytes(self, **kwargs):
        if self.bucket.error:
            raise self.bucket.error
        if self.name not in self.bucket.objects:
            raise gexc.NotFound("missing")
        return self.bucket.objects[self.name]

    def delete(self, **kwargs):
        self.bucket.calls.append(("delete", kwargs))
        if self.bucket.error:
            raise self.bucket.error
        if self.name not in self.bucket.objects:
            raise gexc.NotFound("missing")
        if kwargs["if_generation_match"] != 4242:
            raise gexc.PreconditionFailed("replaced")
        del self.bucket.objects[self.name]

    def generate_signed_url(self, **kwargs):
        self.bucket.calls.append(("sign", kwargs))
        return "https://storage.googleapis.com/signed"


class FakeBucket:
    def __init__(self):
        self.objects, self.calls, self.error = {}, [], None

    def blob(self, name):
        return FakeBlob(self, name)


class FakeClient:
    def __init__(self):
        self.fake_bucket = FakeBucket()

    def bucket(self, name):
        assert name == "test-bucket"
        return self.fake_bucket


class FakeCredentials:
    token = "access-token"
    expired = False
    service_account_email = "runtime@test-project.iam.gserviceaccount.com"


@pytest.fixture()
def gcs():
    client = FakeClient()
    return StorageService(make_settings(), client=client, credentials_provider=lambda: FakeCredentials()), client.fake_bucket


def test_upload_uses_overwrite_prevention_and_returns_generation(gcs):
    service, bucket = gcs
    assert service.upload_certificate_pdf("certificates/x.pdf", b"%PDF") == 4242
    kwargs = bucket.calls[0][1]
    assert kwargs["if_generation_match"] == 0 and kwargs["content_type"] == "application/pdf"


def test_upload_never_overwrites(gcs):
    service, _ = gcs
    service.upload_certificate_pdf("certificates/x.pdf", b"one")
    with pytest.raises(ConflictError):
        service.upload_certificate_pdf("certificates/x.pdf", b"two")


def test_upload_failure_is_a_service_error(gcs):
    service, bucket = gcs
    bucket.error = gexc.ServiceUnavailable("down")
    with pytest.raises(CloudServiceError):
        service.upload_certificate_pdf("certificates/x.pdf", b"x")


def test_download_and_not_found(gcs):
    service, _ = gcs
    service.upload_certificate_pdf("certificates/x.pdf", b"data")
    assert service.download_certificate_pdf("certificates/x.pdf") == b"data"
    with pytest.raises(NotFoundError):
        service.download_certificate_pdf("certificates/missing.pdf")


def test_conditional_delete(gcs):
    service, bucket = gcs
    service.upload_certificate_pdf("certificates/x.pdf", b"data")
    assert service.delete_object_if_generation_matches("certificates/x.pdf", 1) is False  # replaced -> keep
    assert "certificates/x.pdf" in bucket.objects
    assert service.delete_object_if_generation_matches("certificates/x.pdf", 4242) is True
    assert service.delete_object_if_generation_matches("certificates/x.pdf", 4242) is False  # already gone
    bucket.error = gexc.ServiceUnavailable("down")
    with pytest.raises(CloudServiceError):
        service.delete_object_if_generation_matches("certificates/x.pdf", 4242)


def test_signed_url_is_v4_short_lived_and_keyless(gcs):
    service, bucket = gcs
    url, expires_at = service.generate_download_url("certificates/x.pdf", filename="CERT-1.pdf")
    kwargs = next(c[1] for c in bucket.calls if c[0] == "sign")
    assert url.startswith("https://") and kwargs["version"] == "v4" and kwargs["method"] == "GET"
    assert kwargs["expiration"] == timedelta(minutes=10)
    assert kwargs["service_account_email"].endswith("iam.gserviceaccount.com") and kwargs["access_token"] == "access-token"
    assert 'filename="CERT-1.pdf"' in kwargs["response_disposition"]


def test_signed_url_filename_is_sanitised(gcs):
    service, bucket = gcs
    service.generate_download_url("certificates/x.pdf", filename='a"b\r\nc.pdf')
    kwargs = next(c[1] for c in bucket.calls if c[0] == "sign")
    assert '"b' not in kwargs["response_disposition"].split("filename=")[1].strip('"') and "\n" not in kwargs["response_disposition"]


def test_signed_url_requires_a_service_account():
    class NoSa:
        token, expired = "t", False

    client = FakeClient()
    service = StorageService(make_settings(), client=client, credentials_provider=lambda: NoSa())
    with pytest.raises(ConfigurationError):
        service.generate_download_url("certificates/x.pdf", filename="x.pdf")
    configured = StorageService(
        make_settings(SIGNED_URL_SERVICE_ACCOUNT="signer@test-project.iam.gserviceaccount.com"),
        client=client, credentials_provider=lambda: NoSa())
    configured.generate_download_url("certificates/x.pdf", filename="x.pdf")


def test_object_name_is_derived_from_id():
    assert object_name_for("CERT-2026-AAAAAAAAAAAAAAAAAAAA") == "certificates/CERT-2026-AAAAAAAAAAAAAAAAAAAA.pdf"
