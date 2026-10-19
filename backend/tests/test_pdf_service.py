import io
from datetime import datetime, timezone

from pypdf import PdfReader

from shared.pdf_service import PdfService
from shared.qr_service import build_verification_url, generate_qr_png

CID = "CERT-2026-0123456789ABCDEF0123"


def make_pdf(**overrides):
    url = build_verification_url("https://certs.example.com/verify", CID)
    args = dict(
        certificate_id=CID, recipient_name="Asha Verma", course_name="Cloud Architecture",
        organization_name="Example Academy", issue_date=datetime(2026, 10, 15, 9, 0, tzinfo=timezone.utc),
        expiry_date=None, verification_url=url, qr_png=generate_qr_png(url),
    )
    args.update(overrides)
    return PdfService().generate_certificate_pdf(**args)


def text_of(pdf: bytes) -> str:
    return PdfReader(io.BytesIO(pdf)).pages[0].extract_text()


def test_pdf_is_finalised_single_landscape_page():
    pdf = make_pdf()
    assert pdf.startswith(b"%PDF-") and pdf.rstrip().endswith(b"%%EOF")
    reader = PdfReader(io.BytesIO(pdf))
    assert len(reader.pages) == 1
    box = reader.pages[0].mediabox
    assert box.width > box.height


def test_pdf_contains_required_content():
    text = text_of(make_pdf())
    for expected in ("Asha Verma", "Cloud Architecture", "EXAMPLE ACADEMY", CID, "15 October 2026",
                     "No expiry", "upload this exact file", "https://certs.example.com/verify/" + CID):
        assert expected in text.replace("\n", " ")


def test_pdf_shows_expiry_date_when_present():
    text = text_of(make_pdf(expiry_date=datetime(2030, 1, 2, tzinfo=timezone.utc)))
    assert "02 January 2030" in text and "No expiry" not in text


def test_pdf_embeds_qr_image():
    reader = PdfReader(io.BytesIO(make_pdf()))
    assert len(reader.pages[0].images) == 1


def test_long_names_and_courses_do_not_fail():
    pdf = make_pdf(recipient_name="N" * 120, course_name="Very long course title " * 12)
    assert len(PdfReader(io.BytesIO(pdf)).pages) == 1


def test_unsupported_characters_do_not_crash_default_font():
    assert make_pdf(recipient_name="आशा वर्मा").startswith(b"%PDF-")


def test_different_certificates_produce_different_bytes():
    assert make_pdf() != make_pdf(certificate_id="CERT-2026-AAAAAAAAAAAAAAAAAAAA")
