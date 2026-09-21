# Sync merge profile: where `mergeAppDataWithStats` spends its time

Date: 2026-09-21. Report only. **No merge, sync or scheduling code was changed
for this.** Measurements were taken with temporary counters and timers that were
removed again; the working tree is unchanged apart from this file.

## What was measured

`mergeAppDataWithStats` on the 5,000-task generated store, for the two workloads
Gate 1 used:

- **unchanged** — the remote snapshot is identical to the local one. This is
  what every idle sync does.
- **250 changed** — the remote snapshot has 250 tasks with a new title, a
  higher `rev` and a newer `updatedAt`.

Workstation, Bun, 40 samples after 5 warm-ups, with a no-op log sink. The
reference clock (`nowIso`) is set after every timestamp in the store; with an
earlier clock the merge clamps 7,580 future timestamps and the profile measures
that instead.

For comparison, the phone blocks its JavaScript thread for about 725–740 ms on
one merge, in one unbroken stretch.

| workload | median | p95 | fastest |
| --- | ---: | ---: | ---: |
| unchanged | 149.2 ms | 236.2 ms | 122.8 ms |
| 250 changed | 144.6 ms | 194.1 ms | 131.1 ms |

**The merge costs the same whether anything changed or not.** Changing 250 of
5,000 tasks does not make it slower, and changing nothing does not make it
faster. The cost is proportional to the size of the store, not to the size of
the change.

## Where the time goes

Phase timings, median of 40 merges (unchanged workload):

| phase | ms | share |
| --- | ---: | ---: |
| merging tasks | 124.4 | 87% |
| normalizing both snapshots | 16.6 | 12% |
| merging projects and sections | 1.6 | 1% |
| repairing references | 0.8 | <1% |
| merging areas and people | 0.1 | <1% |
| compacting sections | 0.0 | <1% |
| total | 143.4 | |

So almost everything is the per-task loop. Tombstone handling, reference repair
and conflict diagnostics are not measurable here: there were no conflicts and no
tombstone repairs in either workload.

A CPU profile of the task loop, by share of samples:

| | share |
| --- | ---: |
| `JSON.stringify` | 28.6% |
| `toComparableValue` (all its lines together) | ~19.7% |
| `Array.sort` (sorting key names inside `toComparableValue`) | 10.5% |
| `Array.filter` (dropping empty keys inside `toComparableValue`) | 6.4% |
| `String.trim` (inside `toComparableValue`) | 5.5% |
| `memoizedSignature` itself | 5.3% |
| building `Date` objects | 4.5% |
| object spreads | 4.2% |
| `Date.parse` | 2.8% |

Everything in the first six rows is one activity: computing a **content
signature**. A signature is a string that stands for a task's meaning. The merge
makes one for each side and compares them to decide whether the two copies
really differ. It is built by walking the whole task, dropping empty and ignored
fields, sorting the remaining field names, trimming strings, and running
`JSON.stringify` over the result.

Measured directly, by running the same merge with the signature cache on and
then off over identical inputs:

| | cache on | cache off | difference |
| --- | ---: | ---: | ---: |
| both snapshots in canonical shape | 138.2 ms | 241.0 ms | 102.8 ms |

**Computing content signatures costs about 103 ms of a roughly 150 ms merge.**

## Finding 1: the signature cache almost never hits

`sync-signatures.ts` already has a cache for exactly this work. It is a
`WeakMap` keyed on the entity object, on the premise that a synced entity is
never changed in place, so the same object always has the same signature.

On the measured workload it hits **4.6%** of the time. The merge computes 30,780
signatures per run and reuses 1,500.

The reason is what the merge does before the loop. It normalizes both snapshots
— `normalizeTaskForSyncMerge` then `normalizeRevisionMetadata` — and hands the
*normalized* arrays to the merge loop. So the cache is keyed on the normalized
copies, not on the store's own task objects.

Normalization is careful about this. It returns the original object unchanged
when the object is already in canonical shape, and there is a test file
(`sync-normalization-identity.test.ts`) pinning that. Measured on 5,000 tasks:

| | objects whose identity survived |
| --- | ---: |
| store shape → normalized | 0 / 5000 |
| normalized → normalized again | 5000 / 5000 |
| normalized → JSON and back → normalized | 0 / 5000 |

So normalization does settle on a fixed point — but only for objects that
already came out of a previous normalization **and were never written out as
JSON**. Canonical tasks carry explicitly-present-but-empty fields, and JSON
drops those, so a round trip undoes the fixed point.

That has two consequences:

- The **incoming** snapshot is parsed from JSON every time. Its normalized
  objects are always new, so its half of the signatures can never hit. That is
  about 15,000 signature computations per merge.
- The **local** snapshot hits only when the store is holding objects a previous
  merge produced. After the app starts and hydrates from the database, it is not.

## Finding 2: signatures are computed even when the answer is not used

In `mergeEntitiesWithStats` (`sync.ts`, around line 482) both signatures are
computed for every pair, before the code works out whether it needs them:

