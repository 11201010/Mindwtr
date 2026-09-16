# Plan 100: Route the MCP server's own logger through core's sanitizer

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report; do not improvise. When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat efa1e374e..HEAD -- <in-scope paths>` — if any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `efa1e374e`, 2026-09-16

## Why this matters

The MCP server's `logError`/`logInfo` write `error.message`, `error.stack` and free-form context to stderr unsanitized, while the core log bridge twelve lines away sanitizes. A thrown error that embeds a token or a path with a secret reaches the host's log.

## Current state

- `apps/mcp-server/src/index.ts:74-96` — `writeLog` → `process.stderr.write(JSON.stringify(entry))`; `logError` puts `error.message` and `error.stack` into `context` unsanitized.
- The core bridge in the same file (search `setLogger`) applies core's `sanitizeForLog` (verify the exact name in `packages/core/src/logger.ts` / `log-sanitizer`).
- Memory: the sanitizer redacts field names containing the substring `key`; keep field names as they are.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| MCP tests | `rtk bun run --filter mindwtr-mcp test -- src/index.test.ts` | pass |
| Typecheck | `rtk bun run typecheck:mcp` | exit 0 |

## Scope

**In scope** (the only files you may modify):
- `apps/mcp-server/src/index.ts` (logger helpers only) + `index.test.ts`

**Out of scope** (do NOT touch):
- Core sanitizer, protocol stdout handling (6446ed0 already routes core logs to stderr — keep it)
- Locale files under `packages/core/src/i18n/locales/` (no new strings in this plan).

## Git workflow

- Branch: `agent/<slug>`; one commit for this plan, message: `fix(mcp): sanitize the server's own log lines`
- Message style: repo history (`type(scope): imperative summary`, no tooling mentions). Do not push.

## Steps

### Step 1: red test
Call `logError('x', new Error('token=abc123 in /home/u/secret'))` with stderr captured and assert the raw secret-looking value is redacted the same way the core bridge redacts it.
### Step 2: sanitize
Pass `context` (and message) through the same core sanitizer the bridge uses before `writeLog`.
**Verify**: test passes; the stdout-purity test (`cli.test.ts`) still passes.

## Test plan

- Case above.

## Done criteria

- [ ] `rtk bun run --filter mindwtr-mcp test` pass
- [ ] typecheck clean
- [ ] `git status --short` shows no files outside the in-scope list
- [ ] `git diff --check` clean

## STOP conditions

- Core does not export the sanitizer (report; do not copy it).
- The "Current state" excerpt does not match the live code.
