import ExcelJS from 'exceljs';
import { unzipSync } from 'fflate';
import { CSV_HEADER, CSV_MAX_BYTES, CSV_MAX_ROWS, parseImportRecords, type CsvImportPreview } from './csv-import';
import { currencyOf, type FinanceData } from './finance';

const headers = CSV_HEADER.split(',');

export async function createXlsxTemplate(data: FinanceData): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Transactions', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = headers.map(header => ({ header, key: header, width: header === 'notes' ? 48 : 24 }));
  const accounts = data.accounts.filter(account => !account.archived);
  const account = accounts[0];
  const category = data.categories[0];
  if (account && category) {
    sheet.addRow([new Date('2026-01-01T00:00:00Z'), 'Example income', 'income', 3000, account.id, data.categories.find(c => c.id === 'income')?.id ?? category.id, 'Replace or delete this example before importing']);
    sheet.addRow([new Date('2026-01-02T00:00:00Z'), 'Example expense', 'expense', 45, account.id, category.id, 'Replace or delete this example before importing']);
  }
  sheet.getColumn(1).numFmt = 'yyyy-mm-dd';
  sheet.getColumn(4).numFmt = '0.##';
  for (const index of [2, 3, 5, 6, 7]) sheet.getColumn(index).numFmt = '@';
  sheet.getRow(1).font = { name: 'Arial', bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF456B55' } };
  sheet.autoFilter = 'A1:G1';

  const instructions = workbook.addWorksheet('Instructions');
  instructions.getColumn(1).width = 110;
  for (const line of [
    'Edit the Transactions sheet. Keep the header unchanged; replace or delete all example rows.',
    'Date: use a real Excel date (YYYY-MM-DD). Title: 1–100 characters. Type: income or expense.',
    'Amount: a positive number in the account currency, without a currency symbol. JPY: whole yen; USD/INR: up to 2 decimals.',
    'Account/category: choose an ID from the dropdown. Reference maps IDs to your workspace names and currencies.',
    'Notes: optional text, up to 1,000 characters. Add up to 10,000 transaction rows. No formulas or transfers.',
    'Dropdowns and validation cover rows 2–10001. Pasted values may bypass Excel rules; Almond revalidates every row.',
    'Only Transactions is imported. Save as .xlsx (not .xls or .xlsm), then upload and review the preview.',
    'If no examples or dropdown options appear, create an active account and a category in Almond first.',
  ]) instructions.addRow([line]);
  const reference = workbook.addWorksheet('Reference');
  reference.columns = [
    { header: 'Account ID', width: 40 }, { header: 'Account name', width: 32 }, { header: 'Currency', width: 14 },
    { header: 'Category ID', width: 40 }, { header: 'Category name', width: 32 },
  ];
  accounts.forEach((a, i) => { reference.getCell(i + 2, 1).value = a.id; reference.getCell(i + 2, 2).value = a.name; reference.getCell(i + 2, 3).value = currencyOf(a); });
  data.categories.forEach((c, i) => { reference.getCell(i + 2, 4).value = c.id; reference.getCell(i + 2, 5).value = c.name; });
  if (accounts.length) workbook.definedNames.add(`'Reference'!$A$2:$A$${accounts.length + 1}`, 'AccountIds');
  if (data.categories.length) workbook.definedNames.add(`'Reference'!$D$2:$D$${data.categories.length + 1}`, 'CategoryIds');
  for (let row = 2; row <= CSV_MAX_ROWS + 1; row++) {
    const common = { allowBlank: false, showErrorMessage: true, errorStyle: 'stop', errorTitle: 'Invalid value' };
    sheet.getCell(row, 1).dataValidation = { ...common, type: 'date', operator: 'between', formulae: [new Date('1900-01-01T00:00:00Z'), new Date('9999-12-31T00:00:00Z')], error: 'Enter a date.' };
    sheet.getCell(row, 3).dataValidation = { ...common, type: 'list', formulae: ['"income,expense"'], error: 'Choose income or expense.' };
    sheet.getCell(row, 4).dataValidation = { ...common, type: 'decimal', operator: 'greaterThan', formulae: [0], error: 'Enter a positive number in the account currency.' };
    if (accounts.length) sheet.getCell(row, 5).dataValidation = { ...common, type: 'list', formulae: ['AccountIds'], error: 'Choose an active account ID.' };
    if (data.categories.length) sheet.getCell(row, 6).dataValidation = { ...common, type: 'list', formulae: ['CategoryIds'], error: 'Choose a category ID.' };
  }
  for (const tab of workbook.worksheets) tab.eachRow(row => row.eachCell(cell => { cell.font = { ...cell.font, name: 'Arial' }; }));
  return workbook.xlsx.writeBuffer();
}

export async function parseXlsxImport(source: ArrayBuffer, data: FinanceData): Promise<CsvImportPreview> {
  if (source.byteLength > CSV_MAX_BYTES) throw new Error('Spreadsheet exceeds the 2 MiB limit.');
  // Bound decompressed content before ExcelJS loads the ZIP archive.
  let expanded = 0, entries = 0;
  try {
    unzipSync(new Uint8Array(source), { filter: entry => {
      expanded += entry.originalSize;
      if (++entries > 1000 || expanded > 20 * 1024 * 1024) throw new Error('Workbook is too large when expanded.');
      return false;
    } });
  } catch { throw new Error('Invalid XLSX archive or workbook exceeds the expanded size limit.'); }
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(source); }
  catch { throw new Error('Unable to read XLSX. Use an unencrypted .xlsx workbook.'); }
  const sheet = workbook.getWorksheet('Transactions');
  if (!sheet) throw new Error('Workbook must contain a Transactions sheet.');
  if (sheet.actualColumnCount > 7) throw new Error(`Use only the columns ${CSV_HEADER}.`);
  const records: string[][] = [];
  const errors = new Map<number, string[]>();
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > CSV_MAX_ROWS + 1) throw new Error('Spreadsheet exceeds the 10,000 data row limit.');
    // Ignore formatted empty rows, but retain worksheet row numbers in the preview.
    while (records.length < rowNumber - 1) records.push([]);
    const fields = headers.map((header, index) => {
      const value = row.getCell(index + 1).value;
      if (value === null || value === undefined) return '';
      if (rowNumber === 1 && typeof value === 'string') return value;
      if (index === 0 && value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
      if (index === 3 && typeof value === 'number' && Number.isFinite(value)) return String(value);
      if (index !== 3 && typeof value === 'string') return value;
      const messages = errors.get(rowNumber) ?? [];
      messages.push(`${header}: ${index === 3 ? 'use a numeric cell' : 'use text or a valid date'}; formulas and complex cells are not supported.`);
      errors.set(rowNumber, messages);
      return '';
    });
    records.push(fields);
  });
  return parseImportRecords(records, data, errors);
}
