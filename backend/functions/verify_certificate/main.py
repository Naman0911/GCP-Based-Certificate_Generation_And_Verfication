"""Cloud Run function `verify_certificate`: GET /verify/{certificate_id} (public record and metadata verification).

Deployed with its own copy of ``shared/`` (see scripts/deploy_functions.sh).
"""

# This file has a verify_certificate() — verifies a certificate using its ID.
import re

import functions_framework

from shared.container import get_services
from shared.response_utils import api_endpoint, require_route

FUNCTION_NAME = "verify_certificate"
ALLOWED_METHODS = ("GET",)
ROUTE_PATTERN = re.compile(r"^/verify/([^/]+)$")


@functions_framework.http
@api_endpoint(name=FUNCTION_NAME, methods=ALLOWED_METHODS)
def verify_certificate(request):
    certificate_id = require_route(request.path, ROUTE_PATTERN).group(1)
    result = get_services().certificates.verify_certificate(certificate_id)
    return result, (404 if result["status"] == "INVALID" else 200)
