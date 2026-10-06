# Lead-gen program: execution plan for Astra (two steps per batch)

Author: Claude (lead architect), Oct 5, 2026. Approved for queueing by Noe.
Specs this plan executes: `M8`, `M9`, `M10`, `M11`, `M12` in `docs/handoff/`.
The specs define *what*; this file defines *order, batching, branches, checks
and gates*. If this plan and a spec disagree, the spec wins. Write the
conflict in the batch report.

---

## 0. How to run this plan

### Rhythm
- Work in **batches of two steps** (Step A + Step B). Finish both, run the
  full checks, deploy to staging (once staging exists), write the batch report,
  then **stop and wait** for Noe to say "continue" before starting the next batch.
- Never start a third step in a batch. If a step finishes early, use the time
  for tests and the report, not the next step.
- If one step of a batch is blocked on Noe (a resource, key, or approval), do
  the other step, mark the blocked one `BLOCKED (Noe: <exact action>)`, and
  report. The next batch may start only if it doesn't depend on the blocked step.

### Branches and deploys
- Base every batch on the latest `main`: `git fetch && git switch main && git pull --ff-only`.
- One branch per batch: `lg/b<N>-<short-name>` (e.g. `lg/b1-backups-staging`).
- Small commits, one concern each, message format:
  `lg(b<N>): <what>`, ending with the usual co-author lines if present.
- Push the batch branch to origin. Once staging exists (after Batch 1), merge
  the batch branch into `staging` and let Railway deploy it. **No approval
  needed for staging.**
- **Never push to `main` or deploy production** without Noe's explicit yes in
  chat. When Noe says yes: fast-forward `main` to the reviewed batch commit,
  push, confirm the Railway deployment is SUCCESS, check `https://os.noepenaa.com`
  returns the private 401 page, and note the deployment ID in the report.

### Checks for every step (all must pass before the step counts as done)
1. `npm run typecheck`, clean.
2. `npm test`, no failures outside the Windows baseline in `AGENTS.md`.
   Record totals (files/tests passed/failed) and list any baseline failures by name.
3. `npm run build`, succeeds. Use an isolated dist dir (e.g. `.next-lg-b<N>`)
   if the shared dev server is running; don't kill the dev server on 4100.
4. New code has tests written **first** (TDD, per `CLAUDE.md`). Each spec's
   "Tests (minimum)" list is a floor, not a ceiling.
5. Self-review checklist from `ARCHITECT-FALLBACK.md` §"Self-review checklist".
6. `git status` clean except files other sessions own. Never commit `.env*`
   files, `.local/`, or build output.

### Batch report (append to the spec's Report section AND add a 6-line
checkpoint at the top of `HANDOFF-TO-ASTRA.md` "Current checkout")
```
### Batch <N> report: <date, time CDT>
- Steps: <A name> = done|partial|blocked; <B name> = done|partial|blocked
- Branch / last commit: lg/b<N>-... @ <sha>
- Typecheck / tests (files, passed, failed + baseline names) / build:
- Staging: deployed <sha>, Railway deployment <id>, smoke checks <results>
- Noe actions needed (exact, numbered; "none" if none):
- Decisions made beyond the spec (one line each) and why:
- Risks / open questions for Claude:
- Ready for production? yes/no (production still needs Noe's yes)
```

### Stop immediately and report (don't guess) when
- a step needs money, a paid resource, a Railway variable, a credential, DNS,
  legal wording, a real outbound message, or data deletion;
- a security invariant in `ARCHITECT-FALLBACK.md` would have to bend;
- a third-party term (Google Maps caching, Foursquare license) differs from the spec;
- the same step fails twice, or the work is clearly much bigger than described;
- `/data` usage would exceed 80% of the 500 MB volume.

---

## Batch 0: Preflight (one short step, then continue to Batch 1 without waiting)
1. Commit the new handoff files if not yet committed:
   `M8`–`M12` specs, `ARCHITECT-FALLBACK.md`, this plan, updated
   `HANDOFF-TO-ASTRA.md`. Message: `docs: queue lead-gen program (M8-M12)`.
   Push to `main` is a docs-only change; it still triggers a deploy, so
   **push it together with Batch 1's production approval**, not alone.
   Until then keep it on branch `lg/b0-docs` and base Batch 1 on it.
