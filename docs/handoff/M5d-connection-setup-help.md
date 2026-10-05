# M5d: Connection setup status and Gmail links

## Scope
- Replace unavailable OAuth login buttons with readable platform-setup status, without bypassing readiness checks.
- Keep working login buttons when an app is configured and the vault is ready.
- Add Google's official app-password and 2-Step Verification help links in the Email inbox card and above manual email fields.
- Link Email inbox setup directly to the email section inside Advanced connections.
- Explain account eligibility and distinguish an app password from the normal Google password.
- No OAuth app registration, real account access, credential generation, permissions, backend changes or new costs.
- Work on codex/m5d-connection-setup-help; deployment requires approval.

## Verification
- Render tests for pending/ready/vault-unavailable states and Gmail help locations.
- Existing backend isolation tests stay unchanged.
- Typecheck, full tests, production build and mobile/desktop browser fixture checks.
- Primary reference: https://support.google.com/accounts/answer/185833

## Report
- Replaced unconfigured provider login buttons with readable Setup pending status; configured login remains functional.
- Vault-unavailable status remains a separate blocking condition; no readiness/security checks were bypassed.
- Added reusable GmailSetupHelp in the Email inbox card and above the email credential fields.
- Help links go to Google's official app-password page and 2-Step Verification/app-password documentation in new tabs.
- Help includes Gmail host, full-email account guidance, account eligibility and normal-password warning.
- Enter email settings opens Advanced connections and navigates to the email-credentials anchor.
- Focused UI/API suite: 11/11 tests pass; typecheck and production build pass.
- Full suite: 3,706 passed and four baseline failed assertions; 350 files passed and seven known Windows baseline files failed.
- Chrome fixture checks pass at 390px and 1280px, including keyboard navigation, link placement and no overflow.
- Preview used actual components with no credentials entered; temporary browser/server closed afterward.
- No account registration, scope changes, secret generation, real email or costs; existing local dev server untouched.
- Noe approved deployment of this small follow-up in chat; live verification pending below.
