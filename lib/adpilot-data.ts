import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { CampaignSchema, type Campaign } from '@/lib/adpilot';
import { workspaceDir } from '@/lib/paths';

/** Server-only reader for the AdPilot campaign file: kept out of
 *  lib/adpilot.ts so client components can import the pure metric math
 *  without dragging node:fs into the bundle. */

const FileSchema = z.object({ campaigns: z.array(CampaignSchema), syncedAt: z.string().optional() });

export function adpilotDataPath(workspaceId: string): string {
  return path.join(workspaceDir(workspaceId), 'adpilot-campaigns.json');
}

export type AdpilotFile = { campaigns: Campaign[]; syncedAt: string | null };

export function readAdpilotFile(workspaceId: string): AdpilotFile {
  const file = adpilotDataPath(workspaceId);
  try {
    const raw = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ file, 'utf8'));
    const parsed = FileSchema.parse(raw);
    return { campaigns: parsed.campaigns, syncedAt: parsed.syncedAt ?? null };
  } catch {
    return { campaigns: [], syncedAt: null };
  }
}

export function readCampaigns(workspaceId: string): Campaign[] {
  return readAdpilotFile(workspaceId).campaigns;
}
