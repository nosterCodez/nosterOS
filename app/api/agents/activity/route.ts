import { apiSessionError } from '@/lib/session';
import { NextResponse } from 'next/server';
import { apiWorkspace } from '@/lib/session';
import { recentActivity } from '@/lib/agents/activity';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // better-sqlite3 is native — keep off the edge runtime

export async function GET(req: Request) {
  const authError = await apiSessionError('/api/agents/activity', 'GET', req);
  if (authError) return authError;
  const workspace = await apiWorkspace(req.headers);
  if (workspace instanceof Response) return workspace;


  const raw = Number(new URL(req.url).searchParams.get('limit'));
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 200) : 50;
  return NextResponse.json({ events: recentActivity(workspace.db, limit) });
}
