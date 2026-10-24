import { cloudConfigured, getAuth } from '@/lib/server/auth';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request) {
  if (!cloudConfigured()) return Response.json({ message: 'Authentication is not configured. See README.md for setup.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  try {
    const response = await getAuth().handler(request);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
  catch { return Response.json({ message: 'Authentication service is unavailable. Please try again.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
export const GET = handle;
export const POST = handle;
