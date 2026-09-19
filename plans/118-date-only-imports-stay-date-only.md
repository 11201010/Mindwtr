# Plan 118: Keep date-only due dates date-only in the Todoist importer and in speech-to-task

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report; do not improvise. The coordinator maintains `plans/README.md`; do not edit it.
>
> **Drift check (run first)**: `rtk git diff --stat 561cfdfa0..HEAD -- packages/core/src/todoist-import.ts packages/core/src/task-speech.ts` — if either changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `561cfdfa0`, 2026-09-19

## Why this matters

Mindwtr has a hard rule: a date with no clock time ("date-only", stored as `YYYY-MM-DD`) must never gain a time, because any stored value that contains a time schedules a reminder and is due at that exact minute instead of at the end of the day. Two places break the rule. The Todoist importer turns `today`, `tomorrow`, `in 3 days`, a weekday name, or `5 Mar 2026` into a full timestamp carrying the clock time of the import (or midnight). A date with no year is worse: the JavaScript engine reads `Mar 5` as the year 2001. Speech-to-task rewrites every due date and start date as a full timestamp, so "due Friday" becomes Friday 00:00 with a midnight reminder. After this plan both paths store `YYYY-MM-DD` unless the source text really contains a time, and a date with no year is reported as unparsed instead of invented.

## Current state

All paths are relative to the repo root.

- `packages/core/src/todoist-import.ts` — Todoist CSV/ZIP importer. `parseTodoistDate` (`:198-270`) turns the DATE cell into `dueDate`.
- `packages/core/src/task-speech.ts` — maps a speech/AI parse result onto task fields (`buildTaskUpdatesFromSpeechResult`, `:58`).
- `packages/core/src/import-source-reader.ts:308-309` — `formatLocalDate(date)` returns `YYYY-MM-DD` in local time. `todoist-import.ts` already imports other helpers from this file (`:2-16`).
- `packages/core/src/date.ts:753-756` — `hasTimeComponent(value)`: true when the text contains `T` or a space followed by `HH:MM`. `packages/core/src/date.ts:689` — `safeParseDate`.
- `packages/core/src/schedule-utils.ts:51-56` — a reminder is planned only for values where `hasTimeComponent` is true. `getTaskReminderPlan(task, now)` (`:147-166`) returns `{ next, repeats }`; `next` is `null` when nothing is scheduled.

`packages/core/src/todoist-import.ts:210-266` (today, abridged to the returning lines):

```ts
    if (/^\d{4}-\d{2}-\d{2}$/u.test(text)) {
        return { dueDate: text };
    }

    const isoCandidate = text.match(/^\d{4}-\d{2}-\d{2}(?:[T\s].+)?$/u) ? new Date(text) : null;
    if (isoCandidate && Number.isFinite(isoCandidate.getTime())) {
        return { dueDate: isoCandidate.toISOString() };
    }

    const normalized = text.toLowerCase();
    const now = new Date();
    const inMatch = normalized.match(/^in\s+(\d+)\s+(day|days|week|weeks|month|months|year|years)$/u);
    if (inMatch) {
        …
        return { dueDate: date.toISOString() };          // :230
    }

    if (normalized === 'today') {
        return { dueDate: now.toISOString() };           // :234
    }
    if (normalized === 'tomorrow') {
        …
        return { dueDate: tomorrow.toISOString() };      // :239
    }
    …
    if (typeof weekday === 'number') {                   // :256
        …
        return { dueDate: target.toISOString() };        // :260
    }

    const parsed = new Date(text);                       // :263
    if (Number.isFinite(parsed.getTime())) {
        return { dueDate: parsed.toISOString() };        // :265
    }

    counters.unparsedDates += 1;
    return {};
```

`packages/core/src/task-speech.ts:109-116` (today):

```ts
    if (result.dueDate) {
        const parsed = safeParseDate(result.dueDate);
        if (parsed) updates.dueDate = parsed.toISOString();
    }
    if (result.startTime) {
        const parsed = safeParseDate(result.startTime);
        if (parsed) updates.startTime = parsed.toISOString();
    }
```

Convention to match — the sibling importer already does it right, `packages/core/src/omnifocus-import.ts:284-295`:

```ts
    const parsed = safeParseDate(trimmed);
    if (!parsed) {
        return { rawText: trimmed };
    }
    if (/Z$|[+-]\d{2}:?\d{2}$/iu.test(trimmed)) {
        return { value: parsed.toISOString() };
    }
    return {
        value: /(?:\d{1,2}:\d{2}|[ap]\.?m\.?)/iu.test(trimmed)
            ? formatLocalDateTime(parsed)
            : formatLocalDate(parsed),
    };
```

Test pattern to copy — `packages/core/src/todoist-import.test.ts:65-79`:

```ts
    it('does not fabricate a due date when a DATE cell is "constructor" (SEC-13)', () => {
        const csv = [
            'TYPE,CONTENT,PRIORITY,INDENT,DATE,DESCRIPTION',
            'task,Odd date value,4,1,constructor,',
        ].join('\n');

        const result = parseTodoistImportSource({
            fileName: 'Bug.csv',
            text: csv,
        });

        expect(result.valid).toBe(true);
        expect(result.parsedProjects[0]?.tasks[0]?.dueDate).toBeUndefined();
        expect(result.warnings).toContain('1 Todoist due date could not be parsed and was skipped.');
    });
```

## Commands you will need

Run from the repo root.

| Purpose | Command | Expected |
|---|---|---|
| Todoist tests | `rtk bun run --filter @mindwtr/core test -- todoist-import` | all pass |
| Speech tests | `rtk bun run --filter @mindwtr/core test -- task-speech` | all pass |
| Typecheck | `rtk bun run typecheck:core` | exit 0 |
| Whitespace | `rtk git diff --check` | no output |

## Scope

**In scope** (the only files you may modify):
- `packages/core/src/todoist-import.ts`
- `packages/core/src/todoist-import.test.ts`
- `packages/core/src/task-speech.ts`
- `packages/core/src/task-speech.test.ts`

**Out of scope** (do NOT touch):
- `packages/core/src/date.ts`, `packages/core/src/import-source-reader.ts` — use their helpers as they are.
- `packages/core/src/omnifocus-import.ts`, `ticktick-import.ts`, `mindwtr-csv-import.ts` — already correct.
- `packages/core/src/speech-to-task.ts` (the AI prompt) — the fix is on the reading side.
- Locale files; `plans/README.md`.

## Git workflow

- One commit for this plan, message: `fix(import): keep date-only Todoist and speech due dates without a clock time`. Repo style, no tooling mentions, do not push.

## Steps

### Step 1: write the failing Todoist tests

In `packages/core/src/todoist-import.test.ts` add (import `vi` from `vitest`, `hasTimeComponent` from `./date`, `getTaskReminderPlan` from `./schedule-utils`). Freeze the clock with `vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 15, 14, 37, 0));` (local 15 Sep 2026, a Tuesday, 14:37) and restore with `vi.useRealTimers()` in `afterEach`.

One `it.each` over DATE cell → expected `dueDate`:

| DATE cell | expected `dueDate` |
|---|---|
| `today` | `2026-09-15` |
| `tomorrow` | `2026-09-16` |
| `in 3 days` | `2026-09-18` |
| `in 2 weeks` | `2026-09-29` |
| `friday` | `2026-09-18` |
| `5 Mar 2027` | `2027-03-05` |

For every row also assert `hasTimeComponent(dueDate) === false`.

Separate cases:
- `Mar 5` (no year) → `dueDate` undefined and `result.warnings` contains `'1 Todoist due date could not be parsed and was skipped.'`.
- `2026-03-05 14:00` (a real time) → `hasTimeComponent(dueDate) === true` (unchanged behaviour).
- Reminder regression: build a task `{ id: 't', title: 'x', status: 'next', tags: [], contexts: [], createdAt: …, updatedAt: …, dueDate: <the value parsed from 'tomorrow'> }` and assert `getTaskReminderPlan(task, new Date()).next` is `null` and `.repeats` is empty.

