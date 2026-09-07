# Plan 081: Restore keyboard focus after an autofocused dialog closes

## Status
- Priority: P2; effort: S; risk: LOW; category: bug/accessibility.
- Planned at: `a68aeeb6f`, 2026-09-07. Depends on: none.
- Root maintains index and commits once. Executor does not commit/push.

## Why and current state
`apps/desktop/src/components/ui/Dialog.tsx:67-80` captures document.activeElement inside a passive effect. React child autoFocus has already focused the input, so cleanup remembers the input instead of the trigger; on close it is disconnected and focus falls to BODY. Actual consumers include PromptModal naming/rename inputs and CalendarModals composer title/search. The real component jsdom probe confirms autofocus succeeds but restoration fails. Existing Dialog.test.tsx tests autofocus and restoration separately, missing their combination.

## Scope and design
Only `apps/desktop/src/components/ui/Dialog.tsx` and `Dialog.test.tsx`. Capture the original return target before descendant autofocus and retain it for this mount's lifetime. Do not focus or mutate DOM during render. A guarded mount-time ref/state initializer may read the pre-commit focused element; do not overwrite it during rerenders. The existing effect still parks focus on the panel only if children have not claimed it. Restore only to a connected original target on actual dialog removal; a StrictMode simulated effect teardown while its captured panel remains connected must not steal focus from an autofocused child. Keep nested dialog, Escape/backdrop, portal, tab trap, panel ref and SSR behavior unchanged. No new public prop or library.

## Steps and tests
1. Drift check `rtk git diff --stat a68aeeb6f..HEAD -- apps/desktop/src/components/ui/Dialog.tsx`; compare to current source before editing.
2. Add red behavioral test: focus real trigger, open Dialog with autoFocus input, assert input focused, close/unmount, assert trigger focused. Use the existing React DOM harness.
3. Implement internal return-target tracking. Test StrictMode autofocus and close restoration, rerender while focus moves inside, nested child dialog returns to parent trigger then parent returns outside, and disconnected trigger causes no throw or incorrect focus. Existing autofocus/panel fallback/tab/backdrop/Escape tests remain green.
4. `rtk bun run --cwd apps/desktop test src/components/ui/Dialog.test.tsx` passes; run nearest PromptModal/calendar consumer tests if they already exist and cover focus behavior.
5. `rtk bun run typecheck:desktop` and focused desktop ESLint pass; `rtk git diff --check` passes. Only two scoped files modified.
6. Return actual red/green evidence/result report, no commit. No diagnostic needed for visible keyboard behavior.

## Worktree/maintenance/STOP
Use assigned isolated worktree under /home/dd/worktrees/Mindwtr. You are not alone; preserve others' edits. Dependencies/build/temp under /home/dd, not /tmp or /dev/shm. CodeGraph first, rtk shell, no crash logs. STOP if reliable handling requires changing callers/public Dialog interface or weakens existing focus trapping. Future focus changes must keep autofocus and return-focus in the same test scenario.
