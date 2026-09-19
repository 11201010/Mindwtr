# Plan 111: Clear Trash permanently deletes only the items the Trash screen is showing

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report; do not improvise. Do NOT edit `plans/README.md` — the coordinator maintains the index.
>
> **Drift check (run first)**: `rtk git diff --stat 561cfdfa0..HEAD -- packages/core/src/task-utils.ts packages/core/src/task-utils.test.ts apps/desktop/src/components/views/TrashView.tsx apps/desktop/src/components/views/TrashView.test.tsx "apps/mobile/app/(drawer)/trash.tsx"` — if any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `561cfdfa0`, 2026-09-19

## Why this matters

"Purge" means delete for good: it stamps `purgedAt` on a trashed item, and the item can never be restored. The Trash screen on both apps shows only the items that pass the app-wide area filter (desktop also narrows by its search box). But the **Clear Trash** button purges every trashed item in the whole store. A user with the "Work" area selected sees "3 tasks", presses Clear Trash, and also loses every deleted Personal task and project that the screen never listed. After this plan the button purges exactly the shown items, the confirm text counts the same items, and when nothing is hidden the behaviour and texts are unchanged.

## Current state

- `packages/core/src/task-utils.ts:961-977` — `buildTrashTimeline(tasks, projects)`, the shared Trash helper both apps import from `@mindwtr/core`. The new helper goes right after it. `packages/core/src/index.ts:67` is `export * from './task-utils';`, so a new export is reachable from `@mindwtr/core` with no index edit.
- `packages/core/src/store-tasks.ts:999-1016` — `purgeTasks(ids: string[])` purges the given trashed tasks. `:1021-1037` — `purgeDeletedTasks()` purges every trashed task. `packages/core/src/store-projects/project-actions.ts:545` — `purgeProject(id)`; `:631` — `purgeDeletedProjects()` purges every trashed project. Do not change these.
- Desktop, `apps/desktop/src/components/views/TrashView.tsx`:
  - `:71-91` — `trashedTasks` and `trashedProjects` are the SHOWN lists (area filter via `taskMatchesAreaFilterSelection` / `projectMatchesAreaFilterSelection`, then `searchQuery`).
  - `:186-189` — the selection-mode purge already uses the id-based actions. This is the pattern to copy:
    ```ts
    await Promise.all([
        taskIds.length > 0 ? purgeTasks(taskIds) : Promise.resolve(),
        ...projectIds.map((projectId) => purgeProject(projectId)),
    ]);
    ```
  - `:193-205` — the bug:
    ```ts
    const handleClearTrash = async () => {
        if (trashedItemCount === 0) return;
        const confirmed = await requestConfirmation({
            title: t('trash.clearAllConfirm'),
            description: trashedProjects.length > 0
                ? t('trash.clearAllConfirmBodyWithProjects')
                : t('trash.clearAllConfirmBody'),
            confirmLabel: t('trash.clearAll'),
            cancelLabel: tFallback(t, 'common.cancel', 'Cancel'),
        });
        if (!confirmed) return;
        await Promise.all([purgeDeletedTasks(), purgeDeletedProjects()]);
    };
    ```
  - `:308` — the header already prints the shown counts with existing keys: `{trashedTasks.length} {t('common.tasks')} · {trashedProjects.length} {t('projects.title')}`.
- Mobile, `apps/mobile/app/(drawer)/trash.tsx`:
  - `:242-252` — `trashedTasks` / `trashedProjects` are the SHOWN lists (area filter only; mobile Trash has no search box).
  - `:352-355` — selection-mode purge, the id-based pattern, wrapped in `runTrashBulkAction(label, action)`.
  - `:416-433` — the bug:
    ```ts
    const handleClearAll = () => {
      if (trashItems.length === 0) return;
      Alert.alert(
        tFallback(t, 'trash.clearAllConfirm', 'Clear trash?'),
        tFallback(t, 'trash.clearAllConfirmBodyWithProjects', 'This will permanently delete all trashed tasks and projects.'),
        [
          { text: tFallback(t, 'common.cancel', 'Cancel'), style: 'cancel' },
          {
            text: tFallback(t, 'trash.clearAll', 'Clear Trash'),
            style: 'destructive',
            onPress: () => {
              void purgeDeletedTasks();
              void purgeDeletedProjects();
            },
          },
        ]
      );
    };
    ```
- Existing English strings to reuse (`packages/core/src/i18n/locales/en.ts`): `trash.deleteConfirm` = "Delete permanently?", `trash.deleteConfirmBody` = "This action cannot be undone.", `trash.clearAll` = "Clear Trash", `common.tasks`, `projects.title`. **No new locale key is needed.**
- Tests: `packages/core/src/task-utils.test.ts:39-56` (`describe('buildTrashTimeline', ...)`, casts partial objects `as Task[]`) and `apps/desktop/src/components/views/TrashView.test.tsx:61-86` (sets an area filter with `settings: { filters: { excludedAreaIds: ['area-work'] } }` and `_allAreas`) and `:187-205` (clicks through the confirm dialog with `within(screen.getByRole('dialog'))`). Mobile has no Trash screen test; the shared rule is unit-tested in core instead.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Core test | `rtk bun run --filter @mindwtr/core test -- task-utils.test.ts` | pass |
| Desktop test | `cd apps/desktop && rtk bun run test -- TrashView.test.tsx` | pass |
| Typecheck | `rtk bun run typecheck:core && rtk bun run typecheck:desktop && rtk bun run typecheck:mobile` | exit 0 |
| Whitespace | `rtk git diff --check` | no output |

