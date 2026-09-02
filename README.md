# Sanchandana Backend

Sanchandana Backend is the Node.js API for a Karnataka ethnic-fashion storefront and administration experience. It owns authentication, catalog and inventory rules, pricing, checkout, orders, shipping eligibility, payments, media authorization, notifications, and administrative operations. The service is a modular monolith designed to keep business rules authoritative on the server.

## Project overview

This repository contains the Express API and operational scripts. The independently deployed React storefront communicates with it through a same-origin `/api` reverse proxy. Browser clients must not be trusted to decide roles, ownership, stock, prices, coupons, shipping eligibility, payment outcomes, or order state.

Key characteristics:

- REST-style API under `/api`
- customer and administrator authentication with short-lived access tokens and refresh sessions
- MongoDB persistence through Mongoose
- transaction-aware checkout and order workflows
- signed direct-to-Cloudinary media uploads with server-side verification
- provider boundaries for media, payments, email, notifications, and optional AI features
- structured logs, request IDs, validation, rate limiting, CORS, CSRF protection, and centralized errors

Architectural decisions and operational invariants are recorded in [docs/DECISIONS.md](docs/DECISIONS.md).

## Architecture

The application follows a modular-monolith structure:

```text
src/
├── server.js             # process lifecycle, listener, and graceful shutdown
├── app.js                # Express composition and middleware order
├── config/               # validated environment, database, CORS, cookies
├── middleware/           # auth, ownership, CSRF, validation, errors, limits
├── modules/              # domain models, services, controllers, and routes
├── routes/index.js       # central /api route aggregation
├── services/             # provider adapters (media, payment, email, AI)
├── utils/                # errors, logging, responses, schemas
└── validators/           # shared request schemas
scripts/                  # seeding, indexes, admin, notifications, media jobs
```

`src/config/env.js` is the sole validated environment boundary. `src/server.js` connects infrastructure and controls shutdown, while `src/app.js` establishes security middleware, parsers, routes, not-found handling, and centralized error handling. Domain behavior belongs under `src/modules`; external providers remain behind `src/services` adapters.

## Tech stack

- Node.js 20 or newer, ECMAScript modules
- Express 4
- MongoDB with Mongoose 8
- Zod for environment and request validation
- Argon2id and JSON Web Tokens for authentication
- Cloudinary for managed image and video assets
- Nodemailer for SMTP delivery
- Pino and Pino HTTP for structured logging
- Vitest, Supertest, and `mongodb-memory-server` for tests

## Setup

Prerequisites:

- Node.js 20+
- npm
- a MongoDB deployment
- Cloudinary and SMTP accounts when exercising those provider-backed features

From this repository in PowerShell:

```powershell
npm ci
Copy-Item .env.example .env
```

Edit `.env` with environment-specific values before starting the process. The committed [`.env.example`](.env.example) is the backend-only template; never commit `.env` or any real credential.

Optional provider settings are commented out in `.env.example`; uncomment and fill them only when enabling that provider. Production has stricter provider requirements described below.

Start local development:

```powershell
npm run dev
```

The default API base is `http://localhost:5000/api`.

## Environment variables

All variables are validated at startup. Use [`.env.example`](.env.example) as the authoritative backend example and keep secrets in the deployment platform's secret manager.

| Area            | Variables                                                           | Notes                                                                  |
| --------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Runtime         | `NODE_ENV`, `PORT`, `API_PREFIX`                                    | Production must set `NODE_ENV=production`.                             |
| Database        | `MONGODB_URI`, `MONGODB_DB_NAME`                                    | Use a least-privilege application database user.                       |
| Authentication  | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, token TTL settings       | Access and refresh secrets must be strong and distinct.                |
| Browser origins | `CORS_ALLOWED_ORIGINS`, `STOREFRONT_URL`                            | Use exact HTTPS production origins, never wildcard CORS.               |
| Payments        | `PREPAID_PROVIDER`, provider and payment timing settings            | `MOCK_PREPAID` is development/test only and is rejected in production. |
| Media           | `CLOUDINARY_CLOUD_NAME`, server credentials, signed preset names    | API key and secret are server-only.                                    |
| Email           | `EMAIL_PROVIDER`, `EMAIL_FROM`, SMTP settings                       | Production requires an SMTP-backed configuration.                      |
| Notifications   | encryption key/key ID, previous-key slots, batch and lease settings | Follow the rotation notes in the template; never log key material.     |
| Operations      | log, rate-limit, and request-size settings                          | Tune to the deployed topology and traffic profile.                     |

