import { z } from 'zod';
import { SIGNALS } from './signals';
export const signalKeys = SIGNALS.map(s => s.key) as [string, ...string[]];
const text = (max: number) => z.string().trim().max(max).regex(/^[^\x00-\x08\x0b\x0c\x0e-\x1f]*$/, 'Invalid text');
const list = (max: number, length: number) => z.array(text(length).min(1)).max(max);
export const LeadPlan = z.object({
  targets: z.array(z.object({ label: text(100).min(1), searchQueries: list(4, 60).min(1), cities: list(10, 100),
    radiusMiles: z.number().int().min(1).max(100) }).strict()).min(1).max(5),
  exclusions: z.object({ keywords: list(30, 100), excludeFranchises: z.boolean(), excludeDomains: list(30, 253) }).strict(),
  signals: z.array(z.object({ key: z.enum(signalKeys), weight: z.number().int().min(-3).max(3) }).strict()).max(16)
    .refine(rows => new Set(rows.map(r => r.key)).size === rows.length, 'Duplicate signal'),
  hotThreshold: z.number().int().min(0).max(100), weeklyLeadTarget: z.number().int().min(5).max(500),
  maxPaidLookupsPerWeek: z.number().int().min(0).max(200),
  angles: z.array(z.object({ name: text(100).min(1), oneLiner: text(200), bestFor: text(200) }).strict()).max(3),
  tone: text(300), senderIdentity: z.object({ businessName: text(200), website: text(500), mailingAddress: text(500) }).strict(),
}).strict();
export type LeadPlan = z.infer<typeof LeadPlan>;
export const LeadPlanDraft = LeadPlan.extend({ signals: z.array(z.object({ key: text(100), weight: z.number().int().min(-3).max(3) }).strict()).max(16) });
export const Preferences = LeadPlan.partial().extend({ monthlyPaidBudgetUsd: z.union([z.literal(0), z.literal(5), z.literal(15), z.literal(30)])
  .optional(), runSchedule: z.enum(['daily', 'weekly']).optional() }).strict();
export type Preferences = z.infer<typeof Preferences>;
export const GeneratedBy = z.enum(['byo_openai', 'byo_anthropic', 'platform', 'rules']);
export const PlanRecord = z.object({ id: z.string().uuid(), version: z.number().int().positive(), profileVersion: z.number().int().positive(),
  plan: LeadPlan, status: z.enum(['draft', 'active', 'archived']), generatedBy: GeneratedBy,
  createdAt: z.string().datetime(), approvedByUserId: z.string().nullable(), approvedAt: z.string().datetime().nullable() }).strict();
export type PlanRecord = z.infer<typeof PlanRecord>;
export function mergePreferences(plan: LeadPlan, input: Preferences): LeadPlan {
  const { monthlyPaidBudgetUsd, runSchedule, ...overrides } = Preferences.parse(input);
  return LeadPlan.parse({ ...LeadPlan.parse(plan), ...overrides });
}

const str = (maxLength: number) => ({ type: 'string', maxLength });
const arr = (items: unknown, maxItems: number, minItems = 0) => ({ type: 'array', items, maxItems, minItems });
const obj = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const num = (minimum: number, maximum: number) => ({ type: 'integer', minimum, maximum });
export const leadPlanJsonSchema = obj({
  targets: arr(obj({ label: str(100), searchQueries: arr(str(60), 4, 1), cities: arr(str(100), 10), radiusMiles: num(1, 100) }), 5, 1),
  exclusions: obj({ keywords: arr(str(100), 30), excludeFranchises: { type: 'boolean' }, excludeDomains: arr(str(253), 30) }),
  signals: arr(obj({ key: { type: 'string', enum: signalKeys }, weight: num(-3, 3) }), 16),
  hotThreshold: num(0, 100), weeklyLeadTarget: num(5, 500), maxPaidLookupsPerWeek: num(0, 200),
  angles: arr(obj({ name: str(100), oneLiner: str(200), bestFor: str(200) }), 3), tone: str(300),
  senderIdentity: obj({ businessName: str(200), website: str(500), mailingAddress: str(500) }),
});
