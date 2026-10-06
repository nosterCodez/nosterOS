import { z } from 'zod';
import { apiSessionError, requireWorkspace, withWorkspaceLease, SessionError } from '@/lib/session';
import { limitedBody } from '@/lib/connection-api';
import { LeadPlan, mergePreferences } from './schema';
import { generatePlan } from './plan';
import { answerPreferences, planQuestions } from './questions';
import { leadPlanState } from './state';
const Input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('generate') }).strict(),
  z.object({ action: z.literal('edit'), id: z.string().uuid(), plan: LeadPlan }).strict(),
  z.object({ action: z.literal('answer'), id: z.string().uuid(), skip: z.boolean(), answers: z.record(z.union([z.string().max(200), z.number().finite(), z.boolean()])) }).strict(),
  z.object({ action: z.literal('activate'), id: z.string().uuid() }).strict(),
]);
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
export async function leadPlanRequest(request: Request) {
  const denied = await apiSessionError('/api/leads/plan', request.method, request); if (denied) return denied;
  try {
    const context = await requireWorkspace(request.method === 'GET' ? 'viewer' : 'member', request.headers, 'api');
    if (request.headers.get('x-omegaos-workspace') !== context.workspace.id) return json({ error: 'Workspace changed. Reload this page.' }, 409);
    if (request.method === 'GET') return withWorkspaceLease(context, db => json(leadPlanState(db)));
    const input = Input.parse(await limitedBody(request, 60000, true));
    const fresh = await requireWorkspace(input.action === 'activate' ? 'admin' : 'member', new Headers(request.headers), 'api');
    if (fresh.workspace.id !== context.workspace.id || fresh.user.id !== context.user.id) return json({ error: 'Workspace changed. Reload this page.' }, 409);
    return await withWorkspaceLease(fresh, async db => {
      const profile = db.businessProfiles.current();
      if (!profile) return json({ error: 'Save a Business Profile before generating a plan.' }, 409);
      if (input.action === 'generate') {
        const result = await generatePlan({ workspace: fresh.workspace, db }, profile, db.leadPlans.preferences());
        // Generation can await a provider; authorization and inputs may have changed meanwhile.
        const current = await requireWorkspace('member', new Headers(request.headers), 'api');
        if (current.workspace.id !== fresh.workspace.id || current.user.id !== fresh.user.id) return json({ error: 'Workspace changed. Reload this page.' }, 409);
        if (db.businessProfiles.current()?.version !== profile.version) return json({ error: 'Profile changed during generation. Generate a new plan.' }, 409);
        db.leadPlans.saveDraft({ plan: mergePreferences(result.plan, db.leadPlans.preferences()), generatedBy: result.generatedBy, profileVersion: profile.version });
        return json({ ...leadPlanState(db), generation: { costUsd: result.costUsd, attemptedProvider: result.attemptedProvider } });
      }
      const item = db.leadPlans.get(input.id);
      if (!item) return json({ error: 'Plan not found.' }, 404);
      if (item.profileVersion !== profile.version) return json({ error: 'Profile changed. Generate and review a new plan.' }, 409);
      if (input.action === 'edit') db.leadPlans.edit(input.id, input.plan, fresh.user.id);
      if (input.action === 'answer') {
        const patch = answerPreferences(input.skip ? {} : input.answers, item.plan, planQuestions(profile, db.leadPlans.preferences()));
        db.leadPlans.answer(input.id, patch, fresh.user.id, input.skip ? 'default' : 'answer');
      }
      if (input.action === 'activate') {
        if (item.status === 'archived' || item.plan.targets.some(t => !t.cities.length)) return json({ error: 'Review this draft and choose target cities before activation.' }, 409);
        db.leadPlans.activate(input.id, { id: fresh.user.id, role: fresh.role }, profile.version);
      }
      return json(leadPlanState(db));
    });
  } catch (error) {
    if (error instanceof SessionError) return json({ error: error.message }, error.status);
    return json({ error: 'Unable to save the plan. Check the fields and reload if needed.' }, 400);
  }
}
