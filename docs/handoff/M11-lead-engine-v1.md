# M11: Lead Engine v1 (find → read site → score → enrich → personalize)

Status: ready after M10
Review by Claude: yes (outbound fetching/SSRF, third-party terms, spend caps)
Rollout: feature flag, nosterCodes workspace only at first

## Goal
Automate prospecting the way zero-gtm does, inside OmegaOS, with free steps
first and paid steps last and capped. The active Lead Plan (M10) drives
scheduled jobs that find local businesses, read their websites, score them
with the plan's signals, optionally upgrade the best few with a paid email
lookup, and write short personalized openers. Results land in `/leads` and in
the Funnel's first column. **Nothing is sent in M11** (M12 handles sending).

## Pipeline (each stage is a resumable job step)

| # | Stage | Cost | Notes |
|---|---|---|---|
| 1 | Find | free | Providers below, per target × city × query |
| 2 | Dedupe + suppress | free | place ID, normalized domain, phone; suppression + existing clients + exclusions |
| 3 | Read website | free | Own fetcher, ≤5 pages per site |
| 4 | Score | free | Deterministic, from plan signals; reasons stored |
| 5 | Upgrade (optional) | paid, capped | Top leads only, BYO key, ledger-reserved |
| 6 | Personalize | ~free, capped | Small model, batches of 10, hot leads only |
| 7 | Publish | free | `/leads` + Funnel "New lead"; weekly summary in-app |

## Decisions already made

### Job runner
- Workspace table `lead_runs` (one per scheduled run) and `lead_jobs`
  (`run_id`, `stage`, `item_key`, `state`: queued|running|done|failed|skipped,
  `attempts`, `next_attempt_at`, `error_code`). Every stage is idempotent and
  keyed so a crash or redeploy resumes without duplicates.
- Driven by the existing internal tick: each tick processes a bounded batch
  (default 25 items, max 20 s wall time) across workspaces, round-robin, so
  one workspace can't starve others. Max 3 attempts with backoff, then `failed`.
- Schedule from preferences: `daily` (default) or `weekly`; the run stops
  when the plan's `weeklyLeadTarget` is reached.
- Flags: `OMEGA_LEAD_ENGINE=1` globally plus workspace allowlist
  `OMEGA_LEAD_ENGINE_WORKSPACES` (comma-separated IDs). Off = UI explains it's
  in private beta.
- "Run now" button for owner/admin, rate-limited to 3 per day.

### 1. Find providers (`lib/leads/sources/`, interface `LeadSource`)
- **Foursquare OS Places** (default, free, Apache-2.0, storable): an import
  script `npm run places:import -- --bbox <minLon,minLat,maxLon,maxLat>`
  loads only the requested region from the published Parquet release into
  `/data/shared/places.db` (name, category, address, lat/lon, website, phone,
  fsq id, date refreshed). Hard cap 60 MB for this file; the script refuses
  bigger extracts. Start with the Rio Grande Valley bounding box. Show the
  required attribution in `/leads` footer. Refresh monthly (manual script for now).
- **Google Places API (New) Text Search**: uses a Google Maps key from the
  workspace vault (Advanced, BYO) or the platform key `OMEGA_GOOGLE_PLACES_KEY`
  when set. Always send a field mask with only the fields we use. Respect
  Google Maps Platform terms: store the Google `place_id` indefinitely; any
  other Places content (name, phone, rating, review count, address) is kept
  on the workspace lead record for at most 30 days, then refreshed through the
  API or blanked; it is **never** written to the shared cache. Before coding,
  Astra re-reads the current Maps Service Specific Terms and records the
  caching rule it implemented in the Report; if the terms differ from this
  spec, stop and report.
- **OpenStreetMap Overpass** (free, ODbL): optional gap-filler for
  name/website/phone; attribution required; one request per city per run, 25 s timeout.
- **Not supported:** scraping Google Maps directly or via scraper APIs
  (RapidAPI "Maps scraper" listings and similar). It breaks Google's terms and
  would put a client-facing product at risk. Don't add a provider for it.
- Each provider declares its cost per call; the free ones declare 0. Google
  calls are counted per SKU against the free monthly allowance configured in
  `OMEGA_GOOGLE_PLACES_FREE_CALLS` (default 900, safely under Google's free
  cap), and the engine stops using Google for the month when reached unless
  the workspace raised its paid cap.

