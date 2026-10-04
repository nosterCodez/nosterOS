# M2 final acceptance and main merge

Status: accepted for main merge
Review by Claude: no

## Decision
Noe approved finishing M2 and merging main on October 4, then building M3.
This supersedes M2e's batch-only no-merge restriction. Online-first bootstrap
and the completed real two-workspace browser check supersede local migration.
Legacy local migration remains tested but must not run on Noe's data now.

## Work
- Stop structure seeding sample workflows; retain originals without deletion.
- Exclude unchanged upstream workflow samples from production reads.
- Pin membership, role and workspace within each API request to avoid switch races.
- Re-run transitive connector audit and two-user storage/auth/migration tests.
- Review failures against documented Windows baseline, build, then merge main.

## Report
- Sample workflows moved from structural initialization to explicit demo seeding.
- Unchanged stored samples are filtered from production workflow lists; originals and edited rows remain.
- Session membership now verifies both user and organization; organization lookup pins the captured ID.
- Request-header weak keys retain the authorized context across role checks and subsequent data access.
- Converted request handlers to reuse their Request headers; jobs retain the same request header object.
- Added switch-race and mismatched-membership tests; existing real two-user and migration fixtures pass.
- Transitive connector gate audit passes: remaining global connector caches are operator-only until M3.
- Live two-workspace marker checks were completed in M2e; no real-data migration is required by online-first decision.
- Typecheck/build pass. Full suite: 3,649 passed, four failed assertions in seven documented Windows-baseline files.
- Test changes reflect the explicit no-demo-workflows rule, preserving user-edit and data-survival assertions.
- Security review: no session fallback, path bypass, cross-workspace cache key, or role reuse across request objects.
- No user data deleted, messages sent, credentials connected, or migration run against local data.
- M3 follows on a new branch; deployment branch change is separate from this merge.
