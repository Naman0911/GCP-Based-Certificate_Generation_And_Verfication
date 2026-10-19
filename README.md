# Certificate Generation and Verification System

A cloud-based application for generating digital certificates and verifying their authenticity. The project separates the frontend and backend, and uses cryptographic signatures to help detect certificate tampering.

## Features

- Generate certificates from submitted details.
- Create downloadable certificate PDFs with QR-based verification.
- Verify certificates using a certificate ID or QR code.
- Verify uploaded certificate PDFs for integrity.
- Track certificate status, including revocation and expiry where configured.
- Authenticate users and protect administrative operations.
- Store certificate files and metadata separately.
- Record important certificate actions for auditing.

## Project Structure

```text
Separate/
├── backend/     # API endpoints, certificate generation, verification, and data handling
├── frontend/    # User interface
├── .gitignore   # Ignores local environment files, secrets, and generated files
└── README.md
```

## How It Works

### Certificate Generation

1. An authorized user submits certificate details through the frontend.
2. The backend validates the request and prepares the certificate metadata.
3. The system generates a certificate ID and creates the PDF, including a QR code for verification.
4. A cryptographic hash is calculated and digitally signed using the signing key.
5. The PDF and its metadata are stored.
6. The frontend receives the result and provides access to the generated certificate.

### Certificate Verification

1. A user enters a certificate ID, scans its QR code, or uploads a certificate PDF.
2. The backend retrieves the associated certificate record.
3. The system recalculates the relevant hash and verifies the digital signature using the corresponding public key.
4. The backend checks the certificate's recorded status, such as revoked or expired.
5. The system returns a verification result.

A digital signature helps verify data integrity and authenticity. A valid signature does not by itself mean a certificate is current; status checks are also required.

## Technology Stack

The project is designed around the following technologies and services:

- **Frontend:** Web application hosted using Firebase Hosting
- **Backend:** Python serverless functions
- **API routing:** API Gateway
- **Database:** Firestore
- **File storage:** Cloud Storage
- **Cryptography:** SHA-256 and RSA digital signatures using Cloud KMS
- **Authentication:** Firebase Authentication / Identity Platform
- **PDF generation:** ReportLab
- **QR code generation:** `qrcode` and Pillow

## Configuration

Keep credentials and environment-specific configuration in local environment files. Do not commit `.env` files, private keys, service-account credentials, or other secrets to version control.

1. Review the configuration required by the backend and frontend.
2. Create local environment files based on the variables required by each application.
3. Enable the required APIs and configure access permissions for your deployment environment.
4. Use the project's `.gitignore` to prevent local secrets and generated files from being committed.

Do not place real credentials in example configuration files.

## Running Locally

The exact commands depend on the scripts and dependency files currently present in the `backend/` and `frontend/` directories.

1. Clone or download the repository.
2. Install the backend dependencies listed in the backend's dependency file.
3. Install the frontend dependencies using the package manager and lockfile provided by the frontend.
4. Configure the required environment variables and credentials locally.
5. Start the backend and frontend using their documented development commands.

Refer to the individual backend and frontend folders for their specific setup instructions.

## Security Notes

- Keep private signing keys protected; never include them in the frontend.
- Verify signatures with the corresponding public key.
- Validate uploaded files and API inputs.
- Restrict administrative actions to authorized users.
- Keep storage private where appropriate.
- Avoid committing secrets or production credentials.
- Check certificate status separately from cryptographic integrity.

## Future Improvements

- Add automated tests for generation, verification, expiry, and revocation.
- Add CI/CD checks and deployment automation.
- Improve monitoring, error reporting, and audit visibility.
- Document API endpoints and environment variables in detail.

## License

Add the project's chosen license here if it will be distributed publicly.
