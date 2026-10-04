import { seedStructure, seedDemo } from '@/lib/seed';
import type { FounderDb } from '@/lib/db';
export { SEED_VERSION } from '@/lib/seed';

/** Explicit opt-in is scoped to the synchronous fixture setup, never production. */
export function seedDemoFixture(db: FounderDb): void {
  const previous = process.env.DEMO_GATE;
  process.env.DEMO_GATE = '1';
  try { seedStructure(db); seedDemo(db); }
  finally { if (previous === undefined) delete process.env.DEMO_GATE; else process.env.DEMO_GATE = previous; }
}
