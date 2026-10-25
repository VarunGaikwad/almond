# Opt-in real integration verification

`tests/live/integration.spec.ts` uses real Playwright HTTP API contexts against the deployed Better Auth and Neon-backed sync routes. It does not mock transport or start an application/browser. The normal `npm run test:e2e` suite remains separate and uses mock cloud fixtures.

## Safety and prerequisites

**Never point this harness at production, a shared database, or real user data.** Before opting in:

1. Provision a **throwaway Neon branch** and a dedicated staging deployment connected only to that branch. Prefer a fresh/schema-only branch without copied private data. Apply the repository's migrations to that branch through your normal reviewed deployment process; this harness never runs migrations.
2. Verify the staging deployment's database binding in your provider console without printing/copying connection strings into reports. A staging hostname alone does not prove database isolation. The confirmation below is a human attestation, not automated detection of a production database.
3. Configure the server with `DATABASE_URL`, a stable `BETTER_AUTH_SECRET` of at least 32 characters, and `BETTER_AUTH_URL` equal to the staging origin. The harness needs **none of these secrets locally**. The deployment must be reachable, email/password registration enabled, and auth/sync routes available without a deployment-protection login or redirect. TLS must be valid.
4. Expect two new unique `almond-live-<UUID>@example.invalid` accounts per run, synthetic financial snapshots, database rate-limit records and sessions. Passwords are random per user, held only in memory, never supplied via CLI or printed. No mail/reset endpoint is called by the automated suite. Do not substitute real customer addresses. If your staging configuration requires email verification or disallows this reserved email domain, stop and adjust a dedicated staging environment rather than use real users.
5. Run without `DEBUG`, `PWDEBUG`, tracing, HTTP proxies with payload logging, or custom reporters that dump requests. Do not enable Playwright trace capture, save storage state, log response bodies, or attach network dumps. The config disables traces/screenshots/video and the suite reports only sanitized assertions/status codes. Ensure staging server/provider logs also redact passwords, cookies, tokens and private bodies. Never share credentials, session cookies, reset links or database URLs.

Three explicit gates are required before even creating an HTTP context:

- `ALMOND_LIVE_BASE_URL`: bare staging origin, no credentials, query, fragment or application path. HTTPS required except loopback HTTP for a locally served staging app connected to an isolated branch.
- `ALMOND_LIVE_ALLOW_WRITES=1`: consent to creating accounts and updating their snapshots.
- `ALMOND_LIVE_CONFIRM_STAGING=disposable-neon-branch`: confirmation that deployment and database are isolated/disposable.

With a missing gate, the test fails with a clear disabled message **before network access**. There is no default target and no `.env` loading. URL validation and disabled redirects prevent accidental redirect following; an explicitly supplied production origin is still dangerous. Do not opt in until isolation is independently verified.

## Commands

Use the repository's installed dependencies (`npm ci` if needed). Discovery only; this neither contacts a target nor creates users:

```sh
npx playwright test --config=playwright.live.config.ts --list
```

Local compile check (does not run the suite):

```sh
npm run typecheck
```

The following default invocation is intentionally disabled unless all gates were already exported; in a clean environment it fails before any network access:

```sh
npx playwright test --config=playwright.live.config.ts
```

After verifying the isolated deployment, replace the example origin with its actual origin and run explicitly:

```sh
ALMOND_LIVE_BASE_URL=https://your-disposable-staging.example \
ALMOND_LIVE_ALLOW_WRITES=1 \
ALMOND_LIVE_CONFIRM_STAGING=disposable-neon-branch \
npx playwright test --config=playwright.live.config.ts
```

No browser installation is needed for this API-only suite. Use the supplied config, one worker, zero retries; do not add `--debug` or tracing flags. A failure may leave test accounts/workspaces behind. Repeated runs create fresh users, and rapid reruns may encounter real auth rate limits. Do not disable production security controls to make tests pass.

## Automated acceptance

The single lifecycle checks:

