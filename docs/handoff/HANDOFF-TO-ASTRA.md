# OmegaOS handoff: Claude resumes lead architecture

## Current authority - October 5, 2026

Noe explicitly requested that Claude take over again as lead architect.
Claude owns plans/specs, architecture, security decisions and review; Codex /
Astra returns to implementation and reports. The Oct 3 autonomous takeover
below is historical and no longer grants architect authority to Astra.
`AGENTS.md` has been updated to match. Retain this filename so existing links
and session instructions keep working. Read this current section before the
historical roadmap; old "in progress" and "next" labels below are not current.

## NEXT QUEUE - lead-gen program (Claude, Oct 5 evening, approved by Noe)

Noe approved queueing this. Work in order; each spec is self-contained:
1. `M8-backups-and-staging.md`: encrypted nightly backups, restore drill, staging env.
2. `M9-business-profile.md`: copy-prompt → paste-markdown Business Profile.
3. `M10-lead-plan-and-preferences.md`: plan, max 6 questions, stored preferences, spend ledger.
4. `M11-lead-engine-v1.md`: find → read site → score → capped paid upgrade → openers; no sending.
5. `M12-outreach-approval-and-sending.md`: approval queue, compliant sending, reply tracking.
M7 (sign-in first) may run in parallel if files don't overlap.
From M8 on, deploy feature work to **staging** freely; `main`/production still needs Noe's yes.
Paid resources, variables, legal text and first real sends stop for Noe (see each spec).
If Claude is unavailable and Noe says so in chat, follow `ARCHITECT-FALLBACK.md`.
Etsy: M6k confirmed the production key works and the shop syncs (66739608); no Etsy work queued.

## Current checkout and deployment

- Oct 5, 20:20 CDT: Noe requested Batch 1 deployment + Batch 2, then chose to wait for Claude review and staging checks.
- Deployment HOLD: no main push/merge, resource, secret or production change; Batch 1 code/report checkpoint `bd994a8`.
- Batch 2 preflight only: M9 requires M8 code merged; no Batch 2 branch or implementation started.
- Step 2B also needs Claude's global spend-reservation store/atomicity decision; workspace-local transactions cannot enforce a global cap alone.
- M7 platform-AI support is absent from this checkout; no parallel-branch merge or AI enablement inferred; details in M9/M10 reports.
- Docs-only checkpoint; tests not rerun; unrelated provider docs and shared dev server untouched. Resume after prerequisite/review decisions.

- Oct 5, 20:14 CDT: Batch 1 code complete on `lg/b1-backups-staging`; gate fix `c2468aa`; report follows.
- Existing operator gate now precedes owner-only backup status; unchanged boundary tests pass; all 35 new tests pass.
- Typecheck/build pass; full Windows suite 379/386 files and 3,957/3,961 tests pass; only documented baseline failures.
- Fixture restore drill passed; no authenticated browser smoke, cloud backup, live S3 restore or staging deploy yet.
- Claude review plus Noe's costs/resources/secrets/DNS approvals remain; see M8 final report and STAGING.md.
- No main/production changes, real sends or live data changes; shared server untouched; STOP before Batch 2.

- Oct 5, 20:07 CDT: Batch 1 continuation on `lg/b1-backups-staging`; runtime `f34f7be`, UI checkpoint `636a485`.
- Snapshot exception approved; online backup/verified upload/prune/lock/tick/CLI implemented; disposable CLI restore drill passes.
- Typecheck/build passed; full suite found integration issues; latest focused rerun leaves 2 platform-page gate assertions failing.
- STOP per two-failure rule: propose existing operatorWorkspaceForPage gate before the additional platform-owner check; approval asked.
- Full results and exact fix in M8 Report; infrastructure/cost/secrets/DNS approvals and live staging/restore drills still pending.
- No main push, production deploy, paid resources, real sends or live data changes; Batch 2 not started; shared server untouched.

