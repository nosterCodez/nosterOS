import { apiOperatorWorkspace } from '@/lib/session';
import { apiSessionError } from '@/lib/session';
import { NextResponse } from 'next/server';
import { apiWorkspace, withWorkspaceLease } from '@/lib/session';
import { createRuntime } from '@/lib/agents/runtime';
import { realAgents } from '@/lib/agents/real';

export const dynamic = 'force-dynamic';

export async function GET() {
  const authError = await apiSessionError('/api/agents/broadcast', 'GET');
  if (authError) return authError;
  const operatorAccess = await apiOperatorWorkspace();
  if (operatorAccess instanceof Response) return operatorAccess;
  const workspace = await apiWorkspace();
  if (workspace instanceof Response) return workspace;


  return NextResponse.json({ broadcasts: workspace.db.broadcasts.recent(10) });
}

export async function POST(req: Request) {
  const authError = await apiSessionError('/api/agents/broadcast', 'POST', req);
  if (authError) return authError;
  const operatorAccess = await apiOperatorWorkspace(req.headers);
  if (operatorAccess instanceof Response) return operatorAccess;
  const workspace = await apiWorkspace(req.headers);
  if (workspace instanceof Response) return workspace;


  let message = '';
  try {
    const body = (await req.json()) as { message?: unknown };
    message = typeof body.message === 'string' ? body.message.trim() : '';
  } catch {
    // fall through to the empty-message rejection
  }
  if (!message) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }
  const broadcast = await withWorkspaceLease(workspace, db => createRuntime(db, realAgents).broadcast(message));
  return NextResponse.json({ broadcast });
}
