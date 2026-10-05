import { NextResponse } from 'next/server';
import type { getAuth } from '@/lib/auth';
import { accessToken } from '@/lib/legacy-env';
import { GATE_COOKIE } from '@/lib/auth-constants';
import { verifyInvitationEntry } from '@/lib/invitation-entry';
type Auth = Awaited<ReturnType<typeof getAuth>>;
function privateResponse(response: Response) {
  const result = new NextResponse(response.body, { status: response.status, headers: response.headers });
  result.headers.set('Cache-Control', 'no-store'); result.headers.set('Referrer-Policy', 'no-referrer');
  result.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return result;
}
function admit(response: Response, baseURL: string) {
  const result = privateResponse(response), token = accessToken()?.trim();
  if (token) result.cookies.set(GATE_COOKIE, token, { httpOnly: true, secure: new URL(baseURL).protocol === 'https:', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 });
  return result;
}
export async function completeEmailSignIn(request: Request, auth: Auth, response: Response) {
  if (request.method !== 'GET' || new URL(request.url).pathname !== '/api/auth/magic-link/verify') return response;
  // Only trust a freshly issued, server-verified session, never the request cookie.
  const sessionCookie = response.headers.getSetCookie().map(c => c.split(';')[0]).find(c => /^(?:__Secure-)?better-auth\.session_token=.+/.test(c));
  if (!sessionCookie || response.status >= 400) return privateResponse(response);
  const session = await auth.api.getSession({ headers: new Headers({ cookie: sessionCookie }) });
  return session?.user.emailVerified ? admit(response, auth.options.baseURL as string) : privateResponse(response);
}
export async function enterInvitation(request: Request, auth: Auth) {
  const token = new URL(request.url).searchParams.get('invite') ?? '';
  const payload = verifyInvitationEntry(token, auth.options.secret!);
  const failed = () => privateResponse(new Response('This invitation is unavailable. Ask your workspace administrator to resend it.', { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
  if (!payload) return failed();
  const context = await auth.$context;
  const invitation = await context.adapter.findOne<{ id: string; status: string; expiresAt: Date; organizationId: string }>({ model: 'invitation', where: [{ field: 'id', value: payload.id }] });
  if (!invitation || invitation.status !== 'pending' || !(invitation.expiresAt instanceof Date) || invitation.expiresAt.getTime() !== payload.exp || invitation.expiresAt.getTime() <= Date.now()) return failed();
  const workspace = await context.adapter.findOne({ model: 'organization', where: [{ field: 'id', value: invitation.organizationId }] });
  if (!workspace) return failed();
  const destination = new URL('/accept-invitation', auth.options.baseURL as string); destination.searchParams.set('id', invitation.id);
  return admit(new Response(null, { status: 303, headers: { Location: destination.toString() } }), auth.options.baseURL as string);
}
