# Plan 120: Give email-captured tasks an id computed from the message, so a replay or a second desktop cannot create the task twice

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report; do not improvise. The coordinator maintains `plans/README.md`; do not edit it.
>
> **Drift check (run first)**: `rtk git diff --stat 561cfdfa0..HEAD -- apps/desktop/src/lib/email-capture.ts apps/desktop/src/lib/email-capture.test.ts` — if either changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (plan 122 touches the Rust half of the same feature; the two do not overlap)
- **Category**: bug
- **Planned at**: commit `561cfdfa0`, 2026-09-19

## Why this matters

Desktop email capture reads a mail folder and turns each new message into an Inbox task. The memory of "already imported" is a file on that one desktop. Every task gets a random id. So the same email becomes two tasks when (a) two desktops watch the same mailbox, (b) the app stops between saving the tasks and saving the "already imported" mark, or (c) the mail server renumbers the folder. The public docs promise "nothing shows up twice". Core already has a replay-safe option: `addTasks` accepts a `captureId` per item; if a task with that id already exists — deleted ones included — it returns the existing task and adds nothing. This plan computes that id from the email's Message-ID, so all three cases collapse into one task, and a task the user deleted stays deleted.

## Current state

All paths are relative to the repo root.

- `apps/desktop/src/lib/email-capture.ts` — the polling controller. `runCycle` builds the task items.
- `apps/desktop/src/lib/email-capture.test.ts` — its tests.
- `packages/core/src/store-tasks.ts:445-495` — `addTasks(items)`; each item may carry `captureId?: string`. It must match `/^[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/i` (`:211`) or the whole call fails with `'Capture ID must be a UUID'`. A known id (the check uses `_allTasks`, which includes deleted tasks) is a replay: nothing is added.
- `packages/core/src/uuid.ts:69-76` — `generateDeterministicUUID(value: string): string` returns a UUID-shaped string computed from the text. It is exported from `@mindwtr/core` (`packages/core/src/index.ts:101`, `export * from './uuid'`).
- `apps/desktop/src/App.tsx:941-942` wires the controller: `addTasks: (items) => useTaskStore.getState().addTasks(items)`. Items are passed through unchanged, so no change is needed there.
- `apps/desktop/src-tauri/src/email_capture.rs:314-318` — when an email has no Message-ID header, Rust sends the fallback `uid:<uidValidity>:<uid>`. That fallback changes when the server renumbers the folder, so it must NOT be used for a deterministic id.

`apps/desktop/src/lib/email-capture.ts:234-244` (today):

```ts
                    const items = result.messages.map((message) => {
                        const { title, description } = buildTaskFromEmailMessage(message);
                        return {
                            title,
                            initialProps: {
                                status: 'inbox',
                                ...(description ? { description } : {}),
                            } as Partial<Task>,
                        };
                    });
                    const added = await options.addTasks(items);
```

`apps/desktop/src/lib/email-capture.ts:168` (today):

```ts
    addTasks: (items: Array<{ title: string; initialProps?: Partial<Task> }>) => Promise<AddTasksResult>;
```

`apps/desktop/src/lib/email-capture.ts:1` (today): `import type { Task } from '@mindwtr/core';`

Existing test that will need its expectation widened, `apps/desktop/src/lib/email-capture.test.ts:121-140`:

```ts
    it('adds inbox tasks, flushes persistence, then commits the watermark', async () => {
        const { controller, deps, calls } = createController();
        await controller.pollNow();

        expect(deps.addTasks).toHaveBeenCalledWith([
            {
                title: 'Renew passport',
                initialProps: {
                    status: 'inbox',
                    description: 'From: Jane Doe <jane@example.com>\n\nBring the old passport.',
                },
            },
        ]);
```

The test helpers `message(overrides)` (`:14-22`, default `messageId: 'id-11@example.com'`), `pollResult(overrides)` (`:24-30`) and `createController(overrides)` (`:43`) already exist; use them.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Desktop tests | `cd apps/desktop && rtk bun run test -- email-capture` | all pass |
| Typecheck | `rtk bun run typecheck:desktop` | exit 0 |
| Whitespace | `rtk git diff --check` | no output |

## Scope

**In scope** (the only files you may modify):
- `apps/desktop/src/lib/email-capture.ts`
- `apps/desktop/src/lib/email-capture.test.ts`

