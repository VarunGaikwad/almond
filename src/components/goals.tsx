'use client';
import { useState } from 'react';
import { currencies, currencyOf, money, moneyInput, parseMoney, type Currency, type FinanceData, type Goal } from '@/lib/finance';
import { goalProgress } from '@/lib/goals';
import { ErrorMessage, errorText, PostedLinks, useSave } from './forms';
import { Modal } from './ui';

export function GoalForm({ data, initial, defaultCurrency, onSave, onDelete, onClose }: {
  data: FinanceData; initial?: Goal; defaultCurrency: Currency; onSave: (g: Goal) => Promise<void>; onDelete: (id: string) => Promise<void>; onClose: () => void;
}) {
  const [currency, setCurrency] = useState(initial ? currencyOf(initial) : defaultCurrency);
  const [kind, setKind] = useState<Goal['kind']>(initial?.kind ?? 'saving');
  const form = useSave(async fields => {
    await onSave({ id: initial?.id ?? crypto.randomUUID(), name: String(fields.get('name')).trim(), kind, currency,
      target: parseMoney(String(fields.get('target')), false, currency), targetDate: String(fields.get('targetDate')) || undefined,
      transactionIds: fields.getAll('transactionIds').map(String) }); onClose();
  });
  return <Modal title={initial ? 'Edit goal' : 'Create goal'} onClose={onClose}><form className="form-stack" onSubmit={form.submit}>
    <label>Goal name<input name="name" required autoFocus maxLength={100} defaultValue={initial?.name}/></label>
    <label>Goal kind<select value={kind} onChange={e => setKind(e.target.value as Goal['kind'])}><option value="saving">Saving (linked income)</option><option value="spending">Spending (linked expenses)</option></select></label>
    <label>Currency<select value={currency} onChange={e => setCurrency(e.target.value as Currency)}>{currencies.map(c => <option key={c}>{c}</option>)}</select></label>
    <label>Target ({currency})<input key={currency} name="target" required inputMode={currency === 'JPY' ? 'numeric' : 'decimal'} defaultValue={initial && currency === currencyOf(initial) ? moneyInput(initial.target, currency) : ''}/></label>
    <label>Target date (optional)<input name="targetDate" type="date" defaultValue={initial?.targetDate}/></label>
    <PostedLinks key={`${kind}:${currency}`} data={data} type={kind === 'saving' ? 'income' : 'expense'} currency={currency} initial={initial?.transactionIds}/>
    <ErrorMessage error={form.error}/><div className="form-actions">{initial && <button type="button" className="button danger" disabled={form.busy} onClick={async () => { if (!confirm('Delete this goal? Posted transactions will be kept.')) return; try { await onDelete(initial.id); onClose(); } catch (e) { form.setError(errorText(e)); } }}>Delete goal</button>}<button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={form.busy}>Save goal</button></div>
  </form></Modal>;
}

export function GoalList({ data, onEdit }: { data: FinanceData; onEdit: (g: Goal) => void }) {
  return <div className="budgets-grid">{!(data.goals?.length) && <p>No goals yet. Link posted income to a saving goal, or expenses to a spending goal.</p>}{data.goals?.map(g => {
    const progress = goalProgress(data, g); const currency = currencyOf(g); const percent = Math.round(progress / g.target * 100);
    return <button className="budget-item card" key={g.id} onClick={() => onEdit(g)} aria-label={`Edit goal ${g.name}`}><div className="budget-top"><strong>{g.name}</strong><span>{percent}%</span></div><p>{g.kind === 'saving' ? 'Saving · linked income' : 'Spending · linked expenses'}{g.targetDate ? ` · Target ${g.targetDate}` : ''}</p><div className="progress-track" role="progressbar" aria-label={`${g.name} progress`} aria-valuenow={Math.min(percent, 100)} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${money(progress, currency)} of ${money(g.target, currency)}`}><span style={{ width: `${Math.min(percent, 100)}%`, backgroundColor: 'var(--primary)' }}/></div><p>{money(progress, currency)} of {money(g.target, currency)}</p></button>;
  })}</div>;
}
