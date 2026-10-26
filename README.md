# Almond

A working, offline-first personal-finance web app inspired by Cashew. Built with Next.js, React, TypeScript, Dexie, Better Auth, Drizzle, and Neon PostgreSQL.

**Status: partial Cashew parity, not a production-ready financial service.** Login is required. Authentication and synchronization need a configured Neon database; previously authenticated users can reopen their saved workspace offline. Earlier limited Neon checks do not prove successful registration, two-device sync, or real reset-email delivery. The opt-in live harness exists, but its execution was expressly deferred; see [live verification](docs/LIVE_VERIFICATION.md) and the [feature/evidence matrix](docs/PARITY_TRACKER.md).

## Run locally

Requires Node.js **22.14+** and npm.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. If that port is busy:

```sh
npm run dev -- --port 3100
```

Configure authentication below, then open `/register` to create an account or `/login` to sign in. New accounts start with an empty personal workspace. Existing local/demo records are retained in IndexedDB but are no longer opened automatically or uploaded; export them using the previous release before upgrading if you want to restore them into an account.

### Available now

- Responsive overview, transactions, budgets, accounts, reports, and settings.
- Income and expense creation/editing/deletion; atomic same-currency transfers.
- Account creation/editing, opening balances, calculated balances, archive/restore, and confirmed deletion of accounts without transactions. Archived accounts retain history and remain in totals, but cannot receive new transactions.
- Category creation/editing; monthly or inclusive date-range budgets spanning multiple categories, optionally restricted to selected posted expenses.
- Saving goals linked to posted income and spending goals linked to posted expenses.
- Optional one-time/daily/weekly/monthly/yearly schedules with explicit **Record payment**; no automatic background posting.
- XLSX import with a typed Excel template, workspace dropdowns, preview, validation and duplicate exclusion; canonical CSV remains supported. Google Sheets works by exporting XLSX or CSV, not a native connection. See [import format](docs/IMPORT_FORMAT.md).
- Search and month/type/account/category filters.
- Weekly cash-flow chart, category spending, net income, savings rate.
- Light/dark themes, sage/blue/plum accents, dashboard section visibility (not reordering), keyboard-accessible dialogs and mobile navigation.
- Durable IndexedDB storage, JSON export and validated restore.
- Production PWA shell with offline reload and offline editing.
- Dedicated login/registration pages, Better Auth email/password authentication, server-authorized sync, durable retries, and explicit conflict resolution.
- Session-gated workspace access, with offline reopening for the last successfully authenticated account on this browser.

Each account uses USD ($), Japanese yen (JPY / ¥), or Indian rupees (INR / ₹), chosen at creation and fixed afterward. Amounts use integer minor units: cents, whole yen, or paise. All accounts show their native balances. The primary account determines the reporting currency for combined dashboard and report totals; select a replacement before archiving or deleting it. Existing records and backups without a currency remain USD without changing amounts.

Currency reporting uses automatic Frankfurter reference rates, not manual rate entry. Current balances use the latest daily quotes; income and expenses use frozen transaction-date snapshots (the preceding available reference date on non-trading days). Changing the primary account changes reporting, not native ledger amounts or saved snapshots. Offline transactions still save: unavailable conversions remain pending and are filled automatically when rates become available online. Missing rates withhold affected combined totals rather than silently omitting accounts. Conversion uses exact rational arithmetic with halfway rounding away from zero. Budgets and goals remain in their own native currency, and transfers still require matching account currencies; cross-currency transfers are not supported.

Budgets have no per-category sublimits or comparison charts. Debt/credit workflows, bulk edits, title rules, tags, OAuth/Drive and other gaps are tracked in [docs/PARITY_TRACKER.md](docs/PARITY_TRACKER.md); release gates are in [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).

## Enable Neon, login, and cloud sync