**Out of scope** (do NOT touch):
- `apps/desktop/src-tauri/src/email_capture.rs` — the Rust poller and its state file stay as they are (plan 122 changes the fetch there).
- `packages/core/**` — use the existing `captureId` option and `generateDeterministicUUID` as they are.
- `apps/desktop/src/App.tsx`.
- `plans/README.md`.

## Git workflow

- One commit for this plan, message: `fix(desktop): give email-captured tasks a stable id so a replay adds nothing`. Repo style, no tooling mentions, do not push.

## Steps

### Step 1: failing tests

In `apps/desktop/src/lib/email-capture.test.ts`, inside `describe('createEmailCaptureController', …)`:

1. `it('passes a stable capture id derived from the Message-ID', …)`: run `pollNow()` twice on two separate controllers created with `createController()`. Read `captureId` from the first item of each `deps.addTasks` call. Assert both are equal and match `/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i`.
2. `it('gives different messages different capture ids', …)`: a poll result with `message()` and `message({ uid: 12, messageId: 'id-12@example.com' })` → two different `captureId` values.
3. `it('uses no capture id for the uid fallback Message-ID', …)`: `message({ messageId: 'uid:7:11' })` → the item has no `captureId` key.

Update the existing expectation at `:125-133` by adding `captureId: expect.any(String)` to the expected item.

**Verify**: `cd apps/desktop && rtk bun run test -- email-capture` → the three new cases and the updated one FAIL.

### Step 2: implement

In `apps/desktop/src/lib/email-capture.ts`:

1. Change line 1 to import the value too: `import { generateDeterministicUUID, type Task } from '@mindwtr/core';`
2. Add near the other constants (`:5-13`):

```ts
// Rust falls back to `uid:<uidValidity>:<uid>` when an email has no Message-ID header.
// That value changes when the server renumbers the folder, so it cannot name the task.
const UID_FALLBACK_MESSAGE_ID = /^uid:\d+:\d+$/;

export const emailCaptureIdFor = (messageId: string): string | undefined => {
    const trimmed = messageId.trim();
    if (!trimmed || UID_FALLBACK_MESSAGE_ID.test(trimmed)) return undefined;
    return generateDeterministicUUID(`email-capture:${trimmed}`);
};
```

3. In the `items` map (`:234-243`) add the id when there is one:

```ts
                        const captureId = emailCaptureIdFor(message.messageId);
                        return {
                            title,
                            initialProps: { … unchanged … } as Partial<Task>,
                            ...(captureId ? { captureId } : {}),
                        };
```

4. Widen the option type at `:168` to `Array<{ title: string; initialProps?: Partial<Task>; captureId?: string }>`.

Leave the order `addTasks` → `flushPendingSave` → `commit` and the `imported += result.messages.length` line unchanged.

**Verify**: `cd apps/desktop && rtk bun run test -- email-capture` → all pass. `rtk bun run typecheck:desktop` → exit 0.

## Test plan

- The three new cases plus the widened existing one (Step 1). Failing first.
- The replay behaviour itself (known id, deleted or not, adds nothing) is already covered in core's `addTasks` tests; do not duplicate it here.

## Done criteria

- [ ] `cd apps/desktop && rtk bun run test -- email-capture` passes with the new cases
- [ ] `rtk bun run typecheck:desktop` exits 0
- [ ] `rtk proxy grep -n "captureId" apps/desktop/src/lib/email-capture.ts` shows the helper, the item field and the option type
- [ ] `rtk git status --short` shows no files outside the in-scope list
- [ ] `rtk git diff --check` clean

## STOP conditions

- A "Current state" excerpt does not match the live code.
- `generateDeterministicUUID` is not importable from `@mindwtr/core` in the desktop test run (report the error; do not copy the function).
- The typecheck shows that `useTaskStore.getState().addTasks` does not accept `captureId` (it should: `packages/core/src/store-types.ts:82`).

## Maintenance notes

- Two emails with the same Message-ID (a sender bug, or a deliberate copy) now become one task. That matches how the Rust side already treats them (`seen_message_ids`).
- A task the user deleted is not re-created by a replay until its tombstone is purged (90 days). That is intended.
- `lastImportCount` still counts polled messages, not tasks actually added; on a replay it can read one higher than the tasks created. Cosmetic; not changed here.
