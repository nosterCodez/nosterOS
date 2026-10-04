import { connectionRequest } from '@/lib/connection-api';
import { apiSessionError } from '@/lib/session';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  const authError = await apiSessionError('/api/admin/connections', 'GET', request);
  if (authError) return authError;
  return connectionRequest(request);
}
export async function POST(request: Request) {
  const authError = await apiSessionError('/api/admin/connections', 'POST', request);
  if (authError) return authError;
  return connectionRequest(request);
}
export async function DELETE(request: Request) {
  const authError = await apiSessionError('/api/admin/connections', 'DELETE', request);
  if (authError) return authError;
  return connectionRequest(request);
}
