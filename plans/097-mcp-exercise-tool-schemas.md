# Plan 097: Exercise the registered MCP tool input schemas in the unit suite

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report; do not improvise. When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat efa1e374e..HEAD -- <in-scope paths>` — if any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `efa1e374e`, 2026-09-16

## Why this matters

The MCP unit suite's mock server discards each tool's `inputSchema`, so no zod cap (search max 512, offset max 100000, limit range, enums) runs in tests. Those caps are the documented defence for the full-table search scan; dropping one leaves the suite green.

## Current state

- `apps/mcp-server/src/index.test.ts:14-22` — `createMockServer`'s `registerTool: (name, _meta, handler)` drops the metadata argument; tests call `handler(input)` directly.
- Caps: `listTasksSchema` (`index.ts:254-269`), `taskTokenSchema` (`:252`), `isoDateLikeSchema` (`input-validation.ts:23`). Only `index.test.ts:580-583` (four `safeParse`) and `http-server.test.ts:283-296` touch schemas.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| MCP tests | `rtk bun run --filter mindwtr-mcp test -- src/index.test.ts` | pass |
| Typecheck | `rtk bun run typecheck:mcp` | exit 0 |

## Scope

**In scope** (the only files you may modify):
- `apps/mcp-server/src/index.test.ts`

**Out of scope** (do NOT touch):
- `index.ts` (schema changes are out of scope; a cap that turns out wrong is a finding)
- Locale files under `packages/core/src/i18n/locales/` (no new strings in this plan).

## Git workflow

- Branch: `agent/<slug>`; one commit for this plan, message: `test(mcp): run tool inputs through their registered schemas`
- Message style: repo history (`type(scope): imperative summary`, no tooling mentions). Do not push.

## Steps

### Step 1: keep schemas in the mock
Change `createMockServer` to retain `_meta.inputSchema` per tool and parse each test input through `z.object(inputSchema)` (or the shape the SDK expects) before invoking the handler.
### Step 2: cases
Add rejection cases: `search` of 513 chars, `offset` 100001, `limit` 0 and `MAX_TASK_LIST_LIMIT + 1`, an invalid `view`, a malformed ISO date; add one assertion that every registered tool has a schema.
**Verify**: suite passes; temporarily drop `.max(512)` locally and confirm the search case goes red, then restore.

## Test plan

- Cases above.

## Done criteria

- [ ] `rtk bun run --filter mindwtr-mcp test` pass
- [ ] typecheck clean
- [ ] `git status --short` shows no files outside the in-scope list
- [ ] `git diff --check` clean

## STOP conditions

- The mock cannot parse inputs without importing SDK internals that the package does not depend on (report).
- The "Current state" excerpt does not match the live code.
