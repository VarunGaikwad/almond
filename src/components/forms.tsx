'use client';
import { useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { currencies, currencyOf, moneyInput, localDate, parseMoney, type Currency, type Account, type Budget, type Category, type FinanceData, type Transaction } from '@/lib/finance';
import { Modal } from './ui';

export function ErrorMessage({ error }: { error: string }) { return error ? <p className="form-error" role="alert">{error}</p> : null; }
export function errorText(error: unknown) {
  if (error && typeof error === 'object' && 'issues' in error) return (error as { issues: { message: string }[] }).issues[0]?.message ?? 'Check your entries';
  return error instanceof Error ? error.message : 'Could not save. Try again.';
}
export function useSave(save: (form: FormData) => Promise<void>) {
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
  const [accountId, setAccountId] = useState(initial?.accountId ?? data.accounts.find(a => !a.archived)?.id ?? '');
  const currency = currencyOf(data.accounts.find(a => a.id === accountId));
  const destinations = data.accounts.filter(a => a.id !== accountId && currencyOf(a) === currency && (!a.archived || (initial?.type === 'transfer' && a.id === initial.toAccountId)));
  const form = useSave(async fields => {
    await onSave({ ...(initial?.scheduleId ? { scheduleId: initial.scheduleId, scheduledFor: initial.scheduledFor } : {}), id: initial?.id ?? crypto.randomUUID(), title: String(fields.get('title')).trim(), amount: parseMoney(String(fields.get('amount')), false, currency),
      type, date: String(fields.get('date')), accountId: String(fields.get('accountId')),
      ...(type === 'transfer' ? { toAccountId: String(fields.get('toAccountId')) } : { categoryId: String(fields.get('categoryId')) }),
      notes: String(fields.get('notes') ?? '').trim(),
    }); onClose();
  });
  return <Modal title={initial ? 'Edit transaction' : 'Add a transaction'} onClose={onClose}>
    <form onSubmit={form.submit} className="form-stack">
      <div className="segmented" aria-label="Transaction type">{(['expense', 'income', 'transfer'] as const).map(value => <button type="button" key={value} className={type === value ? 'active' : ''} aria-pressed={type === value} onClick={() => setType(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div>
      <label>Amount <span className="input-prefix"><span>{currency === 'JPY' ? '¥' : currency === 'INR' ? '₹' : '$'}</span><input key={currency} name="amount" aria-label={currency === 'USD' ? 'Amount in US dollars' : `Amount in ${currency}`} inputMode={currency === 'JPY' ? 'numeric' : 'decimal'} required autoFocus placeholder={currency === 'JPY' ? '0' : '0.00'} defaultValue={initial && currency === currencyOf(data.accounts.find(a => a.id === initial.accountId)) ? moneyInput(initial.amount, currency) : ''}/><small>{currency}</small></span></label>
      <label>Title<input name="title" required maxLength={100} placeholder={type === 'income' ? 'e.g. Monthly salary' : type === 'transfer' ? 'e.g. Monthly savings' : 'e.g. Coffee with a friend'} defaultValue={initial?.title}/></label>
      <div className="form-grid"><label>{type === 'transfer' ? 'From account' : 'Account'}<select name="accountId" aria-label={type === 'transfer' ? 'From account' : 'Account'} value={accountId} onChange={e => setAccountId(e.target.value)} required>{data.accounts.filter(a => !a.archived || a.id === initial?.accountId).map(a => <option key={a.id} value={a.id}>{a.name} ({currencyOf(a)}){a.archived ? ' · Archived' : ''}</option>)}</select></label>
      {type === 'transfer' ? <label>To account<select key={accountId} name="toAccountId" aria-label="To account" defaultValue={destinations.find(a => a.id === initial?.toAccountId)?.id ?? destinations[0]?.id ?? ''} required><option value="">Choose destination</option>{destinations.map(a => <option key={a.id} value={a.id}>{a.name} ({currencyOf(a)}){a.archived ? ' · Archived' : ''}</option>)}</select></label> : <label>Category<select key={type} name="categoryId" aria-label="Category" defaultValue={initial?.categoryId ?? (type === 'income' ? 'income' : data.categories[0]?.id)} required>{data.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}</div>
      <label>Date<input name="date" type="date" required defaultValue={initial?.date ?? localDate()}/></label>
      <label>Notes <span className="optional">optional</span><textarea name="notes" placeholder="Anything you’d like to remember" maxLength={1000} rows={2} defaultValue={initial?.notes}/></label>
      <ErrorMessage error={form.error}/>
      <div className="form-actions">{initial && <button type="button" className="button danger" disabled={form.busy} onClick={async () => { if (!confirm('Delete this transaction? This changes your account balance.')) return; try { await onDelete(initial.id); onClose(); } catch (e) { form.setError(errorText(e)); } }}><Trash2 size={16}/>Delete</button>}<button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={form.busy}>{form.busy ? 'Saving…' : 'Save transaction'}</button></div>
    </form>
  </Modal>;
}
export function AccountForm({ initial, hasTransactions, onSave, onDelete, onArchive, onClose }: {
  initial?: Account; hasTransactions: boolean; onSave: (a: Account) => Promise<void>;
  onDelete: (id: string) => Promise<void>; onArchive: (id: string, archived: boolean) => Promise<void>; onClose: () => void;
}) {
  const [currency, setCurrency] = useState<Currency>(currencyOf(initial));
  const [acting, setActing] = useState(false);
  async function accountAction(action: 'delete' | 'archive') {
    if (!initial || acting || form.busy) return;
    const message = action === 'delete'
      ? `Permanently delete ${initial.name}? Its opening balance (${moneyInput(initial.openingBalance, currency)} ${currency}) will be removed from your totals. This cannot be undone.`
      : initial.archived ? `Restore ${initial.name} for new transactions?` : `Archive ${initial.name}? Its balance and history stay in your reports, but it cannot be used for new transactions.`;
    if (!confirm(message)) return;
    setActing(true); form.setError('');
    try {
      if (action === 'delete') await onDelete(initial.id);
      else await onArchive(initial.id, !initial.archived);
      onClose();
    } catch (e) { form.setError(errorText(e)); }
    finally { setActing(false); }
  }
  const form = useSave(async fields => { await onSave({ id: initial?.id ?? crypto.randomUUID(), name: String(fields.get('name')).trim(), currency, archived: initial?.archived, type: String(fields.get('type')) as Account['type'], openingBalance: parseMoney(String(fields.get('balance')), true, currency), color: String(fields.get('color')) }); onClose(); });
  return <Modal title={initial ? 'Edit account' : 'A home for your money'} onClose={onClose}><form onSubmit={form.submit} className="form-stack">
    <p className="muted">Track an account manually. Almond does not connect to your bank.</p>
    <label>Account name<input name="name" autoFocus required maxLength={100} placeholder="e.g. Everyday account" defaultValue={initial?.name}/></label>
    <div className="form-grid"><label>Account type<select name="type" aria-label="Account type" defaultValue={initial?.type ?? 'checking'}>{['checking', 'savings', 'cash', 'credit'].map(t => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}</select></label><label>Color<input name="color" type="color" defaultValue={initial?.color ?? '#6d8163'}/></label></div>
    <label>Currency<select aria-label="Currency" value={currency} disabled={!!initial} onChange={e => setCurrency(e.target.value as Currency)}>{currencies.map(c => <option key={c} value={c}>{c === 'USD' ? 'USD — US dollar ($)' : c === 'JPY' ? 'JPY — Japanese yen (¥)' : 'INR — Indian rupee (₹)'}</option>)}</select></label><p className="field-hint">Currency cannot be changed after creating an account. Transfers require matching currencies.</p>
    <label>Opening balance ({currency})<input key={currency} name="balance" inputMode={currency === 'JPY' ? 'numeric' : 'decimal'} required defaultValue={initial ? moneyInput(initial.openingBalance, currency) : '0'}/></label><p className="field-hint">Balance before the transactions you enter. Use a negative amount for debt.</p>
    {initial && <><p className="field-hint">{hasTransactions ? 'This account has transactions or schedules and cannot be deleted. Archive it to keep its balance and history.' : 'This account has no transactions. You can permanently delete it, including its opening balance.'}</p><div className="inline-actions"><button type="button" className="button secondary" disabled={form.busy || acting} onClick={() => void accountAction('archive')}>{initial.archived ? 'Restore account' : 'Archive account'}</button><button type="button" className="button danger" disabled={hasTransactions || form.busy || acting} onClick={() => void accountAction('delete')}><Trash2 size={16}/>Delete account</button></div></>}
    <ErrorMessage error={form.error}/><div className="form-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={form.busy || acting}>{form.busy ? 'Saving…' : 'Save account'}</button></div>
  </form></Modal>;
}
export function BudgetForm({ data, month, initial, defaultCurrency = 'USD', onSave, onClose, onDelete }: { data: FinanceData; month: string; initial?: Budget; defaultCurrency?: Currency; onSave: (b: Budget) => Promise<void>; onClose: () => void; onDelete: (id: string) => Promise<void> }) {
  const [currency, setCurrency] = useState<Currency>(initial ? currencyOf(initial) : defaultCurrency);
  const [range, setRange] = useState(!!initial?.startDate);
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? initial?.categoryIds?.[0] ?? data.categories[0]?.id ?? '');
  const [extraCategories, setExtraCategories] = useState(initial?.categoryIds?.slice(1) ?? []);
  const [selectedOnly, setSelectedOnly] = useState(initial?.transactionIds !== undefined);
  const categoryIds = [categoryId, ...extraCategories.filter(id => id !== categoryId)];
  const form = useSave(async fields => { await onSave({ id: initial?.id ?? crypto.randomUUID(), currency,
    ...(categoryIds.length === 1 ? { categoryId } : { categoryIds }),
    ...(range ? { startDate: String(fields.get('startDate')), endDate: String(fields.get('endDate')) } : { month: String(fields.get('month')) }),
    ...(selectedOnly ? { transactionIds: fields.getAll('transactionIds').map(String) } : {}),
    amount: parseMoney(String(fields.get('amount')), false, currency) }); onClose(); });
  return <Modal title={initial ? 'Edit budget' : 'Make room for what matters'} onClose={onClose}><form onSubmit={form.submit} className="form-stack">
    <p className="muted">Set a spending limit for a month or any inclusive date range. Only posted expenses count.</p>
    <label>Category<select name="categoryId" aria-label="Category" value={categoryId} onChange={e => setCategoryId(e.target.value)} required>{data.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <fieldset><legend>Additional categories (optional)</legend>{data.categories.filter(c => c.id !== categoryId).map(c => <label key={c.id} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 32 }}><input type="checkbox" style={{ width: 'auto' }} checked={extraCategories.includes(c.id)} onChange={e => setExtraCategories(ids => e.target.checked ? [...ids, c.id] : ids.filter(id => id !== c.id))}/>{c.name}</label>)}</fieldset>
    <label>Currency<select aria-label="Currency" value={currency} onChange={e => setCurrency(e.target.value as Currency)}>{currencies.map(c => <option key={c}>{c}</option>)}</select></label>
    <label>{range ? 'Spending limit' : 'Monthly limit'} ({currency})<input key={currency} name="amount" inputMode={currency === 'JPY' ? 'numeric' : 'decimal'} required autoFocus placeholder={currency === 'JPY' ? '0' : '0.00'} defaultValue={initial && currency === currencyOf(initial) ? moneyInput(initial.amount, currency) : ''}/></label>
    <label>Budget period<select aria-label="Budget period" value={range ? 'range' : 'month'} onChange={e => setRange(e.target.value === 'range')}><option value="month">Monthly</option><option value="range">Date range (daily, weekly or custom)</option></select></label>
    {range ? <div className="form-grid"><label>Start date<input name="startDate" type="date" required defaultValue={initial?.startDate ?? `${month}-01`}/></label><label>End date<input name="endDate" type="date" required defaultValue={initial?.endDate ?? `${month}-01`}/></label></div> : <label>Month<input name="month" type="month" required defaultValue={initial?.month ?? month}/></label>}
    <label style={{ flexDirection: 'row', alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={selectedOnly} onChange={e => setSelectedOnly(e.target.checked)}/>Count only selected posted transactions</label>
    {selectedOnly && <PostedLinks key={`${currency}:${categoryIds.join(',')}`} data={data} type="expense" currency={currency} categoryIds={categoryIds} initial={initial?.transactionIds}/>}
    <ErrorMessage error={form.error}/><div className="form-actions">{initial && <button type="button" className="button danger" onClick={async () => { if (confirm('Delete this budget? Transactions will be kept.')) { try { await onDelete(initial.id); onClose(); } catch (e) { form.setError(errorText(e)); } } }}>Delete</button>}<button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={form.busy}>{form.busy ? 'Saving…' : 'Save budget'}</button></div>
  </form></Modal>;
}
export function PostedLinks({ data, type, currency, initial = [], categoryIds }: { data: FinanceData; type: 'income' | 'expense'; currency: Currency; initial?: string[]; categoryIds?: string[] }) {
  const [accountId, setAccountId] = useState('all');
  const rows = data.transactions.filter(t => t.type === type && currencyOf(data.accounts.find(a => a.id === t.accountId)) === currency && (!categoryIds || categoryIds.includes(t.categoryId!)));
  return <fieldset><legend>Linked posted transactions</legend><label>Show account<select aria-label="Show account" value={accountId} onChange={e => setAccountId(e.target.value)}><option value="all">All accounts</option>{data.accounts.filter(a => currencyOf(a) === currency).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><p className="field-hint">Filtering does not remove checked links. Dates outside a budget period do not count.</p>{rows.length ? rows.map(t => <label key={t.id} style={{ display: accountId !== 'all' && t.accountId !== accountId ? 'none' : 'flex', flexDirection: 'row', alignItems: 'center', minHeight: 32 }}><input type="checkbox" style={{ width: 'auto' }} name="transactionIds" value={t.id} defaultChecked={initial.includes(t.id)}/>{t.title} · {t.date} · {moneyInput(t.amount, currency)} {currency} · {data.accounts.find(a => a.id === t.accountId)?.name}</label>) : <p>No matching posted transactions.</p>}</fieldset>;
}
export function CategoryForm({ initial, onSave, onClose }: { initial?: Category; onSave: (c: Category) => Promise<void>; onClose: () => void }) {
  const form = useSave(async fields => { await onSave({ id: initial?.id ?? crypto.randomUUID(), name: String(fields.get('name')).trim(), color: String(fields.get('color')), icon: String(fields.get('icon')) as Category['icon'] }); onClose(); });
  return <Modal title={initial ? 'Edit category' : 'Add a category'} onClose={onClose}><form className="form-stack" onSubmit={form.submit}>
    <label>Name<input name="name" autoFocus required maxLength={100} defaultValue={initial?.name}/></label><div className="form-grid"><label>Icon<select name="icon" aria-label="Icon" defaultValue={initial?.icon ?? 'other'}>{['food', 'shopping', 'home', 'transport', 'health', 'fun', 'income', 'other'].map(icon => <option key={icon} value={icon}>{icon[0].toUpperCase() + icon.slice(1)}</option>)}</select></label><label>Color<input name="color" type="color" defaultValue={initial?.color ?? '#6d8163'}/></label></div>
    <ErrorMessage error={form.error}/><div className="form-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={form.busy}>Save category</button></div>
  </form></Modal>;
}
