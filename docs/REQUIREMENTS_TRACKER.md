# Requirements & implementation tracker

Sources: *TownAnt Product Blueprint and Technical Specification* (PDF, 21 pages, read in full) and the master
engineering brief. Mockups are treated as visual direction only.

**Status key** — ✅ Done and verified by tests or the browser smoke test · 🟡 Partial (gap stated) ·
🔌 Implemented against the provider's documented API but **not verified with live credentials** ·
⛔ Not started / blocked on a decision or external dependency.

Test references: `auth` = `apps/api/test/auth.test.js`, `booking`, `security`, `journeys` likewise; `smoke` = `e2e/web-smoke.mjs`.

## Platform rules (PDF §02)

| ID | Requirement | Status | Implementation | Security implication | Tests |
| --- | --- | --- | --- | --- | --- |
| R-01 | No online payments, deposits, refunds, payouts | ✅ | No payment code/deps; prices are display-only (`Service.price`) and labelled as such in every UI | Removes PCI scope | Manual review; no payment fields in schemas |
| R-02 | Customer OTP by email **or** phone; neither required | ✅ | `routes/v1/auth.js`, `services/otp.js` | Account identifiers verified before use | auth: email-only, WhatsApp-only |
| R-03 | Global-ready data (country codes, E.164, region/city/ZIP) | ✅ | `lib/phone.js` (libphonenumber), ISO-2 countries, IANA time zones | — | auth: UK number in national format |
| R-04 | Real data only; no hardcoded listings or metrics | ✅ | All screens bind to API; dashboards count `AnalyticsEvent`s; seed script creates categories only | Prevents misleading claims | journeys: dashboard counts; smoke |
| R-05 | Vendors scoped to their company; admin access audited | ✅ | `requireVendor` resolves company from membership; `AuditEvent` | IDOR prevention | booking/security: cross-vendor tests |
| R-06 | AI assistive only | ✅ | AI returns filters/suggestions; user must accept text | No model-driven mutations | security: AI groundedness |

## Customer discovery & profiles (PDF §04–05)

| ID | Requirement | Status | Notes | Tests |
| --- | --- | --- | --- | --- |
| C-01 | Browse/search without login | ✅ | `/catalog/*` public, rate-limited | journeys, smoke |
| C-02 | Keyword search over service, category, business | ✅ | Tokenized, regex-escaped search over `searchText` | security: regex literal |
| C-03 | Manual country/region/city/ZIP location | ✅ | Web location dialog, mobile sheet; service-area ZIPs match too | journeys |
| C-04 | Optional device location; never blocks browsing | ✅ | Requested only on tap; denied state falls back to manual entry | Manual (browser) |
| C-05 | Distance only when computable | ✅ | `$geoNear` when both sides have coordinates; otherwise `distanceKm: null` | — |
| C-06 | Filters: category/sub-category, rating, available date, radius, sort | ✅ | `availableOn` computes real open slots | journeys: availability filter |
| C-07 | Map view | ⛔ | Blocked on map/geocoding provider decision (PDF §18). Lat/lng search API is ready; vendors enter coordinates manually | — |
| C-08 | Public profile: details, media, services, hours, reviews, policies | ✅ | `services/catalog.js#publicProfile` | journeys |
| C-09 | Vendor-disabled sections not rendered publicly | ✅ | Omitted from API response, not just hidden | journeys |
| C-10 | Favorites | ✅ | Web + mobile | journeys |
| C-11 | Home: categories, curated sections from real listings, empty states | ✅ | Top rated / newest from search API | smoke |
| C-12 | Loading, empty, error, offline, permission-denied states | ✅ | Shared `ErrorState`/`EmptyState`, offline detection in API client | Manual |

## Booking (PDF §06) — critical path

