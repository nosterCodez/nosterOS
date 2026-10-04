import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/**
 * OmegaOS is a private operator console, not a demo funnel. The upstream
 * OmegaOS demo shipped a "join the cohort" pop-up and a footer ad on every
 * page; those were removed and must not come back with an upstream merge.
 */
describe('no upstream course upsell', () => {
  test('the cohort modules are gone', () => {
    for (const p of ['lib/cohort.ts', 'components/CohortBanner.tsx', 'components/CohortModal.tsx']) {
      expect(existsSync(join(root, p)), p).toBe(false);
    }
  });

  test('the shared layout mounts no cohort ad', () => {
    const layout = read('app/layout.tsx');
    expect(layout).not.toMatch(/Cohort(Banner|Modal)/);
    expect(layout).not.toContain('founderos.example.com');
  });
});
