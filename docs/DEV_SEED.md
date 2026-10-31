# Development seed: Super Admin and demo vendors

`npm run seed:dev -w @townant/api` fills a **development database** (local, or the dedicated Atlas database
`townant_dev_seed`) with:

- one Super Admin account,
- ten demo vendor accounts, each owning one demo business with services and opening hours,
- two pending vendor applications for testing the Super Admin review queue.

Everything goes through the existing models: staff accounts use the normal `scrypt` password hashing and staff password
policy, vendors are linked to their business by an `owner` membership, and businesses reference categories that already
exist. The seed never creates categories, reviews, ratings, bookings or images.

## Safeguards

The script (`apps/api/scripts/seed-dev.js`, rules in `scripts/lib/devSeed.js`) checks the target **before connecting**.
Two targets are allowed. Everything else is refused.

| Target | Allowed only when |
| --- | --- |
| Local MongoDB | `NODE_ENV` is not `production`, `ALLOW_DEV_SEED=true`, `MONGODB_URI` is `mongodb://` with every host `localhost` / `127.0.0.1` / `::1`, and the database name does not contain `prod` or `live` |
| MongoDB Atlas | `NODE_ENV` is not `production`, `ALLOW_DEV_SEED=true`, every host ends in `.mongodb.net`, the database in the URI is **exactly** `townant_dev_seed`, and `CONFIRM_ATLAS_DEV_SEED=townant_dev_seed` |

On Atlas, a URI with no database name, any other name (`townant`, `test`, `townant_prod`, `townant_dev_seed2`, a
different letter case), or a missing or wrong confirmation is refused. So are non-Atlas remote hosts, look-alike
hosts such as `cluster0.mongodb.net.example.com`, and replica sets that mix allowed and other hosts.

After connecting, and **before the first write**, the script opens the connection with automatic index and
collection creation turned off. It then checks that the driver really opened the approved database on the approved
kind of host. Only then does it build missing indexes (never dropping any) and write.

Nothing secret is printed. Messages never contain the connection string, credentials or Atlas host names; on Atlas
the target is shown only as `MongoDB Atlas` plus the database name. Connection failures print only the driver's error
code. Passwords are never printed or logged. Seed settings live only in git-ignored files (`apps/api/.env.seed` or
`apps/api/.env`); none are committed, bundled into the web app or returned by the API.

## 1. Set the credentials

Put the seed settings in `apps/api/.env.seed` (git-ignored, and loaded only by `npm run seed:dev`, after `.env`). A
value there overrides the same variable in `.env` **for the seed command only**; the API never reads `.env.seed`.
Restrict the file to your user: `chmod 600 apps/api/.env.seed`.

```bash
ALLOW_DEV_SEED=true
DEV_SUPER_ADMIN_EMAIL=admin@townant.test      # default if unset
DEV_SUPER_ADMIN_PASSWORD=<12+ characters>     # staff password policy applies
DEV_VENDOR_PASSWORD=<12+ characters>          # shared by all ten demo vendors
```

`.test` is a reserved domain, so nothing can be delivered to these addresses by accident.

## 2a. Seed a local database

```bash
npm run db:dev -w @townant/api              # local replica set on 127.0.0.1:27018
MONGODB_URI='mongodb://127.0.0.1:27018/townant?replicaSet=rs0' npm run seed:dev -w @townant/api -- --with-categories
```

(Or put that `MONGODB_URI` in `.env.seed`.) The API you sign in through must use the same database.

## 2b. Seed the dedicated Atlas development database

1. **In Atlas**, use a development cluster or project. Ideally create a database user whose only role is
   `readWrite` on `townant_dev_seed`, so even a wrong URI can't touch another database. Make sure your IP is on the
   project's network access list. The database is created on the first write.
