import type { Metadata } from 'next';
import AuthPage from '@/components/auth-page';
export const metadata: Metadata = { title: 'Forgot password — Almond', robots: { index: false, follow: false } };
export default function ForgotPassword() { return <AuthPage mode="forgot"/>; }
