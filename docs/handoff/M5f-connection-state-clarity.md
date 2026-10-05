# M5f: Saved connections and available connectors

## Goal
Make account connection distinct from choosing a reporting resource and enabling sync.
Noe wants a straightforward connector card, sign-in, and a saved account connection.

## Decisions
- Show Connected only for saved OAuth authorization, with reporting status separately.
- Keep configured connectors in the primary grid; put unconfigured/planned providers
  in a collapsed More connectors section with honest setup requirements.
- Keep manual Stripe/email setup labeled; never invent a working OAuth destination.
- Add Refresh status so an already-open page can pick up completed platform setup.
- Retain existing encrypted persistence, membership checks, explicit resource selection
  and opt-in collection; no new credentials, scopes, automatic sync or dependencies.
- Update tests for this intentional presentation change and callback persistence.

## Report
- Implemented saved-connection labels, separate reporting status, Refresh status,
  and a collapsed More connectors area for unavailable providers.
- Live Google OAuth authorization saved; a fresh page request shows persisted authorization.
- Search Console discovery returned access denied; provider API enablement is still pending.
- No API terms approval received yet; no additional APIs enabled in this change.
- Focused tests: 12 passed, including callback encryption, repeat reads, and cross-workspace isolation.
- Typecheck and production build passed. Full suite: 3,708 passed, 4 failed assertions
  across 7 failed files, all within the documented Windows baseline; 350 files passed.
- Security/UI review: no auth, encryption, scopes or collection defaults changed;
  status wording separates authorization from data access, errors remain visible,
  native details and buttons retain keyboard access and responsive grid constraints.
- Deployment and live layout verification pending this commit.
