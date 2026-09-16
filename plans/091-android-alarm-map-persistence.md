# Plan 091: Persist the Android alarm map as alarms are created

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report; do not improvise. When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat efa1e374e..HEAD -- <in-scope paths>` — if any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `efa1e374e`, 2026-09-16

## Why this matters

The alarm map (OS alarm id per reminder key) is saved only once at the end of a reschedule cycle. One rejected `scheduleAlarm` (revoked exact-alarm permission, per-app pending-alarm cap, or a process kill mid-cycle) aborts the cycle before the save, so alarms created earlier stay live in AlarmManager but are absent from the persisted map and can never be cancelled after restart: stale reminders keep firing.

## Current state

- `apps/mobile/lib/notification-service-local.ts:625` — success path records the id only in the in-memory `alarmMap`.
- `:610-616` — `scheduleAlarmForKey` rethrows non-duplicate failures; `:784` awaits it directly, `:632` inside `Promise.all`; `:839-845` `enqueueReschedule` catches and logs, so `saveAlarmMap()` at `:797` never runs on that path (`:752` is the no-feature early branch).
- `:349-378` `loadAlarmMapIfNeeded` rebuilds from AsyncStorage on next start; `:658` `cancelInactiveKeys` cancels only ids in the map.
- `:387` — `saveAlarmMap` already no-ops when the serialized map is unchanged.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Mobile tests | `rtk bun run --filter mobile test -- lib/notification-service-local` | all pass |
| Typecheck | `rtk bun run typecheck:mobile` | exit 0 |
| Lint | `rtk bun run lint:mobile` | 0 errors |

## Scope

**In scope** (the only files you may modify):
- `apps/mobile/lib/notification-service-local.ts` (+ its test)

**Out of scope** (do NOT touch):
- Alarm scheduling semantics, digest scheduling, core `buildReminderSchedule`
- Locale files under `packages/core/src/i18n/locales/` (no new strings in this plan).

## Git workflow

- Branch: `agent/<slug>`; one commit for this plan, message: `fix(mobile): persist the alarm map even when a reschedule aborts`
- Message style: repo history (`type(scope): imperative summary`, no tooling mentions). Do not push.

## Steps

### Step 1: red test
In the existing test file, make the second `scheduleAlarm` mock reject; run a reschedule; assert the first alarm's id is present in the persisted map (the AsyncStorage mock).
**Verify**: fails.

### Step 2: save in finally
Wrap the schedule/cancel section of `runRescheduleCycle` in `try { ... } finally { await saveAlarmMap(); }` (keep the existing final save; the no-op guard at `:387` makes the extra call free).
**Verify**: test passes; the rest of the file's tests pass.

## Test plan

- Red→green case above; a second case: process abort simulated by throwing inside `cancelInactiveKeys` → map still saved.

## Done criteria

- [ ] `rtk bun run --filter mobile test -- lib/notification-service-local` all pass
- [ ] typecheck + lint clean
- [ ] `git status --short` shows no files outside the in-scope list
- [ ] `git diff --check` clean

## STOP conditions

- `saveAlarmMap` itself can throw in a way that would mask the original error — if so, log and rethrow the original; report the shape.
- The "Current state" excerpt does not match the live code.
