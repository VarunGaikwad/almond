import { db } from './store';

export const OFFLINE_ACCOUNT_KEY = 'almond-authenticated-account';
export type WorkspaceAccess =
  | { status: 'ready'; scope: string; online: boolean }
  | { status: 'login' }
  | { status: 'unavailable'; message: string };

// This marker grants local convenience only; every API still authorizes its own session.
export function rememberAccount(scope: string | null) {
  try {
    if (scope) localStorage.setItem(OFFLINE_ACCOUNT_KEY, scope);
    else localStorage.removeItem(OFFLINE_ACCOUNT_KEY);
  } catch { /* Login still works, but offline reopening requires browser storage. */ }
}

export async function checkWorkspaceAccess(signal?: AbortSignal): Promise<WorkspaceAccess> {
  if (!navigator.onLine) {
    try {
      const scope = localStorage.getItem(OFFLINE_ACCOUNT_KEY);
      if (scope?.startsWith('user:') && scope.length > 5 && await db.workspaces.get(scope)) {
        return { status: 'ready', scope, online: false };
      }
    } catch { /* Fail closed when storage is unavailable. */ }
    return { status: 'unavailable', message: 'Connect to the internet to sign in. Offline access is available only after signing in on this browser.' };
  }
  try {
    const response = await fetch('/api/auth/get-session', { cache: 'no-store', credentials: 'same-origin', signal });
    if (response.status === 401) return { status: 'login' };
    if (!response.ok) return { status: 'unavailable', message: 'Sign-in is unavailable. Try again shortly. If you are setting up Almond, configure authentication and the database using README.md.' };
    const session = await response.json();
    if (session === null) return { status: 'login' };
    if (typeof session?.user?.id !== 'string' || !session.user.id || !session.session) throw new Error('Invalid session response');
    return { status: 'ready', scope: `user:${session.user.id}`, online: true };
  } catch {
    // A server or network error while online must not unlock a saved account.
    return { status: 'unavailable', message: 'We could not check your session. Check your connection and try again. Your saved data is unchanged.' };
  }
}
