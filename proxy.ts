import { NextRequest, NextResponse } from 'next/server';
import { challengePage, gateDecision, GATE_COOKIE } from '@/lib/access-gate';
import { internalAllowed, publicAuthPath } from '@/lib/auth-boundary';
import { getSessionCookie } from 'better-auth/cookies';

/**
 * Whole-app access gate. Active only when FOUNDER_OS_ACCESS_TOKEN is set
 * (production deployments on public URLs); unset keeps dev and the demo
 * completely open. See lib/access-gate.ts for the decision logic + tests.
 */
export function proxy(req: NextRequest) {
  const decision = gateDecision({
    token: process.env.FOUNDER_OS_ACCESS_TOKEN,
    cookie: req.cookies.get(GATE_COOKIE)?.value ?? null,
    queryToken: req.nextUrl.searchParams.get('token'),
  });

  switch (decision.kind) {
    case 'open':
    case 'pass':
      break;
    case 'set-cookie': {
      // strip ?token= from the URL so it never lingers in the address bar
      const clean = req.nextUrl.clone();
      clean.searchParams.delete('token');
      const res = NextResponse.redirect(clean);
      res.cookies.set(GATE_COOKIE, decision.value, {
        httpOnly: true,
        sameSite: 'lax',
        secure: req.nextUrl.protocol === 'https:',
        maxAge: 60 * 60 * 24 * 30, // re-enter monthly
        path: '/',
      });
      return res;
    }
    case 'challenge':
      if (req.nextUrl.pathname.startsWith('/api/')) return NextResponse.json({ error: 'Beta access required' }, { status: 401 });
      return new NextResponse(challengePage(), {
        status: 401,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
  }
  const pathname = req.nextUrl.pathname;
  const internal = req.method === 'POST' && internalAllowed(pathname, req.headers.get('x-nosteros-internal'));
  if (!publicAuthPath(pathname) && !internal && !getSessionCookie(req)) {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
    const destination = new URL('/sign-in', req.url);
    destination.searchParams.set('next', pathname + req.nextUrl.search);
    return NextResponse.redirect(destination);
  }
  // Never trust a caller-provided path when deciding whether the layout is public.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nosteros-path', pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // gate pages and APIs; skip Next internals + static files so the
  // challenge page itself can render
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.png|.*\\.png$|.*\\.svg$).*)'],
};
