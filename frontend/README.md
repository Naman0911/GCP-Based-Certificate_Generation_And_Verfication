# CertiTrust Frontend

React 19 + Vite + TypeScript frontend for the GCP certificate generation and verification backend (`backend.zip`).
Public users verify certificates (ID, QR scan, PDF upload); administrators sign in with Google Cloud Identity Platform to issue, list, view, download and revoke certificates.

## 1. Prerequisites
* Node.js 20.19+ (22 LTS recommended) and npm 10+
* The deployed backend: an API Gateway base URL (see backend `README.md`)
* An Identity Platform (Firebase Auth) web app: API key, auth domain, project ID, app ID

## 2. Install and run (VS Code)
```bash
cd frontend
npm install
cp .env.example .env      # then edit .env
npm run dev               # http://localhost:5173
```
Open the folder in VS Code and use the integrated terminal. ESLint and TypeScript work out of the box.

No backend yet? Set `VITE_ENABLE_DEMO_MODE=true` in `.env`: the UI runs on clearly labelled in-memory sample data (any login works, nothing is signed or stored). Never enable it in production.

## 3. Configuration (`.env`)
| Variable | Meaning |
|---|---|
| `VITE_API_BASE_URL` | API Gateway base URL, no trailing slash |
| `VITE_FIREBASE_API_KEY`, `_AUTH_DOMAIN`, `_PROJECT_ID`, `_APP_ID` | Identity Platform web settings (public values) |
| `VITE_PUBLIC_VERIFICATION_BASE_URL` | Base of QR/verification URLs. Must equal the backend's `PUBLIC_VERIFICATION_BASE_URL`. QR codes are accepted only if they start with this |
| `VITE_MAX_UPLOAD_SIZE_MB` | Client pre-check for PDF uploads (backend limit is authoritative) |
| `VITE_ENABLE_DEMO_MODE` | `true` = in-memory demo, no backend |
| `VITE_DEV_PROXY` | `true` = dev-only CORS workaround (section 5, option B) |

All `VITE_` values are bundled into the browser: **never put secrets or service-account keys here.** Missing values show a "Configuration required" screen listing exactly what to set.

## 4. Identity Platform setup
1. Console > Identity Platform > Enable. Add providers: **Email/Password** (and Google if you want the Google button).
2. Create an admin user. Grant admin rights on the backend with `scripts/grant_admin_claim.py` (custom claim `admin: true`) or list the email in the backend `ADMIN_EMAILS`.
3. Identity Platform > Settings > Authorized domains: add `localhost` and your production domain.
4. Application setup details > copy the web config into `.env`.
5. The ID token is sent as `Authorization: Bearer <token>`; it is refreshed automatically and once more after a 401.

The UI decides "admin or not" from the `admin` claim, or else by asking the backend (a 403 means not admin). This is UX only: the backend re-verifies the token and role on every `/admin/**` request.

## 5. CORS (important)
Browsers block cross-origin calls unless the server allows the page's origin. The backend functions send CORS headers **only for origins listed in `CORS_ALLOWED_ORIGINS`** and answer preflight (`OPTIONS`) without authentication. API Gateway adds no CORS headers itself.

**Option A (recommended, dev and production): allow the origin on the backend.**
```bash
# backend .env (comma separated, exact origins, no trailing slash, no path)
CORS_ALLOWED_ORIGINS=http://localhost:5173,https://certs.example.org
cd backend && scripts/deploy_functions.sh      # redeploys with the new env
```
Exposed headers include `X-Request-Id`. Allowed methods: GET, POST, PATCH, OPTIONS. Allowed request headers: `Authorization`, `Content-Type`. Credentials/cookies are not used.

**Option B (development only): Vite proxy.** In `.env` set `VITE_DEV_PROXY=true` and keep `VITE_API_BASE_URL` as the real gateway URL. The browser then calls `http://localhost:5173/api/...` (same origin) and Vite forwards to the gateway, so no CORS is involved. Restart `npm run dev`. The proxy does not exist in production builds.

**Option C (production alternative):** serve the frontend and API under one domain (e.g. HTTPS load balancer with `/api` to the gateway) and set `VITE_API_BASE_URL` to the relative path.

