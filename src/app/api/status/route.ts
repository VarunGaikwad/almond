import { cloudConfigured } from '@/lib/server/auth';
export const dynamic = 'force-dynamic';
export function GET() { return Response.json({ configured: cloudConfigured() }); }
