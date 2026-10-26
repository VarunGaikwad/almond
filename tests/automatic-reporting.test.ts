import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountBalance, deleteAccount, emptyData, financeSchema, fxQuoteSchema, normalizeFinanceData, primaryAccount, reportingCurrency, setAccountArchived, setPrimaryAccount, type FinanceData, type FxQuote } from '@/lib/finance';
import { currentReportingBalance, historicalReportingData, transactionReportingAmount } from '@/lib/exchange';
import { createBackup, parseBackup } from '@/lib/data-format';
import { AlmondDB, applyTransactionQuotes, changeData, db, ensureWorkspace, recordPayment, receiveRemote, resolveConflict, type Workspace } from '@/lib/store';

const scope = 'user:automatic-fx';
const quote: FxQuote = { source: 'USD', date: '2025-01-03', asOf: '2025-01-02', rates: { USD: '1', JPY: '150', INR: '85' } };
function fixture(): FinanceData {
  return { ...emptyData(), accounts: [
    { id: 'usd', name: 'Dollars', currency: 'USD', type: 'cash', color: '#123456', openingBalance: 2000 },
    { id: 'jpy', name: 'Yen', currency: 'JPY', type: 'cash', color: '#123456', openingBalance: 100 },
  ], transactions: [{ id: 't', title: 'Lunch', type: 'expense', accountId: 'usd', categoryId: 'food', amount: 1000, date: quote.date }] };
}
beforeEach(async () => { await db.workspaces.clear(); await ensureWorkspace(scope); });

describe('primary account', () => {
  it('normalizes legacy data deterministically and keeps a single active pointer', () => {
    const data = fixture();
    expect(primaryAccount(data)?.id).toBe('usd');
    expect(reportingCurrency(data)).toBe('USD');
    expect(normalizeFinanceData(data).primaryAccountId).toBe('usd');
    data.accounts[0].archived = true;
    expect(normalizeFinanceData(data).primaryAccountId).toBe('jpy');
    data.accounts[1].archived = true;
    expect(normalizeFinanceData(data).primaryAccountId).toBe('usd');
    expect(reportingCurrency(emptyData())).toBe('USD');
    expect(normalizeFinanceData(emptyData()).primaryAccountId).toBeUndefined();
    expect(financeSchema.safeParse({ ...data, primaryAccountId: 'missing' }).success).toBe(false);
  });
  it('requires a replacement before archiving or deleting the primary, but allows an empty workspace', () => {
    const data = fixture();
    setPrimaryAccount(data, 'jpy');
    expect(() => setAccountArchived(data, 'jpy', true)).toThrow('replacement');
    expect(() => deleteAccount(data, 'jpy')).toThrow('replacement');
    setPrimaryAccount(data, 'usd');
    setAccountArchived(data, 'jpy', true);
    expect(() => setPrimaryAccount(data, 'jpy')).toThrow('active');
    deleteAccount(data, 'jpy');
    data.transactions = [];
    deleteAccount(data, 'usd');
    expect(data.accounts).toEqual([]);
    expect(data.primaryAccountId).toBeUndefined();
  });
  it('enforces primary lifecycle at the shared store boundary too', async () => {
    await changeData(scope, data => Object.assign(data, fixture()));
    const before = await db.workspaces.get(scope);
    await expect(changeData(scope, data => { data.accounts[0].archived = true; })).rejects.toThrow('replacement');
    await expect(changeData(scope, data => { data.accounts = data.accounts.slice(1); data.transactions = []; })).rejects.toThrow('replacement');
    expect(await db.workspaces.get(scope)).toEqual(before);
    await changeData(scope, data => { setPrimaryAccount(data, 'jpy'); data.accounts[0].archived = true; });
    expect((await db.workspaces.get(scope))?.data.primaryAccountId).toBe('jpy');
  });
});

