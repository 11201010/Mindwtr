# Plan 112: Undo after deleting a project puts its tasks back into the project

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report; do not improvise. Do NOT edit `plans/README.md` — the coordinator maintains the index.
>
> **Drift check (run first)**: `rtk git diff --stat 561cfdfa0..HEAD -- packages/core/src/index.ts packages/core/src/store.test.ts packages/core/src/store-projects/project-actions.ts apps/desktop/src/components/views/projects/ProjectWorkspace.tsx "apps/mobile/app/(drawer)/projects-screen.tsx"` — if any of these changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S–M
- **Risk**: LOW–MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `561cfdfa0`, 2026-09-19

## Why this matters

Deleting a project keeps its tasks but removes them from the project (it clears `projectId` and `sectionId` on each task). Both apps then show a "Project moved to Trash" toast with an **Undo** button. Undo calls `restoreProject`, which brings back the project and its sections but re-attaches no task. A user who deletes a 30-task project by mistake and presses Undo gets an empty project and 30 loose tasks. After this plan, Undo (the toast button on both apps, and Ctrl/Cmd+Z on desktop, which runs the same closure) puts the tasks back. Restoring a project later from the Trash screen is NOT changed by this plan.

## Current state

- `packages/core/src/store-projects/project-actions.ts:421-432` — inside `deleteProject`, the detach:
  ```ts
  const newAllTasks = state._allTasks.map(task =>
      !task.deletedAt && (task.projectId === id || (task.sectionId && sectionIdsForProject.has(task.sectionId)))
          ? { ...task, projectId: undefined, sectionId: undefined, updatedAt: now, rev: nextRevision(task.rev), revBy: deviceState.deviceId }
          : task
  );
  ```
  (`sectionIdsForProject` is the ids of `state._allSections` with `section.projectId === id`.)
- `:512-526` — `restoreProject` revives only tasks where `task.projectId === id && task.deletedAt === cascadeDeletedAt`. A detached task has no `projectId`, so nothing is re-attached. **Do not change `deleteProject` or `restoreProject`.**
- `packages/core/src/store.test.ts:5171-5205` — test `'detaches live project task section ids when deleting a project'` pins that plain `restoreProject` leaves `projectId` undefined. It stays true and must stay unchanged, because plain `restoreProject` (used by the Trash screen) keeps its behaviour.
- `packages/core/src/store-types.ts:111` — `batchUpdateTasks: (updates: Array<{ id: string; updates: Partial<Task> }>) => Promise<StoreActionResult>;` — the existing write that stamps `rev`/`revBy`/`updatedAt` and applies the container rules. Re-attach goes through it, so no new store action and no change to the store write-contract test is needed.
- Convention to match — `packages/core/src/undo-task-completion.ts:25-88`: a plain exported async function that reads `useTaskStore.getState()`, composes existing actions, and throws `new Error(result.error || '...')` when a step fails. It is exported by `packages/core/src/index.ts:100` (`export * from './undo-task-completion';`).
- Desktop caller, `apps/desktop/src/components/views/projects/ProjectWorkspace.tsx:1566-1575`:
  ```ts
  await Promise.resolve(deleteProject(projectId));
  setSelectedProjectId(null);
  showUndoToast(resolveText('projects.deleted', 'Project moved to Trash'), () => {
      void Promise.resolve(restoreProject(projectId))
          .then(() => setSelectedProjectId(projectId))
          .catch((error) => {
              reportError('Failed to restore project', error);
              showToast(resolveText('projects.restoreFailed', 'Failed to restore project'), 'error');
          });
  }, t);
  ```
- Mobile caller, `apps/mobile/app/(drawer)/projects-screen.tsx:460-486`: `handleDeleteProject` calls `deleteProject(projectIdToDelete)`, then shows a toast whose `onAction` is `void Promise.resolve(restoreProject(projectIdToDelete)).catch(...)`.
- These are the only two Undo callers (`rtk proxy grep -rn "restoreProject(" apps/desktop/src apps/mobile/app apps/mobile/components` also lists `TrashView.tsx`, `trash.tsx` and `InternalMarkdownLink.tsx`; those are Trash restores and are out of scope).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Core test | `rtk bun run --filter @mindwtr/core test -- store.test.ts` | pass |
| Desktop tests | `cd apps/desktop && rtk bun run test -- ProjectWorkspace` | pass |
| Mobile tests | `rtk bun run --filter mobile test -- projects-screen` | pass |
| Typecheck | `rtk bun run typecheck:core && rtk bun run typecheck:desktop && rtk bun run typecheck:mobile` | exit 0 |
| Whitespace | `rtk git diff --check` | no output |

