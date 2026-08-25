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

## D31 — Admin exchange management is a versioned operational state machine

**Decision.** Task 22 owns authenticated ADMIN list/detail reads and explicit actions over the separate Exchange aggregate. Its closed lifecycle is `REQUESTED` or `INFORMATION_REQUESTED` to `APPROVED` or `REJECTED`; an approved exchange may become `FEE_DUE` when a positive INR fee is recorded, otherwise it may proceed to `REVERSE_PICKUP`, `RECEIVED`, `QC_PASSED` or terminal `QC_FAILED`, `REPLACEMENT_SHIPPED`, and terminal `COMPLETED`. `FEE_PAID` is reserved for a later trusted payment-service confirmation and has no browser- or admin-declared paid route. Every action carries the version last read by the administrator and atomically compare-and-increments it; stale, skipped, repeated, regressive, and terminal-state actions fail closed. History records the resulting status, action, actor, time, optional customer-visible message, and separate bounded internal note. Customer projections expose only safe public status/history and operational summaries; admin projections are separate allowlists.

Request-information is a bounded one-way customer-visible message, not a support conversation. Approval never reserves or promises stock. Reverse and replacement shipments are manually recorded provider-neutral snapshots (courier, AWB, tracking and shipment identifiers/status) with no Shiprocket call. Recording replacement shipment is permitted only after passed QC and requires transaction-capable MongoDB; in that transaction the exact requested replacement variant is conditionally decremented and a unique append-only exchange inventory ledger entry is written. Returned source items are never automatically restocked because condition-dependent disposition is unspecified. QC failure is terminal. Completion requires a recorded replacement shipment; it does not fabricate carrier delivery facts.

Task 22 does not mutate Order status/history, general fulfillment or delivery facts, refunds, payment-provider state, exchange policy, source-item inventory, or customer eligibility. It does not implement generic shipment administration, provider integrations, two-way support, notifications, or dashboard analytics. Customer routes remain owner-bound and never gain an admin bypass; all admin routes independently require database-backed ADMIN authorization and private non-cacheable responses. Every accepted privileged action is audited with identifiers and state changes only, never comments, evidence URLs, contact data, or shipment/payment secrets.

**Why.** The specification requires a usable admin workflow but does not authorize admins or browsers to assert payment success, invent provider behavior, retroactively alter the sale, or decide whether a returned item is saleable. A closed server state machine, compare-and-set version, and transactionally consumed replacement stock prevent invalid skips, double actions, and oversell while preserving Task 21's historical entitlement and ownership boundaries.

**Cost.** All admin exchange actions require transaction-capable MongoDB so each transition, its audit row, and any replacement inventory effects commit atomically. A positive-fee exchange intentionally stops at `FEE_DUE` until a trusted fee-payment integration confirms it. Manual shipment records can drift from a courier until a later adapter synchronizes them. Failed-QC items and returned source stock require explicit later disposition, and completion is an administrative operational fact rather than verified carrier delivery.

## D32 — Task 23 makes normal-order fulfillment a versioned, provider-neutral authority

**Decision.** Task 23 owns normal Order administration, forward fulfillment, manual shipment recording, customer tracking projections, and whole-order pre-shipment cancellation. It expands only the Order fulfillment axis to `UNFULFILLED → PROCESSING → PACKED → SHIPPED → OUT_FOR_DELIVERY → DELIVERED`, with terminal `CANCELLED`. Administrators use explicit actions rather than a generic status patch. COD orders may enter processing while `COD_DUE`; prepaid orders may enter processing only after trusted payment verification has stored `PREPAID_CONFIRMED`. Every action carries the Order version last read, atomically compare-and-increments it, appends only the milestone actually recorded, and rejects stale, skipped, repeated, regressive, or terminal transitions.

The first forward shipment is recorded only by the `PACKED → SHIPPED` action in a separate provider-neutral Shipment aggregate. Task 23 supports one whole-order `FORWARD` shipment with the manual adapter: courier, AWB, public tracking ID, private shipment ID, a closed canonical tracking status, recorded actor/time, and append-only milestone events. It performs no Shiprocket call and accepts no arbitrary URL or raw provider payload. Later verified provider adapters may advance this same model, but must authenticate callbacks, fence event replays, map external states to the closed lifecycle, and keep provider I/O outside database transactions. Split shipments, reverse shipments, RTO/loss decisions, pickup scheduling, rates, and live-carrier synchronization remain unimplemented until their contracts are approved.

Delivery is a trusted fulfillment fact, not a payment inference. The accepted delivery action sets Order `DELIVERED`, Shipment `DELIVERED`, and one immutable, non-future server timestamp in the same transaction; retries cannot move `deliveredAt`. This is the sole Task 23 effect on exchanges: D30's existing fail-closed eligibility may read the trusted Order fact. Task 23 does not mutate the Exchange aggregate or inherit D31's reverse/replacement lifecycle. COD remains `COD_DUE` after delivery because carrier collection and remittance are not yet integrated.

Cancellation is ADMIN-only, whole-order, and pre-shipment. It is allowed from `UNFULFILLED`, `PROCESSING`, or `PACKED` only while payment is `COD_DUE` or `PREPAID_PENDING`. One transaction compare-and-cancels the Order, restores each exact reserved variant once, writes unique `ORDER_RELEASED` inventory ledger rows, releases any consumed coupon counters/redemption once, appends placement/payment/fulfillment history, and commits a strict audit row. It is forbidden after shipment, delivery, or trusted prepaid confirmation. Task 23 adds no customer cancellation promise, partial cancellation, reservation-expiry scheduler, browser-declared refund, or general business-refund workflow; confirmed-prepaid cancellation waits for an approved durable refund contract.

Customer and administrator contracts remain separate explicit allowlists. Customer list/detail stay owner-bound and private; detail gains only safe canonical milestones and shipment tracking fields, never provider internals, actor IDs, internal reasons, audit markers, or raw statuses. ADMIN list/detail/actions independently require database-backed ADMIN authorization and private non-cacheable responses; list minimizes customer data while detail may show the accepted address, payment summary, shipment operations, and related exchange references. Server-supplied `availableActions` are the UI authority.

Every accepted privileged mutation requires transaction-capable MongoDB, commits its strict audit row atomically, and records a private request/version marker used to reconcile an ambiguous commit without rerunning a possibly committed body. Unique shipment and inventory-ledger constraints are final replay fences. No notification, invoice, support, dashboard analytics, live provider, or payment/refund behavior is hidden inside this task.

**Why.** Orders already reserve inventory and carry payment truth, but no production workflow can create the trusted `DELIVERED`/`deliveredAt` facts required by tracking and exchanges. Separate lifecycle axes prevent “shipped” from implying “paid”; explicit one-way actions, optimistic concurrency, transactions, and a replaceable shipment aggregate prevent arbitrary admin patches, duplicate shipments, double stock release, and fabricated milestones while leaving a clean seam for Shiprocket later.

**Cost.** Operations must progress fulfillment manually and run against a replica set. A paid prepaid order cannot be cancelled through this task, a shipped order cannot be rolled back, COD collection remains unreconciled, and one order cannot be split across shipments. Those limitations are intentional until refund, carrier-exception, and multi-shipment business rules are approved.

## D33 — Dashboard analytics are bounded historical projections

**Decision.** Task 24 exposes one authenticated ADMIN read, `GET /admin/dashboard`, with private non-cacheable responses and a strict Asia/Kolkata date-only period. The default is the trailing 30 calendar days including today, both boundaries are inclusive to the caller and represented internally by an inclusive UTC start plus exclusive UTC end, future end dates are rejected, and a request spans at most 366 days. One server `asOf` timestamp is returned and caps reads for the current partial day. The result is assembled from a constant number of set-based database operations with bounded ranked output; no per-row lookups, stored dashboard cache, placeholder values, or raw documents are returned. Separate reads make consistency `BEST_EFFORT`.

A delivered order is counted only when placement is `PLACED`, fulfillment is `DELIVERED`, `deliveredAt` is in scope, and payment is the valid pair `COD` with `COD_DUE` or `PREPAID` with `PREPAID_CONFIRMED`. Delivered order value is the immutable `pricing.finalTotalPaise`; item rankings use immutable line names, quantities, IDs, and `lineMerchandiseSubtotalPaise`. Daily and monthly series are zero-filled. Average delivered order value is period delivered order value divided by period delivered order count, rounded to integer paise. Payment output always includes COD and PREPAID; COD remains `NOT_RECONCILED` because delivery does not prove carrier remittance, while prepaid is `CONFIRMED` by the canonical predicate.

Orders placed and cancellation rate use the `createdAt` cohort. A cohort order is cancelled when its current placement is `RELEASED`, fulfillment is `CANCELLED`, or payment is `CANCELLED`; the rate is cancelled orders divided by cohort orders, rounded to integer basis points. Pending orders are the current all-time `PLACED` backlog: unfulfilled prepaid orders awaiting confirmation, plus COD-due or prepaid-confirmed orders in a nonterminal fulfillment state. Exchange request cards use Exchange `createdAt`; open excludes `COMPLETED`, `REJECTED`, and `QC_FAILED`. Exchange request rate divides requested `source.quantity` grouped by the Exchange immutable original `deliveredAt` snapshot by all item quantity in canonical delivered orders for the period, rounded to integer basis points. Zero denominators produce zero basis points.