2. **Point `MONGODB_URI` in `apps/api/.env` at the database** (the API and the seed both read it; declare it only
   there). Edit the file in your editor rather than typing the URI on the command line, where it would land in your
   shell history. Copy the connection string from Atlas (Connect → Drivers), replace the whole `<db_password>`
   placeholder (angle brackets included), and add `/townant_dev_seed` before the `?`:

   ```bash
   MONGODB_URI=mongodb+srv://<user>:<url-encoded-password>@<cluster-host>/townant_dev_seed?retryWrites=true&w=majority
   ```

   URL-encode special characters in the password (`@` → `%40`, `/` → `%2F`, `:` → `%3A`, `#` → `%23`, `%` → `%25`).
   With a standard `mongodb://` (non-SRV) Atlas string, also add `authSource=admin`; otherwise the driver authenticates
   against `townant_dev_seed`, and Atlas answers "bad auth". Then add the confirmation to `apps/api/.env.seed`:

   ```bash
   CONFIRM_ATLAS_DEV_SEED=townant_dev_seed
   ```

   Check the result without printing secrets. This test is read-only: it pings and lists the user's roles:

   ```bash
   npm run env:check -w @townant/api -- --ping
   ```

   It reports where `MONGODB_URI` comes from, the database, a masked host, URI mistakes (placeholders, unencoded
   characters, a missing database, `authSource`), whether the API and the seed use the same server, database and
   credentials, and the connection result. Possible results are `AUTH_FAILED`, `UNREACHABLE` (usually the Atlas IP
   access list), `DNS_FAILED` and `URI_INVALID`.
3. **Run the seed.** `--with-categories` first upserts the starter category taxonomy, which an empty database needs.
   It only inserts missing categories and never changes existing ones.

   ```bash
   npm run seed:dev -w @townant/api -- --with-categories
   ```

   The first line printed must read `Seeding Atlas database "townant_dev_seed" (MongoDB Atlas)…`.
4. **Point your development API at the same database** to sign in with the seeded accounts: in `apps/api/.env`,
   the `MONGODB_URI` path must also be `/townant_dev_seed`. A URI without a database name makes the driver use
   `test`. Restart `npm run dev:api` afterwards.

To stop seeding Atlas, remove `CONFIRM_ATLAS_DEV_SEED` from `.env.seed`. `.env.seed` can still declare its own
`MONGODB_URI`, which overrides `.env` for the seed only. Avoid that unless you mean it: the API must read the same
database for the seeded accounts to work, and `seed:dev` warns when they differ.

### Re-running

Running it again is safe. Records are matched by stable keys (staff email, `demo-` business slug, service title within
the business, application email + business name) and only inserted when missing:

- No duplicates are created, and unrelated records are never changed or deleted.
- Existing accounts keep their passwords. To set them to the current `DEV_*_PASSWORD` values, run
  `npm run seed:dev -w @townant/api -- --reset-passwords`. This only touches the seed's own accounts. It activates an
  unfinished invite, but never un-suspends an account.
- Businesses you changed while testing (published, suspended, edited) keep your changes. To restore one, delete that
  business in the development database and run the seed again.
- If the Super Admin email already belongs to a vendor account, or a `demo-` slug belongs to someone else's business,
  that record is reported and left alone.

## 3. Sign in

**Super Admin**: open `/admin`, sign in with `DEV_SUPER_ADMIN_EMAIL` and `DEV_SUPER_ADMIN_PASSWORD`, then enter the
six-digit email code. Super Admins always use email two-step verification. In development, with no email provider
configured and `DEV_PRINT_OTP=true`, the code is printed in the API console.

**Vendors**: open `/business` and sign in with `vendor01@townant.test` … `vendor10@townant.test` and
`DEV_VENDOR_PASSWORD`. Vendors have no second step.

## Troubleshooting sign-in

**`401 Email or password is incorrect`.** Login looks the staff account up in the database the *running API* is
connected to. A wrong password and an account that isn't in that database get the same 401, on purpose, so the
response can't be used to discover accounts. If the password is right, the API is almost always reading a different
database than the seed wrote:

- At startup the API logs `database connected` with a `database` field (never the URI). It must say
  `townant_dev_seed`. If `MONGODB_URI` names no database, the API also logs a warning, because MongoDB then uses
  `test`.
- After seeding, `seed:dev` compares `apps/api/.env` with the seeded database and prints a `WARNING:` line if they
  differ.
- A `MONGODB_URI` set in the shell that starts the API overrides `.env`. Restart the API after editing `.env`
  (`npm run dev:api` restarts on code changes, not on `.env` changes).

**The API won't start: `MongoDB connection failed (AUTH_FAILED)`.** Run
`npm run env:check -w @townant/api -- --ping`. The usual causes are a `<db_password>` placeholder left in the URI, an
unencoded character in the password, a password changed in Atlas but not in `.env`, or (for non-SRV strings) a missing
`authSource=admin`. The API never falls back to another database.

**`429 Too many sign-in attempts`.** Every staff login attempt counts: 8 per email and 20 per IP in fixed 15-minute
windows aligned to the clock (:00, :15, :30, :45). The response's `Retry-After` header, and the message on the sign-in
page, say how long is left. The counters live in the API's database and expire on their own; there is no reset
command, and the limit is never relaxed in development. Wait for the window to end.

