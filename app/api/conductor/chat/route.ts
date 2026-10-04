import { apiOperatorWorkspace } from '@/lib/session';
import { apiSessionError } from '@/lib/session';
import { NextResponse } from 'next/server';
import { paperclipCockpitThread, postCockpitMessage } from '@/lib/connectors/paperclip';

export const dynamic = 'force-dynamic';

/**
 * The REAL Conductor chat — the panel talks to the board's CEO (Claude Fable 5
 * with its persistent session) through the standing "Founder OS Cockpit" issue.
 * Async by nature: POST wakes the Conductor; GET polls the thread for replies.
 */
export async function GET() {
  const authError = await apiSessionError('/api/conductor/chat', 'GET');
  if (authError) return authError;
  const operatorAccess = await apiOperatorWorkspace();
  if (operatorAccess instanceof Response) return operatorAccess;

  return NextResponse.json({ messages: await paperclipCockpitThread(50) });
}

export async function POST(req: Request) {
  const authError = await apiSessionError('/api/conductor/chat', 'POST', req);
  if (authError) return authError;
  const operatorAccess = await apiOperatorWorkspace();
  if (operatorAccess instanceof Response) return operatorAccess;

  let body: { message?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const message = body.message?.trim();
  if (!message) return NextResponse.json({ error: 'message required' }, { status: 400 });
  try {
    const comment = await postCockpitMessage(message);
    return NextResponse.json({ comment }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