Customer registrations include only non-demo `USER` accounts. Purchasing cohorts use each real customer's earliest canonical `deliveredAt`: a period purchaser is new when that first delivery is in the period and returning when it predates the period. No customer identity is emitted. Low stock includes only variants of `PUBLISHED` products where stock is at or below that variant's threshold, sorted by stock, product name, and SKU, with 20 rows returned while the card reports the full matching variant count.

Category performance joins historical delivered lines to the Product and Category records that exist at read time, reports `CURRENT_PRODUCT_CATEGORY`, retains a null-ID `UNATTRIBUTED` row for missing relations, and returns attributed-unit coverage. Geography uses only canonical delivered orders whose stored state equals Karnataka case-insensitively, grouping trimmed stored city, district, and pincode snapshots; recipient, contact, and street fields are never projected. Product/category names and aggregate geography labels are the only descriptive values returned. Monetary fields are integer paise and are named delivered order value or merchandise value.

**Why.** Delivery, payment, placement, and exchange axes carry different business meaning. Explicit predicates and historical snapshots avoid treating an order placement, a pending prepaid attempt, or a COD delivery as a different financial fact. Bounded set operations keep query cost predictable, while current category attribution and best-effort consistency are declared so operators do not mistake the projection for an immutable accounting ledger.

**Cost.** Today's values are partial at `asOf`; concurrent writes can appear in some sections but not others. Current category changes restate historical category attribution, missing catalogue relations remain unattributed, COD remittance is unknown, cancellation is based on current state of the creation cohort, and stored geography spelling differences can create separate display labels when their normalized grouping differs.

## D34 — Product CSV import is an expiring, create-only draft plan

**Decision.** Task 25 exposes an authenticated ADMIN workflow for product CSV preview, retrieval, atomic confirmation, and export. CSV bytes are sent directly as UTF-8 `text/csv` to a route-local bounded raw parser; they are never written to the application filesystem and never sent to a media provider. The v1 schema is fixed and versioned. Every header is known, duplicate or unknown headers are rejected, optional columns remain present with empty cells, pipe (`|`) separates bounded multi-value cells, and one product is represented by one or more rows sharing `product_slug`. Product-level cells must repeat identically within that group. Variant cells (`sku`, `size`, `colour`, `stock`, and optional `low_stock_threshold`) are either all present or all absent, allowing a draft product with no variants. The exact columns are `product_slug`, `name`, `category_slug`, `collection_slugs`, `base_price_rupees`, `compare_at_price_rupees`, `sku`, `size`, `colour`, `stock`, `low_stock_threshold`, `short_description`, `description`, `fabric`, `occasions`, `care_instructions`, `made_in`, `tags`, `seo_title`, `seo_description`, `is_new_arrival`, `is_bestseller`, `exchange_eligible`, and `merchandising_rank`.

Imports are create-only and always create `DRAFT` products. Existing product slugs or SKUs are blocking errors; import never updates, replaces, publishes, archives, or deletes a product or variant. Category and collection references use unique slugs and must already exist in a non-archived state. Import never creates taxonomy and does not accept database IDs, status, media URLs/IDs, timestamps, demo flags, or arbitrary provider data. The specification's ambiguous discount field maps only to the existing optional compare-at price: rupee values are parsed as exact decimal currency, converted once to integer paise, and compare-at must exceed selling price. Boolean cells are strict `true` or `false`; SKU/size/colour, text, array, variant, relationship, and money normalization ultimately pass through the canonical product validator and Mongoose validation.

Preview performs no catalogue write. It accepts at most 2 MiB, 500 nonblank rows, 200 products, 100 variants per product, 30 collections per product, the existing per-field limits, and a bounded diagnostic list. It handles an optional UTF-8 BOM and RFC-style quoted commas/newlines, rejects malformed quoting, unsupported encoding, NUL/control data, mismatched columns, duplicate products/SKUs/variant selections, and invalid or unavailable relationships. A preview job stores only the normalized immutable create plan, SHA-256 content hash, schema version, actor, bounded safe diagnostics, summary, and lifecycle metadata. It expires for confirmation after 30 minutes and is purged by TTL seven days after terminal completion or failure. Preview identifiers are opaque and every read/confirm remains actor-bound even though the caller is an administrator.

Confirmation requires a high-entropy `Idempotency-Key` bound to the actor, preview ID, content hash, schema version, and create-only mode. Exact replay returns the stored completed result; reuse for another preview conflicts. Confirmation rechecks expiry, taxonomy state, slug/SKU conflicts, and canonical validation while holding the existing non-expiring catalogue write guard. It requires transaction-capable MongoDB and fails closed before product writes on standalone topology. All products, the job result, and one strict `PRODUCTS_IMPORTED` audit record commit in the same transaction; any stale relation, duplicate-key race, validation failure, audit failure, or transaction error rolls the entire batch back. The audit contains only the import ID, bounded created identifiers, counts, and schema version—never raw CSV or full descriptions. Parsing and preview validation occur before the catalogue lock; transaction-session operations are sequential.

Export is ADMIN-only, private and non-cacheable, deterministic, and streamed as UTF-8 CSV with the same column order and one row per variant (or one blank-variant row for a product without variants). It exports the approved business fields for every product lifecycle state but intentionally omits lifecycle status, media, Mongo/variant IDs, demo flags, audit data, timestamps, and provider metadata. It is a catalogue-content extraction, not a lossless database backup; re-import into another environment creates drafts and requires the referenced taxonomy to exist. Integer paise values cross the boundary as fixed two-decimal rupee strings. Strings whose first non-space character could execute as a spreadsheet formula are prefixed safely on export and reversibly normalized on import. Export uses stable slug/SKU ordering, bounded database cursors/backpressure, safe attachment headers, and a strict `PRODUCTS_EXPORTED` audit containing only filters and exported counts.

The frontend adds one protected `/admin/products/import` page and navigation entry only when the route exists. It keeps the selected file and workflow state local, sends the original bytes for server validation, displays summary plus bounded row/field diagnostics, disables confirmation while blocking errors exist, confirms only by opaque preview ID with one stable idempotency key, and retains ambiguous outcomes for safe same-key retry/status retrieval. It provides an authenticated Blob export and revokes object URLs. Loading, errors, expiry, retry, confirmation, success, and empty states are accessible and mobile-safe. No browser parser, chart/state library, fake product data, general product editor, taxonomy editor, inventory-adjustment UI, media upload, or AI generation is added by Task 25.

**Why.** A CSV is a compact bulk-write program, not merely a file upload. Create-only drafts avoid stale absolute-stock or price overwrites and accidental publication; server-held plans prevent a browser from altering validated data; a single guarded transaction preserves catalogue and audit atomicity; and strict limits keep parser, database, and UI work bounded. Slug relationships make files portable without exposing environment-specific IDs, while omission of media and lifecycle avoids bypassing verified-asset and publication workflows.

**Cost.** Existing products cannot be updated in bulk, imports need a replica set, previews expire, taxonomy must be provisioned first, and large catalogues require multiple files. Export is not a full backup and does not preserve publication state or media. A future update/import mode requires an explicit optimistic-concurrency and stock-reconciliation contract rather than extending this create-only path implicitly.

## D35 — Administrative catalogue edits use revisions and inventory uses an idempotent delta ledger

**Decision.** Task 26 exposes the existing Mongoose product version key to administrators as `revision` and treats it as the catalogue aggregate revision. Every structural edit, lifecycle transition, order reservation, order release, exchange replacement reservation, and manual stock adjustment increments it. Administrative product edits and status transitions must provide `expectedRevision`; a stale command returns `STOCK_CHANGED` with no write and the client reloads before offering an explicit retry. Product creation remains a single non-idempotent command protected by unique slug/SKU constraints; clients do not automatically replay an ambiguous create. Status changes are revision-guarded and naturally safe to retry after reloading rather than receiving a separate idempotency namespace.

General product updates never set stock on an existing variant. Their variant payload is a complete structural list: every existing embedded variant ID must remain present, with stock preserved by the server, while new variants begin at zero. Product creation—including Task 25's create-only CSV path—may provide initial stock because no concurrent product aggregate exists yet. Variants have an `ACTIVE` or `RETIRED` lifecycle. Existing variants are retired rather than physically removed, preserving immutable order and exchange references; retired variants cannot be selected for a new cart, order, or replacement, but a release still restores stock by historical variant ID. Publishing requires at least one active variant. Public availability, facets, and sellable selections consider active variants only.

Manual inventory is a dedicated ADMIN command at `POST /admin/products/:productId/variants/:variantId/stock-adjustments`. It accepts a non-zero integer `delta`, `expectedProductRevision`, `expectedStock`, a closed business `reason`, and an optional bounded note. It also requires a high-entropy `Idempotency-Key`. The key is SHA-256 hashed and scoped to the actor; its fingerprint binds product, variant, delta, expected revision/stock, reason, and note. Exact replay returns the original committed result, while key reuse for any different command returns `IDEMPOTENCY_CONFLICT`. A compare-and-swap rejects stale revision/stock and any adjustment that would make stock negative.

