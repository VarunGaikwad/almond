import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

it('loads both Neon env file locations, with local overrides last', () => {
  const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(scripts['db:migrate']).toContain('node --env-file-if-exists=.env --env-file-if-exists=.env.local ');
});

it('uses the direct Neon connection for migrations when supplied', async () => {
  vi.stubEnv('DATABASE_URL', 'postgresql://example-pooler/db');
  vi.stubEnv('DATABASE_URL_UNPOOLED', 'postgresql://example/db');
  vi.resetModules();
  const { default: config } = await import('../drizzle.config');
  expect(config).toMatchObject({ dbCredentials: { url: 'postgresql://example/db' } });
});

it('keeps existing DATABASE_URL-only configurations working', async () => {
  vi.stubEnv('DATABASE_URL', 'postgresql://existing/db');
  vi.stubEnv('DATABASE_URL_UNPOOLED', '');
  vi.resetModules();
  const { default: config } = await import('../drizzle.config');
  expect(config).toMatchObject({ dbCredentials: { url: 'postgresql://existing/db' } });
});
