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
| Meta | OMEGA_META_CLIENT_ID / CLIENT_SECRET / OMEGA_META_API_VERSION / optional CONFIG_ID | pages_show_list, pages_read_engagement, instagram_basic, ads_read, business_management; configure all five in Facebook Login for Business when using CONFIG_ID; explicitly choose supported Graph version |
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
M6h expands discovery with GET-only business portfolio reads: `/me/businesses`,
`/{business-id}/owned_pages`, `/client_pages`, and `/owned_ad_accounts`, unioned
with personal-account assets. Deduped results are capped at 100 Pages/ad accounts
and 10 businesses, five response pages per edge, 100 requests and 15 seconds total.
The business_management permission can permit management operations; OmegaOS
uses it only for these reads. Noe must add it to the Meta configuration and
reconnect. The app remains development-mode, not approved for public onboarding.
Etsy failures retain HTTP status plus an allowlisted code; unknown codes use
unrecognized_provider_error. M6j additionally retains only the JSON error string,
masked for emails, digit runs over six and echoed request credentials, then limited
to 160 characters with control characters removed. Other JSON fields are discarded.
Diagnostics are bound to
the workspace credential generation and shown only to owners/admins. Server logs
include the workspace ID and safe diagnostic, never headers/tokens/raw bodies.
On an Etsy owner-lookup 403, discovery GETs users/me (shops_r required), verifies
its user_id against the token prefix, then GETs shops/{shop_id} and validates both
IDs before returning ID/name. At most three reads, same deadline/generation guards.
Other errors are not retried; failed fallback reads retain their diagnostic.
The app requests shops_r; saved token records do not retain returned scope, so
requested scope must not be represented as independently confirmed live consent.
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

## Google Ads reporting (M5k)

Separate `google-ads` OAuth authorization uses the required broad `adwords` scope;
existing Google grants are not expanded. Only account-list and search requests
are implemented. The data app must register its separate callback and receive
Ads API access before `OMEGA_GOOGLE_ADS_ENABLED=1`; reviewed API version is `v25`.
No developer token is used under Google's September 2026 onboarding change.

Discovery reads at most five directly accessible account trees, caps output at
500 customers and reports truncation. Manager/customer IDs are stored together
in that workspace's source setting; direct access wins when duplicated. Reports
read 28 completed account-local days. Currency is disclosed; only USD spend is
shown. Missing metrics remain null, and test status is shown only if returned.
Production-project approval errors are distinguished from expired user consent.
All requests use fixed hosts, bounded bodies, no redirects and existing budgets.
Live Ads consent and report collection have not been tested or deployed yet.

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

## Printify and Shopify implementation (M6b/M6c)

- Printify: platform registration/approval required before setting OMEGA_PRINTIFY_ENABLED=1 and OMEGA_PRINTIFY_APP_ID. Application scopes must be shops.read, products.read, orders.read only. Callback: https://os.noepenaa.com/api/connections/oauth/printify/callback. Uses provider absolute expiry and rotating refresh tokens; signed state is also carried in accept/decline URLs.
- Shopify: OMEGA_SHOPIFY_CLIENT_ID, OMEGA_SHOPIFY_CLIENT_SECRET and OMEGA_SHOPIFY_ENABLED=1 only after app/distribution/access setup is approved. Callback: https://os.noepenaa.com/api/connections/oauth/shopify/callback. Standalone merchant authorization, read_products/read_orders, expiring offline tokens. API version 2026-10.
- Each Shopify connection is pinned to its canonical myshopify.com domain. Callback HMAC/timestamp and single-use workspace/user/session state must all pass. Other domains, ports, redirects and arbitrary API paths are rejected.
- Printify reports current product/all-status order/fulfilled order totals. Shopify reports current products and rolling 30-day orders, with unknown for non-exact counts. Neither is revenue, profit or balance; totals across providers must not be summed.
- Only aggregate snapshots and shop ID/name discovery results reach clients. No customer fields, raw orders, order creation, publishing, payments or mutation GraphQL are retained/implemented.
- Provider registrations, credentials, legal requirements and live merchant tests remain external work. No app approval, account access or deployment is implied by implementation.

## Primary references

- https://developers.printify.com/
- https://shopify.dev/docs/apps/build/authentication-authorization/authenticate-standalone-apps
- https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens
- https://shopify.dev/docs/api/admin-graphql/2026-10/queries/ordersCount

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
- https://developers.google.com/google-ads/api/docs/account-management/get-account-hierarchy
- https://developers.google.com/google-ads/api/rest/common/search
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-access-control-by-role
- https://docs.stripe.com/api/charges/list
