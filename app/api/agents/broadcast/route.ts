import { apiSessionError } from '@/lib/session';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { createRuntime } from '@/lib/agents/runtime';
import { realAgents } from '@/lib/agents/real';

export const dynamic = 'force-dynamic';

export async function GET() {
  const authError = await apiSessionError('/api/agents/broadcast', 'GET');
  if (authError) return authError;

  return NextResponse.json({ broadcasts: getDb().broadcasts.recent(10) });
}

export async function POST(req: Request) {
  const authError = await apiSessionError('/api/agents/broadcast', 'POST', req);
  if (authError) return authError;

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
  const runtime = createRuntime(getDb(), realAgents);
  const broadcast = await runtime.broadcast(message);
  return NextResponse.json({ broadcast });
}