Each accepted adjustment atomically commits the product delta/revision, one append-only `AdminInventoryTransaction`, and one strict `STOCK_ADJUSTED` audit row in a MongoDB transaction. The ledger records actor, product, variant, reason, note, delta, before/after stock, before/after revision, key hash, and fingerprint, with unique actor/key and product/variant history indexes. The command fails closed when transactions are unavailable. Commerce stock writers continue to use their existing guarded deltas and domain ledgers, but now increment the same product revision so an administrator can never silently overwrite concurrent order or exchange activity.

Product media continues through D21's signed intent, direct provider upload, completion verification, and exact ready-asset attachment checks. Editing detaches the product reference before an administrator may explicitly delete an unreferenced asset; provider deletion is never attempted first. Unattached product uploads retain D21/D22's explicit cancellation/deletion path and are not automatically reclaimed as READY orphans. Task 26 adds both category and collection administration because D19 makes both part of product validity. Product/category customization options, measurement capture, quoting, and custom-order configuration remain deferred to the customization domain; the product aggregate gains no speculative fields for them in this task.

**Why.** Absolute stock inside a whole-array product save can replay stale values over an order or exchange and physical variant removal can make a later cancellation impossible to release. One aggregate revision makes every source of stock drift visible, while an idempotent delta plus expected stock expresses an administrator's intent without converting a stale screen into a destructive write. Keeping the manual ledger separate from the Order-required inventory ledger preserves both domains' invariants, and committing evidence with the stock change makes every accepted manual correction accountable.

**Cost.** Administrative edits can conflict more often and require a reload; all commerce stock writers perform one additional integer increment. Manual adjustment requires a replica set and an idempotency key. Existing clients must send revisions and full existing variant identity, retired embedded variants remain in product documents, and initial CSV stock remains a creation-only exception. Customization administration requires a later explicit schema and migration.

## D36 — Reviews are immutable verified-purchase submissions with one-way moderation

**Decision.** Each customer may submit at most one review per product. Eligibility is server-authoritative and requires an actor-owned Order whose fulfillment state is `DELIVERED`, whose `deliveredAt` is valid and not in the future, and whose selected immutable order line has the exact opaque `lineToken`; legacy lines without a valid token are ineligible. The server derives product, order, variant, purchase display snapshots, and `verifiedPurchase`. A review requires an integer rating from 1 through 5 and a trimmed plain-text comment from 10 through 2,000 characters, and may contain one verified image. Customer reviews cannot be edited, deleted, or resubmitted.

New reviews begin `PENDING` and may transition exactly once to `APPROVED` or `REJECTED`. Moderation requires an `expectedVersion` compare-and-set in a transaction and a strict `REVIEW_MODERATED` audit row in that same transaction. Audit metadata contains only review/product identifiers, from/to states, and from/to versions; it never contains review content, media URLs, personal data, order numbers, or internal notes. Administrator internal notes are never exposed by public or customer DTOs.

Creation requires a high-entropy `Idempotency-Key`. Only its actor-scoped SHA-256 hash and a SHA-256 fingerprint of the canonical strict body are stored. An exact replay returns the original review, while reuse with a changed body returns `IDEMPOTENCY_CONFLICT`; post-error lookup resolves uncertain committed writes. Unique actor/product and actor/key indexes are the final concurrency fences.

Public review reads expose approved rows only and identify every reviewer with the literal `Verified customer`. Approved-only aggregates are computed at query time, rounded to one decimal, and never written to Product or allowed to increment Product `__v`; an empty product has `averageRating: null`, `reviewCount: 0`, and a zero-filled distribution with keys 1 through 5. Product lists aggregate in bulk rather than issuing one query per product, and commerce-internal product hydration does not request review aggregates. Homepage review placement is omitted from Task 27.

Review media has the dedicated `REVIEW` purpose under server-owned `reviews/` public IDs. Customer upload intent and completion endpoints force image media and that purpose, while existing provider inspection enforces configured JPEG/PNG/WebP MIME, decoded format, byte, and dimension limits. Review attachment and review creation share the catalogue-write guard and transaction so orphan reconciliation cannot claim a concurrently attached asset; persisted-reference and READY-orphan reconciliation include Review.

**Why.** Immutable delivery evidence and line identity prevent catalogue drift, guessed ownership, and retroactive eligibility. One-way moderation prevents approved content from changing without another review decision. Query-time approved aggregates cannot become stale or perturb catalogue optimistic concurrency, while actor-scoped idempotency and database uniqueness make retries and races deterministic.

**Cost.** Existing orders without valid line tokens cannot be reviewed, rejected reviews cannot be revised, submission and moderation require transaction-capable MongoDB, and aggregate reads add one bounded set-based query to public product list/detail responses. A later homepage feature must choose placement and presentation explicitly rather than inheriting an accidental Task 27 contract.

## D37 — Transactional notification and SMTP delivery core

Task 28 uses a provider-neutral SMTP adapter authenticated with an app password; Resend is not used. Production requires `EMAIL_PROVIDER=smtp`, complete SMTP credentials, and an explicit notification encryption key. Exact delivery intent is durable, but SMTP cannot guarantee end-to-end exactly-once delivery after ambiguous provider acceptance. Delivery therefore uses a stable `Message-ID` and a leased, at-least-once worker.

Notification deduplication is canonical across event, recipient, and channel. Provider I/O never occurs inside a database transaction. Customer order and exchange email is addressed to the immutable checkout email carried by the event. Admin recipients are every current active `ADMIN`, resolved when the event is inserted; activity and role are checked again immediately before dispatch.

In-app notifications are retained for 180 days. Task 28 adds no deletion or preferences, and read/read-all mutations are idempotent. Email attempts run immediately, then after 1 minute, 5 minutes, 30 minutes, and 2 hours (maximum five attempts); exhausted/permanent failures become `DEAD`, and terminal metadata is retained for 30 days. Dispatch is a one-shot batch process intended for an external scheduler.

Email envelopes are encrypted at rest with AES-256-GCM and a versioned key ID. Production requires an explicit 32-byte key. Nonproduction may deterministically derive the key from an existing server secret only. No plaintext recipient address, email body, reset token, or template payload is stored in delivery rows or logs.

Password-reset token creation, generation increment, older-token invalidation, older-delivery supersession, encrypted queue insertion, and strict audit are one transaction in transaction-capable deployments. A newer monotonic generation supersedes old jobs and tokens; the worker rechecks generation, token use, and expiry immediately before SMTP. Reset consumption also requires the token generation to equal the user's current generation. Transaction/internal errors preserve the generic forgot-password response; internal callers receive `token: null` on failure.

The event matrix is: customer order confirmation, payment confirmation, shipped, out-for-delivery, and delivered; every meaningful exchange status update; and admin new order, confirmed payment, new exchange, and low stock. A low-stock episode is emitted only from an authoritative stock mutation that crosses a published product's active variant from above threshold to at-or-below threshold, including zero. Stock above threshold re-arms the state. A missing state first observed already low initializes without a historical alert. Threshold or status edits do not themselves emit.

Task 28 deliberately excludes marketing, WhatsApp/SMS, support/custom-order producers, arbitrary broadcasts, notification preferences, provider webhooks, and realtime push. Commerce, exchange, fulfillment, payment, and product-stock producers are wired in a later workstream through the public notification service API.

## D38 — Task 29 content is a separate revisioned publication boundary

**Decision.** Task 29 does not broaden the D22 `SiteSettings` singleton. It adds a bounded content module with fixed editorial page keys for `ABOUT`, `CONTACT`, `PRIVACY`, `TERMS`, `FAQ`, and `HELP_CENTER`, plus one fixed-key business profile. Page bodies are structured plain text only: a bounded title, summary, sections, paragraphs, and bullets. FAQ sections are rendered as accessible disclosures, but remain the same non-executable text model. Arbitrary keys, HTML, Markdown, scripts, style directives, media, and client-selected slugs are rejected.

Editorial and business-profile aggregates keep separate draft and published snapshots. Draft save, publish, and unpublish commands require expected revisions, increment the aggregate version, and commit a strict audit row in the same transaction. Public reads expose only the published snapshot and return an explicit `NOT_PUBLISHED` state when none exists; the presence of a private draft is never disclosed. No About history, cultural claim, legal identity, address, contact channel, registration, privacy term, FAQ answer, social account, support hours, or policy promise is seeded or inferred. The business profile permits only explicitly supplied display/legal name, support email/phone, WhatsApp number, Instagram URL, postal address, and support hours; every field is optional and absent until approved input is published. WhatsApp is a safe `wa.me` link with bounded URL-encoded text, not a provider integration.

Delivery and exchange pages are operational projections, not editable copies of commerce rules. The delivery projection reads the current `OrderPlacementSettings` authority and exposes only availability, version, allowed state, standard delivery charge, nullable free-delivery threshold, COD surcharge, and whether pincode-specific pricing may apply; checkout/serviceability remains authoritative for a particular address and cart. The exchange projection reads the versioned `ExchangePolicy` and exposes only availability, version, window days, and approved reason labels/evidence counts. It explicitly does not grant historical eligibility, promise approval, reserve replacement stock, quote a fee, or guarantee pickup/QC/replacement timing. Missing, disabled, or malformed authorities fail closed. Public revision-based responses may be briefly cacheable and revalidated; all admin content responses are `private, no-store`.

**Why.** Editorial/legal copy, contact identity, and commerce policy have different owners and publication semantics. A fixed structured model prevents a general CMS from becoming an XSS or mass-assignment surface, while authoritative projections prevent public policy pages from drifting from checkout and exchange enforcement.

