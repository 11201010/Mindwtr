# Plan 131: Finish widget adoption of the shared Focus module

> Executor: use the existing core module, delete replaced code, preserve observable behavior, and stop for root review/commit. No commit, push or public action. Root maintains plans and diagnostics ledger. You are not alone; preserve unrelated edits. Worktree/dependencies/build outputs belong under `/home/dd`, never RAM-backed temp directories.
>
> Drift check: `rtk git diff --stat 59d0e575e..HEAD -- apps/mobile/lib/widget-data.ts apps/mobile/lib/focus-sections.ts packages/core/src/focus-sections.ts apps/mobile/lib/widget-service.ts`. Compare affected source before proceeding.

## Status

- Priority: P3; effort: S; risk: LOW–MED; confidence: HIGH.
- Category: architecture/performance; candidate ARCH-01, Strong.
- Planned at: `59d0e575e`, 2026-09-22; dependencies: none.

## Why this matters / deletion test

Widget projection still duplicates four Focus pool decisions and calls a 53-line temporary adapter with a flat interface. It builds two sequential-project sets that the adapter ignores, discards upcoming dates, then the adapter invents dates solely to reassemble the core input. Reuse `buildFocusPools` and `deriveFocusTaskLists` directly; delete the adapter and the sole caller-supplied sort escape hatch. This deepens an existing module, not a new framework.

## Current state

`apps/mobile/lib/widget-data.ts:588-619` filters focused/active/schedule/upcoming pools separately and supplies `sequentialProjectIds`, `sequentialWithinSectionProjectIds` and a `sortBySavedPerspective` callback. Its `activeTasks` at529 already applies actionable/deleted/project/area visibility and must stay unchanged.

`apps/mobile/lib/focus-sections.ts:1-6` declares exactly one remaining importer. Lines28–30 explicitly ignore the two sets. Lines37–44 rebuild core pools and turn upcoming tasks into `{ task, appearsAt: input.now }`.

`packages/core/src/focus-sections.ts:107-132` already owns the equivalent pool rules; lines151–175 own sortBy/sortOrder and optionally accept the widget callback. The widget callback calls the same `sortTasksBySavedPreference` with the same projects/priority/sortOrder. No other production caller supplies it.

The read-only reviewer compared old/new full derived results across336 generated combinations (7 criteria ×12 sorts ×2 directions ×priorities on/off), with sequential sections/projects, hidden stars and date cases; all outputs, Maps, Sets and orders matched. This is characterization evidence, not a claimed measured speedup.

## Invariants and non-goals

- Widget `activeTasks` visibility remains local to the widget adapter.
- Starred pool still starts from undeleted actionable tasks without area/project visibility narrowing, as before.
- Pass the same captured `now` into pool building and list derivation; no new clock reads between pools.
- Pass saved `sortOrder` directly to core. Keep section ordering, sequential blocking, review/upcoming handling and fixed-list semantics unchanged.
- Main widget remains Focus + Today only, not a fallback to Next/Review/Upcoming.
- Keep existing projection sharing, per-item memoization and fingerprint/cache gates.
- No native layout, Kotlin/Swift, schema, localization, store, sorting-policy or performance-budget changes.

## Scope

- `apps/mobile/lib/widget-data.ts`, `apps/mobile/lib/widget-data.test.ts`
- Delete `apps/mobile/lib/focus-sections.ts` after proving it has no importers.
- `packages/core/src/focus-sections.ts` (remove unused optional callback interface/branch)
- `packages/core/src/__fixtures__/focus-derivation-frozen.ts` TYPE ONLY: keep its historical callback through a local/intersection type if needed; do not edit frozen implementation or expected behavior.
- Existing core Focus tests only for a necessary type/caller update; no weakened assertions.
- `apps/mobile/lib/widget-service.ts` and `.test.ts` for one diagnostic proof line after a real successful native publication.
- Root owns `docs/release-notes/diagnostics-ledger.md`.

## Steps and checks

1. Add/extend a focused widget characterization test before refactoring, covering saved ascending/descending sort, hidden starred task, future start, sequential section blocking and Focus+Today curation. Use existing widget-data tests (around553/620/671/726/799/833) and fake-clock conventions. Existing behavior should pass; mutation of an expected pool membership/order should fail. Do not generate a second permanent full implementation as a test oracle.
   - `rtk bun run --cwd apps/mobile test -- lib/widget-data.test.ts` passes; record the mutation/red evidence and restore it.
2. Call `buildFocusPools({ tasks: undeletedActionableTasks, visibleTasks: activeTasks, projects, criteria: focusFilter.criteria, now })`, then core `deriveFocusTaskLists(pools, { now, projects, sections, sortBy, prioritiesEnabled, sortOrder })`. Import `buildFocusTaskSections` from core. Delete duplicated pool assembly/ignored sets/date mapping and unused imports; delete the obsolete adapter file. Remove the unused core callback escape hatch; preserve the frozen fixture's old type without touching its implementation.
   - Focus tests and core frozen-parity tests pass. Literal import search has no remaining mobile `./focus-sections` importer or production `sortBySavedPerspective:` callback argument.
3. After the existing widget-service branch successfully publishes a changed payload, emit a privacy-safe marker `v1.3.2/widget-focus-pools` using existing `logInfo`; fixed message only plus releaseCheck. No marker on failed or fingerprint-skipped publication. Do not log task titles, IDs, dates, paths or raw payload. Existing publish/cache tests are the seam. Report ledger text to root.
4. Run focused mobile widget-data/widget-service tests and core focus-sections/focus-derivation-parity/focus-widget-selection tests; mobile/core typechecks; affected ESLint; `rtk git diff --check`. Root will run full verify/performance and fresh Mac bundling.

## Commands / done criteria

- `rtk bun run --cwd apps/mobile test -- lib/widget-data.test.ts lib/widget-service.test.ts` exits0.
- `rtk bun run --cwd packages/core test -- src/focus-sections.test.ts src/focus-derivation-parity.test.ts src/focus-widget-selection.test.ts` exits0.
- `rtk bun run typecheck:core` and `rtk bun run typecheck:mobile` exit0.
- Use the existing workspace ESLint configurations on affected files; no install needed.
- Adapter is deleted, duplicate pools/sets/callback removed, frozen behavior untouched, no new abstraction.
- Marker only follows successful native publication; no changed widget content or cache policy.
- Only in-scope files differ; diff check passes; no performance budget edits.

## STOP conditions / maintenance

Stop for root if another production caller relies on the callback, tests establish a deliberate widget-specific pool/sort rule, or the change needs a native contract update. Future Focus domain decisions belong in the core module; widget visibility/presentation stays in the adapter. ADR0029 native-client work and any merge responsiveness redesign remain outside this plan.
