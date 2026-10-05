# Workspace cloud connections

M4-M5 introduces account connection screens and stored metric snapshots. This
release is not a claim that provider apps are approved or customer accounts are
connected. No new subscriptions or provider credentials were provisioned.

## Platform setup

Store platform app secrets privately in Railway (local equivalents in ignored
`.env.local`). Never put customer tokens there. Retain the existing
`NOSTEROS_MASTER_KEY`; replacing it without a migration makes vaults unreadable.
Google sign-in and Google data access use separate applications/configuration.

Redirects are exactly `https://os.noepenaa.com/api/connections/oauth/PROVIDER/callback`
where PROVIDER is `google`, `google-business`, `meta`, `tiktok`, or `etsy`. Local development uses
the configured trusted `NOSTEROS_BASE_URL` origin, never the request Host header.

| Provider | Private platform configuration | Current read scope / prerequisites |
| --- | --- | --- |
| Google | OMEGA_GOOGLE_CLIENT_ID / CLIENT_SECRET | webmasters.readonly, analytics.readonly, youtube.readonly; enable those APIs, configure consent/test users, verify application before wider use |
| Google Business | Google data app plus OMEGA_GOOGLE_BUSINESS_ENABLED=1 only after access/callback verification | Separate business.manage authorization; OAuth permits edits, but OmegaOS only GETs locations and reports; Google project approval and nonzero quota required |
| Meta | OMEGA_META_CLIENT_ID / CLIENT_SECRET / OMEGA_META_API_VERSION | pages_show_list, pages_read_engagement, instagram_basic, ads_read; approved app permissions, selected Page/professional Instagram/ad account; explicitly choose supported Graph version |
| TikTok | OMEGA_TIKTOK_CLIENT_ID / CLIENT_SECRET | user.info.basic, user.info.stats; Login Kit and statistics permission approval |
| Etsy | OMEGA_ETSY_CLIENT_ID / CLIENT_SECRET | shops_r; approved application, matching shop ID; API key:secret header and PKCE |
| Stripe | No platform app | Workspace owner saves a restricted key with Charges read permission; collection is GET only; test/live labeled; no writes tested to infer key privileges |
| Email | No platform app | Workspace host, username and app password; provider must permit TLS IMAP authentication; no Gmail API, messages, attachments or sending |

Noe approved Business Profile's broader business.manage permission on Oct 5.
The sign-in readiness flag remains off until Google's project API access is
approved and its callback is registered. Never merge this scope into base Google.
LinkedIn remains disabled pending developer sign-in, approved Community Management
access and verification of read-only r_organization_admin reporting permissions.
Google Ads, TikTok Ads, advanced Etsy revenue/ledger/CSV, product/CRM data and
lead/action intelligence remain follow-up work, not functional integrations.
Etsy here exposes lifetime sales count and active listings, not revenue.
Provider privacy/deletion/terms requirements need approved legal copy and review
before public onboarding. No legal text was published in this change.

## Workspace flow

