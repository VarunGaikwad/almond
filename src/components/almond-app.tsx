'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDownLeft, ArrowLeftRight, ArrowRight, ArrowUpRight, BarChart3, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, Cloud, CloudOff, Download, LayoutDashboard, LogOut, Menu, Moon, Plus, Search, Settings2, ShieldCheck, SlidersHorizontal, Sun, Target, Upload, Wallet, WifiOff, X, RefreshCw, Pencil, Tag, Landmark, Banknote, PiggyBank, CreditCard, type LucideIcon } from 'lucide-react';
import { accountBalance, accountHasTransactions, deleteAccount, setAccountArchived, assertActiveTransactionAccounts, categorySpending, currentMonth, localDate, money as formatMoney, currencies, currencyOf, dataForCurrency, totals, type Currency, type Account, type Budget, type Category, type FinanceData, type Transaction } from '@/lib/finance';
import { changeData, db, ensureWorkspace, resolveConflict, recordPayment } from '@/lib/store';
import { syncWorkspace } from '@/lib/sync';
import { createBackup, parseBackup } from '@/lib/data-format';
import { ExchangeReporting } from './exchange';
import { authClient } from '@/lib/auth-client';
import { rememberAccount } from '@/lib/workspace-access';
import { AccountForm, BudgetForm, CategoryForm, TransactionForm } from './forms';
import { AlmondMark, CategoryIcon, downloadJson, EmptyState, TransactionList } from './ui';
import { CashflowChart, SpendingChart } from './charts';
import { ScheduleForm, ScheduleList } from './schedules';
import { saveSchedule } from '@/lib/schedules';
import { deleteTransaction, type Goal, type Schedule } from '@/lib/finance';
import { budgetCategories, budgetOverlapsMonth, budgetProgress, budgetRange } from '@/lib/budgets';
import { saveGoal } from '@/lib/goals';
import { GoalForm, GoalList } from './goals';
import { CsvImport } from './csv-import';
import { validateCsvImport } from '@/lib/csv-import';
import { DashboardPreferences } from './dashboard-preferences';
import { loadPreferences, savePreferences, type DashboardPreferences as Preferences } from '@/lib/preferences';

