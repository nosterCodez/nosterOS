# M6c: Shopify read-only connector

## Scope and decisions
- Add after Printify on the isolated commerce branch; no implicit deployment.
- Standalone authorization-code grant; merchant supplies canonical myshopify.com domain, not an API key.
- App registration, distribution, read_orders/protected-data approval and credentials remain external prerequisites.
- Request read_products and read_orders only; no customer fields, write scopes, payments, installs or billing initiated by collectors.
- Signed single-use state binds user/session/workspace; encrypted pending authorization and tokens bind exact shop domain.
- Validate callback HMAC and timestamp, reject duplicate parameters, verify shop matches pending binding before code exchange.
- Use expiring offline tokens and rotating refresh tokens, fixed GraphQL API version 2026-10.
- Read shop name/domain, product count and last-30-day order count. Non-exact counts stay unknown; no revenue/profit inference.
- Guard all Shopify outbound hosts to one canonical subdomain and allow only token and pinned GraphQL paths; no redirect following.
- Existing admin, same-origin, pinned-workspace, membership-recheck, encrypted vault and background collector protections apply.

## Acceptance
- Tests cover malformed/foreign domains, HMAC tampering/replay, token rotation, wrong shop, denied scopes and read-only GraphQL.
- Typecheck, full suite and build; browser check with synthetic data only if provider credentials unavailable.
- References: https://shopify.dev/docs/apps/build/authentication-authorization/authenticate-standalone-apps
- https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens
- https://shopify.dev/docs/api/admin-graphql/2026-10/queries/ordersCount

## Report
- Implemented October 5, 2026 on m6b-commerce-connectors after Printify, not deployed.
- Added store-domain entry, standalone OAuth flow, authorized-store picker, exact aggregate reporting and opt-in scheduling through existing components.
- Offline tokens expire and refresh; store domain is retained inside the encrypted token record.
- Callback requires provider HMAC, recent timestamp, unique query keys, single-use state and exact pending shop match before exchange.
- Scope checks require read_products/read_orders; collectors send only fixed GraphQL queries with aggregate counts and shop identity.
- Platform secret access stays in cloud-oauth; the existing host/connector boundary audit remains unchanged and passes.
- Tests cover hostile hosts/paths, tampered/expired/duplicate callbacks, replay, wrong shop, denied scopes, refresh, approximate counts and GraphQL errors.
- Shared API tests verify owner/admin authorization, origin/workspace pinning and token isolation in separate databases for both commerce providers.
- Combined final suite: 3,776 passed; four documented Windows failures plus three documented EPERM cleanup failures. Typecheck and build passed.
- Synthetic browser checks at 390px/1280px confirmed layout, domain-dependent sign-in availability, safe error feedback and honest setup state.
- No live Shopify app, merchant consent or report collection tested; app credentials, distribution/access setup and provider compliance requirements remain prerequisites.
- No deployment, credentials, purchases, customer messages or store mutations; temporary fixture server stopped, shared port 4100 server left running.
