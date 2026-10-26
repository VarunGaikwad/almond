'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { currencyOf, localDate, reportingCurrency, type FxQuote } from '@/lib/finance';
import { fetchFxQuote } from '@/lib/fx-client';
import { applyTransactionQuotes, type Workspace } from '@/lib/store';

/** Daily reference quotes are UI-only; transaction snapshots are saved atomically. */
export function useExchangeRates(scope: string, workspace: Workspace | undefined, online: boolean) {
  const [revision, setRevision] = useState(0);
  const [latest, setLatest] = useState<{ scope: string; quotes: FxQuote[] }>({ scope, quotes: [] });
  const [status, setStatus] = useState({ loading: false, error: '' });
  const attempts = useRef(new Map<string, number>());
  const refreshed = useRef(new Map<string, number>());
  const running = useRef<Promise<void>>(Promise.resolve());
  // Saving a quote batch must not cancel the remaining backfill requests.
  const requestKey = workspace ? JSON.stringify([workspace.id, reportingCurrency(workspace.data), workspace.data.accounts.map(a => [a.id, currencyOf(a)]), workspace.data.transactions.map(t => [t.accountId, t.date])]) : '';
  const retry = useCallback(() => { attempts.current.clear(); refreshed.current.clear(); setRevision(n => n + 1); }, []);
  useEffect(() => {
    const foreground = () => { if (document.visibilityState === 'visible') setRevision(n => n + 1); };
    const timer = setInterval(foreground, 60_000);
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', foreground);
    return () => { clearInterval(timer); window.removeEventListener('online', retry); document.removeEventListener('visibilitychange', foreground); };
  }, [retry]);

  useEffect(() => {
    let cancelled = false;
    if (!workspace || workspace.id !== scope || workspace.conflict || !online) {
      setStatus({ loading: false, error: !online ? 'Offline. Missing conversions will resume when you reconnect.' : '' });
      return;
    }
    const { data } = workspace;
    const today = localDate();
    const target = reportingCurrency(data);
    const sources = [...new Set(data.accounts.map(currencyOf))];
    const requests = new Map<string, { source: FxQuote['source']; date: string; latest: boolean }>();
    const now = Date.now();
    for (const source of sources) {
      const key = `${source}:${today}`;
      if (source !== target && now - (refreshed.current.get(`${scope}:${key}`) ?? 0) >= 3_600_000) requests.set(key, { source, date: today, latest: true });
    }
    // A snapshot contains every supported target, so later primary switches need no rewrite.
    if (sources.length > 1) for (const t of data.transactions) {
      if (t.fx || t.date > today) continue;
      const source = currencyOf(data.accounts.find(a => a.id === t.accountId));
      const key = `${source}:${t.date}`;
      if (!requests.has(key)) requests.set(key, { source, date: t.date, latest: false });
    }
    const queue = [...requests.entries()].filter(([key]) => now - (attempts.current.get(`${scope}:${key}`) ?? 0) >= 60_000);
    if (!queue.length) { setStatus(previous => ({ ...previous, loading: false })); return; }
    setStatus({ loading: true, error: '' });
    const previous = running.current;
    const work = (async () => {
      await previous;
      if (cancelled) return;
      let failed = false;
      try {
        for (let index = 0; index < queue.length && !cancelled; index += 4) {
          const batch = queue.slice(index, index + 4);
          const results = await Promise.allSettled(batch.map(([key, request]) => {
            attempts.current.set(`${scope}:${key}`, Date.now());
            return fetchFxQuote(request.source, request.date);
          }));
          if (cancelled) return;
          const quotes: FxQuote[] = [];
          const current: FxQuote[] = [];
          results.forEach((result, i) => {
            if (result.status === 'rejected') { failed = true; return; }
            // Cool down failures only; another transaction can reuse a cached quote immediately.
            attempts.current.delete(`${scope}:${batch[i][0]}`);
            quotes.push(result.value);
            if (batch[i][1].latest) {
              current.push(result.value);
              refreshed.current.set(`${scope}:${batch[i][0]}`, Date.now());
            }
          });
          if (current.length) setLatest(previous => ({ scope, quotes: [...(previous.scope === scope ? previous.quotes : []).filter(q => !current.some(next => next.source === q.source)), ...current] }));
          if (failed) setStatus({ loading: true, error: 'Some exchange rates are unavailable. Native amounts are unchanged. Retry or wait a minute.' });
          // Store rechecks conflict and matches source/date against the current ledger.
          if (quotes.length) await applyTransactionQuotes(scope, quotes);
        }
      } catch (error) {
        if (!cancelled) setStatus({ loading: false, error: error instanceof Error ? error.message : 'Unable to save exchange rates.' });
        return;
      }
      if (!cancelled) setStatus({ loading: false, error: failed ? 'Some exchange rates are unavailable. Native amounts are unchanged. Retry or wait a minute.' : '' });
    })();
    running.current = work;
    return () => { cancelled = true; };
  }, [scope, requestKey, Boolean(workspace?.conflict), online, revision]);

  return { quotes: latest.scope === scope ? latest.quotes.filter(q => q.date === localDate()) : [], ...status, retry };
}
