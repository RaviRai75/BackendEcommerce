# Security, architecture, and production-readiness report

This report records the Task 76 source review and the controls that must be re-verified for each production release. It is not a claim that the application is completely secure. Security is an ongoing engineering and operational process.

## Assurance boundary

The review covered the frontend and backend source, configuration templates, automated tests, dependency manifests, and local production bundling. It did **not** inspect private deployment secrets or the backend `.env` file. Static review cannot verify the production TLS certificate, reverse proxy, CDN headers, provider dashboards, database query plans, backup jobs, restore results, real-device behavior, Lighthouse/Web Vitals, or sustained-load behavior. Those remain deployment gates below.

Task 39 Invoice/GST/tax behavior remains deferred. No invoice or tax contract is implied by this report.

## Architecture quality check

| Required check                      | Evidence and conclusion                                                                                                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One deployable backend              | Yes. Express and all backend modules run as one Node.js application. Finite notification/media jobs share the same codebase but run as external scheduled commands.                                                 |
| Business modules clearly separated  | Yes. Domain folders own models, validators, controllers, services, and routes.                                                                                                                                      |
| Thin controllers                    | Yes. Controllers adapt HTTP input/output and delegate domain work to services.                                                                                                                                      |
| Business logic in services          | Yes. Commerce rules and state transitions live in service modules.                                                                                                                                                  |
| External providers abstracted       | Yes for implemented providers; future providers must preserve the same boundary.                                                                                                                                    |
| Shiprocket behind `shippingService` | Qualified: no live Shiprocket adapter exists. Current shipping is manual/server-owned; a future carrier adapter must be added behind the shipping service rather than routes or controllers.                        |
| Payment behind `paymentService`     | Yes. Payment initiation, verification, webhook handling, reconciliation, and provider selection use payment service/provider boundaries. Real prepaid remains disabled until an approved production adapter exists. |
| Cloudinary behind `mediaService`    | Yes. The browser receives short-lived signed intents; the backend verifies provider assets before persistence.                                                                                                      |
| AI behind `aiService`               | Qualified: no external AI provider is active. The reserved service boundary must be used if an approved provider is introduced.                                                                                     |
| One MongoDB database                | Yes. The modular monolith uses one Mongoose connection/database with collection and service boundaries.                                                                                                             |
| Feature-based frontend              | Yes. Pages, state, API adapters, and components are grouped by feature/domain.                                                                                                                                      |
| Centralized API calls               | Yes. Network behavior is centralized through the API client and feature API modules.                                                                                                                                |
| Simple state management             | Yes. React context and TanStack Query are used without an unnecessary global-state framework.                                                                                                                       |
| No unnecessary microservices        | Yes. The system remains a modular monolith.                                                                                                                                                                         |
| No unnecessary dependencies         | Yes by source review; dependency audit results must also pass the release gate.                                                                                                                                     |
| Modules extractable later           | Yes. Public service/provider boundaries and domain folders permit later extraction, while no extraction is currently justified.                                                                                     |

## Implemented security controls

| Area                         | Implemented controls and evidence                                                                                                                                                                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication               | Argon2id password hashing; password policy; non-enumerating login/reset behavior; login throttling and lockout; short-lived access tokens; rotating, hashed refresh sessions; reuse detection; short-lived single-use reset tokens; logout and security-epoch invalidation.            |
| Session privacy              | Refresh token in an HttpOnly cookie; CSRF cookie/header pairing for cookie-authenticated mutations; server-authoritative session lookup; session listings omit full IP addresses; sensitive account/session responses use `Cache-Control: private, no-store`.                          |
| RBAC and IDOR                | Database-authoritative USER/ADMIN checks; protected routes; ownership derived from the authenticated principal rather than client IDs; negative authorization tests for account, order, exchange, admin, and support boundaries.                                                       |
| Validation and injection     | Strict Zod request schemas; simple query parser; stripping of `$`-prefixed and dotted keys; strict Mongoose schemas/query behavior; bounded body sizes; server-owned money, stock, coupon, shipping, and state transitions.                                                            |
| Rate limits and abuse        | Global and targeted authentication, password-reset, quote/order, review, exchange, upload, and other domain limits. Current storage is process-local and is not sufficient for horizontal scaling.                                                                                     |
| Browser and transport policy | Exact credentialed CORS allow-list; real preflight coverage; Helmet CSP and security headers; production HSTS configuration; permissions policy; explicit Node request/header/keep-alive/socket limits. The storefront must supply its production CSP and headers at the hosting edge. |
| CSRF                         | Refresh and logout require a matching readable CSRF cookie and request header; unexpected origins are rejected. Bearer-authenticated API writes do not rely on ambient cookies.                                                                                                        |
| Uploads                      | Signed direct-to-Cloudinary intents, purpose/format/size constraints, backend verification before references are persisted, migration preflight, and reconciliation command.                                                                                                           |
| Payment/webhooks             | Server-calculated totals; provider abstraction; signature and timestamp verification; idempotency; event persistence; reconciliation; production rejection of the mock provider.                                                                                                       |
| Stock/orders/coupons         | Transaction-required checkout; atomic stock and coupon accounting; idempotent placement; exact release/restore paths; race and abuse tests.                                                                                                                                            |
| Exchanges                    | Ownership and eligibility checks; immutable line identity; admin state machine; fee/refund controls; media validation; authorization and concurrency tests.                                                                                                                            |
| Admin                        | Backend RBAC, permanent-action confirmations in the UI, audit logging, no-store policies on private reads, server-owned analytics, and no client role trust.                                                                                                                           |
| Logging/errors               | Request IDs; structured logs; secret/header redaction; query strings excluded from access paths; scrubbed audit metadata; sanitized production error envelopes; no stack traces returned.                                                                                              |
| Configuration/secrets        | Boot-time validation; production-only invariants; example templates contain no real secrets; server credentials are never exposed through `VITE_` variables; private deployment configuration was intentionally not inspected.                                                         |
| Database/indexes             | Production auto-indexing disabled; explicit additive declared-index creation preserves manual and rolling-migration indexes; majority write concern; replica-set transactions required for commerce invariants.                                                                        |
| Frontend                     | Access token held in memory; no long-lived auth token in local storage; server-authoritative business data; protected routes; public production source maps disabled by default; secondary routes split into on-demand chunks.                                                         |