| ID | Requirement | Status | Notes | Tests |
| --- | --- | --- | --- | --- |
| B-01 | Server-authoritative availability (hours, exceptions, duration, buffer, notice, horizon) | ✅ | `services/availability.js` | booking: off-grid/past/closed/far-future rejected |
| B-02 | Atomic reservation; no double-booking under concurrency | ✅ | `SlotClaim` unique `(resourceKey, unitStart)` + transaction | booking: 8-way same-slot race, 4-way overlapping race |
| B-03 | Idempotent confirmation | ✅ | `Idempotency-Key` header, unique per customer | booking: replay + concurrent same key |
| B-04 | Auth before confirm; return to pending booking | ✅ | Web booking modal signs in inline; mobile routes to sign-in | smoke |
| B-05 | Booking modes: instant and vendor-approved request | ✅ | Per service; requests expire and release the slot | booking: confirm, expire |
| B-06 | State machine with actor/time/reason history | ✅ | `TRANSITIONS` table + conditional updates | booking: invalid/double transitions |
| B-07 | Customer cancel/reschedule within server-enforced cutoffs | ✅ | Company `bookingPolicy` | booking: cutoff, reschedule conflict |
| B-08 | Vendor confirm/decline/cancel(reason)/complete/no-show/reschedule | ✅ | Time rules (no complete before start) | booking |
| B-09 | Admin override with reason + audit | ✅ | `cancel_admin` | booking |
| B-10 | UTC storage + explicit time zones, DST-safe | ✅ | Non-existent local times skipped; exact durations enforced | booking: DST test |
| B-11 | Mass-assignment protection | ✅ | Strict schemas reject `status`, `customerId`, `price`, … | booking |
| B-12 | Staff/resource-level scheduling | 🟡 | Data model keys claims by `resourceKey`; MVP uses one resource per company | — |
| B-13 | Mobile reschedule | 🟡 | Web supports it; mobile shows cancel + call, points to web for reschedule | — |

## Communications (PDF §10)

| ID | Requirement | Status | Notes | Tests |
| --- | --- | --- | --- | --- |
| N-01 | Email OTP via Resend | 🔌 | `providers/email.js`; dev/test fakes verified | auth |
| N-02 | WhatsApp OTP via Meta Cloud API (auth template) | 🔌 | `providers/whatsapp.js`; needs approved template | auth (fake) |
| N-03 | OTP controls: expiry, single use, attempts, cooldown, per-destination/IP/global caps, no plaintext | ✅ | HMAC-stored codes; atomic attempt counting | auth: 11 tests |
| N-04 | In-app notifications with unread state and deep links | ✅ | `Notification` + `/notifications` | journeys |
| N-05 | Email/push delivery best-effort, never blocks booking | ✅ | Transactional outbox + worker with retry/backoff | booking: provider outage |
| N-06 | Push via Expo (APNs/FCM) | 🔌 | Token registration in context after booking; unregistered tokens disabled | — |
| N-07 | Reminders ~24h before | ✅ | Job, one per booking/start time | Unit-level via service (not time-travel tested end-to-end) |
| N-08 | Notification preferences | ✅ | Email/push toggles; checked at send time | — |
| N-09 | Provider webhooks verified, replay-safe | ✅ | Svix (Resend) + `X-Hub-Signature-256` (Meta); dedupe table; status-only effects | security: webhooks |
| N-10 | Inquiries and booking-linked chat | ✅ | Close/reopen policy per DECISIONS.md | journeys |

## Vendor portal (PDF §07)

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| V-01 | Overview: upcoming, requests, rating, real interest metrics, profile checklist | ✅ | smoke |
| V-02 | Company profile, address/coverage, contacts, policies, section toggles | ✅ | journeys |
| V-03 | Logo/banner/gallery uploads (Cloudinary) | 🔌 | Server-validated (magic bytes, 5 MB); fake provider tested |
| V-04 | Services CRUD/archive, duration, booking mode, display-only price | ✅ | journeys, smoke |
| V-05 | Availability: weekly intervals, breaks, exceptions, buffer, notice, horizon | ✅ | booking, smoke |
| V-06 | Appointments list/detail + actions | ✅ | booking, smoke |
| V-07 | Messages | ✅ | journeys |
| V-08 | Review replies | ✅ | journeys |
| V-09 | Team roles (owner/manager/staff) enforced | ✅ | security: staff permissions |
| V-10 | Owner invites/removes staff in-app | ⛔ | Model and permissions exist; invite UI/API not built (admin support for now) |
| V-11 | Multi-business accounts | ✅ | `/vendor/companies` + `X-Company-Id` restricted to own memberships |
| V-12 | AI biography draft from vendor facts | ✅ | Editable suggestion only |
| V-13 | Calendar (grid) view | 🟡 | List with date filter; calendar grid not built |

