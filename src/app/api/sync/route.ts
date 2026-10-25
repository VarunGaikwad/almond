import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { emptyData, financeSchema } from '@/lib/finance';
import { cloudConfigured, getAuth, getDatabase } from '@/lib/server/auth';
import { workspace } from '@/lib/server/schema';
import { SYNC_PROTOCOL_HEADER, SYNC_PROTOCOL_VERSION, syncProtocolHeaders } from '@/lib/data-format';
function protocolJson(body: unknown, init?: ResponseInit) {
  return Response.json(body, { ...init, headers: syncProtocolHeaders });
}
const incompatible = () => protocolJson({ error: 'Upgrade Almond to sync safely' }, { status: 426 });
const compatible = (request: Request) => request.headers.get(SYNC_PROTOCOL_HEADER) === String(SYNC_PROTOCOL_VERSION);
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const mutationSchema = z.object({
  userId: z.string().min(1), id: z.uuid(), baseVersion: z.number().int().min(0).max(2_000_000_000),
  sequence: z.number().int().nonnegative(), data: financeSchema,
});
const unavailable = () => protocolJson({ error: 'Cloud is unavailable. Your local data is unchanged.' }, { status: 503 });
async function identify(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  return session?.user.id;
}
async function readSnapshot(userId: string) {
  const database = getDatabase();
  await database.insert(workspace).values({ userId, data: emptyData() }).onConflictDoNothing();
  const [row] = await database.select().from(workspace).where(eq(workspace.userId, userId));
  return { version: row.version, data: row.data, mutationId: row.mutationId };
}
export async function GET(request: Request) {
  if (!cloudConfigured()) return unavailable();
  try {
    const userId = await identify(request);
    if (!userId) return protocolJson({ error: 'Sign in to sync' }, { status: 401 });
    if (new URL(request.url).searchParams.get('userId') !== userId) return protocolJson({ error: 'Workspace does not match session' }, { status: 403 });
    if (!compatible(request)) return incompatible();
    return protocolJson(await readSnapshot(userId));
  } catch { return unavailable(); }
}
export async function POST(request: Request) {
  if (!cloudConfigured()) return unavailable();
  // Cookie-authenticated writes require the configured application's exact origin.
  const origin = request.headers.get('origin');
  if (origin !== new URL(process.env.BETTER_AUTH_URL!).origin) return protocolJson({ error: 'Invalid origin' }, { status: 403 });
  if (!request.headers.get('content-type')?.startsWith('application/json')) return protocolJson({ error: 'Expected JSON' }, { status: 415 });
  try {
    const userId = await identify(request);
    if (!userId) return protocolJson({ error: 'Sign in to sync' }, { status: 401 });
    if (!compatible(request)) return incompatible();
    // Stream-limit before parsing instead of trusting the Content-Length header.
    const reader = request.body?.getReader();
    if (!reader) return protocolJson({ error: 'Missing request body' }, { status: 400 });
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) { await reader.cancel(); return protocolJson({ error: 'Workspace exceeds the 2 MB sync limit' }, { status: 413 }); }
      chunks.push(value);
    }
    let raw: unknown;
    try { raw = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { return protocolJson({ error: 'Invalid JSON' }, { status: 400 }); }
    const result = mutationSchema.safeParse(raw);
    if (!result.success) return protocolJson({ error: 'Invalid financial data', details: result.error.issues.map(i => i.message).slice(0, 5) }, { status: 400 });
    const mutation = result.data;
    // Client userId is only a session-switch guard, never the authorization source.
    if (mutation.userId !== userId) return protocolJson({ error: 'Workspace does not match session' }, { status: 403 });
    const current = await readSnapshot(userId);
    if (current.mutationId === mutation.id) return protocolJson(current);
    const [updated] = await getDatabase().update(workspace).set({
      data: mutation.data, version: sql`${workspace.version} + 1`, mutationId: mutation.id, updatedAt: new Date(),
    }).where(and(eq(workspace.userId, userId), eq(workspace.version, mutation.baseVersion))).returning();
    if (updated) return protocolJson({ data: updated.data, version: updated.version, mutationId: updated.mutationId });
    const latest = await readSnapshot(userId);
    return protocolJson(latest, { status: latest.mutationId === mutation.id ? 200 : 409 });
  } catch { return unavailable(); }
}