## Scope

**In scope** (the only files you may modify):
- `packages/core/src/task-utils.ts`
- `packages/core/src/task-utils.test.ts`
- `apps/desktop/src/components/views/TrashView.tsx`
- `apps/desktop/src/components/views/TrashView.test.tsx`
- `apps/mobile/app/(drawer)/trash.tsx`

**Out of scope** (do NOT touch):
- `packages/core/src/store-tasks.ts`, `packages/core/src/store-projects/project-actions.ts` — the purge actions are correct; only the callers choose the wrong one.
- Every file under `packages/core/src/i18n/locales/` — reuse existing keys only.
- The disabled state of the button when nothing is shown — leave as is.
- `plans/README.md`.

## Git workflow

- One commit, message: `fix(trash): purge only the shown items when the list is filtered`. Repo style is `type(scope): imperative summary`; no tooling mentions; do not push.

## Steps

### Step 1: red core test

In `packages/core/src/task-utils.test.ts`, add `resolveTrashClearScope` to the import list from `./task-utils` and add, right after the `describe('buildTrashTimeline', ...)` block:

```ts
describe('resolveTrashClearScope', () => {
    const all = [
        { id: 'work', deletedAt: '2026-07-01T12:00:00.000Z' },
        { id: 'home', deletedAt: '2026-07-02T12:00:00.000Z' },
        { id: 'gone', deletedAt: '2026-07-03T12:00:00.000Z', purgedAt: '2026-07-04T12:00:00.000Z' },
        { id: 'live' },
    ] as Task[];

    it('is not narrowed when every trashed item is shown', () => {
        const scope = resolveTrashClearScope([all[0], all[1]], [], all, []);
        expect(scope).toEqual({ narrowed: false, taskIds: ['work', 'home'], projectIds: [] });
    });

    it('is narrowed when a trashed task or project is hidden', () => {
        const projects = [{ id: 'p-hidden', deletedAt: '2026-07-01T12:00:00.000Z' }] as Project[];
        expect(resolveTrashClearScope([all[0]], [], all, []).narrowed).toBe(true);
        expect(resolveTrashClearScope([all[0], all[1]], [], all, projects)).toEqual({
            narrowed: true, taskIds: ['work', 'home'], projectIds: [],
        });
    });
});
```

**Verify**: `rtk bun run --filter @mindwtr/core test -- task-utils.test.ts` → FAILS (export missing).

### Step 2: add the core helper

In `packages/core/src/task-utils.ts`, directly after `buildTrashTimeline` (ends at line 977):

```ts
/**
 * What "Clear Trash" may purge: exactly the shown items. `narrowed` is true when
 * a filter hides at least one trashed item, so the caller must purge by id and
 * say how many items it will delete instead of claiming "all".
 */
export function resolveTrashClearScope(
    shownTasks: readonly Task[],
    shownProjects: readonly Project[],
    allTasks: readonly Task[],
    allProjects: readonly Project[],
): { narrowed: boolean; taskIds: string[]; projectIds: string[] } {
    const inTrash = (item: { deletedAt?: string; purgedAt?: string }) => Boolean(item.deletedAt && !item.purgedAt);
    return {
        narrowed: shownTasks.length < allTasks.filter(inTrash).length
            || shownProjects.length < allProjects.filter(inTrash).length,
        taskIds: shownTasks.map((task) => task.id),
        projectIds: shownProjects.map((project) => project.id),
    };
}
```

**Verify**: the Step 1 command → passes. `rtk bun run typecheck:core` → exit 0.

### Step 3: red desktop test

In `apps/desktop/src/components/views/TrashView.test.tsx` add a test after `'honours the app-wide area filter'`. Reuse that test's `workTask`, `workProject`, `_allAreas` and `settings` setup verbatim, render, then:

```ts
fireEvent.click(screen.getByRole('button', { name: 'Clear Trash' }));
const dialog = screen.getByRole('dialog');
expect(dialog).toHaveTextContent('1');            // counts the shown set
expect(dialog).not.toHaveTextContent(/all trashed/i);
fireEvent.click(within(dialog).getByRole('button', { name: 'Clear Trash' }));

await waitFor(() => {
    expect(useTaskStore.getState()._allTasks.find((task) => task.id === recentTask.id)?.purgedAt).toBeTruthy();
    expect(useTaskStore.getState()._allProjects.find((project) => project.id === olderProject.id)?.purgedAt).toBeTruthy();
});
expect(useTaskStore.getState()._allTasks.find((task) => task.id === 'work-task')?.purgedAt).toBeUndefined();
expect(useTaskStore.getState()._allProjects.find((project) => project.id === 'work-project')?.purgedAt).toBeUndefined();
```