### 2. Dedupe and suppression
- Keys: provider place IDs, normalized domain (lowercase, no `www.`),
  E.164 phone. A lead seen by this workspace in the last 30 days is skipped.
- `suppression` table per workspace (domain, email, phone; reason:
  unsubscribed|bounced|complaint|client|manual) checked here and again in M12.
- Platform-wide `global_suppression` in `control.db` for complaints and
  hard bounces only (emails hashed with SHA-256 + a platform pepper), so a
  person who complained to one workspace isn't emailed by another.

### 3. Website reader (`lib/leads/site-reader.ts`), the security-critical part
- Only `http`/`https`, ports 80/443. Resolve DNS first and reject private,
  loopback, link-local, CGNAT, multicast, and metadata ranges (IPv4 and IPv6);
  connect to the resolved IP (pin it) to stop DNS rebinding. Re-check on every redirect.
- Max 3 redirects; must stay on the same registrable domain, except one
  hop from http→https.
- 8 s timeout per request, 1 MB body cap, `text/html` only, no JavaScript
  execution, no cookies, no forms submitted.
- User-Agent `OmegaOSBot/1.0 (+https://os.noepenaa.com/bot)`; add a small
  public `/bot` page explaining what it is and how to opt out. Obey
  `robots.txt` (cache it 24 h). Max 1 request/second per domain and 5 pages
  per site: home, plus the first matches for contact, about, services, booking.
- Extract: emails (`mailto:` and text; drop images-as-text, obfuscated
  ones stay unparsed; prefer addresses on the site's own domain; drop
  `noreply@`, sentry/wix/example placeholders), phones, social profile URLs
  (Facebook, Instagram, TikTok, LinkedIn, YouTube, X), booking tool detection
  from a fixed list (Calendly, Acuity, Square Appointments, Vagaro, Booksy,
  Fresha, Mindbody, GlossGenius, Housecall Pro, Jobber, ServiceTitan), HTTPS,
  viewport meta, newest year mentioned, contact form present.
- Page text never goes to the AI raw: only extracted facts (≤10 short strings,
  each ≤200 chars, wrapped and escaped like `profileForPrompt`).
- Output cached in the **shared** public cache (below); every fact stores its
  source URL and fetch date so the UI can show where it came from.

### Shared public cache
- `/data/shared/public-cache.db`: website-derived public business facts
  keyed by normalized domain, plus Foursquare/OSM rows. 30-day TTL.
- Contains no workspace IDs, no scores, no notes, no Google Places content.
  Workspace lead lists, scores, drafts, and outcomes stay in the workspace DB.

### 4. Scoring (`lib/leads/score.ts`)
- Pure function: signals detected (catalog from M10) × plan weights,
  normalized 0–100. Stores `score`, `score_version`, and `reasons[]`
  (e.g. "No booking tool found (+3)"). Hot = score ≥ `hotThreshold`.

### 5. Paid upgrade (optional, off by default)
- Interface `EmailFinder` with adapters for Anymail Finder and Hunter,
  BYO key only (Advanced connector with M6f verification). Runs only when the
  lead is hot, has a domain, and no usable email was found on the site.
- Each call reserves its estimated cost in `lib/spend/ledger.ts` against
  the workspace monthly cap (preference, default $0) and the global
  `OMEGA_LEAD_GLOBAL_MONTHLY_USD`. Over cap → stage `skipped` with reason.
- Alerts in-app at 50 / 80 / 100 % of each cap (once per threshold per month).
- Found emails are labeled with the provider and its confidence; never
  guessed or pattern-generated by OmegaOS.

### 6. Personalize
- Uses `lib/ai/lead-ai.ts` (M10 order: BYO key → platform → none). With no
  AI, use a template opener from the chosen angle with the lead's real facts.
- Batches of 10 hot leads, JSON output: `{ leadId, opener (≤240 chars),
  factUsed }` where `factUsed` must equal one of the facts we passed in;
  otherwise the opener is dropped. No claims about the business we didn't extract.
- Metered under feature tag `lead_personalize`, capped by the same ledger.

