import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ configured: vi.fn(), session: vi.fn(), database: vi.fn() }));
vi.mock('@/lib/server/auth', () => ({ cloudConfigured: mocks.configured, getAuth: () => ({ api: { getSession: mocks.session } }), getDatabase: mocks.database }));
import { GET, POST } from '@/app/api/sync/route';
import { emptyData } from '@/lib/finance';
beforeEach(() => { vi.resetAllMocks(); mocks.configured.mockReturnValue(true); mocks.session.mockResolvedValue({ user: { id: 'owner' } }); vi.stubEnv('BETTER_AUTH_URL', 'https://almond.example'); });
afterEach(() => vi.unstubAllEnvs());
function request(body: unknown, origin = 'https://almond.example') { return new Request('https://almond.example/api/sync', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
describe('sync API trust boundaries', () => {
  it('returns a clear unavailable response without configuration', async () => { mocks.configured.mockReturnValue(false); expect((await GET(new Request('https://almond.example/api/sync'))).status).toBe(503); expect(mocks.database).not.toHaveBeenCalled(); });
  it('requires a real session', async () => { mocks.session.mockResolvedValue(null); expect((await GET(new Request('https://almond.example/api/sync?userId=owner'))).status).toBe(401); expect((await POST(request({}))).status).toBe(401); });
  it('rejects cross-origin writes before querying the database', async () => { expect((await POST(request({}, 'https://attacker.example'))).status).toBe(403); expect(mocks.database).not.toHaveBeenCalled(); });
  it('rejects a mismatched user even if the body is valid', async () => {
    expect((await GET(new Request('https://almond.example/api/sync?userId=victim'))).status).toBe(403);
    expect((await POST(request({ userId: 'victim', id: crypto.randomUUID(), sequence: 1, baseVersion: 0, data: emptyData() }))).status).toBe(403);
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it('rejects invalid money before querying the database', async () => {
    const data = emptyData(); data.accounts.push({ id: 'a', name: 'A', type: 'cash', color: '#123456', openingBalance: 1.5 });
    expect((await POST(request({ userId: 'owner', id: crypto.randomUUID(), sequence: 1, baseVersion: 0, data }))).status).toBe(400); expect(mocks.database).not.toHaveBeenCalled();
  });
  it('limits the actual request size, including missing Content-Length', async () => { expect((await POST(request({ padding: 'x'.repeat(2_000_001) }))).status).toBe(413); expect(mocks.database).not.toHaveBeenCalled(); });
});
