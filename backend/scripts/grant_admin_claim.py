#!/usr/bin/env python3
"""Grant (or revoke) the ``admin`` custom claim on an Identity Platform user.

This is the supported way to provision the *first administrator* without
editing ``ADMIN_EMAILS``.  It runs on your machine with Application Default
Credentials, so the caller needs permission to manage Identity Platform users
(for example ``roles/firebaseauth.admin``).

    gcloud auth application-default login
    python3 scripts/grant_admin_claim.py --project my-project --email you@example.com

The user must sign out and back in (or refresh their ID token) before the new
claim appears in their token.
"""

from __future__ import annotations

import argparse
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--project", required=True, help="Identity Platform project ID")
    parser.add_argument("--email", required=True, help="Email of an existing user")
    parser.add_argument("--revoke", action="store_true", help="Remove the admin claim instead")
    args = parser.parse_args()

    import firebase_admin
    from firebase_admin import auth

    firebase_admin.initialize_app(options={"projectId": args.project})
    try:
        user = auth.get_user_by_email(args.email)
    except auth.UserNotFoundError:
        print(f"ERROR: no user with email {args.email}; create the account first.", file=sys.stderr)
        return 1

    claims = dict(user.custom_claims or {})
    if args.revoke:
        claims.pop("admin", None)
    else:
        claims["admin"] = True
    auth.set_custom_user_claims(user.uid, claims or None)
    action = "removed from" if args.revoke else "granted to"
    print(f"admin claim {action} {args.email} (uid {user.uid}). Ask the user to sign in again.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
