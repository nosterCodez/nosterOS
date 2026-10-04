import { apiOperatorWorkspace, apiSessionError } from '@/lib/session';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, _props: { params: Promise<{ provider: string }> }) {
  const authError = await apiSessionError('/api/oauth/[provider]/start', 'GET', request);
  if (authError) return authError;
  const operatorAccess = await apiOperatorWorkspace(request.headers);
  if (operatorAccess instanceof Response) return operatorAccess;
  return Response.json({ error: 'Provider authorization is unavailable until workspace OAuth is enabled.' }, { status: 409 });
}
