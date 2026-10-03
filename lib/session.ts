import { headers } from 'next/headers';
import { getAuth } from '@/lib/auth';
import { equalSecret, internalAllowed } from '@/lib/auth-boundary';
import { GATE_COOKIE } from '@/lib/access-gate';

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
export async function apiSessionError(path: string, method: string, request?: Request): Promise<Response | null> {
  try {
    const h = request?.headers ?? new Headers(await headers());
    const outer = process.env.FOUNDER_OS_ACCESS_TOKEN;
    const cookie = (h.get('cookie') ?? '').split(';').map(s => s.trim()).find(s => s.startsWith(`${GATE_COOKIE}=`))?.slice(GATE_COOKIE.length + 1);
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