### 7. Publish
- `/leads` page: table (business, city, score + reasons, contact found +
  source, stage), filters (hot only, has email, target), lead drawer with
  facts and their sources, "Add to Funnel", "Not a fit" (adds to suppression
  with reason manual), CSV export (owner/admin).
- Hot leads auto-appear in the Funnel's first column as "New lead".
  The Funnel reads through a new repo method; seeded demo nodes stay for
  workspaces with no leads.
- `/usage` gets a "Lead engine" section: calls per provider, free allowance
  used, paid spend vs caps.

## Do
Implement the above in small commits in this order: job runner + flags →
Foursquare import + source → dedupe/suppression → site reader (with its tests
first) → scoring → `/leads` UI → Google source → Overpass → paid upgrade →
personalize → Funnel + Usage. Deploy each step to **staging** (M8) freely.

## Tests (minimum)
- Job runner: resume after crash, idempotent keys, bounded batch, round-robin, retries/backoff.
- Site reader: rejects `127.0.0.1`, `10.x`, `169.254.169.254`, `::1`,
  `fd00::/8`, DNS that resolves private, redirect to private, cross-domain
  redirect, >1 MB, non-HTML, robots disallow; extracts emails/phones/socials/
  booking tools from fixtures; filters placeholder emails.
- Google adapter: field mask sent; non-place_id content expires after 30 days;
  never written to shared cache; free-call counter stops at the limit.
- Scoring: deterministic with fixed inputs; reasons match weights.
- Ledger: concurrent reservations can't exceed cap; alerts fire once per threshold.
- Personalize: opener dropped when `factUsed` not in provided facts; injection
  text in site facts doesn't change output schema; template fallback without AI.
- Isolation: workspace A can't read B's leads; shared cache has no workspace columns.
- Suppression: suppressed domain/email never becomes a lead again.

## Stop rules
- Any paid key, platform Google key, or global cap value: Noe sets them.
- If Foursquare's data license or Google's caching terms differ from this
  spec when checked, stop and report.
- Volume usage: if `/data` would exceed 80 % of 500 MB, stop and report
  (Noe may need to approve a bigger volume).

## Don't
- No sending, no email drafts in Funnel yet (M12).
- No headless browser, no CAPTCHA solving, no login-walled pages, no personal social profiles.
- Don't store personal data beyond business contact info published on the business's own site.

## Done when
- typecheck, tests (minus the Windows baseline), build pass.
- On staging, with the RGV Foursquare extract and no paid keys: a run for
  nosterCodes' active plan produces scored leads with reasons and sources,
  hot leads show openers (template or AI), and `/usage` shows $0 paid spend.
- Report includes: leads found, % with website, % with an email found free,
  hot count, run time, AI cost. These real numbers decide whether paid
  steps are worth turning on.

## Report (Astra fills this in)
- Status:
- Commits:
- Typecheck / tests / build:
- Terms checked (Google caching rule, Foursquare license) and what was implemented:
- Staging run numbers:
- What changed beyond the spec, and why:
- Questions or blockers for Claude:

### Batch 3B preflight: October 6, 2026, 11:38 CDT
- BLOCKED before runner/import implementation. 3A is a partial code checkpoint;
  its outstanding tests/browser checks are recorded in M10, not claimed complete.
- Checked official Foursquare access documentation and the publisher's dataset card:
  https://docs.foursquare.com/data-products/docs/access-fsq-os-places
  https://huggingface.co/datasets/foursquare/fsq-os-places/blob/main/README.md
