import io

import pytest
from PIL import Image

from shared.exceptions import ConfigurationError, ValidationFailedError
from shared.qr_service import build_verification_url, generate_qr_png

CID = "CERT-2026-0123456789ABCDEF0123"


def test_url_contains_only_base_and_id():
    assert build_verification_url("https://certs.example.com/verify/", CID) == f"https://certs.example.com/verify/{CID}"


def test_url_rejects_bad_inputs():
    with pytest.raises(ValidationFailedError):
        build_verification_url("https://certs.example.com/verify", "bad-id")
    for base in ("ftp://x.example.com", "not a url", "https://x.example.com/v?token=1"):
        with pytest.raises(ConfigurationError):
            build_verification_url(base, CID)


def test_png_is_square_and_valid():
    png = generate_qr_png(build_verification_url("https://certs.example.com/verify", CID))
    assert png.startswith(b"\x89PNG\r\n\x1a\n")
    image = Image.open(io.BytesIO(png))
    assert image.size[0] == image.size[1] and image.size[0] > 100


def test_qr_decodes_to_exactly_the_verification_url():
    cv2 = pytest.importorskip("cv2")
    np = pytest.importorskip("numpy")
    url = build_verification_url("https://certs.example.com/verify", CID)
    image = Image.open(io.BytesIO(generate_qr_png(url, box_size=10))).convert("L")
    decoded, _, _ = cv2.QRCodeDetector().detectAndDecode(np.array(image))
    assert decoded == url  # nothing else (no names, emails, ...) is encoded


def test_payload_must_be_http_url():
    for bad in ("hello", "javascript:alert(1)", "https://" + "a" * 600 + ".com"):
        with pytest.raises(ValueError):
            generate_qr_png(bad)