2. Record baseline: typecheck/tests/build totals on current `main`
   (expected ≈ 376 files / ≈3,921 tests, Windows baseline failures only).
3. Note `/data` volume usage from the owner panel or Railway metrics (read-only).

---

## Batch 1: Safety net (M8)

### Step 1A: Encrypted backups + restore (M8 Decisions 1–7)
Files (suggested):
- `lib/backup/archive.ts`: `snapshotDatabases(dataDir, tmpDir)` using
  `db.backup()`, `buildManifest()`, `encryptArchive(buf, key)` /
  `decryptArchive(buf, key)` with the `OBK1 | iv(12) | ct | tag(16)` format.
- `lib/backup/store.ts`: `BackupStore` interface; `S3BackupStore`
  (`@aws-sdk/client-s3`, approved), `LocalDirBackupStore` (tests/dev).
- `lib/backup/run.ts`: lock row → snapshot → tar.gz → encrypt → upload →
  re-download manifest → verify hashes → prune (7 daily + 4 weekly) → record status.
- `lib/backup/restore.ts` + `scripts/backup-restore.ts`; `scripts/backup-now.ts`.
- `control.db` table `backup_runs` (+ idempotent migration) and repo + Zod schema.
- Tick wiring: once per UTC day after 08:00, skipped when env not configured
  (log one masked warning per day, never crash the tick).
- Owner-only platform panel: last backup time/size/count/last error;
  `/doctor` warning when no successful backup in 36 h.
Commits: archive+tests → store+tests → run/prune/lock+tests → restore+scripts →
tick wiring → panel/doctor → `.env.example`.
Acceptance: dev round-trip with `LocalDirBackupStore`; tamper/wrong-key tests fail
closed; tarball grep test proves no env secrets inside.

### Step 1B: Staging support in code (M8 Decisions 8–9)
- `OMEGA_ENV` (`production` default | `staging` | `development`) read in
  one module `lib/env-mode.ts`; Topbar "STAGING" strip (warn color, 1 line).
- `OMEGA_OUTBOUND_DISABLED=1`: central guard `assertOutboundAllowed(kind)`
  in a new `lib/outbound-guard.ts`; call it from every existing path that
  messages a real person (Comms send, invoices, mail-guard paths). System mail
  (magic links/invites) is exempt so sign-in works. Grep for every sender
  and list them in the report.
- `docs/handoff/STAGING.md`: setup checklist for Noe (below), promote flow,
  restore drill steps, env var **names** only.
- Tests: every outbound path refuses under the flag; system mail still works;
  strip shows only when `OMEGA_ENV=staging`.

