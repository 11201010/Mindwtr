# Plan 092: Refuse a garbage prefix in the desktop lenient JSON parse

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

The lenient fallback scans forward to the first `{`/`[` anywhere in the file. A torn or NUL-headed `data.json` (VFS/network mount mid-write) can therefore parse an interior object (a single task) as the whole document; `normalize_sync_value` then fabricates empty surfaces, the read 'succeeds' as an empty remote, and this device's snapshot overwrites peer edits. The lenient path was written for a complete document plus a stale tail, which must keep working.

## Current state

- `apps/desktop/src-tauri/src/storage.rs:5486-5489` — `let start = sanitized.find(|c| c == '{' || c == '[').unwrap_or(0); ... Deserializer::from_str(&sanitized[start..])`.
- `:5465-5471` — `sanitize_json_text` strips a leading BOM and trailing NULs only.
- `:10470-10500` — `normalize_sync_value` fabricates empty `tasks/projects/areas/sections/people` and `settings: {}` for any object lacking them.
- `apps/desktop/src-tauri/src/sync.rs:16441-16482` — `sync_payload_is_valid` checks only surfaces that are present.
- Existing tests for `parse_json_relaxed` live in the `mod tests` of storage.rs (search `parse_json_relaxed`).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Rust tests | `rtk cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib parse_json` | pass |
| Full lib | `rtk cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib` | pass |
| Format | `rustfmt --edition 2021 --check apps/desktop/src-tauri/src/storage.rs` | clean |

## Scope

**In scope** (the only files you may modify):
- `apps/desktop/src-tauri/src/storage.rs` (`parse_json_relaxed`, `sanitize_json_text`, tests)
- `apps/desktop/src-tauri/src/sync.rs` (`sync_payload_is_valid` only)

**Out of scope** (do NOT touch):
- The merge engine, snapshot publication, retained-root code
- Locale files under `packages/core/src/i18n/locales/` (no new strings in this plan).

## Git workflow

- Branch: `agent/<slug>`; one commit for this plan, message: `fix(desktop): reject a garbage prefix instead of parsing a nested fragment`
- Message style: repo history (`type(scope): imperative summary`, no tooling mentions). Do not push.

## Steps

### Step 1: red tests
Add: (a) a NUL-prefixed text whose first `{` opens a nested task object → `parse_json_relaxed` returns Err; (b) a complete document followed by a stale tail → Ok (existing behaviour); (c) `sync_payload_is_valid` on `{}` → false.
**Verify**: (a) and (c) fail.

### Step 2: guard
In `parse_json_relaxed`, after `sanitize_json_text`, also strip leading whitespace and NULs; require the first remaining char to be `{` or `[`, otherwise return the strict parse error. Make `sync_payload_is_valid` require at least one recognised surface key (`tasks`, `projects`, `areas`, `sections`, `people`, `settings`, or `version`).
**Verify**: all three tests pass; full lib tests pass.

## Test plan

- Cases (a)–(c) above in storage.rs / sync.rs test modules.

## Done criteria

- [ ] `rtk cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib` pass
- [ ] rustfmt check clean on touched files
- [ ] `git status --short` shows no files outside the in-scope list
- [ ] `git diff --check` clean

## STOP conditions

- An existing test relies on the forward scan for a legitimately-prefixed file shape (report it; that shape needs a decision).
- The "Current state" excerpt does not match the live code.
