# 003b: Security fixes and build-warning cleanup

Status: done - awaiting Claude review
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
- Status: Implemented and verified on Node v24.18.0; ready for required Claude review, not deployed.
- Commits: aa32abe (approved dependency upgrades), 62455e7 (tracing comments, persistent store path, tests); this report is committed separately.
- Typecheck / tests / build: Typecheck PASS; default Turbopack build PASS. Full suite: 3479 passed / 4 failed, 314 passed / 7 failed files (321 total); only documented Windows baseline failures remain. Focused mail/guard/LLM/path tests: 42 passed; additional real Nodemailer dynamic-import/offline stream-transport test: 1 passed. No email was transmitted.
- Tracing warnings left: None. Build log contains zero Dynamic filesystem access warnings; all twelve specified sites annotated without changing their runtime behavior. No webpack fallback.
- `npm audit --omit=dev`: found 0 vulnerabilities.
- Full `npm audit` summary: 10 vulnerabilities (3 moderate, 6 high, 1 critical). Remaining packages are @vitest/mocker, vite, vite-node, vitest, esbuild, braces, chokidar, fast-glob, micromatch, tailwindcss: only the deferred test/build chains approved in this spec.
- @types/nodemailer kept or removed, and why: Removed. Nodemailer 10.0.13 ships dist/esm and dist/cjs declarations alongside exported modules; native type resolution and the existing sendEmailReply dynamic import both pass. lib/connectors/email.ts and lib/mail-guard.mjs behavior are unchanged.
- Installed versions: nodemailer 10.0.13, imapflow 1.7.8, ai 6.0.300, axios 1.20.0, form-data 4.0.6, ip-address 10.7.3, browserslist 4.29.3, baseline-browser-mapping 2.11.27. Kept Vitest, Vite and Tailwind versions unchanged; no audit fix --force.
- Lockfile transitive changes from the approved commands: @ai-sdk/gateway 3.0.209, @ai-sdk/provider 3.0.18, @ai-sdk/provider-utils 4.0.57, eventsource-parser 3.1.1, undici 6.29.0; mail chain @zone-eu/mailsplit 5.4.16, encoding-japanese 2.3.0, iconv-lite 0.7.3, libmime 5.4.3; browser metadata caniuse-lite 1.0.30001814, electron-to-chromium 1.5.444, node-releases 2.0.57, update-browserslist-db 1.3.3. No unrelated top-level dependency added.
- What changed beyond the spec, and why: No feature changes. Added tests/foreplay-store-path.test.ts for DATA_DIR/override/local paths and tests/nodemailer-compat.test.ts to verify real MIME generation via an offline transport. saved.ts already uses storeDir(), so no duplicate path fix needed. Blueprint now describes the actual GitHub npm build/start process. Added final 003 commit IDs to its Report.
- Runtime: dev server remains running at http://localhost:4100 (launcher PID 41128). /, /comms and /api/collectors all HTTP 200 after updates. No secret, real message, production deployment, or new service provisioned.
- Questions or blockers for Claude: None. Please review the dependency/mail compatibility changes as specified; existing mail approval behavior and accepted test/build-only advisories remain unchanged.
