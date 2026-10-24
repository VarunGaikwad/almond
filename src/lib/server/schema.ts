import { pgTable, text, timestamp, boolean, integer, bigint, jsonb } from 'drizzle-orm/pg-core';
import type { FinanceData } from '../finance';

export const user = pgTable('user', {
  id: text('id').primaryKey(), name: text('name').notNull(), email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false), image: text('image'),
  createdAt: timestamp('created_at').notNull().defaultNow(), updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
export const session = pgTable('session', {
  id: text('id').primaryKey(), expiresAt: timestamp('expires_at').notNull(), token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(), updatedAt: timestamp('updated_at').notNull().defaultNow(),
  ipAddress: text('ip_address'), userAgent: text('user_agent'), userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
});
export const account = pgTable('account', {
  id: text('id').primaryKey(), accountId: text('account_id').notNull(), providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'), refreshToken: text('refresh_token'), idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'), refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'), password: text('password'), createdAt: timestamp('created_at').notNull().defaultNow(), updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
export const verification = pgTable('verification', {
  id: text('id').primaryKey(), identifier: text('identifier').notNull(), value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(), createdAt: timestamp('created_at').notNull().defaultNow(), updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
export const rateLimit = pgTable('rate_limit', {
  id: text('id').primaryKey(), key: text('key').notNull().unique(), count: integer('count').notNull(), lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
});
export const workspace = pgTable('workspace', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  version: integer('version').notNull().default(0), data: jsonb('data').$type<FinanceData>().notNull(),
  mutationId: text('mutation_id'), updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
