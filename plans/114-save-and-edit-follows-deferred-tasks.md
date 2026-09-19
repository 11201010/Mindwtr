# Plan 114: Save & edit follows a task with one shared "which list shows this task" rule

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report; do not improvise. Do NOT edit `plans/README.md` — the coordinator maintains the index.
>
> **Drift check (run first)**: `rtk git diff --stat 561cfdfa0..HEAD -- apps/desktop/src/lib/created-task-follow.ts apps/desktop/src/lib/created-task-follow.test.ts apps/desktop/src/lib/task-navigation.ts apps/desktop/src/components/QuickAddModal.tsx` — if any of these changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `561cfdfa0`, 2026-09-19

## Why this matters

Desktop Quick Add has **Save & edit**: it saves the capture, opens the list the task lives in, and, when the edit files the task somewhere else, follows it there (#1243). The follow code has its own private status-to-list table. That table sends every Next task to the Next list. But the Next list hides a "deferred" task (one whose start date has not arrived). So a user who sets status Next plus a start date of tomorrow is taken to a list that does not show the task. The older helper used by search and links already handles this: it sends a deferred Next task to Review. It also knows Archived, which the private table forgets. After this plan there is one table, not two.

## Current state

- `apps/desktop/src/lib/task-navigation.ts:4-24` — the rule to reuse:
  ```ts
  export function resolveTaskNavigationView(task: Task, now: Date = new Date()): DesktopViewId {
      const statusViewMap: Record<TaskStatus, DesktopViewId> = {
          inbox: 'inbox', next: 'next', waiting: 'waiting', someday: 'someday',
          reference: 'reference', done: 'done', archived: 'archived',
      };
      const primaryView = statusViewMap[task.status] || 'next';
      const hidesDeferredTasks = primaryView === 'next';
      ...
      if (hidesDeferredTasks && !shouldShowTaskForStart(task, { now, granularity: 'time' })) {
          return 'review';
      }
      return primaryView;
  }
  ```
  `shouldShowTaskForStart` (core, `packages/core/src/task-utils.ts:587-588`) only needs `Pick<Task, 'startTime'> & Partial<Pick<Task, 'dueDate' | 'recurrence' | 'reviewAt'>>`.
- `apps/desktop/src/lib/created-task-follow.ts:6-22` — the private copy to delete:
  ```ts
  export function resolveViewForTask(task: Pick<Task, 'projectId' | 'status'>): DesktopViewId {
      if (task.projectId) return 'projects';
      switch (task.status) {
          case 'next': return 'next';
          case 'waiting': return 'waiting';
          case 'someday': return 'someday';
          case 'reference': return 'reference';
          case 'done': return 'done';
          default: return 'inbox';
      }
  }
  ```
  `:41-51` — `followCreatedTaskAfterEdit` reads the full task from the store and calls `resolveViewForTask(task)`.
- `apps/desktop/src/components/QuickAddModal.tsx:933-944` — the opener drops the start date before asking:
  ```ts
  const openCreatedTaskForEditing = useCallback((taskId: string, props: Partial<Task>) => {
      setHighlightTask(taskId);
      setEditingTaskId(taskId);
      const view = resolveViewForTask({ status: props.status ?? 'inbox', projectId: props.projectId });
  ```
- Tests: `apps/desktop/src/lib/created-task-follow.test.ts` (`:37-41` pins "project first, then status"; `:43-51` shows how a follow is driven: set `taskStoreState._allTasks`, then `useUiStore.setState({ editingTaskId: null })`, then read `navigated`). `apps/desktop/src/lib/task-navigation.test.ts` covers the shared rule with `now` passed in.
- Rule to keep: a task with a project goes to `projects` first. Only the no-project branch changes.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Desktop tests | `cd apps/desktop && rtk bun run test -- created-task-follow.test.ts task-navigation.test.ts QuickAddModal` | pass |
| Typecheck | `rtk bun run typecheck:desktop` | exit 0 |
| Whitespace | `rtk git diff --check` | no output |

## Scope

**In scope** (the only files you may modify):
- `apps/desktop/src/lib/created-task-follow.ts`
- `apps/desktop/src/lib/created-task-follow.test.ts`
- `apps/desktop/src/lib/task-navigation.ts` (parameter type only)
- `apps/desktop/src/components/QuickAddModal.tsx` (line 936 only)

**Out of scope** (do NOT touch):
- `apps/mobile/app/global-search.tsx` — mobile keeps its own route table for now.
- `GlobalSearch.tsx`, `InternalMarkdownLink.tsx` — they already use the shared rule.
- The behaviour of `resolveTaskNavigationView` itself. No third copy of the table anywhere.
- `plans/README.md`.

## Git workflow

- One commit, message: `fix(desktop): follow a saved capture with the shared task navigation rule`. Repo style is `type(scope): imperative summary`; no tooling mentions; do not push.

## Steps

### Step 1: red tests

In `created-task-follow.test.ts` add to the test at `:37`:

```ts
expect(resolveViewForTask({ status: 'archived' })).toBe('archived');
expect(resolveViewForTask({ status: 'next', startTime: '2999-01-01' })).toBe('review');
expect(resolveViewForTask({ status: 'next', startTime: '2999-01-01', projectId: 'p1' })).toBe('projects');
```

and a new test `'follows a deferred next action to Review, where it is shown'`: same shape as `:43-51`, with `taskStoreState._allTasks = [{ id: 'task-1', status: 'next', startTime: '2999-01-01' }]`, expecting `navigated` toEqual `['review']`.

**Verify**: `cd apps/desktop && rtk bun run test -- created-task-follow.test.ts` → the new assertions FAIL (they get `'inbox'` and `'next'`).

### Step 2: use the shared rule

1. In `task-navigation.ts` change only the first parameter type so partial tasks are accepted:
   ```ts
   export type TaskNavigationInput = Pick<Task, 'status' | 'startTime'> & Partial<Pick<Task, 'dueDate' | 'recurrence' | 'reviewAt'>>;
   export function resolveTaskNavigationView(task: TaskNavigationInput, now: Date = new Date()): DesktopViewId {
   ```
2. In `created-task-follow.ts` replace the whole `resolveViewForTask` body and its doc comment with:
   ```ts
   /** The list that shows a task: its project first, otherwise the shared navigation rule. */
   export function resolveViewForTask(task: TaskNavigationInput & Pick<Task, 'projectId'>): DesktopViewId {
       if (task.projectId) return 'projects';
       return resolveTaskNavigationView(task);
   }
   ```
   importing `resolveTaskNavigationView, type TaskNavigationInput` from `./task-navigation`.
3. In `QuickAddModal.tsx:936` pass the dates along: `const view = resolveViewForTask({ ...props, status: props.status ?? 'inbox' });`

**Verify**: Step 1 command → passes. `cd apps/desktop && rtk bun run test -- task-navigation.test.ts QuickAddModal` → pass. `rtk bun run typecheck:desktop` → exit 0. `rtk git diff --check` → no output.

## Test plan

- The additions in Step 1 (model: the existing tests in the same file). Cases: archived, deferred Next, deferred Next inside a project, and the end-to-end follow to Review.
- All existing cases in `created-task-follow.test.ts` and `task-navigation.test.ts` must pass unchanged.

## Done criteria

- [ ] the three desktop suites named above pass; `rtk bun run typecheck:desktop` exits 0
- [ ] `rtk proxy grep -n "switch (task.status)" apps/desktop/src/lib/created-task-follow.ts` returns no match
- [ ] `rtk proxy grep -rn "statusViewMap" apps/desktop/src` shows `task-navigation.ts` only
- [ ] `rtk git status --short` lists only the four in-scope files; `rtk git diff --check` is clean

## STOP conditions

- A "Current state" excerpt does not match the live code.
- Changing the parameter type of `resolveTaskNavigationView` breaks a caller's typecheck in a file outside the scope list.
- An existing test in either test file has to change to pass.
- A verification fails twice after a reasonable fix attempt.

## Maintenance notes

- Not verified in the running app: that the Review screen opens the inline editor for the task Save & edit just created. If the editor does not appear there, that is a follow-up for the Review screen, not a reason to bring the private table back.
- Mobile search (`apps/mobile/app/global-search.tsx:299-321`) keeps a third, route-based table and still targets the old `/done` and `/archived` routes (they redirect to History). Moving the rule into core for both apps is a recorded direction item, not part of this plan.
