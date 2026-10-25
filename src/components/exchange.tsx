'use client';
import { useState } from 'react';
import { currencies, exchangeRateSchema, localDate, money, type Currency, type ExchangeRate, type FinanceData } from '@/lib/finance';
import { exchangeReport, isRateStale, type ReportingTotals } from '@/lib/exchange';
import { ErrorMessage, errorText, useSave } from './forms';
import { Modal } from './ui';

type ExchangeReportingProps = {
  data: FinanceData; month: string; currency: Currency;
  onSaveRate: (rate: ExchangeRate) => Promise<void>;
  onDeleteRate: (id: string) => Promise<void>;
};

function Amounts({ totals, currency }: { totals: ReportingTotals; currency: Currency }) {
  return <dl><dt>All-account balance</dt><dd>{money(totals.balance, currency)}</dd><dt>Month income</dt><dd>{money(totals.income, currency)}</dd><dt>Month expense</dt><dd>{money(totals.expense, currency)}</dd><dt>Month net</dt><dd>{money(totals.net, currency)}</dd></dl>;
}

export function ExchangeReporting({ data, month, currency, onSaveRate, onDeleteRate }: ExchangeReportingProps) {
  const [editing, setEditing] = useState<ExchangeRate | 'new' | null>(null);
  // Invalid or oversized input must never render a plausible partial combined total.
  let report: ReturnType<typeof exchangeReport> | undefined;
  let error = '';
  try { report = exchangeReport(data, month, currency); } catch (e) { error = errorText(e); }
  return <section className="card" aria-label="Manual currency reporting">
    <h2>Manual-rate estimate</h2>
    <p>{month} · Reporting in {currency}. All accounts, including archived accounts. Original ledger amounts are unchanged.</p>
    <p>Rates are entered by you, not live market prices. Offline estimates only.</p>
    <ErrorMessage error={error || report?.error || ''}/>
    {report?.missing.length ? <p role="status">Combined total unavailable. Missing valid direct rates: {report.missing.map(source => `${source} → ${currency}`).join(', ')}. No accounts have been omitted.</p> : null}
    {report?.staleRates.length ? <p role="status">Stale rates (older than 7 days) are being used. Review their dates below.</p> : null}
    {report?.combined ? <Amounts totals={report.combined} currency={currency}/> : null}
    <h3>Original currency subtotals</h3>
    {report?.subtotals.map(subtotal => <div key={subtotal.currency}><h4>{subtotal.currency} · {subtotal.accountCount} account(s)</h4><Amounts totals={subtotal} currency={subtotal.currency}/></div>)}
    <h3>Manual rates</h3>
    <p>1 source currency unit equals the entered number of target units. Direct pairs only; no inverse or triangulation.</p>
    <button className="button secondary" onClick={() => setEditing('new')}>Add manual rate</button>
    {!data.exchangeRates?.length ? <p>No manual rates saved.</p> : <ul>{data.exchangeRates.map(rate => <li key={rate.id}>
      <span>1 {rate.source} = {rate.rate} {rate.target} · As of {rate.asOf}{isRateStale(rate) ? ' · Stale (older than 7 days)' : ''}</span>{' '}
      <button className="button secondary" aria-label={`Edit rate ${rate.source} to ${rate.target}`} onClick={() => setEditing(rate)}>Edit rate</button>
    </li>)}</ul>}
    {editing ? <RateForm key={editing === 'new' ? 'new' : editing.id} data={data} initial={editing === 'new' ? undefined : editing} currency={currency} onSave={onSaveRate} onDelete={onDeleteRate} onClose={() => setEditing(null)}/> : null}
  </section>;
}

function RateForm({ data, initial, currency, onSave, onDelete, onClose }: {
  data: FinanceData; initial?: ExchangeRate; currency: Currency;
  onSave: (rate: ExchangeRate) => Promise<void>; onDelete: (id: string) => Promise<void>; onClose: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const form = useSave(async fields => {
    const rate = exchangeRateSchema.parse({ id: initial?.id ?? crypto.randomUUID(), source: fields.get('source'), target: fields.get('target'), rate: fields.get('rate'), asOf: fields.get('asOf') });
    if (data.exchangeRates?.some(r => r.id !== rate.id && r.source === rate.source && r.target === rate.target)) throw new Error('This directed pair already exists. Edit its saved rate.');
    await onSave(rate); onClose();
  });
  const busy = form.busy || deleting;
  return <Modal title={initial ? 'Edit manual rate' : 'Add manual rate'} onClose={onClose}><form className="form-stack" onSubmit={form.submit}>
    <label>Source currency<select name="source" aria-label="Source currency" defaultValue={initial?.source ?? (currency === 'USD' ? 'JPY' : 'USD')}>{currencies.map(c => <option key={c}>{c}</option>)}</select></label>
    <label>Target currency<select name="target" aria-label="Target currency" defaultValue={initial?.target ?? currency}>{currencies.map(c => <option key={c}>{c}</option>)}</select></label>
    <label>Rate (target units per 1 source unit)<input name="rate" required autoFocus inputMode="decimal" maxLength={21} defaultValue={initial?.rate} aria-describedby="rate-help"/></label>
    <p id="rate-help">Positive decimal, up to 12 whole digits and 8 decimal places. Enter your own rate; Almond never fetches prices.</p>
    <label>Rate as-of date<input name="asOf" type="date" required max={localDate()} defaultValue={initial?.asOf ?? localDate()}/></label>
    <ErrorMessage error={form.error}/>
    <div className="form-actions">{initial ? <button type="button" className="button danger" disabled={busy} onClick={async () => {
      if (!confirm('Delete this manual rate? Ledger amounts will not change.')) return;
      setDeleting(true); form.setError('');
      try { await onDelete(initial.id); onClose(); } catch (e) { form.setError(errorText(e)); } finally { setDeleting(false); }
    }}>Delete rate</button> : null}<button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={busy}>{busy ? 'Saving…' : 'Save rate'}</button></div>
  </form></Modal>;
}
