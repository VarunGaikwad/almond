import { currencyOf, type Budget, type FinanceData } from './finance';

export function budgetCategories(budget: Budget): string[] { return budget.categoryIds ?? [budget.categoryId!]; }
export function monthRange(month: string): [string, string] {
  const [year, m] = month.split('-').map(Number);
  return [`${month}-01`, `${month}-${new Date(Date.UTC(year, m, 0)).getUTCDate()}`];
}
export function budgetRange(budget: Budget): [string, string] {
  return budget.startDate && budget.endDate ? [budget.startDate, budget.endDate] : monthRange(budget.month!);
}
export function budgetOverlapsMonth(budget: Budget, month: string): boolean {
  const [start, end] = budgetRange(budget); const [first, last] = monthRange(month);
  return start <= last && end >= first;
}
export function budgetProgress(data: FinanceData, budget: Budget, accountId?: string): number {
  const [start, end] = budgetRange(budget);
  const categories = new Set(budgetCategories(budget));
  const selected = budget.transactionIds ? new Set(budget.transactionIds) : undefined;
  return data.transactions.filter(t => t.type === 'expense' && t.date >= start && t.date <= end &&
    categories.has(t.categoryId!) && (!selected || selected.has(t.id)) && (!accountId || t.accountId === accountId) &&
    currencyOf(data.accounts.find(a => a.id === t.accountId)) === currencyOf(budget)).reduce((sum, t) => sum + t.amount, 0);
}