```
const localComparableSignature = getMergeComparableSignature(...);
const incomingComparableSignature = getMergeComparableSignature(...);
const comparableContentMatches = localComparableSignature === incomingComparableSignature;
const shouldCheckContentDiff = hasRevision ? revDiff === 0 && localDeleted === incomingDeleted : ...;
const contentDiff = shouldCheckContentDiff ? !comparableContentMatches : false;
```

When `shouldCheckContentDiff` is false — the revisions differ, or one side is
deleted and the other is not — `comparableContentMatches` is thrown away. The
two signatures are then only read again inside the conflict-diagnostics block,
which runs only when the pair actually differs.

On these two workloads that costs little, because the fixture's pairs nearly all
have equal revisions. On a real sync, where a device pulls a batch in which many
revisions have moved, every such pair pays for two signatures it does not use.

## Finding 3: the third of the merge that is not signatures

About 45 ms is left after signatures. It is spread thin: parsing `updatedAt` and
`deletedAt` into `Date` objects for every pair (about 7% of samples between
`Date` and `Date.parse`), object spreads building each merged result (4.2%), and
the attachment reconciliation callback. The attachment copy elision added in
September is working: it reported 5,125 skipped copies per merge, meaning almost
every task avoided a full spread.

There is no second hot spot hiding here. Without the signature work the merge
would be roughly a third of its current cost, and what remained would need many
small changes rather than one.

## What is avoidable without changing semantics

Listed strongest first. None of these was implemented; each needs its own
reviewed patch.

1. **Key the signature cache on the store's entity object instead of the
   normalized copy.** The local half of the signatures would then hit on every
   merge after the first, because the store replaces task objects rather than
   changing them. Worth up to about half of the 103 ms. **The catch to settle
   first:** `normalizeTaskForSyncMerge` takes `nowIso`, so in principle the same
   raw object could normalize to different content at different times. Whether
   that can actually change the comparable content has to be established before
   this is safe — if it can, the cache key must include whatever makes it vary.
2. **Compute each signature only when it is read.** A pure reordering of the
   lines above, no rule changed. Saves both signatures for every pair whose
   revisions already decide the outcome. Small on these workloads, potentially
   large on a real pull.
3. **Keep one normalized snapshot between merges.** The local snapshot is
   normalized from scratch every cycle (16.6 ms) even when nothing about it
   changed. This overlaps with option 1 and has the same `nowIso` question.
4. **Skip the pair entirely when both sides are the same object after
   normalization.** Correct by definition, costs one reference comparison, but
   only fires when both snapshots are already canonical, so it helps rarely.

Not avoidable: the incoming snapshot's signatures. Those objects are new, seen
for the first time, and their content genuinely has to be read.

Explicitly **not** proposed: skipping normalization, skipping the content
comparison, trusting revision numbers instead of content, or weakening any
conflict or clock-skew check.

## Where the work could be cut into slices

If the merge were ever split so it does not hold the JavaScript thread for
700 ms at once, these are the seams. **This is a description of the shape, not a
recommendation to build it.**

Natural boundaries, from coarsest to finest:

- Between entity types: tasks, then projects, then sections, then areas, then
  people, then reference repair. Useless on its own — tasks are 87% of the work.
- Between "normalize" and "merge". Two clean halves at 12% and 87%.
- **Inside the task loop, every N pairs.** This is the only seam that actually
  breaks up the 87%. The loop visits one id at a time and each pair's result
  depends only on that pair.

State that would have to survive a pause in the middle of the task loop:

- the two normalized task arrays, or the by-id maps built from them;
- the merged-results array built so far;
- the running `stats` object for that entity type, including `conflictIds`,
  `conflictReasonCounts`, `maxClockSkewMs`, `futureTimestampClampIds`;
- the counters that live outside the loop: `tombstoneRepairs`,
  `unchangedAttachmentCopiesSkipped`, and the warning-throttle counters that
  cap log lines at five;
- `nowIso`, captured once at the start. It must not be re-read per slice, or the
  30-second delete-versus-live window and the future-timestamp clamp would move
  while the merge is running and two halves of one merge would judge by
  different clocks.

The hazard, which is why this is a separate patch and not a tuning change: the
merge reads the local snapshot once, at the start. If the user edits a task
during a pause, that edit is not in the snapshot and the merge's result would
overwrite it when written back. A test that edits during a merge and proves the
edit survives has to exist before any pause is introduced.

## Limits

- Workstation CPU time under Bun. Not the phone, not Hermes, not storage, not
  network. The phone's 725–740 ms is from the Gate 1 report.
- The machine was under other load. Medians of 40 samples; the fastest sample is
  given where it matters.
- The generated store has no attachments, no conflicts, no tombstone repairs and
  no clock skew. A merge that does hit those paths will spend time this profile
  does not show.
- The 103 ms signature figure comes from disabling the cache on data where it
  otherwise hits completely. It is the cost of computing the signatures, which is
  the right number for judging options 1 to 3.
