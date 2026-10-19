"""Cloud Run function `verify_certificate_file`: POST /verify/{certificate_id}/file (public PDF integrity verification).

Deployed with its own copy of ``shared/`` (see scripts/deploy_functions.sh).
"""

# This file has verify_certificate_file() — checks an uploaded PDF's integrity and signature.
import re

import functions_framework

from shared.container import get_services
from shared.response_utils import api_endpoint, require_route
from shared.validators import extract_pdf_upload, validate_certificate_id

FUNCTION_NAME = "verify_certificate_file"
ALLOWED_METHODS = ("POST",)
ROUTE_PATTERN = re.compile(r"^/verify/([^/]+)/file$")


@functions_framework.http
@api_endpoint(name=FUNCTION_NAME, methods=ALLOWED_METHODS)
def verify_certificate_file(request):
    certificate_id = validate_certificate_id(require_route(request.path, ROUTE_PATTERN).group(1))
    services = get_services()
    pdf_bytes = extract_pdf_upload(request, services.settings.max_upload_bytes)
    result = services.certificates.verify_certificate_file(certificate_id, pdf_bytes)
    return result, (404 if result["status"] == "INVALID" else 200)
