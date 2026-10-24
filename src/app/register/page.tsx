import type { Metadata } from 'next';
import WorkspaceGate from '@/components/workspace-gate';
export const metadata: Metadata = { title: 'Create an account — Almond' };
export default function Register() { return <WorkspaceGate mode="register"/>; }
