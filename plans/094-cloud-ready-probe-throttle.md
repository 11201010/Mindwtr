# Plan 094: Stop `/ready` from running a synchronous fsync per unauthenticated hit

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report; do not improvise. When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat efa1e374e..HEAD -- <in-scope paths>` — if any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `efa1e374e`, 2026-09-16

## Why this matters

`/ready` is answered before auth and before any rate-limit key, and each hit does `openSync('wx')` → write → `fsyncSync` → `unlinkSync` on the data volume, synchronously on the event loop. On a publicly proxied self-host, any client can saturate a network-backed volume and stall every authenticated request. The other unauthenticated route (the calendar feed) is throttled for exactly this reason.

## Current state

- `apps/cloud/src/server.ts:1340-1345` — `/ready` calls `probeExistingWritableDir(dataDir)` plus two `isOriginalDataDirectory()` checks before auth.
- `apps/cloud/src/server-storage.ts:982-1001` — the probe: `openSync(probePath, 'wx')`, `writeFileSync`, `fsyncSync`, `closeSync`, `unlinkSync`.
- `server.ts:1707-1717` — the feed route runs `rateLimiter.check(...)` first (pattern to reuse).
- `docker/compose.yaml:22-23`, `docker/Caddyfile.https:3-4` — port published; every path proxied.
- The probe has a `probeFileSystem` seam used by tests.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Cloud tests | `rtk bun run --filter mindwtr-cloud test -- src/server.test.ts` | pass |
| Typecheck | `rtk bun run typecheck:cloud` | exit 0 |

## Scope

**In scope** (the only files you may modify):
- `apps/cloud/src/server.ts` (`/ready` handler)
- `apps/cloud/src/server-storage.ts` (probe memo)
- `apps/cloud/src/server.test.ts`

**Out of scope** (do NOT touch):
- `/health` semantics, healthcheck interval in docker files, docs
- Locale files under `packages/core/src/i18n/locales/` (no new strings in this plan).

## Git workflow

- Branch: `agent/<slug>`; one commit for this plan, message: `fix(cloud): throttle the readiness probe`
- Message style: repo history (`type(scope): imperative summary`, no tooling mentions). Do not push.

## Steps

### Step 1: red test
Ten rapid `/ready` requests through the test server → assert the `probeFileSystem` seam recorded at most one `openSync` (memo) and that a burst beyond the limiter's threshold gets 429 (rate limit).
**Verify**: fails.

### Step 2: memo + limiter
Cache the probe verdict for a short TTL (e.g. 5 s, shorter than the 90 s healthcheck interval) keyed by dataDir; run `/ready` through `rateLimiter.check('ready-client:' + clientKey)` like the feed route. A cached failure must still be re-probed after the TTL.
**Verify**: tests pass.

## Test plan

- Cases above; existing `/ready` tests unchanged.

## Done criteria

- [ ] `rtk bun run --filter mindwtr-cloud test` pass
- [ ] typecheck clean
- [ ] `git status --short` shows no files outside the in-scope list
- [ ] `git diff --check` clean

## STOP conditions

- The limiter cannot be keyed without an authenticated namespace (check how the feed route derives its client key first).
- The "Current state" excerpt does not match the live code.
