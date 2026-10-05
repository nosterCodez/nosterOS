# OmegaOS: how the agents work in this repo

## Current agreement, Oct 5 2026

Noe has returned lead architecture to Claude. Claude owns engineering plans,
specs, architecture/security decisions, and review. Codex / Astra is the
builder again and follows the handoff loop and stop rules below. Do not
continue the roadmap autonomously under the older takeover authorization.
Read the current-status section of `docs/handoff/HANDOFF-TO-ASTRA.md` first;
its filename is retained for continuity. Noe still approves money, real
messages, credentials, legal text, publishing, paid services, and deletion.
This supersedes the Oct 3 architect-and-builder delegation below.

## Historical update, Oct 3 2026 (superseded)

Noe approved Astra taking over as architect and builder. Follow
`docs/handoff/HANDOFF-TO-ASTRA.md`; it supersedes the engineering decision
stop rules below. Record engineering decisions and test changes in each
spec. Escalate money, real messages, credentials, legal text, publishing,
paid services, and data deletion to Noe. Self-review security changes.
This update records the explicit approval given in chat.

OmegaOS is Noe's command center for nosterMarketing, forked from
FounderOS-DEMO (MIT). Repo conventions, stack, and architecture rules are in
`CLAUDE.md`; read it before changing code. This file covers who does what.

## Roles

- **Noe** owns the product: what gets built, priorities, anything involving
  money, clients, credentials, or publishing.
- **Claude (architect)** writes the plan and the specs, makes architecture and
  security decisions, and reviews work that touches them. Claude does not do
  routine implementation.
- **Codex / Astra (builder)** does the implementation: writes the code, runs
  the tests, commits, pushes, and reports back.

## The handoff loop

1. Claude writes a spec in `docs/handoff/NNN-short-name.md` (template in
   `docs/handoff/README.md`).
2. Codex implements exactly that spec, in small commits, on `main` unless the
   spec says otherwise.
3. Before reporting done, Codex runs `npm run typecheck`, `npm test`, and
   `npm run build`, then fills in the **Report** section at the bottom of the
   spec file and pushes.
4. Claude reads the report, reviews the diff when the spec asks for review,
   and writes the next spec.

## When Codex stops and hands back to Claude

Stop, write what you found in the Report section, and don't guess, when:

- the change needs a decision the spec doesn't make (data model, database
  schema, a new dependency, auth or security behavior, anything that sends a
  message or charges money);
- a test has to change what it asserts, not just how it's written;
- the same step has failed twice;
- the work turns out much larger than the spec describes.

## Ground rules

- Never commit secrets. Credentials go in `.env.local`, which is gitignored.
- Nothing sends an email, DM, or invoice to a real person unless Noe
  approves it in the app.
- Keep the MIT `LICENSE` and the upstream copyright notice.
- No upsell or course surfaces (`tests/no-upsell.test.ts` enforces this).

## Known Windows test failures (baseline)

These 6 fail only on Windows and pass on Linux. Don't count them as
regressions, and don't fix them unless a spec asks:
`lead-magnet-actions`, `lead-magnets-route`, `roadmap-mock-5h` (temp-folder
EPERM), `api` and `seed` (5s timeout), `interaction-layer`, `paths`,
`skills-plugins`, `superset-dispatch` (path separators / Windows env).
If a test outside this list fails, it's a real failure.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
