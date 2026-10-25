import { describe, expect, it } from 'vitest';
import { convertMinorUnits, exchangeReport, isRateStale, rateAgeDays } from '@/lib/exchange';
import { emptyData, exchangeRateSchema, financeSchema, localDate, sampleData, type Currency, type ExchangeRate } from '@/lib/finance';

const today = localDate();
const rate = (source: Currency = 'USD', target: Currency = 'JPY', value = '150.25'): ExchangeRate => ({ id: `${source}-${target}`, source, target, rate: value, asOf: today });
function fixture() {
  const data = emptyData();
  data.accounts = [
    { id: 'usd', name: 'Dollars', type: 'cash', color: '#123456', openingBalance: 10000 },
    { id: 'jpy', name: 'Yen', currency: 'JPY', archived: true, type: 'cash', color: '#123456', openingBalance: 1000 },
    { id: 'inr', name: 'Rupees', currency: 'INR', type: 'cash', color: '#123456', openingBalance: 10000 },
  ];
  data.transactions = [
    { id: 'income', title: 'Pay', type: 'income', accountId: 'jpy', categoryId: 'income', amount: 500, date: '2025-01-01' },
    { id: 'expense', title: 'Food', type: 'expense', accountId: 'inr', categoryId: 'food', amount: 2000, date: '2025-01-02' },
    { id: 'old', title: 'Earlier', type: 'income', accountId: 'usd', categoryId: 'income', amount: 100, date: '2024-12-31' },
  ];
  data.exchangeRates = [rate('JPY', 'USD', '0.01'), rate('INR', 'USD', '0.02')];
  return data;
}

describe('exact manual conversions', () => {
  it('handles all directed USD/JPY/INR minor-unit combinations', () => {
    expect(convertMinorUnits(100, rate())).toBe(150);
    expect(convertMinorUnits(200, rate())).toBe(301);
    expect(convertMinorUnits(1, rate('JPY', 'USD', '0.00666667'))).toBe(1);
    expect(convertMinorUnits(123, rate('USD', 'INR', '83.125'))).toBe(10224);
    expect(convertMinorUnits(100, rate('INR', 'USD', '0.012'))).toBe(1);
    expect(convertMinorUnits(100, rate('INR', 'JPY', '1.8'))).toBe(2);
    expect(convertMinorUnits(1, rate('JPY', 'INR', '0.55'))).toBe(55);
  });
  it('rounds half away from zero, including tiny and negative values', () => {
    for (const sign of [1, -1]) {
      expect(convertMinorUnits(sign, rate('USD', 'JPY', '50'))).toBe(sign);
      expect(convertMinorUnits(sign, rate('USD', 'INR', '0.5'))).toBe(sign);
      expect(convertMinorUnits(sign, rate('USD', 'INR', '0.49999999'))).toBe(0);
    }
    expect(convertMinorUnits(0, rate())).toBe(0);
    expect(convertMinorUnits(1, rate('USD', 'INR', '0.00000001'))).toBe(0);
  });
  it('uses BigInt intermediates and rejects unsafe input/output', () => {
    expect(convertMinorUnits(Number.MAX_SAFE_INTEGER, rate('USD', 'INR', '1'))).toBe(Number.MAX_SAFE_INTEGER);
    expect(convertMinorUnits(-Number.MAX_SAFE_INTEGER, rate('USD', 'INR', '1'))).toBe(-Number.MAX_SAFE_INTEGER);
    expect(convertMinorUnits(100_000_000_000, rate('USD', 'INR', '1.00000001'))).toBe(100_000_001_000);
    expect(() => convertMinorUnits(Number.MAX_SAFE_INTEGER + 1, rate())).toThrow('safe integer');
    expect(() => convertMinorUnits(1.5, rate())).toThrow('safe integer');
    expect(() => convertMinorUnits(Number.MAX_SAFE_INTEGER, rate('USD', 'INR', '2'))).toThrow('safe integer');
    expect(() => convertMinorUnits(100_000_000_000n, rate('USD', 'INR', '999999999999'))).toThrow('safe integer');
  });
});

