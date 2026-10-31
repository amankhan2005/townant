# Decisions and assumptions

The PDF (§18) leaves several product decisions open. Rather than block, these defaults were implemented. Each is
configurable or easy to change. **Product owner: please confirm or override.**

| Topic | Assumption implemented | Where to change |
| --- | --- | --- |
| Booking mode | Per service: `instant` (confirmed at once) or `request` (vendor confirms). Requests hold the slot and expire after `requestExpiryHours` (default 24, never past start) | Vendor service settings / `bookingPolicy` |
| Cancellation & reschedule | Per company cutoffs, default 24 h. Customers may cancel a pending request any time before start. Vendors cancel with a mandatory reason. Admins cancel with a reason. No fees (no payments) | `bookingPolicy` |
| Customer reschedule of a request-mode service | Returns to `requested` for vendor approval | `services/booking.js` |
| "Reschedule Requested" negotiation state | Not implemented; reschedule is direct and atomic | — |
| Reminders | One reminder ≈24 h before (in-app, email, push per preferences) | `jobs/index.js`, `sendReminders` |
| Chat closure | Either side may close. A customer reply reopens; vendors can't post into a closed thread. No auto-close | `services/conversations.js` |
| Reviews | Only for `completed` bookings, one per booking; first name shown; vendors reply but cannot edit or hide; admins hide/restore with reason | `services/reviews.js` |
| Vendor/staff model | Companies have multiple members (owner/manager/staff). One schedulable resource per company in MVP; claims keyed by `resourceKey` to allow staff calendars later | `Membership`, `availability.js` |
| Publishing | Vendor self-publishes once main category, city, ≥1 active service and hours exist. No second admin review (PDF says "subject to any required review") | `vendor/company.js#publish` |
| Changing hours | Does not cancel existing bookings | — |
| Request-more-info on applications | Applicant is emailed the admin's note and replies by email or resubmits | Tokenized resubmission is a future option |
| Analytics events | `profile_view` (once per visitor per 30 min, no user ID stored), `favorite_added`, `inquiry_started`, `booking_created`, `booking_confirmed` | `AnalyticsEvent` |
| Map provider | Not chosen. Geo search works on vendor-entered coordinates; no map UI | PDF §18 |
| AI model | `OPENAI_MODEL` env (default `gpt-4.1-mini`); 6/min and 60/day per caller; daily global cap | env |
| Hosting | Not chosen; see DEPLOYMENT.md | PDF §18 |
| Auth token design | Opaque server sessions instead of JWT + refresh tokens: simpler, instantly revocable | `services/session.js` |
| Mobile scope | Discovery, profile, booking, bookings list/detail/cancel, favorites, notifications, push, preferences. Reschedule, messaging, reviews and identifier linking are web-only for now | `apps/mobile` |
| Web app layout | One Vite app with three lazily loaded shells (`/`, `/business`, `/admin`) | `apps/web/src/App.jsx` |

## Public website discovery sections (10/29/2026)

