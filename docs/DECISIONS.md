# Decisions log

structure.md §68 asks that unspecified requirements be settled with a reasonable
professional decision, documented, and moved past. This file is that record. Each
entry states the decision, why, and what it costs.

Newest entries at the bottom.

---

## D1 — Payment provider deferred behind an adapter

**Decision.** `paymentService` exposes `initiate`, `verify`, `handleWebhook` and
`refund`. Two adapters ship: **COD** (real, admin-toggleable, configurable
surcharge) and **MockPrepaid** (development and test only, exercising the full
order → verify → webhook lifecycle). A `PhonePeAdapter` implements the same
interface and is unimplemented, marked with a TODO contract note.

**Why.** The business will use PhonePe, but not yet. Building the abstraction
first means the entire checkout, server-side verification, webhook idempotency
and fee path is written and tested now; connecting PhonePe later touches one
adapter and no order logic (architecture §7).

**Cost.** MockPrepaid is dead weight in production and must be refused there by
configuration.

## D2 — Authentication: short-lived access token in memory, rotating refresh cookie

**Decision.** Access token lives 15 minutes (10 for admins) and is held only in
React memory. The refresh token lives 7 days, rotates on every use, is stored
SHA-256 hashed in the database, and travels in an `HttpOnly`, `Secure`,
`SameSite` cookie scoped to the refresh path. Refresh and logout additionally
require a double-submit CSRF token and an Origin check.

**Why.** Security §1 forbids long-lived tokens in `localStorage`, and §13
requires CSRF protection when cookies carry authentication. Keeping the access
token in memory means an XSS payload cannot read a persisted credential, and
scoping the cookie to one path keeps the CSRF surface to a single endpoint.

**Cost.** A full page reload has no access token until the first silent refresh
completes, so the app shows a brief authenticated-unknown state on boot.

## D3 — Money is stored as integer paise

**Decision.** Every monetary value is an integer count of paise: ₹1,499.00 is
`149900`. Fields carry a `Paise` suffix (`pricePaise`, `deliveryChargePaise`).
Rupee conversion happens only at the API boundary, in CSV import/export, and in
the UI.

**Why.** Binary floating point cannot represent decimal currency exactly. A
ledger that drifts by a paisa becomes a visible problem on an invoice, and
totals are recomputed server-side on every order (security §19), so the
arithmetic has to be exact. Integers also make MongoDB aggregation for the admin
dashboard exact.

**Cost.** Conversion at every boundary, and the `Paise` suffix is verbose. The
verbosity is deliberate — it makes a unit mistake visible at the call site.

## D4 — `sanitizeFilter` is deliberately not enabled

**Decision.** Mongoose's global `sanitizeFilter` is left off. NoSQL injection is
prevented at the edge instead: `sanitizeRequest` strips `$`-prefixed, dotted and
prototype-polluting keys from every body, query and param; strict Zod schemas
coerce each input to a declared primitive; `strictQuery` discards conditions on
undeclared fields.

**Why.** `sanitizeFilter` treats every filter as hostile, including ones the
application builds itself. It rewrites `{ pincode: { $in: [...] } }` into an
equality match against the literal object, so legitimate queries silently return
nothing unless each one is wrapped in `mongoose.trusted()`. In a codebase with
this many modules that is a footgun that produces silent wrong answers, which is
worse than the risk it removes — especially when the untrusted data never reaches
a query builder in the first place. This was found by a failing test, not
in review.

**Cost.** The protection now depends on the request sanitiser and the validators
being applied on every route. Both are enforced centrally, and the negative-test
suite (Task 34) covers injection attempts end to end.

## D5 — Transactions are detected, not assumed

**Decision.** `supportsTransactions()` probes the connection at runtime.
Only operations with a proven domain-specific fallback may continue without a
transaction. Order placement and release fail closed before any write when the
deployment cannot provide transactions; their stock, coupon, sequence, cart and
ledger invariants have no safe generic standalone fallback. Exchange transitions
must likewise define their own safe policy when implemented.

**Why.** Transactions need a replica set. Atlas — including the free M0 tier —
is always a replica set, so production has them; a developer's standalone local
`mongod` does not. Hard-requiring transactions would make the app unrunnable
locally, and assuming them would fail at the worst moment. Tests run against a
one-member in-memory replica set so the transactional path is the one under test.

**Cost.** Critical multi-document commerce writes require a replica set. A
standalone development database can still run read-only and single-document
features, but order placement is deliberately unavailable instead of risking a
partially accepted sale. Tests use a one-member in-memory replica set and also
assert the fail-closed standalone path.

## D6 — Pincode data is reference data, not a serviceability rule

**Decision.** The `pincodes` collection maps a pincode to city, district and
state, with a `source` field recording provenance. It does not decide delivery.
Serviceability is a configurable rule in settings (prefixes `56`–`59` for
Karnataka, plus explicit allow/deny lists).

**Why.** structure.md §15 requires that adding another state later be a data
change rather than a rewrite of checkout, and §41 forbids fabricating
geographical data. A pincode absent from the collection is reported as unknown in
analytics rather than guessed.

**Cost.** District-level analytics is only as complete as the imported dataset.
The seeded set is the 26 Karnataka district headquarters, explicitly marked
`starter-set:…`, and the full India Post directory must be imported before
launch.

## D7 — Tailwind's theme is replaced, not extended

**Decision.** `colors`, `fontSize`, `borderRadius` and `boxShadow` are overridden
in `tailwind.config.js` rather than extended. Every value resolves to a CSS
variable from `src/styles/tokens.css`. Colour tokens are stored as space-separated
RGB channels so Tailwind's alpha modifiers (`bg-wine/10`) still work.

