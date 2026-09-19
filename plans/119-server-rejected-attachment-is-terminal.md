# Plan 119: Bound the retries when the self-hosted server refuses an attachment upload with 400 or 413

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report; do not improvise. The coordinator maintains `plans/README.md`; do not edit it.
>
> **Drift check (run first)**: `rtk git diff --stat 561cfdfa0..HEAD -- apps/desktop/src/lib/sync-attachment-backends.ts apps/desktop/src/lib/sync-attachment-validation.ts apps/mobile/lib/attachment-sync-backends/cloud.ts apps/mobile/lib/attachment-sync-utils.ts` — if any of these changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `561cfdfa0`, 2026-09-19 (revised the same day: bounded seam instead of a first-answer verdict)

## Why this matters

On the self-hosted sync server, an attachment upload can be refused for good: the server answers `400` when the file's first bytes are a Windows, Linux or macOS program, and `413` when the file is larger than the server owner's size limit. The apps do not know these rules, so they try the same upload again on every sync cycle, forever. Worse, while a file attachment has no server copy, the sync run refuses to write the task document at all (`assertNoPendingAttachmentUploads`, `packages/core/src/sync-run.ts:1083-1086`). One refused file therefore stops every task edit on that device from reaching the other devices.

Desktop already has one bounded rule for an upload the CLIENT refuses: count the failure per attachment, and on the third one mark the attachment unrecoverable, which takes it out of the pending-upload list. This plan sends a SERVER `400`/`413` through that same rule, and gives mobile the same rule. Three attempts, not one, so that a proxy answering `400` once by mistake cannot remove an attachment record.

## Current state

All paths are relative to the repo root.

- `apps/desktop/src/lib/sync-attachment-validation.ts` — the bounded seam (whole file, 34 lines).
- `apps/desktop/src/lib/sync-attachment-backends.ts` — desktop attachment backends. `syncCloudAttachments` (`:1010`) is the self-hosted one.
- `apps/mobile/lib/attachment-sync-backends/cloud.ts` — the mobile self-hosted backend (a hand-written loop, not the shared lifecycle).
- `apps/mobile/lib/attachment-sync-utils.ts` — mobile attachment helpers. **Mobile has no bounded seam today**: a client-side validation failure only logs and continues (`cloud.ts:333-337`). This plan adds the seam for mobile.
- `packages/core/src/attachment-validation.ts:30-54` — `markAttachmentUnrecoverable(attachment)`: clears `cloudKey` and `fileHash`, sets `localStatus: 'missing'`, sets `deletedAt` and `updatedAt`, returns `true` when it changed something. The local file on disk is not touched. A deleted attachment is no longer a pending upload (`packages/core/src/sync-helpers.ts:108-117` skips `attachment.deletedAt`).

Server side, for reference only (do not change): `apps/cloud/src/server-attachments.ts:485-488` returns `400 Blocked executable attachment signature: …`; `:480-483` returns the body reader's status (`413`) when the body exceeds `maxAttachmentBytes`.

The seam, `apps/desktop/src/lib/sync-attachment-validation.ts:3-34` (today):

```ts
const ATTACHMENT_VALIDATION_MAX_ATTEMPTS = 3;
const attachmentValidationFailures = new Map<string, number>();

export { markAttachmentUnrecoverable };

export const clearAttachmentValidationFailure = (attachmentId: string): void => {
    attachmentValidationFailures.delete(attachmentId);
};

export const clearAttachmentValidationFailures = (): void => {
    attachmentValidationFailures.clear();
};
…
export const handleAttachmentValidationFailure = (
    attachment: Attachment,
    error: string | undefined,
): { attempts: number; reachedLimit: boolean; mutated: boolean; message: string } => {
    const attempts = (attachmentValidationFailures.get(attachment.id) || 0) + 1;
    attachmentValidationFailures.set(attachment.id, attempts);
    const reason = error || 'unknown';
    const message = `Attachment validation failed (${reason}) for ${attachment.title} [attempt ${attempts}/${ATTACHMENT_VALIDATION_MAX_ATTEMPTS}]`;
    if (attempts < ATTACHMENT_VALIDATION_MAX_ATTEMPTS) {
        return { attempts, reachedLimit: false, mutated: false, message };
    }
    attachmentValidationFailures.delete(attachment.id);
    const mutated = markAttachmentUnrecoverable(attachment);
    return { attempts, reachedLimit: true, mutated, message };
};
```

