"""TEST-ONLY signing backend using an in-memory RSA key.

*** NEVER USE IN PRODUCTION ***

* Used by the unit tests and (optionally) for offline local development when
  ``USE_LOCAL_DEV_SIGNER=true``.
* The key lives only in process memory and is regenerated on every start, so
  signatures do not survive a restart.
* ``scripts/deploy_functions.sh`` removes this file from every deployed package
  and ``Settings`` refuses ``USE_LOCAL_DEV_SIGNER`` when ``ENVIRONMENT=production``.
  
This file is used to provide an in-memory signing mechanism used for the Devleopment
"""

from __future__ import annotations

import os
from typing import Optional, Tuple

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa, utils

from shared.crypto_service import KeyVersionNotFoundError, PublicKeyInfo
from shared.exceptions import ConfigurationError


class LocalDevSigner:
    """In-memory RSA-2048 / PKCS#1 v1.5 / SHA-256 signer (test-only)."""

    ALGORITHM = "RSA_SIGN_PKCS1_2048_SHA256"
    KEY_VERSION = "local-dev/test-only/cryptoKeyVersions/1"

    def __init__(self, private_key: Optional[rsa.RSAPrivateKey] = None) -> None:
        if os.environ.get("ENVIRONMENT", "").strip().lower() == "production":
            raise ConfigurationError("The local development signer must not be used in production")
        self._private_key = private_key or rsa.generate_private_key(public_exponent=65537, key_size=2048)

    def is_key_version_allowed(self, key_version: str) -> bool:
        return key_version == self.KEY_VERSION

    def sign_digest(self, digest: bytes) -> Tuple[bytes, str]:
        signature = self._private_key.sign(digest, padding.PKCS1v15(), utils.Prehashed(hashes.SHA256()))
        return signature, self.KEY_VERSION

    def get_public_key(self, key_version: str) -> PublicKeyInfo:
        if not self.is_key_version_allowed(key_version):
            raise KeyVersionNotFoundError("unknown local development key version")
        pem = self._private_key.public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
        )
        return PublicKeyInfo(pem=pem, algorithm=self.ALGORITHM)