## Super Admin (PDF §08)

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| A-01 | Dashboard from recorded events, date/company/category filters | ✅ | Range + filters in API; UI exposes date range |
| A-02 | Vendor applications: review, approve, reject, request info (with reason, applicant notified) | ✅ | journeys, smoke |
| A-03 | Create companies directly; secure setup links; resend invites | ✅ | No plaintext passwords ever |
| A-04 | Suspend/reactivate companies and accounts (audited, no deletion) | ✅ | security |
| A-05 | Revoke sessions | ✅ | |
| A-06 | Booking oversight + cancel with reason | ✅ | booking |
| A-07 | Inquiry oversight without excess personal data | ✅ | Metadata list; message content requires reason, audited |
| A-08 | Review moderation (hide/restore, reports) without editing text | ✅ | journeys |
| A-09 | Category configuration | ✅ | |
| A-10 | Audit log viewer | ✅ | |
| A-11 | MFA for Super Admin | ✅ | Email OTP second factor; required by every admin API |
| A-12 | Notification template / industry template configuration in UI | ⛔ | Templates live in code (`emailTemplates.js`) |

## AI (PDF §09)

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| AI-01 | Natural-language discovery grounded in real listings | 🔌 | Conversational assistant (`/ai/assistant`): model proposes filters only; server validates them against the search schema, runs the published-only search and writes the answer from real results with data-backed match reasons. Tested with a fake model (`assistant.test.js`); not verified with a live OpenAI key |
| AI-02 | Voice search where supported | 🔌 | Web: record → server transcription (`/ai/transcribe`, OpenAI) → editable transcript; browser speech recognition fallback; optional spoken replies via browser speech synthesis. Not verified with a live key. Mobile: not implemented |
| AI-06 | AI never books, cancels or reschedules | ✅ | No booking tool or action exists; booking requests return guidance and links. Test asserts no booking/slot claim is created |
| AI-03 | Message/review polishing, user approves | 🔌 | |
| AI-04 | Server-side keys, schema validation, limits, budget, fallback | ✅ | security: malformed output → 503, rate limits |
| AI-05 | Admin AI summaries (later/gated) | ⛔ | Out of MVP per PDF |

## Quality, security & operations (PDF §14, brief §8–19)

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| S-01 | Server-side RBAC + object-level checks on every route | ✅ | Scoped queries; 404 for foreign IDs |
| S-02 | Sessions: revocable, idle + absolute expiry, CSRF for cookies | ✅ | auth |
| S-03 | Input validation (strict schemas), NoSQL-operator rejection | ✅ | security |
| S-04 | Layered, shared-store rate limiting | ✅ | MongoDB fixed windows; fail-closed for cost-bearing routes |
| S-05 | Helmet headers, strict CORS allowlist, HSTS in prod | ✅ | security |
| S-06 | No secrets in client bundles | ✅ | CI grep; only public config in `VITE_*` / `EXPO_PUBLIC_*` |
| S-07 | Startup env validation; prod refuses dev modes | ✅ | `config/env.js` |
| S-08 | Structured logs with redaction, request IDs, health/readiness | ✅ | |
| S-09 | Error tracking / alerting | ⛔ | Hosting/monitoring not selected (PDF §18) |
| S-10 | Accessibility (labels, focus, keyboard, reduced motion, touch targets) | 🟡 | Built in; no formal audit (axe/screen-reader pass) yet |
| S-11 | Load/concurrency testing at scale | 🟡 | Concurrency correctness tested; no load test |
| S-12 | Backups/restore, deployment | ⛔ | See DEPLOYMENT.md; not performed |
| S-13 | Privacy notice, terms, review policy, legal review | ⛔ | Requires counsel |
| S-14 | Customer account deletion/export | 🟡 | Deletion ✅ on web + mobile (see DECISIONS.md); data export not built; retention periods need counsel |

## Public website redesign (10/29/2026)

