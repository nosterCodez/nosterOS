import { apiSessionError } from '@/lib/session';
import { NextResponse } from 'next/server';
import { invokePaperclipHeartbeat } from '@/lib/connectors/paperclip';

export const dynamic = 'force-dynamic';

/** The OS Run button, for real: trigger a board heartbeat for this agent. */
export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const authError = await apiSessionError('/api/board/agents/[id]/run', 'POST', _req);
  if (authError) return authError;

  const params = await props.params;
  try {
    const ok = await invokePaperclipHeartbeat(params.id);
    if (!ok) return NextResponse.json({ error: 'board rejected the heartbeat' }, { status: 502 });
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
