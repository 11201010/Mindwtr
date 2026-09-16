# Plan 101: Keep the typed text when the desktop in-list quick add is rejected

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

The in-list add box clears its input right after `addTask` returns, without checking `result.success`, so a rejected write (container rule, sandbox, persistence failure) drops the user's capture text. CONTEXT.md says a capture is never dropped. This surface also hand-rolls parse → create project → add task instead of the shared capture transaction every other surface uses, so it skips the archived-project guard.

## Current state

- `apps/desktop/src/components/views/ListView.tsx:991-992` — `const result = await addTask(finalTitle, initialProps); setNewTaskTitle('');` (cleared unconditionally); `:1000` uses the result only to highlight; `:1002-1005` `catch` handles thrown errors only; `:969` a failed project create returns silently; `:948-991` hand-rolled flow.
- Shared path: `executeCaptureTransaction` — used by `apps/desktop/src/components/QuickAddModal.tsx:974`, `apps/mobile/components/quick-capture-sheet.tsx:1113`, `apps/mobile/app/capture-modal.tsx:627`; archived-project guard in `packages/core/src/capture.ts:213-216`.
- Existing toast key: `task.addFailed`; invalid-date toast already exists in this file at `:956-959`.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Desktop tests | `cd apps/desktop && rtk bun run test -- src/components/views/ListView` | pass |
| Typecheck | `rtk bun run typecheck:desktop` | exit 0 |
| Lint | `rtk bun run lint:desktop` | exit 0 |

## Scope

**In scope** (the only files you may modify):
- `apps/desktop/src/components/views/ListView.tsx` (+ `ListView.test.tsx`)

**Out of scope** (do NOT touch):
- `packages/core/src/capture.ts`, `QuickAddModal.tsx`
- Locale files under `packages/core/src/i18n/locales/` (frozen this batch; reuse existing keys only).

## Git workflow

- One commit for this plan, message: `fix(desktop): keep the in-list capture text when the write is rejected`; repo style, no tooling mentions, do not push.

## Steps

### Step 1: red test
ListView test: mock the store so `addTask` resolves `{ success: false, error: 'x' }` → the input still holds the typed text and a toast with `task.addFailed` appears.
### Step 2: shared path
Route `handleAddTask` through `executeCaptureTransaction` (status-filter and copilot-token additions move into its `transformProps` hook); clear the input only when `result.success`; toast `task.addFailed` otherwise. Keep the row highlight on success.
**Verify**: red→green; the rest of the ListView suite passes.

## Test plan

- The red→green case; existing in-list add tests unchanged.

## Done criteria

- [ ] ListView suite passes; typecheck + lint clean
- [ ] `git status --short` shows no files outside the in-scope list
- [ ] `git diff --check` clean

## STOP conditions

- `executeCaptureTransaction` cannot express one of this surface's props (report which).
- The "Current state" excerpt does not match the live code.
- The fix needs a new locale key (report the proposed key + English text instead).
