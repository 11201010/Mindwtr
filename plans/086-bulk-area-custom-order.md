# Plan 086: Preserve custom area order in desktop bulk organize

Status: TODO. Priority P3. Effort S. Risk LOW. Confidence HIGH. Category correctness/parity. No dependencies. Planned at `51ac48c2f` on 2026-09-15; automatically selected by review-improve loop.

## Why and current state

`apps/desktop/src/components/views/list/TaskBulkOrganizeModal.tsx:108-112` filters deleted areas then uses `.sort((a, b) => a.name.localeCompare(b.name))`. AreaSelector preserves caller order. The real-modal probe passes Work(order 0), Home(order 1) but sees Home, Work. This predates v1.2.8; the current mobile TaskEditAreaPicker honors persisted area order, so the user's custom arrangement differs across desktop bulk and mobile.

The current mobile comparator in `apps/mobile/components/task-edit/TaskEditAreaPicker.tsx:69-76` puts finite order first, missing/nonfinite order at infinity, then uses name as tie-break. Follow that behavior in the desktop bulk list. Do not assume input array is already sorted, and do not change unrelated project sorting. The `AreaSelector` module's interface accepts preordered choices; it should remain a presentation adapter.

## Scope and design

Only `apps/desktop/src/components/views/list/TaskBulkOrganizeModal.tsx` and its `.test.tsx`. Replace the alphabetic-only area comparator with persisted finite order then name, retaining deleted filtering and array immutability. Do not change AreaSelector globally, reorder store data, alter saves, add settings, or create a new shared sorting module for this narrow fix. Keep Keep-area/No-area/Create-area choices and selection behavior.

## Execution and acceptance

1. Drift: `rtk git diff --stat 51ac48c2f..HEAD -- apps/desktop/src/components/views/list/TaskBulkOrganizeModal.tsx apps/desktop/src/components/views/list/TaskBulkOrganizeModal.test.tsx`; inspect changed excerpts first.
2. Extend the existing Testing Library renderModal suite. Open the actual Area button and assert item-option order where names disagree with custom order; demonstrate red. Cover equal/missing/nonfinite order deterministic name tie-break and deleted exclusion; verify supplied array stays unchanged. Avoid helper-only tests.
3. Implement the comparator at the current activeAreas memo. No other selection or layout changes.
4. From `apps/desktop`, run `rtk bun run test src/components/views/list/TaskBulkOrganizeModal.test.tsx`; all tests pass. From root run `rtk bun run typecheck:desktop`, `rtk bun run lint:desktop`, `rtk git diff --check`; exit0 with no new warnings.
5. Return red/green evidence and changed paths to root. Root commits this finding separately from Plan085 and updates status.

## Maintenance

Area ordering is persisted user intent; future bulk pickers should preserve it before applying search filtering. Keep sentinel choices outside the ordinary area sort.

## Workflow and storage

Use RTK for shell commands and CodeGraph before structural discovery. Read AGENTS.md, CONTEXT.md, design-guardrails and TDD skills. You are not alone; preserve others' edits. Use an isolated disk-backed worktree under `/home/dd/worktrees/Mindwtr/`, with dependencies/builds/TMPDIR/BUN_TMPDIR under `/home/dd`. No production data, crash logs, installs in shared node_modules, commits, pushes, or nested delegation. Root owns plan status and one scoped implementation commit. The visible UI fix needs no diagnostic marker. Public docs and native modules are outside scope.

## Stop conditions

Report to root if the excerpts have materially changed, an existing behavior contract disagrees, new locale strings or schema changes are needed, or an out-of-scope file is necessary. Do not redesign the form or add global abstractions. Run focused tests with tool working directory set to the package; do not use `bun --cwd ... run test`, which can print help without running tests.
