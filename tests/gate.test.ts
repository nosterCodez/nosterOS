import { describe, expect, test } from 'vitest';
import { isGated } from '@/lib/gate';

/**
 * Demo behavior requires explicit intent; deployment is not a demo signal.
 */
describe('isGated', () => {
  test('local dev (no platform env) is NOT gated', () => {
    expect(isGated({})).toBe(false);
  });

  test('Vercel alone is not gated', () => {
    expect(isGated({ VERCEL: '1' })).toBe(false);
  });

  test('Railway alone is not gated', () => {
    expect(isGated({ RAILWAY_ENVIRONMENT: 'production' })).toBe(false);
  });

  test('both platforms without DEMO_GATE are not gated', () => {
    expect(isGated({ VERCEL: '1', RAILWAY_ENVIRONMENT: 'production' })).toBe(false);
  });

  test('DEMO_GATE=1 forces the gate on even with no platform env', () => {
    expect(isGated({ DEMO_GATE: '1' })).toBe(true);
  });

  test('DEMO_GATE=0 forces the gate OFF even on a deployment platform', () => {
    expect(isGated({ DEMO_GATE: '0', VERCEL: '1', RAILWAY_ENVIRONMENT: 'production' })).toBe(false);
  });
});
