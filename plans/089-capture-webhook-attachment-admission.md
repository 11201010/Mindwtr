# Plan 089: Run the attachment admission checks on the cloud capture webhook

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

`POST /v1/capture` is the one route a capture-only token may call, the least-trusted credential in the system. It stores audio bytes as a real synced file attachment without the executable-signature check that `PUT /v1/attachments` applies, and its MIME allowlist is a plain object index so inherited keys like `constructor` pass. A token holder can store an executable that then syncs to the owner's devices.

## Current state

- `apps/cloud/src/server-attachments.ts:483-486` — PUT route: `const blockedSignature = getBlockedAttachmentSignature(body); if (blockedSignature) return errorResponse(..., 400)` (rejects MZ / ELF / Mach-O magic bytes, defined around `:342-357`); `validateAttachmentForUpload` runs earlier (`:449`).
- `apps/cloud/src/server-capture.ts:38-47` — `AUDIO_EXTENSION_BY_MIME_TYPE` is a plain object literal; `:328` gates with `!AUDIO_EXTENSION_BY_MIME_TYPE[payload.audio.mimeType]` (so `constructor` is truthy); `:473-499` `storeCaptureAudio` publishes the bytes with no signature check. Neither admission function is referenced in this file.
- Convention: `apps/cloud/src/server-validation.ts:43` uses `Object.prototype.hasOwnProperty.call` for allowlist reads.
- Tests: `apps/cloud/src/server.test.ts:4977-4987` covers the PUT signature rejection; `apps/cloud/src/server-capture.test.ts:467-475` has only an `application/zip` negative case.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Cloud tests | `rtk bun run --filter mindwtr-cloud test -- src/server-capture.test.ts` | all pass |
| Typecheck | `rtk bun run typecheck:cloud` | exit 0 |
| Lint | `rtk bun run lint:cloud` | exit 0 |

## Scope

**In scope** (the only files you may modify):
- `apps/cloud/src/server-capture.ts`
- `apps/cloud/src/server-attachments.ts` (only to export the shared admission helper)
- `apps/cloud/src/server-capture.test.ts`

**Out of scope** (do NOT touch):
- The attachment PUT route's behaviour
- Rate limits, token scoping, storage layout
- Locale files under `packages/core/src/i18n/locales/` (no new strings in this plan).

## Git workflow

- Branch: `agent/<slug>`; one commit for this plan, message: `fix(cloud): apply attachment admission checks to capture audio`
- Message style: repo history (`type(scope): imperative summary`, no tooling mentions). Do not push.

## Steps

### Step 1: red tests
In `server-capture.test.ts` add: (a) a capture whose audio part is declared `audio/mpeg` but whose bytes start with `MZ` → expect 400 and no task created; (b) a capture whose audio part type is `constructor` → expect 415.
**Verify**: `rtk bun run --filter mindwtr-cloud test -- src/server-capture.test.ts` → both new tests fail.

### Step 2: shared admission helper
In `server-attachments.ts` export `admitAttachmentBytes(bytes)` (or reuse `getBlockedAttachmentSignature` directly if it is already exported) and call it in `storeCaptureAudio` (or just before it) so a blocked signature returns `errorResponse('Blocked executable attachment signature: ...', 400)` exactly like the PUT route. Replace the bare index at `:328` with `Object.prototype.hasOwnProperty.call(AUDIO_EXTENSION_BY_MIME_TYPE, mimeType)`.
**Verify**: the two new tests pass; the full cloud capture suite passes.

## Test plan

- The two red→green cases above.
- Existing capture tests unchanged.

## Done criteria

- [ ] `rtk bun run --filter mindwtr-cloud test` all pass
- [ ] `rtk bun run typecheck:cloud` and `rtk bun run lint:cloud` exit 0
- [ ] `git status --short` shows no files outside the in-scope list
- [ ] `git diff --check` clean

## STOP conditions

- The signature helper is not exported and exporting it would change its module's public surface in a way the cloud tests pin — report instead of restructuring.
- The "Current state" excerpt does not match the live code.
