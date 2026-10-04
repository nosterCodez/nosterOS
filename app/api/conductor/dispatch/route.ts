import { apiOperatorWorkspace } from '@/lib/session';
import { apiSessionError } from '@/lib/session';
import { NextResponse } from 'next/server';
import { dispatchCodingTask } from '@/lib/connectors/superset';
import { createPaperclipIssue } from '@/lib/connectors/paperclip';

export const dynamic = 'force-dynamic';

/**
 * `/ui <request>` from the Conductor panel lands here: spin up a real Superset
 * coding agent in an isolated workspace/branch to make the change. A board
 * issue is filed best-effort so the CEO can track it — board failure never
 * fails the dispatch.
 */
export async function POST(req: Request) {
  const authError = await apiSessionError('/api/conductor/dispatch', 'POST', req);
  if (authError) return authError;
  const operatorAccess = await apiOperatorWorkspace();
  if (operatorAccess instanceof Response) return operatorAccess;

  let body: { request?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const request = body.request?.trim();
  if (!request) return NextResponse.json({ error: 'request required' }, { status: 400 });

  try {
    const result = await dispatchCodingTask({ request });
    try {
      await createPaperclipIssue({
        title: `UI change: ${request.slice(0, 80)}`,
        description: `Dispatched to a Superset coding agent.\n\nRequest: ${request}\nBranch: ${result.branch}\nWorkspace: ${result.workspaceId}`,
      });
    } catch {
      // tracking only — the dispatch already happened
    }
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
