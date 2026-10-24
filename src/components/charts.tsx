import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { categorySpending, money, totals, type FinanceData } from '@/lib/finance';
import { EmptyState } from './ui';

export function CashflowChart({ data, month }: { data: FinanceData; month: string }) {
  const summary = totals(data, month);
  const weeks = [0, 1, 2, 3, 4].map(index => {
    const entries = data.transactions.filter(t => t.date.startsWith(month) && Math.floor((Number(t.date.slice(-2)) - 1) / 7) === index);
    return { label: `${index * 7 + 1}–${Math.min(index * 7 + 7, new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate())}`, income: entries.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0), expense: entries.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0) };
  }).filter(w => Number(w.label.split('–')[0]) <= Number(w.label.split('–')[1]));
  const max = Math.max(...weeks.flatMap(w => [w.income, w.expense]), 10000);
  return <section className="card cashflow"><div className="card-heading"><div><h2>Money in, money out</h2><p>A little perspective on your month</p></div><span className="subtle-badge">This period</span></div>
    <div className="chart-summary"><span><i className="legend-dot income-dot"/>Income <strong>{money(summary.income)}</strong></span><span><i className="legend-dot expense-dot"/>Expenses <strong>{money(summary.expense)}</strong></span></div>
    <div className="bar-chart" role="img" aria-label={`Weekly income and expenses for ${month}. ${weeks.map(w => `Days ${w.label}: income ${money(w.income)}, expenses ${money(w.expense)}`).join('. ')}`}>
      <div className="chart-axis">{[1, .75, .5, .25, 0].map(n => <span key={n}>{new Intl.NumberFormat('en-US', { notation: 'compact', style: 'currency', currency: 'USD', maximumFractionDigits: 1 }).format(max * n / 100)}</span>)}</div>
      <div className="plot"><div className="grid-lines">{[0, 1, 2, 3, 4].map(i => <span key={i}/>)}</div><div className="bar-groups">{weeks.map(w => <div className="bar-group" key={w.label}><div className="bars"><div className="bar income-bar" style={{ height: `${w.income / max * 100}%` }} title={`Income: ${money(w.income)}`}/><div className="bar expense-bar" style={{ height: `${w.expense / max * 100}%` }} title={`Expenses: ${money(w.expense)}`}/></div><span>{w.label}</span></div>)}</div></div>
    </div><div className="chart-footnote"><span><ArrowDownLeft size={14}/> Income</span><span><ArrowUpRight size={14}/> Expenses</span><span>Day of month</span></div>
  </section>;
}
export function SpendingChart({ data, month }: { data: FinanceData; month: string }) {
  const spending = data.categories.map(c => ({ ...c, amount: categorySpending(data, month, c.id) })).filter(c => c.amount > 0).sort((a, b) => b.amount - a.amount);
  const total = spending.reduce((s, c) => s + c.amount, 0);
  let offset = 0;
  const stops = spending.map(c => { const start = offset; offset += c.amount / total * 100; return `${c.color} ${start}% ${offset}%`; });
  return <section className="card spending"><div className="card-heading"><div><h2>Where it went</h2><p>Spending by category</p></div></div>{total ? <>
    <div className="donut-wrap"><div className="donut" style={{ background: `conic-gradient(${stops.join(', ')})` }} role="img" aria-label={`Spending by category: ${spending.map(c => `${c.name} ${money(c.amount)}`).join(', ')}`}><div className="donut-hole"><span>Total spent</span><strong>{money(total)}</strong><small>{spending.length} categories</small></div></div></div>
    <div className="spending-legend">{spending.slice(0, 4).map(c => <div key={c.id}><span><i className="legend-dot" style={{ background: c.color }}/>{c.name}</span><strong>{Math.round(c.amount / total * 100)}%</strong></div>)}{spending.length > 4 && <div><span><i className="legend-dot" style={{ background: 'var(--muted)' }}/>Other categories</span><strong>{Math.round(spending.slice(4).reduce((s, c) => s + c.amount, 0) / total * 100)}%</strong></div>}</div>
  </> : <EmptyState title="Nothing spent yet" detail="Add an expense to see your spending breakdown."/>}</section>;
}