- Oct 5, 19:44 CDT: Batch 1 partial on `lg/b1-backups-staging`; code `bdec969`, `1d88b36`; report follows.
- Encryption/archive/store/fixture restore implemented; staging badge and outbound guards tested; no live backup yet.
- Typecheck/build pass; 382 files: 375 pass / 7 Windows baseline fail; tests 3,941 pass / 4 baseline fail; new 20/20.
- BLOCKED: db.backup requires plaintext temporary snapshots but M8 forbids them; exception asked, not yet approved.
- Snapshot/runner/lock/status/tick/CLI/panel pending; staging resources, variables and DNS still need Noe's cost approval.
- No production changes or real sends; full Batch 1 report in M8 and costs/setup in STAGING.md; STOP before Batch 2.

- Oct 5, 19:02 CDT: Batch 0 done on `lg/b0-docs`; queue commit `5c8d861`, report follows.
- Typecheck/build pass; 376 test files: 369 pass / 7 baseline fail; tests 3,921 pass / 4 baseline fail.
- Railway service disk 0.060473344 GB (~60.5 MB), below documented 500 MB / 80% threshold.
- Docs-only branch push; no main push, deploy, resource, credential or variable changes.
- Full baseline failures, self-review and plan conflict recorded in LEADGEN-EXECUTION-PLAN.md Report.
- STOP after Batch 0 per current chat; await "continue", then base Batch 1 on `lg/b0-docs`.

- Oct 5, 18:07 CDT: M6k deployed with Noe's explicit approval; main/origin/main
  code d4d4689. Railway 39b605ec-7023-41ba-a127-2e4de43e420e SUCCESS at 23:06:03 UTC.
- Added owner/admin-only fixed Etsy key ping and masked error_description support.
- Exactly one production key-only ping returned HTTP 200; JSON error fields: neither.
- Etsy dashboard already showed shop 66739608 Up to date, 1 lifetime sale and 396
  active listings collected at 23:00:18 UTC, before this deployment; not a new sync by us.
- Prior 403 cause/body remain unconfirmed; current key is accepted for the ping endpoint.
- Typecheck/build pass. Full Windows: 3,921 pass / 4 baseline assertion failures plus
  three baseline EPERM suite cleanup failures. Focused rerun 51/51; see M6k Report.
- No Railway variables, credentials or source settings changed; no user token in ping.
- Production result remains visible in Chrome. Report checkpoint is local-only to avoid
  another deployment; unrelated handoff edits and shared dev server remain untouched.

- Oct 5, 17:52 CDT: Claude accepted M6j at `f24b60c`; reported Linux
  typecheck clean and 375 files / 3,912 tests passing; Noe approved deployment.
- Local main fast-forwarded to `f24b60c00974f3641f038cbd34fa1f9c71bff113`;
  origin/main pushed from `f929838` to that exact reviewed commit.
- Railway production `nosteros-web` deployment `8a67e84c-ee99-4af0-bdc7-ca04571a0f00`
  reports SUCCESS for `f24b60c`, completed October 5 at 22:51:47 UTC.
- Public `https://os.noepenaa.com` verified afterward: expected HTTP 401,
  title `OmegaOS · Private`, and email sign-in link present.
- No Railway variables/configuration or provider credentials changed.
  Unrelated working-tree edits and the shared dev server were left untouched.
- M6j masked Etsy diagnostics and the authenticated shop fallback are deployed;
  authenticated Find accounts, actual granted scope, and root cause remain unverified here.
- Deployment checkpoint recorded locally without another push/redeploy.
  Next: owner/admin tests Etsy Find accounts and shares the sanitized result if it fails.

- Oct 5, 17:32 CDT: M6h + M6i accepted by Claude; Linux typecheck clean and
  374 files / 3,893 tests passing (reported by Claude). Noe's deploy approval relayed.
- Fast-forward pushed `origin/main` from `cace87a` to reviewed `f929838`;
  `origin/m6h-m6i-review` retains the reviewed commit. No other working-tree edits included.
- Railway production `nosteros-web` deployment `25a24330-f38f-4d62-acff-35fafd899f8e`
  reports SUCCESS for `f929838268f8f8bb3459e7d4931952caecbbaa4c`, completed
  October 5 at 22:32:05 UTC. No Railway variables/configuration changed.
