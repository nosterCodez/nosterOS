/**
 * Production access gate, pure logic (middleware.ts is the thin edge wrapper).
 *
 * Deployed OmegaOS instances live on public URLs (Railway hands out
 * *.up.railway.app). Set FOUNDER_OS_ACCESS_TOKEN and every request must
 * present the token once (?token=… or the challenge form); a cookie remembers
 * the browser after that. Leave it unset and the gate stays open — local dev
 * and the read-only demo deployment are unaffected.
 */

import { equalSecret } from '@/lib/auth-boundary';

export { GATE_COOKIE } from '@/lib/auth-constants';

export type GateDecision =
  | { kind: 'open' } // no token configured — gate disabled
  | { kind: 'pass' } // cookie already carries the token
  | { kind: 'migrate-cookie'; value: string }
  | { kind: 'set-cookie'; value: string } // correct ?token= — set cookie, clean the URL
  | { kind: 'challenge' }; // everything else — show the token form

export function gateDecision(input: {
  token: string | undefined;
  cookie: string | null;
  legacyCookie?: string | null;
  queryToken: string | null;
}): GateDecision {
  const token = input.token?.trim();
  if (!token) return { kind: 'open' };
  // fresh correct query token wins even over a stale cookie
  if (equalSecret(input.queryToken, token)) return { kind: 'set-cookie', value: token };
  if (equalSecret(input.cookie, token)) return { kind: 'pass' };
  if (!input.cookie && equalSecret(input.legacyCookie, token)) return { kind: 'migrate-cookie', value: token };
  return { kind: 'challenge' };
}

/** Self-contained challenge page: no app chrome, no data, just the form. */
export function challengePage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>OmegaOS · Private</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#0a0a0a; color:#f5f5f5; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
  * { box-sizing:border-box; }
  .card { text-align:center; padding:24px; width:100%; max-width:480px; }
  form { display:flex; gap:8px; flex-wrap:wrap; justify-content:center; }
  .mark { font-size:13px; font-weight:700; letter-spacing:.3em; text-transform:uppercase; }
  .mark b { color:#EF4444; }
  p { font-size:12px; color:#8a8a8a; margin:14px 0 22px; }
  input { background:#141414; border:1px solid #2a2a2a; color:#f5f5f5; padding:10px 12px;
          font:inherit; font-size:13px; width:240px; max-width:100%; outline:none; }
  input:focus { border-color:#EF4444; }
  button { background:#EF4444; border:0; color:#fff; padding:10px 18px; font:inherit;
           font-size:12px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; cursor:pointer; }
</style>
</head>
<body>
  <div class="card">
    <div class="mark"><b>Omega</b>OS</div>
    <p>This OS is private. Enter your access token.</p>
    <form method="GET" action="/">
      <input name="token" type="password" aria-label="Access token" placeholder="access token" autofocus>
      <button type="submit">Unlock</button>
    </form>
  </div>
</body>
</html>`;
}
