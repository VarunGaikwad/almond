import { beforeEach, describe, expect, it } from 'vitest';
import { acknowledge, changeData, db, ensureWorkspace, preparePending, receiveRemote, resolveConflict } from '@/lib/store';
import { emptyData, sampleData } from '@/lib/finance';

const scope = 'user:test-user';
beforeEach(async () => { await db.workspaces.clear(); await ensureWorkspace(scope); });
async function editName(name: string) { await changeData(scope, data => { data.categories[0].name = name; }); }
describe('durable offline state', () => {
  it('never seeds sample data into a personal workspace', async () => {
    expect((await db.workspaces.get(scope))?.data.transactions).toEqual([]);
    await ensureWorkspace('local'); expect((await db.workspaces.get('local'))?.data.transactions.length).toBeGreaterThan(0);
  });
  it('does not reset saved data when reopened', async () => {
    await editName('Coffee'); await ensureWorkspace(scope); expect((await db.workspaces.get(scope))?.data.categories[0].name).toBe('Coffee');
  });
  it('rolls back invalid edits without changing sequence', async () => {
    await expect(changeData(scope, data => { data.categories.push(data.categories[0]); })).rejects.toThrow();
    expect((await db.workspaces.get(scope))?.sequence).toBe(0);
    expect((await db.workspaces.get(scope))?.data).toEqual(emptyData());
  });
  it('serializes concurrent edits', async () => {
    await Promise.all([changeData(scope, d => { d.categories[0].name = 'A'; }), changeData(scope, d => { d.categories[1].name = 'B'; })]);
    const w = await db.workspaces.get(scope); expect(w?.sequence).toBe(2); expect(w?.data.categories[0].name).toBe('A'); expect(w?.data.categories[1].name).toBe('B');
  });
  it('reuses a stable pending snapshot after further local edits', async () => {
    await editName('Before'); const first = (await preparePending(scope))!;
    await editName('After'); const retry = (await preparePending(scope))!;
    expect(retry.id).toBe(first.id); expect(retry.data.categories[0].name).toBe('Before');
    await acknowledge(scope, first, { version: 1, data: first.data, mutationId: first.id });
    const w = await db.workspaces.get(scope); expect(w?.data.categories[0].name).toBe('After'); expect(w?.dirty).toBe(true); expect(w?.baseVersion).toBe(1);
    const next = (await preparePending(scope))!; expect(next.id).not.toBe(first.id); expect(next.baseVersion).toBe(1); expect(next.data.categories[0].name).toBe('After');
  });
  it('marks exactly acknowledged edits as clean', async () => {
    await editName('Coffee'); const pending = (await preparePending(scope))!;
    await acknowledge(scope, pending, { version: 1, data: pending.data, mutationId: pending.id });
    expect((await db.workspaces.get(scope))?.dirty).toBe(false); expect((await db.workspaces.get(scope))?.pending).toBeUndefined();
  });
  it('preserves local edits when a remote update races a download', async () => {
    await editName('My edit'); await receiveRemote(scope, { version: 2, data: sampleData(), mutationId: 'remote' });
    const w = await db.workspaces.get(scope); expect(w?.data.categories[0].name).toBe('My edit'); expect(w?.conflict?.version).toBe(2);
    await ensureWorkspace(scope); expect((await db.workspaces.get(scope))?.conflict?.data.transactions.length).toBeGreaterThan(0);
    await expect(editName('Not yet')).rejects.toThrow('Resolve');
  });
  it('explicitly keeps local changes against the newer remote version', async () => {
    await editName('Local'); await receiveRemote(scope, { version: 3, data: sampleData(), mutationId: 'remote' });
    await resolveConflict(scope, 'local'); const w = await db.workspaces.get(scope);
    expect(w?.data.categories[0].name).toBe('Local'); expect(w?.dirty).toBe(true); expect(w?.baseVersion).toBe(3); expect(w?.conflict).toBeUndefined();
  });
  it('explicitly accepts the cloud copy', async () => {
    await editName('Local'); const remote = sampleData(); await receiveRemote(scope, { version: 3, data: remote, mutationId: 'remote' });
    await resolveConflict(scope, 'remote'); const w = await db.workspaces.get(scope);
    expect(w?.data).toEqual(remote); expect(w?.dirty).toBe(false); expect(w?.baseVersion).toBe(3);
  });
  it('rejects malformed remote data and ignores old downloads', async () => {
    await receiveRemote(scope, { version: 3, data: sampleData(), mutationId: 'r' });
    await receiveRemote(scope, { version: 1, data: emptyData(), mutationId: 'old' });
    expect((await db.workspaces.get(scope))?.baseVersion).toBe(3);
    const invalid = sampleData(); invalid.transactions[0].amount = -1;
    await expect(receiveRemote(scope, { version: 4, data: invalid, mutationId: 'bad' })).rejects.toThrow();
    expect((await db.workspaces.get(scope))?.baseVersion).toBe(3);
  });
});
