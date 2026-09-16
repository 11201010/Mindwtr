# Plan 096: Widen the load(load(x)) idempotence test to the risky migration shapes

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report; do not improvise. When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat efa1e374e..HEAD -- <in-scope paths>` — if any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `efa1e374e`, 2026-09-16

## Why this matters

The guardrail `load(load(x)) === load(x)` is proven only on a fixture that none of the risky migrations touch (no archived project, section, tombstone, attachment, saved filter, cancelled entity). A migration that re-stamps rev on every load (the sync rewrite-loop class fixed twice in this batch) would pass today's test.

## Current state

- `packages/core/src/store-load-migrations.test.ts:508-529` — the sole pipeline idempotence test; fixture: one task with `dueDate`, one project with legacy `areaTitle`, one area, `migrations.version: 0`.
- `store-load-migrations.ts:770-794` — 18 registered migrations; `recover-legacy-project-references` (now one-shot via a device-local migrations key), `archive-descendants-of-archived-projects`, `clear-deleted-task-project-archive-metadata`, `repair-dangling-entity-references`, `auto-archive-stale-tasks`, `normalize-people-for-load`, `dedupe-areas-by-name`, `purge-expired-tombstones` are outside the fixture.
- Assertions to keep: `expect(second.applied).toEqual([])` and `expect(second.data).toBe(first.data)`.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Core tests | `rtk bun run --filter @mindwtr/core test -- src/store-load-migrations.test.ts` | pass |

## Scope

**In scope** (the only files you may modify):
- `packages/core/src/store-load-migrations.test.ts`

**Out of scope** (do NOT touch):
- Any migration's production code (a red result is a finding to report, not fix here)
- Locale files under `packages/core/src/i18n/locales/` (no new strings in this plan).

## Git workflow

- Branch: `agent/<slug>`; one commit for this plan, message: `test(core): prove load migrations are idempotent on archive and tombstone shapes`
- Message style: repo history (`type(scope): imperative summary`, no tooling mentions). Do not push.

## Steps

### Step 1: fixture
Build one fixture with: an archived project with a reference child carrying the legacy completion markers, an archived section (`deletedAt == projectArchivedAt`), an expired task tombstone and an expired section tombstone, a task with a file attachment, a saved filter, a cancelled task, two areas with the same name, a person, and a stale `next` task old enough for auto-archive. Use the file's existing clock helpers (`NOW_ISO`, `NOW_MS`).

### Step 2: property
Run the pipeline twice; keep the two assertions; run a third time with the clock advanced past the 24 h tombstone-cleanup throttle and assert again.
**Verify**: passes. If any migration re-applies, STOP and report the migration name and the diff.

## Test plan

- The widened property above.

## Done criteria

- [ ] `rtk bun run --filter @mindwtr/core test -- src/store-load-migrations.test.ts` pass
- [ ] `git status --short` shows no files outside the in-scope list
- [ ] `git diff --check` clean

## STOP conditions

- The property fails for a migration (report; do not weaken the assertion).
- The "Current state" excerpt does not match the live code.