**`429 Too many codes requested` / `Please wait before requesting another code`.** At most 5 codes per email
address per clock hour, and 60 seconds between codes. Signing in again within those 60 seconds reuses the code
already sent, so nothing is sent and no budget is used. **Send a new code** always waits out the 60 seconds.

**The code.** Super Admin sign-in is password **and** a six-digit code sent by email; vendors use the password only.
With no `RESEND_API_KEY` outside production, emails go to the development outbox, and with `DEV_PRINT_OTP=true` the
API prints them in its console as a `[dev-email]` line. Production refuses to start with `DEV_PRINT_OTP=true`. If
`RESEND_API_KEY` is set, the code really is emailed, and `@townant.test` can't receive mail. In that case set
`DEV_SUPER_ADMIN_EMAIL` to an inbox you control **before** the first seed (an existing account's email is never
changed).

## Demo vendors and their purpose

All demo businesses say “Demo listing (development test data — not a real business)” in their summary and description,
and their slugs start with `demo-`. They have no photos (cards and profiles show the standard placeholder), no reviews
and no bookings. Hours are Monday to Friday 09:00 to 17:00 (odd-numbered vendors also open Saturday 10:00 to 14:00) in
the business's own time zone.

| # | Account | Business | Category | Location | Status | Use it to test |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | vendor01@townant.test | Northside Barber Co. | Beauty & Salon › Barber | Austin, TX | Published | Discovery, instant booking |
| 2 | vendor02@townant.test | Lakeview Massage Studio | Health & Wellness › Massage | Chicago, IL | Published | Request-mode booking (deep tissue) |
| 3 | vendor03@townant.test | Brightside Home Cleaning | Cleaning › House Cleaning | Denver, CO | Published | Mobile service, postal-code service area, quote pricing |
| 4 | vendor04@townant.test | Harbor Plumbing & Drain | Repairs & Maintenance › Plumbing | Seattle, WA | Published | Fixed + mobile service mode, request booking |
| 5 | vendor05@townant.test | Shine Auto Detailing | Automotive › Car Wash & Detailing | Phoenix, AZ | Published | Time zone without daylight saving |
| 6 | vendor06@townant.test | Paws & Suds Grooming | Pet Care › Grooming | Portland, OR | Published | “From” pricing |
| 7 | vendor07@townant.test | Summit Personal Training | Fitness › Personal Training | Toronto, ON, Canada | Published | Non-US address and CAD prices |
| 8 | vendor08@townant.test | Keynote Music Lessons | Lessons & Tutoring › Music Lessons | London, UK | Draft, ready | The vendor **Publish** flow (passes every check) |
| 9 | vendor09@townant.test | Greenleaf Landscaping | Home Services › Landscaping | Atlanta, GA | Draft, incomplete | Publish validation (“Add opening hours…”) |
| 10 | vendor10@townant.test | Frame & Focus Photography | Events › Photography | Miami, FL | Suspended | Hidden from the public; Super Admin reinstatement; vendor support while suspended |

Pending applications (Super Admin → Applications). No account exists until a Super Admin approves one, which is the
normal onboarding flow. Approving one creates the business and emails a setup link; in development the link is printed
in the API console.

| Business | Applicant email | Status |
| --- | --- | --- |
| Corner Nail Bar | applicant01@townant.test | Submitted |
| Steady Hands Handyman | applicant02@townant.test | Under review |

## Tests

`apps/api/test/devSeed.test.js` runs against the in-memory test database and covers:

- **Accepted targets:** local, and Atlas `townant_dev_seed` in both SRV and member-list forms.
- **Refused targets:** production mode (local and fully confirmed Atlas); a missing or non-`true` opt-in; an Atlas URI
  with no database or any other name; a missing or wrong confirmation; non-Atlas, look-alike and mixed hosts; and
  missing, empty, malformed or wrong-scheme URIs. Refused messages never echo the URI, password or Atlas host.
- **Post-connect checks:** the database and host are verified before the first write.
- **Category upsert:** idempotent, and leaves existing categories unchanged.
- **Seed data:** idempotency, password preservation and `--reset-passwords`, refusal to change an account with
  another role, missing categories, Super Admin sign-in with MFA, vendor sign-in into their own business, publish and
  publish validation, public visibility (published only), and bookable times.
