import Database from 'better-sqlite3';
import { headers } from 'next/headers';
import { z } from 'zod';
import { controlDbPath } from '@/lib/paths';
import { withWorkspaceDb } from '@/lib/workspace-storage';
import { apiOperatorWorkspace } from '@/lib/session';
import { operatorWorkspaceId } from '@/lib/operator-workspace';
import { internalAllowed } from '@/lib/auth-boundary';
import { getAuth } from '@/lib/auth';
import type { FounderDb } from '@/lib/db';

const workspaceSchema = z.object({ id: z.string().regex(/^[A-Za-z0-9]{32}$/), name: z.string(), kind: z.enum(['founder', 'agency', 'client']) });
export type WorkspaceData = { workspace: z.infer<typeof workspaceSchema>; db: FounderDb };
export async function listWorkspaces(): Promise<WorkspaceData['workspace'][]> {
  await getAuth();
  const control = new Database(controlDbPath(), { readonly: true, fileMustExist: true });
  try {
    return (control.prepare('SELECT id,name,metadata FROM organization ORDER BY id').all() as { id: string; name: string; metadata: string }[])
      .flatMap(row => {
        try { return [workspaceSchema.parse({ id: row.id, name: row.name, kind: JSON.parse(row.metadata).kind })]; }
        catch { console.warn(`[workspace:${/^[A-Za-z0-9]{32}$/.test(row.id) ? row.id : 'invalid'}] invalid metadata; job skipped`); return []; }
      });
  } finally { control.close(); }
}
export async function forEachWorkspace<T>(workspaces: WorkspaceData['workspace'][], work: (context: WorkspaceData) => Promise<T>, log: (line: string) => void = console.log) {
  const results: { workspaceId: string; ok: boolean; result?: T; error?: string }[] = [];
  for (const workspace of workspaces) {
    try {
      workspaceSchema.parse(workspace);
      const result = await withWorkspaceDb(workspace.id, db => work({ workspace, db }));
      results.push({ workspaceId: workspace.id, ok: true, result });
      log(`[workspace:${workspace.id}] job complete`);
    } catch {
      results.push({ workspaceId: workspace.id, ok: false, error: 'Workspace job failed' });
      log(`[workspace:${workspace.id}] job failed`);
    }
  }
  return results;
}
/** Env-backed jobs remain operator-only until M3 supplies workspace credentials. */
export async function workspaceJob<T>(route: string, work: (context: WorkspaceData) => Promise<T>) {
  const h = new Headers(await headers());
  if (internalAllowed(route, h.get('x-nosteros-internal'))) {
    const operatorId = operatorWorkspaceId();
    if (!operatorId) return Response.json({ error: 'Operator workspace unavailable' }, { status: 403 });
    const workspaces = (await listWorkspaces()).filter(workspace => workspace.id === operatorId);
    const results = await forEachWorkspace(workspaces, work);
    return Response.json({ ok: results.every(result => result.ok), workspaces: results });
  }
  const context = await apiOperatorWorkspace(h);
  if (context instanceof Response) return context;
  return withWorkspaceDb(context.workspace.id, async db => Response.json(await work({ workspace: context.workspace, db })));
}
