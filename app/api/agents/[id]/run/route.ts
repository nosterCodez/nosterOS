import { apiOperatorWorkspace } from '@/lib/session';
import { apiSessionError } from '@/lib/session';
import { NextResponse } from 'next/server';
import { apiWorkspace } from '@/lib/session';
import { createRuntime } from '@/lib/agents/runtime';
import { realAgents } from '@/lib/agents/real';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const authError = await apiSessionError('/api/agents/[id]/run', 'POST', _req);
  if (authError) return authError;
  const operatorAccess = await apiOperatorWorkspace();
  if (operatorAccess instanceof Response) return operatorAccess;
  const workspace = await apiWorkspace(_req.headers);
  if (workspace instanceof Response) return workspace;


  const params = await props.params;
  const runtime = createRuntime(workspace.db, realAgents);
  try {
    const run = await runtime.run(params.id);
    return NextResponse.json({ run });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 404 },
    );
  }
}