**Cost.** The eight public pages remain truthfully unavailable until approved content/configuration exists. Adding a new document shape or business field requires an explicit schema change, and operational policy prose cannot be typed independently of the rules the system enforces.

## D39 — Support v1 is authenticated, transactional, text-only, and lifecycle-closed

**Decision.** Contact and “Talk to Support” use an authenticated support-ticket flow. Anonymous visitors may view published contact channels and are asked to sign in before entering a message; the validated internal return URL restores the selected category/context after login. Task 29 creates no guest access token, magic link, or anonymously retrievable conversation.

A ticket has an opaque random `SUP_` number, authenticated owner, immutable category/subject, optional server-resolved context, status, priority, summary counters/timestamps, bounded non-content history, and an optimistic version. Public and internal messages are immutable rows in a separate collection. Customer projections include public messages only; internal notes are structurally separate by visibility and are never returned by customer DTOs. Admin assignment is omitted because the application has no staff role. Configurable quick replies are bounded admin-owned text drafts; selecting one only fills an editable reply and never sends automatically.

Statuses are `OPEN`, `WAITING_FOR_SUPPORT`, `WAITING_FOR_CUSTOMER`, `IN_PROGRESS`, `RESOLVED`, and `CLOSED`; priorities are `LOW`, `NORMAL`, `HIGH`, and `URGENT`. Customer replies move `OPEN`, `WAITING_FOR_CUSTOMER`, or `RESOLVED` to `WAITING_FOR_SUPPORT`, leave `WAITING_FOR_SUPPORT`/`IN_PROGRESS` unchanged, and reject `CLOSED`. Admin public replies move `OPEN`, `WAITING_FOR_SUPPORT`, or `IN_PROGRESS` to `WAITING_FOR_CUSTOMER`, leave that waiting state unchanged, and reject resolved/closed tickets until an explicit reopen. Start-progress accepts open/either-waiting states; resolve accepts any nonterminal working state; close accepts resolved only; reopen accepts resolved/closed and returns to waiting-for-support; priority may change only while not closed. Internal notes never change status and are rejected once a ticket is closed; administrators must explicitly reopen before adding new retained content.

Ticket creation and every public/internal reply require actor-scoped high-entropy idempotency keys and canonical request fingerprints. Exact replay returns the committed result; changed reuse conflicts. Status/priority actions require an expected version and a transaction history marker. Ticket/message write, ticket CAS, strict audit, and notification intents commit in one majority transaction and fail closed when transactions are unavailable. Foreign and missing ticket numbers are indistinguishable. Private APIs are bounded, paginated, rate-limited, database-role authorized, and `private, no-store`; sensitive admin free-text search is carried in a validated POST body rather than a URL query string. Audit metadata contains identifiers, action, visibility, and version/status/priority transitions only—never subject, message/note text, contact data, or context details.

Closed ticket/message content is retained for 24 months, then becomes eligible for TTL purge through a shared `purgeAt`; reopening clears that deadline transactionally. The UI offers no delete command. A later account-erasure policy must deliberately reconcile legal/support retention rather than silently deleting one side of a conversation.

**Why.** Authentication avoids inventing an unsafe guest-conversation capability, separate immutable messages keep tickets bounded, and closed transitions plus CAS/idempotency make mobile retries and concurrent support actions deterministic. Transactional audit and notifications preserve the evidence and delivery guarantees established by Tasks 27–28.

**Cost.** A visitor must sign in to submit or continue support, support requires a transaction-capable MongoDB deployment, and assignment/guest support require later authorization designs. Closed conversations remain stored for the declared retention period.

## D40 — Support v1 has no attachments, AI, or speculative customization authority

**Decision.** Task 29 support is plain text. It creates no media purpose, upload endpoint, attachment field, preview contract, or orphan-reconciliation path. Persisted structured context is limited to an owner-verified order number or exchange number resolved by the backend; client-supplied database IDs are never accepted. Product questions may link to the existing public product page but do not persist privileged product context. `CUSTOMIZATION` remains a valid ticket category for a free-text question, while custom-request selection, `CUS_*` references, quotations, production status, and payments stay hidden until the customization domain exists.

The Help Centre and floating “Need help?” control are deterministic and rule-based. They may route to published FAQ/policy content, owner-authorized order/exchange pages, existing exchange eligibility/request flows, or a preselected support form. They never calculate or invent tracking, payment, stock, eligibility, fees, delivery dates, quotations, or state transitions. Support cannot mutate orders, payments, fulfillment, exchanges, prices, products, reviews, or inventory. No LLM/provider is required, and no AI process receives database or unrestricted tool access.

**Why.** Attachments require a dedicated trust/reconciliation boundary, and customization/AI each require authorities that do not exist. Keeping v1 text-only and deterministic delivers human handoff without creating insecure speculative capabilities.

**Cost.** Customers cannot attach evidence to support tickets in v1, and product/customization assistance is limited to approved content and human text discussion. Those capabilities need later explicit decisions and migrations.

## D41 — Support notifications extend D37 with content-free transactional events

**Decision.** Task 29 adds a `SUPPORT_TICKET` notification target and five closed types: customer `SUPPORT_TICKET_CREATED`, `SUPPORT_ADMIN_REPLIED`, and `SUPPORT_STATUS_CHANGED`; admin `ADMIN_NEW_SUPPORT_TICKET` and `ADMIN_SUPPORT_CUSTOMER_REPLIED`. Ticket creation sends customer confirmation plus the admin-new event. An admin public reply sends the customer-reply event. A customer reply sends the admin event. Explicit status changes send a customer status event when customer-visible state changes. Internal notes, quick-reply edits, priority-only changes, and exact replays emit nothing.

All approved events create both in-app and encrypted email intent. Customer recipients use the account’s current normalized name/email snapshot at the accepted support mutation; admin recipients are current active admins resolved at insertion and revalidated before dispatch. Generic copy contains no subject, message/note text, attachment, email, phone, order/exchange reference, or private context. Targets resolve only through `/account/support/:ticketNumber` or `/admin/support/:ticketNumber`. Event keys contain the durable ticket ID, committed ticket version, and type; recipient/channel deduplication, semantic hashes, stable SMTP `Message-ID`, retry/dead-letter behavior, retention, and provider separation remain D37’s contract.

**Why.** Support needs timely handoff without leaking conversation content or bypassing the existing outbox. Version-bound events converge under transaction retries and ambiguous commits while preserving one canonical intent per recipient/channel.

**Cost.** Active support conversations can generate email as well as in-app traffic. Preferences, realtime push, WhatsApp/SMS, digesting, and provider webhooks remain out of scope.

## D42 — Customization configuration is catalogue-owned, fail-closed, and snapshotted

**Decision.** Task 30 adds bounded customization configuration to Category and a whole-configuration Product override. Category configuration separately controls existing-product and own-design eligibility and defines stable-key option choices, age groups, sizes, measurement fields/units/ranges, and a reference-image limit. Product mode is `INHERIT`, `DISABLED`, or `OVERRIDE`; an override replaces the complete category definition rather than merging arrays. Collections never participate in precedence. Existing records resolve to disabled/empty category configuration and `INHERIT` product mode, so migration makes no product silently customizable. Category writes gain the same exposed revision and compare-and-set discipline as Product writes; Product overrides remain inside the existing aggregate revision.

The server resolves one effective configuration and exposes only customer-safe definitions. Submission snapshots the effective definitions, category/product identities and revisions, and a server-read product/selected-variant display snapshot. A referenced product is design context only: customization does not reserve, deduct, restore, or promise catalogue stock, and later catalogue edits do not rewrite a submitted request.

Customer reference images use a dedicated `CUSTOM_REQUEST_REFERENCE` media purpose under a server-generated `custom-requests/` prefix. Authenticated endpoints force image media and this purpose; completion remains owner-bound and provider-verified. Submission rechecks every asset as READY, actor-owned, correct-purpose, image media before attaching it under the existing media-reference lock. Unattached READY references enter the existing delayed orphan reconciliation; attached references count as persisted media references. Voice notes are omitted from Task 30 v1.

**Why.** Whole replacement gives deterministic inheritance, fail-closed defaults avoid accidental commercial promises, and a dedicated media purpose preserves ownership and orphan cleanup without weakening Product, Review, or Exchange evidence boundaries.

**Cost.** Configuration requires explicit administrator setup and category CAS migration. Existing-product CTAs and own-design category choices remain unavailable until configuration is deliberately enabled.

## D43 — A custom request is an authenticated transactional commercial conversation

**Decision.** A submitted request receives a globally allocated immutable `CUS-` number from a transactionally incremented singleton sequence. `CustomRequest` owns the authenticated customer, request type, submission snapshots, requirements, age/size/measurement snapshot, verified reference media, priority, bounded history/activity, current quote link, and optimistic version. Saved `MeasurementProfile` records are optional, owner-bound, independently editable, and copied as a snapshot at submission; selecting a profile never makes later profile edits mutate a request.

Task 30 v1 accepts a request directly as `SUBMITTED`; it does not persist abandoned server drafts. Admin request actions form a closed state machine: `SUBMITTED → UNDER_REVIEW → FEASIBILITY_CHECK`; any working review state may request information and enter `NEED_MORE_INFORMATION`; a customer public reply returns that state to `UNDER_REVIEW`; admins may reject before quote acceptance. Quote preparation/sending and acceptance supply the quote states; payment, production, shipping, delivery, completion, and cancellation are projections from their separate authorities. Browsers never submit an arbitrary status.

