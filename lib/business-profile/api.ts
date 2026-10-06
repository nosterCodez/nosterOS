import { z } from 'zod';
import { apiSessionError, requireWorkspace, withWorkspaceLease, SessionError } from '@/lib/session';
import { limitedBody } from '@/lib/connection-api';
import { BusinessProfile, ProfileVersion } from './schema';
import { ProfileInputError } from './parser';
const Input = z.object({ markdown: z.string().max(40000) }).strict();
const Restore = z.object({ id: z.string().uuid() }).strict();
const State = z.object({ current: BusinessProfile.nullable(), versions: z.array(ProfileVersion).max(20) }).strict();
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
export async function businessProfileRequest(request: Request, action: 'profile' | 'versions' | 'restore') {
  const path = '/api/business-profile' + (action === 'profile' ? '' : `/${action}`);
  const denied = await apiSessionError(path, request.method, request); if (denied) return denied;
  try {
    const context = await requireWorkspace(request.method === 'GET' ? 'viewer' : 'member', request.headers, 'api');
    if (request.headers.get('x-omegaos-workspace') !== context.workspace.id) return json({ error: 'Workspace changed. Reload this page.' }, 409);
    if (request.method === 'GET') {
      const query = z.object({ id: z.string().uuid().optional() }).strict().parse(Object.fromEntries(new URL(request.url).searchParams));
      return await withWorkspaceLease(context, db => {
        if (action === 'versions') return json({ versions: z.array(ProfileVersion).max(20).parse(db.businessProfiles.list()) });
        if (query.id) {
          const profile = db.businessProfiles.get(query.id);
          return profile ? json({ profile: BusinessProfile.parse(profile) }) : json({ error: 'Profile version not found' }, 404);
        }
        return json(State.parse({ current: db.businessProfiles.current(), versions: db.businessProfiles.list() }));
      });
    }
    const body = await limitedBody(request, 250000, true);
    const input = action === 'restore' ? Restore.parse(body) : Input.parse(body);
    const fresh = await requireWorkspace('member', new Headers(request.headers), 'api');
    if (fresh.workspace.id !== context.workspace.id || fresh.user.id !== context.user.id) return json({ error: 'Workspace changed. Reload this page.' }, 409);
    return await withWorkspaceLease(fresh, db => {
      if ('id' in input) {
        if (!db.businessProfiles.get(input.id)) return json({ error: 'Profile version not found' }, 404);
        db.businessProfiles.restore(input.id, fresh.user.id);
      } else db.businessProfiles.save(input.markdown, fresh.user.id);
      return json(State.parse({ current: db.businessProfiles.current(), versions: db.businessProfiles.list() }));
    });
  } catch (error) {
    if (error instanceof SessionError) return json({ error: error.message }, error.status);
    if (error instanceof ProfileInputError) return json({ error: error.message, lines: error.lines }, 400);
    return json({ error: 'Unable to process profile. Check the size and fields, then reload if needed.' }, 400);
  }
}
