import type { BusinessProfile } from '@/lib/business-profile/schema';
import type { VaultContext } from '@/lib/creds';
import { runLeadAi } from '@/lib/ai/lead-ai';
import { LeadPlan, LeadPlanDraft, Preferences, mergePreferences, signalKeys, leadPlanJsonSchema } from './schema';
export { mergePreferences } from './schema';
export function words(input: string | undefined, limit: number, width: number): string[] {
  return [...new Set((input ?? '').split(/[,;\n]/).map(s => s.replace(/^[-*]\s*/, '').trim()).filter(s => s && !/^unknown\b/i.test(s)))]
    .slice(0, limit).map(s => s.slice(0, width));
}
export function rulesPlan(profile: BusinessProfile): LeadPlan {
  const s = profile.sections, labels = words(s.ideal_customer, 5, 60);
  return LeadPlan.parse({ targets: (labels.length ? labels : ['Local service businesses']).map(label => ({ label,
    searchQueries: [label], cities: words(s.service_area, 10, 100), radiusMiles: 25 })),
    exclusions: { keywords: words(s.customers_to_avoid, 30, 100), excludeFranchises: true, excludeDomains: [] },
    signals: [{ key: 'no_website', weight: 3 }, { key: 'no_booking_tool', weight: 2 }, { key: 'has_contact_email', weight: 2 },
      { key: 'within_radius_core', weight: 1 }], hotThreshold: 60, weeklyLeadTarget: 25, maxPaidLookupsPerWeek: 0,
    angles: [{ name: 'Practical support', oneLiner: 'Discuss the business goals and whether our services are a fit.', bestFor: labels[0] ?? 'Local service businesses' }],
    tone: s.tone_and_voice?.slice(0, 300) ?? 'Direct, respectful and helpful',
    senderIdentity: { businessName: '', website: '', mailingAddress: '' } });
}
export async function generatePlan(ctx: VaultContext, profile: BusinessProfile, preferences: Preferences) {
  const result = await runLeadAi(ctx, { feature: 'lead_plan', profile, schema: LeadPlanDraft, jsonSchema: leadPlanJsonSchema,
    instruction: 'Create a draft lead plan using only the supplied business facts. Do not invent geography, proof, prices, contact information or claims. Leave unknown sender fields and cities empty. Set maxPaidLookupsPerWeek to 0. Use only the fixed signal keys from the schema. No sending or searching is authorized.' });
  const draft = result.value ? LeadPlanDraft.safeParse(result.value) : null;
  const candidate = draft?.success ? LeadPlan.safeParse({ ...draft.data, maxPaidLookupsPerWeek: 0,
    signals: draft.data.signals.filter(s => signalKeys.includes(s.key)) }) : null;
  return { plan: mergePreferences(candidate?.success ? candidate.data : rulesPlan(profile), preferences),
    generatedBy: candidate?.success ? result.generatedBy : 'rules' as const, attemptedProvider: result.generatedBy,
    costUsd: result.costUsd, reason: result.reason };
}
