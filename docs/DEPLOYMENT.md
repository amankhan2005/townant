# Deployment guide and release checklist

Hosting is not chosen yet (PDF §18). Any host that runs Node 22 and serves static files works. Nothing has been
deployed.

## Topology

```
https://townant.com          → static web build (apps/web/dist), SPA fallback to index.html
https://townant.com/api/*    → API (Node, `npm start -w @townant/api`), behind the same origin
worker (optional)            → `npm run worker -w @townant/api` with RUN_WORKER=false on API nodes
MongoDB                      → replica set (e.g. Atlas M10+), TLS, IP allowlist, least-privilege user
```

Serving the API under the web origin keeps session cookies first-party and CORS trivial. If the API must live on
another origin, set `VITE_API_ORIGIN` at web build time, add the web origin to `CORS_ORIGINS`, and add the API origin to
`connect-src` in `public/_headers`. Recommended: serve `/admin` from a separate origin (see SECURITY.md).

## Environment

Use `apps/api/.env.example` as the reference. Production requirements are enforced at startup: Resend key and
sender, `CORS_ORIGINS`, `COOKIE_SECURE=true`, `DEV_PRINT_OTP=false`, an `https` `APP_BASE_URL`, and a strong
`OTP_PEPPER`. Keep secrets in the platform's secret store, with separate values for staging and production. Set
`TRUST_PROXY_HOPS` to the exact number of proxies in front of the API.

## First deploy

1. Provision the MongoDB replica set; create a database user with readWrite on the TownAnt database only.
2. Deploy the API; check `GET /api/health/ready` returns 200 (indexes build on first start).
3. `npm run seed:categories -w @townant/api` (idempotent).
4. `npm run admin:create -w @townant/api -- --email <ops email>` from a trusted shell, then open the printed link.
5. Build and deploy web: `npm run build` → upload `apps/web/dist`; apply the headers from `apps/web/public/_headers`.
6. Configure provider webhooks: Resend → `/api/webhooks/resend` (`RESEND_WEBHOOK_SECRET`); Meta →
   `/api/webhooks/whatsapp` (`WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`).
7. Mobile: set `EXPO_PUBLIC_API_URL` and an EAS project ID, then build with EAS. Push needs APNs/FCM credentials in EAS.

## Staging verification required before launch (not yet done)

- [ ] Resend: OTP email received; transactional email received; bounce webhook updates delivery status
- [ ] Meta WhatsApp: authentication template approved; OTP received on a non-US number; failed-status webhook handled
- [ ] Cloudinary: logo/banner/gallery upload, removal, delivery transformations
- [ ] OpenAI: natural-language search on common queries; polish and bio drafts reviewed for quality
- [ ] Expo push: token registration on a physical iOS and Android device; tapping opens the booking
- [ ] Browser smoke test (`e2e/`) against staging with a dev-print API instance, or a manual run of the same steps

## Release checklist

- [ ] `npm test`, `npm run lint`, `npm run build`, mobile `expo-doctor` and export all pass in CI
- [ ] `npm audit --omit=dev` shows no high or critical findings, or each one is documented in SECURITY.md
- [ ] Production env validated (API starts); `DEV_PRINT_OTP` is false; no `.env` committed
- [ ] Response headers verified on production URLs (CSP, HSTS, frame-ancestors, nosniff, Referrer-Policy)
- [ ] CORS allowlist lists only production origins
- [ ] Super Admin access limited to named people; MFA tested
- [ ] Backups enabled, with one **restore** tested and timed
- [ ] Logs shipped to retention storage; alerting on 5xx rate, readiness, notification-delivery failures and OTP send spikes
- [ ] Privacy notice, terms and review policy published (legal review, PDF §14)
- [ ] Rollback plan: previous web build and API image kept; schema changes are additive only
