# Plan 123: Let a capture webhook sender name its capture, so a retried request adds nothing

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report; do not improvise. The coordinator maintains `plans/README.md`; do not edit it.
>
> **Drift check (run first)**: `rtk git diff --stat 561cfdfa0..HEAD -- apps/cloud/src/server-capture.ts apps/cloud/src/server-capture.test.ts apps/cloud/src/server-config.ts` — if either changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `561cfdfa0`, 2026-09-19

## Why this matters

`POST /v1/capture` on the self-hosted server turns one posted text (plus optional audio) into one Inbox task. Its senders are watches, phone shortcuts and scripts. They retry when a request times out. The server commits the task and the audio before it answers, so a sender whose connection drops after that cannot tell success from failure, retries, and creates a second task and a second audio file. The API gives the sender no way to say "this is the same capture". The on-device capture queue already solved this with a `captureId`: a known id — deleted tasks included — adds nothing. This plan gives the webhook the same optional field. Requests without it behave exactly as today.

One safety rule is part of the design: a capture-only token must never be able to READ tasks. So a replay answers with the task id only, never with the stored task's text.

## Current state

All paths are relative to the repo root.

- `apps/cloud/src/server-capture.ts` — the route. `handleCaptureRequest` (`:309-408`).
- `apps/cloud/src/server-capture.test.ts` — its tests (Bun test runner).
- `packages/core/src/store-tasks.ts:211` — the id shape core accepts for a capture id (private constant, copy the regex; do not export it):
  `const CAPTURE_ID_PATTERN = /^[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/i;`

`apps/cloud/src/server-capture.ts:114-118` (today):

```ts
export type CapturePayload = {
    transcription: string;
    recordedAtMs: number | null;
    audio: CaptureAudio | null;
};
```

JSON and text bodies, `:136-159` (today, abridged):

```ts
    if (contentType === 'application/json') {
        const text = new TextDecoder().decode(bytes).trim();
        if (!text) return { transcription: '', recordedAtMs: null, audio: null };
        …
        const record = parsed as Record<string, unknown>;
        return {
            transcription: firstString(record.transcription, record.text, record.title),
            recordedAtMs: parseRecordedAtMs(record.recordedAt),
            audio: null,
        };
    }
    return {
        transcription: new TextDecoder().decode(bytes),
        recordedAtMs: null,
        audio: null,
    };
```

Multipart, `:226-234` (today):

```ts
    const readField = (name: string): string => {
        const value = form.get(name);
        return typeof value === 'string' ? value : '';
    };
    return {
        transcription: firstString(readField('transcription'), readField('text'), readField('title')),
        recordedAtMs: parseRecordedAtMs(readField('recordedAt')),
        audio: audio && audio.bytes.byteLength > 0 ? audio : null,
    };
```

Task creation and commit, `:356-382` (today, abridged):

```ts
    const task: Task = {
        id: generateUUID(),
        title,
        status: 'inbox',
        …
    };

    return await options.withWriteLock(options.key, async () => {
        throwIfRequestAborted(options.abortSignal);
        const dataResult = loadAppDataOrError(options.filePath);
        if ('error' in dataResult) return dataResult.error;
        const data = dataResult;
        data.tasks.push(task);
        const finalized = options.finalizeForWrite(data, nowIso);
        if ('error' in finalized) return finalized.error;

        if (audio && attachment?.cloudKey) {
            const storeResponse = storeCaptureAudio(audio, attachment.cloudKey, options);
            if (storeResponse) return storeResponse;
        }
```

`data.tasks` is the synced document's task list. It includes deleted tasks (they carry `deletedAt`), which is what makes "a replay after a delete stays deleted" work. The success reply is `jsonResponse({ task: savedTask, attachment: … }, { status: 201 })` (`:406`). `errorResponse(message, status = 400)` and `jsonResponse` are already imported.

Test helpers to use, `apps/cloud/src/server-capture.test.ts`: `postFormCapture({ transcription, audio, extra })` (`:128`; `extra` adds arbitrary form fields, `:124`), `postJsonCapture(body)` (`:62`), `readStoredTasks()` (`:133`), `AUDIO_BYTES` (`:21`). Pattern to copy, `:423-432`:

```ts
    test('ignores unknown fields', async () => {
        const response = await postFormCapture({
            transcription: 'Keep working',
            extra: { deviceModel: 'index-01', battery: '84', status: 'done', projectId: 'p1' },
        });
        expect(response.status).toBe(201);
        const task = ((await response.json()) as { task: Task }).task;
        expect(task.status).toBe('inbox');
        expect(task.projectId).toBeUndefined();
    });
```

## Commands you will need

Run from the repo root.

| Purpose | Command | Expected |
|---|---|---|
| Cloud tests | `rtk bun run --filter mindwtr-cloud test -- server-capture` | all pass |
| Typecheck | `rtk bun run typecheck:cloud` | exit 0 |
| Whitespace | `rtk git diff --check` | no output |

## Scope

**In scope** (the only files you may modify):
- `apps/cloud/src/server-capture.ts`
- `apps/cloud/src/server-capture.test.ts`
- `apps/cloud/src/server-config.ts` — ONE added line in `CLOUD_LOG_MESSAGES` (see Step 2)

**Out of scope** (do NOT touch):
- `packages/core/**` — do not export `CAPTURE_ID_PATTERN`; copy the regex with a comment naming its source.
- `apps/cloud/src/server.ts`, auth, rate limits, capture tokens.
- The public docs repo (see Step 3: report the row, do not edit it unless told to).
- `plans/README.md`.

## Git workflow

- One commit for this plan, message: `fix(cloud): accept a capture id so a retried capture adds nothing`. Repo style, no tooling mentions, do not push.

