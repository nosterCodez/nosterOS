# 003b: Security fixes and build-warning cleanup

Status: ready (after 003)
Review by Claude: yes (touches the mail-sending code)

## Goal
Clear every security advisory that affects nosterOS in production, silence
the 12 Turbopack tracing warnings, and fix two deploy problems the triage
found. Based on a 16-agent triage (8 investigators, 8 verifiers) of the 20
`npm audit` findings and the 12 build warnings; the reports live outside
the repo, and the decisions are summarized here.

## Decisions from the triage
| Finding | Affects production? | Decision |
|---|---|---|
| nodemailer (3 advisories), imapflow | Yes, Comms sends and reads mail | Fix now |
| axios, form-data (via @slack/web-api), ip-address (via imapflow/socks) | Runtime, but our calls don't reach the bugs | Fix now (lockfile-only) |
| ai, @ai-sdk/gateway, @ai-sdk/provider-utils | Yes, agent chat (behind the login) | Fix now (stay on 6.x) |
| browserslist, baseline-browser-mapping | Build-time only | Fix now (lockfile-only, free) |
| vitest, vite, @vitest/mocker, esbuild, vite-node | Tests only, nothing starts their servers | Later: vitest 4.1.11 + vite 6.4.3 passes all tests, but its lockfile breaks plain `npm ci` in CI. Separate spec. |
| tailwindcss, braces, chokidar, micromatch, fast-glob | Build-time only | Accept: one braces advisory with no patched version anywhere; the only way out is a Tailwind v4 rewrite. Revisit when braces ships a fix. |
| 12 tracing warnings | No effect on `next build` + `next start` (no `output: 'standalone'`) | Clean up with comments now, so a future Docker or standalone build doesn't copy `data/*.db` and `.env.local` into the image. |

## Do
1. `npm i nodemailer@^10.0.13 imapflow@^1.7.8`. nodemailer 10 is a
   TypeScript/ESM rewrite whose only listed breaking change is Node >= 20.
   Check whether it ships its own types; if so, remove `@types/nodemailer`.
   Make sure `sendEmailReply` (`lib/connectors/email.ts`) and its dynamic
   import still work: `tests/comms-reply.test.ts`, `tests/mail-guard.test.ts`
   and the email tests must pass.
2. `npm update axios form-data ip-address` → expect axios 1.20.0,
   form-data 4.0.6, ip-address 10.7.3, with only those lines changing in
   the lockfile.
3. `npm i ai@^6.0.300` (do not take 7.x). Run `tests/llm.test.ts`.
4. `npm update browserslist baseline-browser-mapping`.
5. Add `/*turbopackIgnore: true*/` as the first thing inside the flagged
   call's path argument at all 12 sites, e.g.
   `fs.readFileSync(/*turbopackIgnore: true*/ file, 'utf8')`. The sites:
   `lib/adpilot-data.ts:20`, `lib/connectors/obsidian.ts:72` and `:84`,
   `lib/connectors/plaud.ts:59`, `lib/connectors/whatsapp.ts:149`,
   `lib/connectors/zernio.ts:22`, `lib/creds.ts:87` and `:112`,
   `lib/foreplay/store.ts:19` and `:24`, `lib/paths.ts:27`,
   `lib/pdf-text.ts:16` (execFile). Comments only; behavior must not change.
6. Ad library data loss: `lib/foreplay/store.ts:15` (and `saved.ts` if it
   builds its own path) defaults to `<cwd>/data/ad-intel`, which ignores
   `DATA_DIR` and would be wiped on every Railway deploy. Change the default
   to `path.join(dataDir(), 'ad-intel')` using `dataDir` from
   `lib/paths.ts`. `ADSCOUT_STORE_DIR` still wins. Locally the path is
   unchanged. Add a test for both cases.
7. `lib/blueprint/compile.ts:34`: the Railway blurb says "Dockerfile from
   GitHub" but there's no Dockerfile. Change it to "built from GitHub with
   npm run build / npm start".

## Don't
- Don't upgrade vitest, vite or tailwindcss.
- Don't change `lib/mail-guard.mjs` behavior; redesigning outbound-mail
  approval is part of the outreach spec (see the security notes in
  `docs/architecture/dashboard.md`).
- No `npm audit fix --force`.

## Done when
- typecheck, tests (minus the Windows baseline) and build pass.
- The build prints no "Dynamic filesystem access" warnings. If any remain,
  list them with file:line.
- `npm audit --omit=dev` reports 0 vulnerabilities. If not, list what's
  left and why.
- Full `npm audit` lists only the vitest chain and the tailwind chain
  (about 10 findings); paste the summary line.

## Report (Codex fills this in)
- Status:
- Commits:
- Typecheck / tests / build:
- Tracing warnings left:
- `npm audit --omit=dev`:
- Full `npm audit` summary:
- @types/nodemailer kept or removed, and why:
- What changed beyond the spec, and why:
- Questions or blockers for Claude:
