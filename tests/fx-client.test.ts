import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const quote = { source: 'USD', date: '2025-01-02', asOf: '2025-01-02', rates: { USD: '1', JPY: '157', INR: '85.76' } };
const fetchMock = vi.fn();
let fetchFxQuote: typeof import('@/lib/fx-client').fetchFxQuote;
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date('2025-01-06T12:00:00Z'));
  vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset();
  ({ fetchFxQuote } = await import('@/lib/fx-client'));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('browser FX helper', () => {
  it('fetches only on demand, deduplicates requests, and caches validated quotes without shared mutations', async () => {
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockImplementation(async () => Response.json(quote));
    const [first, second] = await Promise.all([fetchFxQuote('USD', quote.date), fetchFxQuote('USD', quote.date)]);
    expect(first).toEqual(quote); expect(second).toEqual(quote);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/exchange-rates?source=USD&date=2025-01-02');
    first.rates.JPY = '1';
    expect((await fetchFxQuote('USD', quote.date)).rates.JPY).toBe('157');
    expect(second.rates.JPY).toBe('157');
  });
  it.each(['network', 'sync', 'http', 'json'])('clears failed %s requests so retries succeed', async kind => {
    if (kind === 'network') fetchMock.mockRejectedValueOnce(new Error('offline'));
    else if (kind === 'sync') fetchMock.mockImplementationOnce(() => { throw new Error('offline'); });
    else fetchMock.mockResolvedValueOnce(kind === 'http' ? new Response('', { status: 502 }) : new Response('bad json'));
    await expect(fetchFxQuote('USD', quote.date)).rejects.toThrow();
    fetchMock.mockResolvedValueOnce(Response.json(quote));
    expect(await fetchFxQuote('USD', quote.date)).toEqual(quote);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each([
    { ...quote, source: 'JPY', rates: { USD: '0.01', JPY: '1', INR: '0.5' } },
    { ...quote, date: '2025-01-01', asOf: '2025-01-01' },
    { ...quote, asOf: '2025-01-03' },
    { ...quote, rates: { USD: '1', JPY: '0', INR: '85.76' } },
    { ...quote, rates: { USD: '1', JPY: '157' } },
  ])('rejects invalid or mismatched responses %#', async body => {
    fetchMock.mockResolvedValueOnce(Response.json(body));
    await expect(fetchFxQuote('USD', quote.date)).rejects.toThrow('Invalid exchange-rate response');
    fetchMock.mockResolvedValueOnce(Response.json(quote));
    expect(await fetchFxQuote('USD', quote.date)).toEqual(quote);
  });
  it('rejects invalid dates before fetching', async () => {
    for (const date of ['2025-02-30', '2025-01-07', 'today']) await expect(fetchFxQuote('USD', date)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('expires today quotes after five minutes but retains historical quotes', async () => {
    fetchMock.mockImplementation(async (url: string) => Response.json({ ...quote, date: new URL(url, 'https://almond.example').searchParams.get('date') }));
    await fetchFxQuote('USD', '2025-01-06');
    await fetchFxQuote('USD', quote.date);
    await fetchFxQuote('USD', '2025-01-06');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(300_001);
    await fetchFxQuote('USD', '2025-01-06');
    await fetchFxQuote('USD', quote.date);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('bounds successful cache entries to 100', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const date = new URL(url, 'https://almond.example').searchParams.get('date');
      return Response.json({ ...quote, date, asOf: date });
    });
    const dates = Array.from({ length: 101 }, (_, i) => new Date(Date.UTC(2024, 0, i + 1)).toISOString().slice(0, 10));
    for (const date of dates) await fetchFxQuote('USD', date);
    await fetchFxQuote('USD', dates[100]);
    expect(fetchMock).toHaveBeenCalledTimes(101);
    await fetchFxQuote('USD', dates[0]);
    expect(fetchMock).toHaveBeenCalledTimes(102);
  });
});
