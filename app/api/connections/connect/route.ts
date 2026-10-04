import { apiOperatorWorkspace, apiSessionError } from '@/lib/session';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const authError = await apiSessionError('/api/connections/connect', 'POST', request);
  if (authError) return authError;
  const operatorAccess = await apiOperatorWorkspace(request.headers);
  if (operatorAccess instanceof Response) return operatorAccess;
  return Response.json({ error: 'Shared connection setup retired. Use workspace Connections.' }, { status: 409 });
}
export async function DELETE(request: Request) {
  const authError = await apiSessionError('/api/connections/connect', 'DELETE', request);
  if (authError) return authError;
  const operatorAccess = await apiOperatorWorkspace(request.headers);
  if (operatorAccess instanceof Response) return operatorAccess;
  return Response.json({ error: 'Shared connection setup retired. Use workspace Connections.' }, { status: 409 });
}
