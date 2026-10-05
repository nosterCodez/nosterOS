import { getAuth } from '@/lib/auth';
import { enterInvitation } from '@/lib/email-entry';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try { return await enterInvitation(request, await getAuth()); }
  catch { return new Response('Invitation access is temporarily unavailable. Please try again.', { status: 503, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } }); }
}
