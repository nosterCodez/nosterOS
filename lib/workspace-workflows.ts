import { isDeepStrictEqual } from 'node:util';
import type { Workflow } from '@/lib/schemas';
import { workflowTemplates } from '@/lib/workflow-templates';

/** Preserve stored samples, but never present unchanged demo values as client results. */
export function visibleWorkflows(rows: Workflow[]): Workflow[] {
  if (process.env.DEMO_GATE === '1') return rows;
  return rows.filter(row => !workflowTemplates.some(sample => isDeepStrictEqual(sample, row)));
}