## Review findings remediated in Task 76

- Sensitive `/auth/me`, `/auth/sessions`, and `/admin/audit-logs` reads now explicitly prevent shared/private caching.
- Auth services now retain controller-supplied transport-neutral IP/user-agent context for sessions and reset intents.
- Production index deployment is additive and cannot silently drop an undeclared/manual index.
- The HTTP server now applies explicit request, header, keep-alive, and per-socket request bounds.
- The environment template includes the supported shipping state allow-list setting.
- Social-share HTML escaping, production HSTS options, CORS preflights, access-log query stripping, and metadata retention have focused regression coverage.
- The storefront removed permanently inert Buy-now/WhatsApp affordances, added mobile definition-list presentations for admin tables, and disables public source maps.
- A no-write production build verified route splitting without replacing committed `dist`; safe secondary-route splitting reduced the raw entry chunk from 784,597 to 736,759 bytes (about 6.1%), produced 54 JavaScript chunks, and emitted zero source maps. Critical account, checkout, order, exchange, coupon, and dashboard entry routes remain eager because full-suite evidence showed that broader splitting destabilized their immediate-entry contract.

## Backup and disaster-recovery runbook

No production backup job or restore drill was observable from source and none is claimed as active. The deployment owner must complete and evidence this runbook before launch.

### Policy to approve and configure

1. Assign a named primary owner and deputy for database recovery.
2. Enable provider-managed encrypted snapshots for the production MongoDB deployment. Enable point-in-time recovery when the selected plan supports it.
3. Define and approve the business RPO and RTO. Do not infer them from provider defaults. Record the approved values, snapshot frequency, PITR window, retention periods, regions, and deletion policy in the deployment record.
4. Keep backups in a separate failure domain/account boundary where the provider supports it. Restrict backup/restore permissions with least privilege and MFA.
5. Include database data and required operational configuration. Keep secrets in the secret manager; never place plaintext secrets in backup documentation or source control.
6. Monitor backup success/failure and storage exhaustion. Route alerts to the named owner and deputy.

### Restore procedure

1. Declare the incident, stop or isolate writes, record the suspected corruption/incident time, and preserve logs/audit evidence.
2. Select a restore point that satisfies the approved RPO and predates corruption. Restore to an isolated database/cluster first; do not overwrite production as the first action.
3. Use temporary least-privilege credentials and verify collection counts, critical indexes, schema compatibility, administrator access, recent orders, stock, coupon counters, sessions, payment events, exchanges, and audit-log continuity.
4. Run readiness checks and targeted commerce smoke tests against the isolated restore. Reconcile payment/provider events received after the restore point before reopening writes.
5. Obtain explicit incident-owner approval, rotate affected credentials, switch traffic using the provider-approved procedure, and monitor errors, latency, and reconciliation queues.
6. Document actual data loss and recovery time, notify affected stakeholders under the applicable incident policy, and remove temporary restore resources securely.

### Drill and evidence

- Run a restore drill before first production launch and at least quarterly thereafter, plus after material database/topology changes.
- Record snapshot/restore identifiers, timestamps, measured RPO/RTO, validation results, operator names, defects, and follow-up owners outside the application repository.
- A green backup job alone is not evidence of recoverability; only a validated restore drill closes this gate.

## Remaining risks and deployment dependencies

