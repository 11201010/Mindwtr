# Plan 099: Recover from mutex poisoning on the local API write lock and the data.json publication lock

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

Every local API write route takes `write_lock.lock().map_err(...)`; requests run on their own threads, so one panic in a handler poisons the `Mutex<()>` for the life of the process and every POST/PATCH/DELETE returns 500 until restart while reads keep working. The codebase's own rule for the sibling config lock is to recover, because a `Mutex<()>` protects no state a panic could half-mutate.

## Current state

- `apps/desktop/src-tauri/src/local_api.rs:703, 737, 786, 821, 845, 866` — `write_lock.lock().map_err(|e| e.to_string())?`; `:349`, `:363` the same on the runtime lock, while `:320-322` already uses `unwrap_or_else(|poisoned| poisoned.into_inner())`.
- `apps/desktop/src-tauri/src/storage.rs:725-729` — `lock_data_json_publication` uses `map_err`; caller `write_data_json_best_effort` (`:1039-1042`) only logs.
- `apps/desktop/src-tauri/src/config.rs:1202-1212` — the recovering form and its rationale.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Rust tests | `rtk cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib local_api` | pass |
| Full lib | `rtk cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib` | pass |

## Scope

**In scope** (the only files you may modify):
- `apps/desktop/src-tauri/src/local_api.rs`
- `apps/desktop/src-tauri/src/storage.rs` (`lock_data_json_publication` only)

**Out of scope** (do NOT touch):
- Lock ordering (memory: ONE outer config.toml lock; do not reorder any lock acquisition)
- Locale files under `packages/core/src/i18n/locales/` (no new strings in this plan).

## Git workflow

- Branch: `agent/<slug>`; one commit for this plan, message: `fix(desktop): recover poisoned local API and publication locks`
- Message style: repo history (`type(scope): imperative summary`, no tooling mentions). Do not push.

## Steps

### Step 1: red test
Poison the write lock from a panicking thread (`std::panic::catch_unwind` around a thread that panics while holding the guard), then call a write route helper and assert it succeeds.
### Step 2: recover
Add a small `fn lock_recovering<T>(m: &Mutex<T>) -> MutexGuard<T>` next to the existing runtime-lock site (or reuse config.rs's helper if it is `pub(crate)`) and use it at the nine sites. No lock order changes.
**Verify**: test passes; full lib passes.

## Test plan

- The poison test above.

## Done criteria

- [ ] `rtk cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib` pass
- [ ] rustfmt clean on touched files
- [ ] `git status --short` shows no files outside the in-scope list
- [ ] `git diff --check` clean

## STOP conditions

- Any site holds a `Mutex<State>` with real state rather than `Mutex<()>` (recovering there needs a decision; report the site).
- The "Current state" excerpt does not match the live code.
