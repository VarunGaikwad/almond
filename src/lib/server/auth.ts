import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';
import { sendPasswordResetEmail } from './password-email';

export function cloudConfigured() {
  return Boolean(process.env.DATABASE_URL && process.env.BETTER_AUTH_URL && (process.env.BETTER_AUTH_SECRET?.length ?? 0) >= 32);
}
let database: ReturnType<typeof createDatabase> | undefined;
function createDatabase() { return drizzle(process.env.DATABASE_URL!, { schema }); }
export function getDatabase() {
  if (!cloudConfigured()) throw new Error('Cloud is not configured');
  return database ??= createDatabase();
}
function createAuth() {
  return betterAuth({
    appName: 'Almond', baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDatabase(), { provider: 'pg', schema }),
    emailAndPassword: {
      enabled: true, minPasswordLength: 12, maxPasswordLength: 128,
      sendResetPassword: sendPasswordResetEmail,
      resetPasswordTokenExpiresIn: 3600,
      revokeSessionsOnPasswordReset: true,
    },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 60,
      customRules: { '/request-password-reset': { window: 60, max: 3 } },
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    // Do not enable cookie session caching: server authorization must see revocations.
  });
}
let auth: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  if (!cloudConfigured()) throw new Error('Cloud is not configured');
  return auth ??= createAuth();
}
