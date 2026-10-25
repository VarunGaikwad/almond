# Manual-rate reporting

Almond's **Manual-rate estimate** is an optional reporting view, not currency exchange or a ledger migration. It works offline. There are no market-price fetches, external rate APIs, scheduled refreshes, or closed-app jobs.

## Data and validation

`FinanceData.exchangeRates?: ExchangeRate[]` contains directed, user-entered rates:

```json
{
  "id": "stable-user-generated-id",
  "source": "JPY",
  "target": "USD",
  "rate": "0.00666667",
  "asOf": "2025-01-01"
}
```

A rate means **target major currency units per one source major currency unit**. USD and INR have 100 minor units; JPY has one. Supported currencies are USD, JPY and INR only.

- Stable IDs are preserved during edits. Collection IDs and directed pairs must be unique.
- No identity pairs; at most six directed pairs.
- A rate is a positive plain decimal **string**, with 1–12 whole digits and at most eight fractional digits. No signs, whitespace, exponent notation, zero, or floating-point number values.
- `asOf` is the user's effective rate date, not a verified market timestamp or automatic retrieval time. It must be a real ISO `YYYY-MM-DD` date no later than the device's current local date.
- Calendar-day age is measured against that local date. More than seven days old is visibly marked **Stale**, but remains usable offline. Seven days exactly is not stale. Device clock accuracy is the user's responsibility.

`exchangeRateSchema` and `financeSchema` enforce these constraints at the shared persistence, sync and JSON-backup validation boundary. Rates remain JSON strings (no BigInts in persisted data). Legacy data without `exchangeRates` remains valid; optional schedules, goals and flexible budget fields are preserved. All rate edits/deletions must go through the parent's normal validated mutation/save flow.

## Reporting behavior

The selected target currency and month control the estimate. Balance includes **all accounts**, including archived accounts and zero balances, plus all posted transactions regardless of month. Income and expense include posted transactions in the selected month only. Transfers affect account balances but never monthly income or expense. Unposted schedules are not included.

Original-currency subtotals and account counts are displayed alongside the estimate. The report never converts stored account opening balances or transaction amounts. Cross-currency transfers are still forbidden, even when a rate exists.

Every foreign account currency needs one valid **direct** rate to the selected target, including a currency whose balance happens to be zero. No reciprocal, inverse or triangulated rates are inferred. Missing, invalid, future-dated or duplicate matching rates suppress the **entire** combined estimate, not just the affected accounts. Original-currency subtotals remain available. Stale rates do not suppress totals, but their dates and warnings remain visible.

## Arithmetic and limits

Conversions use BigInt rational arithmetic:

`source minor units × decimal numerator × target minor-unit scale / (decimal denominator × source minor-unit scale)`

Rounding is to the nearest target minor unit, with exact halfway values **away from zero**: `0.5 → 1`, `-0.5 → -1`. Each original-currency balance, income and expense subtotal is converted and rounded once, then converted subtotals are added. Combined net is combined rounded income minus combined rounded expense (not a separate conversion of original net). Consequently this estimate can differ from summing independently rounded transaction conversions.

Public numeric inputs must be safe integer minor units. BigInt intermediates avoid floating-point multiplication, including eight-decimal rates and large values. An individual converted subtotal, final total or net outside `±Number.MAX_SAFE_INTEGER` suppresses the combined estimate with an explicit error; it is never truncated or clamped. This also conservatively rejects an overflowing intermediate subtotal even if another subtotal would cancel it. Existing schema limits continue to apply to ledger amounts.

## Integration API

```tsx
import { ExchangeReporting } from '@/components/exchange';

<ExchangeReporting
  data={data}
  month={month}                 // YYYY-MM
  currency={currency}           // selected reporting target
  onSaveRate={saveRate}         // (rate: ExchangeRate) => Promise<void>
  onDeleteRate={deleteRate}     // (id: string) => Promise<void>
/>
```

The component owns the existing `Modal`-based add/edit/delete dialog and local pending/error states. The parent owns persistence: upsert `data.exchangeRates` by stable ID, or delete by ID, preserving all other collections. Validate the resulting **whole** `FinanceData` and persist through the existing store/sync mechanism. Errors reject the callback and remain visible in the dialog. Props must update after successful save/delete. The component does not write storage or fetch anything itself.

Pure helpers in `src/lib/exchange.ts`: `convertMinorUnits`, `exchangeReport`, `rateAgeDays`, and `isRateStale`. `exchangeReport` returns `combined: null` plus `missing` or `error` when no complete estimate can be shown, and always returns original subtotals for valid ledger data.

## Acceptance checklist

Automated unit checks in `tests/exchange.test.ts` cover:

- [x] Every USD/JPY/INR directed conversion, minor-unit scale differences.
- [x] Tiny, negative, huge, halfway and eight-place decimal values; unsafe input/output rejection.
- [x] Missing/direct-only/duplicate/invalid/future rate suppression.
- [x] Seven-day age boundary; stale but usable offline rates.
- [x] Legacy parse and JSON round trip, optional collection preservation, original ledger immutability.
- [x] Archived and zero-balance account inclusion, all-time balances and monthly flows.
- [x] Cross-currency transfer rejection remains in the finance schema.

Integrated browser checks in `tests/e2e/exchange-backup.spec.ts` passed:

- [x] Mount reporting with validated save/delete callbacks and the selected month/target.
- [x] Add/update/delete rates through the dialog; mobile Reports/dialog pass axe and overflow checks.
- [x] Reload offline and verify saved rates, as-of dates and stale warning.
- [x] Remove a required rate; withhold the combined total while keeping original subtotals.
- [x] Export/restore rates and all optional collections, without modifying ledger amounts; mocked sync remains compatible.
- [ ] Dedicated keyboard-only rate-dialog/error/focus workflow beyond automated accessibility checks.
- [ ] Real cross-device rate synchronization; live execution was expressly deferred.
