import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/exchange-rates/route';

const fetchMock = vi.fn();
const provider = { amount: 1, base: 'USD', date: '2025-01-02', rates: { INR: 85.76, JPY: 157 } };
const request = (query = 'source=USD&date=2025-01-02') => new Request(`https://almond.example/api/exchange-rates?${query}`);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2025-01-06T12:00:00Z')); vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('public exchange-rate endpoint', () => {
  it.each(['', 'source=EUR&date=2025-01-02', 'source=USD', 'source=USD&date=2025-02-30', 'source=USD&date=2025-01-07', 'source=USD&date=2025-1-2', 'source=USD&date=2025-01-02&source=JPY', 'source=USD&date=2025-01-02&url=https://evil.example'])('rejects invalid query without upstream fetch: %s', async query => {
    expect((await GET(request(query))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    ['USD', { INR: 85.76, JPY: 157 }, { USD: '1', INR: '85.76', JPY: '157' }],
    ['JPY', { USD: 0.00636942675, INR: 0.54624 }, { JPY: '1', USD: '0.00636943', INR: '0.54624' }],
    ['INR', { USD: 0.01166, JPY: 1.8307 }, { INR: '1', USD: '0.01166', JPY: '1.8307' }],
  ])('normalizes %s quotes and only sends reference-rate parameters', async (source, rates, expected) => {
    fetchMock.mockResolvedValue(Response.json({ ...provider, base: source, rates }));
    const response = await GET(request(`source=${source}&date=2025-01-02`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ source, date: '2025-01-02', asOf: '2025-01-02', rates: expected });
    const [url, options] = fetchMock.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://api.frankfurter.dev');
    expect(parsed.pathname).toBe('/v1/2025-01-02');
    expect(Object.fromEntries(parsed.searchParams)).toEqual({ base: source, symbols: ['USD', 'JPY', 'INR'].filter(c => c !== source).join(',') });
    expect(options).toMatchObject({ redirect: 'error', next: { revalidate: 86400 } });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(response.headers.get('cache-control')).not.toContain('immutable');
  });
  it('accepts previous business-day data, including provisional today quotes', async () => {
    fetchMock.mockImplementation(async () => Response.json(provider));
    const weekend = await GET(request('source=USD&date=2025-01-05'));
    expect(weekend.status).toBe(200);
    expect((await weekend.json()).asOf).toBe('2025-01-02');
    const today = await GET(request('source=USD&date=2025-01-06'));
    expect(today.status).toBe(200);
    expect(fetchMock.mock.calls[1][1].next).toEqual({ revalidate: 3600 });
    expect(today.headers.get('cache-control')).toBe('public, max-age=3600, s-maxage=3600');
  });
  it.each([
    { ...provider, base: 'JPY' }, { ...provider, date: '2025-01-03' }, { ...provider, date: '2025-02-30' },
    { ...provider, amount: 2 }, { ...provider, rates: { JPY: 157 } },
    ...[0, -1, '85.76', null, 1e-12, 1e12].map(INR => ({ ...provider, rates: { JPY: 157, INR } })),
  ])('fails closed on invalid provider data %#', async body => {
    fetchMock.mockResolvedValue(Response.json(body));
    const response = await GET(request());
    expect(response.status).toBe(502);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it.each(['network', 'http', 'json'])('returns safe errors on %s failure', async kind => {
    if (kind === 'network') fetchMock.mockRejectedValue(new Error('private diagnostic'));
    else fetchMock.mockResolvedValue(kind === 'http' ? new Response('private diagnostic', { status: 429 }) : new Response('not json'));
    const response = await GET(request());
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain('private diagnostic');
  });
});