- Apache-2.0 is still the stated data license. Access is no longer the assumed
  anonymous public S3 release: official docs direct users to a Places Portal
  account/token and Iceberg catalog. The publisher's Hugging Face alternative is
  gated; current card points to release/dt=2026-09-15/places/parquet/*.parquet.
- Hugging Face gate requests organization/title/country/intended use and consent
  to using the organization's name/logo in partner descriptions/marketing.
  No account, access token, consent or download was created/submitted.
- Noe decision: approve a specific data-access route and any corresponding terms
  before obtaining credentials. No purchase requested; no paid service provisioned.
- Claude decision: select an approved access/import contract (Portal Iceberg vs
  authorized Parquet files), then confirm whether to split runner from importer
  while access is pending. Do not silently replace the source or use an old mirror.
- hyparquet was investigated as a possible pure-JS MIT reader, not installed.
  Bounding-box verification, 60 MB import enforcement and source fixture tests
  remain unimplemented, as do jobs/runner/flags/Run now; no staging row count exists.
- Staging is still not provisioned. Engine flags, workspace allowlist, credentials,
  spending caps and shared/production data remain untouched. No real lead searching.

### Claude scope decision, October 6, 2026 (relayed by Noe)
- Build runner, flags, Run now, LeadSource and local Parquet fixture now.
- hyparquet is approved if no install scripts; do not obtain Foursquare access,
  accept terms, use mirrors or use the declined Hugging Face route.
- Move Overpass from Batch 6 into 3B: one query per city/run, 25s timeout,
  ODbL attribution and polite User-Agent. Noe handles Places Portal access.
- Request review after Batch 3. No production approval granted.

### Batch 3B report: October 6, 2026, 13:22 CDT
- COMPLETE for the narrowed code/fixture scope, awaiting review. Source/import
  commit 9221995; runner/API/UI commit 76142ff on lg/b3-plan-engine.
- Workspace lead_runs/lead_jobs persist idempotent schedule/item keys, attempts,
  backoff, lease ownership, interrupted recovery and public candidate results.
  Old lease owners cannot complete; stale plans/profiles do not run.
- Internal-only tick wiring preserves the existing JSON response contract.
  Flags default off with explicit workspace allowlist; round-robin bounded to
  25 jobs / 20s, in-process overlap guard, 3 manual runs/UTC day, weekly cap
  checked again atomically on completion. No paid provider or sending stage.
- Owner/admin POST /api/leads/runs queues only; viewers read status. Session,
  origin, role, active workspace/header and profile checks covered by tests.
  /leads/plan shows private-beta state, Run now, recent runs and attribution.
- Overpass uses fixed HTTPS endpoint, no redirects, one POST query/city/run,
  server timeout 25s (runner aborts at its stricter 20s), 2 MiB response cap,
  escaped city/state, bounded elements and rejection of ambiguous cities.
  Dispatched Overpass jobs are not retried within that run, including crashes;
  other retryable jobs get at most 3 attempts with 1m/10m backoff.
- Sources currently return raw city-boundary candidates, not qualified leads.
  Search phrases are retained on jobs; category/radius filtering, suppression,
  scoring, website reading and publication remain later steps. UI states limits.
- Parquet importer accepts an explicit LOCAL authorized file, bbox and release
  date; no remote downloader/token use. Only public fields go to shared/places.db.
  60 MiB file cap and 80% of 500 MiB data-volume guard; atomic publication refuses
  replacement of existing imports. Monthly refresh needs a reviewed replacement
  procedure rather than silently deleting existing data.
- Synthetic original two-row fixture imports exactly 1 row inside bbox and
  excludes the outside row. Tests validate date, source output, storage refusal,
  preserved existing import, no workspace column and no network import.
  No full RGV extract, live Overpass request, staging counts or lead quality
  metrics claimed. Staging infrastructure remains unprovisioned.
- Dependency: hyparquet 1.31.2 pinned, pure JS, MIT, no dependencies and no
  preinstall/install/postinstall scripts. Installed with --ignore-scripts.
  Package contains maintainer prepare=build:types; this did not execute.
  No new account, access request, third-party terms or name/logo consent.
- Source references: https://github.com/hyparam/hyparquet and
  https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL . Prior Foursquare
  access/license findings above still apply; no Google Places work in this batch.
- Typecheck and isolated build PASS. Full suite: 399/406 files pass; 4,068/4,072
  tests pass, only documented Windows baseline failures (see M10 report).
  18 new 3B tests cover adapters/import, jobs, API and runtime; existing tick
  tests additionally assert discovery executes only after internal auth.
- Browser real local queue PASS plus M10 acceptance. No fixture job executed
  a live source; background tick/outbound disabled and no vault keys supplied.
- Review requested for source limits, leases/retries, cap behavior, workspace
  boundaries and dependency. No main push/deploy, configuration/credential/cap
  changes, real emails, purchases or edits to existing business data.

### Places Portal follow-up: October 6, 2026, 13:34 CDT
- Noe says the Portal token is set as OMEGA_FOURSQUARE_PLACES_TOKEN and
  authorizes wiring the importer and a first RGV import after fixture tests.
- Railway describe-service confirms that VARIABLE NAME exists on production
  nosteros-web; no variable values fetched, echoed, logged or saved.
- Official access docs and public Portal OS Places > Access Data > DuckDB
  inspected: https://docs.foursquare.com/data-products/docs/access-fsq-os-places
  and https://places.foursquare.com/dataset/OS%20Places/details .
- Portal specifies DuckDB >=1.4.0, httpfs, an in-memory ICEBERG secret, catalog
  https://catalog.h3-hub.foursquare.com/iceberg, warehouse places and table
  places.datasets.places_os. This is not a bearer-authenticated Parquet URL.
- Current approved hyparquet reader handles local Parquet only, not Iceberg
  catalog/manifest planning. No DuckDB/Iceberg dependency is approved or installed.
- STOP for architect dependency/runtime decision under AGENTS.md. Proposed:
  dedicated import-only DuckDB adapter, pinned engine/extensions, no persistent
  secret, bounded regional query/export, then existing guarded SQLite importer.
  Never pass token in CLI arguments, print raw SQL/provider errors, or persist it.
- Runtime execution also unresolved: Railway tools expose no remote command
  execution, local Railway CLI is absent, and Batch 3 code is not on production.
  Do not deploy the whole unreviewed batch or provision a paid service to run it.
  Need reviewed one-off execution/transfer plan with existing volume limits.
- Existing local-fixture checks rerun: 2 files / 6 tests PASS; synthetic bbox
  import selects 1 row. These are NOT real RGV import numbers.
- Real RGV import NOT RUN: row count and file size unavailable, not zero.
  No new code/dependency/account, secret read, terms acceptance, data write,
  Railway setting or production deployment. Existing data/server preserved.

### Step 3C report: Places Portal import, October 7, 2026 (Claude Code)
- READY FOR REVIEW on branch lg/b3c-places-portal. NOT deployed; the real RGV import has NOT run.
  Noe will press "Import RGV places" himself after review and deploy.
- Dependency: @duckdb/node-api 1.5.6-r.1 pinned exact (Noe approved, Oct 7). MIT. It and
  @duckdb/node-bindings (+ per-platform binary packages) have no install scripts; installed with
  --ignore-scripts. Linux x64 binary is about 71 MB unpacked. Added to serverExternalPackages.
- Recipe follows the Portal's official DuckDB page (Access Data > DuckDB, checked Oct 7):
  httpfs, CREATE SECRET (TYPE ICEBERG, TOKEN), ATTACH 'places' (TYPE iceberg, ENDPOINT
  https://catalog.h3-hub.foursquare.com/iceberg), table places.datasets.places_os.
- lib/leads/places-portal.ts (import-only): in-memory DuckDB, memory_limit 512MB, threads 2,
  unsigned and community extensions off, autoinstall/autoload off, extension dir in a private temp
  folder. Only INSTALL/LOAD httpfs and iceberg. CREATE TEMPORARY SECRET is the only statement with
  the token; token read from OMEGA_FOURSQUARE_PLACES_TOKEN inside the function and shape-checked.
  lock_configuration=true before any catalog query. Secret dropped, catalog detached, connection
  and instance closed in finally; temp folder removed. Every failure is a fixed code; DuckDB
  messages are discarded (they can echo statement text).
- Query: country='US', region='TX', RGV bbox -99.20,25.84,-97.10,26.80, date_closed IS NULL,
  excluding unresolved_flags closed/delete/privatevenue/doesnt_exist. Public fields only:
  fsq_place_id, name, latitude, longitude, locality, fsq_category_labels, address, website, tel.
  COUNT dry run first; refuses over 200,000 rows or an estimated 60 MiB, or an 80%-volume breach.
  Exports snappy Parquet to temp, size-checked, then the existing guarded importer writes
  shared/places.db. 10-minute deadline interrupts DuckDB. Release date = import date (UTC); the
  Portal table has no release column.
- Importer: replacement only with replace=true (owner confirmation), atomic rename after the new
  file is complete; storage guard counts both files; refuses to publish an empty result. Any
  failure leaves the old import untouched.
- Job: single-flight (in-process + exclusive lock file shared/places-import.lock, stale after 20
  min), background run, status file shared/places-import-status.json (state, times, counts, fixed
  code; no user IDs or secrets). Logs carry counts or the code only.
- API /api/platform/places-import: GET status, POST {action:'import', replace} strict. Session,
  origin, owner role, platform owner (owner role + NOSTEROS_OWNER_EMAIL + bound operator
  workspace, now shared via lib/platform-owner.ts with backup status), workspace header, fresh
  re-check. 403 for everyone else; 409 busy / unconfirmed replace. No schedule or auto run.
- UI: PlacesImportPanel on /settings/platform under Backup status. Shows current count, date,
  size and last result; Replace needs a second confirm click; polls every 4s while running.
- Small fixes: profile parser says "No sections found. Copy your AI's answer as Markdown (use its
  copy button)" when no ## headings exist; a section is unknown only when its whole content is
  unknown; headings after a list get extra top space in the profile view. Overpass User-Agent
  contact confirmed noster@nostermarketing.com (Noe, Oct 7), now a tested constant.
- Test changes needing review: (1) business-profile fixture assertion business_contact_details
  unknown -> found ("Mailing address unknown." is one detail), per the brief. (2) connector-
  boundaries exempts app/api/platform/places-import/route.ts like leads/plan (platform-owner gate
  instead of apiOperatorWorkspace, which requires NOSTEROS_OPERATOR_FEATURES=1). (3) smoke-api
  lists the route with documented 403 for a non-owner.
- Verification: typecheck PASS; isolated build PASS with no Turbopack warnings (fs calls carry the
  repo's turbopackIgnore comment). Full Windows suite 4,087/4,095 before the two inventory fixes;
  after them all 9 touched files pass (169 tests). Remaining failures are the AGENTS.md baseline only
  (lead-magnet-actions, lead-magnets-route, roadmap-mock-5h, paths, skills-plugins,
  superset-dispatch, interaction-layer BrainCore.tsx:57). New tests: places-portal (10),
  places-import-api (7), profile/render/page additions. No live Portal, DuckDB or network calls.
- Open questions for review:
  a) /settings/platform requires NOSTEROS_OPERATOR_FEATURES=1 (operatorWorkspaceForPage), but
     production keeps it 0, so the panel (and the existing backup panel) is not visible in
     production. Recommend gating that page on isPlatformOwner alone; this changes the
     backup-status test "disabled operator gate returns unavailable". Not changed here.
  b) DuckDB's iceberg extension may need the official avro extension for manifest reading; with
     autoload off, the first run would fail with "provider". Approve adding avro to
     APPROVED_EXTENSIONS, or keep two and see. Not verified: it would require downloading extensions.
  c) Memory: Node heap is capped at 512 MB (NODE_OPTIONS) and DuckDB memory_limit is 512 MB on a
     1 GB container. Consider memory_limit 384MB if the first run is tight.

### Claude review of 3C (a1c5b68), October 7, 2026, relayed by Noe
- Design approved. Required changes, all made in the follow-up commit:
  1. /settings/platform gates on platformOwnerForPage (owner role + NOSTEROS_OWNER_EMAIL + operator
     workspace) and 404s everyone else, independent of NOSTEROS_OPERATOR_FEATURES (flag unchanged).
     Page shows only Backup status and the RGV import. Tests: owner sees exactly those two panels
     with flag 0 and 1; non-owners (admin, other email, other workspace, no owner email) get 404
     before any backup read; connector-boundaries checks the gate and 404; page smoke documents
     the 404 for its non-owner identity.
  2. APPROVED_EXTENSIONS = httpfs, iceberg, avro (only). Test pins the list and install order.
  3. DuckDB memory_limit 384MB. Test updated.
- Checks: typecheck PASS; isolated build PASS (no warnings); full Windows suite 4,092/4,097 tests,
  400/408 files; remaining failures are the AGENTS.md baseline only (interaction-layer
  BrainCore.tsx:57, lead-magnet-actions, lead-magnets-route, paths, roadmap-mock-5h,
  skills-plugins, superset-dispatch); smoke.test platform page fixed afterwards (test-only).
- Verdict: APPROVED FOR PRODUCTION once the checks pass (Claude, via Noe).
