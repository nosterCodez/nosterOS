import { expect, test } from 'vitest';
import { SIGNALS, detectSignals } from '@/lib/leads/signals';
test('catalog has exactly 16 documented detectors; absent evidence never implies a weakness', () => {
  expect(SIGNALS).toHaveLength(16); expect(new Set(SIGNALS.map(s => s.key)).size).toBe(16);
  expect(detectSignals({})).toEqual([]);
  expect(SIGNALS.every(s => s.description && s.input)).toBe(true);
});
test('fixed thresholds and explicit observations produce deterministic signals', () => {
  const facts = { website: null, reviewCount: 24, rating: 3.9, bookingTool: false, socials: [],
    contactEmail: true, contactForm: true, franchise: false, distanceMiles: 10, radiusMiles: 20 };
  expect(detectSignals(facts)).toEqual(['no_website','no_booking_tool','low_review_count','rating_below_4','socials_missing','has_contact_email','within_radius_core']);
  expect(detectSignals({ reviewCount: 100, rating: 4, bookingTool: true, website: 'https://example.com', https: true, mobile: true }))
    .toEqual(['has_booking_tool', 'high_review_count', 'rating_4_plus']);
  expect(detectSignals({ newestYear: 2024, observedYear: 2026, socialsInactive: true, contactEmail: false, contactForm: true, franchise: true }))
    .toEqual(['website_stale','socials_inactive','has_contact_form_only','is_franchise']);
});
