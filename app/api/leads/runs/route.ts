import { z } from 'zod';
import { apiSessionError, requireWorkspace, withWorkspaceLease, SessionError } from '@/lib/session';
import { limitedBody } from '@/lib/connection-api';
import { leadEngineEnabled } from '@/lib/leads/flags';
import { leadRunState } from '@/lib/leads/run-state';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
async function handle(request: Request) {
  const denied = await apiSessionError('/api/leads/runs', request.method, request); if (denied) return denied;
  try {
    const context = await requireWorkspace(request.method === 'GET' ? 'viewer' : 'admin', request.headers, 'api');
    if (request.headers.get('x-omegaos-workspace') !== context.workspace.id) return json({ error: 'Workspace changed. Reload this page.' }, 409);
    if (request.method === 'GET') return withWorkspaceLease(context, db => json(leadRunState(context.workspace.id, db)));
    z.object({ action: z.literal('run') }).strict().parse(await limitedBody(request, 1000, true));
    const fresh = await requireWorkspace('admin', new Headers(request.headers), 'api');
    if (fresh.workspace.id !== context.workspace.id || fresh.user.id !== context.user.id) return json({ error: 'Workspace changed. Reload this page.' }, 409);
    return withWorkspaceLease(fresh, db => {
      if (!leadEngineEnabled(fresh.workspace.id)) return json({ error: 'Discovery is in private beta for approved workspaces only.' }, 403);
      const plan = db.leadPlans.active(), profile = db.businessProfiles.current();
      if (!plan || !profile || plan.profileVersion !== profile.version) return json({ error: 'Activate a plan for your current Business Profile first.' }, 409);
      const result = db.leadJobs.enqueue(plan, 'manual', db.leadPlans.preferences().runSchedule ?? 'daily');
      if (!result.ok) return json({ error: result.reason === 'manual_daily_limit' ? 'Run now is limited to three requests per UTC day.' : 'The weekly candidate target has been reached.' }, 429);
      return json(leadRunState(fresh.workspace.id, db), 202);
    });
  } catch (error) {
    return error instanceof SessionError ? json({ error: error.message }, error.status) : json({ error: 'Unable to queue discovery. Reload and try again.' }, 400);
  }
}
export async function GET(request: Request) { const denied = await apiSessionError('/api/leads/runs', 'GET', request); return denied ?? handle(request); }
export async function POST(request: Request) { const denied = await apiSessionError('/api/leads/runs', 'POST', request); return denied ?? handle(request); }
