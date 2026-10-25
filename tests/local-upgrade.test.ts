import Dexie from 'dexie';
import { expect, it } from 'vitest';
import { AlmondDB, type Workspace } from '@/lib/store';
import { emptyData, sampleData } from '@/lib/finance';

it.each([1, 2])('moves v%s workspaces unchanged, durably isolates old writers, and leaves no legacy user copy', async version => {
  const name = `almond-upgrade-${crypto.randomUUID()}`;
  const legacy = new Dexie(name);
  legacy.version(version).stores({ workspaces: 'id' });
  const data = sampleData();
  data.schedules = [{ id: 'planned', title: 'Planned expense', amount: 100, type: 'expense', accountId: 'cash', categoryId: 'food', frequency: 'monthly', anchorDate: '2023-01-31', nextDue: '2023-02-28' }];
  data.goals = [{ id: 'goal', name: 'Savings', kind: 'saving', currency: 'USD', target: 5000, transactionIds: [] }];
  data.exchangeRates = [{ id: 'rate', source: 'JPY', target: 'USD', rate: '0.005', asOf: '2023-01-01' }];
  data.transactions[0].scheduleId = 'planned';
  data.transactions[0].scheduledFor = '2023-01-31';
  const pendingData = structuredClone(data);
  pendingData.categories[0].name = 'Earlier pending edit';
  const conflictData = structuredClone(data);
  conflictData.categories[0].name = 'Remote conflict';
  const records: Workspace[] = [
    {
      id: 'user:upgrade', data, baseVersion: 3, sequence: 8, dirty: true,
      pending: { id: 'pending-retry', baseVersion: 3, sequence: 7, data: pendingData },
      conflict: { version: 4, mutationId: 'other-device', data: conflictData },
      syncedAt: '2023-01-01T00:00:00.000Z',
    },
    { id: 'local', data: sampleData(), baseVersion: 0, sequence: 0, dirty: false },
    { id: 'user:another', data: emptyData(), baseVersion: 5, sequence: 2, dirty: false },
  ];
  const current = new AlmondDB(name);
  const older = new Dexie(name);
  older.version(1).stores({ workspaces: 'id' });
  try {
    await legacy.open();
    await legacy.table('workspaces').bulkPut(records);
    // Keep an old connection open: Dexie's versionchange handler must close it.
    await current.open();
    expect(legacy.isOpen()).toBe(false);
    expect(current.backendDB().objectStoreNames.contains('workspaces')).toBe(false);
    expect(await current.workspaces.toArray()).toEqual([...records].sort((a, b) => a.id.localeCompare(b.id)));
    current.close();
    await current.open();
    expect(await current.workspaces.toArray()).toEqual([...records].sort((a, b) => a.id.localeCompare(b.id)));

    // Sign-out's public-table deletion cannot leave a migrated legacy copy.
    await current.workspaces.delete('user:another');
    current.close();
    await current.open();
    expect(await current.workspaces.get('user:another')).toBeUndefined();
    expect(Array.from(current.backendDB().objectStoreNames)).toEqual(['workspacesV2']);

    // Dexie 4 recreates the missing old store when opening a newer database.
    // Exercise the real legacy writer: it must never see or replace our data.
    await older.open();
    expect(await older.table('workspaces').count()).toBe(0);
    await older.table('workspaces').put({ ...records[0], data: emptyData() });
    expect(await older.table('workspaces').get(records[0].id)).toMatchObject({ data: emptyData() });
    await current.open();
    expect(await current.workspaces.get(records[0].id)).toEqual(records[0]);
    older.close();
    current.close();
    await current.open();
    expect(await current.workspaces.get(records[0].id)).toEqual(records[0]);
    expect(await current.workspaces.get('local')).toEqual(records[1]);
    expect(await current.workspaces.get('user:another')).toBeUndefined();
  } finally {
    legacy.close(); older.close(); current.close(); await Dexie.delete(name);
  }
});

it('rolls back the copy and removal together on upgrade failure and can retry', async () => {
  const name = `almond-rollback-${crypto.randomUUID()}`;
  const legacy = new Dexie(name);
  legacy.version(1).stores({ workspaces: 'id' });
  const record: Workspace = { id: 'user:retry', data: sampleData(), baseVersion: 2, sequence: 3, dirty: true };
  const failing = new AlmondDB(name);
  failing.version(4).upgrade(() => { throw new Error('Interrupted upgrade'); });
  const retry = new AlmondDB(name);
  try {
    await legacy.table('workspaces').put(record);
    legacy.close();
    await expect(failing.open()).rejects.toThrow('Interrupted upgrade');
    await legacy.open();
    expect(legacy.verno).toBe(1);
    expect(Array.from(legacy.backendDB().objectStoreNames)).toEqual(['workspaces']);
    expect(await legacy.table('workspaces').get(record.id)).toEqual(record);
    legacy.close();
    await retry.open();
    expect(await retry.workspaces.get(record.id)).toEqual(record);
    expect(Array.from(retry.backendDB().objectStoreNames)).toEqual(['workspacesV2']);
  } finally {
    legacy.close(); failing.close(); retry.close(); await Dexie.delete(name);
  }
});

it('creates fresh databases with only the isolated workspace store', async () => {
  const name = `almond-fresh-${crypto.randomUUID()}`;
  const current = new AlmondDB(name);
  try {
    await current.open();
    expect(Array.from(current.backendDB().objectStoreNames)).toEqual(['workspacesV2']);
    expect(current.workspaces.name).toBe('workspacesV2');
  } finally {
    current.close(); await Dexie.delete(name);
  }
});
