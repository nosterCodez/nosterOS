import { z } from 'zod';
export const LeadFacts = z.object({
  website: z.string().url().nullable().optional(), https: z.boolean().optional(), mobile: z.boolean().optional(),
  newestYear: z.number().int().min(1900).max(2200).nullable().optional(), observedYear: z.number().int().min(2020).max(2200).optional(),
  bookingTool: z.boolean().optional(), reviewCount: z.number().int().nonnegative().optional(), rating: z.number().min(0).max(5).optional(),
  socials: z.array(z.string().url()).max(30).optional(), socialsInactive: z.boolean().optional(),
  contactEmail: z.boolean().optional(), contactForm: z.boolean().optional(), franchise: z.boolean().optional(),
  distanceMiles: z.number().finite().nonnegative().optional(), radiusMiles: z.number().min(1).max(100).optional(),
}).strict();
export type LeadFacts = z.infer<typeof LeadFacts>;
type Signal = { key: string; description: string; input: string; detect: (facts: LeadFacts) => boolean };
export const SIGNALS: readonly Signal[] = [
  { key: 'no_website', description: 'Source explicitly lists no website.', input: 'website=null', detect: f => f.website === null },
  { key: 'website_not_https', description: 'Observed website does not use HTTPS.', input: 'https=false', detect: f => f.https === false },
  { key: 'website_not_mobile', description: 'Observed site lacks mobile support.', input: 'mobile=false', detect: f => f.mobile === false },
  { key: 'website_stale', description: 'Site scan found no year at least as recent as last year.', input: 'newestYear + observedYear', detect: f => f.observedYear !== undefined && f.newestYear !== undefined && (f.newestYear === null || f.newestYear < f.observedYear - 1) },
  { key: 'no_booking_tool', description: 'Site scan found no booking tool.', input: 'bookingTool=false', detect: f => f.bookingTool === false },
  { key: 'has_booking_tool', description: 'Site scan found a booking tool.', input: 'bookingTool=true', detect: f => f.bookingTool === true },
  { key: 'low_review_count', description: 'Fewer than 25 reported reviews.', input: 'reviewCount', detect: f => f.reviewCount !== undefined && f.reviewCount < 25 },
  { key: 'high_review_count', description: 'At least 100 reported reviews.', input: 'reviewCount', detect: f => f.reviewCount !== undefined && f.reviewCount >= 100 },
  { key: 'rating_below_4', description: 'Reported rating below four.', input: 'rating', detect: f => f.rating !== undefined && f.rating < 4 },
  { key: 'rating_4_plus', description: 'Reported rating at least four.', input: 'rating', detect: f => f.rating !== undefined && f.rating >= 4 },
  { key: 'socials_missing', description: 'Completed scan found no social links.', input: 'socials=[]', detect: f => f.socials?.length === 0 },
  { key: 'socials_inactive', description: 'Source explicitly observed inactive social presence.', input: 'socialsInactive=true', detect: f => f.socialsInactive === true },
  { key: 'has_contact_email', description: 'A contact email was found.', input: 'contactEmail=true', detect: f => f.contactEmail === true },
  { key: 'has_contact_form_only', description: 'Contact form found, no email found.', input: 'contactForm=true + contactEmail=false', detect: f => f.contactForm === true && f.contactEmail === false },
  { key: 'is_franchise', description: 'Source explicitly identified a franchise.', input: 'franchise=true', detect: f => f.franchise === true },
  { key: 'within_radius_core', description: 'Within half the configured search radius.', input: 'distanceMiles + radiusMiles', detect: f => f.distanceMiles !== undefined && f.radiusMiles !== undefined && f.distanceMiles <= f.radiusMiles / 2 },
];
export function detectSignals(input: LeadFacts) {
  const facts = LeadFacts.parse(input);
  return SIGNALS.filter(signal => signal.detect(facts)).map(signal => signal.key);
}