Public customer/admin messages are immutable `CustomRequestMessage` rows with actor-scoped idempotency. Private notes use the same immutable collection with structural `INTERNAL` visibility and are excluded by customer queries and DTOs. Messages cannot approve feasibility, set price, acknowledge policy, confirm payment, or advance production. Every accepted request/message/action commits version/CAS evidence, strict content-free audit metadata, and applicable notification intents in one required majority transaction; ambiguous outcomes reconcile by durable idempotency or history markers. Foreign and absent request numbers are indistinguishable on customer routes.

Submitted commercial requests, messages, quotes, policy evidence, payments, and workflow history receive no TTL in Task 30 because no legal retention duration is approved. Support tickets created from a request remain separate and keep D39 retention.

**Why.** Separate immutable content and closed commands preserve ownership, retry safety, and private-note boundaries while keeping commercial state out of an unbounded conversation body.

**Cost.** Task 30 requires a transaction-capable MongoDB deployment for accepted writes. Abandoned browser-only form state is not a durable request and must be resubmitted after local loss.

## D44 — Customization policy and quotations are immutable versioned acceptance authorities

**Decision.** Task 30 adds fixed editorial key `CUSTOMIZATION_POLICY` at `/customization-policy`. No policy text, exchange eligibility, reproduction guarantee, cancellation term, return term, fee, or delivery promise is seeded or inferred. Every publish also writes an immutable content revision snapshot/hash. Request submission requires explicit acknowledgement of the currently published revision/hash; quote acceptance requires explicit acknowledgement of the exact revision/hash bound to that quote. Missing publication fails closed, stale evidence conflicts, and later publication never rewrites historical acceptance.

`CustomRequestQuote` revisions are server-calculated integer-paise records. Admin inputs bounded components for base, customization, material, other, shipping, and discount; the backend computes `final = charges - discount`, rejects a negative result, and never accepts a client final amount. Production and delivery estimates are optional bounded administrator-supplied text, not generated promises. Quote expiry days are an explicit admin input per sent quote in v1; there is no invented global duration. Preparing a new revision supersedes any unaccepted draft; sending transactionally supersedes a prior sent quote. Only the current unexpired `SENT` revision can be accepted, and one request can produce only one accepted commercial order. Customer change requests return the request to review and supersede the sent quote.

**Why.** Immutable policy evidence and quote revisions preserve exactly what was offered and acknowledged, while server arithmetic prevents frontend price authority and revision races.

**Cost.** Submission and acceptance remain unavailable until administrators publish real policy content. Administrators must supply every charge, expiry, and estimate deliberately.

## D45 — Quote acceptance creates a separate custom commercial order and typed payment

**Decision.** Accepting the current quote is an idempotent owner-bound transaction that validates a canonical Karnataka shipping address, current request/quote versions, quote expiry/arithmetic, and quote-bound policy acknowledgement, then creates one immutable `CustomOrder` linked to the `CUS-` request. Custom orders do not synthesize Product variants, consume Cart, coupons, normal Order settings pricing, exchange snapshots, or inventory ledgers. The custom order stores the accepted quote/address/policy snapshots and separate payment, production, fulfillment, and completion axes.

Payment is PREPAID-only and remains unavailable when the configured payment adapter is unavailable. Task 30 generalizes Payment and PaymentEvent to a closed typed payable (`ORDER` or `CUSTOM_ORDER`) while preserving existing provider references, actor idempotency, amount/currency binding, event replay, encrypted notification, and late-success refund reconciliation. Existing normal-order routes and behavior remain backward compatible. Custom initiation derives amount only from the accepted quote; provider/webhook confirmation is the sole payment-success authority. Submission and quote acceptance never charge automatically. COD, deposits, instalments, customer-declared success, and general paid cancellation/refunds are excluded.

Production is a dedicated explicit state machine after verified payment: `NOT_STARTED → IN_PRODUCTION → QUALITY_CHECK → READY_TO_SHIP`. Manual custom fulfillment is `UNFULFILLED → SHIPPED → OUT_FOR_DELIVERY → DELIVERED`, followed by explicit `COMPLETED`. Commands require expected versions, never accept client timestamps, and use durable request/version reconciliation markers. A pre-payment admin cancellation is permitted before production/shipment and has no stock/coupon release; paid cancellation fails closed until a refund/material policy exists. Shipment records gain a closed typed target without changing normal-order fulfillment behavior.

**Why.** A separate commercial aggregate avoids fake catalogue facts and stock effects, while typed payment/shipment targets reuse verified provider and tracking mechanics without duplicating security-critical engines.

**Cost.** Production prepaid remains unavailable until a real configured provider is ready. Paid cancellation/refund, invoices, taxes, deposits, raw-material inventory, live carrier integration, and customized exchange eligibility need later approved contracts.

## D46 — Custom request handoff and notifications extend existing closed boundaries

**Decision.** Support gains owner-verified `CUSTOM_REQUEST` context resolved only from authenticated owner plus `CUS-` number. A handoff creates a normal support ticket with a customer-visible summary and immutable context; it does not copy requirements, measurements, media, quote data, or private notes, and support cannot mutate the custom domain.

Notifications gain target `CUSTOM_REQUEST` and a closed content-free matrix. Customer events are request submitted, admin replied, information needed, quote ready, status changed, and payment confirmed. Admin events are new request, customer replied, quote accepted, and payment confirmed. Internal notes, priority changes, draft quote preparation, failed commands, and exact replays emit nothing. Payloads are empty; generic templates and closed deep links expose no requirements, measurements, media, contact/address, quote amount, policy text, message content, or internal reason. Publication stays transactionally joined to the authoritative mutation and reuses D37 recipient resolution, encryption, deduplication, retries, and retention.

**Why.** Verified reference handoff prevents repeated explanation without duplicating sensitive commercial data, and content-free events provide timely workflow signals through the established outbox.

**Cost.** Notifications carry no commercial detail, so customers and administrators must open the authorized request workspace for current information.

## D47 — Size guides are dedicated publishable manual-chart aggregates

**Decision.** Task 31 stores each size guide as a dedicated aggregate with an immutable slug, separate bounded draft and published snapshots, independent draft and published revisions, and optimistic compare-and-set commands. A snapshot contains only administrator-authored plain-text title, optional summary and notes, an ordered unique set of `{ key, label }` columns, and ordered unique `{ sizeKey, label, cells }` rows. Every row must have exactly one string cell per column. Cells remain bounded strings: the server does not parse measurements, assign units, convert values, infer body-versus-garment meaning, or calculate fit. No chart values, units, instructions, aliases, conversions, or fit claims are seeded.

**Why.** Structured keyed charts support accessible tables and deterministic administration without forcing unapproved sizing semantics into catalogue records or duplicating one chart across products. Draft/publish separation prevents unfinished measurements from reaching customers.

**Cost.** Administrators must supply and verify every label and cell, and a guide remains unavailable until explicitly published. Changing a slug requires creating another guide because public identity is immutable.

## D48 — Category defaults and Product modes have explicit closed precedence

**Decision.** A Category owns a nullable default Size Guide reference. A Product owns `sizeGuideMode` with the closed values `INHERIT`, `DISABLED`, and `OVERRIDE`, plus a nullable override reference accepted only in `OVERRIDE`. `INHERIT` considers only the Product's Category default, `DISABLED` resolves no guide, and `OVERRIDE` considers only the selected override and never silently falls back. Collections do not participate. For legacy or malformed Product data, missing or unknown mode resolves `DISABLED`; missing, malformed, absent, or unpublished selected guides resolve null. Administrative DTOs keep configured references separate from the resolved customer chart.

**Why.** A nullable Product reference alone cannot distinguish inheritance from an intentional opt-out. Closed whole-reference precedence is deterministic and avoids surprising fallback when an explicitly selected guide is withdrawn.

**Cost.** Existing products do not inherit automatically and require an explicit administrator save before showing a guide. An invalid override hides the control instead of substituting the category chart.

## D49 — Manual charts are optional and carry no variant-size contract

**Decision.** Product and Category publication do not require a Size Guide. A published catalogue record may resolve no chart, and public Product detail then omits the Size Guide payload/control. Guide row keys are not validated against Product variant size values: Task 31 establishes no approved rule that rows are canonical sellable sizes rather than display labels, age bands, aliases, or another business convention. Assignments may reference draft or published guides administratively; public resolution always requires a current published snapshot.

**Why.** Blocking catalogue publication or equating labels to SKUs would invent a business contract. Optional fail-closed resolution lets the business add verified charts incrementally without making an absent chart a false product-validity failure.

**Cost.** Administrators are responsible for assigning an appropriate chart, and the system cannot warn about apparent row/variant mismatches until a canonical size vocabulary is approved.

## D50 — Standalone visibility is opt-in and unpublish is an emergency withdrawal

**Decision.** Each authored snapshot includes `showOnStandalone`, defaulting false. The standalone public Size Guide page lists only currently published guides whose published snapshot explicitly opts in; product-only overrides are not exposed by assumption. Task 31 provides no hard-delete endpoint. An administrator may unpublish a guide even while Category or Product assignments retain its ID. Unpublish immediately removes it from standalone and resolved Product output; assignments remain visible administratively so the guide can be corrected and republished or deliberately reassigned.

