# Plan 093: Bootstrap the MCP SQLite database through a temp file and rename

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

The MCP server bootstraps `mindwtr.db` from a legacy `data.json` by creating the database in place. A SIGKILL, host startup timeout, or the server's own SIGINT handler calling `process.exit` mid-bootstrap leaves a schema-only, zero-row database; the next start sees the file exists and serves an empty library forever, and a first `--write` makes the desktop stop migrating `data.json` too.

## Current state

- `apps/mcp-server/src/db.ts:121` — `ensureMindwtrDbPath` returns early on `existsSync(path)`.
- `db.ts:100-113` — creates the db in place; `rmSync` rollback runs only on a thrown error.
- `apps/mcp-server/src/index.ts:880-883` — SIGINT/SIGTERM handler calls `process.exit(0)` with no bootstrap cleanup.
- `packages/core/src/sqlite-adapter.ts:1189,1537-1550` — `saveData` is one `BEGIN IMMEDIATE ... COMMIT`, so the interrupted state is exactly 'schema present, zero rows'.
- Contrast: desktop re-migrates when `!sqlite_has_any_data && data_path.exists()` (`apps/desktop/src-tauri/src/storage.rs:3899`).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| MCP tests | `rtk bun run --filter mindwtr-mcp test -- src/db.test.ts` | pass |
| Typecheck | `rtk bun run typecheck:mcp` | exit 0 |
| Lint | `rtk bun run lint:mcp` | exit 0 |

## Scope

**In scope** (the only files you may modify):
- `apps/mcp-server/src/db.ts` (+ `db.test.ts`)

**Out of scope** (do NOT touch):
- Path discovery, the write lock, core adapter
- Locale files under `packages/core/src/i18n/locales/` (no new strings in this plan).

## Git workflow

- Branch: `agent/<slug>`; one commit for this plan, message: `fix(mcp): bootstrap the database atomically`
- Message style: repo history (`type(scope): imperative summary`, no tooling mentions). Do not push.

## Steps

### Step 1: red test
Simulate an interruption: make the adapter's `saveData` reject after `ensureSchema`, then assert the canonical `dbPath` does not exist afterwards; add a second case where the process is 'killed' (skip cleanup) — assert the canonical path still does not exist because the work happened at a temp path.
**Verify**: the second case fails today.

### Step 2: temp + rename
Build into `${dbPath}.bootstrap-tmp` (remove any stale one first), close the client (checkpoints the WAL), then `renameSync` onto `dbPath`; remove `-wal`/`-shm` siblings of the temp path. Keep the existing rollback for the thrown-error path.
**Verify**: both tests pass; the existing bootstrap tests pass.

## Test plan

- Cases above in `db.test.ts`, following its existing temp-dir fixture pattern.

## Done criteria

- [ ] `rtk bun run --filter mindwtr-mcp test` pass
- [ ] typecheck + lint clean
- [ ] `git status --short` shows no files outside the in-scope list
- [ ] `git diff --check` clean

## STOP conditions

- `createBootstrapSqliteClient` cannot open a non-canonical path on one of the two SQLite drivers (bun:sqlite vs better-sqlite3) — report which.
- The "Current state" excerpt does not match the live code.
