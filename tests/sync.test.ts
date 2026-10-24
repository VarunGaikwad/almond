import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changeData, db, ensureWorkspace } from '@/lib/store';
import { syncWorkspace } from '@/lib/sync';
import { emptyData } from '@/lib/finance';
const scope = 'user:sync-test';
beforeEach(async () => { await db.workspaces.clear(); await ensureWorkspace(scope); });
afterEach(() => vi.unstubAllGlobals());
describe('sync transport', () => {
  it('retries a lost acknowledgement without creating a new mutation', async () => {
    await changeData(scope, d => { d.categories[0].name = 'New'; });
    let applied: { version: number; data: ReturnType<typeof emptyData>; mutationId: string } | undefined;
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const payload = JSON.parse(String(init.body)); seen.push(payload.id);
        if (!applied) { applied = { version: 1, data: payload.data, mutationId: payload.id }; throw new Error('Connection lost after commit'); }
      }
      return Response.json(applied);
    }));
    await expect(syncWorkspace(scope)).rejects.toThrow('Connection lost');
    expect((await db.workspaces.get(scope))?.pending).toBeDefined();
    await syncWorkspace(scope);
    expect(seen).toHaveLength(2); expect(seen[0]).toBe(seen[1]); expect((await db.workspaces.get(scope))?.dirty).toBe(false);
  });
  it('keeps pending edits when authentication expires', async () => {
    await changeData(scope, d => { d.categories[0].name = 'Private'; });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, { status: 401 })));
    await expect(syncWorkspace(scope)).rejects.toThrow('Sign in again');
    const w = await db.workspaces.get(scope); expect(w?.dirty).toBe(true); expect(w?.pending).toBeDefined(); expect(w?.data.categories[0].name).toBe('Private');
  });
  it('preserves both workspaces on a version conflict', async () => {
    await changeData(scope, d => { d.categories[0].name = 'Local edit'; });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ version: 2, data: emptyData(), mutationId: 'another-device' }, { status: 409 })));
    await syncWorkspace(scope);
    const w = await db.workspaces.get(scope); expect(w?.conflict?.version).toBe(2); expect(w?.data.categories[0].name).toBe('Local edit');
  });
  it('does not send the local sample workspace to the server', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); await syncWorkspace('local'); expect(fetch).not.toHaveBeenCalled();
  });
  it('coalesces concurrent sync calls', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ version: 0, data: emptyData(), mutationId: null })));
    const first = syncWorkspace(scope); const second = syncWorkspace(scope); expect(first).toBe(second); await first;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
