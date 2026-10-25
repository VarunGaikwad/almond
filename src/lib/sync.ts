import { z } from 'zod';
import { financeSchema } from './finance';
import { SYNC_PROTOCOL_HEADER, SYNC_PROTOCOL_VERSION, syncProtocolHeaders } from './data-format';
import { acknowledge, db, preparePending, receiveRemote } from './store';

const remoteSchema = z.object({ version: z.number().int().nonnegative(), data: financeSchema, mutationId: z.string().nullable() });
const flights = new Map<string, Promise<void>>();
async function responseData(response: Response) {
  if (response.status === 401 || response.status === 403) {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('almond-auth-required'));
    throw new Error('Sign in again to sync. Your offline changes are safe.');
  }
  if (response.status === 426 || ((response.ok || response.status === 409) && response.headers.get(SYNC_PROTOCOL_HEADER) !== String(SYNC_PROTOCOL_VERSION))) {
    throw new Error('Sync requires a compatible Almond upgrade. Your offline changes are safe.');
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
  // Keep the durable retry identity even if the compatibility handshake fails.
  await preparePending(scope);
  const download = () => fetch(`/api/sync?userId=${encodeURIComponent(scope.slice(5))}`, { cache: 'no-store', headers: syncProtocolHeaders });
  const handshake = await download();
  const snapshot = await responseData(handshake);
  if (!handshake.ok) throw new Error('Could not establish sync compatibility. Your offline changes are safe.');
  // Do not receive the handshake over pending edits: a lost acknowledgement must retry first.
  let uploaded = false;
  for (let i = 0; i < 5; i++) {
    const pending = await preparePending(scope);
    if (!pending) break;
    const response = await fetch('/api/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...syncProtocolHeaders },
      body: JSON.stringify({ ...pending, userId: scope.slice(5) }),
    });
    const remote = await responseData(response);
    if (response.status === 409) { await receiveRemote(scope, remote); return; }
    await acknowledge(scope, pending, remote);
    uploaded = true;
  }
  if ((await db.workspaces.get(scope))?.conflict) return;
  if (!uploaded) { await receiveRemote(scope, snapshot); return; }
  await receiveRemote(scope, await responseData(await download()));
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
