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