Name it `'Clear Trash leaves items hidden by the area filter restorable'`. Also add `'Clear Trash with nothing hidden keeps the "all trashed" wording'`: default `beforeEach` state, click Clear Trash, expect the dialog to contain `all trashed tasks and projects`, confirm, expect both default items purged.

**Verify**: `cd apps/desktop && rtk bun run test -- TrashView.test.tsx` → the first new test FAILS (hidden items get `purgedAt`), the second passes.

### Step 4: fix desktop

In `TrashView.tsx` import `resolveTrashClearScope` from `@mindwtr/core` (same import that brings `buildTrashTimeline`) and replace `handleClearTrash` with:

```ts
const handleClearTrash = async () => {
    if (trashedItemCount === 0) return;
    const scope = resolveTrashClearScope(trashedTasks, trashedProjects, _allTasks, _allProjects);
    const confirmed = await requestConfirmation(scope.narrowed
        ? {
            title: t('trash.deleteConfirm'),
            description: `${scope.taskIds.length} ${t('common.tasks')} · ${scope.projectIds.length} ${t('projects.title')}. ${t('trash.deleteConfirmBody')}`,
            confirmLabel: t('trash.clearAll'),
            cancelLabel: tFallback(t, 'common.cancel', 'Cancel'),
        }
        : {
            title: t('trash.clearAllConfirm'),
            description: trashedProjects.length > 0
                ? t('trash.clearAllConfirmBodyWithProjects')
                : t('trash.clearAllConfirmBody'),
            confirmLabel: t('trash.clearAll'),
            cancelLabel: tFallback(t, 'common.cancel', 'Cancel'),
        });
    if (!confirmed) return;
    if (!scope.narrowed) {
        await Promise.all([purgeDeletedTasks(), purgeDeletedProjects()]);
        return;
    }
    await Promise.all([
        scope.taskIds.length > 0 ? purgeTasks(scope.taskIds) : Promise.resolve(),
        ...scope.projectIds.map((projectId) => purgeProject(projectId)),
    ]);
};
```

**Verify**: Step 3 command → all pass. `rtk bun run typecheck:desktop` → exit 0.

### Step 5: fix mobile the same way

In `apps/mobile/app/(drawer)/trash.tsx` add `resolveTrashClearScope` to the `@mindwtr/core` import on line 2 and change `handleClearAll` so that: it computes `scope` from `trashedTasks, trashedProjects, _allTasks, _allProjects`; when `scope.narrowed` the alert title is `tFallback(t, 'trash.deleteConfirm', 'Delete permanently?')`, the message is the same counts sentence as desktop (use `t('common.tasks')`, `t('projects.title')`, `tFallback(t, 'trash.deleteConfirmBody', 'This action cannot be undone.')`), and `onPress` runs the id-based purge through the existing wrapper, copying `:352-355`:

```ts
onPress: async () => {
  await runTrashBulkAction(t('trash.clearAll'), () => Promise.all([
    scope.taskIds.length > 0 ? purgeTasks(scope.taskIds) : Promise.resolve(undefined),
    ...scope.projectIds.map((projectId) => purgeProject(projectId)),
  ]));
},
```

When `scope.narrowed` is false keep today's title, message and the two whole-store calls exactly as they are.

**Verify**: `rtk bun run typecheck:mobile` → exit 0. `rtk git diff --check` → no output.

## Test plan

- Core: the two `resolveTrashClearScope` cases in Step 1 (model: the `buildTrashTimeline` block in the same file).
- Desktop: the two TrashView cases in Step 3 (model: `'honours the app-wide area filter'` and `'bulk purges selected trashed items after confirmation'` in the same file).
- Mobile: covered by the shared core rule plus typecheck; no screen test exists to extend.

## Done criteria

- [ ] `rtk bun run --filter @mindwtr/core test -- task-utils.test.ts` passes with 2 new tests
- [ ] `cd apps/desktop && rtk bun run test -- TrashView.test.tsx` passes with 2 new tests
- [ ] all three typechecks exit 0
- [ ] `rtk proxy grep -n "resolveTrashClearScope" apps/desktop/src/components/views/TrashView.tsx "apps/mobile/app/(drawer)/trash.tsx"` shows one import and one call in each file
- [ ] `rtk git status --short` lists only the five in-scope files; `rtk git diff --check` is clean

## STOP conditions

- A "Current state" excerpt does not match the live code.
- `runTrashBulkAction` on mobile no longer accepts `(label, action)`, or `requestConfirmation` on desktop no longer accepts `{ title, description, confirmLabel, cancelLabel }`.
- You believe a new locale key is required (report the proposed key and English text instead of adding it).
- A verification fails twice after a reasonable fix attempt.

## Maintenance notes

- If Trash ever gains another way to narrow the list (a type filter, a mobile search box), no change is needed: the rule compares shown counts with store counts, not filter names.
- Reviewer: check the unfiltered path is byte-for-byte the old behaviour (same strings, same two whole-store calls).
- Deferred on purpose: the button stays disabled when the filter hides everything.