- Public `https://os.noepenaa.com` checked after deployment: expected HTTP 401
  private-beta page, title `OmegaOS · Private`, with email sign-in link present.
- This verifies deployment and the public gate, not a fresh authenticated provider sync.
  Etsy's live cause remains unconfirmed; next diagnostic comes from owner/admin Find accounts.
- This checkpoint is a local documentation-only commit; it is not pushed to trigger another deploy.
  Older deployment/provider snapshots below are historical; M6h and M6i Reports contain implementation details.

- Oct 5, 14:34 CDT follow-up: M6f is complete; code `4ff3140`, report
  `f409920`, feature branch pushed and merged locally. Main has NOT been
  pushed or deployed; the older checkout snapshot below predates that work.
- Etsy authorization now supersedes the old separate-app-only instruction:
  Noe approved the active Personal Access `nosterlogistics` app. Credential
  storage and the pending callback save are recorded in `M6g-etsy-existing-app.md`.
  Read its security note before using these credentials in production.

- Product: **OmegaOS**, red/charcoal/white, powered by nosterCodes. nosterOS is
  the retained repo/folder and internal configuration name, not the public brand.
- PC: `C:/Users/noster/Documents/GitHub/nosterOS`; GitHub: `nosterCodez/nosterOS`.
  This is separate from MAIN-portfolio-website and its marketing handoffs.
- Current branch: `m6b-commerce-connectors`, code commit `99eece0`, pushed to
  origin. Printify and Shopify code is on this branch, **not deployed**.
- `main` / `origin/main`: `52c218a`; application change `7b491bd` added Google
  dashboard clarity and financial CSV imports. Last verified production UI
  includes this change at `https://os.noepenaa.com`.
- Railway project `86e6ef04-9180-49d2-b319-ef5d60cd9351`, service
  `cd008990-7a89-415f-82c8-e841db70a8ef` (`nosteros-web`), environment
  `1794ea24-cbb7-4ea1-91bd-5ade95cb6b33`. Main pushes can auto-deploy; no new
  deployment is authorized by this documentation handback.
- Existing shared dev server was left on port 4100. Temporary browser-fixture
  and local key-save servers were stopped. Recheck process health before use.

## Implemented versus outstanding

- M1 accounts/auth and M2 workspace isolation are complete and merged; see M2f.
  Online-first bootstrap and real two-workspace checks replaced the requirement
  for a local real-data migration. Do not migrate/delete Noe's legacy PC data.
- M3 envelope-encrypted workspace credentials is deployed; see M3 report.
  Customer credential resolution has no environment or cross-workspace fallback.
  Preserve the deployed master key and its recovery copy; never regenerate it
  to troubleshoot. Host/operator features remain explicitly gated and disabled
  on hosted beta (`NOSTEROS_OPERATOR_FEATURES=0`).
- M4/M5 connection screens, OAuth infrastructure, provider discovery, opt-in
  collectors and workspace dashboards are implemented; provider access varies.
  Returning-workspace and emailed team-invitation work is recorded in M5b.
  This is not evidence that every planned integration is operational.
- The original roadmap's M6 agency-links milestone is NOT the newer M6 Google/
  CSV spec. Numbering diverged; audit actual code/reports before marking the
  original intelligence, agency-link, backup, export or sharing roadmap done.
- Google: Search Console, GA4 and YouTube were authorized, selected, synced and
  persisted in nosterCodes. GA4 returned no rows, displayed honestly as no data.
  See M5q for exact properties, periods and results. OAuth remains in testing.
- Business Profile access application submitted; case `3-9666000042199`.
  Approval is pending, quota was 0. Do not mark connected just because APIs are
  enabled. Noe prioritizes GBP ahead of additional Google Ads work.
- Google Ads remains permission-denied for account `9077054209`; automatic
  collection is off. Its browser shows unfinished campaign setup. Do not
  publish campaigns, alter budgets or add billing to resolve connector access.
- Meta registration remains blocked; no verified real Facebook/Instagram/Ads
  reporting. Etsy's separate `omegaos` app is now shown as Banned. Noe approved
  reusing the active Personal Access `nosterlogistics` app (not its banned
  namesake); see M6g for the incomplete activation checkpoint. LinkedIn is paused.
