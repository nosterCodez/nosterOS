# M6b: Printify read-only connector

## Scope and decisions
- Build first, before Shopify, as requested by Noe on October 5, 2026.
- Reuse workspace OAuth state, encrypted token storage, role guards, discovery, scheduler and snapshot UI.
- Printify requires platform registration/approval; keep sign-in unavailable until approved app ID and explicit readiness flag exist.
- Request only shops.read, products.read, orders.read in the platform application. No writes or webhooks.
- Implement Printify's app_id/accept_url/decline_url flow, absolute expire_at tokens and separate refresh endpoint.
- Require signed single-use state even if provider omits it; include it in accept/decline URLs. No insecure fallback.
- Show shop product total, all-status order total, fulfilled order total from provider pagination metadata; not revenue or profit.
- Only bounded GETs to fixed Printify endpoints, User-Agent included; no raw orders/customer details persisted.
- Credentials and provider registration require separate approval; no purchase, deployment or real-account access in this spec.

## Acceptance
- Tests for OAuth exchange/refresh, state binding, revocation races, missing/invalid totals, shop isolation and safe discovery.
- Typecheck, test suite and isolated build; preserve unrelated provider documents and existing development server.
- Reference: https://developers.printify.com/

## Report
- Implemented October 5, 2026 on m6b-commerce-connectors, before Shopify implementation.
- Added Printify OAuth start/exchange/refresh and approved-app readiness gating; no manual API key field required for this flow.
- Added shop discovery and product/order/fulfilled totals through existing workspace collectors and Money dashboard.
- Data reads are GET-only, bounded and fixed-host; no pagination links followed or raw customer records stored.
- Self-review covered signed state, user/session/workspace binding, reauthorization, encrypted persistence, refresh/disconnect races and membership checks.
- New provider and shared API tests verify state replay rejection, wrong workspace/session, denied reauthorization, discovery invalidation and missing totals.
- Combined final suite: 3,776 passed; four known Windows failures plus three known EPERM cleanup failures, no new failing suite.
- Typecheck and isolated production build passed; no dependency additions.
- Synthetic browser preview checked at 390px and 1280px, including sign-in feedback and pending-approval state; no horizontal overflow observed.
- No real provider login or collection verified; app registration/approval, private app ID and scope confirmation still required.
- Asked Noe for permission to prepare the Printify application; no answer received during this build and no application submitted.
- No credentials, paid services, legal acceptance, deployment or production account changes; existing port 4100 server and unrelated documents preserved.
