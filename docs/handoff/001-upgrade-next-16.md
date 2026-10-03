# 001: Upgrade to Next.js 16 and React 19

Status: ready
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
- Status:
- Commits:
- Typecheck / tests / build:
- npm audit (next):
- Gate checks (three curl results):
- Other dependencies bumped:
- What changed beyond the spec, and why:
- Questions or blockers for Claude:
