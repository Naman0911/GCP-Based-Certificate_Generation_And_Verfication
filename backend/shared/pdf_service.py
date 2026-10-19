"""Professional certificate PDF generation with ReportLab.

The returned bytes are the *final* PDF: callers hash and sign exactly these
bytes and must never modify them afterwards.

Fonts: by default the built-in Helvetica/Times fonts are used, which cover
Latin-1 (Western European) text.  Characters outside that range are rendered
as ``?`` in the PDF only (the signed metadata always keeps the original text).
To render other scripts (for example Devanagari) set ``PDF_FONT_PATH`` (and
optionally ``PDF_FONT_BOLD_PATH``) to a Unicode TrueType font file.

"""
##### This file is used to generate the Final PDF using Report LAB library

from __future__ import annotations

import io
from datetime import datetime
from typing import Optional, Tuple

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.utils import ImageReader, simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

from shared.models import to_utc

NAVY = HexColor("#14213D")
GOLD = HexColor("#B8860B")
GREY = HexColor("#555555")
LIGHT = HexColor("#888888")

_CUSTOM_REGULAR = "CertificateFont"
_CUSTOM_BOLD = "CertificateFontBold"


def _format_date(value: datetime) -> str:
    return to_utc(value).strftime("%d %B %Y")


class PdfService:
    """Creates the certificate PDF."""

    def __init__(self, font_path: Optional[str] = None, bold_font_path: Optional[str] = None) -> None:
        self._custom = False
        if font_path:
            self._register(font_path, bold_font_path or font_path)
            self._custom = True

    @staticmethod
    def _register(regular: str, bold: str) -> None:
        registered = pdfmetrics.getRegisteredFontNames()
        if _CUSTOM_REGULAR not in registered:
            pdfmetrics.registerFont(TTFont(_CUSTOM_REGULAR, regular))
        if _CUSTOM_BOLD not in registered:
            pdfmetrics.registerFont(TTFont(_CUSTOM_BOLD, bold))

    # ------------------------------------------------------------------ #
    def _fonts(self) -> Tuple[str, str, str, str]:
        """(body, bold, title, mono) font names."""
        if self._custom:
            return _CUSTOM_REGULAR, _CUSTOM_BOLD, _CUSTOM_BOLD, "Courier-Bold"
        return "Helvetica", "Helvetica-Bold", "Times-Bold", "Courier-Bold"

    def _text(self, value: str) -> str:
        if self._custom:
            return value
        return value.encode("cp1252", errors="replace").decode("cp1252")

    # ------------------------------------------------------------------ #
    def generate_certificate_pdf(
        self,
        *,
        certificate_id: str,
        recipient_name: str,
        course_name: str,
        organization_name: str,
        issue_date: datetime,
        expiry_date: Optional[datetime],
        verification_url: str,
        qr_png: bytes,
    ) -> bytes:
        body, bold, title_font, mono = self._fonts()
        width, height = landscape(A4)
        buffer = io.BytesIO()
        pdf = canvas.Canvas(buffer, pagesize=(width, height), pageCompression=1)
        pdf.setTitle(self._text(f"Certificate {certificate_id}"))
        pdf.setAuthor(self._text(organization_name))
        pdf.setSubject("Certificate of completion")
        pdf.setCreator("Certificate Generation & Verification System")
        pdf.setKeywords(certificate_id)
        centre = width / 2

        # Borders
        pdf.setStrokeColor(NAVY)
        pdf.setLineWidth(3)
        pdf.rect(24, 24, width - 48, height - 48)
        pdf.setStrokeColor(GOLD)
        pdf.setLineWidth(1)
        pdf.rect(34, 34, width - 68, height - 68)

        # Issuer
        pdf.setFillColor(NAVY)
        pdf.setFont(bold, 15)
        pdf.drawCentredString(centre, 505, self._text(organization_name.upper())[:90])

        # Title
        pdf.setFont(title_font, 46)
        pdf.drawCentredString(centre, 440, "CERTIFICATE")
        pdf.setFillColor(GOLD)
        pdf.setFont(bold, 13)
        pdf.drawCentredString(centre, 414, "OF COMPLETION")

        # Recipient
        pdf.setFillColor(GREY)
        pdf.setFont(body, 14)
        pdf.drawCentredString(centre, 374, "This is to certify that")
        name = self._text(recipient_name)
        size = 38
        while size > 16 and pdfmetrics.stringWidth(name, bold, size) > width - 200:
            size -= 1
        pdf.setFillColor(NAVY)
        pdf.setFont(bold, size)
        pdf.drawCentredString(centre, 330, name)
        pdf.setStrokeColor(GOLD)
        pdf.setLineWidth(1)
        pdf.line(centre - 230, 318, centre + 230, 318)

        # Achievement
        pdf.setFillColor(GREY)
        pdf.setFont(body, 14)
        pdf.drawCentredString(centre, 290, "has successfully completed")
        pdf.setFillColor(NAVY)
        pdf.setFont(bold, 22)
        course_lines = simpleSplit(self._text(course_name), bold, 22, width - 220)
        if len(course_lines) > 2:
            course_lines = course_lines[:2]
            course_lines[-1] = course_lines[-1].rstrip()[:-3] + "..."
        y = 258
        for line in course_lines:
            pdf.drawCentredString(centre, y, line)
            y -= 28

        # Details block (left)
        left = 70
        pdf.setFillColor(LIGHT)
        pdf.setFont(bold, 7)
        pdf.drawString(left, 160, "CERTIFICATE ID")
        pdf.drawString(left + 270, 160, "ISSUED (UTC)")
        pdf.drawString(left + 400, 160, "VALID UNTIL (UTC)")
        pdf.setFillColor(NAVY)
        pdf.setFont(mono, 11)
        pdf.drawString(left, 146, certificate_id)
        pdf.setFont(body, 10)
        pdf.drawString(left + 270, 146, _format_date(issue_date))
        pdf.drawString(left + 400, 146, _format_date(expiry_date) if expiry_date else "No expiry")

        # Verification instructions
        pdf.setFillColor(LIGHT)
        pdf.setFont(bold, 7)
        pdf.drawString(left, 118, "HOW TO VERIFY")
        pdf.setFillColor(GREY)
        pdf.setFont(body, 8.5)
        instructions = (
            f"Scan the QR code or open {verification_url} to check this certificate's record "
            "and status. The QR code and ID only identify the record; to confirm that this PDF "
            "file has not been altered, upload this exact file on the verification page."
        )
        y = 106
        for line in simpleSplit(instructions, body, 8.5, width - 70 - 70 - 100 - 24)[:5]:
            pdf.drawString(left, y, line)
            y -= 11

        # QR code (right)
        qr_size = 100
        qr_x = width - 70 - qr_size
        pdf.drawImage(ImageReader(io.BytesIO(qr_png)), qr_x, 45, qr_size, qr_size, mask=None)
        pdf.setFillColor(LIGHT)
        pdf.setFont(body, 7)
        pdf.drawCentredString(qr_x + qr_size / 2, 148, "Scan to verify")

        pdf.showPage()
        pdf.save()
        return buffer.getvalue()
