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
where PROVIDER is `google`, `meta`, `tiktok`, or `etsy`. Local development uses
the configured trusted `NOSTEROS_BASE_URL` origin, never the request Host header.

| Provider | Private platform configuration | Current read scope / prerequisites |
| --- | --- | --- |
| Google | OMEGA_GOOGLE_CLIENT_ID / CLIENT_SECRET | webmasters.readonly, analytics.readonly, youtube.readonly; enable those APIs, configure consent/test users, verify application before wider use |
| Meta | OMEGA_META_CLIENT_ID / CLIENT_SECRET / OMEGA_META_API_VERSION | pages_show_list, pages_read_engagement, instagram_basic, ads_read; approved app permissions, selected Page/professional Instagram/ad account; explicitly choose supported Graph version |
| TikTok | OMEGA_TIKTOK_CLIENT_ID / CLIENT_SECRET | user.info.basic, user.info.stats; Login Kit and statistics permission approval |
| Etsy | OMEGA_ETSY_CLIENT_ID / CLIENT_SECRET | shops_r; approved application, matching shop ID; API key:secret header and PKCE |
| Stripe | No platform app | Workspace owner saves a restricted key with Charges read permission; collection is GET only; test/live labeled; no writes tested to infer key privileges |
| Email | No platform app | Workspace host, username and app password; provider must permit TLS IMAP authentication; no Gmail API, messages, attachments or sending |

GBP and LinkedIn are deliberately disabled awaiting Noe's decision on broader
provider permissions (business.manage and organization management) and provider
approval. Do not add their scopes merely because the adapter skeleton exists.
Google Ads, TikTok Ads, advanced Etsy revenue/ledger/CSV, product/CRM data and
lead/action intelligence remain follow-up work, not functional integrations.
Etsy here exposes lifetime sales count and active listings, not revenue.
Provider privacy/deletion/terms requirements need approved legal copy and review
before public onboarding. No legal text was published in this change.

## Workspace flow

An owner/admin authorizes a provider or saves a restricted credential, selects
the resource and explicitly enables scheduled reads. Save settings after a
reconnection to bind the new credential generation. A saved key alone does not
mean connected, validated or collecting. `Sync now` obeys the same 15-minute
cadence to prevent repeated account reads. A busy installation may delay reads.

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

## Primary references

- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/webmaster-tools/v1/searchanalytics/query
- https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport
- https://developers.google.com/youtube/v3/docs/channels/list
- https://developers.tiktok.com/doc/oauth-user-access-token-management
- https://developers.etsy.com/documentation/essentials/authentication
- https://docs.stripe.com/api/charges/list
