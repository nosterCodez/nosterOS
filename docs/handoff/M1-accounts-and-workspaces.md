# M1: Accounts, sign-in and workspaces

Status: ready (after 003b)
Review by Claude: yes (authentication)

## Goal
Replace the single shared password with real accounts: people sign up,
sign in, create or join workspaces, and have roles. Read
`docs/architecture/multi-tenant.md` first. This spec does NOT yet split
data per workspace (that's M2). After M1 everyone signed in still sees the
same single database, so keep the outer password gate on until M2 ships.

## Decisions already made
- Library: **Better Auth** with the organization plugin
  (organization = workspace). Before installing, confirm the current
  version supports Next.js 16.3, React 19 and better-sqlite3. If it
  doesn't, stop and report the options instead of picking another library.
- Auth data lives in a new control database at `<dataDir()>/control.db`.
  Add `controlDbPath()` to `lib/paths.ts`. Don't put auth tables in
  `founder-os.db`.
- Sign-in methods: email magic link, and Google sign-in with scopes
  `openid email profile` only. Use a separate Google OAuth client for login
  (`GOOGLE_LOGIN_CLIENT_ID` / `GOOGLE_LOGIN_CLIENT_SECRET`), never the
  data-connection client.
- Roles: `owner`, `admin`, `member`, `viewer`, defined with
  `createAccessControl`. Permissions now: invite or remove members and
  change roles = owner/admin; delete workspace = owner. A viewer can't
  change anything.
- Workspace kind, stored in organization metadata: `founder`, `agency` or
  `client`. Asked once at onboarding.

## Do
1. `lib/auth.ts` (server config) and `lib/auth-client.ts`: Better Auth
   with the control DB, organization plugin, magic-link plugin, Google
   provider, `baseURL` from `NOSTEROS_BASE_URL`, secret from
   `BETTER_AUTH_SECRET`, trusted origins limited to the base URL, and the
   built-in rate limiting turned on for sign-in and magic-link requests.
2. Route handler at `app/api/auth/[...all]/route.ts`.
3. **System mail** `lib/system-mail.ts`: sends only fixed templates (magic
   link, workspace invitation) through platform SMTP (`SMTP_HOST`,
   `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`). It takes the
   template name and its variables, never free-form HTML or a raw body. It
   is separate from `lib/mail-guard.mjs` and the Comms send path. With no
   SMTP configured and `NODE_ENV !== 'production'`, it logs the link to the
   server console. In production with no SMTP it throws a clear error and
   never logs links.
4. Pages, in the existing design language (`components/terminal.tsx`
   primitives, `PageHeader`):
   - `/sign-in`: email field (sends the magic link) and "Continue with
     Google".
   - `/onboarding`: first sign-in with no workspace → create one (name,
     kind). The creator becomes owner. Accepting an invitation skips this.
   - `/settings/members`: list members and pending invitations; invite by
     email with a role; change a role; remove someone. Owner/admin only.
   - A workspace switcher in `Topbar` (sets the active organization).
5. **Gate** in `proxy.ts`:
   - Public paths: `/sign-in`, `/onboarding` (signed-in only),
     `/api/auth/*`, static assets, invitation-accept links.
   - No session cookie: pages redirect to `/sign-in?next=<path>`, API
     routes get `401` JSON. The proxy only checks the cookie is present
     (fast). Real validation happens server-side: add
     `requireSession()` in `lib/session.ts` and call it in the root layout
     and in a shared helper every API route uses. Grep for routes that
     don't call it and list them in the Report.
   - Internal ticks: replace the access-token cookie from 002 with an
     `x-nosteros-internal` header carrying `NOSTEROS_INTERNAL_SECRET`, checked
     in the proxy with a constant-time compare. It is only accepted on
     `/api/cron/tick`, `/api/agents/failover` and `/api/analytics/refresh`.
   - Keep `FOUNDER_OS_ACCESS_TOKEN` as an optional outer wall: when set it
     still applies on top of sessions (beta only).
6. `.env.example`: add every new variable with a one-line comment.
7. Tests: sign-up creates a user; creating a workspace makes the creator
   owner; invite → accept → member with the invited role; a viewer can't
   invite (403); the proxy redirects anonymous pages and 401s anonymous
   APIs; the internal header works only with the right secret and only on
   the three allowed paths; system-mail refuses free-form content and
   doesn't log links in production.

## Don't
- No per-workspace data split, no connections or credentials work (M2,
  M3, M4).
- Don't remove existing pages or features.
- No billing.
- Don't request any Google scope beyond `openid email profile`.

## Done when
- typecheck, tests (minus the Windows baseline) and build pass.
- Locally with no SMTP: sign up by magic link (link from the console),
  create a workspace, invite a second email, accept it in a private
  window, confirm roles, switch workspaces, sign out. Note results in the
  Report.
- Anonymous `curl -i http://localhost:4100/` → redirect to `/sign-in`;
  anonymous `curl -i http://localhost:4100/api/agents` → 401; the cron tick
  keeps running (log line).

## Report (Codex fills this in)
- Status:
- Commits:
- Better Auth version and compatibility check:
- Typecheck / tests / build:
- Manual flow results:
- API routes not calling the session helper (should be none):
- New env vars:
- What changed beyond the spec, and why:
- Questions or blockers for Claude:

## Claude decision (confirmed by Noe in chat)

The instrumentation test changes are approved: send `x-nosteros-internal`
using `NOSTEROS_INTERNAL_SECRET`, and also send the `founder_os_access`
cookie when `FOUNDER_OS_ACCESS_TOKEN` is configured. Retain empty-secret
and failed-response checks. The outer password gate still applies.
