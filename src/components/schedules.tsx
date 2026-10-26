'use client';
import { useRef, useState } from 'react';
import { currencyOf, localDate, money, moneyInput, parseMoney, type FinanceData, type Schedule } from '@/lib/finance';
import { ErrorMessage, errorText, useSave } from './forms';
import { Modal } from './ui';

export function ScheduleForm({ data, initial, onSave, onDelete, onClose }: {
  data: FinanceData; initial?: Schedule; onSave: (s: Schedule) => Promise<void>;
  onDelete: (id: string) => Promise<void>; onClose: () => void;
}) {
  const [accountId, setAccountId] = useState(initial?.accountId ?? data.accounts.find(a => !a.archived)?.id ?? '');
  const currency = currencyOf(data.accounts.find(a => a.id === accountId));
  const form = useSave(async fields => {
    const due = String(fields.get('nextDue'));
    const frequency = String(fields.get('frequency')) as Schedule['frequency'];
    await onSave({ id: initial?.id ?? crypto.randomUUID(), title: String(fields.get('title')).trim(),
      amount: parseMoney(String(fields.get('amount')), false, currency), type: String(fields.get('type')) as Schedule['type'],
      accountId, categoryId: String(fields.get('categoryId')), frequency,
      nextDue: due || null,
      anchorDate: initial && (due || null) === initial.nextDue && frequency === initial.frequency ? initial.anchorDate : due || initial?.anchorDate || localDate(),
      endDate: String(fields.get('endDate')) || undefined, notes: String(fields.get('notes')).trim(),
    }); onClose();
  });
  return <Modal title={initial ? 'Edit schedule' : 'Create schedule'} onClose={onClose}><form className="form-stack" onSubmit={form.submit}>
    <p className="muted">Only Record payment adds a transaction. Nothing is posted automatically.</p>
    <label>Title<input name="title" required maxLength={100} autoFocus defaultValue={initial?.title}/></label>
    <div className="form-grid"><label>Type<select name="type" aria-label="Type" defaultValue={initial?.type ?? 'expense'}><option value="expense">Expense</option><option value="income">Income</option></select></label>
    <label>Frequency<select name="frequency" aria-label="Frequency" defaultValue={initial?.frequency ?? 'once'}>{['once', 'daily', 'weekly', 'monthly', 'yearly'].map(f => <option key={f} value={f}>{f === 'once' ? 'One-time' : f[0].toUpperCase() + f.slice(1)}</option>)}</select></label></div>
    <label>Account<select aria-label="Account" required value={accountId} onChange={e => setAccountId(e.target.value)}>{!accountId && <option value="">Choose account</option>}{data.accounts.filter(a => !a.archived || a.id === initial?.accountId).map(a => <option key={a.id} value={a.id}>{a.name} ({currencyOf(a)}){a.archived ? ' · Archived' : ''}</option>)}</select></label>
    <label>Amount ({currency})<input key={currency} name="amount" required inputMode={currency === 'JPY' ? 'numeric' : 'decimal'} defaultValue={initial && currency === currencyOf(data.accounts.find(a => a.id === initial.accountId)) ? moneyInput(initial.amount, currency) : ''}/></label>
    <label>Category<select name="categoryId" aria-label="Category" required defaultValue={initial?.categoryId}>{data.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <div className="form-grid"><label>Next due date<input name="nextDue" type="date" required={initial?.nextDue !== null} defaultValue={initial ? initial.nextDue ?? '' : localDate()}/></label><label>End date (optional)<input name="endDate" type="date" defaultValue={initial?.endDate}/></label></div>
    {initial?.nextDue === null && <p className="field-hint">Completed. Set a new next due date to restart.</p>}
    <label>Notes<textarea name="notes" maxLength={1000} rows={2} defaultValue={initial?.notes}/></label>
    <ErrorMessage error={form.error}/><div className="form-actions">{initial && <button type="button" className="button danger" disabled={form.busy} onClick={async () => { if (!confirm('Delete this schedule? Posted transactions will be kept.')) return; try { await onDelete(initial.id); onClose(); } catch (e) { form.setError(errorText(e)); } }}>Delete schedule</button>}<button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={form.busy}>Save schedule</button></div>
  </form></Modal>;
}

export function ScheduleList({ data, onEdit, onRecord }: { data: FinanceData; onEdit: (s: Schedule) => void; onRecord: (id: string, due: string) => Promise<boolean> }) {
  const inFlight = useRef(new Set<string>());
  const [busy, setBusy] = useState<string[]>([]);
  const [error, setError] = useState('');
  const today = localDate();
  const schedules = [...(data.schedules ?? [])].sort((a, b) => (a.nextDue ?? '9999').localeCompare(b.nextDue ?? '9999'));
  async function record(schedule: Schedule) {
    const due = schedule.nextDue;
    if (!due || inFlight.current.has(schedule.id)) return;
    inFlight.current.add(schedule.id); setBusy([...inFlight.current]); setError('');
    try { await onRecord(schedule.id, due); } catch (e) { setError(errorText(e)); }
    finally { inFlight.current.delete(schedule.id); setBusy([...inFlight.current]); }
  }
  return <section className="card schedule-list"><p className="muted">Planned payments do not affect balances or budgets until you record them. Each action records just the displayed occurrence, on its due date.</p><ErrorMessage error={error}/>
    {!schedules.length && <p>No schedules yet. Create a one-time or recurring payment.</p>}
    {(['Due', 'Upcoming', 'Completed'] as const).map(group => {
      const rows = schedules.filter(s => group === 'Completed' ? !s.nextDue : s.nextDue && (group === 'Due' ? s.nextDue <= today : s.nextDue > today));
      return rows.length ? <section key={group}><h2>{group}</h2>{rows.map(s => {
        const account = data.accounts.find(a => a.id === s.accountId);
        return <article className="budget-item" key={s.id}><div className="budget-top"><strong>{s.title}</strong><span>{money(s.amount, currencyOf(account))} · {s.type}</span></div><p className="muted">{s.nextDue ? `Next due ${s.nextDue}` : 'Completed'} · {s.frequency === 'once' ? 'One-time' : s.frequency} · {account?.name}{s.endDate ? ` · Ends ${s.endDate}` : ''}{account?.archived ? ' · Archived — restore account to record payment' : ''}</p><div className="inline-actions"><button className="button secondary" aria-label={`Edit schedule ${s.title}`} onClick={() => onEdit(s)}>Edit</button>{s.nextDue && <button className="button primary" aria-label={`Record payment for ${s.title} on ${s.nextDue}`} disabled={account?.archived || busy.includes(s.id)} onClick={() => void record(s)}>{busy.includes(s.id) ? 'Recording…' : 'Record payment'}</button>}</div></article>;
      })}</section> : null;
    })}
  </section>;
}
