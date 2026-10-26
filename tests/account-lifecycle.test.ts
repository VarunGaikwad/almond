import { describe, expect, it } from 'vitest';
import { accountBalance, accountHasTransactions, assertActiveTransactionAccounts, currentMonth, deleteAccount, financeSchema, sampleData, setAccountArchived, setPrimaryAccount, totals, type Transaction } from '@/lib/finance';

describe('account lifecycle', () => {
  it('deletes an account without transactions, removing its opening balance only', () => {
    const data = sampleData();
    const before = totals(data, currentMonth());
    const transactions = structuredClone(data.transactions);
    const opening = accountBalance(data, 'cash');
    expect(accountHasTransactions(data, 'cash')).toBe(false);
    deleteAccount(data, 'cash');
    expect(data.accounts.some(a => a.id === 'cash')).toBe(false);
    expect(totals(data, currentMonth())).toEqual({ ...before, balance: before.balance - opening });
    expect(data.transactions).toEqual(transactions);
    expect(financeSchema.safeParse(data).success).toBe(true);
  });
  it.each(['checking', 'savings'])('protects source and destination history for %s', id => {
    const data = sampleData();
    const before = structuredClone(data);
    expect(accountHasTransactions(data, id)).toBe(true);
    expect(() => deleteAccount(data, id)).toThrow('Archive');
    expect(data).toEqual(before);
  });
  it('archives and restores without changing balances, reports or transactions', () => {
    const data = sampleData();
    const before = totals(data, currentMonth());
    const transactions = structuredClone(data.transactions);
    setPrimaryAccount(data, 'savings');
    setAccountArchived(data, 'checking', true);
    expect(data.accounts[0].archived).toBe(true);
    const restoredBackup = financeSchema.parse(JSON.parse(JSON.stringify(data)));
    expect(restoredBackup.accounts[0].archived).toBe(true);
    expect(totals(restoredBackup, currentMonth())).toEqual(before);
    expect(restoredBackup.transactions).toEqual(transactions);
    setAccountArchived(data, 'checking', false);
    expect(data.accounts[0].archived).toBe(false);
    expect(totals(data, currentMonth())).toEqual(before);
  });
  it('rejects new transactions on archived accounts but permits history edits', () => {
    const data = sampleData();
    setPrimaryAccount(data, 'savings');
    setAccountArchived(data, 'checking', true);
    const existing = data.transactions[0];
    expect(() => assertActiveTransactionAccounts(data, { ...existing, title: 'Edited' })).not.toThrow();
    expect(() => assertActiveTransactionAccounts(data, { ...existing, id: 'new' })).toThrow('Restore');
    setAccountArchived(data, 'checking', false);
    expect(() => assertActiveTransactionAccounts(data, { ...existing, id: 'new' })).not.toThrow();
  });
  it('rejects transfers into archived accounts and reassignment to an archived source', () => {
    const data = sampleData();
    setAccountArchived(data, 'savings', true);
    const transfer = data.transactions.find(t => t.type === 'transfer')!;
    expect(() => assertActiveTransactionAccounts(data, { ...transfer, title: 'Edited transfer' })).not.toThrow();
    expect(() => assertActiveTransactionAccounts(data, { ...transfer, id: 'new' })).toThrow('destination');
    expect(() => assertActiveTransactionAccounts(data, { ...data.transactions[0], accountId: 'savings' })).toThrow('Restore');
    const changedType: Transaction = { ...data.transactions[0], type: 'transfer', toAccountId: 'savings' };
    expect(() => assertActiveTransactionAccounts(data, changedType)).toThrow('destination');
  });
  it('requires a replacement primary before archive or deletion and preserves rejected data', () => {
    const data = sampleData();
    const before = structuredClone(data);
    expect(() => setAccountArchived(data, 'checking', true)).toThrow('replacement primary');
    expect(data).toEqual(before);
    setPrimaryAccount(data, 'cash');
    const primaryCash = structuredClone(data);
    expect(() => deleteAccount(data, 'cash')).toThrow('replacement primary');
    expect(data).toEqual(primaryCash);
    setPrimaryAccount(data, 'savings');
    deleteAccount(data, 'cash');
    expect(data.primaryAccountId).toBe('savings');
    expect(financeSchema.safeParse(data).success).toBe(true);
  });
  it('rejects unknown accounts and invalid archived values', () => {
    const data = sampleData();
    expect(() => deleteAccount(data, 'missing')).toThrow('not found');
    expect(() => setAccountArchived(data, 'missing', true)).toThrow('not found');
    expect(financeSchema.safeParse({ ...data, accounts: [{ ...data.accounts[0], archived: 'yes' }] }).success).toBe(false);
  });
});