| Section | Source and rule |
| --- | --- |
| In the spotlight | `Company.spotlight`, set only by a Super Admin (`PUT /admin/companies/:id/spotlight`, audited) from Admin → Homepage (search, add, remove, reorder via `PUT /admin/spotlight/order`, live preview) or the company page. Shown in the admin's order. Optional headline (≤80) and blurb (≤160) are staff-written. Suspended businesses can't be placed; drafts keep their placement but only published businesses appear. The section is omitted when none are visible. No scheduling (not needed yet). |
| New and noteworthy | Published businesses ordered by `publishedAt` (newest first). The “New” badge is computed by the API: published within the last 30 days. |
| Most booked (near you) | `GET /catalog/most-booked`: published businesses ranked by confirmed or completed bookings created in the last 90 days. A business needs **at least 3** such bookings to qualify, so one or two bookings never earn the label. With a selected location the ranking is restricted to that area (same rules as search: country/region/city match, postal code also matches mobile vendors' service-area codes, coordinates match within the radius). Counts are not returned publicly. The section is omitted when empty. |
| Category rows | `GET /catalog/collections`: active top-level categories (Super Admin–managed) that have at least one published business (in the selected area, when one is chosen), with their highest-rated businesses. **Not rendered on the web homepage since 10/29/2026** (see “Homepage category rows”); the endpoint is kept. |
| Hero categories | **Superseded later on 10/29/2026:** the hero now carries the main search, and categories sit in their own band directly beneath it (“What do you need today?”, up to eight published top-level categories in the Super Admin's order, then “All categories”). Previously: category browsing lived **inside the hero** (the standalone “Browse by category” section was removed). A 3 × 2 grid under the heading: the first five published top-level categories in the Super Admin's order (`sortOrder`), then a text-only “Explore Categories” link to `/categories` in row 2, column 3. Fewer published categories means fewer tiles, never filler. Each tile links to `/search?category=<slug>` and shows the image a Super Admin uploaded (`POST /admin/categories/:id/image`); without an upload, the category's line icon on a quiet tile — never a stock photo. Three columns at every width (labels wrap to two lines on phones). The hero search form was removed; search lives in the header (≥1024 px), the header search icon, and `/search`.
| Hero image | White (`#FFFFFF`) two-column hero: heading, italic supporting line and categories on the left; one photo on the right (stacked below the content under 1024 px), never with text over it. The photo is `SiteSettings.hero` when a Super Admin has published one (upload a draft with description and focal point, preview, publish; drafts are never public), otherwise the bundled licensed photo `apps/web/public/images/hero/sofa-phone-*.jpg` (docs/ASSETS.md). If both fail to load, the column is omitted. `GET /catalog/site`, cached 60 s.
| Discovery assistant | Chat + voice on discovery pages. The model only proposes filters; results and the visible summary come from the search service. It never books — it links to service pages where the customer confirms. Spoken replies use browser speech synthesis; transcription uses `OPENAI_TRANSCRIBE_MODEL` (default `gpt-4o-mini-transcribe`), falling back to the browser's speech recognition where recording isn't supported. |
| Typography | Inter (UI/body) + Manrope (h1/h2 and `.font-heading`), both bundled variable fonts with metric-matched fallbacks. |
| Homepage category rows | Removed from the web homepage (10/29/2026). The repeatedly reported “Cleaning section” was the generic data-driven row: a published Cleaning category plus published businesses (in local dev, the “Sunrise Cleaning …” businesses that `e2e/web-smoke.mjs` creates). Hiding one category would have meant category-specific code, so the homepage no longer renders category rows at all; customers browse categories from the Super Admin–managed category cards. No category, service, business or API was removed. The **Show a row on the homepage** toggle (`Category.showOnHomepage`) is kept but currently has no visible effect on the web. |
| Mobile app promotion | The phones show unedited screenshots of the Expo app (Home and Categories tabs) captured on an Android emulator (Pixel 8a, Expo Go, demo-mode status bar) against a throwaway database holding only the starter category taxonomy, so no business, rating or booking is shown. Store URLs are centralised in `apps/web/src/lib/config.js`; `StoreBadges` (homepage and footer) renders the official badge only for a configured https listing and otherwise says “Coming soon to …” without a badge, because Apple and Google only allow their badges to link to a published app. Privacy/Terms are linked only when `VITE_PRIVACY_URL` / `VITE_TERMS_URL` are set. |
| For local businesses | Full-width photograph (self-hosted Unsplash photo, see `docs/ASSETS.md`) with a left-aligned headline and a single “Become a vendor” CTA to `/join` (the existing vendor application). No portal mockup, benefits grid or statistics. If the photo fails to load the section falls back to a solid navy panel. The admin-managed image mechanism covers only the hero, so no new image management was added. |

## Public header and visual system (10/29/2026)

| Topic | Decision |
| --- | --- |
| Header | Logo, then text links (Explore, Categories) with an underline for the active route. From 1024 px the search bar with its location control sits in the middle; below 1024 px the location control stands alone in the header (the hero no longer has a search form, so this keeps location reachable on every width). “For businesses” (→ `/join`) from 1280 px. Square-cornered (10 px) controls instead of pills. |
| Phones | No header Sign in button; the last bottom tab reads “Sign in” for signed-out visitors and “Account” once signed in. |
| Pickers and menus | The location picker is a portal `Modal`, so the sticky header can't clip it; the account menu and suggestions list are anchored inside the header with `z-50`. Checked by `e2e/homepage-check.mjs`. |
| Gutters | One shared `gutter` utility (16 / 24 / 32 px at <640 / ≥640 / ≥1024 px) on the header, footer and every public page container. |
| Subtitles | The supporting line that introduces a page, section or settings card uses the `subtitle` utility: true Inter italic (bundled `wght-italic`), muted. Applied through `PageHeader`, `SectionHeader` and `SectionCard` descriptions, the hero supporting line, homepage section intros, and the few hand-built card headers in the customer account, vendor portal and Super Admin console. Not italic: primary headings, body copy, labels, buttons, navigation, table data, alerts and errors, metadata lines (dates, counts, addresses), form instructions and dialog descriptions. |

## Customer account deletion (10/29/2026, 15-day recovery added the same day)

Self-service on web (Account → Delete account) and mobile (Profile → Delete account). Steps: review → fresh one-time code to an identifier already on the account (never one supplied by the client) → type DELETE → `POST /me/deletion`. Implemented in `services/accountDeletion.js`.

**Two stages.** The request marks the account `pending_deletion` with `deletionScheduledFor` = now + 15 days: every session, push token and queued delivery is dropped, the customer's reviews are hidden publicly (`Review.authorPendingDeletion`, ratings recalculated) and upcoming appointments are cancelled straight away (a restore does not rebook them). Nothing else is removed. The `finalize-account-deletions` job (every 15 minutes, `jobs/index.js`) then applies the table below to accounts whose window has ended; the final write is conditional, so a second worker or retry is a no-op.

**Restoring.** Only by signing in with a one-time code: a correct code for a pending account returns `409 ACCOUNT_PENDING_DELETION` with a 15-minute single-use restore token (no session is created); the customer must then confirm (`POST /auth/account/restore`, `confirm: "RESTORE"`). Wrong/expired codes never get that far; password sign-in answers `RESTORE_REQUIRES_CODE`; the password-reset flow never sends codes to pending accounts. A code sign-in after the deadline (before the job ran) finalizes the old account and starts a new, empty one (`previousAccountDeleted: true`).

Finalization rules:

| Data | Rule |
| --- | --- |
| Name, email, phone, saved location, notification preferences | Removed; the user record becomes a tombstone (`status: deleted`, no personal fields). The email/phone can sign up again as a new account. |
| Sessions, push tokens, OTP challenges | Deleted (every device signed out). |
| Favorites, in-app notifications, pending email/push deliveries | Deleted. |
| Reviews written, review reports filed | Deleted; affected business ratings recalculated. |
| Upcoming requested/confirmed appointments | Cancelled through the booking state machine (`cancel_account_deleted`, slot released, business notified). In-progress/past ones are left for the business to complete. |
| Past appointments | Kept for the business's service records; vendors and admins see “Deleted customer” with no contact details. |
| Conversations with businesses | Kept (business records), closed, shown as “Deleted customer”. |
| Support tickets | Open ones closed with a system note; all kept, marked `requesterDeletedAt`. |
| Audit | One `user.self_delete` event with counts only. |
| Uploaded media | Customers have none, so nothing to remove. |

**Product owner / counsel to confirm:** retention periods for kept records (none are purged automatically yet) and whether review text should be kept anonymously instead of deleted.

## Support requests (10/29/2026)

`SupportTicket` + `SupportMessage`, separate from customer↔business `Conversation`s. Customers: `/support` (web), Help & support (mobile). Vendors: `/business/support` (works while suspended; owners/managers see all of the business's tickets, staff only their own). Super Admins: Admin → Support (filters, internal notes, status, priority, assignment, timeline). Statuses: open → in progress → waiting on requester → resolved → closed. A requester reply reopens a resolved ticket; closed is final for the requester. Requesters are notified (in-app, plus email/push by preference) on creation, replies and status changes; internal notes never notify. No attachments (not implemented, so not offered). Rate limits: 5 new tickets and 40 replies per user per hour.
| Promotional banners | Superseded 10/29/2026: one Super Admin-published banner below “New and noteworthy” (see “Homepage promotional banner”). |
| App badges / social links / legal links | Shown only when real destinations exist (`VITE_APP_STORE_URL`, `VITE_PLAY_STORE_URL`, `VITE_SOCIAL_*`). No Privacy/Terms pages exist yet, so they are not linked. |
| Booking entry | Each service has its own page (`/b/:slug/s/:serviceId`). Browsing never requires sign-in; a visitor is asked to verify (email or WhatsApp OTP) only when confirming. The chosen time and note are kept for the tab across sign-in, and the server re-validates the slot on submit. |

## Super Admin console redesign (10/29/2026, navigation theme revised the same day)

Dark slate navigation around a light content area: sidebar `#303A46`, top header `#3B4550`, content canvas `#F5F7FA` with white cards (tokens `--color-admin-*` in `index.css`). Navigation text `#F5F7FA` (10.8:1 / 9.1:1), muted `#B4BEC9` (6.1:1 / 5.2:1), active item a teal-tinted surface (text 8.8:1) with a light-teal indicator; the logo's “Ant” switches to light teal on slate (5.6:1). The active item is computed from the normalised path, so exactly one item is active on every route (including detail pages and `/admin/`). Cards and panels share one radius (12 px), border and shadow; no gradients. Every route uses the same content width so headers align. One kit (`apps/web/src/pages/admin/kit.jsx`) supplies the page frame, panels, list states, KPI cards (headline cards with a fixed-height trend slot, queue cards), charts and the export button.

| Chart | Data (all from `GET /admin/dashboard`, UTC) |
| --- | --- |
| Feature KPI tiles + sparklines | Bookings created, new customers and new businesses per day (from `createdAt`), live businesses, applications to review |
| Line (trend) | Recorded analytics events per day (profile views, favorites, inquiries, bookings created/confirmed) |
| Columns | One growth measure per day, chosen with tabs (customers, businesses, bookings) — never two scales on one axis |
| Donuts | Businesses by status (incl. deleted); applications by status |
| Horizontal bars | Bookings created in the period by status; live businesses by top-level category (top 7 + “Other”) |

Chart palette (validated for colour-vision-deficiency separation; amber is below 3:1 so values are always printed in legends): teal `#0d9488`, blue `#2a78d6`, orange `#eb6834`, violet `#6250d6`, amber `#d18f00`, magenta `#d55181`. Animations are short and disabled under `prefers-reduced-motion`.

## Company deletion (10/29/2026)

Super Admins delete a company from its page (reason required). It becomes `status: deleted` with `deletion.{deletedAt, deletedBy, reason, statusBefore, restoreUntil}`; every public query already requires `published`, and the vendor portal answers `403 COMPANY_DELETED`. Nothing else changes, so a restore (Companies → Recently deleted, within 15 days) brings back the previous status, services, team, bookings, reviews and spotlight placement exactly. Existing bookings are left for the admin, as with suspension. After 15 days the `finalize-deleted-companies` job (or an admin, once expired) cancels upcoming bookings (customers notified), archives services, revokes memberships, closes open conversations and removes the spotlight placement and images. The company record stays as a tombstone so past bookings, reviews and the audit trail resolve; no user account, booking, review or message is deleted.

## Category deletion (10/29/2026)

`DELETE /admin/categories/:id`. Refused while sub-categories exist. Refused while businesses (any status, including deleted), services or open applications use it, unless `reassignTo` names another published category — then all references move in one transaction and search text is rebuilt. Unpublishing (`isActive: false`) remains the non-destructive alternative and is offered in the dialog. Slugs are now editable (unique), with a warning that old links stop matching.

## Passwords (10/29/2026)

| Account | Change | Recover | First login |
| --- | --- | --- | --- |
| Super Admin | Admin → Profile & security (current + new + confirm; other sessions end) | Emailed single-use link (1 h) to `/admin/reset-password`, generic response; email OTP second factor still required | Setup link, unchanged |
| Vendor staff | Settings → Change password | Emailed single-use link to `/business/reset-password` | Setup link (they choose the password). A Super Admin can also issue a **temporary password** (Accounts → Temporary password): shown once, never stored or logged in plaintext, expires in 72 h, ends all sessions, and `passwordChangeRequired` blocks every API except the change itself until it is replaced |
| Customer | Optional. Account → Password: adding a first one needs a fresh code to a verified identifier; changing/removing needs the current one | `POST /auth/password/forgot` sends a 6-digit code only to an active customer with a password (same response otherwise) → `/auth/password/reset` | OTP sign-in unchanged; password sign-in is an alternative on the sign-in page |

Existing accounts are not forced through any reset; only Super Admin-issued temporary passwords set `passwordChangeRequired`.

## Image uploads and the hero HTTP 500 / 502 (10/29/2026, root cause corrected the same day)

**Root cause.** Uploads from the API to Cloudinary failed at the network layer, not in the route, parser, validation or database. This development machine reaches the internet through an iPhone Personal Hotspot (gateway 172.20.10.1) on a carrier network with NAT64 (IPv6 `2409:40e3:…`, Cloudinary resolves to `64:ff9b::…`). Measured with the configured account: over **IPv4** about half of all large uploads were reset mid-body (`ECONNRESET`/`EPIPE`) — curl showed the same resets to an unrelated host (postman-echo.com), so it is the IPv4 path, not Cloudinary; over **IPv6** 12 of 12 succeeded. macOS lists IPv4 addresses first, so Node usually connected over IPv4, while curl and browsers prefer IPv6 — which is why curl kept working. The first fix (an `Expect: 100-continue` handshake plus four retries) only reduced the failure rate; the remaining failures surfaced as `502 UPLOAD_FAILED` (request `071c55c5…`). Originally every provider error became an unexplained 500.

**Fix.** `providers/media.js` prefers IPv6 and falls back to IPv4 if IPv6 doesn't connect within 2 s (RFC 8305, like browsers; IPv4-only servers are unaffected). A connection that dies mid-upload gets exactly **one** retry on the other address family, with the same public ID and `overwrite=false`, so a retry cannot create a second asset; HTTP errors are never retried. Failures return `502 UPLOAD_FAILED` / `422 IMAGE_REJECTED` with the request ID and are logged with the address families tried. After the change: 12 of 12 real uploads succeeded on the first attempt.

**Persistence and caching.** The live image is replaced only after the new one is stored and saved; if saving fails the orphaned upload is deleted. `GET /catalog/site` and `/catalog/categories` are now `Cache-Control: public, no-cache` (revalidated via ETag) instead of `max-age=60`: with the old header, browsers kept showing a response that pointed at the just-deleted previous image for up to a minute (seen during verification as a 404 and the fallback photo).

**Validation.** Every admin image upload is checked on the server from its bytes: magic-byte type (JPEG/PNG/WebP), real pixel dimensions parsed from the file (PNG IHDR, JPEG SOF incl. EXIF rotation, WebP VP8/VP8L/VP8X), at most 12,000 px per side, 5 MB. Files whose dimensions can't be read are refused as malformed.

**Speed.** The admin console downsizes large images in the browser before upload; uploads show progress and can be cancelled.

The hero keeps its draft → publish flow plus **Upload & publish** (image description still required for accessibility).

## Homepage promotional banner (10/29/2026)

`SiteSettings.promoBanner`, rendered directly below “New and noteworthy”. Published directly (`POST /admin/site/banner`, multipart) — no draft. Only the image is required; title, text, link (same-site path or https only) and button text are optional and empty ones leave no space. `PATCH` edits text/link, `DELETE` removes it (confirmed in the UI). The previous banner stays live until a replacement is stored and saved; banner changes never touch the hero.

**Fixed 3:1 shape.** Recommended 1200 × 400 px; any exact 3:1 source is accepted (1800 × 600, 2400 × 800 …) with 1% tolerance for a pixel of rounding; minimum 600 × 200; JPEG/PNG/WebP up to 5 MB. The admin screen lists these before an image is chosen, reads the real decoded size in the browser and refuses other shapes before any request, offering an explicit pan-and-zoom crop to 3:1 (never stretched). The API independently parses the uploaded bytes and answers `422 BANNER_RATIO_INVALID` / `BANNER_TOO_SMALL` (client-supplied sizes, names and MIME types are ignored); rejected files never reach Cloudinary. The homepage always renders the banner in a reserved 3:1 frame (`object-cover`), so an older off-ratio banner is cropped, not distorted. Supersedes the earlier “Promotional banners: not shown” row.

## Excel exports (10/29/2026)

Server-built `.xlsx` (`write-excel-file`) from the same filters as the list, every matching row up to 10,000 (the response says when it was capped), dates as MM/DD/YYYY (UTC), bold frozen header row, set column widths, formula-like text neutralised, file names like `townant-companies-10-29-2026.xlsx`. Endpoints: `/admin/companies/export` (status, search, Recently deleted view), `/admin/applications/export` (status, search), `/admin/categories/export`, `/admin/dashboard/export` (Summary, Daily activity, Bookings by status, Businesses by category, Applications by status). Super Admin only, 60 exports/hour per admin.

## Public homepage and navbar (10/29/2026)

Hero: eyebrow, heading, supporting line, the main search (service + location) and three product facts (book real openings, message before booking, no payment through TownAnt) beside the CMS hero image. Category band beneath the hero (real categories only, image or line icon, consistent 4:3 tiles). Business cards are bordered surfaces with 4:3 images; ratings show only real counts. Navbar: solid white, sticky, shadow once scrolled; Explore, Categories, For businesses (from 1024 px); header search on every page except `/search` and — until the hero search scrolls away — the homepage; Saved, notifications (customers), account menu or Sign in. Phones: logo, search and a menu drawer (location, browse links, account links or Sign in; closes on Escape, backdrop and navigation; focus trapped). The bottom tab bar is unchanged.

## Public website: frontend-managed hero (10/29/2026; purple theme reverted the same day)

**Colours.** A purple-and-white public theme was tried and then reverted at the product owner's request. The public website uses the original palette from the `@theme` tokens in `apps/web/src/index.css` (mirrored in `packages/shared/src/tokens.js`): navy `#14243A` (navy-800 `#1B2F4A`), teal `#147D73` (700 `#0F655D`, 300 `#6CC3B8`, 100 `#CFE7E3`, 50 `#E7F3F1`), amber `#F5A623` (50 `#FEF5E4`, text `#7A4F00`), cloud `#F5F7FA`, slate `#263445`, muted `#5B6878`, subtle `#8A95A3`, line `#E3E8EF`, line-strong `#CDD5DF`. No public-only colour layer exists.

**Typography.** Manrope (headings) and Inter (everything else), both bundled.

**Hero ownership.** The hero copy is part of the frontend (`Home.jsx`). The hero **image** is managed on the homepage itself: a signed-in Super Admin (verified two-step sign-in) sees “Edit hero image” on the photo (`/?edit=hero` opens it directly). The lazily loaded editor (`pages/public/HeroEditor.jsx`; visitors never download it) previews, validates, resizes, shows upload progress and publishes through the existing `POST /admin/site/hero/draft` with `publish=true` into `SiteSettings.hero` — the record the homepage reads. Success is shown only after the API saves; the old image stays live until then. The admin console's Homepage screen no longer has its own hero uploader: it shows the live image, can take it down or finish an older draft, and links to the homepage editor. The promotional banner is unchanged: Super Admin console only, its own endpoint and `SiteSettings.promoBanner`; the hero never falls back to it.

**Homepage order.** Hero (headline, search with location, product facts, CMS photo) → “Explore services by category” (published top-level categories, Super Admin order) → New and noteworthy → promotional banner → In the spotlight → Most booked → How TownAnt works → app → for businesses → footer.

**SEO.** `usePageMeta` sets the meta description, canonical URL (only page-defining query keys such as `?category=` are kept) and Open Graph tags on the homepage, categories, search, business and service pages; `theme-color` is navy `#14243A`.

## Mobile app redesign and Android build (10/30/2026)

**Scope.** The existing Expo app (`apps/mobile`, SDK 58 / React Native 0.88, expo-router) was redesigned in place — no second app, same API, same auth. Fonts: Manrope (headings) and Inter (text), embedded through the `expo-font` config plugin as weight-mapped Android families, so `fontWeight` works and nothing falls back to Roboto. Screens import `Text` from `src/ui.jsx` (brand font; nested text inherits). Colours: the shared brand tokens plus ten category accents in `src/theme.js`, each ≥ 4.5:1 on its tint and on white. The launcher icon and splash are rendered from the web favicon mark.

**Navigation.** Tabs: Home, Explore, Bookings, Saved, Account. Home and Explore are public; the other three explain what an account adds and offer sign-in. Public screens: Home, Explore (search + category directory), category pages (`/category/:slug`), business profiles (`/b/:slug`), service pages (`/b/:slug/:serviceId`), availability (`/book/:slug`), Help & FAQ (`/help`), Terms and Privacy (`/legal/:doc`). Account-only: confirming a booking, saving a business, bookings, notifications, support requests, profile.

**Sign-in at the moment it is needed.** Sign-in opens with a reason (`/login?reason=book|save|bookings|support`) and returns to the screen that asked: the chosen time and note survive it, and a business saved while signed out is saved right after sign-in (`FavoritesProvider`). The API still enforces every rule; nothing was relaxed server-side. An offline launch keeps the stored session and retries (`AuthProvider`) instead of showing the customer as signed out.

**Real data only.** Rows with nothing to show (New and noteworthy, Most booked, promotional banner) are hidden, not padded. Businesses without photos show their category colour and glyph, never a stock photo. Ratings come only from the API, profile sections a vendor has switched off stay hidden, and the hero image is the one published from the website (`/catalog/site`), separate from the Super Admin promotional banner.

**Legal pages.** No approved Terms of use or Privacy notice exists (tracker S-13 / W-18). `/legal/terms` and `/legal/privacy` are public and show the document outline marked “Awaiting legal review — not yet in effect”; no legal text was written. Setting `EXPO_PUBLIC_TERMS_URL` / `EXPO_PUBLIC_PRIVACY_URL` (https, the same documents as `VITE_TERMS_URL` / `VITE_PRIVACY_URL`) links the screens to the approved documents; approved text can also be placed in `src/legal.js`. The FAQ in `/help` only describes behaviour the API enforces today.

**Android.** `expo prebuild` generates `apps/mobile/android/` (gitignored); `npm run android:emulator` builds, installs and launches the debug app with the API at `http://10.0.2.2:4000`. Cleartext HTTP is allowed in the debug build only. Blocked permissions: fine/background location, storage, overlay, biometric/fingerprint (the app stores its session token with SecureStore but never asks for biometric-protected items).

## Mobile app: location-based marketplace (10/30/2026, supersedes parts of the entry above)

**Home** shows only: logo, sign-in or profile access, the selected location (prominent, tap to change), a brand-teal hero with a background-removed photo (`assets/hero-customer.webp`, see `docs/ASSETS.md`) and a search entry, popular categories (published parents, max 8, “View all”), then location rows that appear only with real results — Popular (most booked, existing ≥ 3 bookings rule), Top-rated (`minRating=1`, so only rated businesses), Recently added (only businesses still marked *new*, and only when they are not the whole list) — and “Explore local professionals”. Help, legal and account items moved to Profile. The app hero no longer uses the web's CMS hero photo (a rectangular image); the Super Admin promotional banner is not shown in the app.

**Location.** Saved on the device (SecureStore) and sent as the catalog API's existing filters: device coordinates (25 km), a city (+ region) from the list of cities that have published businesses, or a typed city / ZIP. Search now also returns businesses that travel to customers (`serviceMode` mobile/both) when their own `serviceArea.radiusKm` reaches the customer — `services/catalog.js`, covered by `test/discovery.test.js`. City searches still match the business address; a ZIP also matches service-area ZIP codes.

**Starting prices.** Catalog cards carry `priceFrom` (`{ amount, currency }` or null): the lowest price among active services whose price is published as fixed or “from”; hidden and quote-only prices never contribute.

**Guest favorites.** Anyone can save. Saves made on the device are stored locally (`{ id, slug }` only) and survive restarts and sign-out; on sign-in they are merged into the account with the existing idempotent `PUT /favorites/:id`. The device list never receives favorites saved on other devices.

**Guest booking.** Choose → review → confirm without an account. Confirming while signed out stores the booking (service, time, note, idempotency key) on the device and opens sign-in; on return it is sent automatically with the same key, so the API creates at most one booking. Backing out of sign-in sends nothing; the pending booking is offered again on Home (“Finish your booking”) for up to 2 hours and is cleared on sign-out. Back from the review step returns to choosing (`usePreventRemove`).

**Profile** groups: signed out — sign-in with benefits, Help & information (Help & Support, FAQs, Contact us, Terms & Conditions, Privacy Policy, About TownAnt), App (location). Signed in — Your activity (My bookings, Booking history, Notifications, Saved), Account (Edit profile, Account settings), Help & information, App, and Log out with confirmation.