**Why.** structure.md's closing directive is that Tailwind may be the
implementation tool but its default aesthetic must not show through. Extending the
theme leaves `bg-indigo-500`, `rounded-2xl`, `shadow-xl` and `text-4xl` reachable,
and they will eventually be reached. Replacing it means an off-brand value is a
build-time failure rather than a review comment. `designSystem.test.js` asserts
this, so a hardcoded hex or a numeric type size fails the suite.

**Cost.** A genuinely new colour or size has to be added to the tokens first,
which is one extra step — and the intended one.

## D8 — Overlay focus starts on the dialog, not its first control

**Decision.** `Modal` and `Drawer` move focus to the dialog element itself when
they open. Callers can pass `initialFocus="first"` or a ref where a specific
control is the obvious starting point.

**Why.** The close button is first in DOM order in both components, so focusing
the first focusable control meant Enter immediately dismissed whatever had just
opened. Focusing the labelled dialog container makes assistive technology announce
the dialog's title and leaves the first Tab to enter the control cycle. The focus
trap directs Tab and Shift+Tab off the container into the first or last control
respectively.

**Cost.** A form dialog needs `initialFocus="first"` to put the cursor in its
first field.

## D9 — Focus-trap visibility is decided from attributes, not geometry

**Decision.** `useFocusTrap` filters candidates using `hidden`, `aria-hidden` and
computed `display`/`visibility` — never `offsetParent` or client rects.

**Why.** The original implementation used `offsetParent !== null`, which means "is
laid out". That is correct in a browser and always false in jsdom, so under test
the trap found no candidates and quietly did nothing. Any test asserting the trap
would have to be written around the bug rather than catching it. Found by a failing
test, which is the point of having them.

**Cost.** An element hidden purely by being clipped or zero-sized is still treated
as focusable. In practice overlays hide content with `hidden` or `display: none`,
both of which are covered.

## D10 — CSS entry imports are ordered, and that order is tested

**Decision.** `src/styles/index.css` places every `@import` before the `@tailwind`
directives, and `designSystem.test.js` asserts it.

**Why.** CSS requires `@import` to precede other rules. `@import './base.css'`
sitting after `@tailwind utilities` was silently discarded at build time — no
warning, no error — which shipped a build with no skip link, no focus-visible
treatment and no horizontal-overflow guard. The build output was inspected to
confirm the fix, and the ordering is now a test so it cannot regress.

**Cost.** None. The base layer stays wrapped in `@layer base`/`@layer components`
so Tailwind still places it correctly regardless of position.

## D11 — Refresh tokens are opaque, access tokens are JWTs

**Decision.** An access token is a short-lived HS256 JWT carrying `sub`, `role`,
`tv` (token version) and `sid` (session id). A refresh token is 32 random bytes,
stored only as a SHA-256 hash in the `sessions` collection.

**Why.** A refresh token has to be revocable, and revocation means a database
lookup on every use. Making it a JWT would add nothing — the lookup happens anyway
— while adding a real risk: a leaked signing key would mint valid long-lived
credentials, whereas a leaked key cannot forge a row in `sessions`. The access
token is the opposite case: it is checked on every request, lives fifteen minutes,
and self-verification is what keeps that check cheap.

SHA-256 without a salt is correct for these tokens specifically. They are 256 bits
of cryptographic randomness, so there is no dictionary and nothing to brute-force;
a slow KDF would only make every refresh slower. That reasoning does not transfer
to passwords, which is why those use Argon2id.

**Cost.** Every refresh costs one indexed lookup and two writes.

## D12 — Refresh token reuse revokes the whole chain

**Decision.** Refresh tokens rotate on every use. The consumed session is marked
`ROTATED` and points at its replacement. If an already-rotated token is presented
again, every session for that account is revoked with reason `REUSE_DETECTED` and
`tokenVersion` is incremented, which also kills outstanding access tokens.

**Why.** After a rotation, exactly one party should hold the current token. A
second presentation of a spent token means two parties hold it, which means it
leaked. Refusing only the replayed request would leave the attacker holding a valid
chain if they rotated first. Revoking everything converts an undetected
compromise into one forced sign-in.

**Cost.** A legitimate customer is signed out if a genuine race occurs — two tabs
refreshing at the same instant. The window is milliseconds and a sign-in resolves
it, which is the right trade against silent account takeover.

## D13 — `tokenVersion` invalidates access tokens without a revocation list

**Decision.** Users carry a `tokenVersion` integer. It is embedded in every access
token as `tv` and incremented whenever all sessions are revoked — password change,
password reset, reuse detection, "sign out everywhere", admin promotion.
`requireAuth` (Task 5) compares the claim against the stored value.

**Why.** Security §29 requires a password change to invalidate existing sessions.
Refresh tokens are already revocable through the database, but an access token is
self-verifying and would otherwise stay valid for up to fifteen minutes after a
password change — exactly the window that matters when someone is resetting a
password because an account is compromised. A version counter gives immediate
invalidation from the single user lookup `requireAuth` already performs, with no
separate revocation list to maintain or expire.

**Cost.** One integer comparison per authenticated request, and access tokens are
tied to a user record that must be read. That read is required anyway, because
§2 says the backend must determine the role from trusted server-side state.

## D14 — Login timing is equalised against a dummy hash

**Decision.** When login is attempted for an address with no account, the service
still verifies the candidate password against a pre-computed throwaway Argon2id
hash before returning `INVALID_CREDENTIALS`.

