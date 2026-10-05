# Starting a fresh Claude session on OmegaOS

## Current instruction - October 5, 2026
Noe has restored Claude as lead architect; Codex / Astra is the builder.
Read the October 5 current-status section at the top of
`HANDOFF-TO-ASTRA.md` and the current agreement in `AGENTS.md` first.
The historical October 3 status below is not a current backlog.
The product is OmegaOS (red/charcoal/white); the repo folder remains nosterOS.

Written Oct 3, 2026 so a new Claude chat can pick up without the old
chat's history. Read this, then the files it points to.

## Where everything lives
- **Code (Noe's PC):** `C:\Users\noster\Documents\GitHub\nosterOS`. Ask
  for folder access to exactly this path (`device_request_folder_access`).
  Read and write docs/specs there with `device_stage_files` /
  `device_commit_files`. Files use CRLF line endings; stage first and pass
  `expectedMtimeMs` when editing, because Astra commits often and an
  uncommitted edit can be overwritten.
- **GitHub:** https://github.com/nosterCodez/nosterOS (public fork of
  Bennettxai/FounderOS-DEMO, MIT). This Claude environment can't push to
  it; Astra pushes. For reviews, clone it in the cloud sandbox with
  `git clone https://github.com/nosterCodez/nosterOS.git` and run
  `npm ci`, `npx vitest run`. `npm run build` there fails only because
  Google Fonts is blocked in the sandbox; the build passes on Noe's PC.
- **Checklist (claude.ai artifact):**
  https://claude.ai/artifact/3dvhC2oYQ6ypT3qnNR1GYt. Items live in the
  artifact's database collection `items` (fields: order, phase, title,
  detail, kind, priority, status todo/doing/done). Update rows with the
  ArtifactData tool, pinning `if_version`.

## Read first, in this order
1. `AGENTS.md`: roles and rules. Claude is lead architect; Astra (Codex in
   the ChatGPT desktop app) implements reviewed specs and reports back.
   Noe approves money, real messages, credentials, legal text, publishing
   and deleting data.
2. `docs/handoff/HANDOFF-TO-ASTRA.md`: full state, decisions, roadmap,
   invariants, open items for Noe.
3. `docs/architecture/multi-tenant.md`, then
   `docs/architecture/dashboard.md`.
4. `docs/handoff/BRAND-omegaos.md` and `docs/architecture/reel-reference.md`:
   OmegaOS red/charcoal/white branding supersedes the historical dark/green
   reference, while the radial brain and work-focused dashboard remain relevant.
5. `docs/handoff/` specs. The Report section at the bottom of each shows
   what's done.

## Historical status on Oct 3 (see October 5 handoff for current status)
Done: 001 (Next 16), 002 (deploy-safe), 003 (metric store), 003b
(security: production audit 0). In progress: M1 (accounts and workspaces,
Better Auth). Next: M2 (`docs/handoff/M2-workspace-data-isolation.md`,
written), then the rest of the roadmap in the handoff file.

## How to talk to Astra
- Astra is the ChatGPT desktop app on Noe's Windows PC, chat **"Add
  marketing subdomain landing page"** (marketing project). Only that chat
  and "Automated Selling Main Chat" may be used, never any other chat.
- Computer-use access: `computer_resolve_access` for `ChatGPT` and
  `textinputhost.exe`, then `computer_request_access`. Grants expire after
  30 minutes idle, so batch messages. Chrome is view-only for computer use;
  use the Claude in Chrome extension for web pages.
- To send a message: open ChatGPT, click the message box (around x=833,
  y=713 in a 1456×819 screenshot frame), type, press Return. Messages sent
  while Astra is working queue up and run after the current step.
- Keep chat messages short and put details in spec files. Markdown in the
  chat eats backslashes in Windows paths, so write paths with forward
  slashes.
- To watch a video (like an Instagram reel), use the Claude app's Browser
  pane (`Claude_Browser__*` tools): it plays where Chrome background tabs
  freeze. Make the `<video>` fixed full-screen with JS, pause it, seek
  every 2–3 s, and screenshot.

## Noe's preferences
- Don't interrupt with small questions: make the call and keep going.
  Stop only for things he must do himself.
- Plain, short updates. Flag deadlines and time-sensitive items.
