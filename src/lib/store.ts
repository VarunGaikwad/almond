import Dexie, { type EntityTable } from 'dexie';
import { emptyData, financeSchema, sampleData, type FinanceData } from './finance';

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
    change(workspace.data);
    workspace.data = financeSchema.parse(workspace.data);
    workspace.sequence++;
    workspace.dirty = true;
    await db.workspaces.put(workspace);
  });
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
