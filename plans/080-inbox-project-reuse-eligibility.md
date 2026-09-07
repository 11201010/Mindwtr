# Plan 080: Reuse only assignable projects during Inbox conversion

## Status
- Priority: P2; effort: S; risk: LOW; category: bug.
- Planned at: `a68aeeb6f`, 2026-09-07. Depends on: none.
- Root maintains index, integrates and makes one commit. Executor does not commit/push.

## Why and current state
Desktop `apps/desktop/src/components/views/inbox/useInboxProcessingController.ts:731` and mobile `apps/mobile/components/inbox-processing/useInboxProcessingController.ts:1059` use `projects.find((project) => project.title.toLowerCase() === projectTitle.toLowerCase())` during Convert to project. An archived same-title project can win before an active match. The converted task is assigned there and disappears from normal active-project views. Ordinary assignment pickers already use `isSelectableProjectForTaskAssignment` in `packages/core/src/project-utils.ts:122-125`: nondeleted and status neither archived nor completed. Deferred/someday projects remain legitimate containers per CONTEXT.

Both controllers commit extra actions before moving the original task and remove each committed extra draft so retry cannot duplicate it. Keep that sequencing and existing failure handling intact.

## Scope and design
Only the two controller files above, desktop adjacent `useInboxProcessingController.test.tsx`, and `apps/mobile/components/inbox-processing-modal.test.tsx` (or one new focused hook test beside it, report exact path to root). Import the existing core selectable-project predicate and include it in same-title reuse in both controllers. Reuse a later valid match when a closed match comes first; if all matches are closed/deleted, create a fresh project. Preserve current case-insensitive matching, area semantics, task/extra-action ordering and error handling. Do not add a new module or change core assignment behavior.

## Steps and tests
1. `rtk git diff --stat a68aeeb6f..HEAD -- apps/desktop/src/components/views/inbox/useInboxProcessingController.ts apps/mobile/components/inbox-processing/useInboxProcessingController.ts`; compare drift before editing.
2. Add behavior-visible regressions in existing controller/modal harnesses: archived same title before active same title uses active; archived-only creates new; completed/deleted matches cannot win; valid active and someday same-title projects still reuse. Assert written project ids on original and extra actions, and successful session advancement. Capture red on current code.
3. Apply predicate in both callers. Keep existing duplicate-submission and partial-failure regression tests green.
4. `rtk bun run --cwd apps/desktop test src/components/views/inbox/useInboxProcessingController.test.tsx` passes. `rtk bun run --cwd apps/mobile test components/inbox-processing-modal.test.tsx` passes (include any new focused test).
5. `rtk bun run typecheck:desktop` and `rtk bun run typecheck:mobile` pass. Run focused ESLint via each app's existing command/tooling, with no errors.
6. `rtk git diff --check` passes, only scoped files changed. Return red/green counts, actual modified files and result report. No new diagnostics required: this visible conversion result is confirmed on screen.

## Worktree/maintenance/STOP
Use root-assigned isolated checkout under /home/dd/worktrees/Mindwtr. You are not alone; preserve others' edits. All dependencies/build/temp under /home/dd, never /tmp or /dev/shm; CodeGraph first, rtk shell, no crash logs. STOP if fix changes task write ordering, needs a new project lifecycle policy, or extends outside scope. Future conversion changes must continue using the existing shared selectable-project decision.
