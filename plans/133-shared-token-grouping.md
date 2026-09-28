# Plan 133: Keep token-group membership in the existing core module

## Status

- Priority: P3; effort: S; risk: LOW–MED.
- Category: architecture; dependencies: none.
- Planned at: `285b922ab`, 2026-09-28.
- Strength: Worth exploring, selected for repeated domain decisions and two real
  shipping adapters. No measured performance or current correctness defect claim.
- Root owns plan status, commits and integration. Do not push.

## Why and current state

Desktop `apps/desktop/src/components/views/list/next-grouping.ts:158` and `:417`
implement context/tag grouping. Core `packages/core/src/task-group-sections.ts:172`
and `:201` repeat it for the shipping RN TaskList. All four loops trim tokens,
drop blanks, deduplicate each task's memberships, sort with `baseTextCollator`,
preserve task order and append a tokenless group last:

```ts
const contexts = (task.contexts ?? [])
  .map((value) => value.trim())
  .filter((value) => value.length > 0);
Array.from(new Set(contexts)).forEach((context) => {
  const contextTasks = grouped.get(context) ?? [];
  contextTasks.push(task);
  grouped.set(context, contextTasks);
});
```

Desktop adds theme colors and returns groups. RN flattens groups and applies
collapse while preserving header counts. `apps/mobile/lib/task-group-sections.ts`
already reexports the core interface; do not add another forwarding module.
`next-grouping.test.ts` and the RN `lib/task-group-sections.test.ts` are existing
behavior-visible seams. Completion-date grouping demonstrates existing shared
policy with presentation retained in adapters.

## Design brief

Deepen the existing core grouping module: one token-membership implementation,
reused by context/tag group-producing functions with the existing desktop call
shapes. Desktop may import/reexport and decorate those results; core's FlatList
builder consumes the same membership groups. Keep colors and platform labels
outside the shared membership rule. Delete the four independent loops; a new
interface that merely forwards to them does not satisfy this plan.

Invariants:

1. Trim and ignore blanks; preserve case, no new normalization.
2. One occurrence per distinct token; include every distinct membership.
3. Keep task order, `baseTextCollator` group ordering, catch-all last, no empty groups.
4. Preserve `context:<token>`, `tag:<token>`, `context:none`, `tag:none`.
5. Preserve each adapter's existing fallback label keys and desktop theme colors.
6. Collapsed RN headers keep full counts; hidden rows stay absent from selection.

Non-goals: no new grouping registry, configurable framework, grouping axis,
general all-axis unification, native migration change or UI redesign.

## Scope

- `packages/core/src/task-group-sections.ts`, appropriate tests, `src/index.ts`
  only for the minimal exports required by existing desktop imports.
- Desktop `next-grouping.ts` and its test.
- RN `apps/mobile/lib/task-group-sections.test.ts` and existing adapter only if
  necessary. Avoid modifying runtime RN TaskList when its interface stays intact.

## Steps and verification

1. Drift-check all scoped files against `285b922ab`; compare current loops above.
2. Add a characterization fixture covering whitespace/duplicates/multiple tokens,
   tokenless tasks, existing labels/colors and collapsed groups. Exercise the
   existing adapter interfaces; retain integration protection. Baseline should pass.
3. Consolidate membership inside the existing module and remove old loops. Reuse
   existing types where practical; do not expose platform flattening as new policy.
4. From `apps/desktop`, run
   `rtk bunx vitest run src/components/views/list/next-grouping.test.ts --maxWorkers=2`.
   From `apps/mobile`, run
   `rtk bunx vitest run lib/task-group-sections.test.ts --maxWorkers=2`.
   Run any added core grouping file from `packages/core` with `--maxWorkers=2`.
   All pass. Do not stack duplicate implementation-only suites.
5. Root `rtk bun run typecheck`, relevant core/desktop/mobile lints and
   `rtk git diff --check` pass. Root owns final aggregate/performance gates.

## Done and stop conditions

- One membership implementation replaces four loops; existing adapter interfaces,
  labels, ordering, colors, collapse and selection behavior remain unchanged.
- Independent Standards and Spec review uses this plan as the exact Spec.
- Stop if sharing requires a wider TaskList interface or a generalized registry;
  that fails the deletion test. Do not fix unrelated grouping differences.
- Maintenance: token-membership changes belong in the core implementation;
  platform rendering remains in adapters.
