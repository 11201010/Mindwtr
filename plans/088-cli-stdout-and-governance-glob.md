# Plan 088: Keep core logs off the CLI's stdout and run every scripts test in the governance gate

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report; do not improvise. When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat efa1e374e..HEAD -- <in-scope paths>` — if any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `efa1e374e`, 2026-09-16

## Why this matters

`scripts/mindwtr-cli.ts` prints `ok` (and a new task id) on stdout as its machine-readable contract, but core's default logger sink is `console.info` (stdout). A core `logInfo` that fires during `delete` now prints a JSON object before `ok`, so shell scripts that parse the CLI break. The test that catches it (`scripts/mindwtr-cli.test.ts`) fails today and has never been run by CI because `test:governance` is a hand-maintained list.

## Current state

- `scripts/mindwtr-cli.ts:154,160,166` — print the literal `ok`; `:118` prints the new task id. This is the CLI's stdout contract.
- `packages/core/src/logger.ts:48` — default sink is `console.info`; `:53` exports `setLogger`.
- `packages/core/src/sync.ts:1183-1188` — `logInfo('Sync merge skipped unchanged attachment copies', ...)` fires inside the merge the CLI `delete` runs.
- `scripts/mindwtr-cli.test.ts:141` expects `ok` and currently fails (12 pass, 1 fail across `scripts/mindwtr-cli.test.ts` + `scripts/mindwtr-api.test.ts`); neither file is referenced by `package.json` or any workflow.
- `package.json` `test:governance` — explicit list of `scripts/ci/*.test.*` files plus two `python3` calls; the batch commit `ci: run every scripts/ci validator in the governance gate` appended two more names to it.
- Convention: the desktop and mobile apps install their own logger sinks at startup; scripts are the only core consumers that do not.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Governance | `rtk bun run test:governance` | exit 0 |
| Script tests | `bun test scripts/mindwtr-cli.test.ts scripts/mindwtr-api.test.ts` | all pass |
| Typecheck | `rtk bun run typecheck:core` | exit 0 |

## Scope

**In scope** (the only files you may modify):
- `scripts/mindwtr-cli.ts`, `scripts/mindwtr-api.ts` (logger sink only)
- `package.json` (`test:governance` script only)
- `scripts/mindwtr-cli.test.ts` (only if an assertion must name stderr)

**Out of scope** (do NOT touch):
- `packages/core/src/logger.ts` (do not change the default sink; apps rely on it)
- Any `scripts/ci/*` validator
- Locale files under `packages/core/src/i18n/locales/` (no new strings in this plan).

## Git workflow

- Branch: `agent/<slug>`; one commit for this plan, message: `fix(cli): keep core logs off stdout and run every scripts test in CI`
- Message style: repo history (`type(scope): imperative summary`, no tooling mentions). Do not push.

## Steps

### Step 1: route core logs to stderr in both scripts
At the top of `scripts/mindwtr-cli.ts` and `scripts/mindwtr-api.ts`, after the core import, call `setLogger` with a sink that writes each entry as one JSON line to `process.stderr` (mirror the shape the MCP server uses in `apps/mcp-server/src/index.ts` `writeLog`). Do not change any stdout print.
**Verify**: `bun test scripts/mindwtr-cli.test.ts` → the `ok` expectation passes.

### Step 2: replace the hand list with a glob
Change `test:governance` so the `bun test` portion is `bun test scripts/ci scripts/*.test.ts` (keep both `python3 ...test.py` calls exactly as they are). Confirm every file previously listed is still matched (`ls scripts/ci/*.test.*`).
**Verify**: `rtk bun run test:governance` → exit 0 and the run lists `scripts/mindwtr-cli.test.ts` and `scripts/mindwtr-api.test.ts`.

## Test plan

- Existing `scripts/mindwtr-cli.test.ts:141` is the regression test (currently red → green). Add one assertion that stdout for `delete` is exactly `ok\n`.
- `rtk bun run test:governance` → exit 0.

## Done criteria

- [ ] `bun test scripts/mindwtr-cli.test.ts scripts/mindwtr-api.test.ts` all pass
- [ ] `rtk bun run test:governance` exit 0 and includes the two script test files
- [ ] `rtk bun run typecheck:core` exit 0
- [ ] `git status --short` shows no files outside the in-scope list
- [ ] `git diff --check` clean

## STOP conditions

- `bun test scripts/ci scripts/*.test.ts` picks up a file that is not a `bun:test` file (report it instead of excluding it silently).
- The "Current state" excerpt does not match the live code.