1. Create a Neon PostgreSQL project. Use a separate development database or branch.
2. Use the gitignored `.env` or `.env.local` in the project root. Neon writes to `.env` when it already exists, otherwise `.env.local`. Preserve existing values and never commit credentials.
3. Add these **server-side only** values:

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@POOLED_HOST/DATABASE?sslmode=require
DATABASE_URL_UNPOOLED=postgresql://USER:PASSWORD@DIRECT_HOST/DATABASE?sslmode=require
BETTER_AUTH_SECRET=REPLACE_WITH_A_RANDOM_SECRET_AT_LEAST_32_CHARACTERS
BETTER_AUTH_URL=http://localhost:3000
```

Generate the secret with `openssl rand -base64 32`. Use the exact browser origin and port for `BETTER_AUTH_URL`. Production must use HTTPS. Do not prefix these variables with `NEXT_PUBLIC_` or paste credentials into chat.

4. Apply the checked-in migration:

```sh
npm run db:migrate
```

The migration command loads `.env` followed by `.env.local` overrides and prefers `DATABASE_URL_UNPOOLED` (direct connection). It falls back to `DATABASE_URL` for existing setups; use a direct URL for migrations. Deploying Neon services does not apply the application's SQL migration. Missing auth tables cause `/api/auth/get-session` to return 503 even when `/api/status` reports `configured: true`. For hosted deployments, set the same variables in your hosting provider and run migrations as a controlled release step.

5. Restart the application. Open **/register** and create an account with a password of 12–128 characters. Use **/login** for returning users. Without configured authentication, these pages show an unavailable/setup message rather than offering guest access.
6. Sign in on a second browser/device using the same account to verify real cross-device sync.

`GET /api/status` only reports whether the required variables exist; it does **not** prove database connectivity or that migrations have run.

### Password recovery

Configure these server-only variables to enable reset emails through Resend:

```dotenv
RESEND_API_KEY=re_your_api_key
AUTH_EMAIL_FROM=Almond <hello@your-verified-domain.example>
```

Verify the sender domain in Resend, set these variables locally and on your host, and restart. No additional package or database migration is needed. Use **Forgot password?** on `/login` (or visit `/forgot-password`). Links expire after one hour and are single-use. The new password must be 12–128 characters. A successful reset revokes existing online sessions and requires signing in again; it cannot erase already-saved offline data on other devices. Reset requests are limited to three per minute per IP.

A `200` response from `/api/auth/request-password-reset` does not confirm email delivery. Better Auth keeps the public response generic to avoid revealing whether an account exists and logs delivery failures separately. Server delivery errors include the Resend HTTP status and recognized error name, never the raw provider message. Check Resend's dashboard for details, confirm the API key has permission to send, verify the sender domain, and check any testing-mode recipient restrictions. Restart after changing environment variables. Never share API keys or reset links in logs or support requests.

A sign-in `403` needs separate diagnosis: inspect the response error code and confirm `BETTER_AUTH_URL` matches the exact browser origin (scheme, hostname, and port). Do not disable origin/CSRF checks to work around it.

Delivery is tested with a mocked Resend endpoint; verify a real inbox round trip after configuration before relying on recovery.

### Authentication limitations

Email/password sign-up, login, and password recovery are wired to Better Auth, with database-backed auth rate limits and server-side sessions. Email verification, OAuth, account deletion, and administrative recovery are **not implemented**. Do not open public registration or depend on this app for irreplaceable records before these controls and live security/integration testing are completed. An email address is not verified proof of ownership in this release.

## Offline and synchronization behavior

- The UI reads from IndexedDB only after the access gate opens an account. A local edit and its pending state are committed atomically.
- Online launches verify the server session with an uncached request. Reconnection, foregrounding, and a visible-page minute timer recheck access. Session expiry or a sync authorization rejection locks the workspace and clears offline eligibility without discarding pending edits.
- Offline launches require an existing saved workspace and a marker written after a successful online session check. The legacy `almond-workspace` preference alone does not grant access. Online server/network errors fail closed rather than falling back to a cached account. Offline access cannot detect server-side revocations until reconnection.
- Local/demo and authenticated workspaces are separate. Import a backup explicitly if you want to move local records into a personal workspace.
- Synchronization runs after edits, on reconnect, when returning to the app, approximately once a minute while visible, and manually from Settings.
- Synchronization uploads a **whole-workspace snapshot**, with a server revision and stable mutation ID. PostgreSQL compare-and-swap updates prevent stale overwrites.
- Protocol v3 uses a mutual `X-Almond-Protocol: 3` request/response handshake to reject incompatible peers rather than silently lose new fields. Deploy the server and client from the same release and refresh **all devices**, including installed PWAs and stale tabs. This is separate from the server's workspace revision.
- Exports and conflict downloads use backup v3; restore accepts validated v1, v2 and v3 input and clears optional collections absent from the imported copy. Primary-account selection and transaction FX snapshots survive backup round trips. Do not downgrade to a prior release after saving new-format data: older clients may strip primary-account selection, FX snapshots, schedules, goals or flexible budget fields. Export a backup before upgrading and retain compatible recovery tooling.
- The local IndexedDB upgrade atomically copies complete workspaces into `workspacesV3` and removes the old stores, including `workspacesV2`. Pending edits, retry IDs and conflict copies are preserved, with a primary account selected for legacy records. Legacy clients may recreate their old empty store, but cannot alter the migrated records or sync through protocol v3. Close/refresh old tabs before upgrading; do not continue editing in an old release.
- Lost acknowledgements retry the same payload. Edits made during a request remain pending rather than being overwritten by its response.
- Conflicts preserve the local and cloud snapshots in IndexedDB. Editing pauses until the user downloads copies if desired and explicitly chooses which entire workspace to keep. There is **no automatic merge**.
- If a retry occurs after another device has already written a newer snapshot, it conservatively becomes a conflict rather than guessing.
- The server derives ownership from the authenticated session. The supplied user ID is only a guard against an account switching in another tab.
- Browser Web Locks serialize sync across tabs where supported. IndexedDB transactions protect local edits independently.
- Sign-out requires pending/conflicting work to be resolved and removes that user's local copy and offline-access marker after a successful server sign-out. Other tabs recheck access when the marker changes.

**Initial limits:** 2 MB per synchronization request/backup restore, 10,000 transactions, 100 accounts, 200 categories, 1,000 budgets, 1,000 optional schedules and 1,000 optional goals; only USD/JPY/INR, with automatic reference-rate reporting rather than ledger conversion. The snapshot approach is deliberately simple, not a large-ledger synchronization protocol. Local storage is subject to browser quota/eviction; export regular backups. Financial data in IndexedDB and exported JSON is unencrypted. A cached workspace can be opened offline by anyone with access to the browser profile. The offline marker is not a credential, encryption, or a tamper-resistant app lock; server APIs independently authorize every request.

## Install and test the PWA

Service workers are disabled in development to avoid stale development bundles. To test installation and offline behavior:

```sh
npm run build
npm run start
```

Visit once online and allow the service worker to finish installing. Then use the browser's **Install app / Add to Home Screen** action. HTTPS or localhost is required. Offline editing works while the app is open and offline reload uses the cached shell. Background synchronization when the app is closed is not implemented; reopening/reconnecting triggers sync.

Only the generic, nonpersonalized shells for `/`, `/login`, and `/register`, plus same-origin static assets, are cached by the service worker. Each shell runs the access gate before showing workspace data. Authentication/API responses are never cached. On releases that change the shell, bump the cache name in `public/sw.js`; existing tabs must close before a waiting worker activates.

## Verification

```sh
npm run typecheck
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
npm audit
```

The browser suite starts a production server on port 3100. It uses mocked authentication/sync transports and covers login/registration success and errors, guest redirects, unavailable-service messaging, session expiry with pending-edit preservation, account switching, sign-out, transaction CRUD and transfers, account/category/budget creation, backup round trips, offline reload/edit persistence, dialog focus restoration, accessibility in both themes, and mobile overflow. These mocks are not proof of live authentication/database integration. Browser snapshots are written to `test-results/` and are not committed. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` only if using an existing compatible Chrome installation.

