# nosterOS multi-tenant architecture

Owner: Noe. Architect: Claude. Written Oct 3, 2026. Level 5.
Read with `docs/architecture/dashboard.md`. Where they conflict, this file
wins.

## Who uses it

| Who | What they get |
|---|---|
| Founders who sign up | Their own workspace: connect their own Google, Meta, Stripe, Etsy, TikTok, LinkedIn; their own dashboard, agents and alerts. |
| The nosterCodes team (Noe, Jesus, staff) | The nosterCodes workspace, with per-person roles. |
| nosterMarketing clients | Their own workspace, like any founder. When nosterMarketing does their marketing, the client approves an **agency link** so our team can see their progress. The client can revoke it any time. |

## Core decision: one database per workspace

- `DATA_DIR/control.db` is the control plane: users, sessions, workspaces,
  memberships, invitations, agency links, audit log.
- `DATA_DIR/workspaces/<workspaceId>.db` holds everything else for one
  workspace: the full existing FounderOS schema, `metric_points`,
  `collector_runs`, `insights`, connections. One customer's data is in a
  different file from every other customer's, so a missed filter can't leak
  data across accounts.
- This keeps the existing synchronous better-sqlite3 code. The limits: one
  app server with the volume (fine into the hundreds of workspaces), and
  cross-workspace queries need explicit fan-out. If we outgrow it, the files
  can move to libSQL/Turso without changing the model.

## Identity and roles

- **Library:** Better Auth with its organization plugin. Its "organization"
  is our workspace; members, roles and invitations come with it. Stored in
  `control.db`. Codex verifies Next.js 16 + better-sqlite3 support before
  building on it.
- **Sign-in:** email magic link and "Sign in with Google" asking only for
  `openid email profile`. Login never requests data scopes, so login
  itself never needs Google's app review.
- **Workspace roles:** `owner` (billing, delete, agency links), `admin`
  (connections, members), `member` (use everything, no connections or
  members), `viewer` (read-only).
- **Agency access:** `agency_links(agency_workspace_id, client_workspace_id,
  access: 'view' | 'manage', status: 'pending' | 'active' | 'revoked',
  requested_by, approved_by, created_at, revoked_at)`. The client
  workspace's owner approves. `view` = dashboards, insights and reports.
  `manage` = also run agents and edit content. Agency users never see the
  client's credentials. Every agency read and write goes to `audit_log`.
- The current `FOUNDER_OS_ACCESS_TOKEN` gate stays as an optional outer
  wall during the private beta, then goes away.

## Workspace context: fail closed

- Every entry point (route handler, page, server action, background job)
  resolves `{ user, workspace, role }` from the session and runs its work
  inside `withWorkspace(ctx, fn)`.
- `getDb()` returns the current workspace's database from that context. If
  there's no context it **throws**, and never falls back to a default
  workspace. The ~300 existing `getDb()` call sites keep their shape;
  the safety comes from the throw.
- Module-level caches (email cache, connector caches, brain provider,
  anything in a top-level `Map` or `let`) get keyed by workspace id. Spec
  M2 includes an audit listing every one.
- Background jobs loop over workspaces explicitly and run each job inside
  that workspace's context, with a per-workspace time budget so one slow
  customer can't stall the rest.

## Credentials

- **Platform secrets** stay in environment variables: the nosterOS
  Google/Meta/TikTok/LinkedIn/Etsy OAuth client ids and secrets,
  `NOSTEROS_MASTER_KEY`, and SMTP for system emails.
- **Customer credentials** live in that workspace's DB, `connections`
  table, encrypted with envelope encryption: a per-workspace data key
  (AES-256-GCM) encrypts tokens, and the master key encrypts the data key.
- `resolveCred(key)` reads the current workspace's connections. It never
  falls back to another workspace, and never falls back to environment
  variables for customer data. Otherwise a new customer would see Noe's
  Stripe numbers.
- Connect flows: OAuth through the platform apps, with the workspace id in
  the signed state, for Google, Meta, TikTok, LinkedIn and Etsy. Pasted
  keys for Stripe (ask for a restricted read-only key). An IMAP app password
  for email inboxes.

## Host-level features are off for customers

Several upstream FounderOS features reach the server itself: agents with
shell access (Paperclip/Hermes), the Telegram bridge into those agents,
connectors reading home-directory files (Obsidian, Plaud, Zernio config,
`readEnvFileSafe` in `lib/creds.ts`), trading. On a shared server those are
dangerous. They're gated to the operator workspace (nosterCodes) and only
when `NOSTEROS_OPERATOR_FEATURES=1`. Customer workspaces get the cloud-safe
equivalents: Telegram alerts only (no command channel), and connectors
that use OAuth or pasted keys only.

## What Google and Meta require (start now, slowest part)

- **Google:** reading other people's Search Console, Analytics, Business
  Profile, YouTube and Ads data means a verified OAuth app. Unverified apps
  cap at 100 users. As far as I can tell, all our planned data scopes are
  "sensitive", not "restricted": manual review, roughly 4–6 weeks, free.
  Codex confirms each scope's class when writing the Connections spec.
  Reading Gmail through Google's API would be "restricted" (a paid security
  assessment, months), which is why Comms uses IMAP app passwords instead.
- **Meta:** Advanced Access for each permission (Instagram insights, Pages,
  `ads_read`) needs Business Verification first, the app in Live mode, a
  public privacy policy on our domain, a data-deletion callback or
  instructions URL, a written reason and a screencast per permission, using
  a real Business account.
- **Both need:** a published privacy policy and terms on the nosterOS
  domain, and a legal business name for verification. The Oct 2026 legal
  drafts are the starting point; the business-entity question in them now
  blocks app review.
- **TikTok and LinkedIn:** developer app review, as before.

## Data rights

- Delete a workspace: its DB file, its tokens revoked at each provider, its
  memberships and agency links. Delete an account: memberships, and the
  workspaces it solely owns.
- Export a workspace: a zip of its DB plus a CSV of metrics.
- Meta data-deletion callback endpoint.
- Backups: nightly SQLite online backup of every DB to off-volume storage,
  keeping 14 days.

## Build order

The multi-tenant track runs after 003/003b and before any real data
connector, because every connector depends on per-workspace credentials.

| # | Spec |
|---|---|
| M1 | Control DB + Better Auth: sign-up, magic link, Google sign-in, workspaces, roles, invitations, session-based gate |
| M2 | Per-workspace DB files, fail-closed `getDb()`, cache audit, migrate today's DB into the nosterCodes workspace |
| M3 | Encrypted per-workspace credentials, `resolveCred` refactor, operator-only gating of host-level features |
| M4 | Connections page and OAuth connect flows (replaces the old token-store spec) |
| M5 | Background jobs and collectors per workspace, with budgets |
| M6 | Agency links, client approval, audit log |
| M7 | Deletion, export, Meta deletion callback, privacy/terms pages, backups |

Then the dashboard connectors (Search Console, Stripe, Meta, ...) resume
per workspace. A private Railway deploy for the team can happen after M2.