### Noe actions to request in the Batch 1 report (exact list)
1. Approve creating a Railway **bucket** for backups (state expected monthly cost from Railway's pricing page).
2. Approve creating a Railway **`staging` environment** with its own small
   volume and app sleeping on (state expected cost).
3. Set variables (Noe or explicit approval): `OMEGA_BACKUP_KEY` (save it in a
   password manager too), `OMEGA_BACKUP_S3_*` for prod; for staging:
   separate `BETTER_AUTH_SECRET`, vault key, `OMEGA_BACKUP_KEY`,
   `OMEGA_ENV=staging`, `OMEGA_OUTBOUND_DISABLED=1`, `NOSTEROS_BASE_URL=https://staging.os.noepenaa.com`.
4. GoDaddy: CNAME `staging.os` → the staging Railway domain.
5. Add the staging callback URLs to the Google/Meta/Etsy apps only if
   connectors need testing on staging (optional; can wait).
6. Production deploy approval for Batch 0 + Batch 1.
After Noe's actions: run one real production backup and a restore drill into
a scratch dir on staging; record both in M8's Report.

---

## Batch 2: Business Profile + AI/spend foundation

### Step 2A: M9 Business Profile (entire spec)
Order: prompt constant → parser + alias table → secret guard → Zod schemas →
repo (`business_profiles`) → API routes → page `/settings/business-profile`
(Step 1 copy / Step 2 paste or upload / Step 3 checklist + save, current
view, versions) → `profileForPrompt()` → fixtures in
`tests/fixtures/business-profile/` (one complete, one with gaps, one with
an injection attempt, one with a fake secret).
Acceptance per M9 "Done when". Staging smoke: save a fixture profile in a
staging workspace, restore an older version.

### Step 2B: Shared foundations for M10/M11 (subset of M10)
> **Superseded in part (Oct 6):** the ledger lives in `DATA_DIR/platform/spend.db`, not a
> workspace table. Follow "Claude decision (Oct 6, 2026)" at the end of M10 for schema,
> reservation algorithm, pools/caps and the M7 boundary.
- `lib/spend/ledger.ts` + workspace table `spend_ledger`
  (`id`, `feature`, `provider`, `estimated_usd`, `actual_usd`, `status`:
  reserved|committed|released, `month`, `created_at`) and monthly cap lookup
  (workspace preference `spend.monthlyCapUsd`, default 0 for paid providers)
  plus global `OMEGA_LEAD_GLOBAL_MONTHLY_USD` (missing = 0 = no paid calls).
  Reservation must be atomic (single SQLite transaction with `BEGIN IMMEDIATE`).
  Threshold alerts at 50/80/100% recorded once per threshold per month.
- `lib/ai/lead-ai.ts`: provider selection (BYO OpenAI → BYO Anthropic →
  platform if `OMEGA_PLATFORM_AI=1` → none), JSON-mode call helper with Zod
  validation, one retry with the validation error, metering into `/usage`
  and the ledger. Model IDs from env with defaults = each vendor's current
  smallest model; verify IDs against vendor docs and record them.
- `lib/leads/signals.ts`: the fixed signal catalog from M10 Decision 4, with
  a description and detector contract (input facts → boolean) per signal.
- Tests: ledger concurrency (two reservations racing past cap → one refused),
  release on failure, alerts once; provider order; invalid JSON → retry →
  `null` result; metering recorded; no network in tests (mock fetch).
No UI in 2B except a hidden dev route is NOT allowed. Foundations only.

### Noe actions likely
- None required. Optional: confirm a workspace AI key (OpenAI or Anthropic)
  is verified in nosterCodes so Batch 3 can test the AI path on staging.

---

## Batch 3: Lead Plan UI + engine skeleton

### Step 3A: M10 remainder: plan, questions, preferences
- `lib/leads/questions.ts` (gap → question templates, defaults, max 6,
  ≤2 custom), `lib/leads/plan.ts` (rules plan; AI plan via `lead-ai`;
  merge with preferences, preferences win), tables `lead_plans`,
  `lead_preferences`, repos + Zod.
- Page `/leads/plan`: Generate → questions card (Skip allowed) → plan view
  with inline edits → Activate (owner/admin). Show provider used + cost.
- "Profile changed, review plan" banner when profile version > plan's.
- Tests per M10 list. Staging smoke: rules-only plan with no AI key, then
  AI plan if a BYO key exists on staging.

### Step 3B: M11 job runner + flags + Foursquare source
- Tables `lead_runs`, `lead_jobs` with unique `(run_id, stage, item_key)`.
- `lib/leads/runner.ts`: per-tick budget (25 items / 20 s), round-robin across
  allowlisted workspaces, retries with backoff (1 min, 10 min, 1 h), max 3.
- Flags `OMEGA_LEAD_ENGINE`, `OMEGA_LEAD_ENGINE_WORKSPACES`; "private beta"
  empty state when off; "Run now" (owner/admin, 3/day).
- `scripts/places-import.ts` (`npm run places:import -- --bbox ...`): read
  the current Foursquare OS Places Parquet release for the bbox only, write
  `/data/shared/places.db`, refuse > 60 MB, store release date. Use a
  Parquet reader dependency only if pure-JS or prebuilt and MIT/Apache.
  Record the license text location and attribution string.
  Rio Grande Valley bbox to start: `-98.60,25.84,-97.10,26.65` (verify it
  covers Hidalgo, Cameron, Willacy, Starr counties; adjust and record).
- `lib/leads/sources/foursquare.ts` implementing `LeadSource`.
- Tests: runner resume/idempotency/round-robin/backoff; import refuses
  oversize; source returns normalized rows for a fixture DB.
- Staging: run the import for the RGV bbox on staging (read-only public
  data download; allowed) and record row count + file size.

### Noe actions likely
- Confirm nosterCodes workspace ID for `OMEGA_LEAD_ENGINE_WORKSPACES` and
  set `OMEGA_LEAD_ENGINE=1` on staging (variable change = Noe).

---

## Batch 4: Clean inputs + website reader (security-critical batch)

### Step 4A: Dedupe + suppression
- Normalizers: domain (lowercase, strip `www.`, punycode), phone (E.164, US default).
- Workspace table `suppression`; control.db `global_suppression`
  (SHA-256 + `OMEGA_SUPPRESSION_PEPPER`; missing pepper → refuse to write, report).
- 30-day "seen" rule; exclusions from plan (keywords, franchises, domains).
- Tests per M11 §2 and "Suppression" bullet.

### Step 4B: Site reader (M11 §3), tests first, all of them
- `lib/leads/net/safe-fetch.ts`: DNS resolve → IP range blocklist (v4+v6,
  incl. `0.0.0.0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`,
  `192.168/16`, `224/4`, `::1`, `fc00::/7`, `fe80::/10`, IPv4-mapped v6) →
  connect to pinned IP with SNI/Host of the original name → manual redirects
  (≤3, same registrable domain, re-resolve and re-check each) → timeout 8 s,
  1 MB cap, `text/html` only, no cookies.
- `lib/leads/robots.ts` (24 h cache, honors `OmegaOSBot` and `*`),
  per-domain 1 req/s limiter.
- `lib/leads/site-reader.ts`: page selection (home + contact/about/services/
  booking, max 5), extractors (emails, phones, socials, booking tools list,
  HTTPS, viewport, newest year, contact form), facts with source URL + date.
- Public `/bot` page (no auth) explaining the crawler and opt-out
  (opt-out = email or robots.txt; the page text is short and factual; mark it
  for Noe's review as public copy).
- Shared cache `/data/shared/public-cache.db` (domain-keyed, 30-day TTL,
  no workspace columns; test asserts schema).
- Tests: every SSRF case in M11 Tests list + IPv4-mapped IPv6 + decimal/octal
  IP hostnames (`http://2130706433/`) + redirect chains; extractor fixtures
  for 10 real-world-shaped HTML pages saved under `tests/fixtures/sites/`.
- **Claude review required before Batch 4 reaches production.** If Claude is
  unavailable, Noe decides whether to wait; staging is fine meanwhile.

### Noe actions likely
- Set `OMEGA_SUPPRESSION_PEPPER` on staging and production.

---

## Batch 5: Scoring + leads screen

### Step 5A: Scoring + decision maker + email check
- `lib/leads/detect.ts`: facts → catalog signals (pure).
- `lib/leads/score.ts`: weights → 0–100, `score_version`, reasons.
- M11 §3b: decision-maker extraction (stated names only), free email check
  (syntax, MX/A via DNS, disposable list bundled as data, role flag), business
  name cleanup.
- Tests: deterministic scores for fixed fixtures; MX check mocked; no invented names.

### Step 5B: `/leads` page + pipeline wiring for free stages
- Wire stages 1→2→3→4 in the runner for the Foursquare source.
- `/leads`: table, filters, drawer with facts + sources + score reasons,
  "Not a fit" → suppression, CSV export (owner/admin), Foursquare attribution
  footer, empty states (no profile → link M9; no active plan → link M10;
  engine off → private beta).
- Staging run: nosterCodes active plan, RGV extract, no paid keys, no AI.
  Record: leads found, % with website, % with free email, hot count, run time.

### Noe actions likely
- Look at 20 staging leads and say whether the hot ones look right. This
  is the first quality checkpoint. Weights may be tuned from your feedback.

---

## Batch 6: More sources

### Step 6A: Google Places (New) source
- Before coding: re-read current Google Maps Platform Service Specific Terms
  and Places API policies; quote the caching rule (≤15 words) in the report.
  If it differs from M11, stop.
- `lib/leads/sources/google-places.ts`: Text Search with minimal field mask,
  key from workspace vault (Advanced connector "Google Maps API key", with
  M6f-style verification) or `OMEGA_GOOGLE_PLACES_KEY`.
- Free-call counter per SKU/month vs `OMEGA_GOOGLE_PLACES_FREE_CALLS`
  (default 900); 30-day expiry job blanks non-place_id content; never
  writes Google content to the shared cache.
- Tests per M11 Google bullet.

### Step 6B: OpenStreetMap Overpass source + source merge
- `lib/leads/sources/overpass.ts`: one query per city per run, 25 s timeout,
  ODbL attribution, polite User-Agent.
- Merge logic: same business from multiple sources → one lead (domain >
  phone > name+address similarity ≥ 0.9), keep each source's IDs.
- Staging run with all free sources; record coverage gain vs Batch 5 numbers.

### Noe actions likely
- Optional: create a Google Cloud Maps key restricted to Places API (New)
  and the Railway egress, with a Google-side daily quota; set
  `OMEGA_GOOGLE_PLACES_KEY` (staging first). Without it, 6A ships but stays idle.

---

## Batch 7: Paid upgrade + personalization + reporting

### Step 7A: Paid email upgrade (off by default)
- Advanced connectors "Anymail Finder" and "Hunter" with M6f verification
  (key format check + a free account/usage endpoint, never a paid lookup).
- `lib/leads/enrich/email-finder.ts`: only hot + domain + no usable free
  email; ledger reserve → call → commit/release; store provider confidence.
- Tests: never runs at cap 0; concurrency; alerts; no call without reservation.

### Step 7B: Personalize + Funnel + Usage
- Batches of 10 hot leads through `lead-ai`; `factUsed` must match a passed
  fact; template fallback with no AI; metered `lead_personalize`.
- Funnel: hot leads appear in first column via new repo method; seeded demo
  only when workspace has zero leads.
- `/usage` "Lead engine" section: calls per provider, free allowance used,
  paid spend vs caps, AI spend.
- Staging run: full pipeline with template openers (and AI if a BYO key
  exists). Final M11 numbers in the report.

### Noe actions likely
- Decide paid cap for nosterCodes (default $0). If >$0: Noe adds the
  Anymail Finder/Hunter key in the app and sets `OMEGA_LEAD_GLOBAL_MONTHLY_USD`.
- Production approval for Batches 2–7 together or in pieces (Noe's call).

---

## Batch 8: Outreach drafts + compliance (M12 part 1)

### Step 8A: Templates, merge engine, compliance block, unsubscribe
- `outreach_templates` (versioned), fixed merge fields, unknown field blocks save.
- Compliance footer + `List-Unsubscribe` headers built by one function that
  every send path must call (test enforces).
- Unsubscribe: signed token (HMAC with `OMEGA_UNSUBSCRIBE_SECRET`, scoped to
  workspace + recipient hash + purpose), public page + one-click POST,
  suppresses immediately. **Footer and unsubscribe page wording = legal text:
  draft it, list it in the report for Noe's approval.**
- Tests per M12.

### Step 8B: Draft generation + approval queue
- Drafts from template + lead facts + opener, stored with lead + template version.
- `/leads/outreach`: approve / edit+approve / skip / not a fit; bulk ≤25 with
  confirm. Approval records (`user`, `time`, `template_version`).
- Everything still blocked by the outbound guard (no sending code yet).

### Noe actions likely
- Approve legal text. Set `OMEGA_UNSUBSCRIBE_SECRET`. Enter the nosterCodes
  mailing address (PMB/virtual mailbox recommended over a home address) in the plan.

---

## Batch 9: Sending + replies (M12 part 2)

### Step 9A: SMTP send path, caps, pacing
- Uses the workspace's verified email connection; `assertOutboundAllowed`,
  approval record, suppression (workspace + global), compliance block,
  daily cap (20/day first 14 days, ≤40 after, hard max 50), 2–6 min spacing,
  Mon–Fri 8–5 in lead's timezone. All enforced in one `sendGuard()` with
  tests for each refusal reason.
- `outreach_messages` audit table; body retention 90 days then hash only.
- DNS checklist (SPF/DKIM/DMARC lookups, read-only) on the outreach settings page.
- Test with a local SMTP fixture server only.

### Step 9B: Replies, bounces, follow-ups
- IMAP poll every 15 min on sending days; match `In-Reply-To`/`References`;
  OOO detection delays; DSN parsing for hard/soft bounces; 3 hard bounces/day
  pauses the mailbox + alert.
- Follow-ups ≤2 at +3 and +7 business days, cancelled by reply/bounce/unsub.
- Funnel moves: Replied → "Conversation".

### Noe actions likely
- Buy/choose a separate sending domain and mailbox, add SPF/DKIM/DMARC
  (Noe), connect the mailbox in OmegaOS (Noe enters credentials).

---

## Batch 10: Learn + launch gate (M12 part 3)

### Step 10A: Outcomes + feedback
- Outcome buttons per lead; reply rate by signal and by angle on `/leads`;
  "Suggest weight changes" → proposal Noe/owner accepts into preferences.

### Step 10B: Rules toggle + production launch checklist
- Auto-send rules (default off), invalidated by template change, rule ID on
  every message.
- Write `docs/handoff/LEADGEN-LAUNCH-CHECKLIST.md`: backups green, staging
  run numbers, legal text approved, DNS green, caps set, suppression
  pepper/unsubscribe secret set, mailbox warm-up plan.
- Ask Noe for the **first production send: 5 approved emails** from the
  nosterCodes sending domain. Record Noe's approval quote, results, and any
  replies/bounces in M12's Report.

---

## After Batch 10 (not specced yet; write specs first, per ARCHITECT-FALLBACK)
- M7 sign-in-first connections (spec on branch `m7-sign-in-first`); can be
  slotted between batches if Noe asks.
- M13 legal pages (privacy, terms, data deletion), then Google OAuth
  verification and Meta app review submissions.
- M14 plan limits for client workspaces (leads/month, paid cap, mailboxes,
  AI budget) before lead gen is offered to clients.
- Optional: "local AI" (Ollama) setting for Noe's own PC copy only.

## Quick map: batch → Noe gate
| Batch | Steps | Must Noe act before the next batch? |
|---|---|---|
| 0 | preflight | no |
| 1 | backups, staging code | yes: bucket, staging env, variables, DNS |
| 2 | profile, AI/ledger base | no |
| 3 | plan UI, runner + Foursquare | yes: engine flag + workspace ID on staging |
| 4 | dedupe, site reader | pepper variable; Claude review before prod |
| 5 | scoring, /leads | quality check of 20 leads |
| 6 | Google, Overpass | optional Google key |
| 7 | paid upgrade, openers | paid cap decision; prod approval |
| 8 | templates, approvals | legal text, secret, mailing address |
| 9 | sending, replies | sending domain + mailbox |
| 10 | outcomes, launch | first 5-email send approval |

## Report

### Batch 0 report: October 5, 2026, 19:02 CDT
- Steps: A queue handoff docs = done; B baseline checks + disk-usage observation = done.
- Branch / last implementation commit: `lg/b0-docs` @ `5c8d861`; report commit follows.
  Base: local main `52dad03` (Etsy report), origin/main `d4d4689`; fetch/pull ff-only
  confirmed current. Application code is unchanged from main for this baseline.
- Typecheck: clean. Tests: 376 files, 369 passed / 7 failed; 3,925 tests,
  3,921 passed / 4 failed. Only known Windows baseline failures: interaction-layer
  (BrainCore path), paths, skills-plugins, superset-dispatch; EPERM cleanup suites
  lead-magnet-actions, lead-magnets-route, roadmap-mock-5h. No baseline fixes made.
- Build: passes using `.next-lg-b0` and `.local/lg-b0-build-data`; shared dev server
  on 4100 untouched. Removed only generated tsconfig includes after completion.
  Logs: `.local/lg-b0-test-output.txt`, `.local/lg-b0-build-output.txt` (not committed).
- Disk: Railway production service DISK_USAGE_GB current/max 0.060473344 GB over
  61 samples in the prior hour, about 60.5 MB / 12.1% of the documented 500 MB cap.
  This is service disk telemetry, not a separate filesystem inventory of /data;
  no threshold breach indicated. No data added or removed.
- Staging: not deployed; environment/resources not provisioned by this batch.
- Noe actions needed: 1. Say "continue" to start Batch 1. Infrastructure approvals
  and exact costs will be requested in Batch 1's report before provisioning anything.
- Decisions beyond spec: grouped preflight's three numbered items into two steps
  (docs; baseline plus disk). Current chat explicitly says stop after every batch,
  so it overrides Batch 0's written no-wait exception. Batch 1 has not started.
- Self-review: docs-only diff; no credential patterns found; no routes, schemas,
  network code, dependencies, legal copy or security behavior changed. Other-session
  provider handoff files left untouched. Only this branch is authorized for push.
- Risks / open questions for Claude: no new engineering blocker; Windows baseline
  is not a Linux verification. Fallback architect authority has not been activated.
- Ready for production? No production release requested; queue/preflight only.
  Main/production untouched; Batch 0 docs remain for the later Batch 1 approval.