Verified by: `npm test` (date guard, shared 7, web 11, API 107 incl. `discovery.test.js`), web lint and production build, the guarded browser journey (`e2e/web-smoke.mjs`, local database only), and `e2e/screens.mjs` across 9 public routes × 4 widths (no overflow, no console errors).

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| W-01 | Header: logo, Explore/Categories, location + search, only working actions | ✅ | Account menu for signed-in customers; compact search icon on small screens |
| W-02 | Split hero with approved copy, live search, location, real category tiles | ✅ | Licensed photo (docs/ASSETS.md); hidden on phones in favour of the search panel |
| W-03 | Search suggestions (categories + debounced live business search), keyboard support | ✅ | Combobox pattern |
| W-04 | In the spotlight from a legitimate source | ✅ | Minimal Super Admin–controlled flag + admin panel; tests in `discovery.test.js` |
| W-05 | New and noteworthy with a defensible “new” rule | ✅ | Server-computed 30-day badge |
| W-06 | Most booked, only if substantiated | ✅ | Real bookings, 90-day window, counts not exposed; omitted when empty |
| W-07 | Category collections from published categories | ✅ | Single aggregated endpoint; empty categories skipped |
| W-08 | Promotional banners | ⛔ | No approved promotions source; intentionally omitted |
| W-09 | Search page: chips (category, date, rating, distance, sort), mobile drawer, clear one/all | ✅ | Only API-supported filters; price/booking-mode filters not offered (no server support) |
| W-10 | Business cards with real data, neutral placeholders, no zero-star display | ✅ | |
| W-11 | Business profile redesign; optional sections omitted when empty | ✅ | No logo/banner overlap |
| W-12 | Service detail page with inline booking | ✅ | `/b/:slug/s/:serviceId`; phone sticky confirm bar |
| W-13 | Sign-in only when booking; context survives OTP; server revalidates | ✅ | Verified in the browser journey (selected time kept after sign-in) |
| W-14 | Distinct skeleton/empty/error states per section | ✅ | Sections fail independently; hero never depends on data |
| W-15 | Footer with real links; store badges only with real URLs | ✅ | Official badge artwork bundled, hidden until URLs are configured |
| W-16 | Professional icons, no emoji in public UI | ✅ | Lucide; shared EmptyState ignores legacy emoji strings |
| W-17 | MM/DD/YYYY everywhere | ✅ | Shared module + repository guard |
| W-18 | Privacy notice / Terms / About / Help pages | ⛔ | Need approved content (legal review); not linked until they exist |
| W-19 | Vendor portal / admin emoji glyphs in page copy (e.g. checklist ticks) | 🟡 | Out of this task's scope; shared components no longer render emoji |
| W-20 | Mobile app parity with the new public site | 🟡 | Mobile was redesigned separately; not re-verified in this pass |

## Homepage administration, real data and AI discovery (10/29/2026)

Verified by: `npm test` (date guard, shared 7, web 11, API 125 incl. `homepage.test.js` and `assistant.test.js`), web and API lint, the production build, `e2e/homepage-check.mjs` (guarded, dedicated local database) and `e2e/screens.mjs` across 9 public routes × 4 widths. No OpenAI key or Cloudinary upload was exercised live.

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| H-01 | Location picker never clipped | ✅ | Root cause: `Modal`/`Drawer` rendered in place; the sticky header's `backdrop-filter` (and the hero's animation transform) became the containing block for `position: fixed`, so the overlay was 64 px tall and the dialog sat at −216 px. Dialogs now portal to `<body>`, use `dvh` limits and a bottom sheet on phones. Browser-checked at 5 viewports, scrolled and at the top edge |
| H-02 | Location changes update every section immediately | ✅ | Shared location store (`useSyncExternalStore`, syncs across tabs). Previously each component kept its own copy |
| H-03 | Super Admin category management incl. images | ✅ | Create/edit name, description, parent (two levels, validated), icon, order, publish; upload/replace/remove image (audited). Public cards use the upload or a neutral icon tile |
| H-04 | Super Admin hero image | ✅ (🔌 Cloudinary live) | Draft → preview → publish/take down, alt text required, focal point; branded fallback. Uploads tested with the fake media provider only |
| H-05 | Super Admin spotlight with ordering and preview | ✅ | Admin → Homepage. Server validation and audit; suspended businesses refused |
| H-06 | Location-aware recommendations | ✅ | Most booked, New and noteworthy and category rows follow the selected place or coordinates (server-side filter) |
| H-07 | "Most booked" only when substantiated | ✅ | ≥3 confirmed/completed bookings in 90 days per business; section omitted otherwise |
| H-08 | Remove hardcoded cleaning section | ✅ | None existed in the current web code; all rows are generated from published categories. Unpublished categories are hidden from cards, rows and business-card labels |
| H-09 | Two-font typography | ✅ | Inter + Manrope (bundled, OFL) |
| H-10 | App store badges only with real listings | ✅ | Official badges render when `VITE_APP_STORE_URL` / `VITE_PLAY_STORE_URL` are set; hidden until then (no prelaunch claim) |
| H-11 | No emoji in product UI | ✅ | Vendor/admin glyphs replaced with Lucide icons |
| H-12 | Mobile app parity (category images, hero, assistant) | ⛔ | Not in this pass; the mobile app still uses its bundled hero photo |
| H-13 | Server-side text-to-speech | ⛔ | Not added; browser speech synthesis is used for spoken replies |

## UX refinement, support and account deletion (10/29/2026)

Verified by: `npm test` (date guard, shared 7, web 14 incl. form tests, API 133 incl. `support.test.js`, `accountDeletion.test.js`), lint, production build, `expo-doctor` (20/20) and `expo export --platform android`, `e2e/homepage-check.mjs`, `e2e/support-check.mjs` and `e2e/screens.mjs` (9 routes × 4 widths) on a guarded local database. Mobile screens were bundle-checked only, not run on a device or simulator.

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| U-01 | Remove hardcoded Cleaning homepage section | ✅ | No category-specific code exists (verified by search); rows are data-driven. New Super Admin control “Show a row on the homepage” removes a category's row without unpublishing it (browser-verified) |
| U-02 | Assistant section redesign + brand mark | ✅ | Original bubble-and-pin mark (`AssistantMark`) in launcher, panel and section; working composer, prompts and mic hand off to the real assistant; example result only from a real listing |
| U-03 | How TownAnt works redesign | ✅ | Connected steps with product-UI visuals; “Explore services” CTA |
| U-04 | Vendor section redesign | ✅ | Benefits limited to shipped features; honest portal preview without data |
| U-05 | Customer account deletion (web + mobile) | ✅ | Backend + both UIs; API- and browser-tested (web). Mobile bundle-checked only |
| U-06 | Support for customers, vendors and Super Admin | ✅ | Web customer + vendor + admin, mobile customer. No attachments |
| U-07 | Forms | 🟡 | Shared web field system refined (labels, required marker, hint + error with icon, invalid/hover/focus states) and applied everywhere through shared components; mobile `Field` likewise. Per-form audits beyond the shared components were not done for every vendor/admin form |
| U-08 | Mobile app promotion | 🟡 | Layout preview, not device screenshots (no simulator available here); store badges hidden until real URLs |
| U-09 | Footer | ✅ | Customers / businesses / support & privacy columns, app state, legal links only when configured |
| U-10 | No emoji in product UI | ✅ | Web and mobile (mobile now uses `@expo/vector-icons`) |
| U-11 | Mobile vendor support | ⛔ | The mobile app is customer-only |

## Homepage redesign and app promotion (10/29/2026)

Verified by: `npm test` (date guard, shared 7, web 14, API 133), `npm run lint`, `npm run build`, `e2e/homepage-check.mjs` (guarded `townant_e2e_home` database; updated for the new sections), `e2e/screens.mjs / /search /categories` at 1440/1024/768/390, section screenshots at the same widths, an image-failure fallback check and a keyboard-focus check. Mobile screenshots captured on an Android emulator.

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| R-01 | Remove the Cleaning section from the homepage | ✅ | It was the generic category row (data-driven); category rows are no longer rendered on the homepage. Cleaning category, services, businesses and `GET /catalog/collections` untouched |
| R-02 | Remove the TownAnt Assistant promotion from the homepage | ✅ | Section removed; launcher, panel, voice and `/assistant` API unchanged (e2e assistant checks pass) |
| R-03 | “How TownAnt Works” redesign | ✅ | Three numbered steps with line icons, hairline rules, hover/focus states, stacked on phones |
| R-04 | Mobile app section with genuine app UI | ✅ | Real emulator screenshots (no listings in frame) |
| R-05 | Official store badges on homepage and footer | 🟡 | Shared `StoreBadges`, URLs centralised in `lib/config.js`. No store URLs exist yet, so both places show “Coming soon to the App Store and Google Play” without badges; badges appear once `VITE_APP_STORE_URL` / `VITE_PLAY_STORE_URL` are set |
| R-06 | “For local businesses” photographic banner | ✅ | Licensed photo, left-aligned copy, single CTA to `/join`, mockup removed, navy fallback |
| R-07 | Admin “Show a row on the homepage” toggle | 🟡 | Kept, but has no visible web effect now that rows aren't rendered. Decide whether to remove it or restore rows |

