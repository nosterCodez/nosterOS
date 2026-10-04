import { headers } from 'next/headers';
import { getAuth } from '@/lib/auth';
import { equalSecret, internalAllowed, safeNext } from '@/lib/auth-boundary';
import { GATE_COOKIE } from '@/lib/access-gate';
import { LEGACY_GATE_COOKIE } from '@/lib/auth-constants';
import { accessToken } from '@/lib/legacy-env';
import { redirect } from 'next/navigation';
import { openWorkspaceDb, withWorkspaceDb } from '@/lib/workspace-storage';
import { operatorWorkspaceId } from '@/lib/operator-workspace';

export type WorkspaceRole = 'viewer' | 'member' | 'admin' | 'owner';
const roleLevel: Record<WorkspaceRole, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };
export type WorkspaceCtx = {
  user: { id: string; email: string; name: string };
  workspace: { id: string; name: string; kind: 'founder' | 'agency' | 'client' };
  role: WorkspaceRole;
  db: ReturnType<typeof openWorkspaceDb>;
};

export class SessionError extends Error {
  constructor(message: string, public status = 401) { super(message); }
}
export async function requireSession(input?: Headers, optional = false) {
  const h = input ?? new Headers(await headers());
  if (!(h.get('cookie') ?? '').includes('better-auth.session_token=')) {
    if (optional) return null;
    throw new SessionError('Sign in required');
  }
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: h });
  if (!session && !optional) throw new SessionError('Sign in required');
  return session;
}

/** Resolve membership before opening workspace storage. */
export async function requireWorkspace(minRole: WorkspaceRole = 'viewer', input?: Headers, mode: 'page' | 'api' = 'page'): Promise<WorkspaceCtx> {
  const h = input ?? new Headers(await headers());
  const session = await requireSession(h, true);
  if (!session) {
    if (mode === 'page') redirect(`/sign-in?next=${encodeURIComponent(safeNext(h.get('x-nosteros-path')))}`);
    throw new SessionError('Sign in required');
  }
  if (!session.session.activeOrganizationId) {
    if (mode === 'page') redirect('/onboarding');
    throw new SessionError('Choose a workspace', 403);
  }
  const auth = await getAuth();
  const member = await auth.api.getActiveMember({ headers: h });
  const workspace = await auth.api.getFullOrganization({ headers: h });
  const role = member?.role as WorkspaceRole;
  if (!workspace || workspace.id !== session.session.activeOrganizationId || !(role in roleLevel) || roleLevel[role] < roleLevel[minRole]) throw new SessionError('Workspace access denied', 403);
  const metadata = typeof workspace.metadata === 'string' ? JSON.parse(workspace.metadata) : workspace.metadata;
  if (!metadata || !['founder', 'agency', 'client'].includes(metadata.kind)) throw new SessionError('Invalid workspace configuration', 403);
  return { user: session.user, workspace: { id: workspace.id, name: workspace.name, kind: metadata.kind }, role, get db() { return openWorkspaceDb(workspace.id); } };
}
/** Keep a workspace handle alive through asynchronous work, including late writes. */
export function withWorkspaceLease<R>(context: WorkspaceCtx, work: (db: WorkspaceCtx['db']) => R | Promise<R>) {
  return withWorkspaceDb(context.workspace.id, work);
}
/** API boundary preserves authorization status rather than leaking a redirect or 500. */
export async function apiWorkspace(input?: Headers): Promise<WorkspaceCtx | Response> {
  try { return await requireWorkspace('viewer', input, 'api'); }
  catch (error) {
    if (error instanceof SessionError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: 'Workspace unavailable' }, { status: 503 });
  }
}

export async function requireOperatorWorkspace(input?: Headers, mode: 'page' | 'api' = 'page'): Promise<WorkspaceCtx> {
  const context = await requireWorkspace('viewer', input, mode);
  if (context.workspace.kind !== 'agency' || context.workspace.id !== operatorWorkspaceId()) throw new SessionError('Available after your connections are set up', 403);
  return context;
}
export async function apiOperatorWorkspace(input?: Headers): Promise<WorkspaceCtx | Response> {
  try { return await requireOperatorWorkspace(input, 'api'); }
  catch (error) {
    if (error instanceof SessionError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: 'Workspace unavailable' }, { status: 503 });
  }
}
export async function operatorWorkspaceForPage(): Promise<WorkspaceCtx | null> {
  try { return await requireOperatorWorkspace(); }
  catch (error) { if (error instanceof SessionError && error.status === 403) return null; throw error; }
}
export async function apiSessionError(path: string, method: string, request?: Request): Promise<Response | null> {
  try {
    const h = request?.headers ?? new Headers(await headers());
    const outer = accessToken();
    const cookies = (h.get('cookie') ?? '').split(';').map(s => s.trim());
    const readCookie = (name: string) => cookies.find(s => s.startsWith(`${name}=`))?.slice(name.length + 1);
    const cookie = readCookie(GATE_COOKIE) ?? readCookie(LEGACY_GATE_COOKIE);
    if (outer && !equalSecret(cookie, outer)) throw new SessionError('Beta access required');
    if (method === 'POST' && internalAllowed(path, h.get('x-nosteros-internal'))) return null;
    const session = await requireSession(h);
    if (!session?.session.activeOrganizationId) throw new SessionError('Choose a workspace', 403);
    const auth = await getAuth();
    const membership = await auth.api.getActiveMember({ headers: h });
    if (!membership) throw new SessionError('Workspace membership required', 403);
    if (membership.role === 'viewer' && (method !== 'GET' || /\/(sync|refresh|ingest|tick|connect|callback)(\/|$)/.test(path))) throw new SessionError('Read-only workspace access', 403);
    if ((path.startsWith('/api/admin/') || path.startsWith('/api/oauth/') || path === '/api/connections/connect') && !['owner', 'admin'].includes(membership.role)) throw new SessionError('Workspace admin required', 403);
    if (method !== 'GET' && h.get('origin') !== new URL(process.env.NOSTEROS_BASE_URL!).origin) throw new SessionError('Invalid request origin', 403);
    return null;
  } catch (error) {
    if (error instanceof SessionError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: 'Authentication unavailable' }, { status: 503 });
  }
}
