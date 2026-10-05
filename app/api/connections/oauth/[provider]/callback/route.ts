import { apiSessionError } from '@/lib/session';
import { cloudCallback } from '@/lib/cloud-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const denied = await apiSessionError('/api/connections/oauth/callback', 'GET', request); if (denied) return denied;
  return cloudCallback(request, (await context.params).provider);
}
