# M5e: Google provider activation

## Scope
- Noe approved Google setup, its API Services User Data Policy, a testing-mode
  OAuth client, read-only Search Console/Analytics/YouTube, and private Railway storage.
- Use the existing Google Cloud project; do not alter its service accounts.
- Configure the exact callback at https://os.noepenaa.com/api/connections/oauth/google/callback.
- Enable required Search Console, Analytics Admin/Data, and YouTube APIs without
  purchases, billing changes, or quota upgrades.
- Keep Google external audience in Testing; no public launch or legal copy publication.
- Store app credentials only in Railway; retain the existing encryption master key.
- Verify the live authorization entry point; user account consent remains explicit.
- Do not claim Meta, TikTok, Etsy, Gmail OAuth, or Business Profile are activated.

## Report
- Checkpoint: 2026-10-04 22:20 America/Chicago; activation is incomplete.
- Created OmegaOS branding and a web OAuth client in project rational-diode-496800-s3.
- Exact HTTPS callback configured; no JavaScript origins or agent client enabled.
- External audience remains Testing; noster@nostermarketing.com is its only test user.
- Configured only webmasters.readonly, analytics.readonly, and youtube.readonly scopes.
- Stored OMEGA_GOOGLE_CLIENT_ID and OMEGA_GOOGLE_CLIENT_SECRET privately in Railway.
- Reviewed the two staged variable additions before deploying; no other changes staged.
- Railway deployment f1fe75c3-89e3-4a68-9c51-e2163af5bd05 succeeded on code 88b252d.
- Live Connections now shows Continue with Google for Search Console, GA4 and YouTube.
- Verified the live button reaches Google's chooser and read-only consent screen.
- Pending Noe's action-time approval: each API's service terms, plus final account consent/testing.
- YouTube API still disabled; Search Console and Analytics API activation not yet verified.
- No account-list retrieval, metric sync or scheduled collection performed this checkpoint.
- Google warns the app is unverified; approved public privacy/terms and wider verification remain future work.
- Security review: no master-key rotation, no unrelated credentials changed, secret not printed or saved to git.
- No application-code changes, purchases or messages; typecheck/tests/build not rerun for this configuration-only checkpoint.
