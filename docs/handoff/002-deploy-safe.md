# 002: Make nosterOS safe to deploy

Status: ready
Review by Claude: yes (touches the login gate)

## Goal
Fix two upstream behaviors that would break nosterOS the moment it runs on
Railway: connectors faking "connected", and scheduled jobs silently failing
once the login is on.

## Context
1. **Fake connector status.** `lib/gate.ts` `isGated()` returns true whenever
   `RAILWAY_ENVIRONMENT` or `VERCEL` is set. When gated, about 26 connectors
   (via `lib/connectors/demo-status.ts`) report "connected" with made-up
   detail like "3 campaigns running", and `lib/brain.ts`,
   `lib/skills-catalog.ts` and `app/api/usage/route.ts` switch to demo
   behavior. That was right for the upstream public demo. nosterOS is never
   a demo, so on Railway it would show invented numbers.
2. **Cron tick behind the login.** `instrumentation.ts` POSTs
   `http://127.0.0.1:<port>/api/cron/tick` every 60s (and a second "failover"
   tick does the same pattern). `middleware.ts` (or `proxy.ts` after spec
   001) gates every path. With `FOUNDER_OS_ACCESS_TOKEN` set, those internal
   requests carry no cookie, get the 401 challenge page, and every scheduled
   job stops without anyone noticing.

## Do
1. `lib/gate.ts`: `isGated()` returns true only when `DEMO_GATE === '1'`.
   Deployment platform variables no longer matter. Update the file comment.
2. `tests/gate.test.ts`: Noe and Claude approve changing these assertions.
   The Vercel and Railway cases now expect `false`; keep the `DEMO_GATE=1`
   and `DEMO_GATE=0` cases; add a case with both `RAILWAY_ENVIRONMENT` and
   `VERCEL` set and no `DEMO_GATE`, expecting `false`.
3. In `instrumentation.ts`, every internal `fetch` to `127.0.0.1` sends the
   access cookie when a token is configured:
   `Cookie: founder_os_access=<FOUNDER_OS_ACCESS_TOKEN>` (use `GATE_COOKIE`
   from `lib/access-gate.ts`, don't hardcode the name). Put the header
   building in one small exported pure helper so it can be tested.
4. Make the tick log a clear warning when the response is not 2xx (status
   code included) instead of failing on JSON parsing, so a broken tick shows
   up in the logs.
5. Tests: the helper returns the cookie header when the token is set and
   nothing when it isn't; with `DEMO_GATE` unset and `RAILWAY_ENVIRONMENT`
   set, `metaAdsStatus()` does not report `connected` without a key.

## Don't
- Don't delete `demo-status.ts` or the gated branches in the connectors; the
  flag just never turns on in nosterOS. Removing them is later cleanup.
- Don't change `lib/access-gate.ts` decision logic.
- Don't exempt `/api/cron/*` from the gate; it stays protected.

## Done when
- typecheck, tests (minus the Windows baseline in AGENTS.md) and build pass.
- With `FOUNDER_OS_ACCESS_TOKEN=test123` and `RAILWAY_ENVIRONMENT=production`
  in `.env.local`, `npm run dev`: within two minutes the terminal shows the
  tick running with no 401 warning; `curl -i http://localhost:4100/api/cron/tick`
  without a cookie still returns 401; and the Integrations page (opened
  with `?token=test123`) shows unconfigured connectors as not configured,
  not connected. Then remove both variables from `.env.local`.

## Report (Codex fills this in)
- Status:
- Commits:
- Typecheck / tests / build:
- Tick check (log lines seen):
- curl without cookie:
- Integrations page result:
- What changed beyond the spec, and why:
- Questions or blockers for Claude:
