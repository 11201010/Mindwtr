# Reusing merge signatures across syncs: why we are not doing it

Date: 2026-09-21. Branch `perf/merge-signature-reuse`, from `main` at `7273715d9`.
**No merge, sync, normalization or signature code was changed.** The only file
added to the product is one test, `packages/core/src/sync-signature-clock-dependence.test.ts`.

## What this was meant to be

`docs/performance/merge-profile-2026-09-21.md` measured one sync merge over a
store of 5,000 tasks. Computing **content signatures** costs about 103 ms of a
roughly 150 ms merge. A content signature is a short string that stands for a
task's meaning; the merge builds one for each copy of a task and compares the two
strings to decide whether the copies really differ.

`packages/core/src/sync-signatures.ts` already has a cache for that work. It is a
`WeakMap`: a lookup table whose key is one particular object, not an equal-looking
one. The profile measured it hitting only 4.6% of the time, because the merge
normalizes both snapshots first and hands the loop brand-new normalized copies.
Normalization is the step that puts a task into one canonical shape before it is
compared.

The profile's strongest suggestion was to key that cache on the task object the
merge was *given*, before normalization, instead of on the normalized copy. This
pass was to build that.

It is not worth building. Two separate findings each kill it. Either one alone
would be enough.

## Finding 1: in the real apps there is nothing to reuse

A `WeakMap` can only save work if the **same object** is handed to two different
merges. In the desktop and mobile apps that never happens.

**Every read of the saved data builds every task object from scratch.** Measured
on a 5,000-task database, counting how many task objects were the same object
between two reads:

| read path | same objects |
| --- | ---: |
| mobile, same SQLite adapter, two `getData()` calls | 0 / 5000 |
| mobile, new SQLite adapter (app restart) | 0 / 5000 |
| desktop, two `get_data` results parsed from JSON | 0 / 5000 |

That is by construction, not by accident. Mobile builds each task with
`mapTaskRow` per database row (`packages/core/src/sqlite-adapter.ts:1048`).
Desktop asks its Rust side for the whole document over the Tauri bridge, which is
JSON, and then normalizes it (`apps/desktop/src/lib/sync-service.ts:577-590`).
JSON parsing always produces new objects.

**And each of those snapshots is merged at most once.** One sync cycle runs
`mergeAppDataWithStats` exactly once (`packages/core/src/sync.ts:1371`). The
cycle's cache of the local snapshot, `localDataCache`, lives inside one cycle
(`packages/core/src/sync-run.ts:855`). Mobile can carry a snapshot to the next
cycle, but only from a cycle that **skipped** the merge
(`publishIdleCycleSnapshot`, called at `sync-run.ts:1209` and `:1342`, and
refusing to publish after any write at `:1438`). So a carried snapshot always
reaches its first merge cold, and by the time the next merge runs the app has
written and re-read the data.

To check that reasoning against the real cycle code rather than against a
benchmark, a temporary probe ran the shared sync cycle
(`runSharedSyncCycle`) eight times in a row for each platform, with the saved
data re-parsed on every read, and counted how many of the 200 local task objects
handed to each merge had been seen by an earlier merge:

| cycle | desktop | mobile |
| --- | --- | --- |
| 1 first sync | merged, 0 reused | skipped |
| 2 idle | merged, 0 reused | skipped |
| 3 idle | merged, 0 reused | skipped |
| 4 remote changed | merged, 0 reused | merged, 0 reused |
| 5 idle | merged, 0 reused | merged, 0 reused |
| 6 local edit | merged, 0 reused | merged, 0 reused |
| 7 manual sync, nothing changed | merged, 0 reused | merged, 0 reused |
| 8 manual sync, nothing changed | merged, 0 reused | merged, 0 reused |

Zero reuse in every merge, on both platforms. The incoming half of a merge is a
freshly parsed remote document, so it can never be reused either — the profile
already said so.

**A cache that is keyed on object identity cannot help this merge in production,
whichever object it is keyed on.** The 4.6% hit rate in the profile is an artefact
of the benchmark handing the same objects in twice. Building the patch would have
moved that number and moved nothing on a user's device.

## Finding 2: the proposed key would also have been wrong

The profile flagged one thing to settle first: `normalizeTaskForSyncMerge` takes
`nowIso`, the one timestamp a merge uses as "now", so in principle the same raw
task could normalize to different content at different times. A reviewer traced
the code and concluded it could not. **That conclusion is wrong.** There are three
cases where the clock does change a task's comparable content.

**Case 1: a focused task with a start time in the future.** `normalizeTaskForLoad`
drops `isFocusedToday` when the task's start time is after the end of today
(`packages/core/src/task-status.ts:226-232`). `isFocusedToday` is one of the
fields the content signature compares. So the same raw task signs one way before
its start date and another way after it:

```
clock 2026-07-13: {"id":"clock-focus","startTime":"2026-07-20T09:00:00.000Z",...}
clock 2027-03-13: {"id":"clock-focus","isFocusedToday":true,"startTime":"2026-07-20T09:00:00.000Z",...}
```

This needs no unusual data. A user who focuses a task and gives it a later start
date is in this state.

**Cases 2 and 3: a `done` or `archived` task with no timestamps at all.**
`normalizeTaskLifecycleFields` fills a missing `completedAt` from `updatedAt` and
then `createdAt` (`task-status.ts:136-139`). When all three are missing,
`normalizeTaskForLoad` has already filled `createdAt` with `nowIso`, so
`completedAt` becomes the merge clock. `completedAt` is compared too. These two
need a task with no `createdAt` and no `updatedAt`, which is rarer than case 1.

Everything else checked is clock-independent: an ordinary task, missing or invalid
`createdAt`/`updatedAt` on a live task, purged tombstones with and without
timestamps, legacy statuses, a `rev` that is not a finite number, a `revBy` with
spaces around it, a `done` task that has an `updatedAt`, a focused task whose
start has already passed, a focused task with no start time, and an unfocused task
with a future start.

**This is not a bug today.** One merge uses one `nowIso` for both copies of a
task, so both copies are always judged by the same clock, and two devices still
agree. It only matters for a signature *stored and reused across merges*, which is
exactly what the patch would have done.

`packages/core/src/sync-signature-clock-dependence.test.ts` now pins all of this:
the three cases that vary, and the thirteen that do not. If someone later makes
the focus branch clock-independent, that test fails, and that is the moment to
re-open this question.

## What was not done, and what it would be worth

- **The cache repair itself.** Not built. Worth 0 ms on a real device, per
  Finding 1.
- **Keeping one normalized snapshot between merges** (the profile's option 3).
  Dead for the same reason: the snapshot it would keep is thrown away and rebuilt
  by the next persisted read. Worth 0 ms.
- **Computing each signature only when it is read** (the profile's option 2).
  Still open and still worth doing. It is not a cache: it moves two lines in
  `packages/core/src/sync.ts` (around line 482) so that a pair whose revision
  numbers already decide the outcome never pays for signatures nobody reads. It
  does not depend on object identity, so Finding 1 does not touch it, and it does
  not store anything across merges, so Finding 2 does not touch it. Worth little
  on the two benchmark workloads, where almost every pair has equal revisions, and
  potentially a large share of a merge on a real pull, where many revisions have
  moved. Needs its own measurement on a workload with moved revisions.
- **Cutting the merge into slices** so it does not hold the JavaScript thread for
  700 ms at once. Described in the profile. Unaffected by anything here.

If the 103 ms of signature work is to be reduced, it has to be reduced by
computing signatures faster or by computing fewer of them. Reusing old ones is not
available.

## Limits

- The read-identity numbers are from a real `SqliteAdapter` over a real SQLite
  file with 5,000 tasks, and from `JSON.parse` for the desktop bridge. The desktop
  Rust side was not run; the bridge carries JSON, so a parse is what it produces.
- The eight-cycle probe drives the real `runSharedSyncCycle` with 200 tasks and
  fake storage and network that re-parse on every read, which is what the real
  adapters do. It models object lifetimes, not timings.
- No timing was measured in this pass. Nothing changed that could affect timing.
- The clock-dependence cases were found by reading `normalizeTaskForLoad` and then
  confirmed by running the real signature functions. There may be more; the test
  covers the ones found.
