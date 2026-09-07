# Plan 077: Persist expiry of the last SQLite tombstones safely

## Status
- Priority: P2; effort: M; risk: MED; category: bug.
- Planned at: `77137ce0d`, 2026-09-07. Depends on: none.
- Executor follows this self-contained plan; root maintains the index and commits once. No push.

## Why this matters
When the last retained deletion records expire, the load migration empties the library. The shared SQLite adapter rejects that legitimate empty snapshot, retries five times, and leaves a persistent save-failure banner. Settings-only writes also fail until an entity is added. Preserve the empty-snapshot data-loss backstop while accepting verified expired records.

## Current state and constraints
- `packages/core/src/sqlite-adapter.ts:1143-1164`: `if (incomingEntityCount === 0)` counts every row and throws `Refusing to overwrite existing data with an empty snapshot; local data left untouched` when any exist. This runs before `BEGIN IMMEDIATE`.
- Its `lastKnownRowVersions` records id/rowid/rev/updatedAt observed through reads/successful writes. `syncIds` at ~1311 removes omitted rows only by that compare-and-swap tuple inside the transaction. Never weaken this protection.
- `packages/core/src/sync-tombstones.ts:105-167` owns expiry. Default retention is 90 days; invalid timestamps remain. Tasks/projects use a valid purgedAt in preference to deletedAt, and require deletedAt; sections/areas/people use deletedAt. Equality at the cutoff expires.
- `packages/core/src/store-load-migrations.ts:615-663` invokes this default retention cleanup. `store-settings.ts:318-372` deliberately allows that shrink at its separate partial-snapshot guard.
- ADR0005 and ADR0020 require eventual retention expiry. Ordinary unknown empty snapshots must still fail closed.
- Desktop Rust already supports verified pruning through baseline CAS: `storage.rs:947-961`, test `observed_last_tombstone_can_be_physically_pruned` at ~7704. No native source change is needed.
- Existing `sqlite-adapter.test.ts` uses real SQLite via Bun or better-sqlite3, with `SqliteClient` wrappers. Follow that pattern, not a mock SQL interpreter.

## Scope
Only `packages/core/src/sqlite-adapter.ts`, `sqlite-adapter.test.ts`, `sync-tombstones.ts`, `sync-tombstones.test.ts`, `release-diagnostics-fields.test.ts`, and `docs/release-notes/diagnostics-ledger.md`. A new focused core store integration test file is allowed if needed; root must be told its path. Do not alter store migration policy, snapshots/sync formats, retention duration, Rust behavior, or existing deletion CAS.

## Design
Move the empty-snapshot proof under the existing `BEGIN IMMEDIATE` transaction and before writes. If persisted entity rows exist, permit the empty result only when every row is an observed, unchanged, expired tombstone under the existing default retention semantics. Validate id/rowid/rev/updatedAt against the observed baseline; missing baseline, live/recent/invalid-date rows, or a concurrent addition/change reject and roll back. Reuse the existing expiry decision through a small shared predicate only if necessary; replace existing repeated policy with it, and preserve all timestamp semantics. Do not introduce a caller-controlled bypass boolean or trust a metadata timestamp as authorization. Keep existing CAS deletion and settings persistence.

After a successful commit using this specific exception, emit a privacy-safe diagnostic `extra.releaseCheck = v1.2.9/sqlite-final-tombstone-expiry`, with count/outcome only. Register any new core diagnostic fields and add the ledger entry; never log entity ids/text, URLs, or field names containing key/pass/user.

## Execution and tests
1. Drift check: `rtk git diff --stat 77137ce0d..HEAD -- packages/core/src/sqlite-adapter.ts packages/core/src/sync-tombstones.ts`. Compare any changes to excerpts; report mismatch.
2. Add real SQLite red regressions: last expired task and each of project/section/area/person; cleanup result and a settings-only followup persist. Exercise actual store fetch/flush once to prove no persistenceFailure.
3. Implement transaction-bound proof. Test live, recent, invalid timestamp, recent purgedAt with old deletedAt, unobserved row, concurrently inserted row, and concurrently advanced row all reject without deleting or changing settings. Test fresh truly empty database still saves. Existing guard tests stay intact.
4. `rtk bun run --cwd packages/core test src/sqlite-adapter.test.ts src/sync-tombstones.test.ts src/release-diagnostics-fields.test.ts` must pass. Include the new integration file if created.
5. `rtk bun run typecheck:core` and `rtk bun run lint:core` exit 0.
6. `rtk bun test scripts/ci/validate-diagnostics-ledger.test.js` exits 0. Root runs Rust `observed_last_tombstone_can_be_physically_pruned` and complete final gates.
7. `rtk git diff --check` exits 0; status contains only allowed files. Return exact red/green evidence and result report; do not commit.

## Worktree and maintenance
Assigned checkout will be under `/home/dd/worktrees/Mindwtr/`. You are not alone; preserve others' edits. Set TMPDIR/BUN_TMPDIR to a dedicated directory under `/home/dd`; dependencies/build outputs never go in /tmp or /dev/shm. CodeGraph before structural/source exploration, prefix shell commands rtk, no crash logs. Use TDD/design guardrails. STOP and report if proof needs a public storage-interface change, weakens empty-save/CAS protection, cannot identify unchanged rows, or a gate fails twice. Future retention changes must update the shared predicate and adapter tests together.
