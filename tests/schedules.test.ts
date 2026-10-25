import { beforeEach, describe, expect, it } from 'vitest';
import { accountBalance, deleteAccount, emptyData, financeSchema, setAccountArchived, type Schedule } from '../src/lib/finance';
import { nextOccurrence, saveSchedule } from '../src/lib/schedules';
import { changeData, db, ensureWorkspace, preparePending, receiveRemote, recordPayment } from '../src/lib/store';

const schedule = (overrides: Partial<Schedule> = {}): Schedule => ({ id: 'rent', title: 'Rent', type: 'expense', accountId: 'bank', categoryId: 'home', amount: 12501, frequency: 'monthly', anchorDate: '2023-01-31', nextDue: '2023-01-31', ...overrides });
const data = () => ({ ...emptyData(), accounts: [{ id: 'bank', name: 'Bank', type: 'checking' as const, currency: 'INR' as const, color: '#123456', openingBalance: 50000 }], schedules: [schedule()] });

describe('schedule dates and schema', () => {
  it('clamps monthly dates without losing the original anchor, including year rollover', () => {
    const s = schedule();
    s.nextDue = nextOccurrence(s); expect(s.nextDue).toBe('2023-02-28');
    s.nextDue = nextOccurrence(s); expect(s.nextDue).toBe('2023-03-31');
    expect(nextOccurrence(schedule({ nextDue: '2023-12-31' }))).toBe('2024-01-31');
    expect(nextOccurrence(schedule({ anchorDate: '2024-01-31', nextDue: '2024-01-31' }))).toBe('2024-02-29');
  });
  it('retains leap-day yearly anchors', () => {
    const s = schedule({ frequency: 'yearly', anchorDate: '2024-02-29', nextDue: '2024-02-29' });
    for (const expected of ['2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']) {
      s.nextDue = nextOccurrence(s); expect(s.nextDue).toBe(expected);
    }
  });
  it('advances daily/weekly across year boundaries, stops inclusively at end dates and completes one-time', () => {
    expect(nextOccurrence(schedule({ frequency: 'daily', nextDue: '2023-12-31' }))).toBe('2024-01-01');
    expect(nextOccurrence(schedule({ frequency: 'weekly', nextDue: '2023-12-31' }))).toBe('2024-01-07');
    const s = schedule({ endDate: '2023-02-28' });
    s.nextDue = nextOccurrence(s); expect(s.nextDue).toBe('2023-02-28');
    expect(nextOccurrence(s)).toBeNull();
    expect(nextOccurrence(schedule({ frequency: 'once' }))).toBeNull();
  });
  it('accepts legacy records and validates references, dates and integer minor units', () => {
    expect(financeSchema.parse(emptyData())).toEqual(emptyData());
    const d = data(); expect(financeSchema.parse(d)).toEqual(d);
    d.schedules[0].amount = 1.5; expect(financeSchema.safeParse(d).success).toBe(false);
    d.schedules[0] = schedule({ accountId: 'missing' }); expect(financeSchema.safeParse(d).success).toBe(false);
    d.schedules[0] = schedule({ categoryId: 'missing' }); expect(financeSchema.safeParse(d).success).toBe(false);
    d.schedules[0] = schedule({ endDate: '2023-01-30' }); expect(financeSchema.safeParse(d).success).toBe(false);
    d.schedules[0] = schedule({ nextDue: '2023-02-30' }); expect(financeSchema.safeParse(d).success).toBe(false);
  });
  it('protects accounts referenced by schedules and prevents assigning new schedules to archived accounts', () => {
    const d = data(); expect(() => deleteAccount(d, 'bank')).toThrow('schedules');
    setAccountArchived(d, 'bank', true);
    expect(financeSchema.safeParse(d).success).toBe(true); // Archived history/plans remain readable.
    expect(() => saveSchedule(d, schedule({ id: 'new' }))).toThrow('archived');
    expect(() => saveSchedule(d, schedule({ title: 'Updated' }))).not.toThrow();
  });
});

describe('atomic schedule payments and persistence', () => {
  const scope = 'schedule-test';
  beforeEach(async () => {
    await db.delete(); await db.open(); await ensureWorkspace(scope);
    await changeData(scope, current => Object.assign(current, data()));
  });
  it('posts exactly once for concurrent calls and stale retries, advancing just one occurrence', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => recordPayment(scope, 'rent', '2023-01-31')));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await recordPayment(scope, 'rent', '2023-01-31')).toBe(false);
    const w = (await db.workspaces.get(scope))!;
    expect(w.data.transactions).toHaveLength(1);
    expect(w.data.transactions[0]).toMatchObject({ amount: 12501, date: '2023-01-31', scheduleId: 'rent', scheduledFor: '2023-01-31' });
    expect(w.data.schedules?.[0].nextDue).toBe('2023-02-28');
    expect(accountBalance(w.data, 'bank')).toBe(37499);
  });
  it('does not post into archived accounts and rolls back failed changes', async () => {
    await changeData(scope, d => setAccountArchived(d, 'bank', true));
    await expect(recordPayment(scope, 'rent', '2023-01-31')).rejects.toThrow('archived');
    const w = (await db.workspaces.get(scope))!;
    expect(w.data.transactions).toHaveLength(0); expect(w.data.schedules?.[0].nextDue).toBe('2023-01-31');
  });
  it('counts only posted transactions and completes a one-time income', async () => {
    await changeData(scope, d => saveSchedule(d, schedule({ frequency: 'once', type: 'income' })));
    expect(accountBalance((await db.workspaces.get(scope))!.data, 'bank')).toBe(50000);
    await recordPayment(scope, 'rent', '2023-01-31');
    const d = (await db.workspaces.get(scope))!.data;
    expect(accountBalance(d, 'bank')).toBe(62501); expect(d.schedules?.[0].nextDue).toBeNull();
    expect(await recordPayment(scope, 'rent', '2023-01-31')).toBe(false);
  });
  it('round trips schedules and occurrence references through persistence, snapshots and JSON backups', async () => {
    await recordPayment(scope, 'rent', '2023-01-31');
    const pending = (await preparePending(scope))!;
    const backup = JSON.stringify({ format: 'almond', version: 1, data: pending.data });
    const restored = financeSchema.parse(JSON.parse(backup).data);
    expect(restored).toEqual(pending.data);
    await db.close(); await db.open();
    expect((await db.workspaces.get(scope))?.pending?.data).toEqual(restored);
    await ensureWorkspace('schedule-remote');
    await receiveRemote('schedule-remote', { version: 1, data: restored, mutationId: pending.id });
    expect((await db.workspaces.get('schedule-remote'))?.data).toEqual(restored);
    expect(await recordPayment('schedule-remote', 'rent', '2023-01-31')).toBe(false);
  });
});
