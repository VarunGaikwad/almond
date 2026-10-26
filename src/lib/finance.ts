import { z } from 'zod';

const id = z.string().min(1).max(100);
const text = z.string().trim().min(1).max(100);
export const currencies = ['USD', 'JPY', 'INR'] as const;
export type Currency = typeof currencies[number];
const currencySchema = z.enum(currencies).optional();
export function currencyOf(record?: { currency?: Currency }): Currency { return record?.currency ?? 'USD'; }
export function minorUnit(currency: Currency = 'USD') { return currency === 'JPY' ? 1 : 100; }
export function moneyInput(amount: number, currency: Currency = 'USD') { return (amount / minorUnit(currency)).toFixed(currency === 'JPY' ? 0 : 2); }
// Bounded integer minor units keep aggregates within safe integers.
const cents = z.number().int().min(0).max(100_000_000_000);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Choose a valid date');
// Manual rates are reporting metadata, never ledger amounts. Keep validation here
// so imports, backups and sync share the boundary without an exchange-helper cycle.
export const exchangeRateSchema = z.object({
  id, source: z.enum(currencies), target: z.enum(currencies),
  rate: z.string().regex(/^\d{1,12}(\.\d{1,8})?$/, 'Enter a decimal rate with up to 12 whole digits and 8 decimal places')
    .refine(value => /[1-9]/.test(value), 'Rate must be positive'),
  asOf: dateSchema.refine(value => value <= localDate(), 'Rate date must not be in the future'),
}).strict().superRefine((rate, ctx) => {
  if (rate.source === rate.target) ctx.addIssue({ code: 'custom', message: 'Choose different source and target currencies' });
});
export type ExchangeRate = z.infer<typeof exchangeRateSchema>;
export const fxQuoteSchema = z.object({
  source: z.enum(currencies),
  date: dateSchema.refine(value => value <= localDate(), 'Quote date must not be in the future'),
  asOf: dateSchema,
  rates: z.object({ USD: exchangeRateSchema.shape.rate, JPY: exchangeRateSchema.shape.rate, INR: exchangeRateSchema.shape.rate }).strict(),
}).strict().superRefine((quote, ctx) => {
  if (quote.asOf > quote.date) ctx.addIssue({ code: 'custom', message: 'Effective date must not follow the requested date' });
  if (quote.rates[quote.source] !== '1') ctx.addIssue({ code: 'custom', message: 'Source currency rate must be exactly 1' });
});
export type FxQuote = z.infer<typeof fxQuoteSchema>;
export const accountSchema = z.object({
  id, name: text, currency: currencySchema, archived: z.boolean().optional(), type: z.enum(['checking', 'savings', 'cash', 'credit']),
  openingBalance: z.number().int().min(-100_000_000_000).max(100_000_000_000),
  color: z.string().regex(/^#[a-fA-F0-9]{6}$/),
}).strict();
export const categorySchema = z.object({ id, name: text, color: z.string().regex(/^#[a-fA-F0-9]{6}$/), icon: z.enum(['food', 'shopping', 'home', 'transport', 'health', 'fun', 'income', 'other']) }).strict();
export const transactionSchema = z.object({
  id, title: text, amount: cents.refine(n => n > 0, 'Amount must be greater than zero'),
  type: z.enum(['expense', 'income', 'transfer']), accountId: id,
  toAccountId: id.optional(), categoryId: id.optional(), date: dateSchema,
  notes: z.string().max(1000).optional(),
  fx: fxQuoteSchema.optional(),
  scheduleId: id.optional(), scheduledFor: dateSchema.optional(),
}).strict().superRefine((t, ctx) => {
  if (t.type === 'transfer' && (!t.toAccountId || t.toAccountId === t.accountId)) {
    ctx.addIssue({ code: 'custom', message: 'Choose a different destination account', path: ['toAccountId'] });
  }
  if (t.type !== 'transfer' && !t.categoryId) ctx.addIssue({ code: 'custom', message: 'Choose a category', path: ['categoryId'] });
});
export const budgetSchema = z.object({
  id, categoryId: id.optional(), categoryIds: z.array(id).min(1).max(200).optional(),
  currency: currencySchema, amount: cents.refine(n => n > 0),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  startDate: dateSchema.optional(), endDate: dateSchema.optional(),
  transactionIds: z.array(id).max(10000).optional(),
}).strict().superRefine((b, ctx) => {
  if (!b.categoryId && !b.categoryIds?.length) ctx.addIssue({ code: 'custom', message: 'Choose at least one category' });
  if (b.categoryId && b.categoryIds) ctx.addIssue({ code: 'custom', message: 'Use a category or a category list, not both' });
  if ((!b.startDate || !b.endDate) && (b.startDate || b.endDate || !b.month)) ctx.addIssue({ code: 'custom', message: 'Choose a month or a complete date range' });
  if (b.startDate && b.endDate && b.startDate > b.endDate) ctx.addIssue({ code: 'custom', message: 'End date must not precede start date' });
  for (const links of [b.categoryIds, b.transactionIds]) if (links && new Set(links).size !== links.length) ctx.addIssue({ code: 'custom', message: 'Duplicate budget links' });
});
export const goalSchema = z.object({
  id, name: text, kind: z.enum(['saving', 'spending']), currency: currencySchema,
  target: cents.refine(n => n > 0, 'Target must be greater than zero'),
  targetDate: dateSchema.optional(), transactionIds: z.array(id).max(10000),
}).strict().superRefine((g, ctx) => {
  if (new Set(g.transactionIds).size !== g.transactionIds.length) ctx.addIssue({ code: 'custom', message: 'Duplicate goal links' });
});
export type Goal = z.infer<typeof goalSchema>;
export const scheduleSchema = z.object({
  id, title: text, amount: cents.refine(n => n > 0, 'Amount must be greater than zero'),
  type: z.enum(['expense', 'income']), accountId: id, categoryId: id,
  frequency: z.enum(['once', 'daily', 'weekly', 'monthly', 'yearly']),
  anchorDate: dateSchema, nextDue: dateSchema.nullable(), endDate: dateSchema.optional(),
  notes: z.string().max(1000).optional(),
}).strict().superRefine((s, ctx) => {
  if (s.nextDue && (s.nextDue < s.anchorDate || (s.endDate && s.nextDue > s.endDate))) ctx.addIssue({ code: 'custom', message: 'Next due date must be between the start and end dates' });
  if (s.endDate && s.endDate < s.anchorDate) ctx.addIssue({ code: 'custom', message: 'End date must not precede the start date' });
});
export type Schedule = z.infer<typeof scheduleSchema>;
export const financeSchema = z.object({
  primaryAccountId: id.optional(),
  accounts: z.array(accountSchema).max(100),
  categories: z.array(categorySchema).max(200),
  transactions: z.array(transactionSchema).max(10000),
  budgets: z.array(budgetSchema).max(1000),
  schedules: z.array(scheduleSchema).max(1000).optional(),
  goals: z.array(goalSchema).max(1000).optional(),
  exchangeRates: z.array(exchangeRateSchema).max(6).optional(),
}).strict().superRefine((data, ctx) => {
  for (const [key, rows] of Object.entries(data)) {
    if (Array.isArray(rows) && new Set(rows.map(row => row.id)).size !== rows.length) ctx.addIssue({ code: 'custom', message: `Duplicate ${key} IDs` });
  }
  const pairs = new Set<string>();
  for (const rate of data.exchangeRates ?? []) {
    const pair = `${rate.source}:${rate.target}`;
    if (pairs.has(pair)) ctx.addIssue({ code: 'custom', message: 'Duplicate directed exchange-rate pair', path: ['exchangeRates'] });
    pairs.add(pair);
  }
  const accounts = new Set(data.accounts.map(a => a.id));
  const categories = new Set(data.categories.map(c => c.id));
  if (data.primaryAccountId) {
    const primary = data.accounts.find(a => a.id === data.primaryAccountId);
    if (!primary || (primary.archived && data.accounts.some(a => !a.archived))) ctx.addIssue({ code: 'custom', message: 'Choose an existing active primary account', path: ['primaryAccountId'] });
  }
  for (const t of data.transactions) {
    if (t.fx && (t.fx.source !== currencyOf(data.accounts.find(a => a.id === t.accountId)) || t.fx.date !== t.date)) ctx.addIssue({ code: 'custom', message: 'FX snapshot must match the transaction account currency and date' });
    if (!accounts.has(t.accountId) || (t.type === 'transfer' && !accounts.has(t.toAccountId!))) ctx.addIssue({ code: 'custom', message: 'Transaction references an unknown account' });
    if (t.type === 'transfer' && currencyOf(data.accounts.find(a => a.id === t.accountId)) !== currencyOf(data.accounts.find(a => a.id === t.toAccountId))) ctx.addIssue({ code: 'custom', message: 'Transfers require accounts with the same currency' });
    if (t.type !== 'transfer' && !categories.has(t.categoryId!)) ctx.addIssue({ code: 'custom', message: 'Transaction references an unknown category' });
  }
  for (const s of data.schedules ?? []) {
    if (!accounts.has(s.accountId)) ctx.addIssue({ code: 'custom', message: 'Schedule references an unknown account' });
    if (!categories.has(s.categoryId)) ctx.addIssue({ code: 'custom', message: 'Schedule references an unknown category' });
  }
  const occurrences = new Set<string>();
  for (const t of data.transactions) {
    if (Boolean(t.scheduleId) !== Boolean(t.scheduledFor)) ctx.addIssue({ code: 'custom', message: 'Incomplete schedule occurrence reference' });
    if (t.scheduleId && t.scheduledFor) {
      const key = JSON.stringify([t.scheduleId, t.scheduledFor]);
      if (occurrences.has(key)) ctx.addIssue({ code: 'custom', message: 'Duplicate schedule occurrence' });
      occurrences.add(key);
    }
  }
  const budgetKeys = new Set<string>();
  for (const b of data.budgets) {
    const ids = b.categoryIds ?? [b.categoryId!];
    if (ids.some(id => !categories.has(id))) ctx.addIssue({ code: 'custom', message: 'Budget references an unknown category' });
    if (!b.startDate && b.categoryId) {
      const key = `${b.month}:${b.categoryId}:${currencyOf(b)}`;
      if (budgetKeys.has(key)) ctx.addIssue({ code: 'custom', message: 'This category already has a budget for this month' });
      budgetKeys.add(key);
    }
    for (const id of b.transactionIds ?? []) {
      const t = data.transactions.find(t => t.id === id);
      if (!t || t.type !== 'expense' || !ids.includes(t.categoryId!) || currencyOf(data.accounts.find(a => a.id === t.accountId)) !== currencyOf(b)) ctx.addIssue({ code: 'custom', message: 'Budget links require posted expenses in its categories and currency' });
    }
  }
  for (const g of data.goals ?? []) for (const id of g.transactionIds) {
    const t = data.transactions.find(t => t.id === id);
    if (!t || t.type !== (g.kind === 'saving' ? 'income' : 'expense') || currencyOf(data.accounts.find(a => a.id === t.accountId)) !== currencyOf(g)) ctx.addIssue({ code: 'custom', message: 'Goal links require posted transactions with matching type and currency' });
  }
});
export type Account = z.infer<typeof accountSchema>;
export type Category = z.infer<typeof categorySchema>;
export type Transaction = z.infer<typeof transactionSchema>;
export type Budget = z.infer<typeof budgetSchema>;
export type FinanceData = z.infer<typeof financeSchema>;

export function primaryAccount(data: FinanceData): Account | undefined {
  return data.accounts.find(a => a.id === data.primaryAccountId && (!a.archived || !data.accounts.some(a => !a.archived)))
    ?? data.accounts.find(a => !a.archived) ?? data.accounts[0];
}
export function reportingCurrency(data: FinanceData): Currency { return currencyOf(primaryAccount(data)); }
export function setPrimaryAccount(data: FinanceData, id: string): void {
  const account = data.accounts.find(a => a.id === id);
  if (!account || (account.archived && data.accounts.some(a => !a.archived))) throw new Error('Choose an existing active primary account');
  data.primaryAccountId = id;
}
export function normalizeFinanceData(data: FinanceData): FinanceData {
  const validated = financeSchema.parse(data);
  const primary = primaryAccount(validated);
  if (primary) validated.primaryAccountId = primary.id;
  else delete validated.primaryAccountId;
  return validated;
}

export function deleteTransaction(data: FinanceData, id: string): void {
  data.transactions = data.transactions.filter(t => t.id !== id);
  for (const b of data.budgets) if (b.transactionIds) b.transactionIds = b.transactionIds.filter(link => link !== id);
  for (const g of data.goals ?? []) g.transactionIds = g.transactionIds.filter(link => link !== id);
}

export function accountHasTransactions(data: FinanceData, accountId: string): boolean {
  return data.transactions.some(t => t.accountId === accountId || (t.type === 'transfer' && t.toAccountId === accountId));
}
export function deleteAccount(data: FinanceData, accountId: string): void {
  if (!data.accounts.some(a => a.id === accountId)) throw new Error('Account not found');
  if (accountHasTransactions(data, accountId)) throw new Error('This account has transactions. Archive it to preserve your history.');
  if (data.schedules?.some(s => s.accountId === accountId)) throw new Error('This account has schedules. Delete or move them before deleting the account.');
  if (primaryAccount(data)?.id === accountId && data.accounts.length > 1) throw new Error('Select a replacement primary account before deleting this account.');
  data.accounts = data.accounts.filter(a => a.id !== accountId);
  if (data.primaryAccountId === accountId) delete data.primaryAccountId;
}
export function setAccountArchived(data: FinanceData, accountId: string, archived: boolean): void {
  const account = data.accounts.find(a => a.id === accountId);
  if (!account) throw new Error('Account not found');
  if (archived && !account.archived && primaryAccount(data)?.id === accountId) throw new Error('Select a replacement primary account before archiving this account.');
  account.archived = archived;
}
export function assertActiveTransactionAccounts(data: FinanceData, transaction: Transaction): void {
  const previous = data.transactions.find(t => t.id === transaction.id);
  if (data.accounts.find(a => a.id === transaction.accountId)?.archived && previous?.accountId !== transaction.accountId) throw new Error('Restore this archived account before adding transactions.');
  if (transaction.type === 'transfer' && data.accounts.find(a => a.id === transaction.toAccountId)?.archived && (previous?.type !== 'transfer' || previous.toAccountId !== transaction.toAccountId)) throw new Error('Restore the archived destination account before adding transfers.');
}

export function parseMoney(input: string, allowNegative = false, currency: Currency = 'USD'): number {
  const value = input.trim();
  if (!(allowNegative ? /^-?\d+(\.\d{1,2})?$/ : /^\d+(\.\d{1,2})?$/).test(value)) throw new Error('Enter an amount with up to 2 decimal places');
  if (currency === 'JPY' && value.includes('.')) throw new Error('Enter a whole yen amount');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace('-', '').split('.');
  const amount = Number(whole) * minorUnit(currency) + (currency === 'JPY' ? 0 : Number(fraction.padEnd(2, '0')));
  if (!Number.isSafeInteger(amount) || amount > 100_000_000_000) throw new Error('Amount is too large');
  return negative ? -amount : amount;
}
export function money(amount: number, currency: Currency = 'USD'): string {
  return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency }).format(amount / minorUnit(currency));
}
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function currentMonth(): string { return localDate().slice(0, 7); }
export function accountBalance(data: FinanceData, id: string): number {
  return data.transactions.reduce((balance, t) => {
    if (t.accountId === id) balance += t.type === 'income' ? t.amount : -t.amount;
    if (t.type === 'transfer' && t.toAccountId === id) balance += t.amount;
    return balance;
  }, data.accounts.find(a => a.id === id)?.openingBalance ?? 0);
}
export function dataForCurrency(data: FinanceData, currency: Currency): FinanceData {
  const accounts = data.accounts.filter(a => currencyOf(a) === currency);
  const ids = new Set(accounts.map(a => a.id));
  return { ...data, accounts, ...(data.goals ? { goals: data.goals.filter(g => currencyOf(g) === currency) } : {}), ...(data.schedules ? { schedules: data.schedules.filter(s => ids.has(s.accountId)) } : {}), transactions: data.transactions.filter(t => ids.has(t.accountId)), budgets: data.budgets.filter(b => currencyOf(b) === currency) };
}
export function totals(data: FinanceData, month: string, currency: Currency = 'USD') {
  data = dataForCurrency(data, currency);
  const transactions = data.transactions.filter(t => t.date.startsWith(month));
  const income = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const balance = data.accounts.reduce((s, a) => s + accountBalance(data, a.id), 0);
  return { income, expense, balance, saved: income - expense };
}
export function categorySpending(data: FinanceData, month: string, categoryId: string, currency: Currency = 'USD') {
  return dataForCurrency(data, currency).transactions.filter(t => t.type === 'expense' && t.date.startsWith(month) && t.categoryId === categoryId).reduce((s, t) => s + t.amount, 0);
}
export const defaultCategories: Category[] = [
  { id: 'food', name: 'Food & dining', color: '#c98748', icon: 'food' },
  { id: 'shopping', name: 'Shopping', color: '#a88bbd', icon: 'shopping' },
  { id: 'home', name: 'Home & bills', color: '#7e9e83', icon: 'home' },
  { id: 'transport', name: 'Transport', color: '#789bb6', icon: 'transport' },
  { id: 'fun', name: 'Entertainment', color: '#c68b95', icon: 'fun' },
  { id: 'health', name: 'Health', color: '#8f9c59', icon: 'health' },
  { id: 'income', name: 'Income', color: '#67927b', icon: 'income' },
  { id: 'other', name: 'Other', color: '#99938a', icon: 'other' },
];
export function emptyData(): FinanceData { return { accounts: [], categories: structuredClone(defaultCategories), transactions: [], budgets: [] }; }
export function sampleData(): FinanceData {
  const month = currentMonth();
  const day = new Date().getDate();
  const date = (n: number) => `${month}-${String(Math.min(n, day)).padStart(2, '0')}`;
  const expenses: [string, number, string, number][] = [
    ['Whole Foods Market', 8642, 'food', 3], ['Morning coffee', 650, 'food', 4],
    ['Monthly rent', 145000, 'home', 1], ['Everlane', 12800, 'shopping', 5],
    ['Spotify Premium', 1099, 'fun', 6], ['City transit pass', 7200, 'transport', 2],
    ['Sunday brunch', 4850, 'food', 9], ['Electricity', 6840, 'home', 8],
    ['Neighborhood groceries', 6240, 'food', 12], ['Bookshop', 3400, 'shopping', 14],
    ['Yoga studio', 4500, 'health', 10], ['Dinner with friends', 7600, 'food', 17],
  ];
  return {
    primaryAccountId: 'checking',
    accounts: [
      { id: 'checking', name: 'Everyday account', type: 'checking', openingBalance: 245000, color: '#6d8163' },
      { id: 'savings', name: 'Rainy day fund', type: 'savings', openingBalance: 620000, color: '#b39a70' },
      { id: 'cash', name: 'Cash wallet', type: 'cash', openingBalance: 18000, color: '#9297b8' },
    ],
    categories: structuredClone(defaultCategories),
    transactions: [
      { id: 'salary', title: 'Monthly salary', amount: 480000, type: 'income', accountId: 'checking', categoryId: 'income', date: date(1) },
      { id: 'freelance', title: 'Design project', amount: 65000, type: 'income', accountId: 'checking', categoryId: 'income', date: date(15) },
      { id: 'transfer', title: 'A little for later', amount: 50000, type: 'transfer', accountId: 'checking', toAccountId: 'savings', date: date(2) },
      ...expenses.map(([title, amount, categoryId, d], i) => ({ id: `sample-${i}`, title, amount, categoryId, type: 'expense' as const, accountId: 'checking', date: date(d) })),
    ],
    budgets: [
      { id: 'budget-food', categoryId: 'food', amount: 50000, month },
      { id: 'budget-shopping', categoryId: 'shopping', amount: 25000, month },
      { id: 'budget-fun', categoryId: 'fun', amount: 10000, month },
      { id: 'budget-transport', categoryId: 'transport', amount: 15000, month },
    ],
  };
}