**Why.** Security §28 requires that a response not reveal whether an account
exists. Identical status codes and messages are not enough on their own: without
this, the unknown-account path returns in about a millisecond while a real account
takes tens of milliseconds to hash, and that difference alone is a usable
enumeration oracle. A test asserts the two paths stay within an order of magnitude
of each other.

**Cost.** A failed login against an unknown address costs one hash verification.
That is the point.

## D15 — Administrators are created by a script, never by an API

**Decision.** `npm run create:admin` creates or promotes an administrator, reading
the password from `ADMIN_PASSWORD` in the environment rather than an argument. No
HTTP route can grant a role, and the registration validator does not accept a
`role` field at all — a payload containing one is rejected with a validation error
rather than ignored.

**Why.** Security §2 and §23. A route capable of creating an administrator would
be the single most attacked endpoint in the application. Requiring server
environment and database access is a far higher bar than sending a request. Reading
the password from the environment rather than `--password` keeps it out of shell
history and the process list. Promotion also revokes existing sessions, because it
changes what every outstanding token is permitted to do.

**Cost.** Creating an admin needs shell access to the deployment. Correct.

## D16 — Authentication uses a same-origin `/api` production proxy

**Decision.** Browsers always call the API through the storefront origin at
`/api`. The production edge or reverse proxy forwards that path to the Express
deployment, matching Vite's development proxy. Authentication cookies use
`SameSite=Lax`; the refresh token remains HttpOnly, while the paired CSRF cookie
is readable only on the storefront origin and is echoed solely for refresh and
logout.

**Why.** An unrelated storefront and API origin breaks the double-submit contract:
the storefront cannot read an API-host CSRF cookie, and modern browsers may block
the refresh cookie as third-party state. A same-origin proxy preserves both CSRF
protection and reliable refresh rotation without exposing the refresh credential.
The frontend rejects a cross-origin `VITE_API_URL` so a deployment cannot silently
downgrade this model.

**Cost.** Production hosting must provide an `/api/*` rewrite to Express. This is
an infrastructure requirement, not an optional optimization.

## D17 — Session revocation is epoch-first and refresh is rechecked

**Decision.** Every refresh-session row records the user's `tokenVersion` epoch. Account-wide revocation increments that epoch before sweeping active sessions. A refresh that has atomically claimed its predecessor creates its successor, then rereads the user epoch; if it changed, the successor is immediately revoked and no credentials are returned. Frontend refresh publication is likewise fenced by a local auth epoch, and bootstrap additionally requires a mounted `AuthProvider`.

**Why.** A session sweep by itself has a cross-collection race: refresh can claim before the sweep and insert its successor afterward. MongoDB transactions cannot be mandatory because standalone development remains supported. Bump-before-sweep plus a post-insert epoch check closes every ordering without relying on transactions. The frontend fence prevents a delayed response from restoring local authentication after password changes, sign-out-everywhere, reset, logout, or application unmount.

**Cost.** Refresh performs one additional user read, and session rows duplicate one small integer. The race is covered deterministically by pausing successor insertion in the backend test suite and by delayed StrictMode bootstrap tests in the frontend.

## D18 — Password reset secrets use fragments and public timing is equalised

**Decision.** Newly issued reset links carry the raw token in `#token=...`, not the query string. The reset page captures it before paint and replaces the visible URL immediately; legacy `?token=` links remain accepted only for already-issued mail. Forgot-password always returns one generic envelope and waits behind a 300 ms response floor for both known and unknown addresses.

**Why.** URL fragments are not sent in HTTP requests, so the secret stays out of initial access logs and referrer data. Immediate history replacement reduces shoulder-surfing and accidental copying; a global `no-referrer` policy adds defense in depth. Identical response bodies still leak account existence if the unknown-account path returns much faster, so the public timing floor removes that practical enumeration signal while the endpoint's strict rate limit bounds probing.

**Cost.** Forgot-password intentionally takes at least 300 ms. The floor may need revisiting when Task 28 adds a real email provider; delivery should then move behind a durable queue so provider latency cannot affect the public response.

## D19 — Catalogue taxonomy, curation, variants, and public identity

**Decision.** Categories are a flat primary taxonomy; collections are separate, overlapping merchandising curations. A product belongs to one category and any number of collections, and its sellable units are embedded SKU-bearing size-and-colour variants. Public catalogue URLs use unique slugs while administrative mutations use MongoDB identifiers. Money crosses admin write APIs as explicitly named rupee fields, is converted immediately, and is stored and returned as integer paise fields.

Catalogue records move between `DRAFT` and `PUBLISHED`; either may become `ARCHIVED`, which is terminal. Public reads expose only published records through explicit DTOs. A product can publish only when its category and selected collections are published and it has at least one variant. Referenced taxonomy or curation records cannot archive while a published product still uses them.

Publication-sensitive product and taxonomy writes share a MongoDB-backed, non-expiring mutex; replica-set deployments additionally transact the protected mutation. The mutex deliberately fails closed rather than allowing an expired holder to resume into a write-skew race. If a process dies while holding it, an operator must verify that no holder remains before clearing the singleton lock document. Cloudinary metadata must belong to the configured `CLOUDINARY_CLOUD_NAME` and cohere with its media type, public ID, and video poster.

**Why.** Taxonomy answers what a product is, while a collection answers how it is currently presented; combining them would make seasonal curation distort navigation. Size-and-colour variants make stock and SKU identity unambiguous without creating a collection per sellable unit. Slugs satisfy the storefront and SEO contract without exposing database IDs as the only public identity. Explicit lifecycle checks keep drafts and archived catalogue data out of customer responses.

