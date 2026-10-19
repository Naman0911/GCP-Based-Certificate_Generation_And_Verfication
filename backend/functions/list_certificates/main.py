"""Cloud Run function `list_certificates`: GET /admin/certificates (administrator only, paginated).

Deployed with its own copy of ``shared/`` (see scripts/deploy_functions.sh).
"""

import re

import functions_framework

from shared.container import get_services
from shared.response_utils import api_endpoint, require_route
from shared.validators import ListCertificatesQuery, parse_model

FUNCTION_NAME = "list_certificates"
ALLOWED_METHODS = ("GET",)
ROUTE_PATTERN = re.compile(r"^/admin/certificates$")


@functions_framework.http
@api_endpoint(name=FUNCTION_NAME, methods=ALLOWED_METHODS)
def list_certificates(request):
    require_route(request.path, ROUTE_PATTERN)
    services = get_services()
    services.auth.authenticate_admin(request.headers)
    query = parse_model(ListCertificatesQuery, {key: request.args.get(key) for key in request.args})
    result = services.certificates.list_certificates(
        page_size=query.page_size, page_token=query.page_token, status=query.status
    )
    return result, 200