describe('validation and preservation', () => {
  it.each(['0', '0.00000000', '-1', '1e2', 'Infinity', 'NaN', '.5', '1.', ' 1', '1.123456789', '1000000000000'])('rejects invalid decimal %s', value => {
    expect(exchangeRateSchema.safeParse(rate('USD', 'JPY', value)).success).toBe(false);
  });
  it('rejects invalid/future dates, currencies, identity, duplicate pairs and IDs at the boundary', () => {
    for (const patch of [{ asOf: '2025-02-30' }, { asOf: '9999-12-31' }, { source: 'EUR' }, { target: 'USD' }, { id: '' }]) {
      expect(exchangeRateSchema.safeParse({ ...rate(), ...patch }).success).toBe(false);
    }
    const data = fixture();
    data.exchangeRates!.push({ ...data.exchangeRates![0], id: 'duplicate' });
    expect(financeSchema.safeParse(data).success).toBe(false);
    data.exchangeRates = [rate(), { ...rate('INR', 'USD'), id: rate().id }];
    expect(financeSchema.safeParse(data).success).toBe(false);
  });
  it('accepts legacy backups and preserves optional collections and original ledger amounts', () => {
    const legacy = sampleData();
    expect(financeSchema.parse(JSON.parse(JSON.stringify(legacy)))).toEqual(legacy);
    const data = fixture();
    data.goals = [{ id: 'goal', name: 'Trip', kind: 'saving', currency: 'JPY', target: 1000, transactionIds: ['income'] }];
    data.schedules = [{ id: 'schedule', title: 'Rent', type: 'expense', accountId: 'inr', categoryId: 'home', amount: 100, frequency: 'monthly', anchorDate: '2025-01-01', nextDue: '2025-02-01' }];
    data.budgets.push({ id: 'flex', categoryIds: ['food'], amount: 100, currency: 'INR', startDate: '2025-01-01', endDate: '2025-02-01', transactionIds: ['expense'] });
    const before = JSON.stringify(data);
    exchangeReport(data, '2025-01', 'USD');
    expect(JSON.stringify(data)).toBe(before);
    expect(financeSchema.parse(JSON.parse(before))).toEqual(data);
    data.transactions.push({ id: 'cross', title: 'Transfer', type: 'transfer', accountId: 'usd', toAccountId: 'jpy', amount: 1, date: today });
    expect(financeSchema.safeParse(data).success).toBe(false);
  });
  it('flags only dates older than seven calendar days and does not fetch or expire rates', () => {
    const old = { ...rate(), asOf: '2025-01-01' };
    expect(rateAgeDays(old, '2025-01-08')).toBe(7);
    expect(isRateStale(old, '2025-01-08')).toBe(false);
    expect(isRateStale(old, '2025-01-09')).toBe(true);
    const data = fixture(); data.exchangeRates![0].asOf = '2025-01-01';
    const report = exchangeReport(data, '2025-01', 'USD');
    expect(report.combined).not.toBeNull();
    expect(report.staleRates).toHaveLength(1);
  });
});

describe('complete reporting only', () => {
  it('includes archived balances, all-time balance, monthly flows and original subtotals', () => {
    const report = exchangeReport(fixture(), '2025-01', 'USD');
    expect(report.combined).toEqual({ balance: 11760, income: 500, expense: 40, net: 460 });
    expect(report.subtotals.map(s => [s.currency, s.balance, s.accountCount])).toEqual([['USD', 10100, 1], ['JPY', 1500, 1], ['INR', 8000, 1]]);
  });
  it('withholds totals for missing, invalid, future or ambiguous direct rates; never infers', () => {
    for (const rates of [[], [rate('USD', 'JPY', '100'), rate('JPY', 'INR', '1')], [{ ...rate('JPY', 'USD'), asOf: '9999-01-01' }], [rate('JPY', 'USD', '0')], [rate('JPY', 'USD'), { ...rate('JPY', 'USD'), id: 'another' }]]) {
      const data = fixture(); data.exchangeRates = rates;
      expect(exchangeReport(data, '2025-01', 'USD').combined).toBeNull();
      expect(exchangeReport(data, '2025-01', 'USD').missing).toContain('JPY');
    }
  });
  it('requires even zero-balance foreign accounts and withholds overflowing estimates', () => {
    const data = fixture(); data.accounts[1].openingBalance = -500; data.exchangeRates = [];
    expect(exchangeReport(data, '2025-01', 'USD').missing).toContain('JPY');
    data.exchangeRates = [rate('JPY', 'USD', '999999999999'), rate('INR', 'USD', '999999999999')];
    const report = exchangeReport(data, '2025-01', 'USD');
    expect(report.combined).toBeNull(); expect(report.error).toContain('safe integer');
  });
  it('keeps same-currency transfers out of flows and includes empty legacy reports', () => {
    const data = fixture();
    data.accounts.push({ ...data.accounts[0], id: 'usd-other', openingBalance: -100 });
    const before = exchangeReport(data, '2025-01', 'USD').combined;
    data.transactions.push({ id: 'move', title: 'Move', type: 'transfer', accountId: 'usd', toAccountId: 'usd-other', amount: 123, date: '2025-01-02' });
    expect(exchangeReport(data, '2025-01', 'USD').combined).toEqual(before);
    expect(exchangeReport(emptyData(), '2025-01', 'JPY').combined).toEqual({ balance: 0, income: 0, expense: 0, net: 0 });
  });
  it('rejects an overflowing combined sum even when each conversion fits', () => {
    const data = fixture();
    data.accounts[1].openingBalance = 99_999_999_500;
    data.accounts[2].openingBalance = 100_000_000_000;
    data.exchangeRates = [rate('JPY', 'USD', '500'), rate('INR', 'USD', '50000')];
    const report = exchangeReport(data, '2025-01', 'USD');
    expect(report.combined).toBeNull();
    expect(report.error).toContain('safe integer');
  });
  it('rounds currency subtotals once and derives combined net from rounded income minus expense', () => {
    const data = fixture(); data.exchangeRates![0].rate = '0.00001';
    expect(exchangeReport(data, '2025-01', 'USD').combined?.net).toBe(-39);
  });
});
