# Plan 113: A task dropped on the History sidebar entry is marked done, and folded sidebar groups open during a drag

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report; do not improvise. Do NOT edit `plans/README.md` — the coordinator maintains the index.
>
> **Drift check (run first)**: `rtk git diff --stat 561cfdfa0..HEAD -- apps/desktop/src/components/Layout.tsx apps/desktop/src/components/Layout.test.tsx` — if either file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `561cfdfa0`, 2026-09-19

## Why this matters

On desktop, a task row can be dragged onto a sidebar entry to change its status (Inbox, Someday, Waiting, Reference, Done, Archived). Version 1.3.1 merged the Done and Archived sidebar entries into one **History** entry, but the drop table still uses the old ids, so History is not a drop target and the drag does nothing, with no message. The same release folds the "More" sidebar group by default; Reference and History live in it, so on a fresh profile their drop targets cannot be seen or hit during a drag. After this plan, dropping on History marks the task done (History opens on its Done tab), and hovering a dragged task over a folded group's header opens that group until the drag ends.

## Current state

All in `apps/desktop/src/components/Layout.tsx`:

- `:78-85` — the drop table. `done` and `archived` no longer match any sidebar entry:
  ```ts
  const NAV_DROP_STATUSES: Record<string, TaskStatus> = {
      inbox: 'inbox',
      someday: 'someday',
      waiting: 'waiting',
      reference: 'reference',
      done: 'done',
      archived: 'archived',
  };
  ```
- `:380-387` — the History entry: `id: 'history'`, `activeIds: ['done', 'archived']`. It sits in the section with `key: 'secondary'` (label "More"), together with `reference` and `trash`.
- `:87` — `const DEFAULT_COLLAPSED_SECTION_KEYS = ['secondary'];`. `:403` — `collapsedSections` state; `:405-407` — it is saved to localStorage on every change (so do NOT use it for a temporary open).
- `:444-445` — `taskDragActive` and `dragOverNavId` state. `:457-464` — `endDrag` is the single place where a drag ends:
  ```ts
  const endDrag = () => {
      ...
      setTaskDragActive(false);
      setDragOverNavId(null);
  };
  ```
- `:887` — `const isSectionCollapsed = !isCollapsed && collapsedSections.has(section.key);` `:892-907` — the section header `<button ... data-sidebar-section-toggle aria-expanded={!isSectionCollapsed}>`; it has no drag handlers. `:909-913` — the item container `<div id={sectionId} hidden={isSectionCollapsed} ...>` with `sectionId = \`sidebar-section-${section.key}\``.
- `:917` — `const isDropTarget = item.id === 'calendar' || NAV_DROP_STATUSES[item.id] !== undefined;` `:940-943` — drag handlers are attached only when `isDropTarget`. `:959` — drop targets get `outline-dashed` while `taskDragActive`.
- `:523-555` — `handleNavDrop` looks up `NAV_DROP_STATUSES[navId]`, calls `moveTask(taskId, nextStatus)`, and shows an Undo toast. No change needed there.
- Convention to match: the helper `hasCalendarTaskDragData(event.dataTransfer)` guards every drag handler (see `:496-500`).

Tests, `apps/desktop/src/components/Layout.test.tsx`: `:18-42` — helpers `dispatchDrag(type, withTaskData)` and `dispatchDragStartFromRow(withTaskData)`; `:1045-1066` — `'lights up every drop target while a task drag is in flight'`; `:1068-1098` — `'reclassifies a task dropped on a status list, with undo'` (builds a `dataTransfer` object and calls `fireEvent.drop(container.querySelector('[data-view="waiting"]')!, { dataTransfer })`). Copy these two tests' shape.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Desktop test | `cd apps/desktop && rtk bun run test -- Layout.test.tsx` | pass |
| Typecheck | `rtk bun run typecheck:desktop` | exit 0 |
| Whitespace | `rtk git diff --check` | no output |

## Scope

**In scope** (the only files you may modify):
- `apps/desktop/src/components/Layout.tsx`
- `apps/desktop/src/components/Layout.test.tsx`

**Out of scope** (do NOT touch):
- The public user guide sentence about dragging onto Done/Archived — plan 116 owns it.
- `apps/desktop/src/lib/sidebar-views.ts`, `HistoryView.tsx`, settings pages — no new setting, no change to which views can be hidden.
- Trash must stay a non-target (test `'ignores a task dropped on Trash'` must still pass).
- `plans/README.md`.

