import { apiOperatorWorkspace } from '@/lib/session';
import { apiWorkspace, withWorkspaceLease } from '@/lib/session';
import { apiSessionError } from '@/lib/session';
import { NextResponse } from 'next/server';
import { refreshExpiredOAuth } from '@/lib/oauth/store';
import { allConnectorStatuses } from '@/lib/connectors';

export const dynamic = 'force-dynamic';

export async function GET() {
  const authError = await apiSessionError('/api/connections', 'GET');
  if (authError) return authError;
  const operatorAccess = await apiOperatorWorkspace();
  if (operatorAccess instanceof Response) return operatorAccess;
  const workspace = await apiWorkspace();
  if (workspace instanceof Response) return workspace;


  // Refresh any OAuth token that has aged out before the connectors read it,
  // so a board load never reports "connected" as an error just because an
  // hour-long access token lapsed. Fails soft: a refresh that cannot happen
  // returns nothing and the status check proceeds as normal.
  await refreshExpiredOAuth().catch(() => []);

  const connections = await withWorkspaceLease(workspace, db => allConnectorStatuses(db));
  return NextResponse.json({ connections });
}
