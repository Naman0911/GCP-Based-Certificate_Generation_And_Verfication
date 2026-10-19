"""Canonicalisation, hashing, signing and verification (incl. a fake Cloud KMS client)."""

import base64
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa, utils
from google.api_core import exceptions as gexc

from shared.config import Settings
from shared.crypto_service import (
    CryptoService,
    KmsSigningBackend,
    PublicKeyInfo,
    SUPPORTED_ALGORITHMS,
    build_canonical_metadata,
    canonical_json_bytes,
    metadata_digest_hex,
    sha256_hex,
    _crc32c,
)
from shared.exceptions import CloudServiceError, CryptoError
from tests.conftest import make_settings

ISSUE = datetime(2026, 10, 15, 9, 0, 0, tzinfo=timezone.utc)


def meta(**kw):
    args = dict(certificate_id="CERT-2026-0123456789ABCDEF0123", recipient_name="Asha", recipient_email=None,
                course_name="Cloud", organization_name="Org", issue_date=ISSUE, expiry_date=None)
    args.update(kw)
    return build_canonical_metadata(**args)


def test_sha256_known_vector():
    assert sha256_hex(b"abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"


def test_canonical_json_is_deterministic_and_sorted():
    a = canonical_json_bytes(meta())
    b = canonical_json_bytes(dict(reversed(list(meta().items()))))
    assert a == b
    text = a.decode()
    assert text.startswith('{"certificate_id"') and " " not in text
    assert '"expiry_date":null' in text and '"issue_date":"2026-10-15T09:00:00Z"' in text


def test_canonical_json_keeps_unicode_and_normalises_nfc():
    composed = meta(recipient_name="Zoë")
    decomposed = meta(recipient_name="Zoë")
    assert canonical_json_bytes(composed) == canonical_json_bytes(decomposed)
    assert "Zoë".encode("utf-8") in canonical_json_bytes(composed)  # not \u-escaped


def test_timestamps_are_normalised_to_utc():
    from datetime import timedelta
    ist = timezone(timedelta(hours=5, minutes=30))
    local = datetime(2026, 10, 15, 14, 30, 0, tzinfo=ist)
    assert metadata_digest_hex(meta(issue_date=local)) == metadata_digest_hex(meta())


def test_any_metadata_change_changes_the_digest():
    base = metadata_digest_hex(meta())
    for change in ({"recipient_name": "Other"}, {"course_name": "X"}, {"organization_name": "Y"},
                   {"recipient_email": "a@b.com"}, {"expiry_date": ISSUE}):
        assert metadata_digest_hex(meta(**change)) != base


def test_sign_and_verify_roundtrip(crypto):
    digest = sha256_hex(b"payload")
    sig = crypto.sign_hex_digest(digest)
    assert sig.algorithm in SUPPORTED_ALGORITHMS
    assert base64.b64decode(sig.signature_b64, validate=True)
    assert crypto.verify_signature(digest, sig.signature_b64, sig.key_version, sig.algorithm)


def test_wrong_digest_and_modified_signature_fail(crypto):
    digest = sha256_hex(b"payload")
    sig = crypto.sign_hex_digest(digest)
    assert not crypto.verify_signature(sha256_hex(b"other"), sig.signature_b64, sig.key_version)
    raw = bytearray(base64.b64decode(sig.signature_b64))
    raw[0] ^= 0xFF
    assert not crypto.verify_signature(digest, base64.b64encode(bytes(raw)).decode(), sig.key_version)


@pytest.mark.parametrize("bad_sig", ["", "!!!not-base64!!!", "AAAA", None])
def test_malformed_signatures_fail_closed(crypto, bad_sig):
    assert crypto.verify_signature(sha256_hex(b"x"), bad_sig, "local-dev/test-only/cryptoKeyVersions/1") is False


def test_malformed_digest_fails_closed(crypto):
    sig = crypto.sign_hex_digest(sha256_hex(b"x"))
    for bad in ("zz", "A" * 64, "", None):
        assert crypto.verify_signature(bad, sig.signature_b64, sig.key_version) is False


def test_unknown_key_version_fails_closed(crypto):
    sig = crypto.sign_hex_digest(sha256_hex(b"x"))
    assert crypto.verify_signature(sha256_hex(b"x"), sig.signature_b64, "projects/x/other/9") is False


def test_algorithm_mismatch_fails_closed(crypto):
    digest = sha256_hex(b"x")
    sig = crypto.sign_hex_digest(digest)
    assert crypto.verify_signature(digest, sig.signature_b64, sig.key_version, "RSA_SIGN_PSS_2048_SHA256") is False


def test_signing_rejects_bad_digest(crypto):
    with pytest.raises(CryptoError):
        crypto.sign_hex_digest("not-a-digest")


class BadBackend:
    """Returns signatures from an unrelated key: the self-check must fail closed."""

    def __init__(self, signer):
        self._signer = signer
        self._other = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    def sign_digest(self, digest):
        return self._other.sign(digest, padding.PKCS1v15(), utils.Prehashed(hashes.SHA256())), self._signer.KEY_VERSION

    def get_public_key(self, key_version):
        return self._signer.get_public_key(key_version)

    def is_key_version_allowed(self, key_version):
        return True


def test_signature_from_wrong_key_is_rejected_at_signing(signer):
    with pytest.raises(CryptoError):
        CryptoService(BadBackend(signer)).sign_hex_digest(sha256_hex(b"x"))


class UnsupportedBackend:
    def __init__(self, signer):
        self._signer = signer

    def sign_digest(self, digest):
        return self._signer.sign_digest(digest)

    def get_public_key(self, key_version):
        info = self._signer.get_public_key(key_version)
        return PublicKeyInfo(pem=info.pem, algorithm="EC_SIGN_P256_SHA256")

    def is_key_version_allowed(self, key_version):
        return True


def test_unsupported_algorithm_fails_closed(signer):
    service = CryptoService(UnsupportedBackend(signer))
    with pytest.raises(CryptoError):
        service.sign_hex_digest(sha256_hex(b"x"))
    sig = CryptoService(signer).sign_hex_digest(sha256_hex(b"x"))
    assert service.verify_signature(sha256_hex(b"x"), sig.signature_b64, sig.key_version) is False


# ---------------------------------------------------------------------- #
# KMS backend with a fake client
# ---------------------------------------------------------------------- #
class FakeKmsClient:
    def __init__(self, settings, algorithm="RSA_SIGN_PKCS1_2048_SHA256", pss=False):
        self.settings = settings
        self.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.algorithm = algorithm
        self.pss = pss
        self.sign_error = None
        self.public_error = None
        self.corrupt_signature_crc = False
        self.corrupt_digest_ack = False
        self.sign_calls = 0

    def asymmetric_sign(self, request, **kwargs):
        self.sign_calls += 1
        if self.sign_error:
            raise self.sign_error
        digest = request["digest"]["sha256"]
        assert request["digest_crc32c"] == _crc32c(digest)
        pad = (padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=32) if self.pss else padding.PKCS1v15())
        signature = self.key.sign(digest, pad, utils.Prehashed(hashes.SHA256()))
        crc = _crc32c(signature) + (1 if self.corrupt_signature_crc else 0)
        return SimpleNamespace(name=request["name"], signature=signature, signature_crc32c=crc,
                               verified_digest_crc32c=not self.corrupt_digest_ack)

    def get_public_key(self, request, **kwargs):
        if self.public_error:
            raise self.public_error
        pem = self.key.public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()
        return SimpleNamespace(pem=pem, pem_crc32c=_crc32c(pem.encode()),
                               algorithm=SimpleNamespace(name=self.algorithm))


