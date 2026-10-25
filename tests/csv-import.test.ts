import { describe, expect, it } from 'vitest';
import { CSV_HEADER, CSV_MAX_BYTES, CSV_MAX_ROWS, csvTransactionKey, parseCsvImport, validateCsvImport } from '@/lib/csv-import';
import { sampleData, type FinanceData, type Transaction } from '@/lib/finance';

function fixture(): FinanceData {
  const data = sampleData();
  data.transactions = [];
  data.accounts.push(
    { ...data.accounts[0], id: 'yen', name: 'Yen', currency: 'JPY' },
    { ...data.accounts[0], id: 'rupees', name: 'Rupees', currency: 'INR' },
  );
  return data;
}
const line = '2026-02-28,Coffee,expense,12.34,checking,food,';
const csv = (body = line) => `${CSV_HEADER}\n${body}`;
const transaction = (data = fixture()) => parseCsvImport(csv(), data).rows[0].transaction!;

describe('canonical CSV parsing', () => {
  it('parses BOM, CRLF, commas, escaped quotes and multiline fields', () => {
    const preview = parseCsvImport(`\uFEFF${CSV_HEADER}\r\n2026-02-28,"Coffee, ""large""",expense,12.34,Everyday account,Food & dining,"line one\r\nline two"\r\n`, fixture());
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0]).toMatchObject({ row: 2, errors: [], duplicate: false, transaction: { title: 'Coffee, "large"', amount: 1234, accountId: 'checking', categoryId: 'food', notes: 'line one\nline two' } });
  });
  it('allows omitting the notes column and a final newline but not blank records', () => {
    const preview = parseCsvImport('date,title,type,amount,account,category\n2026-02-28,Coffee,expense,12.34,checking,food\n', fixture());
    expect(preview.rows[0].transaction?.notes).toBe('');
    expect(parseCsvImport(csv(`${line}\n\n`), fixture()).rows[1].errors).toHaveLength(1);
    expect(parseCsvImport(csv(`${line}\n,,,,,,`), fixture()).rows[1].errors).toHaveLength(1);
  });
  it.each([
    'Date,title,type,amount,account,category,notes\n' + line,
    'date,title,type,amount,account,category,currency\n' + line,
    'date,"title,type",amount,account,category,notes\n' + line,
    CSV_HEADER,
    '',
    csv('2026-02-28,"Unclosed,expense,1,checking,food,'),
    csv('2026-02-28,"Title"oops,expense,1,checking,food,'),
    csv('2026-02-28,Ti"tle,expense,1,checking,food,'),
    csv(line + '\r'),
  ])('rejects malformed structure or headers: %s', source => {
    expect(() => parseCsvImport(source, fixture())).toThrow();
  });
  it.each([
    ['2026-02-30,Coffee,expense,1,checking,food,', 'ISO date'],
    ['02/28/2026,Coffee,expense,1,checking,food,', 'ISO date'],
    ['2026-02-28,,expense,1,checking,food,', 'Title'],
    [`2026-02-28,${'x'.repeat(101)},expense,1,checking,food,`, 'Title'],
    [`2026-02-28,Coffee,expense,1,checking,food,${'x'.repeat(1001)}`, 'Notes'],
    ['2026-02-28,Coffee,transfer,1,checking,food,', 'Type'],
    ['2026-02-28,Coffee,Expense,1,checking,food,', 'Type'],
    ['2026-02-28,Coffee,expense,-1,checking,food,', 'amount'],
    ['2026-02-28,Coffee,expense,0,checking,food,', 'positive'],
    ['2026-02-28,Coffee,expense,1e2,checking,food,', 'amount'],
    ['2026-02-28,Coffee,expense,1.234,checking,food,', 'decimal'],
    ['2026-02-28,Coffee,expense,1000000001,checking,food,', 'large'],
    ['2026-02-28,Coffee,expense,1,missing,food,', 'Unknown account'],
    ['2026-02-28,Coffee,expense,1,checking,missing,', 'Unknown category'],
    ['2026-02-28,Coffee,expense,1,checking,food', 'columns'],
  ])('retains invalid rows with safe errors: %s', (body, message) => {
    const row = parseCsvImport(csv(body), fixture()).rows[0];
    expect(row.row).toBe(2);
    expect(row.transaction).toBeUndefined();
    expect(row.errors[0]).toContain(message);
  });
  it('does not interpolate untrusted field contents into errors', () => {
    const row = parseCsvImport(csv(line.replace('checking', '<script>alert(1)</script>')), fixture()).rows[0];
    expect(row.errors[0]).not.toContain('<script>');
  });
  it('resolves exact names or IDs, rejects ambiguous names, and prefers explicit IDs', () => {
    const data = fixture();
    data.accounts.push({ ...data.accounts[0], id: 'other-checking' });
    data.categories.push({ ...data.categories[0], id: 'other-food' });
    expect(parseCsvImport(csv(line.replace('checking', 'Everyday account')), data).rows[0].errors[0]).toContain('ambiguous');
    expect(parseCsvImport(csv(line.replace('food', 'Food & dining')), data).rows[0].errors[0]).toContain('ambiguous');
    expect(parseCsvImport(csv(), data).rows[0].errors).toEqual([]);
    expect(parseCsvImport(csv(line.replace('checking', 'everyday account')), data).rows[0].errors[0]).toContain('Unknown');
  });
  it('rejects archived accounts by name and ID', () => {
    const data = fixture(); data.accounts[0].archived = true;
    for (const name of ['checking', 'Everyday account']) expect(parseCsvImport(csv(line.replace('checking', name)), data).rows[0].errors[0]).toContain('Archived');
  });
  it('converts USD, JPY and INR to integer minor units without rounding', () => {
    for (const [account, input, amount] of [['checking', '12.34', 1234], ['yen', '1234', 1234], ['rupees', '12.3', 1230]] as const) {
      expect(parseCsvImport(csv(line.replace('checking', account).replace('12.34', input)), fixture()).rows[0].transaction?.amount).toBe(amount);
    }
    expect(parseCsvImport(csv(line.replace('checking', 'yen')), fixture()).rows[0].errors[0]).toContain('whole yen');
    expect(parseCsvImport(csv(line.replace('checking', 'rupees').replace('12.34', '1.234')), fixture()).rows[0].errors[0]).toContain('decimal');
    const data = fixture(); Object.assign(data.accounts[0], { currency: 'EUR' });
    expect(parseCsvImport(csv(), data).rows[0].errors[0]).toContain('Unsupported');
  });
  it('bounds file bytes and logical record count, without dropping rows', () => {
    expect(() => parseCsvImport('é'.repeat(CSV_MAX_BYTES / 2 + 1), fixture())).toThrow('2 MiB');
    expect(parseCsvImport(csv(Array(CSV_MAX_ROWS).fill(line).join('\n')), fixture()).rows).toHaveLength(CSV_MAX_ROWS);
    expect(() => parseCsvImport(csv(Array(CSV_MAX_ROWS + 1).fill(line).join('\n')), fixture())).toThrow('10,000');
  });
});

