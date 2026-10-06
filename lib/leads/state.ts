import type { FounderDb } from '@/lib/db';
import { planQuestions } from './questions';
export function leadPlanState(db: FounderDb) {
  const profile = db.businessProfiles.current(), latest = db.leadPlans.latest(), active = db.leadPlans.active();
  return { latest, active, profileVersion: profile?.version ?? null,
    profileChanged: Boolean(active && profile && active.profileVersion !== profile.version),
    questions: profile ? planQuestions(profile, db.leadPlans.preferences()) : [] };
}
export type LeadPlanState = ReturnType<typeof leadPlanState>;
