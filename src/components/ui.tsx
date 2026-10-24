'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Banknote, Car, Coffee, HeartPulse, House, MoreHorizontal, ShoppingBag, Sparkles, X, type LucideIcon } from 'lucide-react';
import { money, type Category, type FinanceData, type Transaction } from '@/lib/finance';

export const categoryIcons: Record<Category['icon'], LucideIcon> = { food: Coffee, shopping: ShoppingBag, home: House, transport: Car, health: HeartPulse, fun: Sparkles, income: Banknote, other: MoreHorizontal };
export function AlmondMark() { return <svg viewBox="0 0 40 40" aria-hidden="true"><path d="M29 5C15 6 6 16 8 27c2 8 10 10 17 4C32 24 33 14 29 5Z" fill="currentColor"/><path d="M14 29 27 10" stroke="var(--logo-line, #f7f7f2)" strokeWidth="2" strokeLinecap="round"/></svg>; }
export function CategoryIcon({ category, transfer = false }: { category?: Category; transfer?: boolean }) {
  const Icon = transfer ? ArrowLeftRight : category ? categoryIcons[category.icon] : MoreHorizontal;
  const color = transfer ? '#789bb6' : category?.color ?? '#99938a';
  return <span className="category-icon" style={{ backgroundColor: `${color}20`, color }}><Icon size={19} strokeWidth={1.7}/></span>;
}
export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => { dialog?.close(); opener?.focus(); };
  }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} onCancel={e => { e.preventDefault(); onClose(); }} aria-labelledby="modal-title">
    <header className="modal-heading"><h2 id="modal-title">{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20}/></button></header>
    {children}
  </dialog>;
}
export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-mark"><AlmondMark/></span><h3>{title}</h3><p>{detail}</p>{action}</div>;
}
export function TransactionList({ data, transactions, onEdit, compact = false }: { data: FinanceData; transactions: Transaction[]; onEdit: (t: Transaction) => void; compact?: boolean }) {
  if (!transactions.length) return <EmptyState title="A fresh start" detail="Your transactions will appear here. Add your first one to get started."/>;
  return <div className={`transaction-list ${compact ? 'compact' : ''}`}>{transactions.map(t => {
    const category = data.categories.find(c => c.id === t.categoryId);
    const account = data.accounts.find(a => a.id === t.accountId);
    const date = new Date(`${t.date}T12:00:00`);
    return <button className="transaction-row" key={t.id} onClick={() => onEdit(t)} aria-label={`Edit ${t.title}, ${money(t.amount)}`}>
      <CategoryIcon category={category} transfer={t.type === 'transfer'}/>
      <span className="transaction-title"><strong>{t.title}</strong><span>{t.type === 'transfer' ? 'Transfer' : category?.name} <span className="dot">·</span> {account?.name}</span></span>
      <span className="transaction-date">{date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
      <strong className={`transaction-amount ${t.type === 'income' ? 'positive' : ''}`}>{t.type === 'income' ? '+' : t.type === 'expense' ? '−' : ''}{money(t.amount)}</strong>
    </button>;
  })}</div>;
}
export function TrendIcon({ income }: { income: boolean }) { return income ? <ArrowDownLeft size={18}/> : <ArrowUpRight size={18}/>; }
export function downloadJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