describe('duplicate detection and atomic revalidation', () => {
  it('normalizes names/IDs, decimal spelling, surrounding whitespace, Unicode and newlines', () => {
    const data = fixture();
    const t = transaction(data); data.transactions.push({ ...t, title: ' Café ', notes: 'note\r\nsecond' });
    const source = csv('2026-02-28,Café,expense,12.340,checking,food,');
    expect(parseCsvImport(source, data).rows[0].errors).not.toEqual([]); // no rounding extra precision
    const result = parseCsvImport(csv('2026-02-28,Café,expense,012.34,Everyday account,Food & dining," note\nsecond "'), data);
    expect(result.rows[0].duplicate).toBe(true);
    const result2 = parseCsvImport(csv(`${line}\n${line.replace('12.34', '012.34')}`), fixture());
    expect(result2.rows.map(r => r.duplicate)).toEqual([false, true]);
    expect(csvTransactionKey(t)).toBe(csvTransactionKey({ ...t, id: 'different', title: ' Coffee ', notes: '' }));
  });
  it('preserves separate transactions for different notes, dates, amounts, accounts or types', () => {
    const t = transaction();
    for (const changed of [{ notes: 'Different' }, { date: '2026-03-01' }, { amount: 1 }, { accountId: 'cash' }, { type: 'income' as const }]) expect(csvTransactionKey({ ...t, ...changed })).not.toBe(csvTransactionKey(t));
  });
  it('validates without mutating input and blocks reimport even with a new ID', () => {
    const data = fixture(); const batch = [transaction(data)]; const before = structuredClone(data);
    const validated = validateCsvImport(data, batch);
    expect(data).toEqual(before);
    data.transactions = [...data.transactions, ...validated];
    expect(() => validateCsvImport(data, [{ ...batch[0], id: 'new-id' }])).toThrow('Duplicate');
    expect(parseCsvImport(csv(), data).rows[0].duplicate).toBe(true);
  });
  it('fails the entire batch if a concurrent append introduced any duplicate', () => {
    const data = fixture(); const first = transaction(data); const second = { ...first, id: 'second', title: 'Lunch' };
    data.transactions.push({ ...second, id: 'concurrent' });
    const before = structuredClone(data);
    expect(() => validateCsvImport(data, [first, second])).toThrow('Duplicate');
    expect(data).toEqual(before);
    expect(() => validateCsvImport(fixture(), [first, { ...first, id: 'same-fields' }])).toThrow('Duplicate');
  });
  it('rechecks deleted/archived accounts, categories, IDs, transaction validity and total limits', () => {
    const t = transaction();
    const archived = fixture(); archived.accounts[0].archived = true;
    expect(() => validateCsvImport(archived, [t])).toThrow('Archived');
    const missing = fixture(); missing.accounts = [];
    expect(() => validateCsvImport(missing, [t])).toThrow('Unknown account');
    const categories = fixture(); categories.categories = [];
    expect(() => validateCsvImport(categories, [t])).toThrow('Category');
    expect(() => validateCsvImport(fixture(), [{ ...t, amount: 0 }])).toThrow('invalid');
    expect(() => validateCsvImport(fixture(), [{ ...t, type: 'transfer', toAccountId: 'cash' }])).toThrow('invalid');
    expect(() => validateCsvImport(fixture(), [])).toThrow('Select');
    expect(() => validateCsvImport(fixture(), [t, { ...t, title: 'Different' }])).toThrow('Duplicate');
    const full = fixture();
    full.transactions = Array.from({ length: 10_000 }, (_, i): Transaction => ({ ...t, id: String(i), title: String(i) }));
    expect(() => validateCsvImport(full, [t])).toThrow('10,000 transaction');
    full.transactions.pop();
    expect(validateCsvImport(full, [t])).toHaveLength(1);
  });
});
