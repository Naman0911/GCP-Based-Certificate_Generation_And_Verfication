"""Cloud Run function `revoke_certificate`: PATCH /admin/certificates/{certificate_id}/revoke (administrator only).

Deployed with its own copy of ``shared/`` (see scripts/deploy_functions.sh).
"""

import re

import functions_framework

from shared.container import get_services
from shared.response_utils import api_endpoint, require_route
from shared.validators import RevokeCertificateRequest, get_json_body, parse_model

FUNCTION_NAME = "revoke_certificate"
ALLOWED_METHODS = ("PATCH",)
ROUTE_PATTERN = re.compile(r"^/admin/certificates/([^/]+)/revoke$")


@functions_framework.http
@api_endpoint(name=FUNCTION_NAME, methods=ALLOWED_METHODS)
def revoke_certificate(request):
    certificate_id = require_route(request.path, ROUTE_PATTERN).group(1)
    services = get_services()
    principal = services.auth.authenticate_admin(request.headers)
    payload = parse_model(RevokeCertificateRequest, get_json_body(request))
    result = services.certificates.revoke_certificate(certificate_id, payload.reason, principal)
    return result, 200
