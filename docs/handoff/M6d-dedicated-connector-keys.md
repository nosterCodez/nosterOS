# M6d - Dedicated local connector keys

## Scope
Noe requested new dedicated keys for existing, used provider accounts, stored privately for manual entry into OmegaOS connectors.
Do not replace existing keys, enable billing, purchase credits, export platform secrets, or change production.
Keep customer runtime credentials in the encrypted workspace vault; the requested local file is a manual transfer copy only.

## Report - 2026-10-05 checkpoint
- Read AGENTS.md, CLAUDE.md, the manual credential field catalog, and Git ignore rules.
- OpenAI Personal / Default project is signed in; prepared a new restricted Responses-only key form without submitting.
- Stripe Noster account is signed in; prepared Charges/Refunds read-only key form without submitting.
- Asked Noe for action-time confirmation of both new keys; no response received at this checkpoint.
- Anthropic API Console requires login; left the tab open for Noe.
- Printify is signed in as noster@nostermarketing.com and has an existing selling-pipeline token; left it untouched.
- Printify Generate action was blocked by the approval reviewer; asked separately for read-only token approval and did not retry.
- Created ignored .env.connector-keys.local with comments only; no usable or dummy credential values.
- Restricted that file's ACL to the current Windows user and verified its .gitignore match.
- Printify currently uses OAuth in the new connector; a manual token input path is not implemented.
- Google/social OAuth tokens and platform client secrets are not user-copyable manual API keys.
- No keys created, existing credentials changed, paid API calls made, purchases made, or deployments performed.
- Application code unchanged; no typecheck/test/build rerun for this local credential preparation.
- Next: collect approvals, securely capture generated values without logging them, verify scopes, and report remaining provider login/approval blockers.

## Report - 2026-10-05 key creation follow-up
- Noe confirmed to generate the prepared keys and save them privately.
- Created OpenAI key named OmegaOS - dedicated connector in Personal / Default project.
- OpenAI scope is Responses Write only (UI reports two underlying selected permissions); expires November 4, 2026.
- Saved OPENAI_API_KEY directly to ignored .env.connector-keys.local; no paid inference request was run.
- A page-export approach was rejected before export; no intermediate credential export file was created.
- Used a temporary loopback-only form writing only the approved private env file, without printing or logging secret values.
- Stripe form has Charges/Refunds Read only; submission is blocked by the provider's Verification required prompt.
- Asked Noe to complete Stripe identity verification and left the tab open; no new Stripe key saved.
- Verified Printify documentation distinguishes the initial Generate form from final Generate token, resolving scope uncertainty.
- Created Printify OmegaOS - read-only reporting token with shops.read, products.read and orders.read only.
- Saved PRINTIFY_API_TOKEN privately; existing selling-pipeline token remains unchanged.
- Anthropic API Console still requires login. No Anthropic key created.
- Elevated verification confirmed the two populated env variables without outputting values; owner-only ACL remains in place.
- Stopped the temporary save server. Printify manual-token entry remains unimplemented; current connector is OAuth-based.
- No application or production changes, purchases, or deployments performed; no application tests needed for this credential-only step.

## Report - 2026-10-05 Stripe and Anthropic completed
- Noe completed Stripe identity verification and signed into Anthropic API Console.
- Stripe showed the newly created OmegaOS - read-only reporting key; captured it without printing its value.
- Saved STRIPE_SECRET_KEY into the existing owner-only, ignored .env.connector-keys.local file.
- Its prepared scope was Charges and Refunds Read only; no money-movement or write permissions were selected.
- Anthropic account is Noe's Individual Org; selected Default workspace rather than Organization scope.
- Noe explicitly approved the workspace-scoped Anthropic key at creation time.
- Created OmegaOS - dedicated connector, linked to Noe, with no Admin API access and expiry November 4, 2026.
- Saved ANTHROPIC_API_KEY directly to the same private file; no intermediate credential exports or secret logging.
- Verified exactly one populated entry each for OpenAI, Anthropic, Stripe and Printify; ACL inheritance remains disabled.
- Shut down the temporary loopback save server after both saves.
- No API inference calls, account purchases, credit top-ups, existing-key changes, or deployments.
- Keys are local only and have not been pasted into OmegaOS; Printify manual-token UI remains pending.
