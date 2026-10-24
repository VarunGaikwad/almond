'use client';
import { useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { localDate, parseMoney, type Account, type Budget, type Category, type FinanceData, type Transaction } from '@/lib/finance';
import { Modal } from './ui';

function ErrorMessage({ error }: { error: string }) { return error ? <p className="form-error" role="alert">{error}</p> : null; }
function errorText(error: unknown) {
  if (error && typeof error === 'object' && 'issues' in error) return (error as { issues: { message: string }[] }).issues[0]?.message ?? 'Check your entries';
  return error instanceof Error ? error.message : 'Could not save. Try again.';
}
function useSave(save: (form: FormData) => Promise<void>) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try { await save(new FormData(event.currentTarget)); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return { busy, error, submit, setError };
}
export function TransactionForm({ data, initial, onSave, onDelete, onClose }: {
  data: FinanceData; initial?: Transaction; onSave: (t: Transaction) => Promise<void>; onDelete: (id: string) => Promise<void>; onClose: () => void;
}) {
  const [type, setType] = useState<Transaction['type']>(initial?.type ?? 'expense');
  const form = useSave(async fields => {
    await onSave({ id: initial?.id ?? crypto.randomUUID(), title: String(fields.get('title')).trim(), amount: parseMoney(String(fields.get('amount'))),
      type, date: String(fields.get('date')), accountId: String(fields.get('accountId')),
      ...(type === 'transfer' ? { toAccountId: String(fields.get('toAccountId')) } : { categoryId: String(fields.get('categoryId')) }),
      notes: String(fields.get('notes') ?? '').trim(),
    }); onClose();
  });
  return <Modal title={initial ? 'Edit transaction' : 'Add a transaction'} onClose={onClose}>
    <form onSubmit={form.submit} className="form-stack">
      <div className="segmented" aria-label="Transaction type">{(['expense', 'income', 'transfer'] as const).map(value => <button type="button" key={value} className={type === value ? 'active' : ''} aria-pressed={type === value} onClick={() => setType(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div>
      <label>Amount <span className="input-prefix"><span>$</span><input name="amount" aria-label="Amount in US dollars" inputMode="decimal" required autoFocus placeholder="0.00" defaultValue={initial ? (initial.amount / 100).toFixed(2) : ''}/><small>USD</small></span></label>
      <label>Title<input name="title" required maxLength={100} placeholder={type === 'income' ? 'e.g. Monthly salary' : type === 'transfer' ? 'e.g. Monthly savings' : 'e.g. Coffee with a friend'} defaultValue={initial?.title}/></label>
      <div className="form-grid"><label>{type === 'transfer' ? 'From account' : 'Account'}<select name="accountId" defaultValue={initial?.accountId ?? data.accounts[0]?.id} required>{data.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      {type === 'transfer' ? <label>To account<select name="toAccountId" defaultValue={initial?.toAccountId ?? data.accounts[1]?.id} required>{data.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label> : <label>Category<select key={type} name="categoryId" defaultValue={initial?.categoryId ?? (type === 'income' ? 'income' : data.categories[0]?.id)} required>{data.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}</div>
      <label>Date<input name="date" type="date" required defaultValue={initial?.date ?? localDate()}/></label>
      <label>Notes <span className="optional">optional</span><textarea name="notes" placeholder="Anything you’d like to remember" maxLength={1000} rows={2} defaultValue={initial?.notes}/></label>
      <ErrorMessage error={form.error}/>
      <div className="form-actions">{initial && <button type="button" className="button danger" disabled={form.busy} onClick={async () => { if (!confirm('Delete this transaction? This changes your account balance.')) return; try { await onDelete(initial.id); onClose(); } catch (e) { form.setError(errorText(e)); } }}><Trash2 size={16}/>Delete</button>}<button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={form.busy}>{form.busy ? 'Saving…' : 'Save transaction'}</button></div>
    </form>
  </Modal>;
}
export function AccountForm({ initial, onSave, onClose }: { initial?: Account; onSave: (a: Account) => Promise<void>; onClose: () => void }) {
  const form = useSave(async fields => { await onSave({ id: initial?.id ?? crypto.randomUUID(), name: String(fields.get('name')).trim(), type: String(fields.get('type')) as Account['type'], openingBalance: parseMoney(String(fields.get('balance')), true), color: String(fields.get('color')) }); onClose(); });
  return <Modal title={initial ? 'Edit account' : 'A home for your money'} onClose={onClose}><form onSubmit={form.submit} className="form-stack">
    <p className="muted">Track an account manually. Almond does not connect to your bank.</p>
    <label>Account name<input name="name" autoFocus required maxLength={100} placeholder="e.g. Everyday account" defaultValue={initial?.name}/></label>
    <div className="form-grid"><label>Account type<select name="type" defaultValue={initial?.type ?? 'checking'}>{['checking', 'savings', 'cash', 'credit'].map(t => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}</select></label><label>Color<input name="color" type="color" defaultValue={initial?.color ?? '#6d8163'}/></label></div>
    <label>Opening balance (USD)<input name="balance" inputMode="decimal" required defaultValue={initial ? (initial.openingBalance / 100).toFixed(2) : '0.00'}/></label><p className="field-hint">Balance before the transactions you enter. Use a negative amount for debt.</p>
    <ErrorMessage error={form.error}/><div className="form-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={form.busy}>{form.busy ? 'Saving…' : 'Save account'}</button></div>
  </form></Modal>;
}
export function BudgetForm({ data, month, initial, onSave, onClose, onDelete }: { data: FinanceData; month: string; initial?: Budget; onSave: (b: Budget) => Promise<void>; onClose: () => void; onDelete: (id: string) => Promise<void> }) {
  const form = useSave(async fields => { await onSave({ id: initial?.id ?? crypto.randomUUID(), categoryId: String(fields.get('categoryId')), month: String(fields.get('month')), amount: parseMoney(String(fields.get('amount'))) }); onClose(); });
  return <Modal title={initial ? 'Edit budget' : 'Make room for what matters'} onClose={onClose}><form onSubmit={form.submit} className="form-stack">
    <p className="muted">Set a monthly spending limit for a category.</p>
    <label>Category<select name="categoryId" aria-label="Category" defaultValue={initial?.categoryId} required>{data.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label>Monthly limit (USD)<input name="amount" inputMode="decimal" required autoFocus placeholder="0.00" defaultValue={initial ? (initial.amount / 100).toFixed(2) : ''}/></label>
    <label>Month<input name="month" type="month" required defaultValue={initial?.month ?? month}/></label>
    <ErrorMessage error={form.error}/><div className="form-actions">{initial && <button type="button" className="button danger" onClick={async () => { if (confirm('Delete this budget? Transactions will be kept.')) { try { await onDelete(initial.id); onClose(); } catch (e) { form.setError(errorText(e)); } } }}>Delete</button>}<button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={form.busy}>{form.busy ? 'Saving…' : 'Save budget'}</button></div>
  </form></Modal>;
}
export function CategoryForm({ initial, onSave, onClose }: { initial?: Category; onSave: (c: Category) => Promise<void>; onClose: () => void }) {
  const form = useSave(async fields => { await onSave({ id: initial?.id ?? crypto.randomUUID(), name: String(fields.get('name')).trim(), color: String(fields.get('color')), icon: String(fields.get('icon')) as Category['icon'] }); onClose(); });
  return <Modal title={initial ? 'Edit category' : 'Add a category'} onClose={onClose}><form className="form-stack" onSubmit={form.submit}>
    <label>Name<input name="name" autoFocus required maxLength={100} defaultValue={initial?.name}/></label><div className="form-grid"><label>Icon<select name="icon" defaultValue={initial?.icon ?? 'other'}>{['food', 'shopping', 'home', 'transport', 'health', 'fun', 'income', 'other'].map(icon => <option key={icon} value={icon}>{icon[0].toUpperCase() + icon.slice(1)}</option>)}</select></label><label>Color<input name="color" type="color" defaultValue={initial?.color ?? '#6d8163'}/></label></div>
    <ErrorMessage error={form.error}/><div className="form-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={form.busy}>Save category</button></div>
  </form></Modal>;
}
