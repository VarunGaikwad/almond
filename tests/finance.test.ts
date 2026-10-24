import { describe, expect, it } from 'vitest';
import { accountBalance, categorySpending, currentMonth, dateSchema, emptyData, financeSchema, parseMoney, sampleData, totals } from '@/lib/finance';

describe('exact money', () => {
  it.each([['0.01', 1], ['10.29', 1029], ['123456.78', 12345678], ['1', 100], ['0', 0]])('parses %s without rounding errors', (input, expected) => expect(parseMoney(input)).toBe(expected));
  it.each(['1.005', 'NaN', 'Infinity', '1e3', '-1', '1,000', '', '1000000001'])('rejects invalid money %s', input => expect(() => parseMoney(input)).toThrow());
  it('allows negative opening balances only explicitly', () => expect(parseMoney('-12.50', true)).toBe(-1250));
});
describe('financial invariants', () => {
  it('validates sample and empty workspaces', () => { expect(financeSchema.safeParse(sampleData()).success).toBe(true); expect(financeSchema.safeParse(emptyData()).success).toBe(true); });
  it('preserves combined balances during transfers and excludes transfers from income/expenses', () => {
    const data = sampleData();
    const before = totals(data, currentMonth());
    const source = accountBalance(data, 'checking'); const destination = accountBalance(data, 'savings');
    data.transactions.push({ id: 'test-transfer', type: 'transfer', title: 'Savings', amount: 12345, accountId: 'checking', toAccountId: 'savings', date: `${currentMonth()}-01` });
    expect(financeSchema.safeParse(data).success).toBe(true);
    expect(accountBalance(data, 'checking')).toBe(source - 12345);
    expect(accountBalance(data, 'savings')).toBe(destination + 12345);
    expect(totals(data, currentMonth())).toEqual(before);
  });
  it('rejects unknown accounts and categories', () => {
    const data = sampleData(); data.transactions[0].accountId = 'missing'; expect(financeSchema.safeParse(data).success).toBe(false);
    const next = sampleData(); next.budgets[0].categoryId = 'missing'; expect(financeSchema.safeParse(next).success).toBe(false);
  });
  it('rejects duplicate IDs, duplicate category budgets and invalid transfer destinations', () => {
    const data = sampleData(); data.accounts.push(data.accounts[0]); expect(financeSchema.safeParse(data).success).toBe(false);
    const next = sampleData(); next.budgets.push({ ...next.budgets[0], id: 'duplicate' }); expect(financeSchema.safeParse(next).success).toBe(false);
    const third = sampleData(); const transfer = third.transactions.find(t => t.type === 'transfer')!; transfer.toAccountId = transfer.accountId; expect(financeSchema.safeParse(third).success).toBe(false);
  });
  it('rejects impossible dates but allows leap days', () => {
    expect(dateSchema.safeParse('2025-02-29').success).toBe(false); expect(dateSchema.safeParse('2024-02-29').success).toBe(true);
    expect(dateSchema.safeParse('2025-04-31').success).toBe(false);
  });
  it('keeps reporting months separate', () => {
    const data = sampleData(); expect(totals(data, '2000-01').income).toBe(0); expect(categorySpending(data, '2000-01', 'food')).toBe(0);
  });
  it('rejects fractional and nonpositive transaction amounts', () => {
    for (const amount of [0, -100, 12.5, Number.MAX_SAFE_INTEGER]) { const data = sampleData(); data.transactions[0].amount = amount; expect(financeSchema.safeParse(data).success).toBe(false); }
  });
});
