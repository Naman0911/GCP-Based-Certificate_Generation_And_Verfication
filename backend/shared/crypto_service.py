"""Hashing, canonical metadata, Cloud KMS signing and signature verification.

Canonical metadata serialisation rules (version 1)
--------------------------------------------------
The signed metadata is a JSON object with exactly these keys::

    schema_version, certificate_id, recipient_name, recipient_email,
    course_name, organization_name, issue_date, expiry_date

* Text values are Unicode NFC normalised; absent optional values are ``null``.
* ``issue_date`` / ``expiry_date`` are UTC, formatted ``YYYY-MM-DDTHH:MM:SSZ``.
* Serialisation: ``json.dumps(sort_keys=True, separators=(",", ":"),
  ensure_ascii=False, allow_nan=False)`` encoded as UTF-8.
* ``metadata_sha256`` is the lower-case hex SHA-256 of those bytes.

Cryptographic verification protocol for a digital signature system, specifically designed to secure data (like certificates) issued via Google Cloud Key Management Service (KMS).
Signatures are RSA signatures over the 32-byte SHA-256 digest (not over the raw
data), produced by Cloud KMS (``RSA_SIGN_PKCS1_*_SHA256`` or
``RSA_SIGN_PSS_*_SHA256``) and verified locally with ``cryptography``.  The exact
KMS key *version* resource name is stored with each certificate.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import logging
import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, Optional, Protocol, Tuple

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa, utils

from shared.exceptions import CloudServiceError, CryptoError
from shared.logging_utils import get_logger, log_event
from shared.models import iso_z

logger = get_logger("certificate.crypto")

METADATA_SCHEMA_VERSION = 1
_HEX_DIGEST_RE = re.compile(r"^[0-9a-f]{64}$")
_SHA256_SIZE = hashes.SHA256().digest_size

#: algorithm name -> (padding scheme, RSA key size in bits)
SUPPORTED_ALGORITHMS: Dict[str, Tuple[str, int]] = {
    "RSA_SIGN_PKCS1_2048_SHA256": ("pkcs1", 2048),
    "RSA_SIGN_PKCS1_3072_SHA256": ("pkcs1", 3072),
    "RSA_SIGN_PKCS1_4096_SHA256": ("pkcs1", 4096),
    "RSA_SIGN_PSS_2048_SHA256": ("pss", 2048),
    "RSA_SIGN_PSS_3072_SHA256": ("pss", 3072),
    "RSA_SIGN_PSS_4096_SHA256": ("pss", 4096),
}


# ---------------------------------------------------------------------- #
# Hashing and canonical metadata
# ---------------------------------------------------------------------- #
def sha256_digest(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def normalize_text(value: str) -> str:
    return unicodedata.normalize("NFC", value)


def build_canonical_metadata(
    *,
    certificate_id: str,
    recipient_name: str,
    recipient_email: Optional[str],
    course_name: str,
    organization_name: str,
    issue_date: datetime,
    expiry_date: Optional[datetime],
) -> Dict[str, Any]:
    """Return the metadata dictionary that is serialised and signed."""
    return {
        "schema_version": METADATA_SCHEMA_VERSION,
        "certificate_id": normalize_text(certificate_id),
        "recipient_name": normalize_text(recipient_name),
        "recipient_email": normalize_text(recipient_email) if recipient_email else None,
        "course_name": normalize_text(course_name),
        "organization_name": normalize_text(organization_name),
        "issue_date": iso_z(issue_date),
        "expiry_date": iso_z(expiry_date) if expiry_date else None,
    }


def canonical_json_bytes(metadata: Dict[str, Any]) -> bytes:
    """Deterministic UTF-8 JSON (sorted keys, no whitespace, no ASCII escaping)."""
    return json.dumps(
        metadata, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    ).encode("utf-8")


def metadata_digest_hex(metadata: Dict[str, Any]) -> str:
    return sha256_hex(canonical_json_bytes(metadata))


# ---------------------------------------------------------------------- #
# Signing backends
# ---------------------------------------------------------------------- #
@dataclass(frozen=True)
class PublicKeyInfo:
    pem: bytes
    algorithm: str


@dataclass(frozen=True)
class SignatureResult:
    signature_b64: str
    key_version: str
    algorithm: str


class KeyVersionNotFoundError(Exception):
    """The referenced signing key version does not exist (fail closed)."""


class SigningBackend(Protocol):
    def sign_digest(self, digest: bytes) -> Tuple[bytes, str]:
        """Sign a 32-byte SHA-256 digest; return ``(signature, key_version_name)``."""

    def get_public_key(self, key_version: str) -> PublicKeyInfo:
        """Return the PEM public key and algorithm name of ``key_version``."""

    def is_key_version_allowed(self, key_version: str) -> bool:
        """Whether ``key_version`` may be used for verification."""


def _crc32c(data: bytes) -> int:
    import google_crc32c

    return int(google_crc32c.value(data))


def _retry():
    """Retry transient KMS failures (idempotent calls only)."""
    from google.api_core import exceptions as gexc
    from google.api_core import retry as gretry

    return gretry.Retry(
        initial=0.5,
        maximum=4.0,
        multiplier=2.0,
        timeout=20.0,
        predicate=gretry.if_exception_type(
            gexc.ServiceUnavailable, gexc.DeadlineExceeded, gexc.InternalServerError
        ),
    )


class KmsSigningBackend:
    """Production backend: asymmetric signing with Cloud KMS."""

    def __init__(self, settings: Any, client: Any = None, timeout: float = 15.0) -> None:
        self._settings = settings
        self._client = client
        self._timeout = timeout

    @property
    def client(self) -> Any:
        if self._client is None:
            from google.cloud import kms

            self._client = kms.KeyManagementServiceClient()
        return self._client

    def is_key_version_allowed(self, key_version: str) -> bool:
        prefix = self._settings.kms_key_prefix
        return (
            isinstance(key_version, str)
            and key_version.startswith(prefix)
            and key_version[len(prefix):].isdigit()
        )

    def sign_digest(self, digest: bytes) -> Tuple[bytes, str]:
        from google.api_core import exceptions as gexc

        name = self._settings.kms_key_version_name
        request = {
            "name": name,
            "digest": {"sha256": digest},
            "digest_crc32c": _crc32c(digest),
        }
        try:
            response = self.client.asymmetric_sign(
                request=request, retry=_retry(), timeout=self._timeout
            )
        except (gexc.GoogleAPICallError, gexc.RetryError) as exc:
            log_event(logger, logging.ERROR, "kms_sign_failed", error_type=type(exc).__name__)
            raise CloudServiceError("Cloud KMS signing failed") from exc

        if not response.verified_digest_crc32c:
            raise CryptoError("KMS did not confirm the digest checksum")
        if response.name != name:
            raise CryptoError("KMS signed with an unexpected key version")
        signature_crc = getattr(response.signature_crc32c, "value", response.signature_crc32c)
        if signature_crc is None or int(signature_crc) != _crc32c(response.signature):
            raise CryptoError("KMS signature checksum mismatch")
        return bytes(response.signature), name

    def get_public_key(self, key_version: str) -> PublicKeyInfo:
        from google.api_core import exceptions as gexc

        if not self.is_key_version_allowed(key_version):
            raise KeyVersionNotFoundError("key version is not part of the configured signing key")
        try:
            response = self.client.get_public_key(
                request={"name": key_version}, retry=_retry(), timeout=self._timeout
            )
        except gexc.NotFound as exc:
            raise KeyVersionNotFoundError("key version does not exist") from exc
        except (gexc.GoogleAPICallError, gexc.RetryError) as exc:
            log_event(logger, logging.ERROR, "kms_get_public_key_failed", error_type=type(exc).__name__)
            raise CloudServiceError("Cloud KMS public key retrieval failed") from exc

        pem_crc = getattr(response.pem_crc32c, "value", response.pem_crc32c)
        if pem_crc is None or int(pem_crc) != _crc32c(response.pem.encode("utf-8")):
            raise CryptoError("KMS public key checksum mismatch")
        algorithm = getattr(response.algorithm, "name", str(response.algorithm))
        return PublicKeyInfo(pem=response.pem.encode("utf-8"), algorithm=algorithm)


# ---------------------------------------------------------------------- #
# Crypto service
# ---------------------------------------------------------------------- #
def _digest_from_hex(hex_digest: str) -> bytes:
    if not isinstance(hex_digest, str) or not _HEX_DIGEST_RE.match(hex_digest):
        raise ValueError("digest must be 64 lower-case hexadecimal characters")
    return bytes.fromhex(hex_digest)


class CryptoService:
    """Signs digests through a backend and verifies signatures locally."""

    def __init__(self, backend: SigningBackend) -> None:
        self._backend = backend
        self._key_cache: Dict[str, Tuple[rsa.RSAPublicKey, str]] = {}

    # -- key handling ---------------------------------------------------- #
    def _resolve_public_key(self, key_version: str) -> Tuple[rsa.RSAPublicKey, str]:
        cached = self._key_cache.get(key_version)
        if cached is not None:
            return cached
        info = self._backend.get_public_key(key_version)
        if info.algorithm not in SUPPORTED_ALGORITHMS:
            raise CryptoError(f"Unsupported signature algorithm: {info.algorithm}")
        try:
            public_key = serialization.load_pem_public_key(info.pem)
        except (ValueError, TypeError) as exc:
            raise CryptoError("The signing public key could not be parsed") from exc
        _, bits = SUPPORTED_ALGORITHMS[info.algorithm]
        if not isinstance(public_key, rsa.RSAPublicKey) or public_key.key_size != bits:
            raise CryptoError("The signing public key does not match its algorithm")
        self._key_cache[key_version] = (public_key, info.algorithm)
        return public_key, info.algorithm

    @staticmethod
    def _verify_raw(public_key: rsa.RSAPublicKey, algorithm: str, digest: bytes, signature: bytes) -> bool:
        scheme, _ = SUPPORTED_ALGORITHMS[algorithm]
        if scheme == "pkcs1":
            pad: padding.AsymmetricPadding = padding.PKCS1v15()
        else:
            pad = padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=_SHA256_SIZE)
        try:
            public_key.verify(signature, digest, pad, utils.Prehashed(hashes.SHA256()))
            return True
        except (InvalidSignature, ValueError):
            return False

    # -- signing --------------------------------------------------------- #
    def sign_hex_digest(self, hex_digest: str) -> SignatureResult:
        """Sign a SHA-256 digest and self-verify the result (fails closed)."""
        try:
            digest = _digest_from_hex(hex_digest)
        except ValueError as exc:
            raise CryptoError(str(exc)) from exc
        signature, key_version = self._backend.sign_digest(digest)
        try:
            public_key, algorithm = self._resolve_public_key(key_version)
        except KeyVersionNotFoundError as exc:
            raise CryptoError("The signing key version could not be found") from exc
        if not self._verify_raw(public_key, algorithm, digest, signature):
            log_event(logger, logging.ERROR, "signature_self_check_failed", key_version=key_version)
            raise CryptoError("The freshly created signature failed verification")
        return SignatureResult(
            signature_b64=base64.b64encode(signature).decode("ascii"),
            key_version=key_version,
            algorithm=algorithm,
        )

    # -- verification ---------------------------------------------------- #
    def verify_signature(
        self,
        hex_digest: str,
        signature_b64: str,
        key_version: str,
        expected_algorithm: Optional[str] = None,
    ) -> bool:
        """Verify ``signature_b64`` over ``hex_digest`` with ``key_version``.

        Returns ``False`` for any invalid signature, malformed input, unknown key
        version or unsupported algorithm (fail closed).  Infrastructure failures
        raise :class:`CloudServiceError` so they are never mistaken for tampering.
        """
        try:
            digest = _digest_from_hex(hex_digest)
            signature = base64.b64decode(signature_b64, validate=True)
        except (ValueError, TypeError, binascii.Error):
            return False
        try:
            public_key, algorithm = self._resolve_public_key(key_version)
        except KeyVersionNotFoundError:
            log_event(logger, logging.WARNING, "signing_key_version_missing", key_version=str(key_version)[-80:])
            return False
        except CryptoError as exc:
            log_event(logger, logging.WARNING, "signing_key_unusable", reason=exc.message)
            return False
        if expected_algorithm is not None and expected_algorithm != algorithm:
            log_event(logger, logging.WARNING, "signature_algorithm_mismatch")
            return False
        return self._verify_raw(public_key, algorithm, digest, signature)
