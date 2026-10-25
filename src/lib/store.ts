import Dexie, { type EntityTable } from 'dexie';
import { postScheduleOccurrence } from './schedules';
import { currencyOf, emptyData, financeSchema, sampleData, type FinanceData } from './finance';

export interface RemoteSnapshot { version: number; data: FinanceData; mutationId: string | null }
export interface PendingSnapshot { id: string; baseVersion: number; data: FinanceData; sequence: number }
export interface Workspace {
  id: string; data: FinanceData; baseVersion: number; sequence: number;
  dirty: boolean; pending?: PendingSnapshot; conflict?: RemoteSnapshot; syncedAt?: string;
}
export class AlmondDB extends Dexie {
  workspaces!: EntityTable<Workspace, 'id'>;
  constructor(name = 'almond-v1') {
    super(name);
    this.version(1).stores({ workspaces: 'id' });
    this.version(2).stores({ workspaces: 'id' });
    // Dexie can reopen newer versions: isolate old writers, not just their version.
    this.version(3).stores({ workspaces: 'id', workspacesV2: 'id' }).upgrade(async tx => {
      const records = await tx.table('workspaces').toArray();
      await tx.table('workspacesV2').bulkPut(records);
    });
    // Copy and removal commit in one IndexedDB upgrade transaction.
    this.version(4).stores({ workspaces: null, workspacesV2: 'id' });
    this.workspaces = this.table('workspacesV2');
  }
}
export const db = new AlmondDB();
export async function ensureWorkspace(id: string) {
  await db.transaction('rw', db.workspaces, async () => {
    if (!await db.workspaces.get(id)) await db.workspaces.add({ id, data: id === 'local' ? sampleData() : emptyData(), baseVersion: 0, sequence: 0, dirty: false });
  });
}
export async function changeData(id: string, change: (data: FinanceData) => void) {
  await db.transaction('rw', db.workspaces, async () => {
    const workspace = await db.workspaces.get(id);
    if (!workspace) throw new Error('Workspace is not ready');
    if (workspace.conflict) throw new Error('Resolve the sync conflict before editing');
    const accountCurrencies = new Map(workspace.data.accounts.map(a => [a.id, currencyOf(a)]));
    change(workspace.data);
    workspace.data = financeSchema.parse(workspace.data);
    for (const account of workspace.data.accounts) {
      if (accountCurrencies.has(account.id) && accountCurrencies.get(account.id) !== currencyOf(account)) throw new Error('An existing account’s currency cannot be changed. Create a new account instead.');
    }
    workspace.sequence++;
    workspace.dirty = true;
    await db.workspaces.put(workspace);
  });
}
// Keep the occurrence captured by the initiating UI, including on retries.
export async function recordPayment(id: string, scheduleId: string, expectedDue: string): Promise<boolean> {
  let posted = false;
  await changeData(id, data => { posted = postScheduleOccurrence(data, scheduleId, expectedDue); });
  return posted;
}
export async function preparePending(id: string): Promise<PendingSnapshot | undefined> {
  return db.transaction('rw', db.workspaces, async () => {
    const w = await db.workspaces.get(id);
    if (!w || w.conflict || !w.dirty) return undefined;
    if (!w.pending) {
      w.pending = { id: crypto.randomUUID(), data: structuredClone(w.data), baseVersion: w.baseVersion, sequence: w.sequence };
      await db.workspaces.put(w);
    }
    return w.pending;
  });
}
export async function acknowledge(id: string, sent: PendingSnapshot, remote: RemoteSnapshot) {
  await db.transaction('rw', db.workspaces, async () => {
    const w = await db.workspaces.get(id);
    if (!w || w.pending?.id !== sent.id) return;
    w.baseVersion = remote.version;
    w.dirty = w.sequence !== sent.sequence;
    w.pending = undefined;
    w.syncedAt = new Date().toISOString();
    await db.workspaces.put(w);
  });
}
export async function receiveRemote(id: string, remote: RemoteSnapshot) {
  const validated = financeSchema.parse(remote.data);
  await db.transaction('rw', db.workspaces, async () => {
    const w = await db.workspaces.get(id);
    if (!w) return;
    if (remote.version < w.baseVersion) return;
    if (w.dirty || w.pending) {
      if (remote.version !== w.baseVersion) w.conflict = { ...remote, data: validated };
    } else {
      w.data = validated;
      w.baseVersion = remote.version;
      w.syncedAt = new Date().toISOString();
    }
    await db.workspaces.put(w);
  });
}
export async function resolveConflict(id: string, choice: 'local' | 'remote') {
  await db.transaction('rw', db.workspaces, async () => {
    const w = await db.workspaces.get(id);
    if (!w?.conflict) return;
    if (choice === 'remote') w.data = w.conflict.data;
    w.baseVersion = w.conflict.version;
    w.pending = undefined;
    w.conflict = undefined;
    w.sequence++;
    w.dirty = choice === 'local';
    await db.workspaces.put(w);
  });
}
