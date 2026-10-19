"""Cloud Run function `create_certificate`: POST /admin/certificates (administrator only).

Deployed with its own copy of ``shared/`` (see scripts/deploy_functions.sh).
"""
# This is the file which is having the create_certificate() which is used for handling certificate issueane

import re

import functions_framework

from shared.container import get_services
from shared.response_utils import api_endpoint, require_route
from shared.validators import CreateCertificateRequest, get_json_body, parse_model

FUNCTION_NAME = "create_certificate"
ALLOWED_METHODS = ("POST",)
ROUTE_PATTERN = re.compile(r"^/admin/certificates$")


# @functions_framework.http
# @api_endpoint(name=FUNCTION_NAME, methods=ALLOWED_METHODS)
# def create_certificate(request):
#     require_route(request.path, ROUTE_PATTERN)
#     services = get_services()
#     principal = services.auth.authenticate_admin(request.headers)
#     payload = parse_model(CreateCertificateRequest, get_json_body(request))
#     return services.certificates.create_certificate(payload, principal), 201

@functions_framework.http
@api_endpoint(name=FUNCTION_NAME, methods=ALLOWED_METHODS)
def create_certificate(request):
    require_route(request.path, ROUTE_PATTERN)

    # Reject oversized request bodies before parsing JSON.
    max_request_bytes = 32 * 1024  # 32 KB

    if request.content_length is not None:
        if request.content_length > max_request_bytes:
            import json

            return (
                json.dumps({
                    "error": {
                        "code": "payload_too_large",
                        "message": "Request body exceeds the allowed size",
                    }
                }),
                413,
                {"Content-Type": "application/json"},
            )

    services = get_services()
    principal = services.auth.authenticate_admin(request.headers)

    payload = parse_model(
        CreateCertificateRequest,
        get_json_body(request),
    )

    return services.certificates.create_certificate(payload, principal), 201