describe('automatic reporting', () => {
  it('converts historical USD cents to yen without touching any native ledger amount', () => {
    const data = fixture();
    const transaction = data.transactions[0]; transaction.fx = structuredClone(quote);
    const before = structuredClone(data);
    expect(transactionReportingAmount(data, transaction, 'JPY')).toBe(1500);
    expect(accountBalance(data, 'usd')).toBe(1000);
    expect(accountBalance(data, 'jpy')).toBe(100);
    expect(currentReportingBalance(data, 'JPY', [quote])).toBe(1600);
    const later = { ...quote, date: '2025-01-06', rates: { ...quote.rates, JPY: '160' } };
    expect(currentReportingBalance(data, 'JPY', [later, quote])).toBe(1700);
    expect(transactionReportingAmount(data, transaction, 'JPY')).toBe(1500);
    const projected = historicalReportingData(data, 'JPY')!;
    expect(projected.transactions[0].amount).toBe(1500);
    expect(projected.accounts.every(a => a.currency === 'JPY' && a.openingBalance === 0)).toBe(true);
    expect(projected.budgets).toEqual([]); expect(projected.goals).toBeUndefined(); expect(projected.schedules).toBeUndefined();
    expect(data).toEqual(before);
  });
  it('rounds yen and paise safely, handles archived/negative balances, and never uses manual rates', () => {
    const data = fixture();
    data.transactions[0].amount = 1; data.transactions[0].fx = { ...quote, rates: { ...quote.rates, JPY: '50' } };
    expect(transactionReportingAmount(data, data.transactions[0], 'JPY')).toBe(1);
    data.transactions[0].fx.rates.JPY = '49.99999999';
    expect(transactionReportingAmount(data, data.transactions[0], 'JPY')).toBe(0);
    data.transactions = []; data.accounts[0].openingBalance = -1; data.accounts[0].archived = true;
    expect(currentReportingBalance(data, 'JPY', [{ ...quote, rates: { ...quote.rates, JPY: '50' } }])).toBe(99);
    data.exchangeRates = [{ id: 'manual', source: 'USD', target: 'JPY', rate: '200', asOf: quote.asOf }];
    expect(currentReportingBalance(data, 'JPY', [])).toBeNull();
    expect(currentReportingBalance(data, 'JPY', [{ ...quote, rates: { ...quote.rates, JPY: '999999999999' } }])).not.toBeNull();
    data.accounts[0].openingBalance = 100_000_000_000;
    expect(currentReportingBalance(data, 'JPY', [{ ...quote, rates: { ...quote.rates, JPY: '999999999999' } }])).toBeNull();
  });
  it('interprets JPY as whole yen and rounds converted USD cents and INR paise', () => {
    const data = fixture();
    const transaction = data.transactions[0];
    transaction.accountId = 'jpy'; transaction.amount = 1;
    transaction.fx = { ...quote, source: 'JPY', rates: { USD: '0.005', JPY: '1', INR: '0.555' } };
    expect(transactionReportingAmount(data, transaction, 'USD')).toBe(1);
    expect(transactionReportingAmount(data, transaction, 'INR')).toBe(56);
    expect(transactionReportingAmount(data, transaction, 'JPY')).toBe(1);
  });
  it('withholds incomplete historical data but needs no quote for native reporting', () => {
    const data = fixture(); const transaction = data.transactions[0];
    expect(transactionReportingAmount(data, transaction, 'USD')).toBe(1000);
    expect(transactionReportingAmount(data, transaction, 'JPY')).toBeNull();
    expect(historicalReportingData(data, 'JPY')).toBeNull();
    transaction.fx = { ...quote, date: '2025-01-04' };
    expect(transactionReportingAmount(data, transaction, 'JPY')).toBeNull();
    expect(financeSchema.safeParse(data).success).toBe(false);
    transaction.fx = { ...quote, source: 'JPY', rates: { USD: '0.01', JPY: '1', INR: '0.5' } };
    expect(financeSchema.safeParse(data).success).toBe(false);
  });
  it('excludes same-currency transfers from charts and refuses cross-currency transfers', () => {
    const data = fixture(); data.transactions = [];
    data.accounts.push({ ...data.accounts[0], id: 'other' });
    data.transactions.push({ id: 'move', title: 'Move', type: 'transfer', accountId: 'usd', toAccountId: 'other', amount: 100, date: quote.date });
    expect(historicalReportingData(data, 'JPY')?.transactions).toEqual([]);
    data.transactions[0].toAccountId = 'jpy';
    expect(historicalReportingData(data, 'JPY')).toBeNull();
    expect(financeSchema.safeParse(data).success).toBe(false);
  });
  it('validates complete bounded daily quotes', () => {
    expect(fxQuoteSchema.safeParse(quote).success).toBe(true);
    for (const invalid of [
      { ...quote, date: '9999-01-01' }, { ...quote, asOf: '2025-01-04' }, { ...quote, asOf: '2025-02-30' },
      { ...quote, rates: { ...quote.rates, USD: '1.0' } }, { ...quote, rates: { ...quote.rates, INR: '0' } },
      { ...quote, rates: { USD: '1', JPY: '150' } }, { ...quote, rates: { ...quote.rates, INR: '1e2' } },
    ]) expect(fxQuoteSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('snapshot persistence', () => {
  it('backfills imports and schedule postings idempotently without overwriting saved rates', async () => {
    await changeData(scope, data => Object.assign(data, fixture()));
    await changeData(scope, data => { data.schedules = [{ id: 's', title: 'Scheduled lunch', type: 'expense', accountId: 'usd', categoryId: 'food', amount: 200, frequency: 'once', anchorDate: quote.date, nextDue: quote.date }]; });
    await recordPayment(scope, 's', quote.date);
    const before = await db.workspaces.get(scope);
    await applyTransactionQuotes(scope, [{ ...quote, date: '2025-01-04' }]);
    expect(await db.workspaces.get(scope)).toEqual(before);
    await Promise.all([applyTransactionQuotes(scope, [quote]), applyTransactionQuotes(scope, [quote])]);
    const saved = (await db.workspaces.get(scope))!;
    expect(saved.sequence).toBe(before!.sequence + 1);
    expect(saved.data.transactions.every(t => t.fx?.rates.JPY === '150')).toBe(true);
    await applyTransactionQuotes(scope, [{ ...quote, rates: { ...quote.rates, JPY: '200' } }]);
    expect(await db.workspaces.get(scope)).toEqual(saved);
    expect(accountBalance(saved.data, 'usd')).toBe(800);
  });
  it('preserves snapshots on metadata/amount edits, clears on date or source edits, and checks quote races', async () => {
    await changeData(scope, data => Object.assign(data, fixture()));
    await applyTransactionQuotes(scope, [quote]);
    await changeData(scope, data => {
      const { fx: _fx, ...transaction } = data.transactions[0];
      data.transactions[0] = { ...transaction, title: 'Renamed', notes: 'note', amount: 2000 };
    });
    let data = (await db.workspaces.get(scope))!.data;
    expect(data.transactions[0].fx).toEqual(quote);
    await changeData(scope, data => { data.transactions[0].fx!.rates.JPY = '999'; });
    expect((await db.workspaces.get(scope))!.data.transactions[0].fx).toEqual(quote);
    expect(transactionReportingAmount(data, data.transactions[0], 'JPY')).toBe(3000);
    await changeData(scope, data => { data.transactions[0].date = '2025-01-04'; });
    await applyTransactionQuotes(scope, [quote]);
    data = (await db.workspaces.get(scope))!.data;
    expect(data.transactions[0].fx).toBeUndefined();
    await applyTransactionQuotes(scope, [{ ...quote, date: '2025-01-04' }]);
    await changeData(scope, data => { data.transactions[0].accountId = 'jpy'; });
    expect((await db.workspaces.get(scope))!.data.transactions[0].fx).toBeUndefined();
  });
  it('restores the backup snapshot rather than retaining a current snapshot with the same transaction ID', async () => {
    await changeData(scope, data => Object.assign(data, fixture()));
    await applyTransactionQuotes(scope, [quote]);
    const backup = fixture();
    backup.transactions[0].fx = { ...quote, rates: { ...quote.rates, JPY: '145' } };
    setPrimaryAccount(backup, 'jpy');
    await changeData(scope, data => Object.assign(data, backup), { restore: true });
    expect((await db.workspaces.get(scope))!.data).toEqual(backup);
    backup.transactions[0].date = '2025-01-04';
    backup.transactions[0].fx!.date = '2025-01-04';
    await changeData(scope, data => Object.assign(data, backup), { restore: true });
    expect((await db.workspaces.get(scope))!.data).toEqual(backup);
    const invalid = structuredClone(backup); invalid.transactions[0].fx!.source = 'JPY';
    await expect(changeData(scope, data => Object.assign(data, invalid), { restore: true })).rejects.toThrow();
    expect((await db.workspaces.get(scope))!.data).toEqual(backup);
  });
  it('round trips v3 metadata and accepts normalized v1/v2 backups and remote conflicts', async () => {
    const data = fixture(); data.transactions[0].fx = quote; setPrimaryAccount(data, 'jpy');
    expect(parseBackup(createBackup(data))).toEqual(data);
    for (const version of [1, 2, 3]) {
      const legacy = fixture();
      const parsed = parseBackup({ format: 'almond', version, data: legacy });
      expect(parsed.primaryAccountId).toBe('usd'); expect(parsed.transactions).toEqual(legacy.transactions);
    }
    await receiveRemote(scope, { version: 1, data, mutationId: null });
    expect((await db.workspaces.get(scope))!.data).toEqual(data);
    await changeData(scope, data => { data.categories[0].name = 'Local'; });
    await receiveRemote(scope, { version: 2, data: fixture(), mutationId: 'remote' });
    await resolveConflict(scope, 'remote');
    expect((await db.workspaces.get(scope))!.data.primaryAccountId).toBe('usd');
  });
});

it('copies v2 workspaces, pending and conflict metadata to v3 atomically and isolates v2 writers', async () => {
  const name = `fx-upgrade-${crypto.randomUUID()}`;
  const legacy = new Dexie(name); legacy.version(4).stores({ workspacesV2: 'id' });
  const current = new AlmondDB(name); const older = new Dexie(name); older.version(4).stores({ workspacesV2: 'id' });
  const data = fixture(); data.transactions[0].fx = quote;
  const record: Workspace = { id: scope, data, baseVersion: 2, sequence: 3, dirty: true,
    pending: { id: 'stable-retry', data, baseVersion: 2, sequence: 2 }, conflict: { data, version: 3, mutationId: 'remote' } };
  try {
    await legacy.table('workspacesV2').put(record); legacy.close();
    await current.open();
    const migrated = (await current.workspaces.get(scope))!;
    expect(migrated.data.primaryAccountId).toBe('usd');
    expect(migrated.pending?.id).toBe('stable-retry');
    expect(migrated.pending?.data.transactions[0].fx).toEqual(quote);
    expect(migrated.conflict?.data.primaryAccountId).toBe('usd');
    expect(Array.from(current.backendDB().objectStoreNames)).toEqual(['workspacesV3']);
    current.close(); await older.open();
    expect(await older.table('workspacesV2').count()).toBe(0);
    await older.table('workspacesV2').put({ ...record, data: emptyData() });
    older.close(); await current.open();
    expect(await current.workspaces.get(scope)).toEqual(migrated);
  } finally { legacy.close(); older.close(); current.close(); await Dexie.delete(name); }
});

it('rolls back a failed v3 copy without losing v2 data and safely retries', async () => {
  const name = `fx-rollback-${crypto.randomUUID()}`;
  const legacy = new Dexie(name); legacy.version(4).stores({ workspacesV2: 'id' });
  const failing = new AlmondDB(name); failing.version(5).upgrade(() => { throw new Error('Interrupted FX upgrade'); });
  const retry = new AlmondDB(name);
  const record: Workspace = { id: scope, data: fixture(), baseVersion: 1, sequence: 2, dirty: true };
  try {
    await legacy.table('workspacesV2').put(record); legacy.close();
    await expect(failing.open()).rejects.toThrow('Interrupted FX upgrade');
    await legacy.open(); expect(await legacy.table('workspacesV2').get(scope)).toEqual(record); legacy.close();
    await retry.open(); expect((await retry.workspaces.get(scope))?.data.primaryAccountId).toBe('usd');
  } finally { legacy.close(); failing.close(); retry.close(); await Dexie.delete(name); }
});