The counter is a module-level `Map`, so it lives for the app session, and one sync cycle adds at most one count per attachment.

How desktop uses it today for a client-side refusal — this is the convention to match — `apps/desktop/src/lib/sync-attachment-backends.ts:1094-1112`:

```ts
            const validation = await validateAttachmentForUpload(attachment, fileData.length);
            if (!validation.valid) {
                const failure = handleAttachmentValidationFailure(attachment, validation.error);
                reportProgress(
                    attachment.id,
                    'upload',
                    0,
                    attachment.size ?? fileData.length,
                    'failed',
                    failure.message,
                );
                deps.logSyncWarning(
                    failure.reachedLimit ? `${failure.message}; marking attachment unrecoverable` : failure.message,
                );
                return failure.mutated;
            }
            clearAttachmentValidationFailure(attachment.id);
            reportProgress(attachment.id, 'upload', 0, fileData.length, 'active');
            await withRetry(
```

**Trap**: line `:1110` clears the counter BEFORE the upload. If a server refusal is counted after it, the next cycle clears the count again and the limit is never reached. Step 2 moves that clear to after a successful upload.

The upload itself and the success path, `:1112-1145` (today, abridged):

```ts
            await withRetry(
                async () => {
                    await helpers?.assertRemoteMutationFenceHeld?.(UPLOAD_TIMEOUT_MS + 5_000);
                    return await cloudPutFile(`${baseSyncUrl}/${cloudKey}`, …);
                },
                { ...CLOUD_ATTACHMENT_RETRY_OPTIONS, onRetry: … },
            );
            attachment.cloudKey = cloudKey;
            attachment.localStatus = 'available';
            reportProgress(attachment.id, 'upload', fileData.length, fileData.length, 'completed');
            return true;
        },
```

A change made inside `onUploadError` (`:1146-1156`) is NOT saved; only the boolean returned by `onUpload` tells the shared lifecycle that the attachment changed. So the new handling must live inside `onUpload`, in a `try/catch` around `withRetry(...)`. `getErrorStatus` is already imported (`:22`). `withRetry` does not retry a `400` or `413` (`packages/core/src/retry-utils.ts:25-29` retries only `429` and `>= 500` by status), so one cycle = one PUT = one count. The activation probe flag is `helpers?.activationProbe === true` (`:1057`).

Mobile upload `catch`, `apps/mobile/lib/attachment-sync-backends/cloud.ts:392-407` (today):

```ts
      } catch (error) {
        if (shouldPropagateError || isAbortLikeError(error, options.signal)) {
          …
          throw error;
        }
        reportProgress(
          attachment.id,
          'upload',
          0,
          attachment.size ?? 0,
          'failed',
          error instanceof Error ? error.message : String(error)
        );
        logAttachmentWarn(`Failed to upload attachment ${attachment.id}`, error);
      } finally {
```

On mobile a change is saved by calling `recordPatch(attachment)` (`cloud.ts:97-100`). Both mobile upload transports put the HTTP status on the error: the native uploader sets `error.status` (`apps/mobile/lib/attachment-sync-backends/common.ts:1093-1097`), and core's `cloudPutFile` throws `CloudHttpError` with `.status` (`packages/core/src/cloud.ts:86-99`). `apps/mobile/lib/attachment-sync-utils.ts:66` already has `export { markAttachmentUnrecoverable, sleep };`. The activation probe flag on mobile is `options.activationProbe`.

Test patterns to copy:
- Desktop: `apps/desktop/src/lib/sync-attachment-backends.test.ts:561` ("uploads self-hosted cloud attachments selected from Windows paths") for the upload setup; `:499-559` ("marks cloud attachments unrecoverable when the remote file is missing") for the terminal assertions (`cloudKey` undefined, `localStatus` `'missing'`, `deletedAt` defined); `:642` for a `helpers` object with `activationProbe: true`; `:711` for a failing-upload case. `errorResponse(status, text)` is a helper already in that file.
- Mobile: `apps/mobile/lib/attachment-sync.test.ts:2380-2445` for a cloud upload test; `core.cloudPutFile` is a mock there (`const core = await import('@mindwtr/core')`), and `syncResult(...)` returns `{ didMutate, data }`.

## Commands you will need

Run from the repo root unless a `cd` is shown.

