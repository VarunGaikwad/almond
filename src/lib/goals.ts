import { currencyOf, type FinanceData, type Goal } from './finance';

export function goalProgress(data: FinanceData, goal: Goal, accountId?: string): number {
  const links = new Set(goal.transactionIds);
  return data.transactions.filter(t => links.has(t.id) && t.type === (goal.kind === 'saving' ? 'income' : 'expense') &&
    (!accountId || t.accountId === accountId) &&
    currencyOf(data.accounts.find(a => a.id === t.accountId)) === currencyOf(goal)).reduce((sum, t) => sum + t.amount, 0);
}
export function saveGoal(data: FinanceData, goal: Goal): void {
  data.goals ??= [];
  const index = data.goals.findIndex(g => g.id === goal.id);
  if (index < 0) data.goals.push(goal); else data.goals[index] = goal;
}
