import { dateSchema, scheduleSchema, type FinanceData, type Schedule } from './finance';

export function nextOccurrence(schedule: Schedule): string | null {
  if (!schedule.nextDue || schedule.frequency === 'once') return null;
  const date = new Date(`${schedule.nextDue}T12:00:00Z`);
  const anchor = new Date(`${schedule.anchorDate}T12:00:00Z`);
  if (schedule.frequency === 'daily' || schedule.frequency === 'weekly') {
    date.setUTCDate(date.getUTCDate() + (schedule.frequency === 'daily' ? 1 : 7));
  } else {
    const year = date.getUTCFullYear() + (schedule.frequency === 'yearly' ? 1 : 0);
    const month = schedule.frequency === 'yearly' ? anchor.getUTCMonth() : date.getUTCMonth() + 1;
    date.setUTCDate(1);
    date.setUTCFullYear(year, month, 1);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(anchor.getUTCDate(), lastDay));
  }
  const next = date.toISOString().slice(0, 10);
  return (schedule.endDate && next > schedule.endDate) || !dateSchema.safeParse(next).success ? null : next;
}

export function saveSchedule(data: FinanceData, input: Schedule) {
  const schedule = scheduleSchema.parse(input);
  const previous = data.schedules?.find(s => s.id === schedule.id);
  const account = data.accounts.find(a => a.id === schedule.accountId);
  if (!account) throw new Error('Choose an account');
  if (account.archived && previous?.accountId !== account.id) throw new Error('Restore this archived account before adding schedules.');
  const rows = data.schedules ??= [];
  const index = rows.findIndex(s => s.id === schedule.id);
  if (index < 0) rows.push(schedule); else rows[index] = schedule;
}

// The caller must hold the workspace write transaction for the entire mutation.
export function postScheduleOccurrence(data: FinanceData, scheduleId: string, expectedDue: string): boolean {
  dateSchema.parse(expectedDue);
  const schedule = data.schedules?.find(s => s.id === scheduleId);
  if (!schedule || schedule.nextDue !== expectedDue) return false;
  if (data.transactions.some(t => t.scheduleId === scheduleId && t.scheduledFor === expectedDue)) return false;
  const account = data.accounts.find(a => a.id === schedule.accountId);
  if (!account || account.archived) throw new Error('Restore this archived account before recording a payment.');
  scheduleSchema.parse(schedule);
  data.transactions.push({
    id: crypto.randomUUID(), title: schedule.title, amount: schedule.amount, type: schedule.type,
    accountId: schedule.accountId, categoryId: schedule.categoryId, date: expectedDue,
    notes: schedule.notes, scheduleId, scheduledFor: expectedDue,
  });
  schedule.nextDue = nextOccurrence(schedule);
  return true;
}