- Real prepaid checkout is unavailable until a production provider contract, adapter, credentials, and end-to-end reconciliation are approved and tested.
- Fulfillment is manual; no live Shiprocket integration is active.
- Pending-prepaid expiry/release requires an approved external scheduling policy before real prepaid launch.
- Rate limiting is per process. Horizontal deployments require a shared store and a coordinated abuse policy.
- `trust proxy = 1` is correct only behind exactly one trusted proxy hop; verify topology and spoofing behavior.
- Refresh/CSRF behavior requires a same-origin `/api` reverse proxy and aligned HTTPS origins.
- Notification dispatch and media reconciliation require monitored external schedules.
- Checkout and protected commerce writes require a transaction-capable replica set.
- Production secrets, origins, SMTP, Cloudinary, TLS, CDN, and provider settings remain unverified until deployment review.
- TOTP is reserved architecture, not an implemented control. Compensate with strong admin credentials, session review, least privilege, and provider/host MFA; prioritize admin MFA.
- The bundled 26-row pincode seed is not authoritative launch serviceability data.
- Real-device responsive/accessibility behavior, screen-reader behavior, Lighthouse/Web Vitals, load behavior, CDN caching/headers, and Atlas `explain()` plans require staging/production evidence.
- Accessibility implementation was reviewed, but no formal WCAG certification is claimed.

## Recommended future improvements

1. Add admin MFA and recovery controls after an approved identity contract.
2. Move rate-limit state to a shared store before horizontal scaling.
3. Add automated deployed-header, CORS/preflight, cookie, deep-link, and same-origin proxy smoke tests.
4. Add monitored Web Vitals/error reporting with privacy approval; upload source maps privately rather than publishing them.
5. Establish SLOs and alerts for readiness, error rate, latency, queue age, failed notifications, payment reconciliation, and backup failures.
6. Run scheduled dependency review, DAST, authenticated authorization testing, restore drills, and incident-response exercises.
7. Capture representative load tests and MongoDB query plans using production-like, non-sensitive data before traffic growth.

## Production deployment checklist

Source-level checks marked complete still require release-specific confirmation. Deployment-only items intentionally remain unchecked until an operator records evidence.

### Source and automated controls

- [x] Secure password storage, reset, refresh rotation, logout, and account/session invalidation tested
- [x] Backend ADMIN authorization and representative IDOR/ownership denials tested
- [x] Strict validation, request sanitization, body limits, and mass-assignment rejection tested
- [x] CORS allow-list, allowed/attacker preflights, CSRF, Helmet options, and sanitized errors tested
- [x] Upload signing/verification and media migration preflight implemented and tested
- [x] Payment verification, webhook signatures, replay/idempotency, and reconciliation tested
- [x] Exchange authorization/state transitions, coupon abuse, and stock races tested
- [x] Audit logging and sensitive log/error redaction tested
- [x] Additive database index deployment and bounded HTTP server policy tested
- [x] Public production source maps disabled by default
- [x] Backup/recovery strategy and restore procedure documented

### Release and deployment evidence

- [x] Production dependency audits reviewed for this Task 76 pass: backend and frontend each reported `found 0 vulnerabilities`
- [ ] Confirm Node/runtime versions and immutable build provenance
- [ ] Verify HTTPS, certificate renewal, redirect policy, production HSTS, CSP, and all edge security headers
- [ ] Verify exact same-origin `/api` proxying and aligned storefront/CORS origins
- [ ] Verify HttpOnly, Secure, SameSite, path, expiry, refresh rotation, logout, and CSRF cookies in the deployed browser
- [ ] Verify secrets are in managed storage, access is least-privilege, and rotation/revocation owners are assigned
- [ ] Verify production rejects mock prepaid and has no placeholder carrier/AI/payment credentials
- [ ] Run `npm run media:preflight` and `npm run db:indexes` against the intended deployment
- [ ] Verify the MongoDB topology supports transactions, additive indexes exist, and critical query plans are acceptable
- [ ] Load an authoritative pincode/serviceability dataset
- [ ] Configure and monitor external notification dispatch and media reconciliation schedules
- [ ] Verify shared rate limiting before running more than one API process
- [ ] Configure snapshots/PITR/retention/alerts, approve RPO/RTO, and complete a measured restore drill
- [ ] Run staging smoke tests for auth, admin, cart, checkout, orders, payment/webhooks, exchanges, uploads, and deep links
- [ ] Run real-device/mobile/keyboard/screen-reader checks and production Lighthouse/Web Vitals measurements
- [ ] Run production-like load/failure tests and verify graceful shutdown/timeouts behind the actual proxy
- [ ] Configure centralized logs, alert routing, SLOs, incident contacts, and provider reconciliation monitoring

## Release sign-off

Production readiness requires joint engineering and operational sign-off on every applicable unchecked item. Any exception must identify the risk, compensating control, owner, expiry date, and approval. Re-run this review after authentication, payment, shipping, infrastructure, or other material security changes.
