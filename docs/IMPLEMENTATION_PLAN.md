# Almond implementation and release plan

## Product decisions and reference

Confirmed: React/TypeScript, responsive web/PWA, original Almond branding, Cashew feature and visual parity as the long-term target, login/cloud synchronization and offline editing. Neon was the user's database preference.

Implemented stack: Next.js App Router, React, TypeScript, plain CSS design tokens, Dexie/IndexedDB, Better Auth, Drizzle, Neon, Zod, Vitest and Playwright. No Tailwind dependency was needed for the existing interface.

The official [Cashew README Key Features](https://github.com/jameskokoska/Cashew#key-features) is the feature inventory, not a verified behavioral specification. DeepWiki returned HTTP 429 during initial research. Detailed interaction, import-format and visual comparison remain unverified. Cashew's [license](https://github.com/jameskokoska/Cashew/blob/main/LICENSE) is GPL-3.0; no Cashew source, logo or artwork was reused. Almond's warm surfaces, rounded controls, local DM Sans/Manrope fonts and original branding are an inspired direction, not pixel parity.

See [PARITY_TRACKER.md](PARITY_TRACKER.md) for the concise status matrix, code paths and executable/manual acceptance proof. “Implemented” describes repository behavior, not production readiness or a test-run result.

## Delivered scope and deliberate limits

- Manual accounts, income/expense CRUD, atomic same-currency transfers, account archive/restore and protected deletion; exact USD/JPY/INR minor-unit amounts.
- Optional one-time/daily/weekly/monthly/yearly schedules. Only explicit **Record payment** posts an occurrence; no automatic background posting, debt collection or lending ledger.
- Monthly/inclusive date-range budgets, multiple categories and optional selected posted expenses. No category sublimits or comparison charts.
- Saving goals use linked posted income; spending goals use linked posted expenses. They do not reserve or move money.
- Canonical CSV preview, strict validation, duplicate exclusion and atomic confirmation. Sheets support means exporting CSV, not Google OAuth or native Sheets import. See [IMPORT_FORMAT.md](IMPORT_FORMAT.md).
- Light/dark themes, sage/blue/plum accents and dashboard section visibility. No dashboard reordering or arbitrary/system-derived accents.
- Integrated manual dated direct-rate reporting with BigInt rounding; browser checks cover rate CRUD, missing-rate suppression, offline persistence and unchanged ledger amounts. Reporting does not change ledger amounts, infer inverse/cross rates, fetch live rates or allow cross-currency transfers. See [CURRENCY_CONVERSION.md](CURRENCY_CONVERSION.md).
- IndexedDB, validated JSON replacement restore, offline PWA shell, account-gated access and whole-workspace CAS sync with explicit conflict resolution.
- Better Auth email/password and password reset with Resend integration. Recovery is implemented; real inbox delivery and full live lifecycle acceptance remain unverified. Email verification, OAuth and account/data deletion remain missing.

## Remaining milestones, in order

### 1. Local integration and proof — completed; rollout still gated

- Manual-rate reporting is mounted with validated atomic save/delete callbacks.
- Export/restore and conflict downloads use shared backup v2 helpers; validated v1 input remains accepted. Protocol v2 mutual request/response checks reject incompatible peers before unsafe uploads.
- The local upgrade copies all workspace records into `workspacesV2` and removes the old physical store in one transaction. A version bump alone was insufficient because Dexie reopens newer databases. Migration tests prove preservation, rollback/retry and legacy-writer isolation.
- The service-worker shell cache is now `almond-shell-v3`. Production offline reload/edit and expanded backup round trips pass.
- Final local proof: **204 unit/API tests, 26 mocked browser workflows, TypeScript and production build passed**. Browser coverage includes rates, CSV, schedules, goals, flexible budgets, accessibility and preservation of optional collections.
- Still required before deployment: matching server/client rollout, refresh every device/PWA/old tab, and a real old-to-new waiting-worker/update-path check.

**Exit:** integrated behavior has preservation and compatibility proof. Protocol v2 and backup v2 are distinct from the cloud workspace revision. Do not downgrade a prior release onto new-format data; older schemas may strip fields. Export before upgrading and retain compatible restore tooling.

### 2. Live cloud integration gate — execution deferred

An opt-in real API harness exists in `tests/live/integration.spec.ts` with `playwright.live.config.ts`. It uses disposable staging users and a throwaway Neon branch, not mocks. **The user expressly deferred execution.** Do not provision or run it as part of this documentation refresh.

When authorized, follow [LIVE_VERIFICATION.md](LIVE_VERIFICATION.md) for isolation attestation, migrations, all three opt-in gates, the staged command, no-secret logging and branch disposal. The automated suite checks real sessions, ownership, idempotent retry, stale revisions, snapshot deletion propagation and revocation; it does not prove browser/offline convergence or mail delivery.

- Separately verify real browser registration, login, logout, session expiry, account switching and ownership isolation using two users/profiles.
- Verify two-device sync, reconnect, lost acknowledgements, stale clients and conflicting offline edits against actual PostgreSQL.
- Follow the harness document's **Manual real-inbox password-reset acceptance** for delivery, single-use/expiry, password replacement, session revocation and retained workspace.
- Configure hosting-boundary sync rate limits and verify request/body limits before public exposure.

**Exit:** actual staging results recorded, not inferred from mocked tests or discovery/compile checks. No production financial records until this passes.

### 3. Authentication lifecycle and data safety

- Verified-email flow; complete real reset-delivery acceptance rather than reimplementing recovery.
- Explicit account/data deletion, retention/export policy and administrative recovery policy.
- Multi-tab access checks, quota warnings, persistent-storage UX and backup reminders.
- Keep whole-workspace sync unless measured limits or merge requirements justify per-record operations; any transition needs protocol migration and rollback/preservation proof.

**Exit:** users can recover access and leave safely, with tested recovery paths.

### 4. Remaining financial and customization parity

- Audit exact reference workflows before adding debt/credit repayment/collection, bulk edits, automatic title/category rules, tags and amount filters.
- Budget category sublimits and historical comparison charts; expanded reports and category archiving with preserved references.
- Assess any broader currency/rate workflow separately; no binary-floating-point financial calculations.
- Capture Cashew desktop/mobile references and review layouts, spacing, typography and interaction states while retaining Almond identity.
- Dashboard reordering, richer accents, localization and expanded accessibility/keyboard/mobile checks.
- Obtain approval for browser adaptations of biometric/app lock, notifications, Google OAuth/Drive backup and transaction app links; none is currently implemented.

**Exit:** each agreed parity item has a reference workflow, focused validation/persistence/sync coverage and approved visual comparison or explicit adaptation.

### 5. Release gate

- Test supported browsers, installation/update paths, small-phone/landscape/tablet layouts, keyboard and reduced motion.
- Validate JSON restoration and Neon recovery into a separate branch; never drop financial tables as rollback.
- Test staging migrations, incompatible-client rejection and rollback compatibility with real saved data.
- Add privacy-preserving error monitoring, retention documentation and deployment/runbook ownership.
- Beta with noncritical records before general release.

**Exit:** approved parity exceptions, no known critical security/data-loss defects, and completed live/recovery gates. This working tree is not a production-readiness claim.

## Safety constraints retained

Whole-workspace sync/JSON restore is limited to 2 MB; the ledger is bounded to 10,000 transactions, 100 accounts, 200 categories, 1,000 budgets and optional collections of at most 1,000 schedules/1,000 goals. Only USD/JPY/INR are supported. No bank connections, automatic merges or closed-app sync/posting. IndexedDB and exported JSON are unencrypted and subject to storage eviction. Anyone with access to the browser profile may open an eligible cached workspace offline; its marker is not a credential, biometric lock or encryption. Server authorization remains independent. Offline access cannot observe server revocation until reconnection. Keep regular backups and never log financial payloads, tokens or database credentials.

## Verification evidence policy

README lists local commands; the tracker maps coverage to features. The final integrated tree passed `npm test` (204 tests), `npm run typecheck`, `npm run build`, and `npm run test:e2e` (26 workflows with mocked auth/sync). Chromium needed isolated downloaded system libraries/font configuration under `/tmp`; no system package installation or application dependency change was made. Live cloud/inbox checks were not run, as requested. No deployment, remote CI, visual parity or full Cashew parity is claimed.
