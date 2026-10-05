# M6: Google dashboard clarity and financial CSV imports

## Scope
- Prioritize connected reporting sources, show account identifiers, freshness and refresh controls.
- Keep provider approval limitations honest; no new scopes, credentials or platform changes.
- Add financial CSV preview/confirmation to Money, scoped to the signed-in workspace.
- Standard format: id,date,description,amount,currency (signed decimal amount; YYYY-MM-DD).
- PayPal format: Transaction ID,Date,Name,Net,Currency,Status (US dates; Completed only).
- Separate account/currency import summaries from provider totals; do not call movement revenue or balance.

## Decisions and acceptance
- Reuse existing CSV tokenizer with opt-in strict syntax checks, no new dependency.
- Bounded 512 KiB CSV, 2,000 rows; reject invalid rows atomically with record numbers.
- Preview reparses on save; imports do not retain raw CSV, file paths or unnecessary export columns.
- Stable source/account/transaction IDs deduplicate overlapping exports; changed existing IDs are conflicts, not overwrites.
- Admin/owner write access, same-origin guard, pinned workspace header, fresh membership before write.
- Currency totals use integer minor units for supported two-decimal currencies only; no FX or global totals.
- Validate parser, duplicates/conflicts, workspace boundaries, authorization, display and production build.
- Local implementation only; deployment requires Noe approval. Do not push main and trigger deployment implicitly.

## Report
- Implemented locally October 5, 2026; no deployment or new provider access.
- Dashboard prioritizes connected/configured sources, collapses disconnected sources, shows resource IDs and reporting notes.
- Visible dashboards refresh saved data every minute; admin manual sync preserves provider cooldown/error messages.
- Money includes standard/PayPal CSV preview and confirm, month filtering, currency/account-separated movement totals and timestamps.
- Imports are independent of live metrics; no revenue, balance or combined provider/import totals claimed.
- Parser validates entire file, dates, amounts, currency, duplicate IDs and bounds; repository rejects changed existing IDs atomically.
- Security reviewed: same-origin/session/role checks, workspace header pin, fresh membership before persistence, parameterized SQL and no raw CSV storage/logging.
- New parser/repository/API tests passed, including preview without writes, overlapping imports, conflicts, two databases, viewer/member denial, wrong origin/workspace and lost membership.
- Full suite: 3,762 passed, 4 failed tests plus 3 failing cleanup hooks; all failures in documented Windows baseline suites (interaction-layer, paths, skills-plugins, superset-dispatch, lead-magnet-actions, lead-magnets-route, roadmap-mock-5h).
- Typecheck and isolated production build passed. Smoke coverage updated for new GET route; 59 smoke tests passed.
- Synthetic local browser fixture checked at 390px and 1280px; no horizontal overflow; month filter and currency-separated totals verified.
- Browser file upload automation blocked by Chrome extension file-URL permission; full authenticated browser upload/confirm still needs verification. Real local /finances remains behind beta sign-in.
- Local test artifacts ignored under .local; existing shared dev server on port 4100 left running. No real financial files imported.
- Provider approvals remain separate; cannot promise flawless Google access or claim GBP/Ads connected. Deployment requires approval.
