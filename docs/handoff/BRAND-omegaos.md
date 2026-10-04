# OmegaOS product rebrand

Status: implemented; deployment verification pending
Review by Claude: no

## Decision
Noe renamed nosterOS to OmegaOS on October 4, 2026 and supplied two logo assets.
OmegaOS has an independent product identity: black/charcoal, white and red, with
secondary powered by nosterCodes attribution. This supersedes green brand styling.

## Scope
Update visible product copy, logo surfaces, sign-in and email templates, metadata,
package display identity and default theme. Preserve alternate accessibility themes.
Use supplied assets, not invented replacement artwork. Test desktop and mobile.

## Compatibility
Do not rename the repository, Railway service, domain, workspace ownership, database
files, auth cookies, env names or historical records in this visual rebrand. Existing
nosterCodes operator workspace remains the company workspace. Keep MIT attribution.
Historical handoff reports remain factual. No real email, purchase or DNS changes.

## Report
- Renamed product UI, auth copy, metadata, generated text and package display to OmegaOS.
- Installed Noe's artwork in navigation, Conductor, auth pages and browser icon.
- Default mono theme is now Omega red/charcoal/white; status colors stay semantic.
- New omegaos-theme preference key makes the new identity the initial theme.
- Retained alternate themes, workspace data, auth/env keys, domain and repository name.
- Legacy Paperclip cockpit title and failover marker remain stable external identifiers.
- Sender display-name compatibility updates old nosterOS labels without changing addresses.
- Typecheck and production build passed. Full suite: 3,646 passed, 4 failed assertions.
- Seven failing files are the documented Windows baseline (three cleanup failures included).
- Updated three old branding assertions and added palette/artwork/sender regression coverage.
- No real emails sent, secrets changed, accounts migrated, or third-party purchases made.
- Desktop/mobile and live deployment verification pending; M2 acceptance remains separate/open.
