# Plan 107: Show attachment download/missing state in the desktop task editor

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report; do not improvise. When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 0b9ea1d0e..HEAD -- <in-scope paths>` — if any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `0b9ea1d0e`, 2026-09-16

## Why this matters

In the desktop task editor every non-image attachment is a plain open button; a synced-but-not-yet-downloaded or missing file looks like a dead link. Mobile's editor and desktop's own list rows and project notes already show the status text and progress indicator.

## Current state

- `apps/desktop/src/components/Task/TaskForm/AttachmentsField.tsx:165-212` — plain open buttons; `:50` uses `localStatus !== 'missing'` only for thumbnails.
- Mobile reference: `apps/mobile/components/task-edit/TaskEditViewTab.tsx:385-398` (`common.loading` / `attachments.download` / `attachments.missing` + progress bar).
- Desktop indicator already used at `TaskItemDisplay.tsx:895`, `ProjectNotesSection.tsx:354` (`<AttachmentProgressIndicator attachmentId>`). Keys `attachments.missing`, `attachments.download` exist in en.ts.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Desktop | `cd apps/desktop && rtk bun run test -- AttachmentsField` | pass |
| Typecheck/lint | `rtk bun run typecheck:desktop && rtk bun run lint:desktop` | clean |

## Scope

**In scope** (the only files you may modify):
- `apps/desktop/src/components/Task/TaskForm/AttachmentsField.tsx` (+ test)

**Out of scope** (do NOT touch):
- The indicator component; attachment sync
- Locale files under `packages/core/src/i18n/locales/` (frozen this batch; reuse existing keys only).

## Git workflow

- One commit for this plan, message: `fix(desktop): show attachment download and missing states in the editor`; repo style, no tooling mentions, do not push.

## Steps

### Step 1: red test
Attachment with `localStatus: 'missing'` → the missing label renders; `localStatus: 'pending'`/downloading → the progress indicator renders.
### Step 2
Reuse the row's status text + `<AttachmentProgressIndicator>` per non-image row keyed on `localStatus`, matching the mobile states.
**Verify**: red→green.

## Test plan

- The two cases.

## Done criteria

- [ ] suite passes; typecheck + lint clean
- [ ] `git status --short` shows no files outside the in-scope list
- [ ] `git diff --check` clean

## STOP conditions

- The row's status text lives in a component that cannot be reused without a new prop surface (report).
- The "Current state" excerpt does not match the live code.
- The fix needs a new locale key (report the proposed key + English text instead).
