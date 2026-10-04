import { afterEach, expect, test, vi } from 'vitest';
import { openDb } from '@/lib/db';
import { seedStructure } from '@/lib/seed';
import { workflowTemplates } from '@/lib/workflow-templates';
import { visibleWorkflows } from '@/lib/workspace-workflows';
afterEach(() => vi.unstubAllEnvs());
test('structure has no sample workflows; stored samples survive but do not render as business results', () => {
  vi.stubEnv('DEMO_GATE', '');
  const db = openDb(':memory:');
  try {
    seedStructure(db);
    expect(db.workflows.all()).toEqual([]);
    db.workflows.insert(workflowTemplates[0]);
    seedStructure(db);
    expect(db.workflows.all()).toHaveLength(1);
    expect(visibleWorkflows(db.workflows.all())).toEqual([]);
    const custom = { ...workflowTemplates[0], id: 'my-workflow', name: 'My process', revenueUsd: 0 };
    db.workflows.insert(custom);
    expect(visibleWorkflows(db.workflows.all())).toEqual([custom]);
    vi.stubEnv('DEMO_GATE', '1');
    expect(visibleWorkflows(db.workflows.all())).toHaveLength(2);
  } finally { db.close(); }
});
