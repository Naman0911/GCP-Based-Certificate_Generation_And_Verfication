"""Cloud Run function `download_certificate`: GET /admin/certificates/{certificate_id}/download (administrator only; signed URL).

Deployed with its own copy of ``shared/`` (see scripts/deploy_functions.sh).
"""

import re

import functions_framework

from shared.container import get_services
from shared.response_utils import api_endpoint, require_route

FUNCTION_NAME = "download_certificate"
ALLOWED_METHODS = ("GET",)
ROUTE_PATTERN = re.compile(r"^/admin/certificates/([^/]+)/download$")


@functions_framework.http
@api_endpoint(name=FUNCTION_NAME, methods=ALLOWED_METHODS)
def download_certificate(request):
    certificate_id = require_route(request.path, ROUTE_PATTERN).group(1)
    services = get_services()
    principal = services.auth.authenticate_admin(request.headers)
    return services.certificates.get_download_url(certificate_id, principal), 200
