# Handoff specs

Each task Claude hands to Codex is one file here, numbered in order:
`001-upgrade-next-16.md`, `002-...`. The spec is the whole instruction;
Codex shouldn't need the chat history to do the work.

## Template

```markdown
# NNN: Title

Status: ready | in progress | done | blocked
Review by Claude: yes | no

## Goal
One or two sentences: what changes and why.

## Context
What Codex needs to know that isn't obvious from the code.

## Do
Numbered steps or a clear list of changes.

## Don't
What's out of scope.

## Done when
Checks that prove it works. Always includes typecheck, tests (minus the
known Windows baseline in AGENTS.md), and build.

## Report (Codex fills this in)
- Status:
- Commits:
- Typecheck / tests / build:
- What changed beyond the spec, and why:
- Questions or blockers for Claude:
```
