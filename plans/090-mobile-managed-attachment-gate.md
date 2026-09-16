# Plan 090: Make the mobile managed-attachments gate reject path traversal

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report; do not improvise. When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat efa1e374e..HEAD -- <in-scope paths>` — if any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `efa1e374e`, 2026-09-16

## Why this matters

The only gate deciding which local file a mobile sync backend may read and upload is a bare `startsWith(managedDir)`. A `mindwtr://capture-modal?initialProps=...` deep link (reachable from any web page or app) can pre-fill an attachment whose uri is `<managedDir>/../../databases/mindwtr.db`; if the user taps Save, the next sync uploads sandbox files to the sync backend and other devices.

## Current state

- `apps/mobile/lib/attachment-sync-utils.ts:732-736` — `canUploadAttachmentFrom(uri)` returns `uri.startsWith(attachmentsDir)`. Same bare prefix at `:649`, `:757`, `:958`.
- `apps/mobile/app/capture-modal.tsx:132-163` — `sanitizeInitialAttachments` accepts any non-empty `uri`; `:165-169` `filterManagedAttachments` uses `attachment.uri.startsWith(dir)`; no `validateAttachmentForUpload` call (the other entry points do: `use-root-layout-external-capture.ts:135`, `use-task-edit-attachments.ts:158`, `use-project-attachments.ts:252`).
- `apps/mobile/app/+native-intent.ts:67` — unmatched `mindwtr://` URLs are returned verbatim; `capture-modal` is a registered route.
- The correct rule exists: `attachment-sync-utils.ts:350-358` `deleteManagedAttachmentFile` rejects a leaf containing `/` and requires the id-named file. Core `sanitizeAttachmentUriForSyncMerge` (`packages/core/src/sync-normalization.ts:95-101`) strips traversal but only runs on merge/import/restore.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Mobile tests | `rtk bun run --filter mobile test -- lib/attachment-sync-utils capture-modal` | all pass |
| Typecheck | `rtk bun run typecheck:mobile` | exit 0 |
| Lint (exhaustive-deps is an error) | `rtk bun run lint:mobile` | 0 errors |

## Scope

**In scope** (the only files you may modify):
- `apps/mobile/lib/attachment-sync-utils.ts` (+ its test)
- `apps/mobile/app/capture-modal.tsx` (+ its test)

**Out of scope** (do NOT touch):
- Sync backends under `apps/mobile/lib/attachment-sync-backends/`
- Core sanitizers
- Locale files under `packages/core/src/i18n/locales/` (no new strings in this plan).

## Git workflow

- Branch: `agent/<slug>`; one commit for this plan, message: `fix(mobile): reject traversal in the managed attachment gate`
- Message style: repo history (`type(scope): imperative summary`, no tooling mentions). Do not push.

## Steps

### Step 1: red tests
`attachment-sync-utils.test.ts`: `canUploadAttachmentFrom('<dir>/../../databases/mindwtr.db')` → false; `canUploadAttachmentFrom('<dir>/<uuid>.m4a')` → true; a uri with an extra segment (`<dir>/sub/<id>`) → false. `capture-modal` test: `initialProps` with a traversal uri → attachment dropped before render/save.
**Verify**: tests fail.

### Step 2: one predicate
Rewrite `canUploadAttachmentFrom` to require the remainder after the managed dir to be exactly one path segment with no `..`/`.` and no separator (the `deleteManagedAttachmentFile` rule). Make `:649`, `:757`, `:958` and `filterManagedAttachments` call it instead of re-spelling the prefix. Run `sanitizeInitialAttachments` through core's `sanitizeAttachmentUriForSyncMerge` (import from `@mindwtr/core`) before filtering.
**Verify**: tests pass; existing attachment tests pass.

## Test plan

- Red→green cases above; existing `attachment-sync-utils` and `capture-modal` suites unchanged.

## Done criteria

- [ ] `rtk bun run --filter mobile test` all pass (timing-only failures: rerun the file alone and report)
- [ ] `rtk bun run typecheck:mobile` exit 0, `rtk bun run lint:mobile` 0 errors
- [ ] `git status --short` shows no files outside the in-scope list
- [ ] `git diff --check` clean

## STOP conditions

- A legitimate managed uri shape exists that is not `<dir><id><ext>` (search the fixtures first); report it rather than widening the rule.
- The "Current state" excerpt does not match the live code.
