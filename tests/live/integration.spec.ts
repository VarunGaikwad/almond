import { randomBytes, randomUUID } from 'node:crypto';
import { test, expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import { emptyData, financeSchema, type FinanceData } from '../../src/lib/finance';
import { SYNC_PROTOCOL_HEADER, SYNC_PROTOCOL_VERSION, syncProtocolHeaders } from '../../src/lib/data-format';

function liveOrigin() {
  if (!process.env.ALMOND_LIVE_BASE_URL || process.env.ALMOND_LIVE_ALLOW_WRITES !== '1'
    || process.env.ALMOND_LIVE_CONFIRM_STAGING !== 'disposable-neon-branch') {
    throw new Error('Live tests disabled: set ALMOND_LIVE_BASE_URL, ALMOND_LIVE_ALLOW_WRITES=1 and ALMOND_LIVE_CONFIRM_STAGING=disposable-neon-branch. See docs/LIVE_VERIFICATION.md.');
  }
  // Debug transport logs can expose passwords and cookies even with tracing disabled.
  if (process.env.DEBUG || process.env.PWDEBUG) throw new Error('Unset DEBUG and PWDEBUG for live tests.');
  let url: URL;
  try { url = new URL(process.env.ALMOND_LIVE_BASE_URL); }
  catch { throw new Error('ALMOND_LIVE_BASE_URL must be a bare staging origin.'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) {
    throw new Error('Use a bare HTTPS staging origin (HTTP allowed only on loopback), without credentials, query or path.');
  }
  return url.origin;
}

// Never let transport errors, JSON parse errors or matcher diffs print private bodies.
async function safely<T>(label: string, run: () => Promise<T>): Promise<T> {
  try { return await run(); }
  catch { throw new Error(`${label} failed; sensitive transport details suppressed.`); }
}
async function send(context: APIRequestContext, method: 'GET' | 'POST', path: string, data?: unknown) {
  return safely('HTTP request', () => context.fetch(path, { method, data, maxRedirects: 0, headers: path.startsWith('/api/sync') ? syncProtocolHeaders : undefined }));
}
async function json(response: APIResponse): Promise<any> {
  return safely('JSON response parsing', () => response.json());
}
async function session(context: APIRequestContext) {
  const response = await send(context, 'GET', '/api/auth/get-session');
  expect(response.status(), 'session response status').toBe(200);
  const body = await json(response);
  expect(typeof body?.user?.id === 'string' && typeof body?.session?.id === 'string', 'cookie session exists').toBe(true);
  return { userId: body.user.id as string, sessionId: body.session.id as string };
}
type Snapshot = { version: number; data: FinanceData; mutationId: string | null };
async function snapshot(response: APIResponse, status = 200): Promise<Snapshot> {
  expect(response.status(), 'sync response status').toBe(status);
  expect(response.headers()[SYNC_PROTOCOL_HEADER.toLowerCase()], 'compatible sync protocol').toBe(String(SYNC_PROTOCOL_VERSION));
  const body = await json(response);
  expect(Number.isInteger(body?.version) && body.version >= 0
    && (body.mutationId === null || typeof body.mutationId === 'string')
    && financeSchema.safeParse(body.data).success, 'valid remote snapshot').toBe(true);
  return body;
}
function sameSnapshot(actual: Snapshot, expected: Snapshot) {
  expect(JSON.stringify(actual) === JSON.stringify(expected), 'remote snapshot unchanged/exactly propagated').toBe(true);
}
const download = (context: APIRequestContext, userId: string) => send(context, 'GET', `/api/sync?userId=${encodeURIComponent(userId)}`);

// One lifecycle, no retries: reruns always create fresh users, never overwrite existing users.
test('real auth, session ownership, snapshot CAS and revocation', async ({ playwright }) => {
  const origin = liveOrigin(); // Must run before creating any HTTP context or user.
  const contexts: APIRequestContext[] = [];
  async function context() {
    const result = await safely('HTTP context creation', () => playwright.request.newContext({
      baseURL: origin, extraHTTPHeaders: { Origin: origin }, timeout: 15_000,
      ignoreHTTPSErrors: false,
    }));
    contexts.push(result);
    return result;
  }
  try {
    const anonymous = await context();
    const a = await context();
    const aOtherSession = await context();
    const b = await context();
    const credentials = () => ({ email: `almond-live-${randomUUID()}@example.invalid`, password: randomBytes(32).toString('hex') });
    const userA = credentials();
    const userB = credentials();
    for (const [client, credentials] of [[a, userA], [b, userB]] as const) {
      const response = await send(client, 'POST', '/api/auth/sign-up/email', { ...credentials, name: 'Almond live test only' });
      expect(response.status(), 'register test-only user').toBe(200);
    }
    const identityA = await session(a);
    const identityB = await session(b);
    expect(identityA.userId !== identityB.userId, 'distinct users').toBe(true);
    const login = await send(aOtherSession, 'POST', '/api/auth/sign-in/email', userA);
    expect(login.status(), 'login creates second session').toBe(200);
    const otherIdentity = await session(aOtherSession);
    expect(otherIdentity.userId === identityA.userId && otherIdentity.sessionId !== identityA.sessionId, 'independent sessions of same user').toBe(true);

    const initialA = await snapshot(await download(a, identityA.userId));
    const initialB = await snapshot(await download(b, identityB.userId));
    const data = emptyData();
    const accountId = randomUUID();
    data.accounts.push({ id: accountId, name: 'Live synthetic account', type: 'checking', openingBalance: 1234, color: '#123456' });
    const mutation = { userId: identityA.userId, id: randomUUID(), baseVersion: initialA.version, sequence: 1, data };
    expect((await download(anonymous, identityA.userId)).status(), 'anonymous read denied').toBe(401);
    expect((await send(anonymous, 'POST', '/api/sync', mutation)).status(), 'anonymous write denied').toBe(401);
    for (const [client, foreignId] of [[a, identityB.userId], [b, identityA.userId]] as const) {
      expect((await download(client, foreignId)).status(), 'cross-user read denied').toBe(403);
      expect((await send(client, 'POST', '/api/sync', { ...mutation, userId: foreignId })).status(), 'cross-user write denied').toBe(403);
    }
    sameSnapshot(await snapshot(await download(a, identityA.userId)), initialA);
    sameSnapshot(await snapshot(await download(b, identityB.userId)), initialB);

    const uploaded = await snapshot(await send(a, 'POST', '/api/sync', mutation));
    expect(uploaded.version, 'upload increments version once').toBe(initialA.version + 1);
    expect(uploaded.mutationId === mutation.id && JSON.stringify(uploaded.data) === JSON.stringify(data), 'uploaded snapshot preserved').toBe(true);
    sameSnapshot(await snapshot(await download(aOtherSession, identityA.userId)), uploaded);
    sameSnapshot(await snapshot(await send(aOtherSession, 'POST', '/api/sync', mutation)), uploaded);
    sameSnapshot(await snapshot(await download(a, identityA.userId)), uploaded);

    const stale = { ...mutation, id: randomUUID(), sequence: 2, data: emptyData() };
    sameSnapshot(await snapshot(await send(aOtherSession, 'POST', '/api/sync', stale), 409), uploaded);
    sameSnapshot(await snapshot(await download(a, identityA.userId)), uploaded);

    const deletedData = structuredClone(uploaded.data);
    deletedData.accounts = deletedData.accounts.filter(account => account.id !== accountId);
    const deleted = await snapshot(await send(aOtherSession, 'POST', '/api/sync', {
      ...mutation, id: randomUUID(), sequence: 3, baseVersion: uploaded.version, data: deletedData,
    }));
    expect(deleted.version, 'deletion increments version').toBe(uploaded.version + 1);
    expect(JSON.stringify(deleted.data) === JSON.stringify(deletedData), 'deleted snapshot preserved').toBe(true);
    sameSnapshot(await snapshot(await download(a, identityA.userId)), deleted);
    sameSnapshot(await snapshot(await download(b, identityB.userId)), initialB);

    // Replay the pre-signout cookie to prove server revocation, not just cookie clearing.
    const revoked = await safely('Revocation context creation', async () => playwright.request.newContext({
      baseURL: origin, extraHTTPHeaders: { Origin: origin }, timeout: 15_000,
      storageState: await a.storageState(),
    }));
    contexts.push(revoked);
    expect((await send(a, 'POST', '/api/auth/sign-out', {})).status(), 'signout succeeds').toBe(200);
    const revokedSession = await send(revoked, 'GET', '/api/auth/get-session');
    expect(revokedSession.status(), 'revoked session lookup').toBe(200);
    expect((await json(revokedSession)) === null, 'old session no longer exists').toBe(true);
    for (const client of [a, revoked]) {
      expect((await download(client, identityA.userId)).status(), 'signed-out read denied').toBe(401);
      expect((await send(client, 'POST', '/api/sync', { ...mutation, id: randomUUID(), baseVersion: deleted.version })).status(), 'signed-out write denied').toBe(401);
    }
    expect((await session(aOtherSession)).userId === identityA.userId, 'other session remains active').toBe(true);
    sameSnapshot(await snapshot(await download(aOtherSession, identityA.userId)), deleted);
  } finally {
    // Best effort session cleanup only; dispose the entire throwaway DB branch afterward.
    for (const client of contexts) {
      await send(client, 'POST', '/api/auth/sign-out', {}).catch(() => undefined);
      await client.dispose().catch(() => undefined);
    }
  }
});
