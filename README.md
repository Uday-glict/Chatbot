# ChatBot

## Cloud Firestore setup

The server uses the Firebase Admin SDK and Application Default Credentials (ADC).
`FIREBASE_PROJECT_ID` must be the Firebase/GCP project that owns the Cloud
Firestore database. The server performs a read-only Firestore connectivity check
before it starts listening.

### Windows PowerShell local development

Use a service-account key only on the local machine, outside the repository:

```powershell
$env:FIREBASE_PROJECT_ID = "your-firebase-project-id"
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\secure\firebase-service-account.json"
Remove-Item Env:FIRESTORE_EMULATOR_HOST -ErrorAction SilentlyContinue

npm run migrate
npm run dev:server
```

`GOOGLE_APPLICATION_CREDENTIALS` is optional when another ADC provider is
available, such as an authenticated Google Cloud environment. Never commit a
service-account JSON file, private key, or token.

### Deployment variables

Set these in the deployment environment or secret manager:

- `DATABASE_URL` — PostgreSQL connection string.
- `FIREBASE_PROJECT_ID` — intended Cloud Firestore project ID.
- `GOOGLE_APPLICATION_CREDENTIALS` — path to a mounted service-account JSON
  file when the deployment does not provide ADC through its runtime identity.
- `FIRESTORE_EMULATOR_HOST` — omit or leave empty in cloud and production.

The server will refuse to become ready when PostgreSQL or Firestore is not
reachable, or when the initialized Firebase project does not match
`FIREBASE_PROJECT_ID`.

### Automated tests

Tests force `FIREBASE_PROJECT_ID=demo-chat` and use in-memory repositories unless
`FIRESTORE_EMULATOR_HOST` is explicitly provided. This keeps integration tests
isolated from real Firebase collections. Do not point test runs at a production
project.
