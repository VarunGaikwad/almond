import { describe, expect, it } from 'vitest';
import { accountBalance, categorySpending, currencyOf, dataForCurrency, financeSchema, money, moneyInput, parseMoney, sampleData, totals } from '@/lib/finance';

function mixedData() {
  const data = sampleData();
  data.accounts.push(
    { id: 'yen', name: 'Yen wallet', currency: 'JPY', type: 'cash', color: '#123456', openingBalance: 5000 },
    { id: 'rupees', name: 'Rupee wallet', currency: 'INR', type: 'cash', color: '#123456', openingBalance: 10000 },
  );
  const date = data.transactions[0].date;
  data.transactions.push(
    { id: 'yen-expense', title: 'Lunch', type: 'expense', accountId: 'yen', categoryId: 'food', amount: 500, date },
    { id: 'rupee-income', title: 'Pay', type: 'income', accountId: 'rupees', categoryId: 'income', amount: 12550, date },
  );
  return data;
}

describe('account currencies', () => {
  it('preserves old USD records and backups without changing their amounts', () => {
    const legacy = sampleData();
    const restored = financeSchema.parse(JSON.parse(JSON.stringify(legacy)));
    expect(restored).toEqual(legacy);
    expect(currencyOf(restored.accounts[0])).toBe('USD');
    expect(currencyOf(restored.budgets[0])).toBe('USD');
  });
  it('uses whole yen and exact paise, including negative opening balances', () => {
    expect(parseMoney('1234', false, 'JPY')).toBe(1234);
    expect(parseMoney('-1234', true, 'JPY')).toBe(-1234);
    expect(() => parseMoney('12.50', false, 'JPY')).toThrow('whole yen');
    expect(parseMoney('1234.56', false, 'INR')).toBe(123456);
    expect(parseMoney('-12.50', true, 'INR')).toBe(-1250);
    expect(() => parseMoney('12.345', false, 'INR')).toThrow();
    expect(money(1234, 'JPY')).toBe('¥1,234');
    expect(money(123456, 'INR')).toBe('₹1,234.56');
    expect(moneyInput(1234, 'JPY')).toBe('1234');
    expect(moneyInput(123456, 'INR')).toBe('1234.56');
  });
  it('never combines different currencies in balances, income or category spending', () => {
    const data = mixedData();
    const month = data.transactions[0].date.slice(0, 7);
    expect(financeSchema.safeParse(data).success).toBe(true);
    expect(totals(data, month)).toEqual(totals(sampleData(), month));
    expect(totals(data, month, 'JPY')).toEqual({ balance: 4500, income: 0, expense: 500, saved: -500 });
    expect(totals(data, month, 'INR')).toEqual({ balance: 22550, income: 12550, expense: 0, saved: 12550 });
    expect(categorySpending(data, month, 'food', 'JPY')).toBe(500);
    expect(categorySpending(data, month, 'food', 'INR')).toBe(0);
    expect(dataForCurrency(data, 'JPY').transactions.map(t => t.id)).toEqual(['yen-expense']);
  });
  it('rejects cross-currency transfers and preserves same-currency transfer balances', () => {
    const data = mixedData();
    const transfer = { id: 'yen-transfer', title: 'Move yen', type: 'transfer' as const, accountId: 'yen', toAccountId: 'rupees', amount: 100, date: data.transactions[0].date };
    data.transactions.push(transfer);
    expect(financeSchema.safeParse(data).success).toBe(false);
    data.accounts.push({ ...data.accounts.find(a => a.id === 'yen')!, id: 'yen-bank', openingBalance: 0 });
    transfer.toAccountId = 'yen-bank';
    expect(financeSchema.safeParse(data).success).toBe(true);
    expect(accountBalance(data, 'yen')).toBe(4400);
    expect(accountBalance(data, 'yen-bank')).toBe(100);
  });
  it('scopes duplicate budgets to currency and rejects unsupported currencies', () => {
    const data = mixedData();
    data.budgets.push({ ...data.budgets[0], id: 'yen-budget', currency: 'JPY' });
    expect(financeSchema.safeParse(data).success).toBe(true);
    data.budgets.push({ ...data.budgets[0], id: 'usd-duplicate', currency: 'USD' });
    expect(financeSchema.safeParse(data).success).toBe(false);
    expect(financeSchema.safeParse({ ...sampleData(), accounts: [{ ...sampleData().accounts[0], currency: 'EUR' }] }).success).toBe(false);
  });
});
