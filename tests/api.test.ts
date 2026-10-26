import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ configured: vi.fn(), session: vi.fn(), database: vi.fn() }));
vi.mock('@/lib/server/auth', () => ({ cloudConfigured: mocks.configured, getAuth: () => ({ api: { getSession: mocks.session } }), getDatabase: mocks.database }));
import { GET, POST } from '@/app/api/sync/route';
import { emptyData } from '@/lib/finance';
import { SYNC_PROTOCOL_HEADER, syncProtocolHeaders } from '@/lib/data-format';
beforeEach(() => { vi.resetAllMocks(); mocks.configured.mockReturnValue(true); mocks.session.mockResolvedValue({ user: { id: 'owner' } }); vi.stubEnv('BETTER_AUTH_URL', 'https://almond.example'); });
afterEach(() => vi.unstubAllEnvs());
function request(body: unknown, origin = 'https://almond.example') { return new Request('https://almond.example/api/sync', { method: 'POST', headers: { origin, 'content-type': 'application/json', ...syncProtocolHeaders }, body: JSON.stringify(body) }); }
describe('sync API trust boundaries', () => {
  it.each([undefined, '1', '2', '4'])('blocks old/mismatched clients (%s) without reading or writing workspace', async protocol => {
    const headers = protocol ? { [SYNC_PROTOCOL_HEADER]: protocol } : undefined;
    const get = await GET(new Request('https://almond.example/api/sync?userId=owner', { headers }));
    const postRequest = request({ userId: 'owner', id: crypto.randomUUID(), baseVersion: 0, sequence: 1, data: emptyData() });
    postRequest.headers.delete(SYNC_PROTOCOL_HEADER);
    if (protocol) postRequest.headers.set(SYNC_PROTOCOL_HEADER, protocol);
    const post = await POST(postRequest);
    expect(postRequest.bodyUsed).toBe(false);
    for (const response of [get, post]) {
      expect(response.status).toBe(426); expect(response.headers.get(SYNC_PROTOCOL_HEADER)).toBe('3');
    }
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it('annotates successful downloads and rejects unknown financial fields before writes', async () => {
    const row = { version: 0, data: emptyData(), mutationId: null };
    mocks.database.mockReturnValue({
      insert: () => ({ values: () => ({ onConflictDoNothing: async () => undefined }) }),
      select: () => ({ from: () => ({ where: async () => [row] }) }),
    });
    const response = await GET(new Request('https://almond.example/api/sync?userId=owner', { headers: syncProtocolHeaders }));
    expect(response.status).toBe(200); expect(response.headers.get(SYNC_PROTOCOL_HEADER)).toBe('3');
    expect(await response.json()).toEqual(row);
    mocks.database.mockClear();
    const rejected = await POST(request({ userId: 'owner', id: crypto.randomUUID(), baseVersion: 0, sequence: 1, data: { ...emptyData(), futureFeature: [] } }));
    expect(rejected.status).toBe(400); expect(rejected.headers.get(SYNC_PROTOCOL_HEADER)).toBe('3');
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it.each(['duplicate', 'updated', 'conflict'] as const)('annotates %s POST snapshots', async outcome => {
    const id = crypto.randomUUID();
    const row = { version: 1, data: emptyData(), mutationId: outcome === 'duplicate' ? id : 'other' };
    const updated = { ...row, version: 2, mutationId: id };
    const update = vi.fn(() => ({ set: () => ({ where: () => ({ returning: async () => outcome === 'updated' ? [updated] : [] }) }) }));
    mocks.database.mockReturnValue({
      insert: () => ({ values: () => ({ onConflictDoNothing: async () => undefined }) }),
      select: () => ({ from: () => ({ where: async () => [row] }) }), update,
    });
    const result = await POST(request({ userId: 'owner', id, baseVersion: 0, sequence: 1, data: emptyData() }));
    expect(result.status).toBe(outcome === 'conflict' ? 409 : 200);
    expect(result.headers.get(SYNC_PROTOCOL_HEADER)).toBe('3');
    expect(await result.json()).toEqual(outcome === 'updated' ? updated : row);
    if (outcome === 'duplicate') expect(update).not.toHaveBeenCalled();
  });
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