**Cost.** Product documents contain bounded variant arrays and relationship validation adds reads to publication. Task 7 stores only validated Cloudinary media metadata; upload signing, transformations, and deletion belong to Task 9. Smart phrase interpretation belongs to Task 8, final catalogue interfaces to Tasks 10–11, and CSV import to Task 25. No catalogue seed data is created until the business supplies approved products, prices, stock, and media; tests create isolated fixtures instead.

## D20 — Smart search is deterministic and explicit filters win

**Decision.** Public product search keeps the existing `GET /products` contract. A dedicated search interpreter recognizes price language and published catalogue vocabulary for category, colour, size, occasion, and fabric, removes recognized structure, and passes only the residual keyword to MongoDB text search. Every residual term must also match an indexed product text field, preventing MongoDB's default OR semantics from broadening an unknown phrase into unrelated results. Explicit structured query parameters override inferred values one dimension at a time. “Under”, “below”, and “up to” are inclusive maximums. The response reports the original query, residual keyword, inferred filters, and effective applied filters in paise-based metadata.

**Why.** A closed deterministic parser handles the required fashion phrases without a paid AI dependency, preserves visible filter controls as the source of truth, and prevents private draft vocabulary from becoming observable. Keeping interpretation behind a service boundary allows a future semantic implementation to replace it without changing routes, pagination, DTOs, or the Task 10 storefront integration.

**Cost.** Phrase grammar and vocabulary are intentionally bounded. Dynamic vocabulary is loaded only from products whose category and collections are public, canonically sorted before its deterministic 200-value-per-dimension cap, which adds catalogue reads for natural-language searches but avoids draft-data leakage. Collection inference, relevance-ranked search, suggestions, and semantic/AI retrieval remain outside this initial implementation.

## D21 — Product media uses short-lived signed direct uploads with verified assets

**Decision.** Product image and video bytes upload directly from the administrator's browser to Cloudinary using a ten-minute, administrator-only server-signed intent. The server chooses a generated `products/` public ID, resource type, allow-listed formats, non-overwrite policy, and a signed upload preset. Before issuing an intent it verifies through Cloudinary's Admin API that the preset is signed and has the exact format allow-list and provider-enforced byte ceiling; clients cannot choose folders, presets, or arbitrary signing parameters. Completion requires Cloudinary's signed response and a server-side asset lookup. The lookup verifies upload provenance, configured cloud, actual decoded format, resource type, dimensions, duration, size, URL, and public ID before a `MediaAsset` becomes `READY`. Product writes may attach only exact metadata from a ready asset.

A provider-neutral `mediaService` owns intents, verification, delivery transformations, product attachment checks, reconciliation, and deletion; Cloudinary SDK details stay in one adapter. Product DTOs derive optimized delivery URLs, square thumbnails, responsive image candidates, and same-asset video posters without changing stored originals. Deletion is a separate, auditable operation: a referenced asset cannot be deleted, and a short per-asset operation claim makes concurrent calls single-winner while provider failure remains fail-closed and retryable. Expired, abandoned, and rejected intents retain their generated public ID until `npm run media:reconcile` destroys it after Cloudinary's signature-validity window; only reconciled terminal records become TTL-eligible. Uploaded bytes are never written to the Express filesystem. API credentials remain server-only; the public API key and preset name appear only in a signed upload intent.

**Why.** Direct upload avoids buffering large untrusted files in the application process, while an immutable provider preset prevents understated browser metadata from consuming unbounded upload quota. Provider decoding plus server-side resource inspection checks the real asset rather than trusting a browser MIME type or extension. Persisted intent/asset state prevents a syntactically plausible foreign URL from being attached to a product and preserves a cleanup handle across cancellation or process failure. Provider-neutral boundaries and derived delivery data keep later catalogue interfaces independent of Cloudinary details.

**Cost.** Intent creation adds a cached Cloudinary preset-policy read, completion adds a rate-limited asset read, and reconciliation must run on an operational schedule. `npm run media:preflight`—also enforced by `npm run db:indexes`—must report zero metadata-only legacy product media before Task 9 deployment; any existing records require provider inspection, `MediaAsset` creation, and `assetId` backfill. A process interruption can temporarily leave an asset in `DELETING`; an expired claim permits a later retry. Task 9 supplies the headless upload client and media API only. Product gallery playback and administrator upload interfaces remain Tasks 10–11; review, exchange-request, and avatar prefixes remain owned by their later domain tasks.

## D22 — Site settings stay narrow and media purpose is fixed at intent

**Decision.** Task 13 stores one fixed-key site-settings document containing only the announcement and an optional home-hero image. Until that document exists, both settings reads return the truthful existing announcement — “Made in Karnataka • Traditional with a modern touch” in the wine tone — with no hero media. The public DTO exposes only those two concerns; the administrative DTO additionally identifies and timestamps the singleton. Settings patches serialize through the catalogue write guard and atomically upsert the fixed key.

Every signed media intent has one allow-listed purpose: `PRODUCT` by default for existing clients, `HOME_HERO`, or `COLLECTION`. Purpose chooses the server-owned `products/`, `home/`, or `collections/` public-ID prefix and cannot be changed by clients. Hero and collection purposes accept images only. Attachments must exactly match a ready asset of the expected purpose. Assets may be reused by records within that same purpose; deletion is refused while any product, collection, or settings reference remains.

