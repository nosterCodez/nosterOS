import { createHash } from 'node:crypto';
import { z } from 'zod';
import { apiSessionError, requireWorkspace, withWorkspaceLease, SessionError } from '@/lib/session';
import { limitedBody } from '@/lib/connection-api';
import { configureSource, sourceViews } from '@/lib/cloud-sources';
import { syncSource } from '@/lib/cloud-jobs';
import { beginAuthorization, completeAuthorization, disconnectOAuth, oauthGeneration } from '@/lib/cloud-oauth';
import { CLOUD_SOURCES, cloudSource, oauthId } from '@/lib/cloud-catalog';
import { CloudError, CLOUD_ERROR_TEXT } from '@/lib/cloud-http';
import { discoverResources } from '@/lib/cloud-resources';
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const Configure = z.object({ action: z.literal('configure'), id: z.string().max(40), resource: z.string().max(500), enabled: z.boolean() }).strict();
const Action = z.union([Configure, z.object({ action: z.literal('authorize'), id: z.string().max(40), shop: z.string().max(100).optional() }).strict(), z.object({ action: z.enum(['sync', 'disconnect', 'resources']), id: z.string().max(40) }).strict()]);
export async function cloudRequest(request: Request) {
  const denied = await apiSessionError('/api/admin/sources', request.method, request); if (denied) return denied;
  try {
    const context = await requireWorkspace('admin', request.headers, 'api');
    if (request.method !== 'GET' && request.headers.get('x-omegaos-workspace') !== context.workspace.id) return json({ error: 'Workspace changed. Reload this page.' }, 409);
    const action = request.method === 'GET' ? null : Action.parse(await limitedBody(request));
    return await withWorkspaceLease(context, async db => {
      const ctx = { ...context, db };
      let outcome: unknown;
      if (action?.action === 'resources') {
        const provider = cloudSource(action.id).provider;
        if (!provider) throw new CloudError('setup');
        const generation = oauthGeneration(ctx, provider);
        const result = await discoverResources(ctx, action.id);
        const fresh = await requireWorkspace('admin', new Headers(request.headers), 'api');
        if (fresh.workspace.id !== context.workspace.id || fresh.user.id !== context.user.id || oauthGeneration(ctx, provider) !== generation) throw new CloudError('changed');
        return json(result);
      }
      if (action?.action === 'configure') configureSource(ctx, action.id, action);
      if (action?.action === 'sync') outcome = await syncSource(ctx, action.id, { manual: true });
      if (action?.action === 'authorize') return json(beginAuthorization({ ...ctx, sessionBinding: sessionBinding(request) }, oauthId(action.id), Date.now(), action.shop));
      if (action?.action === 'disconnect') {
        const source = cloudSource(action.id);
        if (source.provider) { disconnectOAuth(ctx, source.provider); for (const s of CLOUD_SOURCES.filter(s => s.provider === source.provider)) db.cloudSources.invalidate(s.id); }
        else db.cloudSources.invalidate(source.id);
      }
      return json({ sources: sourceViews(ctx), ...(outcome ? { outcome } : {}) });
    });
  } catch (e) {
    if (e instanceof SessionError) return json({ error: e.message }, e.status);
    return json({ error: e instanceof CloudError ? CLOUD_ERROR_TEXT[e.code] : 'Unable to update this source. Check settings and vault configuration.' }, 400);
  }
}
function sessionBinding(request: Request) {
  const token = (request.headers.get('cookie') ?? '').split(';').map(c => c.trim()).find(c => /^(?:__Secure-)?better-auth\.session_token=/.test(c)) ?? '';
  if (!token) throw new CloudError('permission');
  return createHash('sha256').update(token).digest('hex');
}
export async function cloudCallback(request: Request, provider: string) {
  const denied = await apiSessionError('/api/admin/sources', 'GET', request); if (denied) return denied;
  const destination = new URL('/integrations', process.env.NOSTEROS_BASE_URL!);
  try {
    const context = await requireWorkspace('admin', request.headers, 'api');
    const url = new URL(request.url); if (url.searchParams.has('error')) throw new CloudError('permission');
    await withWorkspaceLease(context, db => completeAuthorization({ ...context, db, sessionBinding: sessionBinding(request) }, oauthId(provider), url.searchParams.get('code') ?? '', url.searchParams.get('state') ?? '', fetch, async () => {
      const fresh = await requireWorkspace('admin', new Headers(request.headers), 'api');
      if (fresh.workspace.id !== context.workspace.id || fresh.user.id !== context.user.id) throw new CloudError('changed');
    }, url.searchParams));
    destination.searchParams.set('connection', 'authorized');
  } catch { destination.searchParams.set('connection', 'failed'); }
  return new Response(null, { status: 303, headers: { Location: destination.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