## Git workflow

- One commit, message: `fix(desktop): accept task drops on the History sidebar entry`. Repo style is `type(scope): imperative summary`; no tooling mentions; do not push.

## Steps

### Step 1: red tests

Add three tests to `Layout.test.tsx` next to the two named above:

1. `'marks a task done when it is dropped on History'` — copy the `'reclassifies ...'` test, drop on `[data-view="history"]`, expect `moveTask` toHaveBeenCalledWith `('task-1', 'done')`.
2. In `'lights up every drop target ...'` add: `const historyItem = container.querySelector('[data-view="history"]')!;` and after `dispatchDragStartFromRow(true)` expect `historyItem.className` toContain `'outline-dashed'`.
3. `'opens a folded group while a task is dragged over its header'`:
   ```ts
   const { container } = renderLayout();
   const panel = container.querySelector('#sidebar-section-secondary')!;
   const toggle = panel.previousElementSibling as HTMLElement;   // the section header button
   expect(panel).toHaveAttribute('hidden');
   dispatchDragStartFromRow(true);
   fireEvent.dragEnter(toggle, { dataTransfer: { types: [CALENDAR_TASK_DRAG_MIME], getData: () => '' } });
   expect(panel).not.toHaveAttribute('hidden');
   dispatchDrag('dragend', true);
   expect(panel).toHaveAttribute('hidden');
   expect(toggle).toHaveAttribute('aria-expanded', 'false');
   ```
   If `renderLayout()` in this file does not start with "More" folded, first set `localStorage.setItem('mindwtr:sidebar:collapsedSections', JSON.stringify(['secondary']))` before rendering.

**Verify**: `cd apps/desktop && rtk bun run test -- Layout.test.tsx` → the three new assertions FAIL, everything else passes.

### Step 2: make History a drop target

Replace the last two lines of `NAV_DROP_STATUSES` with one entry and extend the comment:

```ts
    reference: 'reference',
    // Done and Archived share the History entry; it opens on Done, so a drop files there.
    history: 'done',
};
```

**Verify**: tests 1 and 2 pass.

### Step 3: open a folded group during a drag

1. Next to `dragOverNavId` (`:445`) add `const [dragOpenedSectionKey, setDragOpenedSectionKey] = useState<string | null>(null);` and in `endDrag` add `setDragOpenedSectionKey(null);`.
2. At `:887` change to `const isSectionCollapsed = !isCollapsed && collapsedSections.has(section.key) && dragOpenedSectionKey !== section.key;`
3. On the section header button add:
   ```tsx
   onDragEnter={(event) => {
       if (!hasCalendarTaskDragData(event.dataTransfer)) return;
       if (section.items.some((item) => item.id === 'calendar' || NAV_DROP_STATUSES[item.id] !== undefined)) {
           setDragOpenedSectionKey(section.key);
       }
   }}
   ```
   Do not call `toggleSection` or `setCollapsedSections` here: the open must not be saved.

**Verify**: `cd apps/desktop && rtk bun run test -- Layout.test.tsx` → all pass. `rtk bun run typecheck:desktop` → exit 0. `rtk git diff --check` → no output.

## Test plan

- The three cases in Step 1, modelled on `Layout.test.tsx:1045-1098`.
- Existing `'ignores a task dropped on Trash'` and `'reclassifies a task dropped on a status list, with undo'` must still pass.

## Done criteria

- [ ] `cd apps/desktop && rtk bun run test -- Layout.test.tsx` passes with the 2 new tests and the extended one
- [ ] `rtk proxy grep -n "archived: 'archived'\|done: 'done'" apps/desktop/src/components/Layout.tsx` returns no match
- [ ] `rtk bun run typecheck:desktop` exits 0
- [ ] `rtk git status --short` lists only the two in-scope files; `rtk git diff --check` is clean

## STOP conditions

- A "Current state" excerpt does not match the live code.
- The History entry id is no longer `history`, or the "More" section key is no longer `secondary`.
- Making the fold temporary seems to require writing `collapsedSections` (that would save the user's fold choice; report instead).
- A verification fails twice after a reasonable fix attempt.

## Maintenance notes

- If Archived ever needs its own drop target again, it needs its own sidebar entry; one entry can carry only one status.
- The temporary open is cleared only by `endDrag`; any new way a drag can end must go through it (it already covers `dragend`, `drop` and the idle heartbeat).
- Plan 116 rewrites the public-guide sentence that still names Done and Archived as drop targets.