Do not copy backend variables into the frontend. In particular, database URLs, JWT secrets, Cloudinary credentials, SMTP credentials, notification keys, and future payment/carrier/AI credentials must never use a `VITE_` prefix.

## Database setup

1. Provision MongoDB and create a least-privilege application user.
2. Set `MONGODB_URI` and `MONGODB_DB_NAME` in the uncommitted `.env` or deployment secret store.
3. Use a transaction-capable replica set for production; standalone MongoDB is not a valid production checkout deployment.
4. Create schema-declared indexes additively (the command never drops manually managed or rolling-migration indexes):

   ```powershell
   npm run db:indexes
   ```

5. Optionally seed reference data:

   ```powershell
   npm run seed -- --mode=reference
   npm run seed -- --only=pincodes
   ```

The bundled pincode seed is a 26-row Karnataka district-headquarters starter dataset, not complete launch-ready serviceability coverage. Missing pincodes remain unknown; load and validate authoritative business data before launch.

To create the first administrator without placing a password in shell history or command arguments:

```powershell
$env:ADMIN_PASSWORD="use-a-strong-password"
npm run create:admin -- --email=owner@example.com --name="Administrator"
Remove-Item Env:ADMIN_PASSWORD
```

Replace the placeholders locally and clear the process-scoped variable immediately afterward.

## Normal-order invoice policy

Invoices are disabled until an immutable policy is explicitly published. Do not guess the effective date, eligible-order date, legal name, or complete printed address. After every fact and the non-GST status are confirmed, publish version 1 with explicit ISO-8601 timing:

```powershell
npm run invoice:publish -- --version=1 --effective-from=2026-09-01T00:00:00+05:30 --eligible-order-from=2026-09-01T00:00:00+05:30 --legal-name="CONFIRMED LEGAL NAME" --address-lines="CONFIRMED STREET ADDRESS|CONFIRMED LOCALITY" --state="CONFIRMED STATE" --state-code="CONFIRMED TWO-DIGIT CODE" --pincode="CONFIRMED SIX-DIGIT PINCODE" --confirm-non-gst=true
npm run db:indexes
```

Replace every example value and placeholder with explicitly approved facts. Optional `--brand-name`, `--email`, and `--phone` values are omitted or use the approved brand `Sanchandana` as applicable. Invoice contract version 1 always uses prefix `SAN`, six-digit sequences, and non-GST `NONE` modes; these are not publication options.

Policies are append-only. To change seller or tax facts, publish a higher version with a later effective date; never modify an issued invoice or an existing policy. With no effective policy, shipment still succeeds but no invoice is issued. Orders older than the selected policy's eligible-order date, historical orders, and CustomOrder records remain excluded. The current policy is non-GST and does not implement GSTIN, HSN/SAC, tax rates, CGST/SGST/IGST, IRN, e-invoice, B2B, or custom-order invoicing.

## Cloudinary setup

1. Create a Cloudinary account and configure separate production credentials.
2. Put the cloud name, API key, and API secret in backend secrets only.
3. Create signed image and video upload presets matching the configured names and maximum sizes.
4. Allow only `jpg`, `jpeg`, `png`, and `webp` for images, and `mp4` and `webm` for videos.
5. Before deployment, verify the media configuration:

   ```powershell
   npm run media:preflight
   ```

The browser requests a signed upload intent from this API, uploads directly to Cloudinary, and then asks the API to verify and persist the provider asset. Upload presets are signed; the API secret is never sent to the browser. Run `npm run media:reconcile` on an external schedule to reconcile retained provider assets.

## API setup

Local endpoints use the configured prefix, `/api` by default:

- API base: `http://localhost:5000/api`
- liveness: `GET /api/health`
- readiness: `GET /api/ready`

Successful responses use a consistent envelope:

```json
{
  "success": true,
  "data": {},
  "meta": {}
}
```

