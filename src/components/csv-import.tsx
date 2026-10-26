'use client';
import { useRef, useState, type FormEvent } from 'react';
import { currencyOf, money, type FinanceData, type Transaction } from '@/lib/finance';
import { CSV_MAX_BYTES, TRANSACTION_LIMIT, parseCsvImport, validateCsvImport, type CsvImportPreview } from '@/lib/csv-import';
import { ErrorMessage, errorText } from './forms';
import { Modal } from './ui';

const PREVIEW_ROWS = 50;
export function CsvImport({ data, onClose, onImport }: {
  data: FinanceData;
  onClose: () => void;
  /** Must revalidate with validateCsvImport inside the atomic store mutation. */
  onImport: (transactions: Transaction[]) => Promise<void>;
}) {
  const [preview, setPreview] = useState<CsvImportPreview | null>(null);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const selected = preview?.rows.filter(row => row.transaction && !row.errors.length && !row.duplicate && !excluded.has(row.row)).map(row => row.transaction!) ?? [];
  const overLimit = data.transactions.length + selected.length > TRANSACTION_LIMIT;
  async function load(file?: File) {
    if (lock.current) return;
    setPreview(null); setError(''); setConfirmed(false); setExcluded(new Set());
    if (!file) return;
    lock.current = true; setBusy(true);
    try {
      if (file.size > CSV_MAX_BYTES) throw new Error('Spreadsheet exceeds the 2 MiB limit.');
      const buffer = await file.arrayBuffer();
      if (file.name.toLowerCase().endsWith('.xlsx')) {
        const { parseXlsxImport } = await import('@/lib/xlsx-import');
        setPreview(await parseXlsxImport(buffer, data));
      } else if (file.name.toLowerCase().endsWith('.csv')) {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        setPreview(parseCsvImport(text, data));
      } else throw new Error('Choose an .xlsx or .csv file.');
    } catch (e) { setError(e instanceof TypeError ? 'CSV must be UTF-8 text.' : errorText(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  async function downloadTemplate() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const { createXlsxTemplate } = await import('@/lib/xlsx-import');
      const buffer = await createXlsxTemplate(data);
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const link = document.createElement('a'); link.href = url; link.download = 'almond-import-template.xlsx'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(errorText(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || !confirmed || !selected.length || overLimit) return;
    lock.current = true; setBusy(true); setError('');
    try { await onImport(validateCsvImport(data, selected)); onClose(); }
    catch (e) { setError(errorText(e)); setConfirmed(false); }
    finally { lock.current = false; setBusy(false); }
  }
  return <Modal title="Import spreadsheet" wide onClose={() => { if (!lock.current) onClose(); }}>
    <form className="form-stack" onSubmit={submit} aria-busy={busy}>
      <p className="muted">Download the Excel template, fill in the Transactions sheet, then upload the .xlsx file here. The template includes date formatting, positive-number validation, and dropdowns for types, accounts, and categories. CSV files are still supported.</p>
      <p className="field-hint">Only income and expense rows. Use ISO dates, exact account/category names or IDs, and positive amounts in the account’s currency. USD/INR allow 2 decimal places; JPY requires whole yen. Maximum 2 MiB and 10,000 rows. Arbitrary Cashew exports are not supported.</p>
      <button type="button" className="button secondary" disabled={busy} onClick={() => void downloadTemplate()}>Download XLSX template</button>
      <p className="field-hint">Keep the header unchanged and replace or delete the examples. The Instructions sheet explains each column; Reference lists your account/category IDs and names. Enter amounts as numbers, not text or formulas. Spreadsheet rules can be bypassed by pasting, so Almond validates every row again before import. Notes are optional.</p>
      <label>Spreadsheet file<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.csv,text/csv" required disabled={busy} onChange={e => void load(e.target.files?.[0])}/></label>
      {preview && <>
        <p role="status">{preview.rows.length} rows: {preview.rows.filter(r => !r.errors.length && !r.duplicate).length} valid, {preview.rows.filter(r => r.errors.length).length} invalid, {preview.rows.filter(r => r.duplicate).length} duplicate. {selected.length} selected. Invalid and duplicate rows are excluded.</p>
        <p className="field-hint">Showing the first {Math.min(PREVIEW_ROWS, preview.rows.length)} rows. All valid nonduplicate rows are selected by default, including rows beyond this preview. Uncheck visible rows to exclude them. Split the file into smaller files to inspect every row.</p>
        <div style={{ overflowX: 'auto', maxHeight: '22rem' }} tabIndex={0} role="region" aria-label="Import preview">
          <table><caption>Import preview — row numbers include the header</caption><thead><tr><th scope="col">Import</th><th scope="col">Row</th><th scope="col">Title</th><th scope="col">Date</th><th scope="col">Type</th><th scope="col">Amount</th><th scope="col">Account</th><th scope="col">Category</th><th scope="col">Notes</th><th scope="col">Status</th></tr></thead>
            <tbody>{preview.rows.slice(0, PREVIEW_ROWS).map(row => {
              const t = row.transaction;
              const eligible = !!t && !row.errors.length && !row.duplicate;
              return <tr key={row.row}>
                <td><input type="checkbox" aria-label={`Import row ${row.row}`} disabled={busy || !eligible} checked={eligible && !excluded.has(row.row)} onChange={e => { const checked = e.target.checked; setExcluded(previous => { const next = new Set(previous); if (checked) next.delete(row.row); else next.add(row.row); return next; }); setConfirmed(false); }}/></td>
                <th scope="row">{row.row}</th><td style={{ overflowWrap: 'anywhere' }}>{(t?.title ?? row.fields[1] ?? '').slice(0, 100)}</td><td>{(t?.date ?? row.fields[0] ?? '').slice(0, 20)}</td>
                <td>{(t?.type ?? row.fields[2] ?? '').slice(0, 20)}</td><td>{t ? money(t.amount, currencyOf(data.accounts.find(a => a.id === t.accountId))) : (row.fields[3] ?? '').slice(0, 30)}</td>
                <td>{(t ? data.accounts.find(a => a.id === t.accountId)?.name ?? t.accountId : row.fields[4] ?? '').slice(0, 100)}</td><td>{(t ? data.categories.find(c => c.id === t.categoryId)?.name ?? t.categoryId : row.fields[5] ?? '')?.slice(0, 100)}</td>
                <td style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{(t?.notes ?? row.fields[6] ?? '').slice(0, 1000)}</td><td>{row.errors.join(' ') || (row.duplicate ? 'Duplicate — excluded' : 'Valid')}</td>
              </tr>;
            })}</tbody></table>
        </div>
        {overLimit && <p role="alert" className="form-error">Selection would exceed the 10,000 transaction limit. Import fewer rows.</p>}
        <label><input type="checkbox" checked={confirmed} disabled={busy || !selected.length || overLimit} onChange={e => setConfirmed(e.target.checked)}/> I reviewed the preview and want to import {selected.length} selected transactions. All selected rows will be imported together or none will be saved.</label>
      </>}
      <ErrorMessage error={error}/>
      <div className="form-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={busy || !confirmed || !selected.length || overLimit}>{busy ? 'Working…' : `Import ${selected.length} transactions`}</button></div>
    </form>
  </Modal>;
}
