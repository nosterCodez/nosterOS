# Handoff: Astra takes over nosterOS (architect + builder)

Written by Claude on Oct 3, 2026, at Noe's request, because Claude is near
its usage limit. From now on Astra (Codex) is both architect and builder.
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

## Open items only Noe can close
- Legal business name that operates nosterOS (Meta Business Verification
  and Google app verification both need it).
- The web address nosterOS will live at (for example `os.nostercodes.com`).
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