**Why.** Opt-in prevents internal/product-specific charts from leaking into a general page. Allowing immediate withdrawal is safer than forcing an administrator to race through every reference when a chart is wrong, while retained references preserve intent and avoid destructive catalogue edits.

**Cost.** Referenced products can temporarily lose their Size Guide without a catalogue revision change. The UI must fail closed, and administrators must review retained assignments before leaving a guide unpublished.

## D51 — “Find My Size” remains unavailable until its authority is approved

**Decision.** Task 31 implements manual charts only. It exposes no recommendation endpoint, measurement intake, recommendation result, confidence score, persistence, or generic disclaimer. “Find My Size” remains unavailable until the business approves relevant inputs, units, body/garment semantics, deterministic rules, size aliases, privacy and retention behavior, and exact recommendation-not-guarantee wording. A chart-row match is never treated as a recommendation.

**Why.** Height, weight, bust/chest, waist, and preferred fit do not define a safe formula on their own. Inventing thresholds or disclaimer text could produce materially wrong apparel advice and collect body data without an approved purpose.

**Cost.** The specification's recommendation experience is deliberately incomplete; customers receive only business-authored charts until the missing business authority is supplied.

## D52 — Social sharing is user-triggered, tracker-free, and channel-bounded

**Decision.** Task 32 supports WhatsApp, canonical copy-link, and the browser's native Web Share capability when it is available. WhatsApp and native sharing receive a bounded pre-filled message containing only the current public Product name, the Sanchandana brand, and a public preview URL. Copy-link always copies the canonical Product URL. No platform SDK, tracking parameter, contact upload, recipient selection, background message, marketing automation, or additional social network is added. A cancelled native share is a no-op; accepted and failed actions receive accessible feedback.

**Why.** WhatsApp and copy-link are explicit requirements, while native Web Share is a privacy-preserving implementation of “appropriate social sharing” that delegates channel choice to the customer and adds no third-party script. Keeping every action user-initiated avoids turning product sharing into marketing communication or spam.

**Cost.** Native sharing is absent on unsupported browsers, and the application does not provide dedicated Facebook, Instagram, X, or Pinterest controls. Those channels require a later deliberate privacy and UX decision.

## D53 — Canonical Product URLs and crawler previews share one configured origin

**Decision.** `STOREFRONT_URL` on the backend and `VITE_SITE_URL` in the frontend identify the same public storefront origin and must be origin-only HTTP(S) URLs. Production requires HTTPS. Canonical URLs, Product structured data, copy-link, and browser metadata use that authority rather than the incidental browser host. The existing same-origin `/api` proxy from D16 remains mandatory.

Social unfurl actions use `GET /api/share/products/:slug`. That endpoint reads only the existing publication-safe public Product DTO and returns a small noindex HTML document with canonical/Open Graph metadata before immediately redirecting a human browser to the canonical Product page. Draft, archived, missing, or relation-private Products remain not found. The preview URL is not a second indexable Product identity, accepts no database ID or query payload, and persists nothing.

**Why.** WhatsApp and similar crawlers do not reliably execute the SPA, so runtime head mutations cannot satisfy the shared-preview requirement. A same-origin publication-safe preview works with the deployment contract already required for authentication and avoids inventing a full SSR platform or a provider-specific edge function.

**Cost.** A person opening an unfurled link passes through one lightweight redirect. Deployments must keep frontend and backend origin settings equal; a future full SSR/prerender architecture may make the preview route unnecessary.

## D54 — Social metadata uses current commercial truth and verified media only

**Decision.** The preview title contains the current public Product name and Sanchandana brand. Its description includes the exact current integer-paise INR price and, when present, already-approved Product SEO or descriptive copy. Its image is only the Product's current primary verified Cloudinary image or verified video poster. If no verified image exists, image tags are omitted; no default Product image, logo, crop claim, review, rating, discount, availability promise, delivery promise, cultural claim, or other business fact is synthesized. Preview responses are non-cacheable so a withdrawn Product or changed price is not deliberately retained by the application.

**Why.** Task 32 requires name, price, brand, and real Product imagery, while §§62 and 69 prohibit fake imagery and business data. Reusing the public DTO keeps publication, relationship visibility, current stock/media, and price authority in one place.

**Cost.** A Product without verified visual media has a text-only preview, and external social platforms may still cache a previously fetched card beyond the application's control.

## D55 — Coupon administration uses configuration revisions, not redemption revisions

**Decision.** Every admin Coupon DTO exposes `revision`, and every configuration update requires the matching `expectedRevision`. A successful configuration change increments the revision atomically; a stale writer receives `COUPON_CHANGED` and must reload. Order redemption and release remain server-owned counter operations and do not increment this administrative revision. Coupon updates use field operators and never write `usageCount`, while MongoDB transaction conflicts protect a concurrent limit change from racing a redemption.

**Why.** Two administrators must not silently overwrite each other's campaign configuration, but ordinary purchases should not make an open admin form stale after every redemption. `usageCount` is commercial state owned by order transactions, not an admin-editable form field.

**Cost.** `revision` alone does not indicate that usage changed. Admin screens continue to display the current count returned by the latest read, and an update that depends on it may be transaction-retried or rejected by validation.

## D56 — Coupon configuration and its audit evidence commit together

**Decision.** Coupon create and configuration update require a transaction-capable database. Reference validation, the Coupon write, and `auditService.recordStrict` run in one transaction under the catalogue write mutex. Audit metadata lists fields whose normalized persisted values actually changed, including an implicitly cleared discount field, and excludes command fields such as `expectedRevision`. A no-op update does not increment the revision or write a misleading update event.

**Why.** Accepting a campaign mutation without its audit evidence is unsafe, and reporting submitted rather than changed fields gives operators a false history. The mutex keeps Product and Category eligibility checks aligned with concurrent catalogue publication changes; the transaction keeps redemption counters and configuration validation coherent.

**Cost.** Coupon administration fails closed on a standalone MongoDB deployment. Production and tests already use transaction-capable replica sets for order and coupon redemption invariants.

## D57 — Coupon policy remains unchanged; admin inputs are human-facing only

**Decision.** Task 33 does not add immutability after redemption, new lifecycle transitions, a derived `SCHEDULED` status, new expiry rules, reduced-limit policy, reporting, or custom-order coupons. Existing persisted statuses and eligibility behavior remain authoritative. Admin forms display percentages and rupees, convert exactly to basis points and integer paise at submission, and clearly mark archived Coupons read-only. Cart validation remains a provisional server quote; order placement rechecks eligibility and performs the only consumption.

**Why.** Those campaign policies were not specified. Unit conversion and clearer status/copy improve operator and customer understanding without moving calculation authority to the browser or inventing commercial rules.

**Cost.** Some potentially useful campaign governance and reporting remain deliberately deferred until the business approves their semantics.

## D58 — Coupon targeting lookups are bounded and purpose-limited

**Decision.** Product and Category targeting uses their existing bounded ADMIN search APIs. User-specific targeting uses a private, no-store, ADMIN-only bounded option lookup that returns only customer `id`, `name`, and `email`; it searches customer name/email and never returns phone, credentials, security state, or profile internals. Selected IDs remain the persisted authority and all references are revalidated by the Coupon service during the write.

**Why.** Raw MongoDB IDs are error-prone for operators, while order, exchange, and support endpoints are incomplete user directories and expose unrelated records. A narrow lookup supports the required user-specific Coupon workflow without creating a general customer export or trusting labels sent by the frontend.

**Cost.** Name and email remain personal data, so the endpoint cannot be public or cacheable. It is an option service only, not customer administration, reporting, or CSV export.

## D59 — Referral terms are disabled-by-default fixed-INR descriptors

**Decision.** Task 34 adds one singleton `referralProgram` policy to SiteSettings with `enabled`, `friendDiscountPaise`, `referrerRewardPaise`, and `minimumPurchasePaise`. Monetary values are nonnegative integer paise and cross the administrator UI as exact rupee decimals. The program defaults disabled with zero values. Enabling it requires positive friend-discount and referrer-reward descriptors; minimum purchase may be zero. These fields describe approved future terms only: neither the settings write nor any referral read applies a discount, creates a Coupon, records a balance, or promises that a reward has qualified.

**Why.** The requirement asks for configurable friend discount, referrer reward, and minimum purchase but does not define percentage semantics, reward medium, qualification, stacking, usage, expiry, or reversal. Fixed INR descriptors use the existing currency convention without inventing a financial engine, and disabled-by-default avoids advertising effects the checkout cannot yet perform.

**Cost.** Operators can configure and preview the intended terms, but enabling the referral account surface does not make them redeemable. A later approved launch task must define and implement qualification and redemption before making financial claims.

## D60 — Each customer may explicitly issue one stable private referral code

**Decision.** A dedicated Referral aggregate has one immutable owner and one unique, server-generated, high-entropy code. Authenticated customers may read their own referral program view and, while the program is enabled, explicitly issue their code through an idempotent POST. GET remains side-effect free. Issuance is rate-limited and accepts no client-selected code or owner identifier. Owner responses are private and non-cacheable; no customer directory, code lookup, aggregate statistics, rotation, deletion, expiry, invitation, or public landing endpoint is added. Account UI is omitted while the program is disabled and shows only the signed-in customer's code and descriptive terms when enabled.

