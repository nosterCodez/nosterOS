# 001: Upgrade to Next.js 16 and React 19

Status: blocked - Claude review needed for obsolete test assertion
Review by Claude: yes (touches the login gate)

## Goal
Move from Next.js 14.2.35 / React 18 to Next.js 16.3.8 / React 19. Next 14
is end of life: `npm audit` lists 17 open Next.js advisories (cache
poisoning, DoS, SSRF, XSS) and the only fixed line is 16.3+. This has to
land before the app goes on a public URL.

## Context
- Read the official upgrade guides after installing; they ship inside the
  package: `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-15.md`
  and `version-16.md`. Follow them over memory.
- Breaking changes that apply to this repo:
  - Async request APIs: `params` and `searchParams` are Promises in pages,
    layouts and route handlers (about 27 files under `app/`). The codemod
    handles most of it.
  - Next 16 renames `middleware.ts` to `proxy.ts` (exported function
    `proxy`). The login gate lives there. `tests/access-gate.test.ts`
    reads `middleware.ts` by name; update that test to the new filename
    only, not its assertions.
  - `next.config.mjs`: `experimental.instrumentationHook` is no longer
    needed (instrumentation is stable), and
    `experimental.serverComponentsExternalPackages` becomes top-level
    `serverExternalPackages`.
  - Turbopack is the default builder in 16. The config has no custom
    webpack, so it should just work; if the build fails on Turbopack, report
    it rather than forcing webpack.
  - React 19 type changes (global `JSX` namespace, `forwardRef`, ref
    props). Let `npm run typecheck` find them.
- `package.json` has `"engines": {"node": "22.x"}` but Noe's PC runs Node 24.
  Change it to `">=22"`.

## Do
1. `npm i next@16.3.8 react@19 react-dom@19` and
   `npm i -D @types/react@19 @types/react-dom@19`. Commit.
2. Run `npx @next/codemod@latest upgrade latest` (or the individual
   codemods the guide lists). Commit the codemod output on its own so it's
   reviewable.
3. Fix whatever typecheck, tests and build still flag. Small commits.
4. Rename `middleware.ts` → `proxy.ts` per the v16 guide; keep the gate
   logic in `lib/access-gate.ts` unchanged.
5. Update `next.config.mjs` and `engines` as above.
6. Update the Stack line in `CLAUDE.md` (Next.js 16, React 19).

## Don't
- Don't change what any test asserts. If an assertion has to change, stop
  and explain why in the Report.
- Don't upgrade other dependencies unless the upgrade requires it; list any
  you had to bump.
- Don't touch features, UI, or seed data.

## Done when
- `npm run typecheck` is clean.
- `npm test`: everything passes except the Windows baseline in AGENTS.md.
- `npm run build` succeeds.
- `npm audit` shows no advisories for `next`.
- Login gate still works. With `FOUNDER_OS_ACCESS_TOKEN=test123` in
  `.env.local`: `curl -i http://localhost:4100/` returns 401 with the
  challenge page; `curl -i "http://localhost:4100/?token=test123"` returns a
  redirect that sets the `founder_os_access` cookie; and
  `curl -i -H "x-middleware-subrequest: middleware" http://localhost:4100/`
  still returns 401. Then remove the token from `.env.local`.
- `npm run dev` serves `/`, `/funnel`, `/agents`, `/comms` without errors in
  the terminal.

## Report (Codex fills this in)
- Status: Upgrade implemented and runtime verified locally on Node v24.18.0; not complete because an assertion change requires Claude approval under AGENTS.md.
- Commits: 3ac7046 (agreement/spec, already pushed before upgrade); 6f87588 (Next 16.3.8 / React 19 dependencies); 82449e1 (async request API and middleware-to-proxy codemods); b81f4a7 (configuration, React ref typing, promised test fixtures, generated framework config). This report is committed separately.
- Typecheck: PASS, including a repeat after Next generated its updated TypeScript configuration.
- Tests: 3449 passed / 5 failed (3454); 305 passed / 8 failed files (313). Four failed tests and three cleanup failures match the Windows baseline: interaction-layer, paths, skills-plugins, superset-dispatch, lead-magnet-actions, lead-magnets-route, roadmap-mock-5h. API and seed passed this run.
- New test failure: tests/comms-perf.test.ts:95 requires /instrumentationHook: true/ in next.config.mjs. This spec explicitly removes that obsolete Next 14 flag; instrumentation is stable in Next 16. Assertion was NOT changed or bypassed. Implementation stopped here; remaining work only collected validation evidence and restored the requested dev server.
- Build: PASS using default Turbopack, with 12 dynamic-filesystem/project-tracing warnings. No webpack fallback. Review these warnings before public deployment because tracing can include the whole project in server output.
- npm audit (next): No next advisories. Entire dependency tree still has 20 other vulnerabilities (3 low, 4 moderate, 12 high, 1 critical); unrelated dependencies were not upgraded.
- Gate checks (three curl results): GET / => 401 with challenge HTML; GET /?token=test123 => 307 to / with founder_os_access cookie (HttpOnly, SameSite=lax, Path=/); GET / with x-middleware-subrequest: middleware => 401. Temporary FOUNDER_OS_ACCESS_TOKEN was removed from .env.local afterward. lib/access-gate.ts is unchanged.
- Dev verification: /, /funnel, /agents, /comms all HTTP 200; stderr empty and no terminal errors. Normal boot warmup returned 200. Background npm run dev remains running at http://localhost:4100, launcher PID 11456; stop with taskkill /PID 11456 /T /F. Logs: %TEMP%/nosteros-dev.stdout.log and nosteros-dev.stderr.log.
- Other dependencies bumped: None beyond requested next, react, react-dom, @types/react, @types/react-dom and their lockfile dependency changes. Used individual next-async-request-api and middleware-to-proxy codemods instead of upgrade latest to retain the exact requested Next version.
- What changed beyond the spec, and why: Next automatically changed tsconfig.json to react-jsx and added .next/dev/types; next dev appended its version-matched documentation block to AGENTS.md. Kept those framework-generated updates. Route fixtures now use Promise.resolve and WorkflowTree's ref permits null for React 19; no test assertions, features, UI, seed data, or gate logic changed.
- Questions or blockers for Claude: Approve a replacement for the obsolete comms-perf instrumentationHook assertion that verifies stable instrumentation behavior on Next 16. Then rerun tests and complete review of proxy.ts before considering this ready for a public URL.
