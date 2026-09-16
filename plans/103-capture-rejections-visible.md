# Plan 103: Show a rejected capture and an invalid date command on the mobile capture sheet and desktop Quick Add

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

The mobile capture sheet returns silently on `{success:false}` (mobile has no global error banner). Desktop Quick Add returns silently on an invalid date command with Save still enabled, so the dialog looks frozen; a failed desktop audio capture closes the dialog before checking the result, losing the recording.

## Current state

- `apps/mobile/components/quick-capture-sheet.tsx:1122` `if (!result.success) return null;` and `:1225-1228`; the correct model is `apps/mobile/app/capture-modal.tsx:637-652` (`showCaptureFailure()`, `showInvalidDateCommandToast`).
- `apps/desktop/src/components/QuickAddModal.tsx:1030-1032` `if (parsed.invalidDateCommands?.length) { return; }` (no toast; `:1177` `saveDisabled` excludes it); `:983-985, 1039` `{success:false}` returns silently; `:789-791` audio path calls `close()` before checking `addTaskResult.success`.
- Existing keys: `task.addFailed`, `quickAdd.invalidDateCommand`; the in-list box already toasts the invalid-date case (`ListView.tsx:956-959`).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Desktop | `cd apps/desktop && rtk bun run test -- QuickAddModal` | pass |
| Mobile | `rtk bun run --filter mobile test -- quick-capture-sheet` | pass |
| Typecheck/lint | `rtk bun run typecheck:desktop && rtk bun run typecheck:mobile && rtk bun run lint:mobile` | clean |

## Scope

**In scope** (the only files you may modify):
- `apps/desktop/src/components/QuickAddModal.tsx` (+ test)
- `apps/mobile/components/quick-capture-sheet.tsx` (+ its save test)

**Out of scope** (do NOT touch):
- `capture-modal.tsx` (already correct), core parser
- Locale files under `packages/core/src/i18n/locales/` (frozen this batch; reuse existing keys only).

## Git workflow

- One commit for this plan, message: `fix: surface rejected captures and invalid date commands`; repo style, no tooling mentions, do not push.

## Steps

### Step 1: red tests
Desktop: invalid date command → a toast with `quickAdd.invalidDateCommand` and the dialog stays open; `{success:false}` → `task.addFailed` toast; audio path with `{success:false}` → dialog stays open. Mobile: rejected write → `showCaptureFailure` called.
### Step 2: wire the existing helpers
Mobile: call `showCaptureFailure()` / `showInvalidDateCommandToast` like capture-modal. Desktop: toast at the three sites; move `close()` after the success check on the audio path.
**Verify**: red→green.

## Test plan

- The cases above.

## Done criteria

- [ ] both suites pass; typecheck + lint clean
- [ ] `git status --short` shows no files outside the in-scope list
- [ ] `git diff --check` clean

## STOP conditions

- The standalone Quick Add window has no toast host (report; do not add one here).
- The "Current state" excerpt does not match the live code.
- The fix needs a new locale key (report the proposed key + English text instead).
