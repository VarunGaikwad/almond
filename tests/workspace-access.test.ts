import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkWorkspaceAccess, OFFLINE_ACCOUNT_KEY, rememberAccount } from '@/lib/workspace-access';
import { db, ensureWorkspace } from '@/lib/store';

beforeEach(async () => {
  await db.workspaces.clear();
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe('workspace access', () => {
  it('requires a server session online, ignoring the old saved workspace ID', async () => {
    localStorage.setItem('almond-workspace', 'user:old');
    rememberAccount('user:old');
    vi.mocked(fetch).mockResolvedValue(Response.json(null));
    expect(await checkWorkspaceAccess()).toEqual({ status: 'login' });
    expect(fetch).toHaveBeenCalledWith('/api/auth/get-session', expect.objectContaining({ cache: 'no-store', credentials: 'same-origin' }));
  });
  it('uses the server account rather than a different remembered account', async () => {
    rememberAccount('user:old');
    vi.mocked(fetch).mockResolvedValue(Response.json({ user: { id: 'new' }, session: { id: 'session' } }));
    expect(await checkWorkspaceAccess()).toEqual({ status: 'ready', scope: 'user:new', online: true });
  });
  it.each([401, 503, 500])('does not grant offline access for HTTP %i online', async status => {
    await ensureWorkspace('user:old'); rememberAccount('user:old');
    vi.mocked(fetch).mockResolvedValue(Response.json({}, { status }));
    expect((await checkWorkspaceAccess()).status).toBe(status === 401 ? 'login' : 'unavailable');
  });
  it('does not fall back on an online network error or malformed response', async () => {
    await ensureWorkspace('user:old'); rememberAccount('user:old');
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Network failed')).mockResolvedValueOnce(Response.json({ user: { id: 'bad' } }));
    expect((await checkWorkspaceAccess()).status).toBe('unavailable');
    expect((await checkWorkspaceAccess()).status).toBe('unavailable');
  });
  it('opens only an existing, previously authenticated workspace offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    await ensureWorkspace('user:old');
    localStorage.setItem('almond-workspace', 'user:old');
    expect((await checkWorkspaceAccess()).status).toBe('unavailable');
    rememberAccount('local');
    expect((await checkWorkspaceAccess()).status).toBe('unavailable');
    rememberAccount('user:missing');
    expect((await checkWorkspaceAccess()).status).toBe('unavailable');
    rememberAccount('user:old');
    expect(await checkWorkspaceAccess()).toEqual({ status: 'ready', scope: 'user:old', online: false });
    expect(fetch).not.toHaveBeenCalled();
    rememberAccount(null);
    expect(localStorage.getItem(OFFLINE_ACCOUNT_KEY)).toBeNull();
    expect((await checkWorkspaceAccess()).status).toBe('unavailable');
    expect(await db.workspaces.get('user:old')).toBeDefined();
  });
  it('fails closed when browser storage cannot be read', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('Denied'); } });
    expect((await checkWorkspaceAccess()).status).toBe('unavailable');
  });
});
