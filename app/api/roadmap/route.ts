import { apiSessionError } from '@/lib/session';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiWorkspace } from '@/lib/session';
import { groupRoadmapByQuarter } from '@/lib/roadmap';
import { RoadmapStatusSchema } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export async function GET() {
  const authError = await apiSessionError('/api/roadmap', 'GET');
  if (authError) return authError;
  const workspace = await apiWorkspace();
  if (workspace instanceof Response) return workspace;


  const db = workspace.db;
  return NextResponse.json({ quarters: groupRoadmapByQuarter(db.roadmap.all()) });
}

const PatchSchema = z.object({ id: z.string().min(1), status: RoadmapStatusSchema });

/**
 * Mark a roadmap row done from the board (or push it back). The response
 * carries the whole board back so the client can redraw the phase bars and the
 * quarter tallies off one round trip.
 */
export async function PATCH(req: Request) {
  const authError = await apiSessionError('/api/roadmap', 'PATCH', req);
  if (authError) return authError;
  const workspace = await apiWorkspace(req.headers);
  if (workspace instanceof Response) return workspace;


  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'id and a roadmap status are required' }, { status: 400 });
  }
  const db = workspace.db;
  const item = db.roadmap.setStatus(parsed.data.id, parsed.data.status);
  if (!item) return NextResponse.json({ error: 'no such roadmap item' }, { status: 404 });
  return NextResponse.json({ item, quarters: groupRoadmapByQuarter(db.roadmap.all()) });
}
