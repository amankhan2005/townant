# Development marketplace (rebuildable test data)

The development database `townant_dev_seed` holds a realistic test marketplace built **through the
application** — nothing is inserted into the database directly:

| Step | How | Tool |
| --- | --- | --- |
| Reset | App models, children before parents; Super Admins, site settings and the audit trail are kept; uploaded images of removed records are deleted | `npm run reset:dev -w @townant/api` (dry run) / `-- --apply` |
| Categories | Super Admin panel → Categories → Add category, then the card-image upload, driven in a real browser | `e2e/dev-admin-categories.mjs` |
| Vendors | Super Admin `POST /admin/companies` (invite) → owner accepts the invite → owner completes profile, location, hours, policies, services, logo, cover and gallery, then publishes | `apps/api/scripts/dev-marketplace/onboard.mjs` |
| Customers | Passwordless sign-up (email or WhatsApp code) and a second contact verified with its own code | `apps/api/scripts/dev-marketplace/customers.mjs` |
| Images | Generated flat illustrations (Material Community Icons, Apache 2.0; Manrope, OFL) — no photos of real businesses or people | `apps/api/scripts/dev-marketplace/make-images.py` |

All data is in `apps/api/scripts/dev-marketplace/data.json`. Every business description ends with
“TownAnt development test listing — not a real business”; emails use `.test` domains and phone numbers
are in the reserved fictional 555-01xx range. No ratings or reviews were created, and no business is
marked verified.

## Rebuild from scratch

Same safeguards as the dev seed ([DEV_SEED.md](DEV_SEED.md)): development only, Atlas database
`townant_dev_seed` with `CONFIRM_ATLAS_DEV_SEED`, connected database re-checked before writing.

1. Back up: `mongodump --config=<file with the uri> --db=townant_dev_seed --out=<dir>` (keep the URI out of the command line).
2. Reset: `npm run reset:dev -w @townant/api`, check the dry run, then `npm run reset:dev -w @townant/api -- --apply`.
3. Run the API locally with the development email/WhatsApp providers (`DEV_PRINT_OTP=true`) and log to a file; start the web app.
4. Images: `python3 apps/api/scripts/dev-marketplace/make-images.py apps/api/scripts/dev-marketplace/data.json <img dir>` (needs Pillow).
5. Categories: `cd e2e && ADMIN_EMAIL=… ADMIN_PASSWORD=… API_LOG=<api log> node dev-admin-categories.mjs ../apps/api/scripts/dev-marketplace/data.json <img dir>`
6. Vendors: `cd apps/api/scripts/dev-marketplace && ADMIN_EMAIL=… ADMIN_PASSWORD=… VENDOR_PASSWORD=… API_LOG=<api log> node onboard.mjs data.json <img dir>` — resumable; respects the API's rate limits (accepting invites is limited to 10 per 15 minutes, so 24 vendors take about 40 minutes).
7. Customers: `API_LOG=<api log> node customers.mjs data.json`.

Credentials come from `apps/api/.env.seed` (`DEV_SUPER_ADMIN_EMAIL`, `DEV_SUPER_ADMIN_PASSWORD`,
`DEV_VENDOR_PASSWORD`); they are never printed or committed.

## Categories (10, all published, each with an image)

Home Cleaning, Plumbing, Electrical Services, Beauty & Salon, Massage & Wellness, Photography, HVAC Services, Lawn & Garden, Handyman Services, Moving Services

## Vendors (24) — sign in at `/business/login` with `DEV_VENDOR_PASSWORD`

