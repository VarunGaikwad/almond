'use client';

import { useEffect, useState } from 'react';
import { checkWorkspaceAccess, OFFLINE_ACCOUNT_KEY, rememberAccount, type WorkspaceAccess } from '@/lib/workspace-access';
import { ensureWorkspace } from '@/lib/store';
import AlmondApp from './almond-app';
import AuthPage from './auth-page';
import { AlmondMark } from './ui';

export default function WorkspaceGate({ mode = 'workspace' }: { mode?: 'workspace' | 'login' | 'register' }) {
  const [access, setAccess] = useState<WorkspaceAccess | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    try { document.documentElement.dataset.theme = localStorage.getItem('almond-theme') === 'dark' ? 'dark' : 'light'; } catch { /* Optional preference. */ }
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => {});
    let active = true;
    let generation = 0;
    let controller: AbortController | undefined;
    async function check() {
      const current = ++generation;
      controller?.abort();
      controller = new AbortController();
      let next = await checkWorkspaceAccess(controller.signal);
      if (!active || current !== generation) return;
      if (next.status === 'ready' && next.online) {
        try { await ensureWorkspace(next.scope); }
        catch { next = { status: 'unavailable', message: 'Almond needs browser storage. Enable IndexedDB or use a regular browser window, then try again.' }; }
      }
      if (!active || current !== generation) return;
      if (next.status === 'login') rememberAccount(null);
      if (next.status === 'ready' && next.online) rememberAccount(next.scope);
      setAccess(next);
      if (next.status === 'ready' && mode !== 'workspace') window.location.replace('/');
      if (next.status !== 'ready' && mode === 'workspace') window.location.replace('/login');
    }
    const reconnect = () => { setAccess(null); void check(); };
    const foreground = () => { if (document.visibilityState === 'visible') void check(); };
    const storage = (event: StorageEvent) => {
      if (event.key === OFFLINE_ACCOUNT_KEY || event.key === null) { setAccess(null); void check(); }
    };
    const expired = () => {
      // A 401/403 from sync is authoritative; never fall back to offline access.
      ++generation; controller?.abort(); rememberAccount(null); setAccess({ status: 'login' });
      window.location.replace('/login');
    };
    void check();
    window.addEventListener('online', reconnect);
    window.addEventListener('storage', storage);
    if (mode === 'workspace') {
      window.addEventListener('focus', foreground);
      window.addEventListener('almond-auth-required', expired);
      document.addEventListener('visibilitychange', foreground);
    }
    const timer = mode === 'workspace' ? setInterval(foreground, 60_000) : undefined;
    return () => {
      active = false; controller?.abort(); clearInterval(timer);
      window.removeEventListener('online', reconnect); window.removeEventListener('storage', storage);
      window.removeEventListener('focus', foreground); window.removeEventListener('almond-auth-required', expired);
      document.removeEventListener('visibilitychange', foreground);
    };
  }, [mode, attempt]);

  if (access?.status === 'ready' && mode === 'workspace') return <AlmondApp key={access.scope} scope={access.scope} configured={access.online} onSignedOut={() => { rememberAccount(null); setAccess({ status: 'login' }); window.location.replace('/login'); }}/>;
  if (mode !== 'workspace' && access && access.status !== 'ready') return <AuthPage mode={mode} unavailable={access.status === 'unavailable' ? access.message : undefined} onRetry={() => { setAccess(null); setAttempt(value => value + 1); }}/>;
  return <main className="startup" role="status"><AlmondMark/><h1>Making a little room…</h1><p>Checking access to your Almond workspace.</p></main>;
}
