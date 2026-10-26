import { currencies, currencyOf, financeSchema, parseMoney, transactionSchema, type FinanceData, type Transaction } from './finance';

export const CSV_MAX_BYTES = 2 * 1024 * 1024;
export const CSV_MAX_ROWS = 10_000;
export const TRANSACTION_LIMIT = 10_000;
export const CSV_HEADER = 'date,title,type,amount,account,category,notes';
export interface CsvImportRow {
  /** Logical CSV record number, including the header (not a physical line). */
  row: number;
  fields: string[];
  transaction?: Transaction;
  errors: string[];
  duplicate: boolean;
}
export interface CsvImportPreview { rows: CsvImportRow[]; }

// Structural errors reject the whole file; field errors remain visible in the preview.
function records(source: string): string[][] {
  if (new TextEncoder().encode(source).byteLength > CSV_MAX_BYTES) throw new Error('CSV exceeds the 2 MiB limit.');
  const input = source.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let cells: string[] = [], cell = '', quoted = false, closed = false;
  function finishCell() { cells.push(cell); cell = ''; closed = false; }
  function finishRow() {
    finishCell(); rows.push(cells); cells = [];
    if (rows.length > CSV_MAX_ROWS + 1) throw new Error('CSV exceeds the 10,000 data row limit.');
  }
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') { cell += '"'; i++; }
        else { quoted = false; closed = true; }
      } else if (ch === '\r') {
        if (input[i + 1] !== '\n') throw new Error(`CSV record ${rows.length + 1}: use LF or CRLF newlines.`);
        cell += '\n'; i++;
      } else cell += ch;
    } else if (ch === ',') finishCell();
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r') {
        if (input[i + 1] !== '\n') throw new Error(`CSV record ${rows.length + 1}: use LF or CRLF newlines.`);
        i++;
      }
      finishRow();
    } else if (ch === '"' && cell === '' && !closed) quoted = true;
    else {
      if (closed || ch === '"') throw new Error(`CSV record ${rows.length + 1}: malformed quoting.`);
      cell += ch;
    }
  }
  if (quoted) throw new Error(`CSV record ${rows.length + 1}: unterminated quoted field.`);
  if (cell || cells.length || closed) finishRow();
  return rows;
}
const normalize = (value: string) => value.replace(/\r\n?/g, '\n').trim().normalize('NFC');
/** Same ledger identity regardless of generated ID, name/id lookup, or decimal spelling. */
export function csvTransactionKey(t: Transaction): string {
  return JSON.stringify([t.date, normalize(t.title), t.type, t.amount, t.accountId, t.categoryId ?? '', normalize(t.notes ?? '')]);
}
function resolve<T extends { id: string; name: string }>(items: T[], value: string, label: string): T {
  const byId = items.find(item => item.id === value);
  if (byId) return byId;
  const matches = items.filter(item => item.name === value);
  if (matches.length > 1) throw new Error(`${label} name is ambiguous; use its stable ID.`);
  if (!matches.length) throw new Error(`Unknown ${label.toLowerCase()}; use an exact name or stable ID.`);
  return matches[0];
}
function activeAccount(data: FinanceData, accountId: string) {
  const account = data.accounts.find(a => a.id === accountId);
  if (!account) throw new Error('Unknown account.');
  if (account.archived) throw new Error('Archived account; restore it before importing.');
  if (!currencies.includes(currencyOf(account))) throw new Error('Unsupported account currency.');
  return account;
}
function rowTransaction(fields: string[], data: FinanceData): Transaction {
  const [date, title, type, amount, accountRef, categoryRef, notes = ''] = fields;
  if (type !== 'income' && type !== 'expense') throw new Error('Type must be income or expense; transfers are not supported.');
  const account = resolve(data.accounts, accountRef, 'Account');
  activeAccount(data, account.id);
  const category = resolve(data.categories, categoryRef, 'Category');
  const candidate = { id: crypto.randomUUID(), date, title: normalize(title), type, amount: parseMoney(amount, false, currencyOf(account)), accountId: account.id, categoryId: category.id, notes: normalize(notes) };
  const result = transactionSchema.safeParse(candidate);
  if (!result.success) {
    const field = result.error.issues[0]?.path[0];
    throw new Error(field === 'date' ? 'Date must be a valid ISO date (YYYY-MM-DD).' : field === 'title' ? 'Title must contain 1–100 characters.' : field === 'notes' ? 'Notes must contain at most 1,000 characters.' : 'Amount must be positive and within the supported limit.');
  }
  return result.data;
}
export function parseCsvImport(source: string, data: FinanceData): CsvImportPreview {
  return parseImportRecords(records(source), data);
}

/** Shared row validation for CSV and typed spreadsheet imports. */
export function parseImportRecords(records: string[][], data: FinanceData, cellErrors?: Map<number, string[]>): CsvImportPreview {
  const [header, ...body] = records;
  const expected = CSV_HEADER.split(',');
  if (!header || (header.length !== 6 && header.length !== 7) || header.some((field, index) => field !== expected[index])) {
    throw new Error(`Use the exact header ${CSV_HEADER} (notes column may be omitted).`);
  }
  if (!body.length) throw new Error('CSV contains no data rows.');
  const seen = new Set(data.transactions.map(csvTransactionKey));
  const rows = body.map((fields, index): CsvImportRow => {
    const row: CsvImportRow = { row: index + 2, fields, errors: cellErrors?.get(index + 2) ?? [], duplicate: false };
    if (row.errors.length) return row;
    try {
      if (fields.length !== header.length) throw new Error(`Expected ${header.length} columns; found ${fields.length}.`);
      row.transaction = rowTransaction(fields, data);
      const key = csvTransactionKey(row.transaction);
      row.duplicate = seen.has(key);
      seen.add(key);
    } catch (error) { row.errors.push(error instanceof Error ? error.message : 'Invalid row.'); }
    return row;
  });
  return { rows };
}

/** Call INSIDE changeData's atomic mutation, then append the returned batch once.
 * Rechecks the current ledger, not the preview snapshot; never silently drops rows.
 */
export function validateCsvImport(data: FinanceData, transactions: Transaction[]): Transaction[] {
  if (!transactions.length) throw new Error('Select at least one valid, nonduplicate row.');
  if (transactions.length > CSV_MAX_ROWS || data.transactions.length + transactions.length > TRANSACTION_LIMIT) throw new Error('Import would exceed the 10,000 transaction limit.');
  const seen = new Set(data.transactions.map(csvTransactionKey));
  const ids = new Set(data.transactions.map(t => t.id));
  const batch = transactions.map(t => {
    const parsed = transactionSchema.safeParse(t);
    if (!parsed.success || (t.type !== 'income' && t.type !== 'expense') || t.toAccountId || t.scheduleId || t.scheduledFor) throw new Error('Import contains an invalid transaction. Preview the file again.');
    activeAccount(data, t.accountId);
    if (!data.categories.some(c => c.id === t.categoryId)) throw new Error('Category no longer exists. Preview the file again.');
    const key = csvTransactionKey(t);
    if (seen.has(key) || ids.has(t.id)) throw new Error('Duplicate transaction detected. Preview the file again.');
    seen.add(key); ids.add(t.id);
    return parsed.data;
  });
  if (!financeSchema.safeParse({ ...data, transactions: [...data.transactions, ...batch] }).success) throw new Error('Import failed validation. No transactions were imported.');
  return batch;
}