@pytest.fixture()
def kms_settings() -> Settings:
    return make_settings(USE_LOCAL_DEV_SIGNER="false")


def test_kms_pkcs1_roundtrip_records_exact_key_version(kms_settings):
    client = FakeKmsClient(kms_settings)
    service = CryptoService(KmsSigningBackend(kms_settings, client=client))
    digest = sha256_hex(b"pdf")
    sig = service.sign_hex_digest(digest)
    assert sig.key_version == kms_settings.kms_key_version_name
    assert sig.key_version.endswith("/cryptoKeys/key/cryptoKeyVersions/1")
    assert service.verify_signature(digest, sig.signature_b64, sig.key_version, sig.algorithm)


def test_kms_pss_roundtrip(kms_settings):
    client = FakeKmsClient(kms_settings, algorithm="RSA_SIGN_PSS_2048_SHA256", pss=True)
    service = CryptoService(KmsSigningBackend(kms_settings, client=client))
    sig = service.sign_hex_digest(sha256_hex(b"x"))
    assert service.verify_signature(sha256_hex(b"x"), sig.signature_b64, sig.key_version)


def test_kms_rejects_versions_of_other_keys(kms_settings):
    backend = KmsSigningBackend(kms_settings, client=FakeKmsClient(kms_settings))
    foreign = kms_settings.kms_key_version_name.replace("/key/", "/other-key/")
    assert not backend.is_key_version_allowed(foreign)
    assert not backend.is_key_version_allowed(kms_settings.kms_key_prefix + "1/../2")
    assert backend.is_key_version_allowed(kms_settings.kms_key_prefix + "7")  # older/newer version of same key
    assert CryptoService(backend).verify_signature(sha256_hex(b"x"), "AAAA", foreign) is False


