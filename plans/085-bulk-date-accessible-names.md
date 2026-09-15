# Plan 085: Name mobile bulk date inputs for screen readers

Status: TODO. Priority P2. Effort S. Risk LOW. Confidence HIGH. Category accessibility/correctness. No dependencies. Planned at `51ac48c2f` on 2026-09-15; automatically selected by review-improve loop.

## Why and current state

`apps/mobile/components/task-list/TaskListBulkOrganizeModal.tsx:393-436` renders separate Text labels for Start, Due, and Review/Follow-up, followed by three TextInputs with identical `placeholder="YYYY-MM-DD"` and no accessible name/linkage. Focusing an input cannot identify which date it edits. The actual-modal packet probe found all three accessibility labels undefined. This predates v1.2.8. Desktop DateField already receives distinct dateAriaLabel values.

Current excerpt: `value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD"`; Due and Review follow the same pattern. The Review Text uses `isWaiting ? tFallback(t, 'process.followUpLabel', 'Follow-up') : tFallback(t, 'taskEdit.reviewDateLabel', 'Review')`. Preserve that dynamic vocabulary in the input label. Existing choice controls in this same file use React Native `accessibilityLabel`; follow that convention. CONTEXT separates start, due, and review dates; do not merge their semantics.

## Scope and design

Only `apps/mobile/components/task-list/TaskListBulkOrganizeModal.tsx` and its `.test.tsx`. Compute or reuse the same localized label for each visible Text and matching TextInput accessibilityLabel. Keep date placeholders, values, date parsing, styling, order, submitted fields, and status behavior unchanged. Review becomes Follow-up when status is Waiting. Also name the same form's Waiting for, Contexts, and Tags TextInputs from their existing visible captions (source lines 372-383 and 440-468 has the same missing-name pattern). No new translation keys.

## Execution and acceptance

1. Drift: `rtk git diff --stat 51ac48c2f..HEAD -- apps/mobile/components/task-list/TaskListBulkOrganizeModal.tsx apps/mobile/components/task-list/TaskListBulkOrganizeModal.test.tsx`; compare any drift before editing.
2. Add real-modal regression to the existing react-test-renderer suite (native primitives mocked at the existing adapter). Start/Due/Review names must be distinct; select Waiting and require Start/Due/Follow-up. Add a translated `t` fixture so the label follows localization; filled controls must retain names. Cover Waiting for, Contexts, and Tags captions as input names too. Observe red before source edit.
3. Add native accessible names matching visible labels. Keep input editing and onApply behavior exercised by existing tests; avoid tests of a new helper that merely mirrors the implementation.
4. From `apps/mobile`, run `rtk bun run test components/task-list/TaskListBulkOrganizeModal.test.tsx`; all tests pass. From repo root run `rtk bun run typecheck:mobile`, `rtk bun run lint:mobile`, and `rtk git diff --check`; exit0, no new warnings in owned files.
5. Report exact red/green and changed paths. Root performs integration and final aggregate/independent review. Host property checks verify the native label contract; physical TalkBack/VoiceOver output remains untested unless separately run.

## Maintenance

When the visible review label changes with status, its accessible name must change with it. Use existing translations and keep placeholder guidance separate from the field name.

## Workflow and storage

Use RTK for shell commands and CodeGraph before structural discovery. Read AGENTS.md, CONTEXT.md, design-guardrails and TDD skills. You are not alone; preserve others' edits. Use an isolated disk-backed worktree under `/home/dd/worktrees/Mindwtr/`, with dependencies/builds/TMPDIR/BUN_TMPDIR under `/home/dd`. No production data, crash logs, installs in shared node_modules, commits, pushes, or nested delegation. Root owns plan status and one scoped implementation commit. The visible UI fix needs no diagnostic marker. Public docs and native modules are outside scope.

## Stop conditions

Report to root if the excerpts have materially changed, an existing behavior contract disagrees, new locale strings or schema changes are needed, or an out-of-scope file is necessary. Do not redesign the form or add global abstractions. Run focused tests with tool working directory set to the package; do not use `bun --cwd ... run test`, which can print help without running tests.