| Category | Business | City | Service mode | Services | Owner login |
| --- | --- | --- | --- | --- | --- |
| Home Cleaning | Austin Fresh Home Cleaning | Austin, TX | mobile | 4 | `austin-fresh-home-cleaning@vendors.townant.test` |
| Home Cleaning | Sparkle & Shine Cleaning | Dallas, TX | mobile | 3 | `sparkle-shine-cleaning@vendors.townant.test` |
| Home Cleaning | Premium Home Care | Austin, TX | both | 3 | `premium-home-care@vendors.townant.test` |
| Plumbing | Austin Pro Plumbing | Austin, TX | mobile | 4 | `austin-pro-plumbing@vendors.townant.test` |
| Plumbing | RapidFix Plumbing | Dallas, TX | mobile | 3 | `rapidfix-plumbing@vendors.townant.test` |
| Plumbing | BlueWave Plumbing Services | Chicago, IL | mobile | 3 | `bluewave-plumbing-services@vendors.townant.test` |
| Electrical Services | Austin Electrical Experts | Austin, TX | mobile | 4 | `austin-electrical-experts@vendors.townant.test` |
| Electrical Services | BrightWire Services | Dallas, TX | mobile | 3 | `brightwire-services@vendors.townant.test` |
| Beauty & Salon | Velvet Rose Salon | Austin, TX | fixed | 3 | `velvet-rose-salon@vendors.townant.test` |
| Beauty & Salon | Urban Edge Barbers | Chicago, IL | fixed | 2 | `urban-edge-barbers@vendors.townant.test` |
| Beauty & Salon | Glow Nail Studio | Dallas, TX | fixed | 2 | `glow-nail-studio@vendors.townant.test` |
| Massage & Wellness | Serenity Touch Massage | Austin, TX | fixed | 3 | `serenity-touch-massage@vendors.townant.test` |
| Massage & Wellness | Lakeshore Wellness Studio | Chicago, IL | fixed | 2 | `lakeshore-wellness-studio@vendors.townant.test` |
| Photography | Golden Hour Photography | Austin, TX | both | 3 | `golden-hour-photography@vendors.townant.test` |
| Photography | Windy City Portraits | Chicago, IL | both | 2 | `windy-city-portraits@vendors.townant.test` |
| HVAC Services | CoolBreeze HVAC | Austin, TX | mobile | 4 | `coolbreeze-hvac@vendors.townant.test` |
| HVAC Services | Lone Star Heating & Air | Dallas, TX | mobile | 3 | `lone-star-heating-air@vendors.townant.test` |
| Lawn & Garden | GreenThumb Lawn Care | Austin, TX | mobile | 3 | `greenthumb-lawn-care@vendors.townant.test` |
| Lawn & Garden | Prairie Garden Co. | Dallas, TX | mobile | 2 | `prairie-garden-co@vendors.townant.test` |
| Handyman Services | FixIt Right Handyman | Austin, TX | mobile | 4 | `fixit-right-handyman@vendors.townant.test` |
| Handyman Services | Mr. Dependable Home Repairs | Chicago, IL | mobile | 3 | `mr-dependable-home-repairs@vendors.townant.test` |
| Handyman Services | HandyPro Dallas | Dallas, TX | mobile | 3 | `handypro-dallas@vendors.townant.test` |
| Moving Services | SwiftMove Austin | Austin, TX | mobile | 3 | `swiftmove-austin@vendors.townant.test` |
| Moving Services | Lakefront Movers | Chicago, IL | mobile | 3 | `lakefront-movers@vendors.townant.test` |

Each vendor has a logo, cover, three gallery images, description, contact email and phone, address
with coordinates, service area (travelling businesses), weekly hours (America/Chicago), a cancellation
policy and cutoffs, and published prices or quote-only services.

## Customers (5) — sign in with a one-time code

| Name | Email | WhatsApp | Signed up with |
| --- | --- | --- | --- |
| Jordan Lee | `jordan.lee@customers.townant.test` | `+15125550191` | email |
| Priya Nair | `priya.nair@customers.townant.test` | `+12145550192` | email |
| Sam Carter | `sam.carter@customers.townant.test` | `+13125550193` | email |
| Elena Torres | `elena.torres@customers.townant.test` | `+15125550194` | email |
| Chris Morgan | `chris.morgan@customers.townant.test` | `+15125550190` | whatsapp |

Codes are delivered by the development providers: with `DEV_PRINT_OTP=true` the API logs
`[dev-email] …` / `[dev-whatsapp] code for … : <code>` lines. Real delivery needs the Resend and
WhatsApp settings in `apps/api/.env`.
