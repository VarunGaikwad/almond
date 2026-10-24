import type { Metadata } from 'next';
import WorkspaceGate from '@/components/workspace-gate';
export const metadata: Metadata = { title: 'Sign in — Almond' };
export default function Login() { return <WorkspaceGate mode="login"/>; }
