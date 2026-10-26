import { z } from 'zod';
import { currencies, dateSchema, fxQuoteSchema, localDate, type Currency } from '@/lib/finance';

const querySchema = z.object({ source: z.enum(currencies), date: dateSchema }).strict();
const providerSchema = z.object({
  amount: z.literal(1), base: z.enum(currencies), date: dateSchema,
  rates: z.record(z.string(), z.number().finite().positive()),
});

function decimalRate(value: number): string {
  // toFixed avoids exponent notation; rates smaller than our precision fail closed.
  if (value >= 1e12) throw new Error('Rate out of range');
  const rate = value.toFixed(8).replace(/\.?0+$/, '');
  if (!rate || Number(rate) <= 0) throw new Error('Rate out of range');
  return rate;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const input = querySchema.safeParse(Object.fromEntries(params));
  const today = localDate();
  if (!input.success || input.data.date > today || params.size !== 2) {
    return Response.json({ error: 'Choose a supported currency and a valid date no later than today.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const { source, date } = input.data;
  const revalidate = date === today ? 3600 : 86400;
  const symbols = currencies.filter(currency => currency !== source).join(',');
  try {
    const response = await fetch(`https://api.frankfurter.dev/v1/${date}?base=${source}&symbols=${symbols}`, {
      signal: AbortSignal.timeout(8000), redirect: 'error',
      headers: { Accept: 'application/json' }, next: { revalidate },
    });
    if (!response.ok) throw new Error('Provider unavailable');
    const provider = providerSchema.parse(await response.json());
    if (provider.base !== source || provider.date > date) throw new Error('Unexpected quote');
    const rates = {} as Record<Currency, string>;
    for (const currency of currencies) {
      if (currency === source) rates[currency] = '1';
      else {
        const value = provider.rates[currency];
        if (value === undefined) throw new Error('Missing rate');
        rates[currency] = decimalRate(value);
      }
    }
    const quote = fxQuoteSchema.parse({ source, date, asOf: provider.date, rates });
    return Response.json(quote, { headers: { 'Cache-Control': `public, max-age=${revalidate}, s-maxage=${revalidate}` } });
  } catch {
    return Response.json({ error: 'Exchange rates are unavailable. Please try again.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
