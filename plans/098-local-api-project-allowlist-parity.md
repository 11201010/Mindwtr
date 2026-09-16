# Plan 098: Pin the local API project write allowlist against the project sync schema

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

The task allowlist has a parity test against `task-sync-schema.fixture.json`; the project write path shipped this window with a hand-written seven-key `match` and no equivalent, so adding a writable project field to the schema silently leaves the local API answering 400.

## Current state

- `apps/desktop/src-tauri/src/local_api.rs:1104-1177` — `sanitize_project_fields` matches seven keys, else `Unsupported project field`.
- `packages/core/src/project-sync-schema.fixture.json` — marks 18 project fields cloud-writable; nothing under `src-tauri/src` references it.
- `local_api.rs:5551-5574` — `local_api_patch_allowlist_matches_task_sync_schema` is the pattern (uses `include_str!` on the task fixture).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Rust tests | `rtk cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib local_api` | pass |

## Scope

**In scope** (the only files you may modify):
- `apps/desktop/src-tauri/src/local_api.rs` (tests module only)

**Out of scope** (do NOT touch):
- `sanitize_project_fields` production code (if the test reveals a missing field, report it as a finding with the list; do not widen the allowlist here)
- Locale files under `packages/core/src/i18n/locales/` (no new strings in this plan).

## Git workflow

- Branch: `agent/<slug>`; one commit for this plan, message: `test(api): pin the project write allowlist to the sync schema`
- Message style: repo history (`type(scope): imperative summary`, no tooling mentions). Do not push.

## Steps

### Step 1: test
Copy the task parity test for projects: iterate the fixture's cloud-writable fields; every field NOT in an explicit, commented deny-list (`deletedAt`, `purgedAt`, `cancelledAt`, `attachments`, `areaTitle`, plus any the local API deliberately manages) must be accepted by `sanitize_project_fields`; every denied field must return the `Unsupported project field` error.
**Verify**: run it; if it is red, STOP and report the exact field set.

## Test plan

- The parity test above.

## Done criteria

- [ ] `rtk cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib local_api` pass
- [ ] `git status --short` shows no files outside the in-scope list
- [ ] `git diff --check` clean

## STOP conditions

- The test is red (the deny-list needs an owner decision).
- The "Current state" excerpt does not match the live code.