A completed editorial upload remains an administrator-owned draft for a **24-hour grace period**. After that period, `npm run media:reconcile` may reclaim a `READY` `HOME_HERO` or `COLLECTION` asset only when an authoritative reference check finds neither `SiteSettings.homeHeroMedia` nor `Collection.editorialMedia` (and no defensive product reference). That check and the deletion claim share the catalogue write guard with attachment writes; provider deletion runs only after the guard is released. Referenced candidates record their latest check so bounded reconciliation batches rotate instead of allowing old references to starve later orphans. `PRODUCT` assets are never subject to READY-orphan reclamation. Ambiguous provider outcomes remain `DELETING` without an active claim so the existing reconciliation command can retry, and successful cleanup retains the terminal record for the same 30-day window as other reconciled media.

**Why.** Task 13 requires announcement and hero administration but does not define a general CMS, policy, contact, or review schema, so adding those fields would invent a contract and make future migrations harder. A fixed singleton key makes concurrent first writes unambiguous. Purpose-bound assets prevent a syntactically valid upload from crossing domain ownership, while the shared write guard closes attach-versus-delete races on both transactional and standalone MongoDB deployments.

**Cost.** New settings concerns require deliberate schema and DTO additions rather than arbitrary key/value storage. An asset intended for another domain must be uploaded again under the correct purpose, and deletion checks must be extended whenever a future module gains a persisted media reference.

## D23 — Wishlist stores ordered product identity and hydrates current public data

**Decision.** Each account owns at most one wishlist document, enforced by a
unique user index. It stores only a newest-first array of up to 100 product
ObjectIds; price, media, stock, and catalogue copy are never copied. Public
resolve and authenticated reads hydrate those identities through the product
service's public-summary boundary, which requires a published product, published
category, and exclusively published collection relationships. Reads prune
missing or no-longer-public identities. Add, remove, and merge use atomic array
updates: duplicate operations are no-ops, guest merge order precedes existing
account order, and a union over 100 is rejected without truncating stored data.
Ownership always comes from the authenticated database-backed account.

**Why.** Identity-only persistence prevents stale commercial data and creates one
source of truth for catalogue privacy. A bounded singleton keeps reads simple;
atomic updates plus the unique index avoid lost updates and duplicate documents
under concurrent requests. Public resolve supports guest state without accepting
or inventing an owner.

**Cost.** Every read hydrates the catalogue and may perform a pruning write.
Ordering records save recency rather than a separate timestamp per item, and a
wishlist cannot exceed 100 products. Guest-to-account merge covers wishlist only;
cart transfer remains a separate cart-domain task.

## D24 — Cart stores ordered exact-variant identity and hydrates current commerce data

**Decision.** Each authenticated account owns one cart document, enforced by a unique user index. Its ordered array contains at most 100 unique exact-variant lines and persists only product ObjectId, embedded variant ObjectId, and absolute quantity (1–99). Public guest resolution is stateless. Duplicate guest variants keep their first position and last snapshot; merge puts the canonical guest snapshot first, lets guest quantity win overlaps, retains account-only lines, and rejects overflow atomically. Product copy, media, SKU, stock, prices, discounts, totals, coupons, delivery, and reservations are never persisted.

Every response is hydrated through a cart-specific product-service boundary that applies the normal published product/category/collection privacy rules and returns only the public summary plus exact public variant DTO. Structurally valid unavailable identities remain as non-pruned tombstones with safe status; current price and stock are recomputed on every response. Checkout is advisory only and is blocked for an empty cart or any unavailable line. Cart writes do not reserve or deduct stock, and coupon, delivery, order, and payment behavior remain outside this module.

Set, delete, and merge are atomic, replay-idempotent singleton updates. Move-from-wishlist validates and writes the cart first, then removes wishlist identity in a multi-document transaction where supported. The standalone fallback deliberately permits only the safe duplicate state (item in both domains) if the second write fails; replay completes removal without risking wishlist-first data loss.

**Why.** Identity-only persistence keeps the catalogue authoritative and prevents stale or private commercial snapshots from leaking. Exact embedded variant identity avoids ambiguous size/colour selection. Conditional atomic pipelines and the unique owner index preserve ordering, caps, and concurrent first writes without read-modify-save races. Tombstones let customers understand and remove unavailable choices instead of silently losing them.

**Cost.** Cart reads require current catalogue hydration, unavailable lines make top merchandise totals unknown, and a standalone deployment may briefly retain a moved product in both cart and wishlist after a partial infrastructure failure. No cart operation guarantees checkout stock until a future order/reservation boundary is implemented.

## D25 — Coupon validation is a current-catalogue quote, not redemption

**Decision.** Coupon codes are normalized to uppercase and looked up exactly. The public validation endpoint accepts only a code and canonical cart identities, then reuses the cart domain's current published-catalogue composition boundary. It rejects empty or blocked carts, applies percentage discounts with floor rounding and flat discounts capped at the qualifying selling-price subtotal, and never persists coupon or price data in `Cart`. Minimum order uses the complete pre-coupon merchandise subtotal. Empty applicability lists mean catalogue-wide; product and category lists use union semantics. The customer DTO exposes only the applied code and discount, plus merchandise after coupon, while delivery and final total remain unquoted.

`firstOrderOnly`, global usage availability, and all other coupon checks made during cart validation are advisory. Task 17 must revalidate against order-time catalogue, customer, and usage truth in the same order-creation boundary. Validation never increments usage. No atomic redemption seam is added in Task 16: without an Order model or durable order identity, a per-order idempotency record would invent the future order contract. Task 17 must conditionally consume limited coupons (`usageCount < usageLimit`) with idempotent per-order semantics and enforce first-order truth atomically with order creation.

