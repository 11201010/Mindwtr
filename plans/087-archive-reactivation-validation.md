# Plan 087: Validate archived task containers without copying all sections

Status: TODO. Priority P2. Effort M. Risk MED. Confidence HIGH. Category performance/architecture. No dependencies. Planned at `51ac48c2f` on 2026-09-15; automatically selected as Strong by the review-improve loop.

## Evidence and intent

`packages/core/src/store-tasks.ts:377-389` calls `findTaskProjectReactivationTarget` and, for each actionable task under an archived project, creates a validation-only copy of the entire section collection:

```ts
const containerValidationSections = projectReactivationTarget
    ? allSections.map((section) => (
        section.projectId === projectReactivationTarget.id && isRestorableProjectArchiveSection(section)
            ? { ...section, deletedAt: undefined }
            : section
    ))
    : allSections;
```

The copied collection is passed to `buildTaskContainerMovePatch`; the real `applyTaskProjectReactivationTransition` later restores sections once for the batch. In `task-container-rules.ts:105-110`, validation only needs to establish availability of the candidate section and live owning project. The current store caller expresses that one decision by materializing every section once per task.

A production `batchMoveTasks` host probe with 50,000 tasks, 500 projects and 2,000 sections observed 50,003 original-array maps / 100,006,000 visits for archived reopen versus 3 maps / 6,000 visits for a matched active fixture. Three uninstrumented archived batches took 2,094/1,923/1,893 ms synchronously versus 859/851/864 ms for active batches. These are synthetic Linux Bun observations with identical fixtures, not native mobile/desktop latency. Script and raw evidence are in `.orchestrator/tasks/review-20260915/improve-batch-reactivation-probe.*`; root retains reproducible evidence in the dated report.

## Settled design, invariants and deletion test

Deepen the existing container-validation module so the store can supply a narrowly scoped section-reactivation permission instead of a projected full collection. Check the actual candidate section using the existing strict archive-ownership predicate and the exact reactivating parent; the default path rejects deleted sections as before. The permission is created only after `findTaskProjectReactivationTarget` validates actionable status, final task liveness and archived/live parent. It must not authorize independently deleted/edited sections, another parent's sections, or unrelated creation/import calls.

Use optional pure `isReactivatingProjectSection?: (section: Readonly<Section>) => boolean` through `buildTaskContainerMovePatch` and `resolveTaskContainerAssignment`. Construct it in the store from the already-selected parent id and existing strict predicate; invoke only after a deleted candidate matches the requested section id. Preserve first eligible matching-section behavior. Keep lifecycle dependencies out of the container module. Do not export a generic validation bypass or duplicate the strict archive predicate. Keep presentation in platform adapters. The deletion test is removing the whole-section projection from every task preparation, not moving it into another helper/cache.

Preserve the later transition as the sole section/project state writer, exact errors, project/area/section precedence, per-task update ordering, order reservation, sibling status preservation, strict reactivation markers, revision/CAS, tombstone retention, pending snapshot save, durable acknowledgment, failed-save retry and notification semantics. No schema, native code, global cache, broad batch rewrite, or relaxed budgets. Missing the optimization is allowed only where behavior requires the existing full validation; do not skip safety work.

## Scope

Worker owns `packages/core/src/store-tasks.ts`, `task-container-rules.ts`, their focused tests (`task-container-rules.test.ts`, `store-task-project-reactivation.test.ts`, `store-task-project-reactivation-sqlite.test.ts`, `store-batch-updates.test.ts`, or the existing exact equivalent discovered through CodeGraph). The existing `packages/core/src/performance-large-store.test.ts` is also in scope to add archived-parent batch coverage at existing scales/budgets without weakening them. A small reusable synthetic work-count probe under `scripts/performance/` is allowed if needed for reproducibility. Avoid new public core exports. Root owns plans status, diagnostics ledger/field registry, `docs/performance/archive-reactivation-2026-09-15.md` and the link in stability-handoff.md.

## Execution and acceptance

1. Drift: `rtk git diff --stat 51ac48c2f..HEAD -- packages/core/src/store-tasks.ts packages/core/src/task-container-rules.ts`. Read AGENTS, CONTEXT, ADR0027, TDD, diagnosing-bugs, performance-loop and design-guardrails skills. Read docs/performance/stability-handoff.md, baselines.md and budgets.md. Existing real store/SQLite tests are the pattern. No source edits until a work-count regression fails.
2. Add a deterministic test through the production batch interface using multiple archived parents and sections. Instrument work or collection traversal without replacing the algorithm; require removal of per-task whole-array projection. Preserve assertions of task status, project activation, section placement/restoration and saved snapshot. A modest fixture is enough for the permanent test; do not assert wall-clock speed in a normal test.
3. Add behavior cases for single and batch actionable reopen, same/different parent, explicit section/area/project moves, independently deleted or edited sections, deleted/purged task/parent, mixed valid+invalid batch, and default no-permission create/import behavior. Reuse existing strict marker tests instead of weakening expected errors. Implement the narrow candidate check and delete the projection.
4. Run focused core tests including container rules, task-project-reactivation, batch updates and actual SQLite durability/reopen. From packages/core use `rtk bun run test <exact discovered files>`; no guessed names. From root `rtk bun run typecheck:core`, `rtk bun run lint:core`, `rtk git diff --check`; exit0 and no new owned-file warnings.
5. Rerun original work-count probe, preserving all state assertions. No unrelated builds/tests alongside timing. Deterministic work reduction is sufficient acceptance; host timing is descriptive only. If doing before/after timing, use pinned source and identical dependencies/fixtures, interleave batches, keep all samples and record runtime/flags. Do not claim native speedup.
6. Add one content-free `v1.3.1/archive-reactivation-validation` proof at an existing successful reactivation boundary that used this validation path. Reuse existing logging infrastructure, fixed outcome/count only; emit after the existing durable save if describing completion. Root adds matching ledger/field registry and dated evidence to the same finding commit. No identifiers/content in the new marker.
7. Root runs exact-range independent Astra Standards and Spec closure against this plan, final verify/perf, and one scoped implementation commit. No worker commits or pushes.

## Storage and coordination

Use `/home/dd/worktrees/Mindwtr/review-20260915-reactivation`; all dependencies/builds/TMPDIR/BUN_TMPDIR under `/home/dd`, never RAM-backed temp. Use RTK and CodeGraph. You are not alone; preserve others and do not mutate shared dependencies. No production data, crash-log access, or nested delegation. Root maintains plan index.

## Stop and maintenance

Report if behavior equivalence requires widening creation/import eligibility, changing persistence ownership, introducing a cycle/global cache, or touching unrelated modules. Future section lifecycle changes must keep validation eligibility aligned with actual strict restoration, and new batch operations must not rebuild whole-container collections once per item.
