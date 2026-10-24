import { z } from 'zod';
import { financeSchema } from './finance';
import { acknowledge, db, preparePending, receiveRemote } from './store';

const remoteSchema = z.object({ version: z.number().int().nonnegative(), data: financeSchema, mutationId: z.string().nullable() });
const flights = new Map<string, Promise<void>>();
async function responseData(response: Response) {
  if (response.status === 401 || response.status === 403) {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('almond-auth-required'));
    throw new Error('Sign in again to sync. Your offline changes are safe.');
  }
  if (response.status === 503) throw new Error('Cloud sync is not configured on this server.');
  if (!response.ok && response.status !== 409) {
    const details = await response.json().catch(() => null);
    const message = typeof details?.error === 'string' ? details.error : 'Could not sync';
    throw new Error(`${message}. Your changes are saved on this device.`);
  }
  return remoteSchema.parse(await response.json());
}
async function performSync(scope: string) {
  // Flush pending snapshots first: a lost acknowledgement must not look like a conflict.
  for (let i = 0; i < 5; i++) {
    const pending = await preparePending(scope);
    if (!pending) break;
    const response = await fetch('/api/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...pending, userId: scope.slice(5) }),
    });
    const remote = await responseData(response);
    if (response.status === 409) { await receiveRemote(scope, remote); return; }
    await acknowledge(scope, pending, remote);
  }
  if ((await db.workspaces.get(scope))?.conflict) return;
  const response = await fetch(`/api/sync?userId=${encodeURIComponent(scope.slice(5))}`, { cache: 'no-store' });
  await receiveRemote(scope, await responseData(response));
}
export function syncWorkspace(scope: string): Promise<void> {
  if (!scope.startsWith('user:')) return Promise.resolve();
  const existing = flights.get(scope);
  if (existing) return existing;
  const run = async () => {
    // Also serialize requests across tabs; IndexedDB still guards every local mutation.
    if (typeof navigator !== 'undefined' && navigator.locks) {
      await navigator.locks.request(`almond-sync:${scope}`, () => performSync(scope));
    } else await performSync(scope);
  };
  const promise = run().finally(() => flights.delete(scope));
  flights.set(scope, promise);
  return promise;
}