| Purpose | Command | Expected |
|---|---|---|
| Desktop tests | `cd apps/desktop && rtk bun run test -- sync-attachment-backends` | all pass |
| Mobile tests | `rtk bun run --filter mobile test -- attachment-sync` | all pass |
| Typecheck | `rtk bun run typecheck:desktop && rtk bun run typecheck:mobile` | exit 0 |
| Whitespace | `rtk git diff --check` | no output |

## Scope

**In scope** (the only files you may modify):
- `apps/desktop/src/lib/sync-attachment-backends.ts` (only inside `syncCloudAttachments`' `onUpload`)
- `apps/desktop/src/lib/sync-attachment-backends.test.ts`
- `apps/mobile/lib/attachment-sync-utils.ts` (add the mobile seam next to `:66`)
- `apps/mobile/lib/attachment-sync-utils.test.ts`
- `apps/mobile/lib/attachment-sync-backends/cloud.ts` (only the upload `catch`, the success loop, and one import)
- `apps/mobile/lib/attachment-sync.test.ts`

**Out of scope** (do NOT touch):
- `apps/desktop/src/lib/sync-attachment-validation.ts` — use the seam as it is; do not change its limit, its message or its signature.
- `packages/core/**` — the pending-upload gate and `markAttachmentUnrecoverable` stay as they are.
- `apps/cloud/**` — the server's rules are correct.
- The WebDAV, Dropbox, File Sync and CloudKit backends on both platforms (see Maintenance notes).
- Mobile's client-side validation branch (`cloud.ts:333-337`) — leave it as it is; see Maintenance notes.
- Locale files (no new user-facing string); `plans/README.md`.

## Git workflow

- One commit for this plan, message: `fix(sync): give up after three refusals when the self-hosted server rejects an attachment`. Repo style, no tooling mentions, do not push.

## Steps

### Step 1: failing desktop tests

In `apps/desktop/src/lib/sync-attachment-backends.test.ts`, next to the test at `:561` (copy its fixture and mocks). Import `clearAttachmentValidationFailures` from `./sync-attachment-validation` and call it in a `beforeEach` for these cases so counts do not leak between tests.

1. `it.each([400, 413])('keeps a cloud attachment pending after fewer than three %s answers', …)`: the fetcher answers `errorResponse(status, 'refused')` to the PUT. Call `syncCloudAttachments` twice with the same input document. After each call assert: the attachment has no `deletedAt` and no `cloudKey` (still a pending upload); exactly one PUT per call.
2. `it.each([400, 413])('marks a cloud attachment unrecoverable on the third %s answer', …)`: call three times. After the third call assert on the returned document: `cloudKey` undefined, `localStatus` `'missing'`, `deletedAt` defined; three PUTs in total; the input `appData` object was never mutated. Also assert `findPendingAttachmentUploads(result)` (import from `@mindwtr/core`) is empty — that is what lets the remote write go through on the cycle after the third refusal.
3. `it('a successful upload resets the refusal count', …)`: two `400` answers, then a `200`, then two more `400` answers on a fresh un-uploaded copy of the same attachment id → still no `deletedAt` (the count restarted at the success).
4. `it('keeps a cloud attachment pending when the server answers 503', …)`: three calls with `503`. Assert no `deletedAt`. Use the timing approach of the test at `:711` so retry delays do not slow the suite.
5. `it('does not count or mark anything during an activation probe', …)`: three calls with `400` and `helpers` carrying `activationProbe: true` (copy from `:642`). Assert no `deletedAt`.

**Verify**: `cd apps/desktop && rtk bun run test -- sync-attachment-backends` → case 2 FAILS (case 3 may fail too); 1, 4, 5 pass.

### Step 2: desktop fix

In `syncCloudAttachments`' `onUpload`:

1. Delete the `clearAttachmentValidationFailure(attachment.id);` line at `:1110` and put it after the upload succeeded, directly before `attachment.cloudKey = cloudKey;` (`:1141`).
2. Wrap the `await withRetry(...)` call in `try/catch`, mirroring the client-side branch above it:

```ts
            } catch (error) {
                const status = getErrorStatus(error);
                // The server's answer about these bytes is final (blocked content, or over its
                // size limit). Same bounded rule as a client-side refusal: count it, and let the
                // third one take the attachment out of the pending-upload list.
                if ((status === 400 || status === 413) && helpers?.activationProbe !== true) {
                    const failure = handleAttachmentValidationFailure(
                        attachment,
                        status === 413 ? 'server_file_too_large' : 'server_rejected',
                    );
                    reportProgress(attachment.id, 'upload', 0, attachment.size ?? fileData.length, 'failed', failure.message);
                    deps.logSyncWarning(
                        failure.reachedLimit ? `${failure.message}; marking attachment unrecoverable` : failure.message,
                    );
                    return failure.mutated;
                }
                throw error;
            }
```

Do not add the server's response text to the message. Leave `onUploadError` unchanged.

**Verify**: `cd apps/desktop && rtk bun run test -- sync-attachment-backends` → all pass, including the pre-existing client-side validation tests (search the file for `validation failed` or `attempt 3/3`; they must not change).

### Step 3: the mobile seam (failing test first)

In `apps/mobile/lib/attachment-sync-utils.test.ts` add tests for three new exports, `handleAttachmentUploadRefusal(attachment, reason)`, `clearAttachmentUploadRefusal(id)` and `clearAttachmentUploadRefusals()`: the first and second call return `{ reachedLimit: false, mutated: false }` and leave the attachment untouched; the third returns `{ reachedLimit: true, mutated: true }` and the attachment has `deletedAt`; after `clearAttachmentUploadRefusal(id)` the count restarts.

**Verify**: `rtk bun run --filter mobile test -- attachment-sync-utils` → the new tests FAIL (exports missing).

Then add to `apps/mobile/lib/attachment-sync-utils.ts`, below `:66`, a copy of the desktop seam under mobile names (same limit, same return shape):

```ts
// Mobile twin of apps/desktop/src/lib/sync-attachment-validation.ts: a per-session count of
// permanent upload refusals; the third one marks the attachment unrecoverable.
const ATTACHMENT_UPLOAD_REFUSAL_MAX_ATTEMPTS = 3;
const attachmentUploadRefusals = new Map<string, number>();

export const clearAttachmentUploadRefusal = (attachmentId: string): void => { … };
export const clearAttachmentUploadRefusals = (): void => { … };
export const handleAttachmentUploadRefusal = (
  attachment: Attachment,
  reason: string,
): { attempts: number; reachedLimit: boolean; mutated: boolean; message: string } => { … };
```

Build `message` from the attachment **id**, not its title (mobile's existing warnings use the id: `cloud.ts:335`).

**Verify**: `rtk bun run --filter mobile test -- attachment-sync-utils` → all pass.

### Step 4: failing mobile backend tests

In `apps/mobile/lib/attachment-sync.test.ts`, next to the test at `:2380`, add cloud upload tests whose attachment `uri` is inside the managed attachments directory (so the upload is attempted — see the other cloud tests in the file for a managed uri). Reset with `clearAttachmentUploadRefusals()` in `beforeEach`. Reject the PUT with `vi.mocked(core.cloudPutFile).mockRejectedValue(Object.assign(new Error('Cloud File PUT failed (400)'), { status: 400 }))`.

- `it.each([400, 413])`: two calls → no `deletedAt`; third call → `didMutate` true, `deletedAt` defined, `localStatus` `'missing'`, `cloudKey` undefined.
- `503` three times → no `deletedAt`.
- `400` three times with `{ activationProbe: true }` in the options → no `deletedAt`.

**Verify**: `rtk bun run --filter mobile test -- attachment-sync` → the third-call assertions FAIL.

### Step 5: mobile backend fix

In `apps/mobile/lib/attachment-sync-backends/cloud.ts`, import `handleAttachmentUploadRefusal` and `clearAttachmentUploadRefusal` from `'../attachment-sync-utils'` (extend the existing import at `:16-21`).

In the upload `catch` (`:392`), after the `shouldPropagateError` / abort check and before the existing `reportProgress`:

```ts
        const status = Number((error as { status?: unknown } | null)?.status);
        if ((status === 400 || status === 413) && !options.activationProbe) {
          const failure = handleAttachmentUploadRefusal(
            attachment,
            status === 413 ? 'server_file_too_large' : 'server_rejected',
          );
          if (failure.mutated) recordPatch(attachment);
          reportProgress(attachment.id, 'upload', 0, attachment.size ?? 0, 'failed', failure.message);
          logAttachmentWarn(failure.reachedLimit ? `${failure.message}; marking attachment unrecoverable` : failure.message);
          continue;
        }
```

In the success loop (`:418-428`, `for (const pending of pendingUploadMutations)`), add `clearAttachmentUploadRefusal(pending.attachment.id);`. The `finally` block (snapshot disposal) still runs with `continue`; do not move it.

**Verify**: `rtk bun run --filter mobile test -- attachment-sync` → all pass. `rtk bun run typecheck:desktop && rtk bun run typecheck:mobile` → exit 0.

## Test plan

- Desktop: fewer than three `400`/`413` → still pending; third → unrecoverable and no pending upload left (so the next remote write goes through); a success resets the count; `503` stays retryable; an activation probe neither counts nor marks.
- Mobile seam: unit tests of the counter. Mobile backend: the same behaviours as desktop.
- Failing first in every step that adds behaviour.

## Done criteria

- [ ] Desktop and mobile test commands above pass with the new cases
- [ ] `rtk bun run typecheck:desktop` and `rtk bun run typecheck:mobile` exit 0
- [ ] `rtk proxy grep -n "status === 400 || status === 413" apps/desktop/src/lib/sync-attachment-backends.ts apps/mobile/lib/attachment-sync-backends/cloud.ts` → one match in each file
- [ ] In `syncCloudAttachments`, `clearAttachmentValidationFailure(` has one call site and it sits after the upload succeeded
- [ ] `rtk git status --short` shows no files outside the in-scope list
- [ ] `rtk git diff --check` clean

## STOP conditions

- A "Current state" excerpt does not match the live code.
- On mobile, the patched attachment in the returned document does not carry `deletedAt` after the third refusal (then `recordPatch` does not do what this plan assumes — report, do not work around it).
- `apps/mobile/lib/attachment-sync.test.ts` mocks the `attachment-sync-utils` module as a whole, so the backend tests do not see the real seam. Report how the mock is set up; do not rewrite the mock.
- A `400` turns out to be produced for a reason other than the file content in a way that hits EVERY upload (for example a wrong base URL gives `400 Invalid attachment path` for all attachments). If your tests or reading show such a path, stop and report: three cycles later every un-uploaded attachment record would be soft-deleted, which is data loss.
- The fix appears to need a change in `packages/core` or in `sync-attachment-validation.ts`.

## Maintenance notes

- Policy, recorded for the owner: the terminal step (`markAttachmentUnrecoverable`) soft-deletes the attachment RECORD (`deletedAt`) while the local FILE stays on disk. If the owner later prefers "keep the record, stop retrying", that change belongs in core's pending-upload rule (`packages/core/src/sync-helpers.ts:100-117`), not in the backends.
- The count lives in memory for the app session. After a restart the three attempts start again. That matches the desktop seam's existing behaviour.
- Not done, needs an owner decision: a `413` does not show the existing `too-large` toast. That toast appears only when an `AttachmentUploadTooLargeError` aborts the whole attachment phase (`packages/core/src/sync-run.ts:1711-1713`), which would discard the refusal count's terminal patch, and its text is File Sync specific — "File Sync can only sync attachments under 100 MB" (`apps/desktop/src/components/Layout.tsx:596-600`, key `settings.syncFileAttachmentTooLarge`). Reusing it for a server limit would show a wrong sentence; a correct one needs a new locale key. Proposed for a follow-up: `settings.syncServerAttachmentTooLarge` — "Your sync server refused an attachment because it is larger than the server allows. Mindwtr kept the local file. Remove the attachment or raise the server limit, then sync again." Until then the refusal shows through the attachment's failed upload status (reason `server_file_too_large`) and the sync log.
- Follow-up, recorded and deliberately not done: the WebDAV backends have the same endless retry for `413` and `507 Insufficient Storage` (`apps/desktop/src/lib/sync-attachment-backends.ts` around `:815-910`, `apps/mobile/lib/attachment-sync-backends/webdav.ts:430-445`). That is a different function with its own rate-limit and conflict handling, and `507` can be fixed by the user (free space), so it needs its own decision.
- Follow-up: mobile's client-side validation failures (`cloud.ts:333-337` and the same lines in the other four mobile backends) still only log and continue, with no limit. Routing them through the new mobile seam is a few lines per backend, but it changes behaviour for transient local read failures, so it was left out.
- Reviewer: check that the server's response text is never logged, and that the desktop message (which includes the attachment title, as the existing client-side message does) goes through the normal sanitized logger.