type Page = 'goals' | 'schedules' | 'overview' | 'transactions' | 'budgets' | 'accounts' | 'reports' | 'settings';
type Editor = { kind: 'goal'; item?: Goal } | { kind: 'schedule'; item?: Schedule } | { kind: 'transaction'; item?: Transaction } | { kind: 'account'; item?: Account } | { kind: 'budget'; item?: Budget } | { kind: 'category'; item?: Category };
const navigation: { id: Page; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard }, { id: 'transactions', label: 'Transactions', icon: ArrowLeftRight },
  { id: 'schedules', label: 'Schedules', icon: CalendarDays },
  { id: 'goals', label: 'Goals', icon: PiggyBank },
  { id: 'budgets', label: 'Budgets', icon: Target }, { id: 'accounts', label: 'Accounts', icon: Wallet }, { id: 'reports', label: 'Reports', icon: BarChart3 },
];
const accountIcons = { checking: Landmark, savings: PiggyBank, cash: Banknote, credit: CreditCard };
const titles: Record<Page, [string, string]> = {
  goals: ['A little closer every day.', 'Saving and spending goals, grounded in your posted transactions.'],
  overview: ['Your money, in balance.', 'A little clarity. A lot more peace of mind.'],
  schedules: ['A little planning ahead.', 'Recurring and upcoming payments, on your terms.'],
  transactions: ['The little things add up.', 'Every expense, every income, all in one place.'],
  budgets: ['Room for what matters.', 'A thoughtful plan for your everyday spending.'],
  accounts: ['A place for every penny.', 'Your accounts, together in one calm corner.'],
  reports: ['See the bigger picture.', 'Understand your habits. Make your next move.'],
  settings: ['Make yourself at home.', 'Your preferences, your data, your way.'],
};
function friendlyError(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Your saved data is unchanged.'; }

export default function AlmondApp({ scope, configured, onSignedOut }: { scope: string; configured: boolean; onSignedOut: () => void }) {
  const [page, setPage] = useState<Page>('overview');
  const [currency, setCurrency] = useState<Currency>('USD');
  const money = (amount: number) => formatMoney(amount, currency);
  const [month, setMonth] = useState(currentMonth);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [dark, setDark] = useState(false);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [toast, setToast] = useState('');
  const [storageError, setStorageError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [accountFilter, setAccountFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const importRef = useRef<HTMLInputElement>(null);
  const workspace = useLiveQuery(() => db.workspaces.get(scope), [scope]);
  const notify = useCallback((message: string) => setToast(message), []);

  useEffect(() => {
    const savedPreferences = loadPreferences();
    document.documentElement.dataset.accent = savedPreferences.accent;
    setPreferences(savedPreferences);
    try {
      setDark(localStorage.getItem('almond-theme') === 'dark');
    } catch { /* IndexedDB will surface a persistent storage error separately. */ }
    const updateConnectivity = () => setOnline(navigator.onLine);
    const navigateHash = () => { const hash = location.hash.slice(1); if ([...navigation.map(n => n.id), 'settings'].includes(hash as Page)) setPage(hash as Page); };
    updateConnectivity(); navigateHash();
    window.addEventListener('online', updateConnectivity); window.addEventListener('offline', updateConnectivity); window.addEventListener('hashchange', navigateHash);
    return () => { window.removeEventListener('online', updateConnectivity); window.removeEventListener('offline', updateConnectivity); window.removeEventListener('hashchange', navigateHash); };
  }, [notify]);
  useEffect(() => {
    ensureWorkspace(scope).catch(e => setStorageError(friendlyError(e)));
    setSyncError('');
  }, [scope]);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; try { localStorage.setItem('almond-theme', dark ? 'dark' : 'light'); } catch { /* Optional preference. */ } }, [dark]);
  useEffect(() => {
    if (!preferences) return;
    document.documentElement.dataset.accent = preferences.accent;
    savePreferences(preferences);
  }, [preferences]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 6500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    if (!mobileNav) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const links = Array.from(document.querySelectorAll<HTMLElement>('.sidebar a, .sidebar button'));
    links[0]?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setMobileNav(false); }
      if (event.key === 'Tab' && links.length) {
        if (event.shiftKey && document.activeElement === links[0]) { event.preventDefault(); links.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === links.at(-1)) { event.preventDefault(); links[0].focus(); }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); opener?.focus(); };
  }, [mobileNav]);
  const synchronize = useCallback(async () => {
    if (!navigator.onLine) return;
    setSyncing(true); setSyncError('');
    try { await syncWorkspace(scope); } catch (e) { setSyncError(friendlyError(e)); } finally { setSyncing(false); }
  }, [scope]);
  useEffect(() => {
    if (!workspace || !online || configured !== true || workspace.conflict) return;
    const timer = setTimeout(() => void synchronize(), 700);
    return () => clearTimeout(timer);
  }, [scope, online, configured, workspace?.sequence, workspace?.dirty, Boolean(workspace), Boolean(workspace?.conflict), synchronize]);
  useEffect(() => {
    const foreground = () => { if (document.visibilityState === 'visible' && configured === true) void synchronize(); };
    const timer = setInterval(foreground, 60_000);
    document.addEventListener('visibilitychange', foreground);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', foreground); };
  }, [configured, synchronize]);

  function navigate(next: Page) { setPage(next); location.hash = next; setMobileNav(false); }
  function shiftMonth(delta: number) { const date = new Date(`${month}-15T12:00:00`); date.setMonth(date.getMonth() + delta); setMonth(localDate(date).slice(0, 7)); }
  async function saveEntity<K extends 'transactions' | 'accounts' | 'budgets' | 'categories'>(key: K, entity: FinanceData[K][number]) {
    await changeData(scope, data => {
      if (key === 'transactions') assertActiveTransactionAccounts(data, entity as Transaction);
      const rows = data[key] as { id: string }[];
      const index = rows.findIndex(row => row.id === entity.id);
      if (index >= 0) rows[index] = entity; else rows.push(entity);
    }); notify('Saved. A little more in order.');
  }
  async function removeEntity(key: 'transactions' | 'budgets', id: string) {
    await changeData(scope, data => { if (key === 'transactions') deleteTransaction(data, id); else data.budgets = data.budgets.filter(b => b.id !== id); }); notify('Deleted. Your totals are up to date.');
  }
  async function removeAccount(id: string) {
    await changeData(scope, data => deleteAccount(data, id));
    if (accountFilter === id) setAccountFilter('all');
    notify('Account deleted. Your totals are up to date.');
  }
  async function archiveAccount(id: string, archived: boolean) {
    await changeData(scope, data => setAccountArchived(data, id, archived));
    notify(archived ? 'Account archived. Your balance and history are preserved.' : 'Account restored.');
  }
  function newTransaction() {
    if (!workspace?.data.accounts.some(a => !a.archived)) { notify('First, add or restore an account for your transactions.'); setEditor({ kind: 'account' }); }
    else setEditor({ kind: 'transaction' });
  }
  async function signOut() {
    if (workspace?.dirty || workspace?.pending || workspace?.conflict) { notify('Sync or resolve your changes before signing out. You can export a backup in Settings.'); return; }
    if (!confirm('Sign out and remove this account’s offline copy from this browser? Synced data stays in your cloud account.')) return;
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error(result.error.message ?? 'Could not sign out');
      rememberAccount(null);
      try { await db.workspaces.delete(scope); }
      finally { onSignedOut(); }
    } catch (e) { notify(friendlyError(e)); }
  }
  function exportBackup() { if (workspace) { downloadJson(createBackup(workspace.data), `almond-backup-${localDate()}.json`); notify('Backup downloaded. Keep it somewhere safe.'); } }
  async function importBackup(file?: File) {
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error('Choose an Almond backup smaller than 2 MB.');
      const data = parseBackup(await file.text());
      if (!confirm(`Replace this workspace with ${data.accounts.length} accounts and ${data.transactions.length} transactions? Export a backup of your current data first.`)) return;
      await changeData(scope, current => Object.assign(current, { schedules: undefined, goals: undefined, exchangeRates: undefined }, data)); notify('Backup restored.');
    } catch (e) { notify(e && typeof e === 'object' && 'issues' in e ? 'This backup has invalid financial records. Nothing was imported.' : friendlyError(e)); }
    finally { if (importRef.current) importRef.current.value = ''; }
  }

  if (storageError) return <main className="startup"><AlmondMark/><h1>Your data needs a safe place.</h1><p>Almond needs browser storage. Enable IndexedDB or use a regular browser window, then reload.</p><p role="alert">{storageError}</p><button className="button primary" onClick={() => location.reload()}>Try again</button></main>;
  if (!workspace || !preferences) return <main className="startup" role="status"><AlmondMark/><h1>Making a little room…</h1><p>Opening your Almond workspace.</p></main>;
  const data = workspace.data;
  const currencyData = dataForCurrency(data, currency);
  const summary = totals(data, month, currency);
  const monthLabel = new Date(`${month}-15T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const monthlyTransactions = [...data.transactions].filter(t => t.date.startsWith(month)).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const visibleTransactions = monthlyTransactions.filter(t =>
    (filter === 'all' || t.type === filter) && (accountFilter === 'all' || t.accountId === accountFilter || t.toAccountId === accountFilter) &&
    (categoryFilter === 'all' || t.categoryId === categoryFilter) && `${t.title} ${t.notes ?? ''}`.toLowerCase().includes(query.toLowerCase()),
  );
  const budgets = currencyData.budgets.filter(b => budgetOverlapsMonth(b, month));
  const budgetLimit = budgets.reduce((s, b) => s + b.amount, 0);
  const budgetSpent = budgets.reduce((s, b) => s + budgetProgress(data, b), 0);
  const syncLabel = !online ? 'Offline · saved on device' : workspace.conflict ? 'Sync conflict · action needed' : syncing ? 'Syncing your changes…' : syncError ? 'Sync needs attention' : workspace.dirty ? 'Changes waiting to sync' : workspace.syncedAt ? 'All changes synced' : 'Cloud workspace';
  const title = titles[page];

  function budgetCard(budget: Budget, compact = false) {
    const categories = budgetCategories(budget).map(id => data.categories.find(c => c.id === id)!);
    const category = categories[0];
    const name = categories.map(c => c.name).join(' + ');
    const [start, end] = budgetRange(budget);
    const spent = budgetProgress(data, budget);
    const percent = Math.round(spent / budget.amount * 100);
    return <button className={`budget-item ${compact ? 'compact-budget' : 'card'}`} key={budget.id} onClick={() => setEditor({ kind: 'budget', item: budget })} aria-label={`Edit ${name} budget`}>
      <div className="budget-top"><CategoryIcon category={category}/><span><strong>{name}</strong><small>{start} – {end}{budget.transactionIds ? ' · Selected postings' : ''}</small></span><span className={`budget-percent ${percent > 100 ? 'over' : ''}`}>{percent}%</span></div>
      <div className="progress-track" role="progressbar" aria-label={`${name} budget used`} aria-valuenow={Math.min(percent, 100)} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${money(spent)} spent of ${money(budget.amount)}`}><span style={{ width: `${Math.min(percent, 100)}%`, backgroundColor: percent > 100 ? 'var(--danger)' : category.color }}/></div>
      <div className="budget-numbers"><span><strong>{money(spent)}</strong> <span>of {money(budget.amount)}</span></span>{!compact && <span className={percent > 100 ? 'negative' : ''}>{money(Math.abs(budget.amount - spent))} {percent > 100 ? 'over' : 'left'}</span>}</div>
    </button>;
  }

  return <div className="app-shell">
    <a href="#main-content" className="skip-link">Skip to content</a>
    {mobileNav && <button className="nav-backdrop" aria-label="Close navigation" onClick={() => setMobileNav(false)}/>}
    <aside className={`sidebar ${mobileNav ? 'is-open' : ''}`} aria-label="Main navigation">
      <a className="brand" href="#overview" onClick={() => navigate('overview')}><span className="brand-mark"><AlmondMark/></span><span>almond<span className="brand-dot">.</span></span></a>
      <div className="workspace-label">YOUR WORKSPACE</div>
      <nav>{navigation.map(({ id, label, icon: Icon }) => <a href={`#${id}`} key={id} className={`nav-item ${page === id ? 'active' : ''}`} aria-current={page === id ? 'page' : undefined} onClick={() => navigate(id)}><Icon size={20} strokeWidth={1.7}/><span>{label}</span>{page === id && <i/>}</a>)}</nav>
      <div className="sidebar-bottom"><div className="gentle-note"><span className="note-icon"><AlmondMark/></span><h3>Small steps.<br/>Brighter tomorrows.</h3><p>A little attention today goes a long way.</p></div>
        <a href="#settings" className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')} aria-current={page === 'settings' ? 'page' : undefined}><Settings2 size={20} strokeWidth={1.7}/>Settings</a>
        <button className="profile-button" onClick={() => navigate('settings')}><span className="avatar">A</span><span><strong>Your personal space</strong><small>Manage your account</small></span><ChevronRight size={16}/></button>
      </div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Open navigation" aria-expanded={mobileNav} onClick={() => setMobileNav(!mobileNav)}><Menu size={22}/></button><span>My workspace</span><ChevronRight size={14}/><strong>{page[0].toUpperCase() + page.slice(1)}</strong></div><div className="topbar-actions"><span className={`sync-status ${syncError || workspace.conflict ? 'negative' : ''}`}><span className={`status-dot ${!online ? 'offline' : ''}`}/>{syncLabel}</span><button className="icon-button" aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => setDark(!dark)}>{dark ? <Sun size={19}/> : <Moon size={19}/>}</button><button className="avatar avatar-button" aria-label="Account settings" onClick={() => navigate('settings')}>A</button></div></header>
      <main id="main-content" className="main-content">
        <div className="page-heading"><div><div className="eyebrow">A CALMER PLACE FOR YOUR MONEY</div><h1>{title[0]}</h1><p>{title[1]}</p></div><div className="page-actions">{page !== 'settings' && page !== 'transactions' && page !== 'schedules' && <label>View currency<select aria-label="View currency" value={currency} onChange={e => setCurrency(e.target.value as Currency)}>{currencies.map(c => <option key={c}>{c}</option>)}</select></label>}{page !== 'settings' && page !== 'accounts' && page !== 'schedules' && page !== 'goals' && <div className="month-picker"><button aria-label="Previous month" onClick={() => shiftMonth(-1)}><ChevronLeft size={17}/></button><label><CalendarDays size={15}/><span>{monthLabel}</span><input aria-label="Selected month" type="month" value={month} onChange={e => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) setMonth(e.target.value); }}/></label><button aria-label="Next month" onClick={() => shiftMonth(1)}><ChevronRight size={17}/></button></div>}
        {page === 'goals' ? <button className="button primary" onClick={() => setEditor({ kind: 'goal' })}><Plus size={17}/>Create goal</button> : page === 'schedules' ? <button className="button primary" onClick={() => setEditor({ kind: 'schedule' })}><Plus size={17}/>Create schedule</button> : page === 'accounts' ? <button className="button primary" onClick={() => setEditor({ kind: 'account' })}><Plus size={17}/>Add account</button> : page === 'budgets' ? <button className="button primary" onClick={() => setEditor({ kind: 'budget' })}><Plus size={17}/>Create budget</button> : page !== 'settings' && <button className="button primary" onClick={newTransaction}><Plus size={17}/>Add transaction</button>}</div></div>
        {!online && <div className="notice"><WifiOff size={18}/><span>You’re offline. Keep going — your changes stay on this device until you reconnect.</span></div>}
        {syncError && <div className="notice warning"><CloudOff size={18}/><span>{syncError}</span><a href="/login">Sign in</a><button onClick={() => void synchronize()}>Retry</button></div>}
        {workspace.conflict && <section className="conflict-box" role="alert"><h2>Both devices made changes.</h2><p>Neither copy has been discarded. Download both before choosing which entire workspace to keep. Automatic merging is not available yet.</p><div className="inline-actions"><button className="button secondary" onClick={() => downloadJson(createBackup(workspace.data), 'almond-conflict-local.json')}>Download this device’s copy</button><button className="button secondary" onClick={() => downloadJson(createBackup(workspace.conflict!.data), 'almond-conflict-cloud.json')}>Download cloud copy</button><button className="button secondary" onClick={() => { if (confirm('Replace this device’s workspace with the cloud copy? Download your local copy first.')) void resolveConflict(scope, 'remote').catch(e => notify(friendlyError(e))); }}>Keep cloud copy</button><button className="button primary" onClick={() => { if (confirm('Replace the cloud workspace with this device’s copy? Download the cloud copy first.')) void resolveConflict(scope, 'local').catch(e => notify(friendlyError(e))); }}>Keep this device’s copy</button></div></section>}

        {page === 'goals' && <GoalList data={currencyData} onEdit={item => setEditor({ kind: 'goal', item })}/>}
        {page === 'schedules' && <ScheduleList data={data} onEdit={item => setEditor({ kind: 'schedule', item })} onRecord={(id, due) => recordPayment(scope, id, due)}/>}
        {(page === 'overview' || page === 'reports') && <>
          <div className="summary-grid"><section className="balance-card"><div className="balance-top"><span><Wallet size={17}/>Total balance</span><span className="balance-decoration"><AlmondMark/></span></div><strong className="hero-number">{money(summary.balance)}</strong><div className="balance-bottom"><span>Across {currencyData.accounts.length} {currencyData.accounts.length === 1 ? 'account' : 'accounts'}</span><button aria-label="View accounts" onClick={() => navigate('accounts')}><ArrowUpRight size={20}/></button></div></section>
          <section className="stat-card card"><span className="stat-label"><span className="stat-icon income"><ArrowDownLeft size={21}/></span>Income</span><strong className="stat-number">{money(summary.income)}</strong><span className="stat-foot"><i className="legend-dot income-dot"/>Money coming in this month</span></section>
          <section className="stat-card card"><span className="stat-label"><span className="stat-icon expense"><ArrowUpRight size={21}/></span>Expenses</span><strong className="stat-number">{money(summary.expense)}</strong><span className="stat-foot"><i className="legend-dot expense-dot"/>Money going out this month</span></section></div>
          {(page === 'reports' || preferences.sections.cashflow || preferences.sections.spending) && <div className={`chart-grid ${page === 'overview' && preferences.sections.cashflow !== preferences.sections.spending ? 'single-widget' : ''}`}>
            {(page === 'reports' || preferences.sections.cashflow) && <CashflowChart data={currencyData} month={month} currency={currency}/>}
            {(page === 'reports' || preferences.sections.spending) && <SpendingChart data={currencyData} month={month} currency={currency}/>}
          </div>}
        </>}
        {page === 'overview' && (preferences.sections.recent || preferences.sections.budgets) && <div className={`detail-grid ${preferences.sections.recent !== preferences.sections.budgets ? 'single-widget' : ''}`}>
          {preferences.sections.recent && <section className="card recent-transactions"><div className="card-heading"><div><h2>The latest little things</h2><p>Your recent transactions</p></div><button className="text-button" onClick={() => navigate('transactions')}>View all <ArrowRight size={15}/></button></div><TransactionList data={data} transactions={monthlyTransactions.filter(t => currencyOf(data.accounts.find(a => a.id === t.accountId)) === currency).slice(0, 5)} onEdit={item => setEditor({ kind: 'transaction', item })} compact/></section>}{preferences.sections.budgets && <section className="card budget-preview"><div className="card-heading"><div><h2>Staying on track</h2><p>A check-in with your budgets</p></div><button className="icon-button" aria-label="View all budgets" onClick={() => navigate('budgets')}><ArrowUpRight size={19}/></button></div>{budgets.length ? budgets.slice(0, 3).map(b => budgetCard(b, true)) : <EmptyState title="Give your money a plan" detail="Create your first monthly budget." action={<button className="button secondary" onClick={() => setEditor({ kind: 'budget' })}>Create budget</button>}/>}</section>}</div>}

        {page === 'transactions' && <section className="card transactions-page"><div className="transaction-toolbar"><label className="search-field"><Search size={18}/><input type="search" aria-label="Search transactions" placeholder="Search your transactions…" value={query} onChange={e => setQuery(e.target.value)}/></label><div className="filter-group"><SlidersHorizontal size={17}/><select aria-label="Filter by account" value={accountFilter} onChange={e => setAccountFilter(e.target.value)}><option value="all">All accounts</option>{data.accounts.map(a => <option value={a.id} key={a.id}>{a.name}</option>)}</select><select aria-label="Filter by category" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}><option value="all">All categories</option>{data.categories.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></div></div><div className="transaction-tabs">{['all', 'expense', 'income', 'transfer'].map(type => <button className={filter === type ? 'active' : ''} aria-pressed={filter === type} key={type} onClick={() => setFilter(type)}>{type === 'all' ? 'All transactions' : type === 'expense' ? 'Expenses' : type === 'income' ? 'Income' : 'Transfers'}</button>)}<span>{visibleTransactions.length} entries</span></div>{visibleTransactions.length ? <TransactionList data={data} transactions={visibleTransactions} onEdit={item => setEditor({ kind: 'transaction', item })}/> : <EmptyState title="A little quiet here" detail="No transactions match this month and your filters." action={<button className="button secondary" onClick={newTransaction}><Plus size={16}/>Add transaction</button>}/>}</section>}

        {page === 'budgets' && <><section className="budget-summary"><div><span className="eyebrow">BUDGET PERIODS OVERLAPPING THIS MONTH</span><h2>{money(Math.max(0, budgetLimit - budgetSpent))}<small>remaining in your budgets</small></h2><p>{money(budgetSpent)} spent of {money(budgetLimit)} planned{budgetSpent > budgetLimit ? ` · ${money(budgetSpent - budgetLimit)} over budget` : ''}</p></div><div className="budget-summary-icon"><Target size={58} strokeWidth={1}/></div></section><div className="budgets-grid">{budgets.map(b => budgetCard(b))}<button className="add-budget-card" onClick={() => setEditor({ kind: 'budget' })}><span><Plus size={24}/></span><strong>A little more intention</strong><p>Create a new budget</p></button></div></>}

        {page === 'accounts' && <><div className="section-intro"><span>Total across your {currency} accounts</span><strong>{money(summary.balance)}</strong><p>{currency} · Totals are separate; no currency conversion</p></div><div className="accounts-grid">{data.accounts.map(account => { const Icon = accountIcons[account.type]; return <section className="card account-card" key={account.id}><div className="account-card-top"><span className="account-icon" style={{ color: account.color, background: `${account.color}20` }}><Icon size={25} strokeWidth={1.5}/></span><button className="icon-button" aria-label={`Edit ${account.name}`} onClick={() => setEditor({ kind: 'account', item: account })}><Pencil size={16}/></button></div><span className="account-type">{account.type} · {currencyOf(account)}{account.archived ? ' · Archived' : ''}</span><h2>{account.name}</h2><strong className="account-balance">{formatMoney(accountBalance(data, account.id), currencyOf(account))}</strong><button className="account-link" onClick={() => { setAccountFilter(account.id); setCategoryFilter('all'); setQuery(''); setFilter('all'); navigate('transactions'); }}>View transactions <ArrowRight size={16}/></button></section>; })}<button className="add-budget-card" onClick={() => setEditor({ kind: 'account' })}><span><Plus size={24}/></span><strong>A new place for your money</strong><p>Add an account</p></button></div></>}

        {page === 'reports' && <section className="card report-detail"><div className="card-heading"><div><h2>Your month, at a glance</h2><p>Transfers between your accounts are excluded.</p></div></div><div className="report-stat-grid"><div><span>Net income</span><strong className={summary.saved >= 0 ? 'positive' : 'negative'}>{money(summary.saved)}</strong><small>Income minus expenses</small></div><div><span>Savings rate</span><strong>{summary.income ? `${Math.round(summary.saved / summary.income * 100)}%` : '—'}</strong><small>Net income as a share of income</small></div><div><span>Transactions</span><strong>{currencyData.transactions.filter(t => t.date.startsWith(month)).length}</strong><small>Recorded during {monthLabel}</small></div></div><div className="report-category-list">{data.categories.filter(c => categorySpending(data, month, c.id, currency) > 0).map(c => <div key={c.id}><CategoryIcon category={c}/><strong>{c.name}</strong><span>{money(categorySpending(data, month, c.id, currency))}</span></div>)}</div></section>}

        {page === 'reports' && <ExchangeReporting data={data} month={month} currency={currency} onSaveRate={rate => changeData(scope, data => {
          const rates = data.exchangeRates ??= [];
          const index = rates.findIndex(r => r.id === rate.id);
          if (index < 0) rates.push(rate); else rates[index] = rate;
        })} onDeleteRate={id => changeData(scope, data => { data.exchangeRates = data.exchangeRates?.filter(rate => rate.id !== id); })}/>}

        {page === 'settings' && <div className="settings-grid"><section className="card settings-section"><div className="card-heading"><div><h2><Cloud size={20}/>Your data, wherever you are</h2><p>Sign in once. Keep going offline.</p></div></div><div className="settings-content"><div className="connection-state"><span className="stat-icon income"><Cloud size={22}/></span><div><strong>Personal cloud workspace</strong><p>{syncLabel}</p></div></div><p className="muted">Your local copy stays available offline on this device. Sync uses your signed-in account and preserves conflicting copies for you to choose.</p>
          <div className="inline-actions"><button className="button primary" disabled={!online || syncing || configured !== true} onClick={() => void synchronize()}><RefreshCw size={16} className={syncing ? 'spin' : ''}/>{syncing ? 'Syncing…' : 'Sync now'}</button><button className="button secondary" onClick={() => void signOut()}><LogOut size={16}/>Sign out</button></div><div className="privacy-note"><ShieldCheck size={16}/><span>Financial data is not sent to analytics. Offline data is stored unencrypted in this browser; protect access to your device.</span></div></div></section>
          <section className="card settings-section"><div className="card-heading"><div><h2>Make it feel like you</h2><p>A calmer view, day or night</p></div></div><div className="settings-content"><div className="setting-row"><div><strong>Dark mode</strong><p>A softer view after sunset.</p></div><button className={`toggle ${dark ? 'on' : ''}`} role="switch" aria-checked={dark} aria-label="Dark mode" onClick={() => setDark(!dark)}><span/></button></div><div className="setting-row"><div><strong>Currency</strong><p>Choose a fixed currency for each account. Totals and budgets stay separate. Reports can combine balances using your dated manual rates.</p></div><span className="subtle-badge">USD · JPY · INR</span></div></div></section>
          <DashboardPreferences value={preferences} onChange={setPreferences}/>
          <section className="card settings-section"><div className="card-heading"><div><h2>Your data belongs to you</h2><p>Take a copy. Keep a little peace of mind.</p></div></div><div className="settings-content"><p className="muted">Download an Almond JSON backup of your accounts, transactions, categories, budgets, schedules, goals, and manual rates. Backups contain unencrypted financial data.</p><div className="inline-actions"><button className="button secondary" onClick={exportBackup}><Download size={17}/>Export backup</button><button className="button secondary" onClick={() => setCsvImportOpen(true)}><Upload size={17}/>Import CSV</button><button className="button secondary" onClick={() => importRef.current?.click()}><Upload size={17}/>Restore backup</button><input ref={importRef} type="file" accept="application/json,.json" hidden aria-label="Import Almond backup" onChange={e => void importBackup(e.target.files?.[0])}/></div></div></section>
          <section className="card settings-section"><div className="card-heading"><div><h2>Your categories</h2><p>Little labels that make life simpler</p></div><button className="icon-button" aria-label="Add category" onClick={() => setEditor({ kind: 'category' })}><Plus size={20}/></button></div><div className="category-grid">{data.categories.map(c => <button key={c.id} onClick={() => setEditor({ kind: 'category', item: c })}><CategoryIcon category={c}/><span>{c.name}</span><Pencil size={13}/></button>)}</div></section>
          <div className="about-almond"><AlmondMark/><p><strong>Almond · v0.1</strong><br/>An independent Cashew-inspired web implementation. Not affiliated with Cashew.<br/>Core workflows are available; full Cashew feature and visual parity is still in progress.</p></div>
        </div>}
        <footer className="page-footer"><span><AlmondMark/>A little more peace of mind.</span><span>Made for your everyday.</span></footer>
      </main>
    </div>
    {toast && <div className="toast" role="status"><CheckCircle2 size={19}/><span>{toast}</span><button aria-label="Dismiss notification" onClick={() => setToast('')}><X size={16}/></button></div>}
    {csvImportOpen && <CsvImport data={data} onClose={() => setCsvImportOpen(false)} onImport={async rows => {
      await changeData(scope, data => { data.transactions.push(...validateCsvImport(data, rows)); });
      notify('CSV imported. Your existing records are preserved.');
    }}/>}
    {editor?.kind === 'transaction' && <TransactionForm data={data} initial={editor.item} onClose={() => setEditor(null)} onSave={t => saveEntity('transactions', t)} onDelete={id => removeEntity('transactions', id)}/>}
    {editor?.kind === 'account' && <AccountForm initial={editor.item} hasTransactions={!!editor.item && (accountHasTransactions(data, editor.item.id) || !!data.schedules?.some(s => s.accountId === editor.item?.id))} onClose={() => setEditor(null)} onSave={a => saveEntity('accounts', a)} onDelete={removeAccount} onArchive={archiveAccount}/>}
    {editor?.kind === 'budget' && <BudgetForm data={data} month={month} defaultCurrency={currency} initial={editor.item} onClose={() => setEditor(null)} onSave={b => saveEntity('budgets', b)} onDelete={id => removeEntity('budgets', id)}/>}
    {editor?.kind === 'goal' && <GoalForm data={data} initial={editor.item} defaultCurrency={currency} onClose={() => setEditor(null)} onSave={g => changeData(scope, data => saveGoal(data, g))} onDelete={id => changeData(scope, data => { data.goals = data.goals?.filter(g => g.id !== id); })}/>}
    {editor?.kind === 'schedule' && <ScheduleForm data={data} initial={editor.item} onClose={() => setEditor(null)} onSave={s => changeData(scope, data => saveSchedule(data, s))} onDelete={id => changeData(scope, data => { data.schedules = data.schedules?.filter(s => s.id !== id); })}/>}
    {editor?.kind === 'category' && <CategoryForm initial={editor.item} onClose={() => setEditor(null)} onSave={c => saveEntity('categories', c)}/>}
  </div>;
}