**Why.** A separate aggregate matches the specified future Referral persistence boundary and enforces one-code-per-customer and unique-code invariants without expanding User. Explicit issuance avoids writes from a read request, and owner-derived identity closes IDOR and code-claiming paths.

**Cost.** Codes remain stable indefinitely and cannot yet be resolved or attributed. The model is intentionally only the identity seam for a future referral workflow.

## D61 — Task 34 performs no attribution, qualification, or financial side effects

**Decision.** The dormant `User.referredBy` field remains reserved and is not populated. Registration, cart, checkout, Coupon, Order, Payment, loyalty, notification, support, customization, and reporting flows remain unchanged. Referral code reads and issuance do not disclose another customer, consume a code, establish a referrer relationship, qualify an order, issue a coupon/credit/points/cash, or reverse a reward. The API returns integer-paise descriptors from server-owned settings, and frontend calculations are presentation/input conversion only.

**Why.** The specification provides no authority for attribution timing, self-referral/fraud policy, minimum-purchase basis, reward medium, lifecycle, usage limits, stacking, expiry, or reversals. Connecting commerce workflows before those decisions would create exploitable and misleading financial behavior.

**Cost.** Task 34 delivers future-safe architecture and customer codes, not a launch-complete referral promotion. Those deferred rules require explicit business approval and backend-authoritative implementation.

## D62 — Loyalty rates are disabled-by-default integer ratio descriptors

**Decision.** Task 35 adds one admin-owned `loyaltyProgram` policy to SiteSettings with `enabled`, `earningPoints`, `earningSpendPaise`, `redemptionPoints`, `redemptionValuePaise`, and `expiryDays`. The earning rate is displayed as “earn X points per ₹Y spent”; the redemption rate is displayed as “redeem X points for ₹Y”; expiry is a whole number of days. Points, paise, and days are bounded nonnegative integers. The policy defaults disabled with zero values, and enabling requires every ratio component and expiry to be positive. Exact integer ratios avoid floating-point rates and do not choose hidden rounding behavior.

**Why.** The requirement names earning rate, redemption rate, and expiry but does not define point value, percentage semantics, or an expiry unit. Explicit numerator/denominator ratios make units reviewable without pretending that a financial calculation has been approved. Disabled-by-default follows the requirement that loyalty must not complicate launch.

**Cost.** Administrators configure four rate components rather than one ambiguous decimal. The descriptors are not operational until later lifecycle rules are approved.

## D63 — Task 35 configures future policy but creates no customer balance

**Decision.** Task 35 does not create a LoyaltyAccount, mutable balance, ledger entry, customer history API, account widget, checkout control, order pricing component, admin adjustment, report, or notification. Loyalty policy remains private to authenticated administrators and is not added to public settings. No referral reward becomes points. No browser value can earn, redeem, reserve, release, reverse, or expire points. A future operational implementation must derive every amount on the backend, use an append-only owner-bound ledger with idempotent source-event fences, and snapshot the policy applied to each entry rather than recalculating historical value from current settings.

**Why.** There is no authority for the earning event, eligible spend, rounding, redemption cap, stacking, refund/cancellation/exchange treatment, manual adjustment, or account projection. A balance without those rules would be misleading and financially unsafe; documenting the trusted future boundary preserves architecture without making loyalty mandatory for launch.

**Cost.** Customers see no loyalty promise or balance in Task 35, and configured policy has no commerce effect. Launching loyalty requires a separate approved implementation.

## D64 — Expiry is a dormant duration descriptor, not a scheduled action

**Decision.** `expiryDays` records only the intended whole-day duration. Task 35 does not select a start event, calculate `expiresAt`, expire entries, schedule jobs, send reminders, or alter balances. A future implementation must define the authoritative start event and timezone/calendar semantics before using the descriptor and must expire immutable ledger lots rather than silently reducing an unexplained aggregate balance.

**Why.** “Expiry” alone does not establish whether time starts at placement, payment, delivery, return-window completion, or another event. Running expiry before that decision could remove customer value incorrectly.

**Cost.** The admin can record intended duration but cannot activate expiry processing.

## D65 — Abandoned-cart storage is a server-owned activity episode, not an inferred marketing event

**Decision.** Task 36 records one current `OPEN` abandoned-cart candidate episode per authenticated customer. An accepted server-side cart mutation (`set`, `remove`, authenticated merge, or move from wishlist) atomically advances a monotonic Cart activity revision; its best-effort projection records that revision, a server timestamp, the resulting product/variant identities and quantities, captured server-authoritative unit prices where available, and the resulting merchandise value. An empty result closes the episode as `CLEARED`; an exact order compare-and-clear closes it as `CONVERTED`. A later nonempty mutation advances the revision and starts a new `OPEN` episode in the owner’s current projection. `lastActivityAt` means accepted authenticated cart mutation time only: GETs, page views, browser focus, guest local storage, coupon quoting, session refresh, and frontend timestamps never advance it.

The lifecycle deliberately has no `ABANDONED`, `REMINDER_DUE`, or `REMINDER_SENT` state. A unique owner index retains exactly one current projection per owner, while compare-and-set on the Cart revision prevents a delayed older snapshot from overwriting or reopening newer `OPEN`, `CLEARED`, or `CONVERTED` state. `lastActivityAt` is descriptive metadata, never the ordering fence. An episode with an unavailable Product/variant records a nullable total with an explicit `UNAVAILABLE` value status rather than inventing or retaining a stale value.

**Why.** The requirement asks for cart, activity, items, and value but supplies no inactivity threshold. Recording the authoritative candidate episode preserves the future detection seam without claiming that a customer has abandoned a cart. Closing on empty or exact conversion prevents a later reminder system from treating a completed or cleared episode as active.

**Cost.** Task 36 stores the latest state of each cart episode rather than every click. No event is classified as abandoned until a later approved detector defines timing.

## D66 — Cart-event snapshots are minimized and expire after thirty days

**Decision.** Abandoned-cart episodes contain owner ID, lifecycle state, timestamps, bounded item identities/quantities, captured unit-price paise, total merchandise-value paise/status, and an optional converting Order ID. They contain no name, email, phone, address, consent flag, coupon, delivery quote, browser/device data, or message content. Every update sets `purgeAt` to thirty days after the server activity/closure time, and a TTL index removes the projection. The source Cart remains governed separately; an event may expire while an unchanged Cart still exists and a later mutation may begin a new episode.

**Why.** The projection is future reminder architecture, not an indefinite customer-behavior archive. Thirty days preserves a bounded operational window while minimizing duplicated shopping data and avoiding an unapproved analytics history.

**Cost.** Long-idle cart episodes are deliberately forgotten and no historical abandoned-cart reporting is available from Task 36.

## D67 — Task 36 sends no reminders and infers no consent

**Decision.** No Task 36 path publishes an in-app notification, creates an email delivery, invokes WhatsApp/SMS, adds a notification type, schedules a detector, or exposes customer/admin abandoned-cart APIs or UI. The generic registration `marketingConsent` and checkout contact data do not authorize abandoned-cart reminders. Any future email or WhatsApp sender must have an approved inactivity threshold, frequency/suppression policy, current purpose-and-channel-specific opt-in with withdrawal, and a final server-side check of the live cart and conversion state immediately before enqueueing.

**Why.** Signup currently describes occasional collection updates, not behavioral reminders, and no WhatsApp marketing provider or preference workflow exists. Architecture for a channel is not permission to contact a customer.

**Cost.** Events are recorded but never messaged or displayed in Task 36.

## D68 — Activity projection failures never corrupt cart or order truth

**Decision.** Cart and Order remain the operational sources of truth. Episode projection runs after an accepted cart mutation or committed exact order clear, is idempotent for the current owner episode, and logs bounded identifiers on failure without failing or rolling back the customer’s cart/order operation. Every atomic Cart write advances its durable activity revision. Activity projection replaces state only with a greater revision. A committed exact clear establishes `CONVERTED` at its pre-clear Cart revision even if the matching activity projection is delayed or absent; conversion outranks `OPEN` at that same revision but never overwrites a newer revision. The conversion fallback uses only immutable Order item/value fields plus the captured Cart activity timestamp, and wall-clock equality is never the ordering fence. A future detector must always re-read the live Cart and order state rather than treating this best-effort projection as financial or fulfillment authority.

**Why.** Cart mutations currently support standalone MongoDB and cannot be made dependent on a new cross-collection transaction without changing launch infrastructure. Returning an error after the cart already changed is worse than a missing non-financial projection; idempotent later activity repairs the current episode.

**Cost.** A database failure can omit or delay an episode update. This architecture favors shopping correctness and explicit reconciliation over pretending analytics-style capture is transactional.

## D69 — Task 37 composes existing owner-bound domains instead of creating an account aggregate

**Decision.** The customer account remains a frontend hub over independently authorized domain APIs. It displays the existing public profile allowlist and links to saved addresses, orders, wishlist, recently viewed, exchanges, reviews, and notifications; the existing referral section remains visible only when the admin-owned referral program is enabled. Saved addresses receive a dedicated protected account page that reuses the canonical address API and its serviceability/default/limit rules. Wishlist links to the existing responsive wishlist rather than duplicating storage or business logic under `/account`. Past Order address snapshots remain immutable when a saved address changes or is removed.

