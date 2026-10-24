import { z } from 'zod';

const id = z.string().min(1).max(100);
const text = z.string().trim().min(1).max(100);
// A bounded USD-only first release keeps all aggregate cents within safe integers.
const cents = z.number().int().min(0).max(100_000_000_000);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Choose a valid date');
export const accountSchema = z.object({
  id, name: text, type: z.enum(['checking', 'savings', 'cash', 'credit']),
  openingBalance: z.number().int().min(-100_000_000_000).max(100_000_000_000),
  color: z.string().regex(/^#[a-fA-F0-9]{6}$/),
});
export const categorySchema = z.object({ id, name: text, color: z.string().regex(/^#[a-fA-F0-9]{6}$/), icon: z.enum(['food', 'shopping', 'home', 'transport', 'health', 'fun', 'income', 'other']) });
export const transactionSchema = z.object({
  id, title: text, amount: cents.refine(n => n > 0, 'Amount must be greater than zero'),
  type: z.enum(['expense', 'income', 'transfer']), accountId: id,
  toAccountId: id.optional(), categoryId: id.optional(), date: dateSchema,
  notes: z.string().max(1000).optional(),
}).superRefine((t, ctx) => {
  if (t.type === 'transfer' && (!t.toAccountId || t.toAccountId === t.accountId)) {
    ctx.addIssue({ code: 'custom', message: 'Choose a different destination account', path: ['toAccountId'] });
  }
  if (t.type !== 'transfer' && !t.categoryId) ctx.addIssue({ code: 'custom', message: 'Choose a category', path: ['categoryId'] });
});
export const budgetSchema = z.object({
  id, categoryId: id, amount: cents.refine(n => n > 0),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});
export const financeSchema = z.object({
  accounts: z.array(accountSchema).max(100),
  categories: z.array(categorySchema).max(200),
  transactions: z.array(transactionSchema).max(10000),
  budgets: z.array(budgetSchema).max(1000),
}).superRefine((data, ctx) => {
  for (const [key, rows] of Object.entries(data)) {
    if (new Set(rows.map(row => row.id)).size !== rows.length) ctx.addIssue({ code: 'custom', message: `Duplicate ${key} IDs` });
  }
  const accounts = new Set(data.accounts.map(a => a.id));
  const categories = new Set(data.categories.map(c => c.id));
  for (const t of data.transactions) {
    if (!accounts.has(t.accountId) || (t.type === 'transfer' && !accounts.has(t.toAccountId!))) ctx.addIssue({ code: 'custom', message: 'Transaction references an unknown account' });
    if (t.type !== 'transfer' && !categories.has(t.categoryId!)) ctx.addIssue({ code: 'custom', message: 'Transaction references an unknown category' });
  }
  const budgetKeys = new Set<string>();
  for (const b of data.budgets) {
    if (!categories.has(b.categoryId)) ctx.addIssue({ code: 'custom', message: 'Budget references an unknown category' });
    const key = `${b.month}:${b.categoryId}`;
    if (budgetKeys.has(key)) ctx.addIssue({ code: 'custom', message: 'This category already has a budget for this month' });
    budgetKeys.add(key);
  }
});
export type Account = z.infer<typeof accountSchema>;
export type Category = z.infer<typeof categorySchema>;
export type Transaction = z.infer<typeof transactionSchema>;
export type Budget = z.infer<typeof budgetSchema>;
export type FinanceData = z.infer<typeof financeSchema>;

export function parseMoney(input: string, allowNegative = false): number {
  const value = input.trim();
  if (!(allowNegative ? /^-?\d+(\.\d{1,2})?$/ : /^\d+(\.\d{1,2})?$/).test(value)) throw new Error('Enter an amount with up to 2 decimal places');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace('-', '').split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(amount) || amount > 100_000_000_000) throw new Error('Amount is too large');
  return negative ? -amount : amount;
}
export function money(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount / 100);
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
export function totals(data: FinanceData, month: string) {
  const transactions = data.transactions.filter(t => t.date.startsWith(month));
  const income = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const balance = data.accounts.reduce((s, a) => s + accountBalance(data, a.id), 0);
  return { income, expense, balance, saved: income - expense };
}
export function categorySpending(data: FinanceData, month: string, categoryId: string) {
  return data.transactions.filter(t => t.type === 'expense' && t.date.startsWith(month) && t.categoryId === categoryId).reduce((s, t) => s + t.amount, 0);
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