## Steps

### Step 1: failing tests

In `describe('POST /v1/capture', …)` add (use a fixed made-up UUID such as `'3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b'`):

1. Multipart replay: post `{ transcription: 'Buy milk', audio: { bytes: AUDIO_BYTES, type: 'audio/mp4', name: 'recording.m4a' }, extra: { captureId: ID } }` twice (the audio shape used at `:152`). First reply `201` and `task.id === ID`. Second reply `200` with body exactly `{ task: { id: ID }, attachment: null, replayed: true }`. `readStoredTasks()` has one task with that id and one attachment.
2. JSON replay: `postJsonCapture({ transcription: 'Call Dave', captureId: ID2 })` twice → `201` then `200`; one stored task.
3. The replay reply never contains the stored text: second reply's raw text does not include `'Call Dave'`.
4. Replay after delete: create with `captureId`, then mark the stored task deleted by a client `PUT /v1/data` (copy the PUT pattern from the test at `:556` "a captured task survives a client PUT /v1/data…": GET the document, set `deletedAt` and bump `rev`/`updatedAt` on that task, PUT it back), then post the same capture again → `200`, and the stored task still has `deletedAt`; no second task exists.
5. Malformed id: `extra: { captureId: 'not-a-uuid' }` → `400`, and `readStoredTasks()` is empty.
6. Upper-case id is normalised: post with the id in upper case → `task.id` is the lower-case form.

**Verify**: `rtk bun run --filter mindwtr-cloud test -- server-capture` → the new cases FAIL.

### Step 2: implement

In `apps/cloud/src/server-capture.ts`:

1. Add `captureId: string | null;` to `CapturePayload`, and a parser:

```ts
// Same shape core accepts for a replay-safe capture id (packages/core/src/store-tasks.ts,
// CAPTURE_ID_PATTERN). Kept private there, so the pattern is repeated here on purpose.
const CAPTURE_ID_PATTERN = /^[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/i;

/** `null` = not supplied; a Response = supplied but malformed. */
const parseCaptureId = (value: unknown): string | null | Response => {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || !CAPTURE_ID_PATTERN.test(value.trim())) {
        return errorResponse('Invalid captureId', 400);
    }
    return value.trim().toLowerCase();
};
```

2. Fill the field in all four return sites: JSON (`record.captureId`), empty JSON body and plain text (`null`), multipart (`readField('captureId')`). Where `parseCaptureId` returns a `Response`, return that `Response` from the parser function (both parsers already return `CapturePayload | Response`).
3. Use it as the task id: `id: payload.captureId ?? generateUUID(),` (`:357`).
4. Inside `withWriteLock`, right after `const data = dataResult;` and BEFORE `data.tasks.push(task)` and before any audio is stored:

```ts
        if (payload.captureId && data.tasks.some((item) => item.id === payload.captureId)) {
            // A retry of a capture that already landed (deleted tasks count: it stays deleted).
            // Only the id goes back — a capture-only token must never read task content.
            logInfo('Capture webhook replay ignored', { tokenScope: options.tokenScope });
            return jsonResponse({ task: { id: payload.captureId }, attachment: null, replayed: true }, { status: 200 });
        }
```

`logInfo` only accepts messages from a closed list: `CLOUD_LOG_MESSAGES` in `apps/cloud/src/server-config.ts` (the existing entry `'Capture webhook request accepted'` is at `:42`). Add `'Capture webhook replay ignored'` right below it, in the same style. That one added line is the only change allowed in that file. If a source-scan test in `apps/cloud/src/server.test.ts` then fails because of the new literal, read its message and follow it; if that needs more than the one line, treat it as a STOP condition.

**Verify**: `rtk bun run --filter mindwtr-cloud test -- server-capture` → all pass. `rtk bun run typecheck:cloud` → exit 0.

### Step 3: report the public docs row (do not edit unless told to)

The field table in `/home/dd/code/mindwtr-web/docs/power-users/capture-webhook.md` (section `## Fields`, the `recordedAt` row is at `:41`) needs one new row. Proposed text: "`captureId` | Optional. A UUID you choose for this capture. Send the same value when you retry: the server then answers `200` with `replayed: true` and adds nothing. A malformed value is rejected with `400`." Put this in your final report.

**Verify**: none (report only).

## Test plan

- Six cases in Step 1: multipart replay (one task, one audio), JSON replay, no text in the replay reply, replay after delete stays deleted, malformed id, case normalisation. Failing first.

## Done criteria

- [ ] `rtk bun run --filter mindwtr-cloud test -- server-capture` passes with the six new cases
- [ ] `rtk bun run typecheck:cloud` exits 0
- [ ] Every pre-existing test in `server-capture.test.ts` passes unchanged (requests without `captureId` behave as before)
- [ ] `rtk git status --short` shows no files outside the in-scope list (`server-config.ts` shows exactly one added line)
- [ ] `rtk git diff --check` clean

## STOP conditions

- A "Current state" excerpt does not match the live code.
- The replay check cannot be placed before the audio is stored without restructuring the handler.
- `logInfo` needs more than a one-line addition elsewhere.
- You find that `data.tasks` does NOT include deleted tasks in this server (then "stays deleted" cannot hold — report).

## Maintenance notes

- After a deleted task's tombstone is purged (90 days), the same `captureId` would create a new task. That matches the on-device queue.
- The replay check compares against ALL task ids, not only ones created by capture. A sender that passes the id of an unrelated existing task gets `200 replayed` and nothing is written; it learns only that the id exists. That is deliberate and safe.
- Reviewer: confirm the replay reply body carries no title, description or attachment.