## Scope

**In scope** (the only files you may modify):
- `packages/core/src/undo-project-delete.ts` (create)
- `packages/core/src/index.ts` (one export line)
- `packages/core/src/store.test.ts` (add tests; do not edit existing ones)
- `apps/desktop/src/components/views/projects/ProjectWorkspace.tsx`
- `apps/mobile/app/(drawer)/projects-screen.tsx`

**Out of scope** (do NOT touch):
- `packages/core/src/store-projects/project-actions.ts` — no behaviour change to delete or restore.
- `packages/core/src/types.ts` and anything about sync — **no new stored or synced field**.
- `TrashView.tsx`, `trash.tsx`, `InternalMarkdownLink.tsx`, `ArchiveView.tsx`, `archived.tsx` — Trash restore stays as it is (a separate, recorded product direction).
- Locale files; `plans/README.md`.

## Git workflow

- One commit, message: `fix(projects): put tasks back when a project delete is undone`. Repo style is `type(scope): imperative summary`; no tooling mentions; do not push.

## Steps

### Step 1: red core tests

In `packages/core/src/store.test.ts`, directly after the test that ends at line 5205 (`'detaches live project task section ids when deleting a project'`), add two tests that use the same setup style (real store actions from `useTaskStore.getState()`). Import `collectProjectTaskLinks, undoProjectDelete` from `'./undo-project-delete'` at the top of the file.

1. `'undoing a project delete re-attaches its tasks and sections'`: `addProject`, `addSection`, `addTask('Project Task', { projectId, sectionId, status: 'next' })`; `const links = collectProjectTaskLinks(project.id)` → expect `[{ id: task.id, sectionId: section.id }]`; `await deleteProject(project.id)`; `await undoProjectDelete(project.id, links)`; expect the task's `projectId` and `sectionId` to equal the originals, the project's `deletedAt` to be undefined, and the task's `rev` to be greater than it was right after the delete.
2. `'undoing a project delete skips tasks that were filed elsewhere or deleted meanwhile'`: two tasks in the project; after `deleteProject`, move task A to another live project with `updateTask(a.id, { projectId: other.id })` and `deleteTask(b.id)`; run `undoProjectDelete`; expect A to stay in `other`, B to stay deleted with no `projectId`.

**Verify**: `rtk bun run --filter @mindwtr/core test -- store.test.ts` → FAILS (module missing).

### Step 2: add the core module

Create `packages/core/src/undo-project-delete.ts`:

```ts
import { useTaskStore } from './store';

export type DetachedProjectTask = { id: string; sectionId?: string };

// deleteProject keeps a project's tasks but clears their projectId/sectionId, and
// restoreProject cannot know which tasks those were. An Undo handler records the
// links BEFORE it deletes and hands them back here. Same membership rule as
// deleteProject: by projectId, or by a section that belongs to the project.
export function collectProjectTaskLinks(projectId: string): DetachedProjectTask[] {
    const state = useTaskStore.getState();
    const sectionIds = new Set(
        state._allSections.filter((section) => section.projectId === projectId).map((section) => section.id),
    );
    return state._allTasks
        .filter((task) => !task.deletedAt
            && (task.projectId === projectId || (task.sectionId !== undefined && sectionIds.has(task.sectionId))))
        .map((task) => ({ id: task.id, ...(task.sectionId ? { sectionId: task.sectionId } : {}) }));
}

// Restores the project, then re-attaches only tasks that are still loose: not
// deleted, no project and no area. A task the user re-filed in the meantime stays put.
export async function undoProjectDelete(projectId: string, links: readonly DetachedProjectTask[]): Promise<void> {
    const restoreResult = await Promise.resolve(useTaskStore.getState().restoreProject(projectId));
    if (!restoreResult.success) throw new Error(restoreResult.error || 'Failed to restore project');

    const state = useTaskStore.getState();
    const liveSectionIds = new Set(
        state._allSections
            .filter((section) => section.projectId === projectId && !section.deletedAt)
            .map((section) => section.id),
    );
    const linkById = new Map(links.map((link) => [link.id, link]));
    const updates = state._allTasks
        .filter((task) => linkById.has(task.id) && !task.deletedAt && !task.projectId && !task.areaId)
        .map((task) => {
            const sectionId = linkById.get(task.id)?.sectionId;
            return {
                id: task.id,
                updates: { projectId, sectionId: sectionId && liveSectionIds.has(sectionId) ? sectionId : undefined },
            };
        });
    if (updates.length === 0) return;
    const attachResult = await Promise.resolve(state.batchUpdateTasks(updates));
    if (!attachResult.success) throw new Error(attachResult.error || 'Failed to restore project tasks');
}
```

