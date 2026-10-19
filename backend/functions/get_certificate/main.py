"""Cloud Run function `get_certificate`: GET /admin/certificates/{certificate_id} (administrator only).

Deployed with its own copy of ``shared/`` (see scripts/deploy_functions.sh).
"""

import re

import functions_framework

from shared.container import get_services
from shared.response_utils import api_endpoint, require_route

FUNCTION_NAME = "get_certificate"
ALLOWED_METHODS = ("GET",)
ROUTE_PATTERN = re.compile(r"^/admin/certificates/([^/]+)$")


@functions_framework.http
@api_endpoint(name=FUNCTION_NAME, methods=ALLOWED_METHODS)
def get_certificate(request):
    certificate_id = require_route(request.path, ROUTE_PATTERN).group(1)
    services = get_services()
    services.auth.authenticate_admin(request.headers)
    return services.certificates.get_certificate(certificate_id), 200
