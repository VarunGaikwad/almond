import Dexie from 'dexie';
import { expect, it } from 'vitest';
import { AlmondDB, type Workspace } from '@/lib/store';
import { emptyData, sampleData } from '@/lib/finance';

it.each([1, 2, 4])('moves v%s workspaces with primary defaults, durably isolates old writers, and leaves no legacy user copy', async version => {
  const name = `almond-upgrade-${crypto.randomUUID()}`;
  const legacy = new Dexie(name);
  const legacyStore = version === 4 ? 'workspacesV2' : 'workspaces';
  legacy.version(version).stores({ [legacyStore]: 'id' });
  const data = sampleData();
  delete data.primaryAccountId;
  data.schedules = [{ id: 'planned', title: 'Planned expense', amount: 100, type: 'expense', accountId: 'cash', categoryId: 'food', frequency: 'monthly', anchorDate: '2023-01-31', nextDue: '2023-02-28' }];
  data.goals = [{ id: 'goal', name: 'Savings', kind: 'saving', currency: 'USD', target: 5000, transactionIds: [] }];
  data.exchangeRates = [{ id: 'rate', source: 'JPY', target: 'USD', rate: '0.005', asOf: '2023-01-01' }];
  data.transactions[0].scheduleId = 'planned';
  data.transactions[0].scheduledFor = '2023-01-31';
  data.transactions[0].fx = { source: 'USD', date: data.transactions[0].date, asOf: data.transactions[0].date, rates: { USD: '1', JPY: '150', INR: '83' } };
  const pendingData = structuredClone(data);
  pendingData.categories[0].name = 'Earlier pending edit';
  pendingData.primaryAccountId = 'savings';
  const conflictData = structuredClone(data);
  conflictData.categories[0].name = 'Remote conflict';
  conflictData.primaryAccountId = 'cash';
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
  const expected = structuredClone(records);
  for (const record of expected) {
    for (const snapshot of [record.data, record.pending?.data, record.conflict?.data]) {
      if (snapshot?.accounts.length && !snapshot.primaryAccountId) snapshot.primaryAccountId = 'checking';
    }
  }
  const current = new AlmondDB(name);
  const older = new Dexie(name);
  older.version(version).stores({ [legacyStore]: 'id' });
  try {
    await legacy.open();
    await legacy.table(legacyStore).bulkPut(records);
    // Keep an old connection open: Dexie's versionchange handler must close it.
    await current.open();
    expect(legacy.isOpen()).toBe(false);
    expect(current.backendDB().objectStoreNames.contains(legacyStore)).toBe(false);
    expect(await current.workspaces.toArray()).toEqual([...expected].sort((a, b) => a.id.localeCompare(b.id)));
    current.close();
    await current.open();
    expect(await current.workspaces.toArray()).toEqual([...expected].sort((a, b) => a.id.localeCompare(b.id)));

    // Sign-out's public-table deletion cannot leave a migrated legacy copy.
    await current.workspaces.delete('user:another');
    current.close();
    await current.open();
    expect(await current.workspaces.get('user:another')).toBeUndefined();
    expect(Array.from(current.backendDB().objectStoreNames)).toEqual(['workspacesV3']);

    // Dexie 4 recreates the missing old store when opening a newer database.
    // Exercise the real legacy writer: it must never see or replace our data.
    await older.open();
    expect(await older.table(legacyStore).count()).toBe(0);
    await older.table(legacyStore).put({ ...records[0], data: emptyData() });
    expect(await older.table(legacyStore).get(records[0].id)).toMatchObject({ data: emptyData() });
    await current.open();
    expect(await current.workspaces.get(records[0].id)).toEqual(expected[0]);
    older.close();
    current.close();
    await current.open();
    expect(await current.workspaces.get(records[0].id)).toEqual(expected[0]);
    expect(await current.workspaces.get('local')).toEqual(expected[1]);
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
  failing.version(6).upgrade(() => { throw new Error('Interrupted upgrade'); });
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
    expect(Array.from(retry.backendDB().objectStoreNames)).toEqual(['workspacesV3']);
  } finally {
    legacy.close(); failing.close(); retry.close(); await Dexie.delete(name);
  }
});

it('creates fresh databases with only the isolated workspace store', async () => {
  const name = `almond-fresh-${crypto.randomUUID()}`;
  const current = new AlmondDB(name);
  try {
    await current.open();
    expect(Array.from(current.backendDB().objectStoreNames)).toEqual(['workspacesV3']);
    expect(current.workspaces.name).toBe('workspacesV3');
  } finally {
    current.close(); await Dexie.delete(name);
  }
});
