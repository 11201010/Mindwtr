# Plan 095: Make the TaskStore write-contract guard falsifiable

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report; do not improvise. When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat efa1e374e..HEAD -- <in-scope paths>` — if any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `efa1e374e`, 2026-09-16

## Why this matters

The runtime guard that throws when an action writes `tasks` instead of `_allTasks` only fires when `NODE_ENV === 'development'`; vitest sets `test`, so the whole core suite never exercises it and a violation ships silently (a previously-visible row dropped from the array is dropped from the saved document).

## Current state

- `packages/core/src/store.ts:245-248` — `shouldEnforceStoreWriteContract()` is true only when `process` is undefined or `NODE_ENV === 'development'`.
- `store.ts:290-296` — the throw `TaskStore invariant violated: write _allTasks instead of tasks/_tasksById` sits behind that gate.
- `store.test.ts:1915-1983` sets `'production'` to exercise the compatibility path; nothing asserts the throw.
- Pattern for env stubbing: `sync-run.test.ts:3579` uses `vi.stubEnv('NODE_ENV', 'development')`.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Core tests | `rtk bun run --filter @mindwtr/core test -- src/store.test.ts` | pass |

## Scope

**In scope** (the only files you may modify):
- `packages/core/src/store.test.ts`

**Out of scope** (do NOT touch):
- `store.ts` production code (unless the guard proves unreachable even in development — then STOP and report)
- Locale files under `packages/core/src/i18n/locales/` (no new strings in this plan).

## Git workflow

- Branch: `agent/<slug>`; one commit for this plan, message: `test(core): prove the store write-contract guard fires`
- Message style: repo history (`type(scope): imperative summary`, no tooling mentions). Do not push.

## Steps

### Step 1: test
Add a `describe` that stubs `NODE_ENV=development`, then asserts both throw sites fire: a visible-only `tasks:` write and a non-array `_allTasks`. Restore the env in `afterEach`.
**Verify**: passes; temporarily comment out the throw and confirm the test goes red, then restore.

## Test plan

- The two assertions above.

## Done criteria

- [ ] `rtk bun run --filter @mindwtr/core test -- src/store.test.ts` pass
- [ ] `git status --short` shows no files outside the in-scope list
- [ ] `git diff --check` clean

## STOP conditions

- The guard cannot be triggered through the public store actions at all (report; that is a separate finding).
- The "Current state" excerpt does not match the live code.
