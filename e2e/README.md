# Web smoke test

Drives the real web app in headless Chrome through the full journey: Super Admin bootstrap → public vendor
application → admin approval → vendor setup (service, hours, publish) → customer search → email-OTP booking →
vendor sees the appointment → mobile viewport. Screenshots land in `e2e/shots/`.

It needs a **development** stack (never production). The script refuses to run unless `MONGODB_URI` points at localhost: the API with `DEV_PRINT_OTP=true` so OTP codes and setup
links are readable from its log.

```bash
npm run db:dev -w @townant/api                       # terminal 1
cd apps/api && node --env-file=.env src/server.js > ../../e2e/api.log 2>&1   # terminal 2
npm run dev:web                                      # terminal 3
cd e2e && npm install && MONGODB_URI='mongodb://127.0.0.1:27018/townant?replicaSet=rs0' API_LOG=api.log npm run smoke
```

Env: `WEB_URL` (default http://localhost:5173), `API_LOG`, `CHROME_PATH`.

## Responsive check

`node screens.mjs <paths…>` loads each path at 1440, 1024, 768 and 390 px (override with `WIDTHS`),
saves full-page screenshots to `shots/`, and exits non-zero on horizontal overflow or console errors.
It only reads pages.

## Homepage, location picker, assistant and admin checks

`node launcher-check.mjs <paths…>` checks the floating “Ask TownAnt” button at 320, 375, 768, 1024 and 1440 px
(override with `WIDTHS`): the whole button must stay inside the viewport and the page must never be wider than the
screen, sampled repeatedly on a throttled connection so loading states are covered too. Read-only; exits non-zero on failure.
Run it against the production build (`npm run build -w @townant/web`, then `npx vite preview --port 4173` in `apps/web`,
which proxies `/api` like the dev server, and `WEB_URL=http://localhost:4173`): over the throttled link a cold Vite dev
server's unbundled modules exceed the 120 s navigation timeout.

`homepage-check.mjs` wipes and seeds a **dedicated** local database (its name must contain `e2e`), then checks the
location picker at 1440/1280×560/1024/768/390 px (top of page, scrolled, trigger at the top edge), Escape/outside-click
closing and focus return, the homepage sections (published categories and hero only), location-driven rows, the
assistant's provider-failure fallback, and the Super Admin Homepage screen (spotlight add/reorder/preview).

Run it against a separate stack so your usual dev servers and data are untouched:

```bash
cd apps/api && MONGODB_URI='mongodb://127.0.0.1:27018/townant_e2e_home?replicaSet=rs0' PORT=4100 \
  CLOUDINARY_CLOUD_NAME= OPENAI_API_KEY= DEV_PRINT_OTP=true node --env-file=.env src/server.js   # terminal 1
cd apps/web && API_PROXY_TARGET=http://localhost:4100 npx vite --port 5174                        # terminal 2
cd e2e && MONGODB_URI='mongodb://127.0.0.1:27018/townant_e2e_home?replicaSet=rs0' WEB_URL=http://localhost:5174 node homepage-check.mjs
```

## Support and account deletion journey

`support-check.mjs` (same guarded database and stack as above; reads one-time codes from `e2e/api-home.log`, so start
the API with its output written there) signs a customer in, checks the support form's inline validation, files a
request, files a vendor request from the portal, answers as a Super Admin with an internal note and a reply, confirms
the customer never sees the note, then deletes the customer's account through the full review → code → DELETE flow
and confirms every session ended.
