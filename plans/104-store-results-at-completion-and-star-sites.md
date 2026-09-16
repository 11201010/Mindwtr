# Plan 104: Handle the store result at the six complete/star/restore sites that ignore it

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report; do not improvise. When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 0b9ea1d0e..HEAD -- <in-scope paths>` — if any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `0b9ea1d0e`, 2026-09-16

## Why this matters

Six write paths drop the store's `{success, error}` result, so a failed write shows nothing and the user retries blind. Pomodoro's Mark-done is the one completion path with no undo toast and no next-action prompt, unlike every other completion path.

## Current state

- `apps/desktop/src/components/views/PomodoroPanel.tsx:161-165` and `apps/mobile/app/(drawer)/(tabs)/focus.tsx:1636` — `updateTask(id, { status: 'done', isFocusedToday: false })` result unread; the row completion helpers with undo + prompt + error: `useTaskQuickActionMenuProps.ts:255-284`, `swipeable-task-item.tsx:347-378`.
- `apps/desktop/src/components/views/AgendaView.tsx:1066` — Focus star `updateTask(taskId, action.patch)` ignored; `TaskItem.tsx:383-386` toasts `result.error || t('task.updateFailed')`.
- `apps/desktop/src/components/views/review/DailyReviewModal.tsx:372-374` — `if (!action.canToggle) return;` swallows the blocked reason; `:334, :376` cap-only; other surfaces call `getFocusStarBlockedText` (`AgendaView.tsx:1062`).
- `apps/mobile/app/(drawer)/archived.tsx:529-531` Restore and `:552-555` completed-at edit fire-and-forget (`:537-543` bulk path uses `assertBulkActionSucceeded`).
- `apps/desktop/src/components/views/inbox/useInboxProcessingController.ts:815-819` — `await addPerson(trimmed)` ignores the `Person | null` result.
- Helpers: mobile `apps/mobile/components/store-action-result.ts` (`settleStoreAction`, `showActionFailure`); desktop toast pattern in `TaskItem.tsx`. Keys: `task.updateFailed`, `task.addFailed`.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Desktop | `cd apps/desktop && rtk bun run test -- PomodoroPanel AgendaView DailyReviewModal useInboxProcessingController` | pass |
| Mobile | `rtk bun run --filter mobile test -- focus-screen archived-screen` | pass |
| Typecheck/lint | `rtk bun run typecheck:desktop && rtk bun run typecheck:mobile && rtk bun run lint:mobile` | clean |

## Scope

**In scope** (the only files you may modify):
- The six files above (+ their tests)

**Out of scope** (do NOT touch):
- The completion helpers themselves; core
- Locale files under `packages/core/src/i18n/locales/` (frozen this batch; reuse existing keys only).

## Git workflow

- One commit for this plan, message: `fix: report failed writes at completion, star and restore sites`; repo style, no tooling mentions, do not push.

## Steps

### Step 1: red tests
One per site: store returns `{ success: false, error: 'x' }` → a failure toast (desktop) / `showActionFailure` (mobile); DailyReview: a task blocked for 'clarify' renders a disabled star with the blocked text.
### Step 2: reuse
Pomodoro Mark-done → the same completion helper the row uses (undo + prompt + error) on both platforms; the other sites check the result and toast; DailyReview derives `disabled`/tooltip from `getFocusStarAction` + `getFocusStarBlockedText`; the inline person create toasts on `null`.
**Verify**: red→green per site. NOTE: `AgendaView.tsx` is being refactored by the arch-focus task (its `:873-989` region); touch only the star handler at `:1066`.

## Test plan

- Six red→green cases.

## Done criteria

- [ ] suites pass; typecheck + lint clean
- [ ] `git status --short` shows no files outside the in-scope list
- [ ] `git diff --check` clean

## STOP conditions

- The completion helper is not importable from PomodoroPanel without a cycle (report).
- The "Current state" excerpt does not match the live code.
- The fix needs a new locale key (report the proposed key + English text instead).
