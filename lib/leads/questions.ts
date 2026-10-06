import { z } from 'zod';
import type { BusinessProfile, SectionKey } from '@/lib/business-profile/schema';
import { LeadPlan, Preferences } from './schema';
export const PlanQuestion = z.object({ key: z.enum(['targetKinds', 'cities', 'excludeFranchises', 'weeklyLeadTarget', 'monthlyPaidBudgetUsd', 'tone']),
  label: z.string(), type: z.enum(['yes_no', 'single_choice', 'multi_choice', 'number', 'short_text']),
  defaultValue: z.union([z.string(), z.number(), z.boolean()]), choices: z.array(z.string()).optional(), min: z.number().optional(), max: z.number().optional() });
export type PlanQuestion = z.infer<typeof PlanQuestion>;
const catalog: { section: SectionKey; preference: keyof Preferences; question: PlanQuestion }[] = [
  { section: 'ideal_customer', preference: 'targets', question: { key: 'targetKinds', label: 'Which businesses should we search for?', type: 'short_text', defaultValue: 'Local service businesses' } },
  { section: 'service_area', preference: 'targets', question: { key: 'cities', label: 'Which cities should we search first?', type: 'short_text', defaultValue: '' } },
  { section: 'customers_to_avoid', preference: 'exclusions', question: { key: 'excludeFranchises', label: 'Exclude franchises?', type: 'yes_no', defaultValue: true } },
  { section: 'goals_for_the_next_90_days', preference: 'weeklyLeadTarget', question: { key: 'weeklyLeadTarget', label: 'How many leads per week?', type: 'number', defaultValue: 25, min: 5, max: 500 } },
  { section: 'monthly_budget_for_tools_and_ads', preference: 'monthlyPaidBudgetUsd', question: { key: 'monthlyPaidBudgetUsd', label: 'Preferred monthly paid-lookup budget? (Does not enable spending.)', type: 'single_choice', defaultValue: '0', choices: ['0', '5', '15', '30'] } },
  { section: 'tone_and_voice', preference: 'tone', question: { key: 'tone', label: 'What tone should we use?', type: 'short_text', defaultValue: 'Direct, respectful and helpful' } },
];
export function planQuestions(profile: BusinessProfile, preferences: Preferences): PlanQuestion[] {
  const prefs = Preferences.parse(preferences);
  return catalog.filter(c => profile.completeness[c.section] !== 'found' && prefs[c.preference] === undefined).map(c => ({ ...c.question })).slice(0, 6);
}
const textList = (value: string, max: number, width: number) => value.split(/[,;\n]/).map(s => s.trim()).filter(Boolean).slice(0, max).map(s => s.slice(0, width));
export function answerPreferences(input: Record<string, unknown>, current: LeadPlan, questions: PlanQuestion[]): Preferences {
  const plan = LeadPlan.parse(current), result: Preferences = {};
  if (Object.keys(input).some(key => !questions.some(q => q.key === key))) throw new Error('Unknown question');
  for (const q of questions) {
    const raw = input[q.key] ?? q.defaultValue;
    if (q.key === 'weeklyLeadTarget') result.weeklyLeadTarget = z.number().int().min(5).max(500).parse(raw);
    else if (q.key === 'monthlyPaidBudgetUsd') result.monthlyPaidBudgetUsd = Number(z.enum(['0', '5', '15', '30']).parse(raw)) as 0 | 5 | 15 | 30;
    else if (q.key === 'excludeFranchises') result.exclusions = { ...plan.exclusions, excludeFranchises: z.boolean().parse(raw) };
    else {
      const value = z.string().trim().max(200).parse(raw);
      if (q.key === 'tone') result.tone = value;
      if (q.key === 'targetKinds') {
        const labels = textList(value, 5, 60);
        result.targets = (labels.length ? labels : ['Local service businesses']).map(label => ({ ...plan.targets[0], label, searchQueries: [label] }));
      }
      if (q.key === 'cities') result.targets = (result.targets ?? plan.targets).map(t => ({ ...t, cities: textList(value, 10, 100) }));
    }
  }
  return Preferences.parse(result);
}