Task 17 must also make prohibited reuse an explicit order-domain policy rather than treating the global `usageCount` as previous-use enforcement. It must define the applicable per-customer reuse limit, record each successful redemption against the coupon, authenticated customer, and durable order identity, and enforce that policy from durable successful redemption history in the same transaction as order creation and global-limit consumption. Its tests must cover prior-use rejection, two simultaneous same-customer claims, final-global-use contention, replay of the same order identity, and the chosen cancellation/payment-failure restoration rule. Cart validation remains non-consuming and cannot promise that a previously used coupon will still be accepted at order time.

**Why.** Cart requests are repeatable quotes and may be abandoned, retried, or raced. Consuming a limited coupon during validation would burn uses without a sale. Reusing current cart hydration prevents client prices and private catalogue records from influencing discounts, while the narrow customer projection avoids exposing campaign targeting, dates, or capacity.

**Cost.** A coupon that validates can still become unavailable before checkout, and `firstOrderOnly` cannot be authoritatively rejected until order history exists. The checkout UI must treat validation as provisional and Task 17 must perform final revalidation before accepting an order.

## D26 — Order placement is a transaction-required, idempotent acceptance boundary

**Decision.** `POST /api/orders` is authenticated and accepts only a strict shipping-address snapshot, an optional coupon code, and `COD` or `PREPAID`. Exact product/variant identities and quantities come from the account Cart; all catalogue facts and integer-paise totals are recomputed by the server. A required high-entropy `Idempotency-Key` is SHA-256 hashed and uniquely bound to the customer and a canonical request fingerprint. The first commit returns 201; an identical replay returns the same narrow receipt with 200, while a changed request under the same key returns 409. Raw keys and address/PII are excluded from logs and audit metadata.

Placement fails closed before writes if transaction support is unavailable or the fixed-key order-placement settings record is absent/disabled. In one bounded-retry transaction it allocates the customer's monotonic order sequence, verifies the exact Karnataka pincode row and canonical locality, composes current published catalogue snapshots, conditionally decrements embedded variant stock, writes immutable inventory ledger rows, revalidates and consumes any coupon, inserts the immutable Order, and compare-and-clears only the Cart snapshot captured for that attempt. A concurrent Cart change is retained and the receipt records `cartCleared:false`. Retries are limited to transient transaction/write-conflict failures; durable idempotency resolves concurrent or uncertain outcomes.

The settings singleton versions pricing policy: exact-pincode delivery overrides beat the flat charge, and delivery is zero when the pre-coupon merchandise subtotal reaches the nullable free-delivery threshold. COD availability and surcharge and PREPAID availability are configuration, not request input. No tax is invented. Final total is merchandise minus coupon plus delivery plus COD surcharge. Task 18 owns provider/payment success, Task 19 owns checkout UI and address-book persistence, Task 20 owns customer order list/detail, and later tasks own admin fulfillment, shipping, invoices and notifications.

Coupon administration has an explicit positive `perCustomerUsageLimit`, with secure default 1; `null` means unlimited. It is visible only to administrators. Task 16 quotes remain advisory and non-consuming. Order-time evaluation shares the same minimum, targeting, lifecycle, applicability-union and exact-discount implementation, then additionally requires sequence 1 for `firstOrderOnly` and checks the durable customer counter. Global and limited per-customer counters are conditionally incremented in the order transaction, and each consumption has a durable order-linked redemption. A released first order never gives sequence 1 back.

`releasePlacement(orderId, reason)` is internal only. From the eligible pre-fulfillment state, one transaction restores exact variant quantities, writes unique `ORDER_RELEASED` ledger entries, transitions the redemption to `RELEASED`, decrements global and limited customer counters without crossing zero, and marks placement/payment/fulfillment cancelled. Replays are no-ops. There are intentionally no public read, admin, payment, status-patch or cancellation routes in Task 17.

**Why.** An accepted order is the durable boundary where mutable cart/catalogue data becomes commercial history. Transactions plus conditional writes prevent oversell, coupon overuse and partial orders; database uniqueness makes replays and contention deterministic. Failing closed on standalone MongoDB is safer than a generic compensation path that could expose an order without its stock or coupon effects.

**Cost.** Local order testing requires a replica set, and placement is unavailable until operations seed valid settings and pincode reference data. Cart changes racing checkout may remain for the customer to review rather than being silently erased. Payment and downstream side effects must build on the stored statuses and idempotent handoffs in their owning tasks.

## D27 — Task 18 uses a headless, resumable payment attempt boundary

**Decision.** Task 18 adds provider-neutral payment attempts and append-only provider-event receipts around the accepted Task 17 Order. Authenticated customers initiate and verify a prepaid attempt through separate order-bound endpoints after placement; `POST /api/orders` does not call a provider inside its commerce transaction. There is one durable, resumable attempt per order. Its expected amount is the immutable order `finalTotalPaise`, its persisted currency is INR, and its server-generated merchant reference, provider identity and payment reference are never supplied by the customer. Reusing one initiation key for another order conflicts, while another key for the same owned order resumes the existing attempt rather than risking a second charge.

MockPrepaid is the functioning development/test adapter and is refused in production. It exercises signed checkout capabilities, server verification, exact-raw-body HMAC webhooks, event replay fences and idempotent refunds without adding a payment SDK. COD has no provider action and is not marked paid at placement. PhonePe remains an interface-complete unavailable adapter until its exact product/API, credential, signature, callback and refund contract is approved; no live behavior is guessed.