Unit tests exercise minor-unit arithmetic, validation, transfers, IndexedDB durability/concurrency, retry identity, edit-during-sync preservation, conflict resolution, and API authorization/input boundaries. Additional authored suites cover schedules, flexible budgets/goals, CSV, preferences, primary accounts and automatic FX snapshots; [the tracker](docs/PARITY_TRACKER.md) maps code to acceptance checks. Authored coverage is not a claim that the current working tree passed: record actual check results separately after integration. API boundary tests mock authentication/database access and are not proof of a live Neon deployment.

Live execution is **deferred by the user**, not passed. After independently confirming a disposable staging deployment and isolated Neon branch, the staged command is:

```sh
ALMOND_LIVE_BASE_URL=https://your-disposable-staging.example \
ALMOND_LIVE_ALLOW_WRITES=1 \
ALMOND_LIVE_CONFIRM_STAGING=disposable-neon-branch \
npx playwright test --config=playwright.live.config.ts
```

Read [docs/LIVE_VERIFICATION.md](docs/LIVE_VERIFICATION.md) first for prerequisites, no-network discovery, cleanup, automated scope, separate browser/device checks and manual real-inbox password-reset acceptance. Never target production or shared data. No cloud lifecycle or actual inbox pass is claimed.

## Code map

```text
src/app/                    Next.js shell, manifest, and API routes
src/components/             Screens, charts, accessible dialogs, forms
src/lib/finance.ts          Financial types, validation, exact cents calculations
src/lib/store.ts            IndexedDB workspace state and atomic local mutations
src/lib/sync.ts             Durable snapshot synchronization client
src/lib/server/             Better Auth configuration and Drizzle database schema
public/sw.js                Production-only offline application shell
public/icon*                Original Almond branding
Drizzle migrations: drizzle/
tests/                      Unit/API-boundary tests and Playwright browser tests
```

## Deployment and recovery

Use a Node-capable Next.js host (for example Vercel), not static-only hosting. Keep Neon near the application region. Use separate staging and production databases. Before deployment, export data, create a database recovery point, run migrations on staging, and verify authorization/sync with two real users and two browser profiles. Configure platform request-rate limits for the sync endpoint before public exposure. Never log request bodies, financial data, tokens, or database URLs.

This initial migration only creates tables. Future schema/data changes must have a migration and preservation proof. Roll back application releases only when their schema, sync protocol, backup and local IndexedDB formats are compatible; do not run a prior release against new-format financial data. Do not drop financial tables as a rollback. Test Neon restoration into a separate branch before switching production connections.

## Reference and attribution

Cashew's official [README Key Features](https://github.com/jameskokoska/Cashew#key-features) was used to inventory features; its source [license](https://github.com/jameskokoska/Cashew/blob/main/LICENSE) is GPL-3.0. No Cashew source code, logo, or artwork was copied into this implementation. Almond is independent and not affiliated with Cashew. Review license obligations before any future source or asset reuse.

Icons: Lucide (ISC). Fonts: DM Sans and Manrope, self-hosted through Fontsource (SIL OFL). Their license notices are in `public/font-licenses/`. No external font service or financial analytics is used.