CORS troubleshooting:
| Symptom | Fix |
|---|---|
| Console: "blocked by CORS policy ... No 'Access-Control-Allow-Origin'" | Origin missing in `CORS_ALLOWED_ORIGINS` (check scheme, host, port); redeploy functions |
| Preflight fails with 401/403 | The gateway must route `OPTIONS` to the function without auth (included in `api/openapi.yaml`); redeploy the gateway config |
| Works for `/verify`, fails for `/admin` with a CORS error only | The gateway rejected the JWT (401 from the gateway carries no CORS headers). Check the token/project ID, not CORS |
| App says "Could not reach the server ... (CORS)" | Same as above; open DevTools > Network |
| Works with proxy, fails without | Option A is not configured |

## 6. Backend contract used
| Operation | Request |
|---|---|
| Verify ID | `GET /verify/{id}` (404 body is `status: INVALID`) |
| Verify PDF | `POST /verify/{id}/file` multipart field `file` |
| Create | `POST /admin/certificates` `{recipient_name, recipient_email?, course_name, organization_name, expiry_date?}` (issue date is set by the server) |
| List | `GET /admin/certificates?page_size&page_token&status` (cursor pagination) |
| Details | `GET /admin/certificates/{id}` |
| Revoke | `PATCH /admin/certificates/{id}/revoke` `{reason}` |
| Download | `GET /admin/certificates/{id}/download` returns a short-lived signed URL |

Responses are validated with Zod at the API boundary (`src/types/certificate.ts`). Notes from the contract: there is no server search, so the search box filters the rows of the current page; counts on the dashboard come from walking real list pages (capped at 2,000); the QR image is inside the PDF, the API returns only the verification URL.

Verification display: record status, metadata signature and PDF integrity are always shown separately. A result from an ID/QR check says "PDF not checked" and never claims the file is unmodified.

## 7. Commands
| Command | Purpose |
|---|---|
| `npm run dev` | Dev server on :5173 |
| `npm run build` | Typecheck + production build in `dist/` |
| `npm run preview` | Serve `dist/` locally |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript project check |
| `npm run test` | Vitest + React Testing Library (118 tests) |

## 8. Camera permissions
The camera starts only after you press "Start camera" and stops on success, Stop, or leaving the page. It needs HTTPS or `localhost`. If blocked, allow the camera for the site in the browser's address-bar settings; the ID entry is always available. Only configured verification URLs or plain certificate IDs are accepted from a QR code; anything else is ignored.

## 9. Static hosting
`npm run build` produces static files in `dist/`. Host anywhere with an SPA fallback (all paths serve `index.html`):
* **Firebase Hosting:** `firebase init hosting` (public dir `dist`, single-page app: yes) then `firebase deploy`. Add the hosting domain to Authorized domains and to `CORS_ALLOWED_ORIGINS`.
* **Cloud Storage + HTTPS load balancer:** set `index.html` as both main and 404 page.
* **Cloud Run (nginx)** or any static host.

Set `VITE_PUBLIC_VERIFICATION_BASE_URL` to `https://<your-domain>/verify` before building, and use the same value in the backend.

## 10. Security notes
* No secrets in the bundle; Firebase web config values are public by design.
* Tokens live in the Firebase SDK's storage; the app never logs them. Requests use `credentials: 'omit'`.
* Errors shown to users are generic; server 5xx errors show only the `request_id`.
* Inputs are validated client-side (Zod) for convenience; the backend validates again.
* Admin pages are guarded for UX; real authorization is the backend's.
* Serve over HTTPS with a Content-Security-Policy allowing `https://*.googleapis.com`, `https://*.firebaseapp.com`, your API host and (for PDFs) Cloud Storage downloads.
* Signed download URLs are short-lived and fetched fresh on every click.

## 11. Troubleshooting
| Problem | Check |
|---|---|
| "Configuration required" screen | `.env` values; restart dev server after edits |
| `auth/unauthorized-domain` | Add the domain in Identity Platform > Authorized domains |
| Signed in but "Access denied" | Account is not admin on the backend (claim or `ADMIN_EMAILS`) |
| Constant redirects to login | Token rejected (401): wrong project ID on the gateway/functions |
| QR scan ignored | QR must start with `VITE_PUBLIC_VERIFICATION_BASE_URL` |
| PDF upload 413 / 422 | Larger than backend `MAX_UPLOAD_SIZE_MB`, or not a PDF |
| Download does nothing | Allow pop-ups; the link opens in a new tab |

## 12. Project layout
`src/app` (router, query client) · `src/components` (ui, layout, feedback, certificates, verification) · `src/features` (auth, dashboard, certificates, verification) · `src/lib` (apiClient, env, firebase, utils, files) · `src/services` (HTTP + demo service) · `src/types` · `tests/`