No broad “account details” endpoint joins profile, addresses, orders, behavioral data, or referrals into one cacheable payload. Every section keeps its existing owner checks, bounded DTO, private cache policy, lifecycle authority, and account-scoped client query state.

**Why.** Most Task 37 capabilities already exist as secure modules. Composition closes the customer-experience gaps without introducing a high-value PII aggregate, inconsistent copies, or a second implementation of address/wishlist behavior.

**Cost.** The account is assembled from several focused requests and customers navigate to dedicated sections rather than receiving one large dashboard response.

## D70 — Recently viewed is an expiring convenience list, not an analytics history

**Decision.** Recently viewed stores at most twenty unique Product identities ordered by most recent successful product-detail view. Authenticated customers have one owner-bound MongoDB document containing only Product IDs and server `viewedAt` timestamps. Entries older than thirty days are removed during reads/writes, and `purgeAt` plus a TTL index removes a document thirty days after its newest view. Guest storage uses one versioned localStorage record with the same twenty-item and thirty-day bounds and contains only Product ID and browser timestamp.

Responses hydrate only currently public products through the canonical catalogue projection and omit unavailable identities. The store contains no customer contact data, search terms, referrer URL, route history, session/device identifier, dwell time, variant/size selection, cart state, consent, or message metadata. Recently viewed is not exported as an event stream and is not used for analytics, recommendations, abandoned-cart detection, notifications, email, WhatsApp, personalization scoring, or advertising.

**Why.** Section 19 explicitly requires guest localStorage and authenticated MongoDB but calls only for “appropriate browsing information.” A bounded deduplicated list is sufficient to render the customer feature while minimizing behavioral data.

**Cost.** The application keeps no long-term viewing history, cross-product frequency, or attribution data, and unavailable products disappear from the visible list.

## D71 — Product-detail success is the only viewing signal, with deterministic privacy-safe merge

**Decision.** A product is recorded only after its public detail has loaded successfully. List impressions, search results, recommendations, hovers, prefetches, failed/not-found details, account-page reads, and recently-viewed reads never record activity. Re-viewing a product moves it to the front and refreshes its timestamp. Guest writes are local and non-blocking; authenticated writes use an owner-derived endpoint and are also non-blocking for product display.

When a guest signs in, the browser may merge its bounded Product ID order into the owner list. The server accepts IDs only—not browser timestamps—validates the bound, treats submitted guest order as most-recent first, appends unique existing identities, assigns server timestamps, and truncates to twenty. Local guest history is removed only after successful merge. Reads never advance timestamps. Customers may clear their recently viewed list; clear affects only this convenience projection and not Cart, Wishlist, Orders, audit data, or catalogue state.

**Why.** Explicit detail success avoids fabricating interest from incidental rendering, while server timestamps and owner identity prevent the browser from supplying behavioral chronology or another customer’s owner ID. Deterministic merge preserves useful guest context without trusting unbounded client data.

**Cost.** Guest and prior cross-device chronology cannot be perfectly interleaved; current-browser guest items intentionally precede existing account items after merge.

## D72 — “See profile” grants visibility, not unspecified account mutation or deletion semantics

**Decision.** Task 37 does not add profile editing, email/phone change, marketing preferences, self-service account deletion, review editing/deletion, referral rotation/redemption/rewards, notification preferences, or order/exchange history deletion. Profile remains the existing explicit public allowlist. Password and session controls remain the existing security workflows. Account deletion/request handling waits for approved legal retention, anonymization, identity-verification, and dependent-record rules; the conditional privacy requirement is not interpreted as permission to delete financial, fulfillment, payment, exchange, review, notification, referral, or audit records.

**Why.** The requirement says customers should see these account areas but does not define mutation authority or legally required retention. Guessing those rules could enable account takeover, erase records that must be retained, or imply marketing consent and financial rewards that do not exist.

**Cost.** Customers can manage saved addresses and clear recently viewed data, but other new account mutations require separate approved requirements.

## D73 — Task 38 tracking is a fixed projection of authoritative milestones

**Decision.** The customer Order detail renders exactly the required five-step sequence: `ORDER_CONFIRMED`, `PACKED`, `SHIPPED`, `OUT_FOR_DELIVERY`, and `DELIVERED`. Completion and timestamps come only from the existing owner-bound `tracking.milestones` projection. `PROCESSING` remains an authorized internal fulfillment/history state but is not inserted into the required customer sequence. COD confirmation is the accepted Order timestamp; prepaid confirmation exists only after trusted payment verification. Missing milestones remain pending and no browser state, current date, payment state, array position, or later milestone fabricates an earlier timestamp.

Cancellation does not create a sixth timeline milestone or mark pending delivery steps complete. The page may continue to show previously recorded milestones alongside the separately authoritative cancelled status. When a forward shipment exists, the customer may see only the allowlisted courier, public tracking identifier, canonical status, and supplied timestamps already returned by the backend. It exposes no private shipment ID, actor, internal reason, audit/request marker, provider payload, arbitrary tracking URL, location trace, delivery estimate, split-shipment claim, RTO/loss state, or COD-remittance inference.

**Why.** Task 38 prescribes a visual sequence, while D29 and D32 already define the trusted owner/privacy boundary and canonical fulfillment facts. Presenting that projection closes the UI gap without creating a second tracking authority or inventing carrier promises.

**Cost.** An order with incomplete manual operations shows pending steps without estimates. `PROCESSING` remains visible only in recorded operational history, and customers receive no live map or carrier link.

## D74 — Normal-order administration exposes only server-authorized explicit actions

**Decision.** The existing `/admin/orders/:orderNumber` route is mounted as a private ADMIN workspace so operations can create the trusted milestones consumed by Task 38. The page reads the existing admin detail DTO and renders controls only for the server-returned `availableActions`. Every command sends the displayed `version` as `expectedVersion`; `RECORD_SHIPMENT` accepts only the existing bounded courier, AWB, public tracking ID, and private shipment ID fields, while `CANCEL` accepts only its bounded reason. There is no generic status selector, arbitrary timestamp, carrier URL, raw provider body, payment override, rollback, or hidden client-side transition rule.

The canonical mutation response replaces the order cache. A stale/version conflict or uncertain error requires a fresh detail read and explicit administrator review; the browser does not silently replay a command against a newer version. Existing database-backed ADMIN authorization, strict validation, transaction requirement, audit, notification, stock/coupon release, shipment uniqueness, and ambiguous-commit reconciliation remain the authorities.

**Why.** The backend already contains the closed fulfillment state machine but the missing frontend route makes it unusable without direct API calls. Driving controls from `availableActions` preserves server authority and allows the customer timeline to acquire real milestones.

**Cost.** Operations must advance one order at a time and must reload after contention. Fulfillment remains unavailable on transactionless MongoDB and no bulk actions are introduced.

## D75 — Shiprocket synchronization remains conditional and disconnected

**Decision.** No Shiprocket credential, adapter, webhook, poller, scheduler, synchronization endpoint, or settings UI is added because Shiprocket is not connected. Manual provider-neutral shipment recording remains the approved implementation from D32 and satisfies Task 38's conditional wording. The UI never claims that displayed tracking is live or synchronized.

A later connection must remain behind the shipping service/adapter boundary, keep credentials server-only, authenticate provider callbacks, persist replay identifiers and payload hashes, map only verified provider events into the closed Order/Shipment lifecycle, reject regressions and unsupported states, and perform provider I/O outside database transactions before an idempotent authoritative transition. It must define polling/webhook precedence, event retention, reconciliation, exception/RTO/loss handling, and operational ownership before activation.

**Why.** A provider name is not an integration contract. Guessing authentication, signatures, event schemas, or status mappings could fabricate delivery facts, leak credentials, or repeat fulfillment side effects.

**Cost.** Courier progress is entered manually and may lag Shiprocket until a verified adapter is separately approved and configured.

## D76 — The Style Assistant is stateless, deterministic, and authority-bound

**Decision.** Task 67 adds one public, read-only `POST /chat` Style Assistant endpoint behind the existing chatbot rate limit and private no-store policy. It accepts one bounded message plus optional allow-listed product context and structured discovery slots; it never accepts or returns a raw prior transcript. A local deterministic `aiService` adapter classifies the request, while `chatService` alone orchestrates the existing public product search, catalogue, recommendation, and pincode-serviceability boundaries. Replies use finite plain-text templates, product results use existing public summaries, and navigation uses action enums that the storefront maps to fixed local routes. The browser keeps the visible conversation only in mounted component memory.

Order status and customer support are protected deep links, not public-chat data lookups. Delivery and exchange questions link to the current policy pages instead of copying mutable policy values. Size help reports only offered catalogue sizes and points to an existing size guide; it never infers fit from personal measurements. Sensitive-looking contact, payment, and order references are not echoed, retained in server state, logged by the module, or sent to another provider.

**Why.** This closes the documented product-aware assistant gap with live authoritative data while preserving privacy, owner authorization, stock and publication boundaries, and a replaceable future language-provider seam. No provider key, outbound AI request, conversation collection, browser storage, analytics event, or duplicated commerce rule is required.

**Cost.** Language understanding is intentionally bounded and no conversation survives drawer reset, close, navigation, or reload. A future LLM integration must preserve this request/response boundary, keep credentials and provider calls server-side, define retention and redaction before transmitting free text, and may not replace authoritative service reads with generated commercial facts.
