"""Request validation, certificate IDs, page tokens and PDF upload checks."""

from datetime import datetime, timedelta, timezone

import pytest

from shared.exceptions import InvalidPdfError, PayloadTooLargeError, ValidationFailedError
from shared.firestore_repository import decode_page_token, encode_page_token
from shared.validators import (
    CreateCertificateRequest,
    ListCertificatesQuery,
    RevokeCertificateRequest,
    parse_model,
    validate_certificate_id,
    validate_pdf_bytes,
)

GOOD = {"recipient_name": "Asha Verma", "course_name": "Cloud 101", "organization_name": "Example Academy"}
PDF = b"%PDF-1.4\n" + b"x" * 100 + b"\n%%EOF\n"


def test_valid_request_minimal_and_full():
    parse_model(CreateCertificateRequest, GOOD)
    future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    req = parse_model(CreateCertificateRequest, {**GOOD, "recipient_email": "a@example.com", "expiry_date": future})
    assert req.expiry_date.tzinfo is not None and req.expiry_date.microsecond == 0


def test_whitespace_is_collapsed_and_trimmed():
    req = parse_model(CreateCertificateRequest, {**GOOD, "recipient_name": "  Asha    Verma \t"})
    assert req.recipient_name == "Asha Verma"


@pytest.mark.parametrize("field", ["recipient_name", "course_name", "organization_name"])
def test_required_fields_missing_or_blank(field):
    data = dict(GOOD)
    data.pop(field)
    with pytest.raises(ValidationFailedError) as exc:
        parse_model(CreateCertificateRequest, data)
    assert exc.value.details[0]["field"] == field
    with pytest.raises(ValidationFailedError):
        parse_model(CreateCertificateRequest, {**GOOD, field: "   "})


def test_field_length_limits():
    with pytest.raises(ValidationFailedError):
        parse_model(CreateCertificateRequest, {**GOOD, "recipient_name": "a" * 121})
    with pytest.raises(ValidationFailedError):
        parse_model(CreateCertificateRequest, {**GOOD, "course_name": "a" * 201})


@pytest.mark.parametrize("email", ["not-an-email", "a@", "@b.com", "a b@example.com"])
def test_invalid_email_rejected(email):
    with pytest.raises(ValidationFailedError) as exc:
        parse_model(CreateCertificateRequest, {**GOOD, "recipient_email": email})
    assert exc.value.details[0]["field"] == "recipient_email"


def test_empty_email_is_treated_as_absent():
    assert parse_model(CreateCertificateRequest, {**GOOD, "recipient_email": ""}).recipient_email is None


def test_expiry_must_be_in_future_and_bounded():
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    with pytest.raises(ValidationFailedError):
        parse_model(CreateCertificateRequest, {**GOOD, "expiry_date": past})
    far = (datetime.now(timezone.utc) + timedelta(days=36600)).isoformat()
    with pytest.raises(ValidationFailedError):
        parse_model(CreateCertificateRequest, {**GOOD, "expiry_date": far})
    with pytest.raises(ValidationFailedError):
        parse_model(CreateCertificateRequest, {**GOOD, "expiry_date": "garbage"})


def test_naive_expiry_is_taken_as_utc():
    naive = (datetime.utcnow() + timedelta(days=10)).replace(tzinfo=None).isoformat()
    assert parse_model(CreateCertificateRequest, {**GOOD, "expiry_date": naive}).expiry_date.tzinfo == timezone.utc


@pytest.mark.parametrize("extra", ["created_by", "status", "issue_date", "role", "certificate_id", "is_admin"])
def test_server_controlled_fields_are_rejected(extra):
    with pytest.raises(ValidationFailedError):
        parse_model(CreateCertificateRequest, {**GOOD, extra: "x"})


@pytest.mark.parametrize("bad", ["Evil\x00Name", "bell\x07", "rtl\u202eoverride"])
def test_control_and_bidi_characters_rejected(bad):
    with pytest.raises(ValidationFailedError):
        parse_model(CreateCertificateRequest, {**GOOD, "recipient_name": bad})


def test_newlines_are_collapsed_to_single_spaces():
    assert parse_model(CreateCertificateRequest, {**GOOD, "recipient_name": "Line\nBreak"}).recipient_name == "Line Break"


def test_non_latin_names_are_accepted():
    req = parse_model(CreateCertificateRequest, {**GOOD, "recipient_name": "आशा वर्मा"})
    assert req.recipient_name == "आशा वर्मा"


def test_validation_details_never_echo_input():
    with pytest.raises(ValidationFailedError) as exc:
        parse_model(CreateCertificateRequest, {**GOOD, "recipient_email": "secret-value"})
    assert "secret-value" not in str(exc.value.details)


def test_revoke_request_requires_reason():
    assert parse_model(RevokeCertificateRequest, {"reason": "Issued in error"}).reason == "Issued in error"
    for bad in ({}, {"reason": ""}, {"reason": "ab"}, {"reason": "x" * 501}, {"reason": "ok reason", "x": 1}):
        with pytest.raises(ValidationFailedError):
            parse_model(RevokeCertificateRequest, bad)


def test_list_query_defaults_and_limits():
    q = parse_model(ListCertificatesQuery, {})
    assert (q.page_size, q.page_token, q.status) == (25, None, None)
    assert parse_model(ListCertificatesQuery, {"page_size": "100", "status": "REVOKED"}).status.value == "REVOKED"
    for bad in ({"page_size": "0"}, {"page_size": "101"}, {"status": "NOPE"}, {"unknown": "1"}):
        with pytest.raises(ValidationFailedError):
            parse_model(ListCertificatesQuery, bad)


@pytest.mark.parametrize("value", ["CERT-2026-0123456789ABCDEF0123"])
def test_valid_certificate_id(value):
    assert validate_certificate_id(value) == value


@pytest.mark.parametrize(
    "value",
    ["", "cert-2026-0123456789ABCDEF0123", "CERT-2026-SHORT", "CERT-26-0123456789ABCDEF0123",
     "CERT-2026-0123456789abcdef0123", "../etc/passwd", "CERT-2026-0123456789ABCDEF0123/x", None, 5],
)
def test_invalid_certificate_id(value):
    with pytest.raises(ValidationFailedError):
        validate_certificate_id(value)


def test_page_token_roundtrip_and_tampering():
    cid = "CERT-2026-0123456789ABCDEF0123"
    assert decode_page_token(encode_page_token(cid)) == cid
    for bad in ["!!!", encode_page_token("not-an-id"), "QQ"]:
        with pytest.raises(ValidationFailedError):
            decode_page_token(bad)


def test_pdf_validation():
    assert validate_pdf_bytes(PDF, 1024) == PDF
    with pytest.raises(InvalidPdfError):
        validate_pdf_bytes(b"", 1024)
    with pytest.raises(InvalidPdfError):
        validate_pdf_bytes(b"<html>" + b"x" * 100, 1024)
    with pytest.raises(InvalidPdfError):
        validate_pdf_bytes(b"%PDF-1.4\n" + b"x" * 100, 1024)  # truncated: no EOF marker
    with pytest.raises(PayloadTooLargeError):
        validate_pdf_bytes(PDF + b"0" * 2000, 1024)