Failures use a stable error shape and include the request identifier when available:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Safe client-facing message",
    "details": {},
    "requestId": "request-id"
  }
}
```

Production must route the storefront's same-origin `/api/*` requests to this service. Do not configure the browser to call an unrelated cross-origin API: refresh-cookie and CSRF behavior relies on the same-origin deployment contract.

## Development commands

| Command                            | Purpose                                                             |
| ---------------------------------- | ------------------------------------------------------------------- |
| `npm run dev`                      | Start the API with Node's file watcher.                             |
| `npm start`                        | Start the API without watch mode.                                   |
| `npm test`                         | Run the Vitest suite once.                                          |
| `npm run test:watch`               | Run Vitest in interactive watch mode.                               |
| `npm run db:indexes`               | Add missing schema-declared indexes without dropping other indexes. |
| `npm run invoice:publish -- ...`   | Publish one explicit immutable normal-order invoice policy.         |
| `npm run seed -- --mode=reference` | Run reference seeders.                                              |
| `npm run seed -- --only=pincodes`  | Run only the pincode seeder.                                        |
| `npm run notifications:dispatch`   | Claim and dispatch one notification batch.                          |
| `npm run media:preflight`          | Validate media-provider migration readiness.                        |
| `npm run media:reconcile`          | Reconcile media-provider assets.                                    |
| `npm run create:admin -- ...`      | Create an administrator using `ADMIN_PASSWORD`.                     |
| `npm run audit`                    | Audit production dependencies.                                      |

## Production build

There is no transpilation or bundle step. The production artifact is the source tree plus production dependencies, and Node starts it directly:

```powershell
npm ci --omit=dev
npm start
```

Build immutable deployment artifacts in CI, set `NODE_ENV=production`, and inject configuration at runtime. Do not bake `.env` or secrets into an image or archive.

## Deployment

A production deployment must provide:

- Node.js 20+ behind an HTTPS reverse proxy or managed load balancer
- a transaction-capable MongoDB replica set
- exact HTTPS values aligned across `STOREFRONT_URL`, `CORS_ALLOWED_ORIGINS`, and the frontend site origin
- a same-origin storefront proxy from `/api/*` to this service
- distinct production JWT secrets
- production Cloudinary credentials and signed image/video presets
- SMTP delivery and a managed notification-encryption key/key ID
- centralized secret storage, structured-log collection, health checks, and graceful shutdown time

Before releasing, run `npm run media:preflight` and `npm run db:indexes`. The index command is additive; destructive index removal requires a separate reviewed migration. Schedule `npm run notifications:dispatch` and `npm run media:reconcile` externally; they are finite jobs, not in-process schedulers. If scaling horizontally, preserve database transactions and move rate-limit coordination to a shared store before relying on per-process limits.

Complete the source and deployment gates in [`docs/SECURITY.md`](docs/SECURITY.md), including approved RPO/RTO values, monitored backups, and a measured restore drill. Source review does not establish that production TLS, secrets, proxy headers, schedules, backups, or provider settings are correct.

## Security notes

The authoritative source-review findings, recovery runbook, residual risks, and release checklist are in [`docs/SECURITY.md`](docs/SECURITY.md). It deliberately leaves deployment-only checks open until an operator records evidence.

- Never commit `.env`, credentials, private keys, tokens, customer data, or production exports.
- Use strong, unrelated access/refresh JWT secrets and rotate them through managed secrets.
- Keep refresh tokens in HttpOnly cookies; CSRF protections apply to refresh and logout flows.
- Keep Cloudinary API secrets, payment credentials, SMTP credentials, and notification encryption keys server-side.
- Use exact allowlisted HTTPS origins. Never deploy wildcard credentialed CORS.
- Treat all browser input and client-calculated totals as untrusted; server rules remain authoritative.
- Use least-privilege database and provider accounts, dependency audits, request limits, rate limits, structured logging, and monitored health/readiness checks.
- Never log passwords, tokens, encrypted-notification plaintext, recipient addresses, or provider secrets.

## Future integrations

These are planned extension points, not active production capabilities:

- a production PhonePe payment adapter after its contract and credentials are approved
- Shiprocket or another carrier for live shipping and fulfillment synchronization
- an optional external AI/LLM provider behind the server adapter
- referral attribution and reward processing
- a loyalty ledger with earn, redeem, and expiry rules
- WhatsApp/SMS provider automation
- a shared rate-limit store for horizontally scaled API instances

Do not add placeholder credentials for deferred providers. Add environment variables only when an implemented adapter requires them, and keep every provider secret on the server.