Trusted success atomically claims the unique provider event, confirms the Payment, moves the Order only from `PREPAID_PENDING` to `PREPAID_CONFIRMED`, and appends payment history. Provider, merchant reference, provider payment ID once known, amount, currency and order are all bound before transition. Duplicate success is a no-op, and failure after success cannot demote payment. A signed success arriving after placement release never resurrects the Order; it enters reconciliation and a single worker claims a bounded refund-dispatch lease before provider I/O. Every attempt reuses the persisted `RFN_` provider idempotency reference; an expired lease or exact event retry redrives an ambiguous outcome, while `REFUNDED` is absorbing and cannot be reopened by later events. Provider failure leaves the reserved Order pending and retryable: Task 18 does not invent an expiry scheduler or automatically release stock/coupon capacity without an approved reservation/cancellation policy.

The mock webhook route exists only outside production. Its signature and timestamp are verified against the exact bounded request bytes before its strict payload is trusted. Event IDs are unique per provider and retain a payload hash, so exact retries are acknowledged while an event ID reused with changed bytes is rejected. Raw bodies, signatures, checkout capabilities, idempotency keys, credentials, address data and payment instrument data are excluded from logs and audits. Payment confirmation requires transaction-capable MongoDB and fails closed otherwise.

Task 18 exposes no payment-status read, generic mark-paid, refund, cancellation, admin, or fulfillment HTTP route. `paymentService.refund` remains an internal provider contract restricted to reconciliation. Task 19 owns checkout/provider UI and address persistence, Task 20 owns customer order reads, and later tasks own admin fulfillment, shipping, invoices and notifications.

**Why.** Separating commercial acceptance from provider I/O preserves Task 17 atomicity and makes an accepted Order recoverable after browser, network or provider ambiguity. A single merchant reference plus durable event uniqueness prevents duplicate charges and duplicate state effects, while exact amount/currency binding ensures the browser can never declare what was paid.

**Cost.** Prepaid reservations do not expire automatically yet, production prepaid remains unavailable until the PhonePe contract is implemented, and Task 19 must make a second idempotent initiation call after placing a prepaid order. Operations must run the new payment indexes before enabling the module.

## D28 — Task 19 checkout uses advisory server quotes and optional canonical saved addresses

**Decision.** Authenticated checkout adds a non-consuming `POST /api/orders/quote` boundary whose strict body is only the existing shipping-address snapshot plus nullable `couponCode`; it never accepts a payment method, cart lines, prices, discounts, delivery, totals, stock, payment state, or other commercial authority. The server reads exact identities from the current account Cart and reuses the same authoritative order-composition seam as placement for published catalogue facts, exact pincode/canonical locality, next-sequence first-order and durable per-customer coupon eligibility, settings, delivery, and integer-paise pricing. Its allowlisted response contains only canonical city/district/state/pincode, item count, a safe coupon code/discount summary or null, and COD/PREPAID options. Each option states whether it is enabled and includes the same narrow pricing fields as an order receipt only when enabled. COD requires placement policy; PREPAID requires both placement policy and a functioning server-derived provider capability. MockPrepaid qualifies only when configured outside production, PhonePe remains unavailable while its approved contract is TODO, and Disabled is unavailable. No provider/configuration name or secret is exposed.

A quote is advisory and performs no order-sequence allocation, coupon consumption, stock mutation, Cart clearing, Order/Payment/audit creation, or other write. The frontend must not reproduce pricing, coupon, delivery, payment-availability, or locality formulas. It may display the quote, but `POST /api/orders` remains the only acceptance boundary and recomputes current truth inside its transaction. Placement now also refuses unavailable PREPAID before any commerce effect so it cannot strand a new reservation without a functioning initiation adapter. Quote/placement drift is expected under concurrent catalogue, stock, coupon, Cart, settings, or provider changes; the accepted order receipt replaces the advisory display.

Saved addresses are separate owner-only rows exposed at `GET/POST /api/addresses` and `PATCH/DELETE /api/addresses/:id`. Ownership always comes from the authenticated session; foreign and missing identifiers are deliberately indistinguishable 404s, including for administrators. Each row has a deterministic per-account slot 1–10, recipient contact/address fields, server-canonical city/district/state/pincode, one default flag, and timestamps. Create/update accept only mutable contact/street fields, pincode, and default intent; clients cannot submit owner, slot, timestamps, canonical locality, or commercial fields. Every accepted create/update resolves an exact Pincode and enabled order-placement policy allowed state. Missing policy fails closed. The ten-row cap and one-default invariant use transaction-required unique fences with bounded conflict retry. The first row is default, explicit default selection atomically demotes the prior row, and deleting/default-demoting promotes the deterministically most recently updated remaining row. Deletion is hard and never changes historical Order snapshots. Address audits contain only address ID, slot, and default state—never contact, street, locality, or pincode values.

Address saving is optional frontend behavior and is off by default: checkout must work from an unsaved shipping snapshot, and the frontend must not silently persist an address. A selected saved address is copied into the normal quote/placement shipping snapshot and is revalidated rather than treated as commercial authority. After an accepted prepaid order, the frontend follows D27's separate idempotent initiate/verify flow. If the browser, network, or access session is interrupted, it must preserve the accepted order identity and resume payment through the payment boundary after session recovery instead of submitting a second order; Task 20/later owns durable customer order list/detail recovery UI. Task 20 still owns customer order reads, and later tasks still own cancellation/expiry, admin fulfillment, shipping, invoices, notifications, and live-provider implementation.

