import { getAuth } from '@/lib/auth';
import { toNextJsHandler } from 'better-auth/next-js';
import { completeEmailSignIn } from '@/lib/email-entry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Better Auth owns session validation on its public authentication endpoints.
async function handle(request: Request) {
  try {
    const auth = await getAuth(), handler = toNextJsHandler(auth);
    const response = await (request.method === 'GET' ? handler.GET(request) : handler.POST(request));
    return await completeEmailSignIn(request, auth, response);
  } catch {
    return Response.json({ error: 'Authentication is not configured or is temporarily unavailable' }, { status: 503 });
  }
}
export const GET = handle;
export const POST = handle;
