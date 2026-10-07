import { z } from 'zod';
import { apiSessionError, requireWorkspace, SessionError } from '@/lib/session';
import { limitedBody } from '@/lib/connection-api';
import { isPlatformOwner } from '@/lib/platform-owner';
import { dataDir } from '@/lib/paths';
import { placesImportView, startPlacesImport } from '@/lib/leads/places-portal-job';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const PATH = '/api/platform/places-import';
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const Input = z.object({ action: z.literal('import'), replace: z.boolean() }).strict();

/** Platform owner only. Manual start of the RGV Places Portal import; never scheduled. */
async function handle(request: Request) {
  try {
    const context = await requireWorkspace('owner', request.headers, 'api');
    if (!isPlatformOwner(context)) return json({ error: 'Only the platform owner can import places.' }, 403);
    if (request.headers.get('x-omegaos-workspace') !== context.workspace.id) return json({ error: 'Workspace changed. Reload this page.' }, 409);
    if (request.method === 'GET') return json(placesImportView(dataDir()));
    const input = Input.parse(await limitedBody(request, 1000, true));
    const fresh = await requireWorkspace('owner', new Headers(request.headers), 'api');
    if (fresh.workspace.id !== context.workspace.id || fresh.user.id !== context.user.id || !isPlatformOwner(fresh)) return json({ error: 'Workspace changed. Reload this page.' }, 409);
    const started = startPlacesImport({ dataRoot: dataDir(), replace: input.replace });
    if (!started.ok) return json({ error: started.reason === 'busy' ? 'An import is already running.' : 'An RGV import already exists. Confirm replacement to import again.', ...placesImportView(dataDir()) }, 409);
    return json(placesImportView(dataDir()), 202);
  } catch (error) {
    return error instanceof SessionError ? json({ error: error.message }, error.status) : json({ error: 'Unable to start the import. Reload and try again.' }, 400);
  }
}
export async function GET(request: Request) { const denied = await apiSessionError(PATH, 'GET', request); return denied ?? handle(request); }
export async function POST(request: Request) { const denied = await apiSessionError(PATH, 'POST', request); return denied ?? handle(request); }
