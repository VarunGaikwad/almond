import type { Metadata } from 'next';
import AuthPage from '@/components/auth-page';
export const metadata: Metadata = { title: 'Reset password — Almond', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default async function ResetPassword({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams;
  return <AuthPage mode="reset" token={typeof token === 'string' ? token : undefined} invalidToken={Boolean(error)}/>;
}
