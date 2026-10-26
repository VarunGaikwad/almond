import { currencies, dateSchema, fxQuoteSchema, localDate, type Currency, type FxQuote } from '@/lib/finance';

const cache = new Map<string, { quote: FxQuote; expires: number }>();
const pending = new Map<string, Promise<FxQuote>>();
const maxEntries = 100;

export function fetchFxQuote(source: Currency, date: string): Promise<FxQuote> {
  if (!currencies.includes(source) || !dateSchema.safeParse(date).success || date > localDate()) {
    return Promise.reject(new Error('Choose a supported currency and a valid date no later than today.'));
  }
  const key = `${source}:${date}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return Promise.resolve(structuredClone(cached.quote));
  cache.delete(key);
  const existing = pending.get(key);
  if (existing) return existing.then(quote => structuredClone(quote));

  const request = Promise.resolve().then(async () => {
    try {
      const params = new URLSearchParams({ source, date });
      const response = await fetch(`/api/exchange-rates?${params}`, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('Exchange rates are unavailable. Please try again.');
      const result = fxQuoteSchema.safeParse(await response.json());
      if (!result.success || result.data.source !== source || result.data.date !== date) {
        throw new Error('Invalid exchange-rate response.');
      }
      const quote = result.data;
      cache.set(key, { quote, expires: date === localDate() ? Date.now() + 300_000 : Infinity });
      if (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
      return quote;
    } finally {
      pending.delete(key);
    }
  });
  pending.set(key, request);
  return request.then(quote => structuredClone(quote));
}
