import { describe, expect, it } from 'vitest';
import { BACKUP_VERSION, createBackup, parseBackup, SYNC_PROTOCOL_VERSION } from '@/lib/data-format';
import { emptyData, financeSchema, sampleData } from '@/lib/finance';

describe('backup compatibility', () => {
  it('uses version 2 for backups and sync', () => {
    expect(BACKUP_VERSION).toBe(2); expect(SYNC_PROTOCOL_VERSION).toBe(2);
    const data = sampleData();
    expect(createBackup(data).version).toBe(2);
    expect(parseBackup(JSON.stringify(createBackup(data)))).toEqual(data);
  });
  it('accepts legacy v1 exports and conflict downloads without a timestamp', () => {
    const data = emptyData();
    expect(parseBackup({ format: 'almond', version: 1, data })).toEqual(data);
    expect(parseBackup({ format: 'almond', version: 1, exportedAt: '2025-01-01T00:00:00.000Z', data })).toEqual(data);
  });
  it('round trips new persisted entities and links', () => {
    const data = sampleData();
    data.schedules = [{ id: 's', title: 'Rent', amount: 100, type: 'expense', accountId: 'checking', categoryId: 'home', frequency: 'monthly', anchorDate: '2025-01-01', nextDue: '2025-02-01' }];
    data.goals = [{ id: 'g', name: 'Savings', kind: 'saving', target: 1000, transactionIds: ['salary'] }];
    data.exchangeRates = [{ id: 'r', source: 'USD', target: 'JPY', rate: '150.5', asOf: '2025-01-01' }];
    data.budgets.push({ id: 'b', categoryIds: ['food', 'home'], amount: 1000, startDate: '2025-01-01', endDate: '2025-02-01', transactionIds: ['sample-0'] });
    expect(parseBackup(createBackup(data))).toEqual(data);
  });
  it.each([
    null, {}, { format: 'almond', version: 2 },
    { format: 'almond', version: 3, data: emptyData() },
    { format: 'almond', version: 0, data: emptyData() },
    { format: 'other', version: 2, data: emptyData() },
    { format: 'almond', version: 2, data: {} },
    { format: 'almond', version: 2, data: null },
    { format: 'almond', version: 2, data: emptyData(), exportedAt: 'invalid' },
    '{invalid json',
  ])('rejects unsupported or malformed backups without silent replacement', raw => {
    expect(() => parseBackup(raw)).toThrow();
  });
  it.each(['accounts', 'categories', 'transactions', 'budgets', 'schedules', 'goals', 'exchangeRates'] as const)('rejects unknown fields on %s entities', key => {
    const data = sampleData();
    const base = {
      schedules: [{ id: 's', title: 'Rent', amount: 100, type: 'expense', accountId: 'checking', categoryId: 'home', frequency: 'monthly', anchorDate: '2025-01-01', nextDue: '2025-02-01' }],
      goals: [{ id: 'g', name: 'Savings', kind: 'saving', target: 1000, transactionIds: [] }],
      exchangeRates: [{ id: 'r', source: 'USD', target: 'JPY', rate: '150', asOf: '2025-01-01' }],
    };
    const raw = { ...data, ...base };
    const unknown = { ...raw, [key]: raw[key].map((row, i) => i === 0 ? { ...row, futureField: true } : row) };
    expect(financeSchema.safeParse(raw).success).toBe(true);
    expect(financeSchema.safeParse(unknown).success).toBe(false);
    expect(() => parseBackup({ format: 'almond', version: 2, data: unknown })).toThrow();
  });
  it('rejects unknown top-level financial fields instead of stripping them', () => {
    const raw = { ...emptyData(), futureFeature: [] };
    expect(financeSchema.safeParse(raw).success).toBe(false);
    expect(() => createBackup(raw)).toThrow();
  });
});