- TikTok ownership file was deployed and Noe confirmed site verification;
  verification is not app approval or successful reporting.
- PayPal partner inquiry submitted for reusable merchant-consented reporting;
  no live reporting integration/approval. Noe confirmed the business funds are
  held in PayPal and wants the transaction CSV retrieved through Chrome.
  CSV download was blocked by browser timeouts and has NOT been completed.
  PayPal's email reply was reviewed and a reply drafted in chat, not sent.
- M6 CSV imports are live: standard and PayPal formats, preview/confirm,
  deduplication, workspace isolation, currency-separated net movement. They do
  not represent account balance or accounting revenue. No real financial CSV
  has been imported; full authenticated upload/confirm browser QA is pending.
- M6b/M6c add Printify then Shopify OAuth, read-only counts, discovery and
  scheduling. No live provider authorization/collection tested. Printify app
  review and Shopify app/distribution setup remain external prerequisites.

## Local credentials and next review

- Noe requested dedicated provider keys for manual pasting into connectors.
  The owner-only, Git-ignored `.env.connector-keys.local` now contains OpenAI,
  Anthropic, Stripe and Printify. Never stage, paste, log or upload its contents.
- Stripe is live Charges/Refunds read-only. Printify is shops.read,
  products.read, orders.read. OpenAI is Responses-only; Anthropic is Default
  workspace with no Admin API. Both AI keys expire **November 4, 2026**.
- These new keys are local only, not installed in OmegaOS. Printify's current
  connector is OAuth-only: a manual-token connection option still needs a spec
  and implementation. No paid inference calls/credits were used to verify keys.
- Review `M6b-printify-connector.md`, `M6c-shopify-connector.md`, then
  `M6d-dedicated-connector-keys.md`. Decide the manual Printify token path before
  promising Noe that he can paste that key into the current Connections UI.
- Last commerce validation: typecheck and isolated build passed; 3,776 tests
  passed, four known Windows assertion failures plus three known EPERM cleanup
  failures. Desktop/mobile synthetic UI checks passed. This is not live-provider
  end-to-end verification. See the specs for exact scope and security checks.
- Unrelated local handoffs are deliberately preserved: modified M5l and M5n;
  untracked M5m, M5o, M5p and M5q. Read them on the PC; do not overwrite or assume
  a cloud checkout contains them. Re-stage immediately before editing shared docs.
- No runtime edits or tests for this handback; documentation-only. No secrets
  belong in this handoff. Further deployments, credentials, money, real messages
  and legal changes still require Noe's approval under the working agreement.

---

## Historical October 3 takeover and original roadmap (superseded status)

Written by Claude on Oct 3, 2026, at Noe's request, because Claude is near
its usage limit. At that time Astra (Codex) became architect and builder;
this delegation was superseded by the October 5 agreement above.
Read this whole file, then `AGENTS.md`, `CLAUDE.md`,
`docs/architecture/multi-tenant.md` and `docs/architecture/dashboard.md`.
Where those two architecture files conflict, `multi-tenant.md` wins.

## What changes in the working agreement
- You now write your own specs in `docs/handoff/` (same template), then
  implement them. Keep one spec per change, small commits, and fill in each
  Report. That paper trail is what lets Claude or anyone else pick it back up.
- The AGENTS.md stop rules still apply, but you escalate to **Noe** (not
  Claude) for: anything involving money, sending messages to real people,
  credentials, legal text, publishing, a new paid service, or deleting
  data. For pure engineering decisions, decide yourself and write the
  decision and the reason into the spec.
- Before calling any security-related spec done (auth, sessions,
  credentials, encryption, agency access, mail, public sharing), do a
  self-review pass: re-read the diff as an attacker, list what you checked
  in the Report, and add tests for each rule.

