import { z } from 'zod';
import { financeSchema, normalizeFinanceData, type FinanceData } from './finance';

export const SYNC_PROTOCOL_VERSION = 3;
export const SYNC_PROTOCOL_HEADER = 'X-Almond-Protocol';
export const BACKUP_VERSION = 3;
export const syncProtocolHeaders = { [SYNC_PROTOCOL_HEADER]: String(SYNC_PROTOCOL_VERSION) };

const backupSchema = z.object({
  format: z.literal('almond'),
  version: z.union([z.literal(1), z.literal(2), z.literal(BACKUP_VERSION)]),
  exportedAt: z.iso.datetime().optional(),
  data: financeSchema,
}).strict();

export function createBackup(data: FinanceData) {
  return { format: 'almond' as const, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), data: normalizeFinanceData(data) };
}

export function parseBackup(raw: unknown): FinanceData {
  return normalizeFinanceData(backupSchema.parse(typeof raw === 'string' ? JSON.parse(raw) : raw).data);
}
