# Plan 102: Record a Mind Sweep capture only when the store accepted it

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report; do not improvise. When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 0b9ea1d0e..HEAD -- <in-scope paths>` — if any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `0b9ea1d0e`, 2026-09-16

## Why this matters

Mind Sweep appends the title to the captured list and clears the draft without reading the `addTask` result, on both platforms. The summary step then says N items captured while fewer tasks exist; on mobile a thrown error shows nothing at all.

## Current state

- `apps/desktop/src/components/MindSweepModal.tsx:59-63` — `await addTask(title, { status: 'inbox' })` then unconditional append; `:10` types the prop as `Promise<unknown>`; `:67-69, 173-175` already render `t('task.addFailed')` for thrown errors.
- `apps/mobile/components/mind-sweep-modal-content.tsx:47-55` — same append; `catch { /* keep the draft */ }` with no message.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Desktop | `cd apps/desktop && rtk bun run test -- MindSweep` | pass |
| Mobile | `rtk bun run --filter mobile test -- mind-sweep` | pass |
| Typecheck | `rtk bun run typecheck:desktop && rtk bun run typecheck:mobile` | exit 0 |

## Scope

**In scope** (the only files you may modify):
- `apps/desktop/src/components/MindSweepModal.tsx` (+ test)
- `apps/mobile/components/mind-sweep-modal-content.tsx` (+ test)
- The two callers that pass `addTask` (prop type only)

**Out of scope** (do NOT touch):
- Store actions
- Locale files under `packages/core/src/i18n/locales/` (frozen this batch; reuse existing keys only).

## Git workflow

- One commit for this plan, message: `fix: count a Mind Sweep item only when its capture succeeds`; repo style, no tooling mentions, do not push.

## Steps

### Step 1: red tests (both platforms)
`addTask` resolves `{ success: false }` → title NOT in the captured list, draft kept, `task.addFailed` visible.
### Step 2: check the result
Type the prop as the store's result promise; on `!result.success` set the error state (desktop already has `addFailed`; add the same on mobile using the existing `task.addFailed` key) and keep the draft.
**Verify**: red→green on both.

## Test plan

- One red→green case per platform.

## Done criteria

- [ ] both suites pass; typecheck clean; mobile lint 0 errors
- [ ] `git status --short` shows no files outside the in-scope list
- [ ] `git diff --check` clean

## STOP conditions

- The mobile component has no error slot and adding one needs a new string (report).
- The "Current state" excerpt does not match the live code.
- The fix needs a new locale key (report the proposed key + English text instead).
