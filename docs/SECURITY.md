# Security model

This describes the controls that exist in the code and how each is verified. It is not a guarantee. No external
penetration test or production verification has been performed.

## Identity and sessions

- **Customers** sign in passwordlessly with a 6-digit code sent to *one* chosen channel (email via Resend, or WhatsApp
  via Meta). Signing in to a verified identifier creates the account if needed.
- **Vendor staff and Super Admins** are provisioned, never self-registered: an approved application (or an admin)
  creates the account in `invited` state and a **single-use setup link** (72 h, SHA-256 stored) lets the person set a
  password (scrypt, N=2^15, minimum 12 characters). Passwords are never emailed.
- **Super Admins** must pass an emailed OTP second factor after the password; every `/admin` API checks it.
- **Sessions are opaque random tokens** (256 bits) stored as SHA-256 hashes. That gives immediate revocation on logout,
  suspension, password reset or admin action, with no JWT algorithm or claim-trust pitfalls. Lifetimes: customer
  30 d / 14 d idle; vendor 7 d / 12 h idle; admin 12 h / 30 min idle.
- **Web** uses an `HttpOnly`, `SameSite=Lax`, `Secure` (production) cookie scoped to `/api`, plus a per-session CSRF
  token required on every state-changing request. **Mobile** uses a bearer token in the iOS Keychain / Android
  Keystore (`expo-secure-store`). A token works only on the transport it was issued for.
- Customer and staff identities are separate (`accountType`), so a customer OTP can never open a vendor account.
- Accounts are never merged automatically. Adding an email or phone requires an OTP, and an identifier owned by
  another account is refused.

## OTP controls (tests in `auth.test.js`)

CSPRNG codes · HMAC-stored code and destination (no plaintext) · 10-minute expiry · 5 attempts counted atomically
before comparison · single use via conditional write (8 concurrent submissions → exactly one success) · 60 s resend
cooldown · a new code supersedes old ones · caps of 5/hour per destination, 15/hour per IP and a daily global cap per
channel (stores fail closed) · generic errors · honest delivery-failure response that leaves no usable code · codes
never logged (pino redaction as a backstop).

## Authorization (tests in `booking.test.js`, `security.test.js`)

- Deny by default: every protected router starts with `requireCustomer`, `requireVendor` or `requireAdmin`.
- **Object-level checks are part of the query** (`{ _id, customerId }`, `{ _id, companyId }`), so another tenant's ID
  returns 404 exactly like a missing record.
- The vendor's company comes from their membership. `X-Company-Id` only selects among the caller's own memberships.
- Membership roles (owner/manager/staff) map to permissions checked per route.
- Suspended companies are read-only for their team and invisible to customers. Suspended users lose all sessions.

## Booking integrity

- The requested start must equal a slot the vendor's schedule currently offers (`matchScheduleSlot`). That rejects
  stale, off-grid, past, closed and too-far-ahead times.
- A booking and its 5-minute `SlotClaim` units are inserted in **one transaction**. The unique index
  `(resourceKey, unitStart)` makes overlaps impossible regardless of instance count.
- Transitions are conditional updates on the expected current status (no lost updates). Policy cutoffs and time
  rules are enforced server-side.
- Idempotency keys make retries return the original booking. Per-customer caps limit slot hoarding.

## Input, output and transport

- Strict zod schemas on every route (unknown fields rejected; explicit field mapping, never `Object.assign` from the
  body). Bodies containing `$`- or `.`-prefixed keys are rejected; Express 5 parses query strings flat.
- Search tokens are regex-escaped and length-limited.
- JSON only (415 otherwise), 100 KB body limit, 5 MB image limit with magic-byte sniffing (JPEG/PNG/WebP only — SVG
  and HTML are rejected). Server-chosen Cloudinary folders and IDs prevent cross-tenant overwrites.
- React escapes all rendered text, with no `dangerouslySetInnerHTML` anywhere. Email templates HTML-escape every value.
  Notification and redirect links are accepted only as same-site relative paths.
- API: Helmet with `default-src 'none'`, `frame-ancestors 'none'`, `no-referrer`, HSTS in production,
  restrictive `Permissions-Policy`, `Cache-Control: no-store`. CORS uses an explicit credentialed allowlist.
- Web: CSP meta tag in production builds plus `public/_headers` for static hosts.
- Errors use one envelope with a request ID; internals and stack traces go only to logs.

## Integrations

- All provider credentials are server-side env vars. Startup validation fails in production without required ones
  and refuses dev modes there.
- Webhooks verify signatures over raw bytes (Svix for Resend; HMAC-SHA256 for Meta), reject stale timestamps, dedupe
  event IDs, and can **only** update delivery status.
- OpenAI calls run server-side with structured output re-validated by zod. Model-proposed categories and dates not
  matching platform data are discarded. The model never mutates data. Per-caller and daily global limits fail closed.
  Minimal data is sent (the query only).
