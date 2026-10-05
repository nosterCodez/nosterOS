import { NextRequest, NextResponse } from 'next/server';
import { challengePage, gateDecision, GATE_COOKIE } from '@/lib/access-gate';
import { emailEntryPath, internalAllowed, publicAuthPath } from '@/lib/auth-boundary';
import { getSessionCookie } from 'better-auth/cookies';
import { LEGACY_GATE_COOKIE } from '@/lib/auth-constants';
import { accessToken } from '@/lib/legacy-env';

/**
 * Whole-app access gate. Active only when FOUNDER_OS_ACCESS_TOKEN is set
 * (production deployments on public URLs); unset keeps dev and the demo
 * completely open. See lib/access-gate.ts for the decision logic + tests.
 */
export function proxy(req: NextRequest) {
  const decision = gateDecision({
    token: accessToken(),
    cookie: req.cookies.get(GATE_COOKIE)?.value ?? null,
    legacyCookie: req.cookies.get(LEGACY_GATE_COOKIE)?.value ?? null,
    queryToken: req.nextUrl.searchParams.get('token'),
  });

  function migrateCookie(res: NextResponse) {
    if (decision.kind === 'migrate-cookie') {
      res.cookies.set(GATE_COOKIE, decision.value, { httpOnly: true, sameSite: 'lax', secure: req.nextUrl.protocol === 'https:', maxAge: 60 * 60 * 24 * 30, path: '/' });
      res.cookies.delete(LEGACY_GATE_COOKIE);
    }
    return res;
  }

  switch (decision.kind) {
    case 'open':
    case 'pass':
    case 'migrate-cookie':
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
      res.cookies.delete(LEGACY_GATE_COOKIE);
      return res;
    }
    case 'challenge':
      if (emailEntryPath(req.nextUrl.pathname, req.method)) break;
      if (req.nextUrl.pathname.startsWith('/api/')) return NextResponse.json({ error: 'Beta access required' }, { status: 401 });
      return new NextResponse(challengePage(), {
        status: 401,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
  }
  const pathname = req.nextUrl.pathname;
  const internal = req.method === 'POST' && internalAllowed(pathname, req.headers.get('x-nosteros-internal'));
  if (!publicAuthPath(pathname) && !internal && !getSessionCookie(req)) {
    if (pathname.startsWith('/api/')) return migrateCookie(NextResponse.json({ error: 'Sign in required' }, { status: 401 }));
    const destination = new URL('/sign-in', req.url);
    destination.searchParams.set('next', pathname + req.nextUrl.search);
    return migrateCookie(NextResponse.redirect(destination));
  }
  // Never trust a caller-provided path when deciding whether the layout is public.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nosteros-path', pathname);
  return migrateCookie(NextResponse.next({ request: { headers: requestHeaders } }));
}

export const config = {
  // gate pages and APIs; skip Next internals + static files so the
  // challenge page itself can render
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.png|.*\\.png$|.*\\.svg$).*)'],
};