## Product in one paragraph
nosterOS is a fork of FounderOS-DEMO (MIT; keep the LICENSE). It is becoming
a multi-user product: founders sign up and connect their own Google
(Search Console, Analytics, Business Profile, YouTube, Ads), Meta
(Instagram, Facebook, Ads), TikTok, LinkedIn, Etsy, Stripe and email, and
get one dashboard with every number, its history, anomaly alerts,
forecasts, recommended actions, phone alerts and shareable client views.
The nosterCodes team uses it for nosterMarketing, nosterHealth,
nosterLogistics and autopilot-store (Etsy). nosterMarketing clients get
their own workspaces and can approve an agency link so the team sees their
progress.

## Done (all reviewed and pushed)
- 001 Next.js 16.3.8 / React 19 upgrade; `middleware.ts` is now `proxy.ts`.
- 002 Demo mode only with `DEMO_GATE=1`; internal ticks authenticate.
- 003 Metric store: `metric_points`, `collector_runs`, `lib/businesses.ts`,
  `lib/metrics/registry.ts`, fixed-interval collectors (15 min to 1 week),
  stale = no success within 2 intervals, rollups return
  `{value, reporting, expected}` and never count missing data as zero.
- 003b Security: production `npm audit --omit=dev` = 0, build warnings = 0,
  nodemailer 10, imapflow 1.7.8, ai 6.0.300, ad library stored under
  `dataDir()`. Accepted: Tailwind 3 / braces advisory (build-only, no fix
  exists). Deferred: vitest 4.1.11 + vite 6.4.3 (passes all tests, but its
  lockfile needs `legacy-peer-deps`, which breaks plain `npm ci` in CI;
  add an `.npmrc` or CI flag in that spec).
- Upstream "join the cohort" upsell removed (`tests/no-upsell.test.ts`).

## In progress
- **M1, accounts and workspaces** (`docs/handoff/M1-accounts-and-workspaces.md`).
  Finish it, then self-review it as an auth change: proxy gate, every API
  route calls the session helper, internal header only on its 3 paths,
  system mail refuses free-form content and never logs links in
  production.

## Remaining roadmap, in order
1. **M2** One SQLite file per workspace under `DATA_DIR/workspaces/<id>.db`
   plus `DATA_DIR/control.db`. `getDb()` reads the workspace from a request
   context and **throws** when there is none: never a default workspace.
   Audit and key by workspace every module-level cache (`Map`, top-level
   `let`, connector caches, brain provider). Migrate today's
   `founder-os.db` into a "nosterCodes" workspace (kind `agency`), with
   Noe as owner. Background jobs loop over workspaces explicitly.
2. **Private Railway deploy for the team** (after M2): deploy from GitHub
   only (never `railway up` from the local folder, which would upload
   `data/` and `.env.local`). Volume mounted at `DATA_DIR`. Variables:
   `BETTER_AUTH_SECRET`, `NOSTEROS_BASE_URL`, `NOSTEROS_INTERNAL_SECRET`,
   `NOSTEROS_MASTER_KEY` (after M3), SMTP, `FOUNDER_OS_ACCESS_TOKEN` as the
   beta outer wall, `DEMO_GATE` unset. Add `poppler-utils` as a runtime
   apt package (Railpack: `RAILPACK_DEPLOY_APT_PACKAGES`) for PDF bank
   statements. Ask Noe before creating the Railway project (it costs money).
3. **M3** Per-workspace encrypted credentials: `connections` table in each
   workspace DB, envelope encryption (per-workspace AES-256-GCM data key,
   wrapped by `NOSTEROS_MASTER_KEY`). `resolveCred` reads only the current
   workspace, never another workspace and never env vars for customer data.
   Operator-only features (shell agents/Paperclip/Hermes, Telegram command
   bridge, home-directory connectors like Obsidian/Plaud/Zernio config,
   `readEnvFileSafe`, trading) run only for the nosterCodes workspace AND
   `NOSTEROS_OPERATOR_FEATURES=1`.
4. **M4** Connections page: OAuth connect buttons through the platform apps
   (state signed, carries the workspace id) for Google, Meta, TikTok,
   LinkedIn, Etsy; pasted restricted read-only key for Stripe; IMAP app
   password for email (not the Gmail API, whose scopes are "restricted").
   Login OAuth client stays separate and only asks `openid email profile`.
