import { currencies, currencyOf, dateSchema, exchangeRateSchema, localDate, minorUnit, type Currency, type ExchangeRate, type FinanceData } from './finance';

const safeLimit = BigInt(Number.MAX_SAFE_INTEGER);
function safeNumber(value: bigint): number {
  if (value > safeLimit || value < -safeLimit) throw new Error('Reporting amount exceeds the safe integer limit');
  return Number(value);
}
function integer(value: number | bigint): bigint {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('Amount must be a safe integer in minor units');
  return BigInt(value);
}

/** Rate is target major units per source major unit. Round ties away from zero. */
export function convertMinorUnits(amount: number | bigint, rate: ExchangeRate): number {
  exchangeRateSchema.parse(rate);
  const [whole, fraction = ''] = rate.rate.split('.');
  const numerator = integer(amount) * BigInt(whole + fraction) * BigInt(minorUnit(rate.target));
  const denominator = (10n ** BigInt(fraction.length)) * BigInt(minorUnit(rate.source));
  const absolute = numerator < 0n ? -numerator : numerator;
  const rounded = (absolute + denominator / 2n) / denominator;
  return safeNumber(numerator < 0n ? -rounded : rounded);
}

/** Calendar-day age relative to the device's local date; no network clock. */
export function rateAgeDays(rate: ExchangeRate, today = localDate()): number {
  dateSchema.parse(today);
  dateSchema.parse(rate.asOf);
  return (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${rate.asOf}T00:00:00Z`)) / 86_400_000;
}
export function isRateStale(rate: ExchangeRate, today = localDate()): boolean { return rateAgeDays(rate, today) > 7; }

export type ReportingTotals = { balance: number; income: number; expense: number; net: number };
export type CurrencySubtotal = ReportingTotals & { currency: Currency; accountCount: number };

/** All accounts, including archived/zero balances. Never infer inverse or cross rates. */
export function exchangeReport(data: FinanceData, month: string, target: Currency, today = localDate()) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Choose a valid reporting month');
  dateSchema.parse(today);
  const buckets = new Map<Currency, { balance: bigint; income: bigint; expense: bigint; accountCount: number }>();
  const accounts = new Map(data.accounts.map(account => [account.id, account]));
  for (const account of data.accounts) {
    const currency = currencyOf(account);
    const bucket = buckets.get(currency) ?? { balance: 0n, income: 0n, expense: 0n, accountCount: 0 };
    bucket.balance += integer(account.openingBalance);
    bucket.accountCount++;
    buckets.set(currency, bucket);
  }
  for (const transaction of data.transactions) {
    const account = accounts.get(transaction.accountId);
    if (!account) throw new Error('Transaction references an unknown account');
    const bucket = buckets.get(currencyOf(account))!;
    const amount = integer(transaction.amount);
    bucket.balance += transaction.type === 'income' ? amount : -amount;
    if (transaction.type === 'transfer') {
      const destination = accounts.get(transaction.toAccountId!);
      if (!destination || currencyOf(destination) !== currencyOf(account)) throw new Error('Transfers require accounts with the same currency');
      buckets.get(currencyOf(destination))!.balance += amount;
    } else if (transaction.date.startsWith(month)) {
      bucket[transaction.type] += amount;
    }
  }
  const subtotals: CurrencySubtotal[] = currencies.filter(c => buckets.has(c)).map(currency => {
    const b = buckets.get(currency)!;
    return { currency, accountCount: b.accountCount, balance: safeNumber(b.balance), income: safeNumber(b.income), expense: safeNumber(b.expense), net: safeNumber(b.income - b.expense) };
  });
  const usedRates: ExchangeRate[] = [];
  const missing: Currency[] = [];
  for (const subtotal of subtotals) {
    if (subtotal.currency === target) continue;
    const matches = (data.exchangeRates ?? []).filter(rate => rate.source === subtotal.currency && rate.target === target);
    if (matches.length !== 1 || !exchangeRateSchema.safeParse(matches[0]).success || rateAgeDays(matches[0], today) < 0) missing.push(subtotal.currency);
    else usedRates.push(matches[0]);
  }
  let combined: ReportingTotals | null = null;
  let error: string | null = null;
  if (!missing.length) {
    try {
      const sum = { balance: 0n, income: 0n, expense: 0n };
      for (const subtotal of subtotals) {
        const rate = usedRates.find(r => r.source === subtotal.currency);
        for (const key of ['balance', 'income', 'expense'] as const) sum[key] += BigInt(rate ? convertMinorUnits(subtotal[key], rate) : subtotal[key]);
      }
      combined = { balance: safeNumber(sum.balance), income: safeNumber(sum.income), expense: safeNumber(sum.expense), net: safeNumber(sum.income - sum.expense) };
    } catch (e) { error = e instanceof Error ? e.message : 'Unable to calculate estimate'; }
  }
  return { target, subtotals, combined, missing, usedRates, staleRates: usedRates.filter(rate => isRateStale(rate, today)), error };
}
