import type { Page } from '@playwright/test';
import { sampleData, type FinanceData } from '../../src/lib/finance';
import { SYNC_PROTOCOL_HEADER, SYNC_PROTOCOL_VERSION, syncProtocolHeaders } from '../../src/lib/data-format';

// Browser transport fixtures only; these do not prove a live Better Auth/Neon deployment.
export async function mockCloud(page: Page, signedIn = true, initialData: FinanceData = sampleData()) {
  const state = { userId: signedIn ? 'browser-test' as string | null : null, sessionStatus: 200, data: initialData, version: 0, registrationError: false };
  const user = () => ({ id: state.userId, name: 'Test User', email: 'test@example.com', emailVerified: false });
  await page.route('**/api/auth/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/get-session')) {
      await route.fulfill({ status: state.sessionStatus, json: state.userId ? { user: user(), session: { id: 'test-session', userId: state.userId, expiresAt: '2099-01-01T00:00:00.000Z' } } : null });
    } else if (path.endsWith('/sign-out')) {
      state.userId = null;
      await route.fulfill({ json: { success: true } });
    } else if (path.endsWith('/sign-in/email') || path.endsWith('/sign-up/email')) {
      const payload = route.request().postDataJSON();
      if (payload.password === 'wrong-password' || state.registrationError) {
        await route.fulfill({ status: 400, json: { code: 'INVALID_CREDENTIALS', message: state.registrationError ? 'Unable to create account.' : 'Invalid email or password.' } });
      } else {
        state.userId = 'browser-test';
        await route.fulfill({ json: { user: user(), token: 'test-token' } });
      }
    } else await route.abort();
  });
  await page.route('**/api/sync*', async route => {
    if (route.request().headers()[SYNC_PROTOCOL_HEADER.toLowerCase()] !== String(SYNC_PROTOCOL_VERSION)) {
      await route.fulfill({ status: 426, headers: syncProtocolHeaders, json: { error: 'Upgrade Almond to sync safely' } }); return;
    }
    if (!state.userId) { await route.fulfill({ status: 401, headers: syncProtocolHeaders, json: { error: 'Sign in to sync' } }); return; }
    const payload = route.request().method() === 'POST' ? route.request().postDataJSON() : null;
    const userId = payload?.userId ?? new URL(route.request().url()).searchParams.get('userId');
    if (userId !== state.userId) { await route.fulfill({ status: 403, headers: syncProtocolHeaders, json: { error: 'Workspace does not match session' } }); return; }
    if (payload) { state.data = payload.data; state.version++; }
    await route.fulfill({ headers: syncProtocolHeaders, json: { data: state.data, version: state.version, mutationId: payload?.id ?? null } });
  });
  return state;
}
