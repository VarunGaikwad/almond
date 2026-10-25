import { beforeEach, describe, expect, it } from 'vitest';
import { currencyOf, deleteTransaction, financeSchema, sampleData, type Budget, type FinanceData, type Goal } from '@/lib/finance';
import { budgetOverlapsMonth, budgetProgress, budgetRange } from '@/lib/budgets';
import { goalProgress, saveGoal } from '@/lib/goals';
import { changeData, db, ensureWorkspace, preparePending, receiveRemote } from '@/lib/store';

function fixture(): FinanceData {
  const data = sampleData(); data.budgets = []; data.transactions = [
    { id: 'first', title: 'Groceries', amount: 1000, type: 'expense', accountId: 'checking', categoryId: 'food', date: '2023-01-31' },
    { id: 'last', title: 'Shopping', amount: 2000, type: 'expense', accountId: 'checking', categoryId: 'shopping', date: '2023-02-06' },
    { id: 'outside', title: 'Outside', amount: 4000, type: 'expense', accountId: 'checking', categoryId: 'food', date: '2023-02-07' },
    { id: 'income', title: 'Pay', amount: 9000, type: 'income', accountId: 'checking', categoryId: 'income', date: '2023-01-31' },
  ];
  data.accounts.push({ id: 'yen', name: 'Yen', currency: 'JPY', type: 'cash', openingBalance: 0, color: '#123456' });
  data.transactions.push({ ...data.transactions[0], id: 'foreign', accountId: 'yen', amount: 500 });
  data.schedules = [{ id: 'planned', title: 'Not posted', amount: 9999, type: 'expense', accountId: 'checking', categoryId: 'food', frequency: 'once', anchorDate: '2023-01-31', nextDue: '2023-01-31' }];
  return data;
}
const budget: Budget = { id: 'range', categoryIds: ['food', 'shopping'], amount: 10000, startDate: '2023-01-31', endDate: '2023-02-06' };
const goal: Goal = { id: 'goal', name: 'Rainy day', kind: 'saving', currency: 'USD', target: 20000, transactionIds: ['income'], targetDate: '2024-01-01' };
beforeEach(async () => { await db.workspaces.clear(); });
describe('flexible budgets and goals', () => {
  it('preserves legacy snapshots exactly and calculates historical monthly periods', () => {
    const data = sampleData(); expect(financeSchema.parse(data)).toEqual(data);
    const monthly: Budget = { id: 'old', month: '2023-02', categoryId: 'food', amount: 10000 };
    expect(budgetRange(monthly)).toEqual(['2023-02-01', '2023-02-28']);
    expect(budgetProgress(fixture(), monthly)).toBe(4000);
    expect(budgetRange({ ...monthly, month: '2024-02' })[1]).toBe('2024-02-29');
  });
  it('includes both boundaries, aggregates categories and excludes schedules, other currencies and accounts', () => {
    const data = fixture(); data.budgets = [budget]; expect(financeSchema.parse(data)).toEqual(data);
    expect(budgetProgress(data, budget)).toBe(3000);
    expect(budgetProgress(data, budget, 'cash')).toBe(0);
    expect(budgetOverlapsMonth(budget, '2023-01')).toBe(true);
    expect(budgetOverlapsMonth(budget, '2023-02')).toBe(true);
    expect(budgetOverlapsMonth(budget, '2023-03')).toBe(false);
    expect(budgetProgress(data, { ...budget, endDate: budget.startDate })).toBe(1000);
  });
  it('selected postings restrict rather than extend range/category/currency matching', () => {
    expect(budgetProgress(fixture(), { ...budget, transactionIds: ['first', 'outside'] })).toBe(1000);
    expect(budgetProgress(fixture(), { ...budget, transactionIds: [] })).toBe(0);
  });
  it('derives saving from income and spending from expenses, with no duplicate counting', () => {
    const data = fixture(); expect(goalProgress(data, goal)).toBe(9000);
    expect(goalProgress(data, goal, 'cash')).toBe(0);
    expect(goalProgress(data, { ...goal, kind: 'spending', transactionIds: ['first', 'last'] })).toBe(3000);
    expect(goalProgress(data, { ...goal, transactionIds: ['income', 'income'] })).toBe(9000);
  });
  it('rejects invalid periods, duplicate links, wrong types/currencies and dangling references', () => {
    for (const patch of [{ endDate: '2023-01-30' }, { endDate: undefined }, { categoryIds: ['food', 'food'] }, { transactionIds: ['first', 'first'] }, { transactionIds: ['foreign'] }, { transactionIds: ['income'] }, { transactionIds: ['missing'] }]) {
      const data = fixture(); data.budgets = [{ ...budget, ...patch }]; expect(financeSchema.safeParse(data).success).toBe(false);
    }
    for (const transactionIds of [['first'], ['foreign'], ['missing'], ['income', 'income']]) {
      const data = fixture(); data.goals = [{ ...goal, transactionIds }]; expect(financeSchema.safeParse(data).success).toBe(false);
    }
    for (const target of [0, -1, 1.5]) { const data = fixture(); data.goals = [{ ...goal, target }]; expect(financeSchema.safeParse(data).success).toBe(false); }
  });
  it('saves, restores and deletes linked postings atomically through store APIs', async () => {
    const data = fixture(); data.budgets = [{ ...budget, transactionIds: ['first', 'last'] }]; saveGoal(data, goal);
    saveGoal(data, { ...goal, name: 'Updated' }); expect(data.goals).toHaveLength(1);
    const parsed = financeSchema.parse(JSON.parse(JSON.stringify(data)));
    await ensureWorkspace('source'); await changeData('source', d => Object.assign(d, parsed));
    await ensureWorkspace('source'); const pending = (await preparePending('source'))!;
    await ensureWorkspace('restored'); await receiveRemote('restored', { data: pending.data, version: 1, mutationId: null });
    expect((await db.workspaces.get('restored'))?.data).toEqual(parsed);
    await changeData('restored', d => { deleteTransaction(d, 'first'); deleteTransaction(d, 'income'); });
    const restored = (await db.workspaces.get('restored'))!.data;
    expect(restored.goals![0].transactionIds).toEqual([]); expect(restored.budgets[0].transactionIds).toEqual(['last']);
    expect(goalProgress(restored, restored.goals![0])).toBe(0); expect(budgetProgress(restored, restored.budgets[0])).toBe(2000);
    expect(financeSchema.parse(restored)).toEqual(restored);
    expect(currencyOf(restored.accounts.find(a => a.id === 'yen'))).toBe('JPY'); expect(restored.schedules).toEqual(data.schedules);
    const before = await db.workspaces.get('restored');
    await expect(changeData('restored', d => { d.transactions = []; })).rejects.toThrow();
    expect(await db.workspaces.get('restored')).toEqual(before);
  });
});
