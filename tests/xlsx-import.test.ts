import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { zipSync, strToU8 } from 'fflate';
import { createXlsxTemplate, parseXlsxImport } from '@/lib/xlsx-import';
import { CSV_HEADER, CSV_MAX_BYTES, validateCsvImport } from '@/lib/csv-import';
import { emptyData, sampleData } from '@/lib/finance';

const fixture = () => { const data = sampleData(); data.transactions = []; return data; };
async function workbook() {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await createXlsxTemplate(fixture()));
  return book;
}
async function parse(book: ExcelJS.Workbook) { return parseXlsxImport(await book.xlsx.writeBuffer(), fixture()); }

describe('XLSX import and template', () => {
  it('creates a typed workbook with dropdowns, instructions and workspace references', async () => {
    const book = await workbook();
    const sheet = book.getWorksheet('Transactions')!;
    expect(Array.from({ length: 7 }, (_, i) => sheet.getCell(1, i + 1).value).join(',')).toBe(CSV_HEADER);
    expect(sheet.getCell('A2').value).toBeInstanceOf(Date);
    expect(sheet.getCell('D2').value).toBe(3000);
    expect(sheet.getCell('A2').numFmt).toBe('yyyy-mm-dd');
    expect(sheet.getCell('C10001').dataValidation).toMatchObject({ type: 'list', showErrorMessage: true });
    expect(sheet.getCell('E2').dataValidation.formulae).toEqual(['AccountIds']);
    expect(book.getWorksheet('Instructions')!.rowCount).toBeGreaterThan(0);
    expect(book.getWorksheet('Reference')!.getCell('A2').value).toBe('checking');
    const preview = await parse(book);
    expect(preview.rows.map(row => row.errors)).toEqual([[], []]);
    expect(preview.rows.map(row => row.transaction?.type)).toEqual(['income', 'expense']);
    expect(preview.rows[0].transaction).toMatchObject({ date: '2026-01-01', amount: 300000 });
    expect(validateCsvImport(fixture(), preview.rows.map(row => row.transaction!))).toHaveLength(2);
  });

  it.each([
    ['D2', '12.34', 'numeric cell'],
    ['D2', -1, 'amount'],
    ['D2', 1.234, 'decimal'],
    ['B2', 123, 'use text'],
    ['A2', '01/02/2026', 'ISO date'],
    ['A2', '2026-02-30', 'ISO date'],
    ['C2', 'transfer', 'Type'],
    ['E2', 'missing', 'Unknown account'],
    ['F2', 'missing', 'Unknown category'],
    ['D2', { formula: '1+1', result: 2 }, 'formulas'],
    ['B2', { hyperlink: 'https://example.com', text: 'hello' }, 'complex cells'],
  ])('rejects invalid typed or pasted value in %s: %j', async (cell, value, error) => {
    const book = await workbook();
    book.getWorksheet('Transactions')!.getCell(cell).value = value;
    const preview = await parse(book);
    expect(preview.rows[0].errors.join(' ')).toContain(error);
    expect(preview.rows[0].transaction).toBeUndefined();
  });

  it('accepts ISO text dates, preserves text, and excludes duplicates', async () => {
    const book = await workbook();
    const sheet = book.getWorksheet('Transactions')!;
    sheet.getCell('A2').value = '2026-02-28';
    sheet.getCell('B2').value = 'Coffee, "large"';
    sheet.getCell('G2').value = 'line one\nline two';
    const source = await book.xlsx.writeBuffer();
    const data = fixture();
    const preview = await parseXlsxImport(source, data);
    expect(preview.rows[0].transaction).toMatchObject({ date: '2026-02-28', title: 'Coffee, "large"', notes: 'line one\nline two' });
    data.transactions.push(preview.rows[0].transaction!);
    expect((await parseXlsxImport(source, data)).rows[0].duplicate).toBe(true);
  });

  it('does not let a rejected formula row exclude a later valid row as a duplicate', async () => {
    const book = await workbook();
    const sheet = book.getWorksheet('Transactions')!;
    sheet.getRow(3).values = sheet.getRow(2).values;
    sheet.getCell('G2').value = { formula: '""', result: '' };
    sheet.getCell('G3').value = '';
    const preview = await parse(book);
    expect(preview.rows[0].errors.join()).toContain('formulas');
    expect(preview.rows[1].errors).toEqual([]);
    expect(preview.rows[1].duplicate).toBe(false);
  });

  it('enforces account currency precision, archived accounts and atomic revalidation', async () => {
    const book = await workbook();
    const data = fixture();
    data.accounts[0].currency = 'JPY';
    book.getWorksheet('Transactions')!.getCell('D2').value = 1.5;
    expect((await parseXlsxImport(await book.xlsx.writeBuffer(), data)).rows[0].errors.join()).toContain('whole yen');
    data.accounts[0].archived = true;
    expect((await parseXlsxImport(await book.xlsx.writeBuffer(), data)).rows[0].errors.join()).toContain('Archived');
    const preview = await parse(await workbook());
    expect(() => validateCsvImport(data, preview.rows.map(row => row.transaction!))).toThrow('Archived');
  });

  it('omits archived accounts from template dropdowns and handles an empty workspace', async () => {
    const data = fixture(); data.accounts[0].archived = true;
    const book = new ExcelJS.Workbook(); await book.xlsx.load(await createXlsxTemplate(data));
    expect(book.getWorksheet('Reference')!.getColumn(1).values).not.toContain('checking');
    const empty = new ExcelJS.Workbook(); await empty.xlsx.load(await createXlsxTemplate(emptyData()));
    expect(empty.getWorksheet('Transactions')!.actualRowCount).toBe(1);
    expect(empty.getWorksheet('Instructions')).toBeDefined();
  });

  it('rejects missing sheets, altered headers, extra columns and excessive rows', async () => {
    const missing = new ExcelJS.Workbook(); missing.addWorksheet('Other');
    await expect(parse(missing)).rejects.toThrow('Transactions');
    for (const [cell, value, error] of [['A1', 'Date', 'header'], ['H2', 'extra', 'columns'], ['A10002', '2026-01-01', '10,000']] as const) {
      const book = await workbook(); book.getWorksheet('Transactions')!.getCell(cell).value = value;
      await expect(parse(book)).rejects.toThrow(error);
    }
  });

  it('rejects corrupt, oversized and highly compressed workbooks', async () => {
    await expect(parseXlsxImport(new ArrayBuffer(CSV_MAX_BYTES + 1), fixture())).rejects.toThrow('2 MiB');
    await expect(parseXlsxImport(new Uint8Array([1, 2, 3]).buffer, fixture())).rejects.toThrow('Invalid XLSX');
    const compressed = zipSync({ 'large.xml': strToU8('x'.repeat(21 * 1024 * 1024)) });
    await expect(parseXlsxImport(compressed.buffer as ArrayBuffer, fixture())).rejects.toThrow('expanded');
  });
});
