import { z } from 'zod';
export const PROFILE_SECTIONS = [
  { key: 'business_overview', label: 'Business overview', hint: 'Describe the business and its work.' },
  { key: 'services_and_prices', label: 'Services and prices', hint: 'List offers and their prices or quote policy.' },
  { key: 'ideal_customer', label: 'Ideal customer', hint: 'Identify industries, sizes and buying signals.' },
  { key: 'customers_to_avoid', label: 'Customers to avoid', hint: 'Name exclusions and unsuitable customers.' },
  { key: 'service_area', label: 'Service area', hint: 'List the cities and regions served.' },
  { key: 'proof_and_results', label: 'Proof and results', hint: 'Include only supported examples or results.' },
  { key: 'goals_for_the_next_90_days', label: 'Goals for the next 90 days', hint: 'Describe near-term business goals.' },
  { key: 'monthly_budget_for_tools_and_ads', label: 'Monthly budget for tools and ads', hint: 'State a monthly limit, including $0.' },
  { key: 'tone_and_voice', label: 'Tone and voice', hint: 'Describe how the business communicates.' },
  { key: 'what_makes_us_different', label: 'What makes us different', hint: 'Describe the business distinction without guarantees.' },
  { key: 'business_contact_details', label: 'Business contact details', hint: 'Include business name, website and public mailing address.' },
] as const;
export type SectionKey = typeof PROFILE_SECTIONS[number]['key'];
const shape = Object.fromEntries(PROFILE_SECTIONS.map(s => [s.key, z.string().max(4000).optional()])) as Record<SectionKey, z.ZodOptional<z.ZodString>>;
export const BusinessProfileSections = z.object({ ...shape, extra: z.array(z.object({ heading: z.string().max(2000), text: z.string().max(2000) }).strict()).max(5) }).strict();
export const Completeness = z.object(Object.fromEntries(PROFILE_SECTIONS.map(s => [s.key, z.enum(['found', 'unknown', 'missing'])])) as Record<SectionKey, z.ZodEnum<['found', 'unknown', 'missing']>>).strict();
export const BusinessProfile = z.object({
  id: z.string().uuid(), version: z.number().int().positive(), promptVersion: z.number().int().positive(),
  rawMarkdown: z.string().max(40000), sections: BusinessProfileSections, completeness: Completeness,
  createdByUserId: z.string().min(1).max(200), createdAt: z.string().datetime(), isCurrent: z.boolean(),
}).strict();
export type BusinessProfile = z.infer<typeof BusinessProfile>;
export const ProfileVersion = BusinessProfile.omit({ rawMarkdown: true, sections: true, completeness: true });
export type ProfileVersion = z.infer<typeof ProfileVersion>;