Add `export * from './undo-project-delete';` to `packages/core/src/index.ts` on the line after `export * from './undo-task-completion';` (line 100).

**Verify**: Step 1 command → passes, including the unchanged test at 5171. `rtk bun run typecheck:core` → exit 0.

### Step 3: desktop Undo uses it

In `ProjectWorkspace.tsx` import `collectProjectTaskLinks, undoProjectDelete` from `@mindwtr/core`. In `handleDeleteProject`, on the line before `await Promise.resolve(deleteProject(projectId));` add `const detachedTasks = collectProjectTaskLinks(projectId);` and replace `Promise.resolve(restoreProject(projectId))` with `undoProjectDelete(projectId, detachedTasks)`. Keep the `.then(...)` and `.catch(...)` exactly as they are. If `restoreProject` is now unused in this file (`rtk proxy grep -n "restoreProject" apps/desktop/src/components/views/projects/ProjectWorkspace.tsx`), remove it from the store selector/destructure so lint stays clean.

**Verify**: `rtk bun run typecheck:desktop` → exit 0; `cd apps/desktop && rtk bun run test -- ProjectWorkspace` → pass.

### Step 4: mobile Undo uses it

Same change in `apps/mobile/app/(drawer)/projects-screen.tsx` `handleDeleteProject`: `const detachedTasks = collectProjectTaskLinks(projectIdToDelete);` as the first line of the callback (before `deleteProject` runs), and `onAction` calls `undoProjectDelete(projectIdToDelete, detachedTasks)` instead of `Promise.resolve(restoreProject(projectIdToDelete))`, keeping the `.catch(...)`. Fix the `useCallback` dependency list and remove `restoreProject` from the file if it is now unused.

**Verify**: `rtk bun run typecheck:mobile` → exit 0; `rtk bun run --filter mobile test -- projects-screen` → pass; `rtk git diff --check` → no output.

## Test plan

- The two core tests in Step 1 (model: the neighbouring test at `store.test.ts:5171`). They cover the fix, the "filed elsewhere" skip, the "deleted meanwhile" skip, and that the write bumps `rev`.
- The existing test at `:5171` must still pass unchanged — it proves Trash restore did not change.
- UI wiring is covered by typecheck plus the existing ProjectWorkspace and projects-screen suites; do not build new screen tests.

## Done criteria

- [ ] `rtk bun run --filter @mindwtr/core test -- store.test.ts` passes with 2 new tests
- [ ] all three typechecks exit 0; the desktop and mobile suites named above pass
- [ ] `rtk proxy grep -rn "undoProjectDelete(" apps/desktop/src apps/mobile/app` shows exactly two call sites
- [ ] `rtk git diff 561cfdfa0 -- packages/core/src/store-projects/project-actions.ts packages/core/src/types.ts` is empty
- [ ] `rtk git status --short` lists only the five in-scope files; `rtk git diff --check` is clean

## STOP conditions

- A "Current state" excerpt does not match the live code.
- `batchUpdateTasks` rejects the re-attach (`success: false`) in the Step 1 test after Step 2 — report the error text; do not write a new store action on your own.
- The fix seems to need a new field on `Task` or a change to `deleteProject` / `restoreProject`.
- A verification fails twice after a reasonable fix attempt.

## Maintenance notes

- `collectProjectTaskLinks` repeats the membership rule of `deleteProject` (`project-actions.ts:422`). If that rule changes, change both.
- The links live only in the Undo closure, so they are gone after the toast and after an app restart. Restoring a project from the Trash screen still returns an empty project; that needs a remembered link on the task (a new synced field) and is a separate owner decision.
- Reviewer: check that a task with an area set after the delete is left alone, and that no existing test was edited.