**Why.** One shared composition seam prevents checkout previews from drifting by implementation from placement, while retaining the required distinction between a repeatable read and an atomic sale. Canonical, bounded owner rows improve repeat checkout without making PII part of Cart or mutable Order history. Provider readiness on both quote and placement closes the gap where policy alone could advertise or accept an unusable prepaid method.

**Cost.** Quotes can become stale immediately and may reject advisory first-order/per-customer coupon eligibility differently after another order wins. Address writes require transaction-capable MongoDB and depend on current pincode/settings data. The frontend needs explicit unsaved-versus-saved UX and a recoverable two-step prepaid flow; no Task 19 endpoint substitutes for the later order-history boundary.

## D29 — Customer order reads use immutable snapshots and owner-bound queries

**Decision.** Task 20 adds authenticated customer-only `GET /api/orders` and `GET /api/orders/:orderNumber` reads. Ownership comes only from the database-backed session and is included in every Order query; a foreign order number and a missing order number return the same `ORDER_NOT_FOUND`. The list uses strict bounded page pagination, newest-first `{ createdAt: -1, _id: -1 }` ordering, and the normalized `PAYMENT_PENDING`, `CONFIRMED`, and `CANCELLED` filters. COD is a confirmed order that remains payable on delivery, never a confirmed payment. List DTOs expose no shipping PII. Detail DTOs are explicit allowlists over accepted immutable item, shipping-address, pricing, and coupon snapshots and stored status history, with internal history reasons omitted. Owner and Mongo IDs, hashes and request fingerprints, settings/sequence metadata, release reasons, provider/payment-attempt data, and admin/operational fields are never exposed. Reads do not join current catalogue or Payment documents and do not fabricate fulfillment milestones. They are private, non-cacheable, and introduce no admin, cancellation/expiry, fulfillment, shipping/tracking, invoice, notification, exchange, refund, or live-provider behavior.

**Why.** The accepted Order snapshot is the authoritative historical record even when the catalogue later changes. Putting ownership in the database predicate closes the IDOR boundary and makes foreign and absent records indistinguishable. Explicit projections and DTO allowlists prevent Mongoose `lean()` from bypassing private-field transforms and keep address PII out of collection responses.

**Cost.** Offset pagination and its separate count can drift slightly during concurrent placements and become less efficient at very high pages. Detail intentionally repeats historical contact/address PII and therefore requires `private, no-store`. Later operational features must extend separate authorized contracts instead of overloading this customer projection.

## D30 — Customer exchange requests are historical, fail-closed entitlements

**Decision.** Task 21 owns only authenticated customer eligibility reads, creation, and owner-scoped list/detail reads. It adds `DELIVERED` and `deliveredAt` as prerequisite Order facts but no customer or Task 21 fulfillment writer: an exchange is unavailable unless both were persisted by a trusted later fulfillment workflow. Each newly placed order line receives a cryptographically random opaque `lineToken` and snapshots the Product's exchange-eligible flag plus the enabled Exchange Policy's version, window length, allowed reasons, evidence requirements, and eligibility at checkout. Missing, disabled, or malformed policy and missing historical snapshots remain ineligible; current catalogue or policy data never retroactively grants entitlement. Exchange Policy is a dedicated fixed-key, versioned commerce configuration, not SiteSettings, and this task supplies no unapproved production defaults or admin mutation route.

A request is for the full purchased line quantity, once in the line's lifetime, and may select only a different size variant of the same product and colour. The server derives every original and replacement fact; current replacement stock is neither reserved nor promised. The configured window ends at `deliveredAt + windowDays` and is inclusive at that exact instant. Reasons are the fixed `SIZE_ISSUE`, `WRONG_PRODUCT_RECEIVED`, `DAMAGED_PRODUCT`, and `OTHER` codes; `OTHER` requires a bounded customer comment. Policy configures zero to five required image evidence items per reason, while the platform enforces image-only, customer-owned, provider-verified exchange media and a hard maximum of five. Uploaded evidence that is never attached is reclaimed by media reconciliation.

Creation requires a high-entropy `Idempotency-Key`, canonical request fingerprint, and transaction-capable MongoDB. The first committed request returns 201; exact replay returns 200; reusing the key with another body returns `IDEMPOTENCY_CONFLICT`; another key for an already-requested line returns `EXCHANGE_ALREADY_REQUESTED`. The transaction re-reads the owner-bound Order, immutable entitlement, current requested variant, and verified customer media and creates only a separate Exchange aggregate in `REQUESTED`. Customer routes expose no PATCH and never alter Order history/status, Product stock, inventory, payment, fee, refund, shipment, QC, approval, admin comments, or replacement fulfillment. Missing and foreign owner resources are indistinguishable, including for administrators using customer routes, and all eligibility/list/detail responses are `private, no-store` explicit allowlists.

**Why.** Delivery, historical eligibility, policy, and stable line identity do not currently exist, and inferring any of them from payment, confirmation, SKU, array position, or today's catalogue would create false entitlements and IDOR-prone identifiers. Snapshotting at sale time makes the promise auditable; requiring explicit configuration avoids inventing business terms. A one-request/full-line rule closes ambiguous partial and retry accounting until a later approved workflow exists. Separating the request aggregate preserves later admin, logistics, QC, fee, refund, and fulfillment ownership.

**Cost.** Existing orders and orders placed without an enabled policy remain ineligible, even if policy is configured later. A later trusted fulfillment implementation must record `DELIVERED` and `deliveredAt`; a separate administrative configuration path must publish approved policy values. Customers cannot split quantities, retry a rejected line, choose another colour/product, or receive a stock guarantee in Task 21. Transactionless local MongoDB cannot accept exchange requests.
