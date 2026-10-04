import { apiOperatorWorkspace } from '@/lib/session';
import { apiSessionError } from '@/lib/session';
import { NextResponse } from 'next/server';
import { apiWorkspace, withWorkspaceLease } from '@/lib/session';
import { realAgents } from '@/lib/agents/real';
import { chatWithAgent } from '@/lib/agents/chat';
import { routeConductorMessage } from '@/lib/agents/conductor';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // better-sqlite3 is native — keep off the edge runtime

/** Stored history for one agent's conversation — the /chats thread view. */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const authError = await apiSessionError('/api/agents/[id]/chat', 'GET', _req);
  if (authError) return authError;
  const operatorAccess = await apiOperatorWorkspace(_req.headers);
  if (operatorAccess instanceof Response) return operatorAccess;
  const workspace = await apiWorkspace(_req.headers);
  if (workspace instanceof Response) return workspace;


  const params = await props.params;
  if (params.id !== 'conductor' && !realAgents.some((a) => a.id === params.id)) {
    return NextResponse.json({ error: `unknown agent: ${params.id}` }, { status: 404 });
  }
  return NextResponse.json({ messages: workspace.db.agentMessages.byAgent(params.id) });
}

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const authError = await apiSessionError('/api/agents/[id]/chat', 'POST', req);
  if (authError) return authError;
  const operatorAccess = await apiOperatorWorkspace(req.headers);
  if (operatorAccess instanceof Response) return operatorAccess;
  const workspace = await apiWorkspace(req.headers);
  if (workspace instanceof Response) return workspace;


  const params = await props.params;
  let message = '';
  let screenContext: string | undefined;
  try {
    const body = (await req.json()) as { message?: unknown; context?: unknown };
    message = typeof body.message === 'string' ? body.message.trim() : '';
    screenContext = typeof body.context === 'string' && body.context.trim() ? body.context.slice(0, 4000) : undefined;
  } catch {
    // fall through to the empty-message rejection
  }
  if (!message) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }

  // Resolve the target up front so a genuinely-unknown agent is a 404, while a
  // downstream failure (gateway error, Zod throw, …) surfaces honestly as a 500
  // instead of masquerading as "unknown agent".
  const isConductor = params.id === 'conductor';
  if (!isConductor && !realAgents.some((a) => a.id === params.id)) {
    return NextResponse.json({ error: `unknown agent: ${params.id}` }, { status: 404 });
  }

  try {
    const result = await withWorkspaceLease(workspace, db => isConductor
      ? routeConductorMessage(db, realAgents, message, { screenContext })
      : chatWithAgent(db, realAgents, params.id, message, { screenContext }));
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
