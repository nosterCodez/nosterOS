import { listWorkspaces } from '@/lib/workspace-jobs';
import { withWorkspaceDb } from '@/lib/workspace-storage';
import { runLeadBatch } from './runner';
import { overpassSource } from './sources/overpass';
import { foursquareSource } from './sources/foursquare';
let running = false, offset = 0;
export async function runLeadTick() {
  if (process.env.OMEGA_LEAD_ENGINE !== '1' || !process.env.OMEGA_LEAD_ENGINE_WORKSPACES?.trim()) return { ran: 0, skipped: 'private_beta' };
  if (running) return { ran: 0, skipped: 'already_running' };
  running = true;
  try {
    const result = await runLeadBatch({ workspaces: await listWorkspaces(), withDb: withWorkspaceDb,
      sources: [overpassSource(), foursquareSource()], offset });
    offset = result.nextOffset;
    return result;
  } catch { return { ran: 0, skipped: 'workspace_unavailable' }; }
  finally { running = false; }
}
