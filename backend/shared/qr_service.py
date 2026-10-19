"""QR-code generation.

The QR payload is **only** the public verification URL (which ends with the
certificate ID).  No personal information is ever encoded.

This file is used to Generate an Certificate verification URL and QR code
"""

from __future__ import annotations

import io
from urllib.parse import quote, urlparse

from shared.exceptions import ConfigurationError
from shared.validators import validate_certificate_id

_MAX_URL_LENGTH = 512


def build_verification_url(base_url: str, certificate_id: str) -> str:
    """Return ``<base_url>/<certificate_id>`` after validating both parts."""
    validate_certificate_id(certificate_id)
    parsed = urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.query or parsed.fragment:
        raise ConfigurationError("The public verification base URL is invalid")
    return f"{base_url.rstrip('/')}/{quote(certificate_id, safe='')}"


def generate_qr_png(url: str, *, box_size: int = 8, border: int = 2) -> bytes:
    """Render ``url`` as a PNG QR code (error-correction level M)."""
    # Imported lazily so functions that never render QR codes (verification,
    # listing, ...) do not need the qrcode/Pillow packages at all.
    import qrcode
    from qrcode.constants import ERROR_CORRECT_M

    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("QR payload must be an absolute http(s) URL")
    if len(url) > _MAX_URL_LENGTH:
        raise ValueError("QR payload is too long")
    qr = qrcode.QRCode(version=None, error_correction=ERROR_CORRECT_M, box_size=box_size, border=border)
    qr.add_data(url)
    qr.make(fit=True)
    image = qr.make_image(fill_color="black", back_color="white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()
