import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changeData, db, ensureWorkspace, type PendingSnapshot } from '@/lib/store';
import { syncWorkspace } from '@/lib/sync';
import { emptyData } from '@/lib/finance';
import { syncProtocolHeaders, SYNC_PROTOCOL_HEADER } from '@/lib/data-format';
const scope = 'user:sync-test';
const initial = () => ({ version: 0, data: emptyData(), mutationId: null as string | null });
const response = (body: unknown, status = 200) => Response.json(body, { status, headers: syncProtocolHeaders });
beforeEach(async () => { await db.workspaces.clear(); await ensureWorkspace(scope); });
afterEach(() => vi.unstubAllGlobals());
describe('sync transport', () => {
  it('retries a lost acknowledgement without receiving the handshake over pending edits', async () => {
    await changeData(scope, d => { d.categories[0].name = 'New'; });
    let applied = initial();
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get(SYNC_PROTOCOL_HEADER)).toBe('3');
      if (init?.method === 'POST') {
        const payload = JSON.parse(String(init.body)); seen.push(payload.id);
        if (seen.length === 1) { applied = { version: 1, data: payload.data, mutationId: payload.id }; throw new Error('Connection lost after commit'); }
      }
      return response(applied);
    }));
    await expect(syncWorkspace(scope)).rejects.toThrow('Connection lost');
    expect((await db.workspaces.get(scope))?.pending).toBeDefined();
    await syncWorkspace(scope);
    expect(seen).toHaveLength(2); expect(seen[0]).toBe(seen[1]);
    const w = await db.workspaces.get(scope);
    expect(w?.dirty).toBe(false); expect(w?.conflict).toBeUndefined(); expect(w?.data.categories[0].name).toBe('New');
  });
  it.each([undefined, '1', '2'])('refuses an incompatible server (%s) before POST and keeps pending', async protocol => {
    await changeData(scope, d => { d.categories[0].name = 'Private'; });
    const fetch = vi.fn(async () => Response.json(initial(), { headers: protocol ? { [SYNC_PROTOCOL_HEADER]: protocol } : {} }));
    vi.stubGlobal('fetch', fetch);
    await expect(syncWorkspace(scope)).rejects.toThrow('upgrade');
    expect(fetch).toHaveBeenCalledTimes(1);
    const w = await db.workspaces.get(scope);
    expect(w?.pending).toBeDefined(); expect(w?.dirty).toBe(true); expect(w?.data.categories[0].name).toBe('Private');
  });
  it.each([200, 409])('does not acknowledge or receive an incompatible POST response (%s)', async status => {
    await changeData(scope, d => { d.categories[0].name = 'Private'; });
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST'
      ? Response.json({ ...initial(), version: 3 }, { status, headers: { [SYNC_PROTOCOL_HEADER]: '2' } }) : response(initial())));
    await expect(syncWorkspace(scope)).rejects.toThrow('upgrade');
    const w = await db.workspaces.get(scope);
    expect(w?.pending).toBeDefined(); expect(w?.dirty).toBe(true); expect(w?.conflict).toBeUndefined(); expect(w?.baseVersion).toBe(0);
  });
  it.each([200, 409])('checks response compatibility before JSON parsing (%s)', async status => {
    await changeData(scope, d => { d.categories[0].name = 'Private'; });
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST'
      ? new Response('not JSON', { status }) : response(initial())));
    await expect(syncWorkspace(scope)).rejects.toThrow('upgrade');
    expect((await db.workspaces.get(scope))?.pending).toBeDefined();
  });
  it('keeps edits made during the handshake and an in-flight POST', async () => {
    await changeData(scope, d => { d.categories[0].name = 'First'; });
    let applied = initial();
    const sent: PendingSnapshot[] = [];
    let gets = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const payload = JSON.parse(String(init.body)); sent.push(payload);
        if (sent.length === 1) await changeData(scope, d => { d.categories[0].name = 'During POST'; });
        applied = { version: applied.version + 1, data: payload.data, mutationId: payload.id };
      } else if (++gets === 1) await changeData(scope, d => { d.categories[0].name = 'During handshake'; });
      return response(applied);
    }));
    await syncWorkspace(scope);
    expect(sent.map(p => p.data.categories[0].name)).toEqual(['First', 'During POST']);
    expect(sent[0].id).not.toBe(sent[1].id); expect(sent[1].baseVersion).toBe(1);
    const w = await db.workspaces.get(scope);
    expect(w?.dirty).toBe(false); expect(w?.data.categories[0].name).toBe('During POST');
  });
  it.each([401, 403])('keeps pending edits and locks even without protocol on auth errors (%s)', async status => {
    await changeData(scope, d => { d.categories[0].name = 'Private'; });
    const dispatchEvent = vi.fn(); vi.stubGlobal('window', { dispatchEvent });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, { status })));
    await expect(syncWorkspace(scope)).rejects.toThrow('Sign in again');
    expect(dispatchEvent.mock.calls[0][0].type).toBe('almond-auth-required');
    const w = await db.workspaces.get(scope); expect(w?.dirty).toBe(true); expect(w?.pending).toBeDefined(); expect(w?.data.categories[0].name).toBe('Private');
  });
  it('preserves both workspaces on a version conflict', async () => {
    await changeData(scope, d => { d.categories[0].name = 'Local edit'; });
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => response({ version: 2, data: emptyData(), mutationId: 'another-device' }, init?.method === 'POST' ? 409 : 200)));
    await syncWorkspace(scope);
    const w = await db.workspaces.get(scope); expect(w?.conflict?.version).toBe(2); expect(w?.data.categories[0].name).toBe('Local edit');
  });
  it('does not send the local sample workspace to the server', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); await syncWorkspace('local'); expect(fetch).not.toHaveBeenCalled();
  });
  it('coalesces concurrent sync calls', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(initial())));
    const first = syncWorkspace(scope); const second = syncWorkspace(scope); expect(first).toBe(second); await first;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
