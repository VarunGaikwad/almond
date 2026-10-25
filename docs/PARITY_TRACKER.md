# Cashew parity and acceptance tracker

Reference: the official [Cashew README — Key Features][C], fetched during this refresh. Its feature list is not a verified workflow/import specification. DeepWiki previously returned HTTP 429; detailed behavior and visual parity remain unverified. No Cashew code or artwork was copied.

**Statuses:** **implemented** = repository behavior exists, not proof of a passing run; **partial** = only part of the reference feature or integration exists; **missing** = not implemented; **intentional adaptation** = explicitly narrower web/local behavior, not full parity. Each row links the reference and names code plus an executable or manual acceptance check. Missing-feature checks are future acceptance conditions, not existing tests.

## Feature matrix

| Feature / reference | Status and boundary | Code / acceptance proof |
| --- | --- | --- |
| Accounts and currencies [C] | **Implemented:** manual accounts, fixed USD/JPY/INR, opening/calculated balances, archive/restore and protected deletion; same-currency transfers only. | `src/lib/finance.ts`, `src/components/forms.tsx`; `tests/currency.test.ts`, `tests/account-lifecycle.test.ts`, `tests/e2e/app.spec.ts`. Create each currency, archive without losing totals/history, reject cross-currency transfer and deletion with history. |
| Transaction editing [C] | **Implemented:** income/expense/transfer CRUD, notes and dates. | `src/components/almond-app.tsx`, `src/components/forms.tsx`, `src/lib/store.ts`; `tests/finance.test.ts`, `tests/store.test.ts`, `tests/e2e/app.spec.ts`: edit/delete and reload; balances must remain exact. |
| Upcoming/repeating/subscriptions [C] | **Intentional adaptation:** optional schedules, once/daily/weekly/monthly/yearly, explicit **Record payment** only; not automatic background posting or all Cashew transaction types. | `src/lib/schedules.ts`, `src/components/schedules.tsx`; `tests/schedules.test.ts`, `tests/e2e/schedules.spec.ts`: month-end/leap anchors, stale/concurrent posting once, archived-account rejection; unposted schedules never affect totals. |
| Debts/credit (borrowed/lent) [C] | **Missing:** a credit account type is not a debt/collection workflow. | Current boundary: `src/lib/finance.ts`. Future manual proof: lend/borrow, partially repay/collect and reconcile remaining liability without double-counting income/expense. |
| Flexible/added budgets [C] | **Implemented:** monthly or inclusive custom date range, multiple categories, optional selected posted expenses; currency-scoped. | `src/lib/budgets.ts`, `src/lib/finance.ts`, `src/components/forms.tsx`; `tests/budgets-goals.test.ts`, `tests/e2e/budgets-goals.spec.ts`: both boundaries, selected-only/category/currency restrictions and historical month navigation. |
| Category limits/history comparison [C] | **Partial:** historical periods/progress available; per-category sublimits within a budget and comparison charts **missing**. | `src/lib/budgets.ts`, `src/components/charts.tsx`. Future manual proof: enforce distinct category limits in one budget and compare equivalent historical periods without including unposted schedules. |
| Saving/spending goals [C] | **Implemented:** saving links posted income; spending links posted expenses, same currency. Progress does not reserve/move money. | `src/lib/goals.ts`, `src/components/goals.tsx`; `tests/budgets-goals.test.ts`, `tests/e2e/budgets-goals.spec.ts`: reject wrong type/currency/duplicate links; editing/deleting postings recomputes progress after reload. |
| Custom categories [C] | **Partial:** create/edit names, colors and a fixed icon set; broad icon search, category archive and default polarity absent. | `src/components/forms.tsx`, `src/lib/finance.ts`; `tests/e2e/app.spec.ts` covers creation. Future manual proof: archive with preserved historical references and use category defaults when entering a transaction. |
| Automatic custom-title rules [C] | **Missing:** free-form transaction titles are not remembered category rules/autocomplete. | Boundary: `src/components/forms.tsx`. Future manual proof: reuse a title, get the remembered category, change/remove a rule without modifying historical entries. |
| Search/filtering and tags [C] | **Partial:** title/notes, month, type, account and category filters; tags and amount filters **missing**. | `src/components/almond-app.tsx`; `tests/e2e/app.spec.ts` search coverage. Future manual proof: combine amount/tag/date filters and verify totals/list agree. |
| Bulk editing [C] | **Missing:** no multi-select edit/delete workflow. | Boundary: `src/components/almond-app.tsx`. Future manual proof: select multiple records, confirm one atomic change/delete and preserve budget/goal references. |
| Conversion rates [C] | **Intentional adaptation:** integrated manual dated direct USD/JPY/INR reporting; rate CRUD, offline persistence and missing-rate suppression are browser-tested. No live/inverse/triangulated rates or cross-currency transfers. | `src/lib/exchange.ts`, `src/components/exchange.tsx`, `src/lib/finance.ts`; `tests/exchange.test.ts`, `tests/e2e/exchange-backup.spec.ts`: BigInt, ties away from zero, safe limits, missing-rate suppression, stale warnings, original amounts unchanged. Complete [currency integration checklist](CURRENCY_CONVERSION.md), including offline/backup/sync checks. |
| Google login [C] | **Missing:** email/password Better Auth is the current alternative, not OAuth parity. | `src/lib/server/auth.ts`. Future manual proof: approved OAuth flow, account linking/collision handling, logout and user isolation. |
| Password reset / access lifecycle [C] | **Partial:** reset pages, Resend delivery adapter, single-use/expiring links and session revocation implemented; real delivery unverified. Email verification/account deletion absent. | `src/lib/server/auth.ts`, `src/lib/server/password-email.ts`, `src/app/forgot-password/`, `src/app/reset-password/`; `tests/password-reset.test.ts`, `tests/e2e/password-reset.spec.ts` use mocked delivery/transport. Follow [real-inbox acceptance](LIVE_VERIFICATION.md#manual-real-inbox-password-reset-acceptance); do not treat mocks as an inbox pass. |
| Biometric/app lock [C] | **Missing:** login/offline eligibility is not encryption or biometric protection. | `src/lib/workspace-access.ts` documents the access boundary in code; `tests/workspace-access.test.ts` covers it. Future manual proof: approved lock/re-auth workflow on supported devices without claiming server revocation erases offline data. |
| Themes and accents [C] | **Intentional adaptation:** light/dark and sage/blue/plum; no arbitrary or system-derived Material You accent. | `src/lib/preferences.ts`, `src/components/dashboard-preferences.tsx`, `src/app/globals.css`; `tests/preferences.test.ts`, `tests/e2e/customization-import.spec.ts`: persist/reset accent; verify both themes/keyboard contrast manually. |
| Customizable home screen [C] | **Partial:** cashflow, spending, recent transactions and budget-preview visibility; no widget reordering. Browser-local preferences, not financial sync. | `src/lib/preferences.ts`, `src/components/dashboard-preferences.tsx`, `src/components/almond-app.tsx`; `tests/e2e/customization-import.spec.ts`: hide/reload/reset; Reports stays available. Future proof for reordering requires persistent ordered layout. |
| Graphs/adaptive UI/visual parity [C] | **Partial:** cashflow/category reports, responsive navigation and original Almond branding; detailed graph interactions and Cashew visual parity unverified. | `src/components/charts.tsx`, `src/app/globals.css`; `tests/e2e/app.spec.ts` includes accessibility/mobile assertions. Manual: compare approved Cashew captures at desktop/mobile sizes, keyboard/reduced-motion states; no screenshot comparison pass claimed. |
| Localization [C] | **Missing:** currency formatting is not translated UI/locale parity. | Current formatting: `src/lib/finance.ts`. Future manual proof: translated strings, date/number input, long labels, pluralization and RTL where supported. |
| Cross-device sync [C] | **Partial:** server-authorized whole-workspace CAS, retries, conflict copies and explicit whole-copy resolution; real end-to-end cloud convergence pending. | `src/lib/sync.ts`, `src/lib/store.ts`, `src/app/api/sync/route.ts`; `tests/sync.test.ts`, `tests/api.test.ts`, `tests/store.test.ts` are local/mocked. Opt-in `tests/live/integration.spec.ts` exists; execution deferred. Follow [live verification](LIVE_VERIFICATION.md) plus separate real browser/offline/conflict checks. |
| Backup / Google Drive [C] | **Partial:** integrated validated JSON replacement restore, v2 exports/conflict downloads and v1 input compatibility. Google Drive **missing**. | `src/lib/data-format.ts`, `src/components/almond-app.tsx`; `tests/data-format.test.ts`, `tests/e2e/app.spec.ts`, `tests/e2e/exchange-backup.spec.ts` prove backup round trips, optional-collection preservation and invalid-input atomicity; separately prove approved Drive authorization/restore if added. |
| CSV / Google Sheets [C] | **Intentional adaptation:** strict canonical CSV preview, row errors, duplicate exclusion and atomic confirmation; Sheets only through exported CSV. No native Sheets/OAuth import or arbitrary bank/Cashew format compatibility. | `src/lib/csv-import.ts`, `src/components/csv-import.tsx`, parent callback in `src/components/almond-app.tsx`; `tests/csv-import.test.ts`, `tests/e2e/customization-import.spec.ts`. Follow [format/preview limits](IMPORT_FORMAT.md); malformed/duplicate/concurrently invalidated batches must not partially save. |
| Notifications [C] | **Missing:** schedule due dates are not push/browser reminders. | `src/components/schedules.tsx` is in-app display only. Future manual proof: permission denial/revocation, due-time delivery, no sensitive lock-screen payloads and documented closed-app limitations. |
| Transaction app links [C] | **Missing:** hash navigation is not prefilled-transaction app-link support. | Boundary: `src/components/almond-app.tsx`. Future manual proof: parse validated fields, require review/confirmation and reject unsafe/unsupported links without writing data. |
| Offline PWA [C] | **Implemented:** cached generic shell and IndexedDB editing/reload for an eligible authenticated workspace; no closed-app background sync/posting. | `public/sw.js`, `src/lib/workspace-access.ts`, `src/lib/store.ts`; `tests/e2e/app.spec.ts`. Manual production install/update check: visit online, go offline, edit, reload, then reconnect and verify authorization/convergence. |

[C]: https://github.com/jameskokoska/Cashew#key-features

## Compatibility and data safety

- Sync protocol **v2** uses mutual `X-Almond-Protocol: 2` request/response checks (`src/lib/data-format.ts`, `src/lib/sync.ts`, `src/app/api/sync/route.ts`). Both peers must refuse incompatible versions rather than silently strip expanded data. This protocol number is not the cloud workspace revision.
- Backup **v2** is wired into exports, conflict downloads and restore, accepting validated v1 input. Optional collections absent from a replacement backup are cleared. Refresh **every device**, installed PWA and old tab onto the same client/server release. Shell cache is `almond-shell-v3`; real waiting-worker/update behavior still requires release acceptance.
- Local IndexedDB migration atomically copies workspaces into `workspacesV2` and removes the old store, preserving pending retry identities and conflict copies. `tests/local-upgrade.test.ts` proves preservation, reopen, rollback/retry and isolation from legacy writers. Old clients may recreate an empty legacy store; edits there do not enter the new workspace. Close/refresh old tabs before upgrade.
- **Do not downgrade to a prior release with new data.** Older schemas may drop schedules, goals, rates and expanded budget fields. Export before upgrading; prove restoration with compatible tooling and test Neon recovery in an isolated branch, never by dropping production tables.
- Preserve exact minor units, atomic changes, authorization boundaries, pending edits/conflict copies and original ledger amounts. Manual rates are estimates only. No automatic merge, bank integration, verified-email ownership or end-to-end encryption is claimed.
- IndexedDB/JSON are unencrypted and subject to browser eviction. An unlocked browser profile can expose offline data; offline access cannot detect server revocation until reconnect. Regular backups and live security/recovery review remain required.

## Acceptance execution and evidence

**Final local results:** `npm test` passed **204 tests**, `npm run typecheck` and `npm run build` passed, and the production Playwright suite passed **26 workflows**. Browser auth/sync are mocked; no real cloud or inbox result is implied. The separate live suite was discovered but not executed. No full-parity or production-readiness claim follows from these checks.

In this minimal Linux environment, Chromium required libraries extracted under `/tmp/almond-browser-libs` (not system-installed). The browser invocation used:

```sh
LD_LIBRARY_PATH=/tmp/almond-browser-libs/usr/lib/x86_64-linux-gnu \
FONTCONFIG_PATH=/tmp/almond-browser-libs/etc/fonts \
FONTCONFIG_FILE=/tmp/almond-browser-libs/etc/fonts/fonts.conf \
FONTCONFIG_SYSROOT=/tmp/almond-browser-libs npm run test:e2e
```

These temporary paths are environment-specific, not required on machines with Playwright's dependencies installed.

Local commands (from README):

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
npm audit
```

Browser setup, if needed: `npx playwright install --with-deps chromium`. The normal browser suite uses mocked authentication/sync, not a real Neon lifecycle. No remote CI result, actual inbox delivery, cloud lifecycle pass or visual match is asserted here.

Live harness discovery only (no target contacted):

```sh
npx playwright test --config=playwright.live.config.ts --list
```

**Live execution was expressly deferred by the user.** Only after authorization and independently verifying the disposable staging deployment/database binding, use the staged command from [LIVE_VERIFICATION.md](LIVE_VERIFICATION.md):

```sh
ALMOND_LIVE_BASE_URL=https://your-disposable-staging.example \
ALMOND_LIVE_ALLOW_WRITES=1 \
ALMOND_LIVE_CONFIRM_STAGING=disposable-neon-branch \
npx playwright test --config=playwright.live.config.ts
```

Never target production/shared data. Follow that document's prerequisites, logging restrictions, branch disposal, separate real-browser checks and manual real-inbox reset steps. API-only live acceptance does not prove service-worker/offline convergence, conflict UI or mail delivery.
