# Railway deploy: current state

Set up by Claude on Oct 3, 2026, with Noe's approval. Nothing is deployed yet.

## What exists
- Railway account: nostercodez (Noe). Workspace "noe's Projects".
- Project **nosterOS** (`86e6ef04-9180-49d2-b319-ef5d60cd9351`),
  environment `production` (`1794ea24-cbb7-4ea1-91bd-5ade95cb6b33`).
- Service **nosteros-web** (`cd008990-7a89-415f-82c8-e841db70a8ef`), empty:
  **no source connected yet**, so nothing builds. Builder Railpack, restart on
  failure (5 retries), limits 1 vCPU / 1 GB.
- Volume **nosteros-data** mounted at `/data` (500 MB, region sfo).
- Custom domain `os.noepenaa.com` attached, target port 4100. Certificate is
  waiting on DNS (below). Checked Oct 3: os.noepenaa.com had no DNS records,
  so nothing currently serves it. noepenaa.com itself is on GitHub Pages and
  must not be touched.

## Variables already set (non-secret)
`NODE_ENV=production`, `DATA_DIR=/data`, `PORT=4100`,
`NOSTEROS_BASE_URL=https://os.noepenaa.com`,
`NOSTEROS_OWNER_EMAIL=noster@nostermarketing.com`,
`NOSTEROS_SIGNUP_ALLOWLIST=@nostermarketing.com`,
`RAILPACK_DEPLOY_APT_PACKAGES=poppler-utils`,
`NODE_OPTIONS=--max-old-space-size=512`.

## Still to do, in order
1. **Noe:** upgrade to Hobby; Usage limits: Compute email alert $8, hard
   limit $10 (Railway's minimum).
2. **Noe, in the Railway dashboard (Variables tab), never in chat or git:**
   `BETTER_AUTH_SECRET`, `NOSTEROS_INTERNAL_SECRET`, `FOUNDER_OS_ACCESS_TOKEN`
   (each a fresh random 32+ byte value, different from the local ones),
   then SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`).
   `NOSTEROS_MASTER_KEY` after M3. Leave `DEMO_GATE` unset.
3. **Noe, GoDaddy DNS for noepenaa.com** (add only these two; change nothing else):
   - CNAME `os` → `wv6vdkb7.up.railway.app`
   - TXT `_railway-verify.os` → `railway-verify=5dc0a622adeabfb6c1735e09ca3ff08b83c496bcf58f03d4fd6e380cb5c4d64d`
4. **Online-first decision, Oct 3:** after reviewing `4bd0c95` and the
   bootstrap follow-up, Claude connects `nosterCodez/nosterOS`, branch
   `m2-isolation`, for the private team beta. Keep the beta wall on,
   signup limited to `@nostermarketing.com`, and no business connector
   credentials configured. Never `railway up` from the local folder.
5. First deploy checks: anonymous `/` shows the beta challenge; sign in as
   noster@nostermarketing.com, completing the emailed sign-in link.
   Then run `npm run bootstrap-operator` **inside the deployed container**
   with its mounted `/data` volume and production environment, not a local
   command merely borrowing Railway variables. The command uses the existing
   `tsx` dependency; it must be installed in that container.
   Refresh the app and select nosterCodes. Workspace data is initialized on
   first access using structure-only seeding. Verify a second workspace has
   no nosterCodes data and connector surfaces return 403/empty states.
   Merge to main only after online checks and remaining M2 review pass.
   Existing PC data and its deferred migration are not part of this deploy.
6. Optional later: healthcheck path that returns 200 behind the beta gate.

## Review note for Astra (from Claude)
In `lib/auth.ts` the invitation check compares `expiresAt > Date.now()`.
If Better Auth stores `expiresAt` as ISO text in SQLite, that comparison is
always true (TEXT sorts above INTEGER), so expired invitations would still
allow sign-up. Add a test with an expired invitation and fix if it fails.
