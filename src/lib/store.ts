import Dexie, { type EntityTable } from 'dexie';
import { postScheduleOccurrence } from './schedules';
import { currencyOf, emptyData, fxQuoteSchema, normalizeFinanceData, primaryAccount, sampleData, type FinanceData, type FxQuote } from './finance';

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
    this.version(5).stores({ workspacesV2: 'id', workspacesV3: 'id' }).upgrade(async tx => {
      const records = await tx.table('workspacesV2').toArray() as Workspace[];
      for (const record of records) {
        record.data = normalizeFinanceData(record.data);
        if (record.pending) record.pending.data = normalizeFinanceData(record.pending.data);
        if (record.conflict) record.conflict.data = normalizeFinanceData(record.conflict.data);
      }
      await tx.table('workspacesV3').bulkPut(records);
    });
    this.version(6).stores({ workspacesV2: null, workspacesV3: 'id' });
    this.workspaces = this.table('workspacesV3');
  }
}
export const db = new AlmondDB();
export async function ensureWorkspace(id: string) {
  await db.transaction('rw', db.workspaces, async () => {
    if (!await db.workspaces.get(id)) await db.workspaces.add({ id, data: id === 'local' ? sampleData() : emptyData(), baseVersion: 0, sequence: 0, dirty: false });
  });
}
export async function changeData(id: string, change: (data: FinanceData) => void, options: { restore?: boolean } = {}) {
  await db.transaction('rw', db.workspaces, async () => {
    const workspace = await db.workspaces.get(id);
    if (!workspace) throw new Error('Workspace is not ready');
    if (workspace.conflict) throw new Error('Resolve the sync conflict before editing');
    const before = structuredClone(workspace.data);
    const accountCurrencies = new Map(before.accounts.map(a => [a.id, currencyOf(a)]));
    // A false result is an explicit no-op (e.g. an already-applied quote batch).
    const result: unknown = change(workspace.data);
    if (result === false) return;
    const previousPrimary = primaryAccount(before);
    if (!options.restore && previousPrimary && workspace.data.accounts.length && workspace.data.primaryAccountId === before.primaryAccountId) {
      const current = workspace.data.accounts.find(a => a.id === previousPrimary.id);
      if (!current || (current.archived && !previousPrimary.archived)) throw new Error('Select a replacement primary account first.');
    }
    const previousTransactions = new Map(before.transactions.map(t => [t.id, t]));
    // A confirmed full backup restore owns its snapshots, including reused IDs.
    for (const transaction of options.restore ? [] : workspace.data.transactions) {
      const previous = previousTransactions.get(transaction.id);
      if (!previous) continue;
      if (transaction.date !== previous.date || transaction.accountId !== previous.accountId) delete transaction.fx;
      else if (previous.fx) transaction.fx = previous.fx;
    }
    // Removing the last unused account is allowed to leave an empty workspace.
    if (!workspace.data.accounts.length) delete workspace.data.primaryAccountId;
    workspace.data = normalizeFinanceData(workspace.data);
    for (const account of workspace.data.accounts) {
      if (accountCurrencies.has(account.id) && accountCurrencies.get(account.id) !== currencyOf(account)) throw new Error('An existing account’s currency cannot be changed. Create a new account instead.');
    }
    workspace.sequence++;
    workspace.dirty = true;
    await db.workspaces.put(workspace);
  });
}
/** Quotes are fetched outside this transaction; matching and missing checks are atomic. */
export async function applyTransactionQuotes(workspaceId: string, quotes: FxQuote[]): Promise<void> {
  const validated = quotes.map(quote => fxQuoteSchema.parse(quote));
  await changeData(workspaceId, data => {
    let changed = false;
    for (const transaction of data.transactions) {
      if (transaction.fx) continue;
      const source = currencyOf(data.accounts.find(a => a.id === transaction.accountId));
      const quote = validated.find(q => q.source === source && q.date === transaction.date);
      if (quote) { transaction.fx = structuredClone(quote); changed = true; }
    }
    return changed;
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
  const validated = normalizeFinanceData(remote.data);
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
    w.data = normalizeFinanceData(choice === 'remote' ? w.conflict.data : w.data);
    w.baseVersion = w.conflict.version;
    w.pending = undefined;
    w.conflict = undefined;
    w.sequence++;
    w.dirty = choice === 'local';
    await db.workspaces.put(w);
  });
}