def test_kms_outage_is_a_service_error_not_tampering(kms_settings):
    client = FakeKmsClient(kms_settings)
    service = CryptoService(KmsSigningBackend(kms_settings, client=client))
    sig = service.sign_hex_digest(sha256_hex(b"x"))
    client.sign_error = gexc.ServiceUnavailable("down")
    with pytest.raises(CloudServiceError):
        service.sign_hex_digest(sha256_hex(b"y"))
    fresh = CryptoService(KmsSigningBackend(kms_settings, client=client))
    client.public_error = gexc.ServiceUnavailable("down")
    with pytest.raises(CloudServiceError):
        fresh.verify_signature(sha256_hex(b"x"), sig.signature_b64, sig.key_version)


def test_kms_missing_key_version_fails_closed(kms_settings):
    client = FakeKmsClient(kms_settings)
    service = CryptoService(KmsSigningBackend(kms_settings, client=client))
    sig = service.sign_hex_digest(sha256_hex(b"x"))
    client.public_error = gexc.NotFound("gone")
    fresh = CryptoService(KmsSigningBackend(kms_settings, client=client))
    assert fresh.verify_signature(sha256_hex(b"x"), sig.signature_b64, sig.key_version) is False


@pytest.mark.parametrize("flag", ["corrupt_signature_crc", "corrupt_digest_ack"])
def test_kms_integrity_checksums_are_enforced(kms_settings, flag):
    client = FakeKmsClient(kms_settings)
    setattr(client, flag, True)
    with pytest.raises(CryptoError):
        CryptoService(KmsSigningBackend(kms_settings, client=client)).sign_hex_digest(sha256_hex(b"x"))


def test_public_key_is_cached(kms_settings):
    client = FakeKmsClient(kms_settings)
    calls = []
    original = client.get_public_key
    client.get_public_key = lambda request, **kw: (calls.append(1), original(request, **kw))[1]
    service = CryptoService(KmsSigningBackend(kms_settings, client=client))
    digest = sha256_hex(b"x")
    sig = service.sign_hex_digest(digest)
    for _ in range(3):
        service.verify_signature(digest, sig.signature_b64, sig.key_version)
    assert len(calls) == 1
