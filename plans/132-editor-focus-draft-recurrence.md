# Plan 132: Evaluate editor Focus against draft recurrence

## Status

- Priority: P2; effort: S; risk: LOW; confidence: HIGH.
- Category: bug; dependencies: none.
- Planned at: `285b922ab`, 2026-09-28.
- Root owns plan status, commits and integration. Do not push.

## Why

The shared editor Focus decision projects draft dates but inherits stored recurrence.
On a Next task with no start and a future deadline, removing recurrence leaves the
star incorrectly disabled until reopening. Adding recurrence allows a star that
the store then clears. The editor must evaluate the task that Save would produce.

## Current state and conventions

`packages/core/src/focus-star.ts:104` builds the candidate with:

```ts
...task,
status: draft.status === 'inbox' ? 'next' : draft.status,
startTime: serializeDraftDate(draft, task, 'startTime'),
dueDate: serializeDraftDate(draft, task, 'dueDate'),
reviewAt: serializeDraftDate(draft, task, 'reviewAt'),
```

It omits draft recurrence. `task-utils.ts:getTaskDeferUntil` falls back to future
due/review only when recurrence exists. `task-draft.ts:taskDraftToUpdatePatch`
already serializes recurrence, including anchors and RRULE metadata, and handles
the original date baseline. Reuse that interface; do not duplicate its serializer.
RN `components/task-edit-modal.tsx` and `components/task-edit/use-task-edit-state.ts`
both consume the shared Focus decision. Match `focus-star.test.ts` test conventions.

CONTEXT.md defines a Task draft as the private working copy committed on Save.
Preserve date-only values (ADR0013), existing recurrence semantics, Inbox
clarification, the temporary unstarred candidate and incumbent-slot adjustment.

## Scope

- `packages/core/src/focus-star.ts`, `packages/core/src/focus-star.test.ts`.
- The nearest existing RN task editor test under `apps/mobile` for one session.
- No recurrence-engine, global Focus policy, UI labels, new interfaces, migration
  hosts, dependency changes or persistence schema changes.

## Steps and acceptance

1. Check `rtk git diff --stat 285b922ab..HEAD -- packages/core/src/focus-star.ts`.
   If changed, compare the cited candidate before proceeding.
2. Add a failing helper regression: add/remove daily recurrence, no start,
   future due and future review. Expected eligibility matches serialized draft.
   Run from `packages/core`:
   `rtk bunx vitest run src/focus-star.test.ts --maxWorkers=2` — observe red.
3. Project effective draft recurrence through the existing serialization seam.
   Preserve explicit overrides for Inbox promotion and candidate star state.
   Repeat the command — all tests pass, including timezone/cap/queued-start cases.
4. Add one RN editor interaction regression: remove recurrence, star and save
   in the same session. Use the existing test harness; real core decisions must
   run. Run that exact file from `apps/mobile` — pass.
5. Run root `rtk bun run typecheck:core`, `rtk bun run typecheck:mobile`, relevant
   package lint scripts, and `rtk git diff --check` — exit zero. Existing unrelated
   lint warnings are reported separately, never silently disabled.

## Done and stop conditions

- Helper and RN regressions pass; existing date baselines and cap behavior hold.
- Diff stays in scope; one finding/commit, created by root after review.
- Stop and report if serializer reuse changes product semantics or requires a new
  recurrence interface. Existing public helpers are pre-agreed TDD seams.
- Maintenance: any new schedule field that affects Focus must enter through the
  same effective draft projection, rather than another partial field list.
