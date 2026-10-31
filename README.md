# TownAnt

Global marketplace for local services — **Find local. Book confidently.**
Customers discover businesses and book real availability; vendors run their profile, services, calendar and
messages; a Super Admin oversees onboarding and the platform. **TownAnt never processes payments.**

| Surface | Path | Stack |
| --- | --- | --- |
| API | `apps/api` | Node 22, Express 5, MongoDB (Mongoose 8), zod |
| Customer website, Vendor portal (`/business`), Super Admin (`/admin`) | `apps/web` | React 19, Vite, Tailwind 4, Framer Motion |
| Customer mobile app | `apps/mobile` | Expo SDK 58 / React Native (standalone install) |
| Shared constants | `packages/shared` | Booking statuses and labels |

Docs: [requirements tracker](docs/REQUIREMENTS_TRACKER.md) · [security model & residual risks](docs/SECURITY.md) ·
[decisions & assumptions](docs/DECISIONS.md) · [deployment & release checklist](docs/DEPLOYMENT.md) · [development seed](docs/DEV_SEED.md) · [development marketplace](docs/DEV_MARKETPLACE.md)

## Local development

Prerequisites: Node 22.12+, `mongod` and `mongosh` 8.x on PATH (MongoDB must run as a replica set — booking
integrity uses multi-document transactions).

```bash
npm install                                    # API + web (workspaces)
cp apps/api/.env.example apps/api/.env         # then set OTP_PEPPER (command in the file)
npm run db:dev -w @townant/api                 # terminal 1: local replica set on :27018
npm run seed:categories -w @townant/api        # starting category taxonomy (config, not listings)
npm run dev:api                                # terminal 2: API on :4000
npm run dev:web                                # terminal 3: web on :5173 (proxies /api)
```

With no provider keys set in development, email and WhatsApp messages go to an in-memory dev outbox; with
`DEV_PRINT_OTP=true` codes and setup links are printed in the API console. Production refuses to start in that mode.

Create the first Super Admin (prints a single-use setup link valid for 72 hours — no password is generated):

```bash
npm run admin:create -w @townant/api -- --email you@example.com
```

Development test data (Super Admin with a password, ten demo vendors, two pending applications). It needs
`ALLOW_DEV_SEED=true` and runs only against a local database, or the dedicated Atlas database `townant_dev_seed` with
`CONFIRM_ATLAS_DEV_SEED=townant_dev_seed`. Never in production; safe to re-run. See [docs/DEV_SEED.md](docs/DEV_SEED.md):

```bash
npm run seed:dev -w @townant/api -- --with-categories
```

Mobile:

```bash
cd apps/mobile && npm install
EXPO_PUBLIC_API_URL=http://<your-lan-ip>:4000 npx expo start
```

Android Studio emulator (start an AVD first; needs `ANDROID_HOME`, usually `~/Library/Android/sdk`):

```bash
cd apps/mobile && npm run android:emulator   # prebuilds android/ (gitignored), builds, installs and launches the debug app
npm run start:emulator                       # later sessions: Metro only, reusing the installed debug app
```

Both default `EXPO_PUBLIC_API_URL` to `http://10.0.2.2:4000` — the emulator's alias for the host machine, where
`localhost` would be the emulator itself. Cleartext HTTP is allowed in the debug build only. If the dev bundle cannot be
reached, run `adb reverse tcp:8081 tcp:8081`. Android 17 asks for "Nearby devices" (local network) on first launch of a
debug build; allow it so the app can reach Metro and the local API.

Optional public settings: `EXPO_PUBLIC_TERMS_URL` and `EXPO_PUBLIC_PRIVACY_URL` (https links to the approved documents).
Until they are set, the app's Terms and Privacy screens show the outline marked as awaiting legal review.

## Checks

```bash
npm test          # date-format guard + shared (9) + web component (61) + API (234) tests
npm run lint      # API + web (the mobile app: cd apps/mobile && npx expo lint)
npm run build     # web production build
cd apps/mobile && npx expo-doctor && npx expo export --platform android   # mobile bundle check
cd e2e && npm install && MONGODB_URI='mongodb://127.0.0.1:27018/townant?replicaSet=rs0' npm run smoke   # guarded browser journey (local DB only)
node e2e/screens.mjs / /search /categories                     # responsive + console-error check at 1440/1024/768/390
MONGODB_URI='mongodb://127.0.0.1:27018/townant_e2e_home?replicaSet=rs0' WEB_URL=http://localhost:5174 node e2e/homepage-check.mjs   # picker/homepage/assistant/admin checks (see e2e/README.md)
MONGODB_URI='mongodb://127.0.0.1:27018/townant_e2e_home?replicaSet=rs0' WEB_URL=http://localhost:5174 node e2e/support-check.mjs    # support desk + account deletion journey
```

CI (`.github/workflows/ci.yml`) runs lint, tests, build, a bundle secret scan, `npm audit`, and the mobile bundle check.
