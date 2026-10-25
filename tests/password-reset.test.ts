import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { memoryAdapter } from 'better-auth/adapters/memory';

vi.mock('better-auth/adapters/drizzle', () => ({ drizzleAdapter: () => memoryAdapter({ user: [], session: [], account: [], verification: [], rateLimit: [] }) }));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost/test');
  vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000');
  vi.stubEnv('BETTER_AUTH_SECRET', 'a-test-secret-that-is-at-least-32-characters-long');
  vi.stubEnv('RESEND_API_KEY', 'test-key');
  vi.stubEnv('AUTH_EMAIL_FROM', 'Almond <hello@example.com>');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('delivers a one-use reset, enforces length, revokes sessions and hides unknown accounts', async () => {
  const delivery = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', delivery);
  const { getAuth } = await import('@/lib/server/auth');
  const auth = getAuth();
  const email = 'test@example.com';
  const original = 'original-password';
  await auth.api.signUpEmail({ body: { name: 'Test', email, password: original } });
  const session = await auth.api.signInEmail({ body: { email, password: original } });
  const request = { email, redirectTo: 'http://localhost:3000/reset-password' };
  const known = await auth.api.requestPasswordReset({ body: request });
  expect(delivery).toHaveBeenCalledOnce();
  const [endpoint, options] = delivery.mock.calls[0];
  expect(endpoint).toBe('https://api.resend.com/emails');
  expect(options.headers.Authorization).toBe('Bearer test-key');
  const message = JSON.parse(options.body);
  expect(message.to).toEqual([email]);
  const url = new URL(message.text.split('\n')[2]);
  expect(url.searchParams.get('callbackURL')).toBe(request.redirectTo);
  const token = url.pathname.split('/').at(-1)!;
  const unknown = await auth.api.requestPasswordReset({ body: { ...request, email: 'unknown@example.com' } });
  expect(unknown).toEqual(known);
  expect(delivery).toHaveBeenCalledOnce();
  await expect(auth.api.resetPassword({ body: { token, newPassword: 'short' } })).rejects.toThrow();
  await expect(auth.api.resetPassword({ body: { token: 'invalid', newPassword: 'replacement-password' } })).rejects.toThrow();
  await auth.api.resetPassword({ body: { token, newPassword: 'replacement-password' } });
  await expect(auth.api.resetPassword({ body: { token, newPassword: 'another-password' } })).rejects.toThrow();
  await expect(auth.api.signInEmail({ body: { email, password: original } })).rejects.toThrow();
  await expect(auth.api.signInEmail({ body: { email, password: 'replacement-password' } })).resolves.toMatchObject({ user: { email } });
  const context = await auth.$context;
  expect(await context.internalAdapter.findSession(session.token)).toBeNull();
  await auth.api.requestPasswordReset({ body: request });
  const expiredUrl = new URL(JSON.parse(delivery.mock.calls[1][1].body).text.split('\n')[2]);
  const expiredToken = expiredUrl.pathname.split('/').at(-1)!;
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(new Date(Date.now() + 3601_000));
    await expect(auth.api.resetPassword({ body: { token: expiredToken, newPassword: 'another-password' } })).rejects.toThrow();
  } finally { vi.useRealTimers(); }
  // Better Auth skips origin checks by default under Vitest; exercise the production guard.
  context.skipOriginCheck = false;
  const response = await auth.handler(new Request('http://localhost:3000/api/auth/request-password-reset', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify({ email, redirectTo: 'https://attacker.example/reset' }),
  }));
  expect(response.status).toBe(403);
});

it.each([
  [403, JSON.stringify({ name: 'validation_error', message: 'private@example.com https://example.com/reset?token=secret' }), ', validation_error'],
  [401, JSON.stringify({ name: 'invalid_api_key', message: 'Bearer private-key' }), ', invalid_api_key'],
  [429, JSON.stringify({ name: 'rate_limit_exceeded' }), ', rate_limit_exceeded'],
  [500, JSON.stringify({ name: 'private@example.com', message: 'private-key' }), ''],
  [502, '<html>private-key</html>', ''],
  [500, 'null', ''],
])('reports safe delivery diagnostics for HTTP %s', async (status, body, code) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status })));
  const { sendPasswordResetEmail } = await import('@/lib/server/password-email');
  const error = await sendPasswordResetEmail({
    user: { email: 'private@example.com' }, url: 'https://example.com/reset?token=secret',
  }).catch((error: unknown) => error);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe(`Password recovery email could not be sent (Resend HTTP ${status}${code})`);
});

it('fails safely when delivery is unavailable or unconfigured', async () => {
  const delivery = vi.fn().mockResolvedValue(new Response('provider details', { status: 500 }));
  vi.stubGlobal('fetch', delivery);
  const { sendPasswordResetEmail } = await import('@/lib/server/password-email');
  await expect(sendPasswordResetEmail({ user: { email: 'test@example.com' }, url: 'https://example.com/reset' })).rejects.toThrow('Password recovery email could not be sent');
  vi.stubEnv('RESEND_API_KEY', '');
  delivery.mockClear();
  await expect(sendPasswordResetEmail({ user: { email: 'test@example.com' }, url: 'https://example.com/reset' })).rejects.toThrow('not configured');
  expect(delivery).not.toHaveBeenCalled();
});
