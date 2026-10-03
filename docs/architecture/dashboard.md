# nosterOS dashboard architecture

Owner: Noe. Architect: Claude. Builder: Codex. Written Oct 3, 2026.
Level 5 build: every number across nosterCodes in one place, with history,
alerts, anomaly detection, forecasts, recommended actions, and read-only
dashboards Noe can share with clients.

## What it covers

Businesses (one shared database; a business is a dimension on every number):

| id                | what                                              |
|-------------------|---------------------------------------------------|
| `nostercodes`     | the parent; a rollup of the others, never stored  |
| `nostermarketing` | agency: site, Google Business Profile, leads, clients |
| `nosterhealth`    | SaaS                                              |
| `nosterlogistics` | SaaS                                              |
| `autopilot-store` | Etsy shop (Shopify maybe later)                   |

The pawn shop / eBay is out of scope. `lib/ventures.ts` (the upstream
"Vantage / Launchpad Cohort" lens) gets replaced by `lib/businesses.ts`.

Sections: Search & index, Money, Social, Ads, Funnel/leads, Actions.

## Rules every spec follows

1. **Honest numbers.** Reuse the contract in `lib/live-metrics.ts`:
   `null` means we couldn't read it, `0` means it really is zero. No seeded
   or demo values anywhere on the dashboard. Every number shows its source
   and an "as of" time, and goes visibly stale when its collector fails.
2. **Collect, store, render.** Collectors pull from APIs on a schedule and
   write to SQLite. Pages only read the store, never call external APIs while
   rendering. That keeps pages fast, stays under rate limits, and builds the
   history that trends, anomalies and forecasts need.
3. **One metric registry.** Every metric is declared once in code
   (`lib/metrics/registry.ts`): id, label, unit, source, which businesses,
   how it rolls up, which direction is good. Collectors may only write
   registered metrics.
4. **Reuse before building.** Already in the repo and working: the cron
   runner (`lib/cron-scheduler.ts`, `app/api/cron/tick`, ticked every 60s
   from `instrumentation.ts`), OAuth with PKCE (`lib/oauth/`), connector
   status types, the Telegram bridge pattern, the `llm` connector, the
   repository layer in `lib/db.ts`.

## Data model (new tables)

```
metric_points   (metric_id, business_id, captured_at, value REAL,
                 PRIMARY KEY (metric_id, business_id, captured_at))
collector_runs  (id, collector_id, started_at, finished_at, ok,
                 points_written, error)
insights        (id, kind: alert|anomaly|forecast|action, business_id,
                 metric_id NULL, severity: info|watch|high, title, body,
                 evidence JSON, dedupe_key UNIQUE, status: open|done|dismissed,
                 created_at, updated_at)
oauth_tokens    (provider, account_label, ciphertext, iv, tag, scopes,
                 expires_at, updated_at, PRIMARY KEY (provider, account_label))
client_shares   (id, label, business_id, metric_ids JSON, token_hash UNIQUE,
                 created_at, expires_at NULL, revoked_at NULL)
```

`metric_snapshots` and `social_snapshots` stay for the upstream pages until
those pages move to `metric_points`.

## Sources

One Google Cloud project and one Meta developer app cover most of it.

| Source | Main metrics | Auth | Notes |
|---|---|---|---|
| Google Search Console | clicks, impressions, CTR, avg position; indexed vs submitted pages | Google OAuth | Index status comes from the URL Inspection API run over each sitemap URL (quota ~2,000/day per site, so spread it over the day). |
| Google Analytics 4 | users, sessions, conversions | Google OAuth | One GA4 property per site. |
| Google Business Profile | calls, website clicks, direction requests, profile views | Google OAuth | Business Profile Performance API. |
| YouTube | subscribers, views | Google OAuth | |
| Google Ads | spend, clicks, conversions, cost per lead | Google OAuth | Developer tokens were retired Sept 9, 2026. Access is granted to the Cloud project: apply for Basic access in Cloud Console after brand verification; reviewed in minutes. |
| Instagram, Facebook Page | followers, reach, engagement, top posts | Meta app | Instagram must be a Business/Creator account linked to the Facebook Page. |
| Meta Ads | spend, impressions, clicks, leads, cost per lead | Meta app | `ads_read`. |
| TikTok | followers, views, likes | TikTok developer app | App review needed for both organic (Display API) and ads (Marketing API). |
| LinkedIn | followers, impressions | LinkedIn app | Company page stats need Community Management API approval, which LinkedIn may refuse. Fallback: Zernio (upstream connector) or manual entry. |
| Stripe | revenue, MRR, new customers, refunds, churn | API key per account | One key per Stripe account; map accounts or product metadata to businesses. |
| Etsy | orders, revenue, active listings, visits where available, ad spend | Etsy OAuth | Etsy's API has no Etsy Ads endpoint. Daily total ad spend comes from shop ledger entries (`prolist`, `offsite_ads_fee`); per-listing ad stats come from Etsy's CSV export via manual import. |
| nosterHealth / nosterLogistics | signups, active users, MRR | read-only DB key | Confirm which database each runs on before speccing. |
| Manual | anything without an API | in-app form / CSV import | Stored the same way, tagged as manual. |

