'use client';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { currencyOf, type Currency, type FinanceData, type FxQuote } from '@/lib/finance';
import { currentReportingBalance } from '@/lib/exchange';

type ExchangeReportingProps = {
  data: FinanceData; currency: Currency; quotes: FxQuote[];
  loading: boolean; error: string; onRetry: () => void;
};

const rateDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function ExchangeReporting({ data, currency, quotes, loading, error, onRetry }: ExchangeReportingProps) {
  const balance = currentReportingBalance(data, currency, quotes);
  const sources = [...new Set(data.accounts.map(currencyOf))].filter(source => source !== currency);
  return <section className="exchange-reporting" aria-label="Automatic currency reporting">
    <div className="exchange-overview">
      <div className="exchange-summary">
        <h2>Reporting in <span className="exchange-currency">{currency}</span></h2>
        {sources.length ? <ul className="exchange-quotes">{sources.map(source => {
          const quote = quotes.find(q => q.source === source);
          return <li key={source}>{quote ? <>
            <span className="exchange-rate">1 {source} = {quote.rates[currency]} {currency}</span>
            <span>Rate dated <time dateTime={quote.asOf}>{rateDate.format(new Date(`${quote.asOf}T12:00:00`))}</time></span>
          </> : <span>{source} → {currency}: Conversion pending</span>}</li>;
        })}</ul> : <p className="exchange-no-conversion">No currency conversion needed.</p>}
      </div>
      <button className="button secondary exchange-refresh" disabled={loading} onClick={onRetry} aria-label={loading ? 'Loading exchange rates' : error ? 'Retry exchange rates' : 'Refresh exchange rates'}>
        <RefreshCw size={14} aria-hidden="true"/>{loading ? 'Refreshing…' : error ? 'Retry' : 'Refresh'}
      </button>
    </div>
    {loading && <p className="exchange-status" role="status">Loading exchange rates…</p>}
    {error && <p className="exchange-status exchange-error" role="status">{error}</p>}
    {balance === null && <p className="exchange-status" role="status">Conversion pending. No partial total is shown.</p>}
    <details className="exchange-details">
      <summary><span>Includes archived accounts</span><span className="exchange-details-label">Details <ChevronDown size={14} aria-hidden="true"/></span></summary>
      <div className="exchange-explanation">
        <p>Your primary account sets the reporting currency. All accounts, including archived accounts, are included. Original account amounts stay unchanged.</p>
        <p>Balances use the latest available daily reference rates, refreshed hourly while open—not live market prices. Income, expenses and charts use saved transaction-date rates.</p>
        {sources.length > 0 && <ul>{sources.map(source => {
          const quote = quotes.find(q => q.source === source);
          return quote ? <li key={source}>{source} → {currency} · Requested <time dateTime={quote.date}>{rateDate.format(new Date(`${quote.date}T12:00:00`))}</time></li> : null;
        })}</ul>}
      </div>
    </details>
  </section>;
}