- Discovery assistant (`POST /ai/assistant`): the model only chooses an action (`ask`, `search`, `booking_help`,
  `chat`) and proposes filters. Filters are re-validated field by field against the public search schema and live
  categories; search runs through the same published-only service as manual search. Listing text is never sent to
  the model (no indirect prompt injection), and after a search the visible answer is written by the server from the
  actual results, so the assistant cannot claim results it did not get. There is no booking tool: booking requests
  return fixed guidance and the existing booking endpoint (auth, idempotency, slot revalidation) is the only way to
  create an appointment. Conversations are stateless (≤12 turns, ≤500 chars per user message) and are not stored or
  logged; the customer's precise coordinates are used for the search but never sent to the model. Limits: 10/min and
  120/day per caller, plus the global daily AI cap.
- Voice (`POST /ai/transcribe`): ≤4 MB, container verified by magic bytes, held in memory for the request only and
  sent to OpenAI transcription; 8/min and 60/day per caller. The transcript is returned for the customer to review —
  it is never submitted automatically. Spoken replies use the browser's built-in speech synthesis (no audio leaves
  the device for that).
- Account deletion: customer-only, requires a fresh OTP (`account_deletion` purpose, bound to the user) sent to an
  identifier already verified on the account plus an explicit `confirm: "DELETE"`; 10 attempts/hour per user. Deleting
  all `Session` documents invalidates every token immediately (`resolveSession` also rejects non-active users). Tests
  cover wrong codes, another user's code, vendor callers and all-device sign-out.
- Support: every query goes through one scope filter (customer → own tickets; vendor → selected company and, for
  staff, own tickets; admin → all), so foreign IDs return 404. Internal notes are excluded at the query level for
  requesters. Admin replies, notes and status/priority/assignment changes are audited; assignment only to active Super
  Admins. Tested for cross-customer, cross-vendor and role isolation.
- Super Admin homepage controls (category images, hero draft/publish, spotlight placement/order) require the admin
  session with MFA, use server-chosen Cloudinary folders under `townant/platform/`, validate bytes and fields, refuse
  suspended businesses, and are audited (`category.image_*`, `site.hero_*`, `site.spotlight_reorder`).

- Passwords: Super Admin and vendor changes require the current password; customer first passwords require a fresh OTP to a verified identifier. Temporary vendor passwords are random, shown once, expire after 72 h and gate every API (`enforcePasswordChange`) until replaced. Customer password reset uses OTP purpose `password_reset` bound to the account; unknown or ineligible addresses get an identical response with no message sent. Password fields are redacted in logs as a backstop.
- Account restoration (`/auth/account/restore`) needs a single-use, 15-minute token that is issued only after a correct sign-in code for that account, plus `confirm: "RESTORE"`, and is conditional on the recovery window still being open.
- Exports are Super Admin only, rate limited, capped at 10,000 rows and neutralise spreadsheet formulas in user text.

## Audit

Admin and vendor consequential actions (approvals, suspensions, booking transitions, profile and service changes,
admin message reads, logins) write `AuditEvent`s in the same transaction as the change. There are no update or
delete routes for audit records.

## Residual risks and recommendations

| Risk | Current mitigation | Recommendation |
| --- | --- | --- |
| Provider integrations not verified with live accounts | Coded to documented APIs; fakes in tests | Verify each in staging before launch (DEPLOYMENT.md) |
| One session cookie per browser shared by customer, vendor and admin shells | Role checks per API | Serve `/admin` from its own origin in production |
| Admin second factor is email OTP (email compromise = admin compromise with password) | Short sessions, audit, rate limits | Add TOTP/WebAuthn for Super Admins |
| No step-up re-auth for individual sensitive admin actions | MFA at login + 30-min idle timeout + reasons + audit | Add re-auth for suspensions and bulk actions |
| Vendor accounts have no MFA | Strong password policy, lockout, resets revoke sessions | Offer optional TOTP |
| Fixed-window rate limits in MongoDB | Shared across instances | Move to Redis at scale; add WAF/bot protection on OTP endpoints |
| Keyword search uses unindexed regex | Escaped, length-limited, rate-limited | Atlas Search / text index before large catalogs |
| CSP allows `'unsafe-inline'` styles (Framer Motion style attributes) | No inline scripts | Revisit with nonce/hash if styling approach changes |
| Audit log is access-controlled, not cryptographically tamper-evident | No mutation routes | Export to append-only storage (WORM bucket/SIEM) |
| Anonymous multipart voice uploads are CSRF-able cross-site (cost only; no data access) | Per-IP limits, global daily AI cap, fail-closed | Require a custom header or signed-in user if abuse appears |
| Uploaded images are not malware-scanned | Type sniffing, size limits, re-encoding by Cloudinary | Enable a moderation/scan add-on |
| Fixed-location vendor coordinates and addresses are public by design | Mobile vendors' street addresses hidden | Confirm with privacy review |
| Expo CLI dev-tooling advisories (`deepmerge` prototype poisoning, `zod@3` memory) | Build-time only on developer-controlled config; not in app bundle | Upgrade when Expo ships fixes |
| No error tracking, alerting, backups or restore tests yet | Structured logs, health/readiness | Choose hosting/monitoring (PDF §18) |
