import { apiOperatorWorkspace, apiSessionError } from '@/lib/session';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const authError = await apiSessionError('/api/admin/keys', 'GET', request);
  if (authError) return authError;
  const operatorAccess = await apiOperatorWorkspace(request.headers);
  if (operatorAccess instanceof Response) return operatorAccess;
  return Response.json({ error: 'Shared key management retired. Use workspace Connections.' }, { status: 409 });
}
export async function POST(request: Request) {
  const authError = await apiSessionError('/api/admin/keys', 'POST', request);
  if (authError) return authError;
  const operatorAccess = await apiOperatorWorkspace(request.headers);
  if (operatorAccess instanceof Response) return operatorAccess;
  return Response.json({ error: 'Shared key management retired. Use workspace Connections.' }, { status: 409 });
}
