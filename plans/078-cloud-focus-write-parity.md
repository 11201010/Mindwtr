# Plan 078: Apply local Focus write rules to cloud task mutations

## Status
- Priority: P2; effort: M; risk: MED; category: bug.
- Planned at: `77137ce0d`, 2026-09-07. Depends on: none.
- Root maintains the index and commits once; executor does not commit or push.

## Why this matters
Cloud MCP/REST can create an Inbox task carrying a star that never qualifies for Focus, and can exceed the configured Focus cap. The same intent through the local MCP/core writer promotes an eligible Inbox capture to Next and refuses an extra star. Match that existing behavior without rejecting a capture just because its star cannot be applied.

## Current state
- `apps/cloud/src/server.ts:609-689` create validates props and calls `resolveCaptureStatusForStart`; it spreads `restProps` including isFocusedToday without the core Focus creation decision.
- `packages/core/src/store-tasks.ts:452-470` owns the intended creation decision: promote candidate Inbox status to Next, evaluate `getTaskFocusEligibility` against existing tasks plus candidate and projects, reject star if ineligible or focusedCount >= limit; only commit promotion when star sticks. addTasks updates the count sequentially across the batch.
- `store-tasks.ts:525-535` updateTask rejects a transition into starred state when the cap is full, with `Focus limit of N reached`. Existing already-starred edits and removals are allowed.
- Cloud PATCH at `server.ts:709-720` normalizes then calls applyTaskUpdates but omits that cap check. The complete/archive action at ~1265-1298 adds no stars, so no additional policy is needed there.
- `selectFocusedCount` in `store-helpers.ts:775-800` counts strict true, nondeleted, non-done/reference/archived tasks. It caches by array identity: use a fresh array for a mutable cloud snapshot. `normalizeFocusTaskLimit` owns the default3 and bounds.
- CONTEXT Focus star: addition is gated by eligibility/cap; removing always allowed; successful Inbox star clarifies to Next; due waiting/someday retains its status. Cloud snapshots may legitimately merge over-cap commitments from independent devices. Do not trim or normalize global persisted stars on read/merge.
- Existing focus-star.test.ts, store task action tests, cloud server.test.ts provide real behavioral patterns. Cloud remains independent of the global Zustand store and consumes pure core exports.

## Scope and design
Only `apps/cloud/src/server.ts`, `server.test.ts`, minimal `server-config.ts` diagnostic type entries, `packages/core/src/focus-star.ts`, `focus-star.test.ts`, `store-tasks.ts`, relevant existing store task test file, `index.ts` minimal export, diagnostics ledger/field test. Root must approve another path.
Extract the existing creation decision into a small pure core function in the Focus module, called by both store and cloud; delete the old inline decision. Preserve local behavior exactly including batch count updates. Cloud calls after constructing the final candidate (including project order) inside its namespace lock. Pass canonical task/project context and existing limit/count helpers. On create, return success and unstar an ineligible/over-cap candidate; retain Inbox unless the star actually commits. On PATCH, enforce only the current store cap transition rule after normalization and before changing data, returning a non-success client error with the existing Focus-limit message. Do not invent stronger patch eligibility rules, change schemas, repair old snapshots, or import a stateful store into cloud.
Add a bounded cloud diagnostic at the point the new policy is applied: `v1.2.9/cloud-focus-write-parity`, operation/outcome/count only. Cloud logs use their own typed context; no task text, id, token, namespace, credentials or URLs. Add ledger entry and any applicable core field registration.

## Steps and gates
1. Drift check `rtk git diff --stat 77137ce0d..HEAD -- apps/cloud/src/server.ts packages/core/src/store-tasks.ts packages/core/src/focus-star.ts`; compare drift to excerpts, stop on incompatible change.
2. Red route tests: default eligible Inbox star becomes Next; cap-full create succeeds Inbox/unstarred; explicit Next stays Next/unstarred when cap full; deferred/ineligible create declines star; due waiting/someday retains status. Real POST and GET persisted state must agree.
3. Red PATCH cap test, including configured cap1, cap3, existing-star edits, removal, and done/deleted/reference/archived historical flags not consuming slots. Preserve valid over-cap snapshot merge unchanged.
4. Implement shared creation decision and cloud PATCH gate. Cover core batch behavior so extraction cannot change it.
5. `rtk bun test apps/cloud/src/server.test.ts` passes. `rtk bun run --cwd packages/core test src/focus-star.test.ts` and relevant store tests pass.
6. `rtk bun run typecheck:core`, `rtk bun run typecheck:cloud`, `rtk bun run lint:core`, `rtk bun run lint:cloud` pass.
7. `rtk bun test scripts/ci/validate-diagnostics-ledger.test.js`; `rtk bun run --cwd packages/core test src/release-diagnostics-fields.test.ts`; `rtk git diff --check` all pass. Root runs final MCP/cloud/core aggregate suites.
8. Return scoped diff/result with actual red/green evidence, no commit.

## Worktree, stop conditions, maintenance
Use assigned isolated worktree under /home/dd/worktrees/Mindwtr. You are not alone; preserve others' edits. All dependencies/build/temp under /home/dd, never /tmp or /dev/shm. CodeGraph first, rtk shell, no crash logs. STOP if a change would reject otherwise valid capture, change local behavior, require snapshot migration, or need a new public wire field. Do not silently widen ownership. Future Focus changes must keep both pure-decision callers and route parity tests aligned.