- Two independent users register with real cookie sessions; a second isolated HTTP context logs in as the first user and receives a distinct session.
- Anonymous sync GET/POST return 401; both users' cross-owner GET/POST attempts return 403 and leave both snapshots unchanged.
- A synthetic snapshot upload increments the remote version and downloads unchanged through the other session.
- Replaying the same mutation UUID with its original base version returns the exact same snapshot/version (lost-ack retry idempotency).
- A new UUID with the old base version returns 409 and the current snapshot, without overwriting it.
- Removing a synthetic account in a subsequent snapshot is visible to the other session, while the other user's snapshot stays unchanged. This tests snapshot deletion propagation, not an account-deletion API.
- Signout invalidates both subsequent requests and a replay of the cookie captured **before** signout: session lookup returns null and sync reads/writes return 401. The other session stays authorized.

Fixtures derive from the exported `emptyData()` and do not assume category/account counts. No existing workspace is used. Comparisons suppress private response bodies on failure. Session cleanup is best effort; it is not user/workspace deletion.

## Disposal

After **every run, including failed runs**, stop/remove the staging deployment or detach its database binding, then delete **only the throwaway Neon branch created for this verification** using your provider's normal branch controls. Check the branch identity before deletion. Never execute broad SQL deletes, truncate shared tables, or delete a parent/production branch. This harness deliberately does not implement database cleanup or account deletion. Retain only sanitized pass/fail summaries, not payloads, storage state or credentials.

## What this does not prove

An API pass proves behavior at that particular deployed server/database at that time. It does not prove real browser cookie/SameSite handling, UI workflows, IndexedDB ownership switching, service-worker/offline reloads, pending-queue recovery/reconciliation, conflict UI, simultaneous racing mutations, financial calculations, email delivery or password reset. The existing mocked browser suite also does not establish real cloud/offline convergence. Verify those separately in isolated browser profiles against the disposable staging deployment. A live run is not performed by local compile/list checks.

## Manual real-inbox password-reset acceptance

Use a **separate disposable test account with an inbox you control**, never a customer's address. This check sends actual mail and is not part of the automated harness. Configure staging `RESEND_API_KEY` and `AUTH_EMAIL_FROM` with a verified sender and permission to deliver to that inbox. Keep the branch/deployment alive until this check finishes; do not expose these secrets locally or in screenshots/reports.

1. Register via `/register`, create a recognizable synthetic account/transaction, and confirm it syncs. Sign in to that same account in a second isolated browser profile. Keep both sessions for revocation checks.
2. Open `/forgot-password` in a third signed-out profile. Submit the test inbox address. **Accept:** generic “If an account exists…” confirmation, and an actual message arrives in that inbox/spam with the staging `/reset-password` link. The link must use the correct staging origin, not production or a different host. Do not copy/log its token.
3. Submit an unregistered test-only address. **Accept:** the UI gives the same non-enumerating confirmation; no account is created. Use only addresses you control if your mail system forwards unknown recipients.
4. Open the delivered link in the signed-out profile. Enter a new random 12–128-character password twice. **Accept:** mismatched/too-short inputs are rejected; matching valid values succeed with the sign-in prompt.
5. From the two previously authenticated profiles, attempt online sync or reload. **Accept:** neither old session can access cloud data; sign-in is required. Offline local data may remain on those devices; do not mistake that for server authorization.
6. In a fresh signed-out profile, try the old password. **Accept:** login fails. Try the new password. **Accept:** login succeeds and the original synthetic workspace is still present.
7. Reopen the used link. **Accept:** it cannot reset the password again. Request another link and leave it unused for over one hour (the configured lifetime), then open it. **Accept:** expired tokens cannot reset; the user can request a new link. Also verify an obviously invalid link fails safely.
8. Record only acceptance results, delivery timing, and sanitized errors—never inbox content, passwords, reset URLs/tokens, cookies, or financial payloads. Dispose of the disposable inbox/account environment and throwaway branch as above.