5. **M5** Collectors and jobs per workspace, each with a time budget.
6. **Dashboard collectors**, per workspace: Search Console + GA4 + Business
   Profile; Stripe; the dashboard pages (home pulse, business switcher,
   Search/Money/Social/Ads/Leads/Actions, remove all seeded demo data);
   Meta (IG, FB, Ads); Etsy (orders/revenue; ad spend from ledger entries
   `prolist` + `offsite_ads_fee`; per-listing ads via CSV import, since
   Etsy's API has no ads endpoint); Google Ads + YouTube; TikTok;
   LinkedIn (needs approval; fallback manual entry).
7. **Intelligence**: anomalies (robust z-score vs 28-day median/MAD,
   weekday-aware, |z|≥3 watch, ≥4 high, minimum-volume guard), forecasts
   (Holt linear on weekly series, 4 weeks, only with 8+ points), daily
   courses of action (LLM, each action cites its numbers; rule-based
   fallback), Telegram alerts (high only immediately, 8am digest, quiet
   10pm–7am, fail-closed allowlist).
8. **M6** Agency links (client owner approves; `view` or `manage`; agency
   never sees credentials; every access in `audit_log`; client can revoke).
9. **M7** Workspace delete/export, Meta data-deletion callback, privacy and
   terms pages, nightly backups of every DB kept 14 days.
10. **Client share pages** `/share/[token]` (hashed token, revocable,
    noindex, rate-limited, only the shared metrics).
11. **Outreach** (nosterMarketing lead → drafted email → Noe approves →
    send). `lib/mail-guard.mjs` today is all-or-nothing via
    `MAIL_ALLOW_EXTERNAL`. Do NOT use that switch. Each external email
    needs a stored approval record (approver, time, exact recipient, body
    hash) checked by the send path.
12. vitest upgrade spec; Windows test fixes (the 6-7 baseline failures).

## Invariants never to break
- Honest numbers: `null` = couldn't read, `0` = real zero. No seeded or
  fake values on any dashboard. Every number shows its source and age.
- No workspace context → throw. No cross-workspace fallbacks.
- No secrets in git. No real emails, DMs or charges without Noe's approval.
- Keep `tests/no-upsell.test.ts` green.

## Decided by Noe (Oct 3)
- **Legal business name:** nosterCodes. Use it on the privacy policy,
  terms, OAuth consent screens and Meta Business Verification.
- **Web address:** `https://os.noepenaa.com` (latest decision confirmed in chat).
  Set the deployed `NOSTEROS_BASE_URL` to that,
  use it for every OAuth redirect URI, and publish the privacy policy and
  terms there. nosterLogistics is treated as retired, so remove
  `nosterlogistics` from `lib/businesses.ts` in the next spec that touches
  it (ask Noe first if any of its data should be kept).
- **Mailing address:** 2330 E Freddy Gonzalez Dr. PMB 502, Edinburg, TX
  78542.
- Before pointing DNS at Railway, check what currently serves
  os.noepenaa.com and confirm with Noe right before switching. This decision
  does not authorize changing DNS for logistics.noepenaa.com.

## Open items only Noe can close
- Business name and web address are decided above; platform verification
  and deployment setup remain pending.
- Business address for legal pages and verification, per Noe:
  **2330 E Freddy Gonzalez Dr. PMB 502, Edinburg, TX 78542**. Note it's a
  private mailbox; the legal pages should call it a mailing address, and
  the verification documents must show the same business name and address.
- Start the platform app reviews early: Google OAuth verification (about
  4–6 weeks; unverified apps stop at 100 users), Meta Business Verification
  then App Review per permission (needs the privacy policy URL, a
  data-deletion URL, screencasts with a real business account), TikTok and
  LinkedIn developer reviews.

## Things the Windows PC needs to know
- Node 24 works even though the repo once said 22; engines is `>=22`.
- Known Windows-only test failures are listed in AGENTS.md; anything else
  failing is real.
- The checklist page Claude kept (a claude.ai artifact) can't be updated
  by you. Keep progress in each spec's Report and summarize to Noe.