M5c makes native provider sign-in the default entry point. Manual secrets are
collapsed under Advanced connections, not removed or represented as OAuth.
Google Search Console sites, GA4 properties and owned YouTube channels can be
discovered after consent. Enable the Analytics Admin API as well as Data API
for GA4 selection. Discovery uses existing read-only scopes, a 15-second total
budget, at most five pages and 500 distinct results, with a visible truncation
notice. It never enables scheduled reads or chooses an account automatically.
Membership, active workspace and credential generation are rechecked before
returning results; no tokens or arbitrary provider pagination URLs reach clients.
M5i adds Facebook Page, linked Instagram professional account and Meta ad-account
pickers using the same limits. Graph discovery follows only bounded cursors on
the fixed Graph host; it never follows `paging.next` URLs or returns Page tokens.
The Meta credential generation (not Google's) is rechecked after discovery.
M5j adds Etsy owner-shop discovery using the documented numeric token prefix,
validates the returned owner, and strips everything except shop ID/name. It also
adds Business Profile location discovery through accounts/-/locations, requesting
name/title only, with the same five-page/500-result/15-second limits. These reads
use the separate provider generation and the same session/admin revalidation.
GBP totals remain null unless every requested day and value is present once.
Etsy token exchange and refresh include the required API key:secret header.
TikTok
uses the authorized account directly. Stripe/email login is not implemented;
their manual configuration remains available. No new provider apps have been
registered by M5c, and unconfigured sign-in buttons remain disabled honestly.

An owner/admin authorizes a provider or saves a restricted credential, selects
the resource and explicitly enables scheduled reads. Save settings after a
reconnection to bind the new credential generation. A saved key alone does not
mean connected, validated or collecting. `Sync now` works without enabling
scheduled reads, with a 15-minute successful-read cooldown and a 60-second
failed-read retry delay. A busy installation may delay scheduled reads.

The internal cron tick visits explicit workspace leases, rotates its starting
workspace, runs at most one due source per workspace and stops after 16 seconds.
Each source has an 11-second budget and a persistent atomic claim. Collection
runs in the private-beta mode with `NOSTEROS_OPERATOR_FEATURES != 1`; the legacy
operator scheduler remains unchanged when that flag is 1. Do not enable host
features expecting both schedulers to run together.

OAuth state binds provider, workspace, user and session, expires after ten
minutes and is consumed once. PKCE verifiers and access/refresh tokens live in
AES-GCM envelopes. Callback roles are rechecked after provider I/O. Disconnect,
reconnect and configuration changes invalidate in-flight writes. Private OAuth
slots are not accepted by public credential APIs. Provider requests use fixed
HTTPS hosts, no redirects, bounded responses and timeouts. IMAP allows only
the listed provider hosts with certificate verification enabled.

The dashboard reads stored snapshots only: source, period, capture time, error
and staleness are visible. Missing is null; zero must come from the provider.
Stripe is USD captured charges created in a rolling 30-day window less refunds
against those charges, not MRR, profit or accounting revenue. Sources use
different periods and must not be summed as one universal business KPI.
Provenance history includes resource, revision and credential generation; future
trend charts must segment by those fields instead of joining unrelated accounts.

Disconnect removes local OAuth access and pauses dependent sources; account
owners should also revoke at the provider. Pausing key-based collection retains
the encrypted key until the owner removes it in Credentials. Stored metric
history is retained; deletion/export remains the separately planned M7 work.

## Verification boundary

Fixtures exercise provider response formats without real account access.
Live consent, provider app review, permissions, quotas and first successful
collection must still be verified per account after Noe approves setup.
No customer email/password/token or production data is used in preview tests.

## Provider setup checkpoint (Oct 5, 2026)

- Google Business: Account Management, Business Information and Performance APIs
  enabled in rational-diode-496800-s3 under Noe's approval. Account API quota is
  zero, so Google must approve Basic API access. Do not set the readiness flag yet.
- Etsy: Noe explicitly chose a separate app. Created omegaos on the existing Etsy
  account; status Pending Personal Approval. Existing active/banned applications
  unchanged. No new credentials installed or callback configured while pending.
- TikTok and LinkedIn: developer portals require user sign-in. No apps or new
  credentials configured. PayPal is signed into its sandbox dashboard; app
  creation was blocked pending specific approval for persistent credentials.
  Requested permission to prepare a separate reporting-only sandbox app.
- Google Ads: activation page prepared; API terms/broad adwords consent approval
  requested. As of September 9, 2026 developer tokens are sunset; use the OAuth
  project's Cloud API access level. Test access alone cannot read production ads.
- PayPal remains planned. Identity OAuth is not financial-reporting authorization;
  verify the supported merchant/partner access model before adding a login flow.
- No paid services, root mailbox changes, customer writes or deployment performed.

## Primary references

- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/webmaster-tools/v1/searchanalytics/query
- https://developers.google.com/webmaster-tools/v1/sites/list
- https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/accountSummaries/list
- https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport
- https://developers.google.com/youtube/v3/docs/channels/list
- https://developers.tiktok.com/doc/oauth-user-access-token-management
- https://developers.etsy.com/documentation/essentials/authentication
- https://developers.etsy.com/documentation/reference/#operation/getShopByOwnerUserId
- https://developers.google.com/my-business/content/prereqs
- https://developers.google.com/my-business/content/location-data
- https://developers.google.com/google-ads/api/docs/api-policy/developer-token
- https://developers.google.com/google-ads/api/docs/api-policy/access-levels
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-access-control-by-role
- https://docs.stripe.com/api/charges/list