**Verify**: `rtk bun run --filter @mindwtr/core test -- todoist-import` → the new cases FAIL (values contain `T…Z`; `Mar 5` yields a 2001 date), the rest pass.

### Step 2: fix `parseTodoistDate`

In `packages/core/src/todoist-import.ts`:

1. Add `formatLocalDate` to the existing import from `./import-source-reader` (`:2-16`).
2. At `:230`, `:234`, `:239`, `:260` return `formatLocalDate(<the Date>)` instead of `<the Date>.toISOString()`.
3. Replace the free-text fallback at `:263-266` with:

```ts
    // Engines invent a year for yearless text ("Mar 5" parses as 2001), so a
    // free-text date must name its own four-digit year.
    if (/\b\d{4}\b/u.test(text)) {
        const parsed = new Date(text);
        if (Number.isFinite(parsed.getTime())) {
            const hasClockTime = /\d{1,2}:\d{2}|\d\s*[ap]\.?m\b/iu.test(text);
            return { dueDate: hasClockTime ? parsed.toISOString() : formatLocalDate(parsed) };
        }
    }
```

Leave the `YYYY-MM-DD` branch (`:210-212`) and the ISO branch (`:214-217`) unchanged.

**Verify**: `rtk bun run --filter @mindwtr/core test -- todoist-import` → all pass.

### Step 3: write the failing speech tests

In `packages/core/src/task-speech.test.ts`, copy the call shape of the first test (`:6-40`) and add:
- result `dueDate: '2026-04-08'` → `plan.updates.dueDate === '2026-04-08'` (the function returns `{ updates, suggestedProjectTitle }`, see the `expect(plan).toEqual({ updates: { … } })` at `:36-45`).
- result `startTime: '2026-04-08'` → stored as `'2026-04-08'`.
- result `dueDate: '2026-04-08T15:00:00.000Z'` → unchanged expectation (still the ISO instant).
- result `dueDate: 'not a date'` → no `dueDate` in the updates.

**Verify**: `rtk bun run --filter @mindwtr/core test -- task-speech` → the two date-only cases FAIL.

### Step 4: fix `task-speech.ts`

Import `hasTimeComponent` next to `safeParseDate` (`:4`). Add `formatLocalDate` from `./import-source-reader`. At `:109-116`:

```ts
    if (result.dueDate) {
        const parsed = safeParseDate(result.dueDate);
        if (parsed) updates.dueDate = hasTimeComponent(result.dueDate) ? parsed.toISOString() : formatLocalDate(parsed);
    }
```

Same for `startTime`.

**Verify**: `rtk bun run --filter @mindwtr/core test -- task-speech` → all pass. `rtk bun run typecheck:core` → exit 0.

## Test plan

- Todoist: 6-row table, the yearless case, the real-time case, the no-reminder case (Step 1).
- Speech: 4 cases (Step 3).
- Failing first in both files.

## Done criteria

- [ ] `rtk bun run --filter @mindwtr/core test -- todoist-import` passes with the new cases
- [ ] `rtk bun run --filter @mindwtr/core test -- task-speech` passes with the new cases
- [ ] `rtk proxy grep -n "toISOString" packages/core/src/todoist-import.ts` shows only the ISO branch (`isoCandidate`) and the `hasClockTime` line
- [ ] `rtk bun run typecheck:core` exits 0
- [ ] `rtk git status --short` shows no files outside the in-scope list
- [ ] `rtk git diff --check` clean

## STOP conditions

- A "Current state" excerpt does not match the live code.
- Importing `formatLocalDate` into `task-speech.ts` creates an import cycle or a typecheck error (report it; the alternative is a three-line local formatter, but ask first).
- An existing Todoist test that expects a full timestamp for a date-only input fails — report the test name; do not change its expectation without confirmation.

## Maintenance notes

- Any new importer must follow the same rule: store `YYYY-MM-DD` unless the source text itself carries a time. `omnifocus-import.ts:273-295` is the reference.
- `parseTodoistDate` calls `new Date()` internally; tests must freeze the clock.
- Not done here: the Todoist TIMEZONE column is still ignored for values with a real time.
