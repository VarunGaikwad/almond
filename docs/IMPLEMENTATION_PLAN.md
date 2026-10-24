# Almond implementation and parity tracker

## Product decisions

Confirmed: React/TypeScript, responsive web/PWA, Almond branding, Cashew feature and visual parity as the long-term target, login/cloud synchronization, and offline editing. Neon was the user's database preference; this implementation targets Neon PostgreSQL.

Implemented stack: Next.js App Router, React, TypeScript, plain CSS with design tokens, Dexie/IndexedDB, Better Auth, Drizzle, Neon, Zod, Vitest, and Playwright. Plain CSS was sufficient for the existing interface, so Tailwind was not added merely because it appeared in the proposed stack.

Visual direction: warm ivory surfaces, muted sage accents, rounded Material-inspired controls, DM Sans body text, Manrope headings, and readable financial summaries. Original Almond leaf/nut branding. This is a Cashew-inspired direction, **not verified pixel parity**. Reference screenshots and detailed interaction capture remain necessary.

## Reference audit

Verified source: https://github.com/jameskokoska/Cashew/blob/main/README.md (Key Features).

The README documents flexible budgets and periods, budget category limits and history, savings/spending goals, upcoming/subscription/repeating/debt/credit transactions, custom categories/titles, transaction search/filtering and bulk edits, multiple currencies/accounts and conversion rates, biometric lock, Google login, Material You styling, custom accent colors, light/dark themes, customizable dashboard widgets, graphs, adaptive layouts, cross-device synchronization, Google Drive backup, notifications, CSV/Sheets import, and transaction app links.

Source license verified at https://github.com/jameskokoska/Cashew/blob/main/LICENSE: GNU GPL v3. No Cashew code or assets were reused. The DeepWiki URL returned HTTP 429 during initial research. Detailed visual, behavior, and import-format audits remain outstanding.

## Current delivery

| Area | Implementation | Verification / limitation |
|---|---|---|
| App shell and navigation | Six screens, hash-addressable navigation, mobile drawer | Browser workflow and mobile overflow tests |
| Branding and themes | Original Almond mark, light/dark, local fonts | Dashboard axe checks in both themes; original screenshots not compared |
| Accounts | Create/edit, account types, opening/calculated balances | Browser test and domain calculations; archive/delete pending |
| Transactions | Income/expense/transfer, create/edit/delete, notes/date | Browser CRUD and exact cents tests; recurring/bulk operations pending |
| Filters | Month, title/notes search, account, category, type | Browser search proof; amount/tag filters pending |
| Categories | Defaults plus create/edit color/name/icon | Browser test; expanded icon picker/archive pending |
| Budgets | One monthly limit per category with progress | Browser creation and duplicate validation tests; custom periods/goals pending |
| Reports | Weekly cashflow, category spending, net income/savings rate | Derived from real ledger; not complete Cashew reports |
| Money | Bounded integer minor-unit arithmetic; atomic transfer entity | Unit tests; only USD, no exchange rates |
| Local data | Atomic IndexedDB mutations, separated local/user workspaces | Persistence/concurrency tests and offline browser test |
| Backup | Versioned JSON export and validated replacement restore | Browser round-trip; no Cashew/CSV/Sheets compatibility claim |
| PWA | Manifest, icons, production service worker, static shell offline | Real production offline reload + edit + second reload passed |
| Auth | Better Auth email/password, server sessions, database rate limit | Builds and unconfigured path tested; live Neon and recovery unverified |
| Cloud sync | Durable versioned whole-workspace snapshots, CAS writes, retries | Client state/transport tests, API boundary tests; live two-device test pending |
| Conflicts | Preserve both snapshots; explicit whole-copy choice with downloads | Unit tests; automatic merge intentionally not implemented |
| Security | Session-derived ownership, same-origin writes, body/schema limits, no cached APIs | Mocked API-boundary tests; independent/live security review pending |
| CI | Type check, unit tests, build, Chromium browser tests | Workflow checked in, remote CI not run |

## Remaining milestones, in order

### 1. Live cloud integration gate

- Configure staging Neon and production-grade authentication secrets/origin.
- Apply checked-in migration and test sign-up, login, logout, revocation, and ownership isolation with two users.
- Verify two-device sync, reconnect, lost acknowledgements, stale versions, deletion propagation, and conflicting offline edits against actual PostgreSQL.
- Add a controlled live-integration test job using disposable staging users/database branches.
- Add synchronization endpoint rate limits at the hosting boundary and test request/body limits.

**Exit:** prove cloud behavior with real sessions, not just mocks. No production financial records until this passes.

### 2. Authentication lifecycle and data safety

- Verified-email flow and secure password reset delivery.
- Explicit account/data deletion with confirmation, retention and export policy.
- Session-expiry and account-switch browser tests across tabs.
- Quota warnings and persistent-storage request UX; backup reminders.
- Replace snapshot sync with per-record operations only if measured limits or merge requirements justify it; include protocol migration and rollback compatibility.

**Exit:** users can recover access and leave safely; documented and tested recovery paths.

### 3. Financial parity

- Audit exact original behavior first, then implement recurring/subscription/upcoming transactions, debts/credit, and bulk operations.
- Flexible budget periods, selected-transaction budgets, category limits, historical comparisons, and goals.
- Multicurrency precision/conversion, exchange-rate freshness and offline fallbacks. No financial calculations using binary floating point.
- Account/category archiving with preserved transaction references.
- Import-preview/duplicate handling and CSV/Sheets compatibility from verified specifications.

**Exit:** each feature has a reference workflow and passing calculations, validation, persistence, and sync tests.

### 4. Visual and customization parity

- Capture original Cashew screens at agreed desktop/mobile sizes and identify web adaptations.
- Match layouts, spacing, typography, components, and interaction states; retain original Almond identity.
- Accent selection and customizable dashboard widgets.
- Expand reports, localization, accessibility, and keyboard/mobile interaction checks.
- Map biometric/app-lock, notifications, OAuth/Drive backup, and app links to feasible browser equivalents for user approval.

**Exit:** approved visual comparisons and an explicit adaptation list, not assumptions about unavailable browser capabilities.

### 5. Release gate

- Test supported browsers, installation/update paths, small-phone/landscape/tablet layouts, keyboard operation, and reduced motion.
- Validate backup restoration and Neon point-in-time recovery in a separate branch.
- Test staging migrations, old/new client compatibility, and rollback without dropping data.
- Add privacy-preserving error monitoring, retention documentation, and deployment/runbook ownership.
- Beta with noncritical records before general release.

**Exit:** agreed parity items are complete or have approved exceptions; no known critical security/data-loss defects.

## Explicit current limits

USD only, manual account tracking, monthly budgets, no real bank connections, no automated merges, no background sync while closed, no verified-email/password recovery, no end-to-end encryption/app lock, no original Cashew data-import compatibility, no external deployment. Whole-workspace sync is limited to 2 MB per request. Local data remains subject to browser storage eviction and is accessible to a person with access to the unlocked browser profile.

## Build evidence

See README for executable verification commands. Initial local proof: 42 Vitest tests, 5 Playwright workflows, TypeScript and production build, migration generation consistency, and dependency audit. Screenshots were generated by Playwright but could not be visually inspected because image reading is disabled in this coding environment. DOM/layout/accessibility assertions were run instead. No claim of live Neon verification or full parity is made.

Delegation was attempted as requested; both subagent calls failed because the runner could not load `@earendil-works/pi-coding-agent`. Implementation and verification proceeded in the parent session instead. No child wrote repository files.
