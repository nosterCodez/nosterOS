import { apiOperatorWorkspace } from '@/lib/session';
import { apiWorkspace } from '@/lib/session';
import { apiSessionError } from '@/lib/session';
import { NextResponse } from 'next/server';
import { tradingPayload } from '@/lib/trading-payload';

export const dynamic = 'force-dynamic';

/** The trading dashboard payload — every account's latest agent-fed snapshot,
 *  their positions and value series, recent activity, the agent's reasoning,
 *  live orders, the wallet and the honest connector status. Built by the same
 *  function the server page uses (lib/trading-payload.ts). */
export async function GET() {
  const authError = await apiSessionError('/api/trading', 'GET');
  if (authError) return authError;
  const operatorAccess = await apiOperatorWorkspace();
  if (operatorAccess instanceof Response) return operatorAccess;
  const workspace = await apiWorkspace();
  if (workspace instanceof Response) return workspace;


  return NextResponse.json(await tradingPayload(workspace.db));
}
