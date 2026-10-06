import { z } from 'zod';
import type { FounderDb } from '@/lib/db';
import { leadEngineEnabled } from './flags';
export const LeadRunState = z.object({ enabled: z.boolean(), ready: z.boolean(), runs: z.array(z.object({
  id: z.string(), planId: z.string(), state: z.string(), createdAt: z.string(), errorCode: z.string().nullable(), jobs: z.number(), found: z.number(),
})).max(10) });
export type LeadRunState = z.infer<typeof LeadRunState>;
export function leadRunState(id: string, db: FounderDb): LeadRunState {
  const plan = db.leadPlans.active(), profile = db.businessProfiles.current();
  return LeadRunState.parse({ enabled: leadEngineEnabled(id), ready: Boolean(plan && profile && plan.profileVersion === profile.version), runs: db.leadJobs.recent() });
}
