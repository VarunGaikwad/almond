# Manual spreadsheet import format

## Excel workbook (recommended)

Choose **Settings → Import spreadsheet → Download XLSX template**. The workbook includes a `Transactions` sheet with typed dates/numbers and income/expense examples, an `Instructions` sheet, and a `Reference` sheet mapping your active account/category IDs to names and currencies. Dropdowns use these workspace IDs. Replace or delete the examples before importing; keep the seven headers unchanged.

Save as `.xlsx` and upload it in the same dialog. Only `Transactions` is imported. Dates must be real Excel dates or ISO text dates; amounts must be numeric cells, not numeric text. Other fields must be text. Formula, error, hyperlink and rich-text cells are rejected, even if a cached value is present. Date formatting and dropdown/positive-number validation cover rows 2–10001, but pasting can bypass spreadsheet rules: Almond revalidates cell types, monetary precision, references, duplicates and ledger limits before saving.

XLSX files are limited to 2 MiB compressed, 20 MiB expanded ZIP content, 1,000 ZIP entries and 10,000 data rows. Encrypted workbooks and legacy `.xls`/`.xlsm` files are not supported. Download a fresh template after changing accounts or categories. CSV compatibility and the shared validation/confirmation rules are documented below.

## CSV compatibility

Almond accepts one strict canonical format, not arbitrary bank or Cashew exports. Reshape other exports into the columns below before choosing a file. There is no automatic column mapping, Google OAuth, Sheets connection, scheduled sync, or bank adapter.

## Prepare a Google Sheet

Create these columns in this exact order and spelling, then use **File → Download → Comma-separated values (.csv)** on that sheet:

```csv
date,title,type,amount,account,category,notes
2026-02-28,"Coffee, large",expense,4.50,checking,food,"With a friend"
2026-03-01,Salary,income,2500.00,checking,income,
```

The entire final `notes` column may be omitted, including its header. If present, every record must have seven fields, even when notes is empty; otherwise every record must have six fields. Header names are case-sensitive; no extra columns, reordered columns, or whitespace around headers. Quoted headers are allowed if their decoded values match exactly.

| Column | Mapping and validation |
| --- | --- |
| `date` | Real ISO calendar date, `YYYY-MM-DD` (not a locale-specific Sheets date). |
| `title` | Required, 1–100 characters after surrounding whitespace removal and Unicode NFC normalization. |
| `type` | Exactly `income` or `expense`. Transfers and other types are rejected. |
| `amount` | Positive decimal money in the resolved account’s currency, **not integer minor units**. USD/INR accept up to two decimal places (`12.34` → 1234 cents/paise); JPY requires whole yen (`1234` → 1234 yen). No signs, currency symbols, grouping separators, exponent notation or rounding. Maximum 100,000,000,000 minor units. Surrounding whitespace is removed. |
| `account` | Existing account’s exact case-sensitive name or stable ID. IDs take precedence over names. Ambiguous names require an ID; unknown, unsupported-currency and archived accounts are rejected. Create or restore accounts first. Currency is read from the account (legacy accounts default to USD), never inferred from the amount. Supported currencies: USD, JPY, INR. |
| `category` | Existing category’s exact case-sensitive name or stable ID. IDs take precedence; ambiguous names require an ID. Unknown categories are rejected. Create categories first. |
| `notes` | Optional text, at most 1,000 characters after trimming and NFC normalization. Empty and absent notes are equivalent. |

Account and category references are not trimmed or case-folded: copy names or IDs exactly. Use a plain-number format in Sheets, no currency symbols or thousands separators, and ensure dates export as ISO dates.

## CSV syntax and bounds

Files must be UTF-8, optionally with an initial BOM. Both LF and CRLF record separators are supported. Enclose fields containing commas, quotes or newlines in double quotes; escape a literal quote as `""`. Embedded CRLF is normalized to LF. Unquoted quotes, text after a closing quote, unclosed quotes and lone CR characters reject the entire file. A final line ending is allowed. Blank records are **not** silently skipped; they appear as invalid rows.

Maximum file size: 2 MiB (2,097,152 UTF-8 bytes). Maximum data records: 10,000, excluding the header; embedded newlines do not create additional records. The ledger also has a **total** limit of 10,000 transactions, including existing entries. Structural/header/size errors reject the file; field/column-count errors stay associated with their logical CSV record number in the preview. Record 1 is the header, so the first data record is row 2, even with embedded newlines.

## Preview and confirmation

The preview reports total, valid, invalid and duplicate counts separately and displays the first 50 records only. Errors are row-specific and do not interpolate untrusted field contents into error messages. Invalid and duplicate records are excluded and cannot be selected. All valid nonduplicate records are selected by default, **including records beyond the visible preview**. Visible valid records can be unchecked. Split large files into smaller files to inspect or individually exclude every record. Confirmation explicitly shows the selected count before importing.

Duplicate comparison uses a deterministic tuple of date, normalized title, type, integer amount, account ID, category ID and normalized notes. Normalization trims surrounding whitespace, converts CRLF/CR to LF, and uses Unicode NFC; it does not lowercase or collapse internal whitespace. IDs generated for transactions, account/category names versus IDs, and decimal spelling do not affect matching. Duplicate detection checks both the existing ledger and earlier valid records in the same file. Identical legitimate purchases are also excluded; change a distinguishing field such as notes if they really are separate transactions. Importing the same records again is prevented while those records remain in the ledger; this is not a permanent audit trail of deleted transactions.

No transactions are written while parsing or previewing. On confirmation all selected validated rows must append together, or the operation fails without saving any of them. A concurrent duplicate, account archive/deletion, category deletion or ledger limit change makes confirmation fail; reopen/reselect the file for a fresh preview.

## Integration contract

`CsvImport` in `src/components/csv-import.tsx` accepts `data: FinanceData`, `onClose: () => void`, and `onImport: (transactions: Transaction[]) => Promise<void>`. It never mutates `data`. The parent application wires its entry point and persistence callback. XLSX parsing is lazy-loaded from `src/lib/xlsx-import.ts` and uses the same row-validation pipeline.

**The callback must validate inside the atomic store mutation, against its latest data, not only against the UI snapshot.** Use the exported helper from `src/lib/csv-import.ts`:

```ts
await changeData(workspaceId, current => {
  const batch = validateCsvImport(current, transactions);
  current.transactions = [...current.transactions, ...batch];
});
```

`validateCsvImport` returns a validated batch without mutating either input. It rejects invalid records, duplicate identities/IDs within the batch or current ledger, missing/archived accounts, missing categories and total-limit violations. It validates the resulting finance document before returning. Do not call it outside the atomic mutation and then append later; that creates a race. Do not individually save rows or silently filter conflicts during confirmation. The store transaction must propagate failure so that no partial import is committed.