## Collectors

`lib/collectors/<source>.ts`, each implementing the `Collector` interface
from spec 003, registered in `lib/collectors/index.ts` with a fixed interval
(`everyMinutes`, 15 min to 1 week).
The existing cron tick runs whatever is due. Every run writes a
`collector_runs` row. A failure never deletes or overwrites good data; the
dashboard shows the last good value as stale with the error.

## Secrets

- Static keys (Stripe, etc.) live in environment variables (Railway variables
  in production, `.env.local` locally).
- OAuth refresh tokens: upstream writes them into `.env.local`, which is
  wiped on every Railway deploy. They move to `oauth_tokens`, encrypted with
  AES-256-GCM using `NOSTEROS_SECRET_KEY`. The database lives on the Railway
  volume. Spec 004 does this before the first OAuth connector.

## Intelligence layer

- **Rules:** per-metric thresholds and pairs (spend up while leads down,
  indexed pages dropping, a site down).
- **Anomalies:** robust z-score against a rolling 28-day median and MAD,
  weekday-aware for daily metrics, with a minimum-volume guard so tiny
  numbers don't trigger alarms. |z| ≥ 3 → `watch`, ≥ 4 → `high`.
- **Forecasts:** Holt linear smoothing on weekly series, 4 weeks ahead with
  a band; only once a series has 8+ weekly points.
- **Courses of action:** a daily job gathers the week's numbers and the
  open anomalies, asks the LLM for 3–5 specific actions, each citing the
  numbers behind it, and writes them as `insights`. With no LLM key it falls
  back to the rule-based list.
- **Phone alerts:** Telegram bot following the existing bridge's fail-closed
  allowlist. Only `high` severity alerts immediately; everything else goes
  into an 8am daily digest. Quiet hours 10pm–7am.
- **Client dashboards:** `/share/[token]`, read-only, showing only the
  metrics in that share for that business. Token stored as a SHA-256 hash,
  revocable, optional expiry, `noindex`, rate-limited, and the only path the
  access gate lets through without login. Claude reviews this one before it
  merges.

## Build order

Each line becomes a spec in `docs/handoff/`.

| #   | Spec | Depends on |
|-----|------|------------|
| 001 | Upgrade to Next.js 16 / React 19 | |
| 002 | Deploy-safe: no fake connector status, cron tick works behind login | |
| 003 | Metric store, registry, collector framework, staleness | 001 |
| 003b | Security fixes + build-warning cleanup (from the 16-agent triage) | 003 |
| 004 | Encrypted token store + Google OAuth | 003 |
| 005 | Search Console + GA4 + Business Profile collectors | 004 |
| 006 | Stripe collector per business | 003 |
| 007 | Dashboard: home pulse, business switcher, section pages on the store; remove seeded demo data | 005, 006 |
| —   | Deploy to Railway with login and volume | 001, 002, 004 |
| 008 | Meta: Instagram, Facebook Page, Meta Ads | 004 |
| 009 | Etsy collector + ledger ad spend + CSV import | 003 |
| 010 | Google Ads + YouTube | 004 |
| 011 | Anomaly detection + forecasts | 007 |
| 012 | Courses of action | 011 |
| 013 | Telegram alerts + daily digest | 011 |
| 014 | Client share dashboards (security review) | 007 |
| 015 | TikTok organic + ads | TikTok app approval |
| 016 | LinkedIn, or its fallback | LinkedIn decision |
| 017 | nosterHealth / nosterLogistics product metrics | DB confirmed |

## Security notes

- **Outbound mail.** `lib/mail-guard.mjs` allows only an internal
  allowlist (placeholder `*.example.com` addresses today) unless
  `MAIL_ALLOW_EXTERNAL=1`, which turns the guard off for the whole process.
  The outreach feature must not use that switch. It needs a per-message
  approval record (who approved, when, the exact recipient and body hash)
  that the send path checks before every external email.
- **Deploy from GitHub only.** `data/` (real SQLite files) and `.env.local`
  are gitignored, so a GitHub-based Railway build never sees them. Never
  deploy with `railway up` from the local folder. If we ever switch to
  Docker or `output: 'standalone'`, add a `.dockerignore` and
  `outputFileTracingExcludes` for `data/**` and `.env*` first.
- **Railway settings the deploy spec must include:**
  `FOUNDER_OS_ACCESS_TOKEN` set (the login is off when it's unset),
  `DATA_DIR` pointing at the volume, `poppler-utils` added as a runtime apt
  package for PDF bank statements (Railpack:
  `RAILPACK_DEPLOY_APT_PACKAGES`), and `DEMO_GATE` left unset.
- **Accepted risk:** the Tailwind 3 / braces advisory (build-time only, no
  patched version exists). Revisit when braces ships a fix. The vitest
  chain is test-only and gets upgraded in its own spec.
