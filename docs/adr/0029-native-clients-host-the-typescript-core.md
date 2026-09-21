# ADR 0029: Native clients host the TypeScript core in-process

Date: 2026-09-21
Status: Proposed

## Context

ADR 0028 covers native surfaces that run while the app is closed: a durable queue file, then a headless JavaScript run that takes seconds. That path cannot serve a screen.

A native application screen (Jetpack Compose on Android, SwiftUI on iOS) needs much more than "save this task". It needs the Focus sections, the rules for which tasks show today, sorting, the quick-add parser, recurrence, and the texts in 23 languages. All of that lives in `@mindwtr/core`: about 69,000 lines of TypeScript without tests and translations, imported by 394 mobile files today, and shared with desktop, the cloud server and the MCP server.

So a native client is first a decision about how it reaches the core inside its own process. There are two ways:

1. **Port the core to Rust.** TypeScript and Rust would coexist for a long time, across desktop, cloud and MCP as well. That means two implementations of sync merge, tombstones, recurrence and storage normalization, which is the kind of duplication that has repeatedly produced bugs in this project. ADR 0028 lists the conditions for reopening this option.
2. **Keep the TypeScript core and embed a JavaScript engine in the native app, without React Native.** Kotlin and Swift call the core through a small API. iOS ships JavaScriptCore as a system framework. On Android the engine (Hermes standalone, QuickJS, or another) is a choice to make by measurement.

What is known about the core today, measured on 2026-09-21:

- Its runtime dependencies are pure JavaScript: `date-fns`, `date-fns-jalali`, `chrono-node`, `fflate`, `uqr`, `@noble/hashes`, `zustand`. It has no React Native or Expo import.
- The store is created with `zustand/traditional`, which imports `react`. Two files import `react` directly. An embedded bundle must either carry `react` (pure JS) or build the store through zustand's vanilla entry.
- It expects these host features (count of non-test files that use them): `URL` 12, `setTimeout` 10, `TextEncoder`/`TextDecoder` 9, `Intl` 7, `AbortController` 5, `performance.now` 4, `structuredClone` 3, `crypto.subtle` 2, `crypto.getRandomValues` 2. It never calls `fetch` itself. 14 files mention `localStorage`.
- Storage and sync IO already go through ports: the `StorageAdapter` set with `setStorageAdapter`, and the sync orchestration ports of ADR 0014. A native host would supply those ports in Kotlin or Swift.
- Whether the core boots in a bare engine has not been tried.

Nothing in this ADR has been built or measured.

## Decision

Propose option 2 as the first architecture to test for native clients. Option 1 stays closed unless Gate 1 below fails for a reason that only a native engine can fix.

1. **One core.** `@mindwtr/core` stays the single implementation of domain rules, queries, parsing, recurrence, translations and sync policy. The native client holds no domain rule.
2. **A long-lived engine.** The app process creates one JS engine, loads one core bundle, attaches host ports, opens the existing database, and keeps the core alive for the life of the process. It is an application engine, not a per-call script.
3. **Host ports.** Native code supplies SQLite, network, filesystem, crypto, timers and the other host features listed above. The React Native runtime defects recorded in ADR 0028 (networking, storage, timers) do not carry over, because those parts become native.
4. **A deliberate native API, not the store.** Kotlin and Swift never see the Zustand store. They call queries that return plain data objects (`queryInbox`, `queryFocus`, `getTask`, `search`) and commands that map to existing store actions (`addTask`, `updateTask`, `completeTask`, `deleteTask`). Native code never writes Mindwtr tables.
5. **Invalidate, then query.** The core reports coarse change notices (a revision number and the affected domains, for example `tasks`, `focus`). The native screen reruns its query. The store is not mirrored across the boundary.
6. **Same data in place.** The native client opens the same database file under the same application id and keeps the data format and sync behavior, so React Native clients and native clients sync with each other for as long as both exist.
7. **Engine choice is an outcome.** Gate 1 picks the Android engine from measurements. iOS starts from JavaScriptCore.

### Gate 1: embedded core without React Native (no production UI)

A minimal Android host must prove seven things on a physical phone, against a generated 5,000-task dataset (the size the performance budgets in `docs/performance/budgets.md` already use):

1. **Bundle.** The core builds into one bundle that boots in a plain ECMAScript engine with a written list of host APIs. Every accidental platform assumption found becomes a port or a polyfill, and is listed.
2. **Boot.** Measure separately: engine start, bundle evaluation, database and core initialization, time to first query.
3. **Reads.** `queryInbox`, `queryFocus`, `getProject`, `search` return the same results as the current app for the same data.
4. **Writes.** `addTask`, `updateTask`, `completeTask`, `deleteTask` go through the existing store actions. Verify the SQLite rows, not the returned JS state.
5. **Reactivity.** A write produces a change notice, and the rerun query shows the new state in Inbox, Focus and counts.
6. **Sync both ways.** A native write reaches the desktop through the shared sync, and a desktop edit arrives, raises a change notice and appears in the rerun query.
7. **Cost.** Warm query latency, native-to-JS call and serialization cost, add and complete latency, responsiveness of queries during a sync, and engine memory.

Success means a user cannot feel the boundary: call overhead in the low milliseconds, not hundreds. Budgets are written into the Gate 1 plan before any code.

Outcomes: works well → keep the TypeScript core and start Gate 2. Works with one bottleneck → fix the boundary, the engine or a port, and measure again. Does not work → write down the concrete limit, and only then reopen the Rust option under the conditions of ADR 0028.

### Gate 1 result (2026-09-21): feasibility shown, performance conditional

Run on a OnePlus CPH2655 (Android 16), release build, 5,000 generated tasks, 20 warm-ups and 200 samples per measure, 50 cold launches. Engine: QuickJS through `wang.harlon.quickjs:wrapper-android` 3.2.0, with AndroidX bundled SQLite (this phone's system SQLite has no FTS5). The core was not changed. 419 lines of Kotlin supply the ports; the Kotlin side knows no table or column name. The experiment lives on the local branch `experiment/gate1-embedded-core` under `experiments/embedded-core/` (report, raw samples, reproduction steps).

| Measure (p95, ms) | Result | Target | Red flag |
| --- | ---: | ---: | ---: |
| Empty native → JS → native call | 0.05 | 3 | 10 |
| Warm Inbox query, decoded in Kotlin | 7.15 | 30 | 100 |
| Complete task → change notice | 20.40 | 30 | 100 |
| Complete task → updated Inbox decoded | 29.57 | 100 | 250 |
| Write → confirmed local persistence | 20.35 | 200 | 500 |
| Activity start → first usable Inbox (no screen drawn) ¹ | 497.41 | 700 | 1,500 |
| Incremental memory (total PSS) ² | 59.17 MiB | 60 MiB | 120 MiB |
| **Warm Focus query, decoded in Kotlin** | **484.99** | 50 | 150 |
| **Query sent at the start of an unchanged sync** ³ | **~890 (median of 17)** | 100 | 300 |
| **Query sent at the start of a merge with 250 changes** ³ | **~920 (median of 16)** | 100 | 300 |

An independent review on 2026-09-21 checked the source, the harness and the raw samples. Every percentile matched its raw samples; the corrections below are about what was measured and how it was described.

¹ The clock starts in `onCreate`, so the process launch before it is not included, and about 33 ms per launch (reading the 5 MB bundle out of the APK) is not attributed to any phase. The 50 launches also ran against 4,398 database rows with a 245-row Inbox, not the 5,000 rows and 465-row Inbox of the other measures.
² One reading of each process, without forcing garbage collection, after five merge rounds. It clears the target by 0.83 MiB, which is inside the noise of one unrepeated reading: "roughly at budget", not a pass. Growth across cycles was checked only for the JavaScript engine's own heap (flat, 8.9 KB per round); the native heap, which grew from 4.6 MB to 52.9 MB, was read once.
³ These rows come from 17 and 16 probe queries. With so few samples the harness's p95 is the maximum, so the highest values seen (1,107.70 ms and 1,792.07 ms) are single observations, and the larger one sat behind the slowest of fifteen merge rounds (1,704.78 ms, against a 1,074.41 ms average round). The probe also re-submits the moment it is served, so it almost always waits for a whole merge, not the rest of one. Read them as "a query submitted at the start of a merge waits about 890 ms". The red flag fires either way: half of that is still past 300 ms. The measured merge is, if anything, lighter than a real sync.

Correctness held where it was checked, and the checks were narrower than they look. Inbox, Focus and search matched the workstation id for id and position for position: ids and positions only, never field values, and with the same non-ICU collator stand-in on both sides, so the check cannot detect an ordering difference from the shipping app. The workstation reference file was not committed. The "Inbox" query is a one-line status filter, not the app's Inbox screen, so its time is a floor. A write survived a process kill right after its persistence acknowledgment. An injected storage failure never reported success. A push and a pull went through the ADR 0014 seams with nothing copied from `apps/mobile`. **The test of a local edit arriving during a merge did not run: the harness makes the edit after the last merge has finished, so that path is untested**, and the merge saves a snapshot captured before it started. A failed or partial read was never tested either; the core's empty-snapshot guard only fires on an all-empty snapshot. Nothing in the experiment asserts that the dataset is intact, although no committed result comes from a run that lost it. The SQLite `synchronous` setting behind "persisted" was not recorded. No STOP condition fired.

The two red flags share a property, not a cause: each is a long stretch of JavaScript that runs to completion on the one engine thread. Beyond that they are different problems, and neither is the native-to-JavaScript boundary. (1) Focus is the cost of the derivation itself and would not improve with a second thread. The boundary is a small part of the time. The three stages were timed as three separate 200-sample runs, so their differences (444 / 19 / 13 ms) are not a paired split, and the derivation-only run is three times noisier than the others. What the data supports: the great majority of the 476 ms is core work inside the engine. It does not show that QuickJS alone is responsible; the algorithm, allocations and runtime services may share the cost. The collator stand-in is also cheaper than real ICU, so a host with real `Intl` would be slower here, not faster. (2) The merge wait is contention. The query runs in about 5 ms and would stay near that if the merge ran elsewhere. A faster engine shortens the block; it does not remove the waiting. The same bundle ran 20 to 35 times faster on the workstation under a just-in-time compiling engine, but that comparison changes the hardware and the engine at once, so it predicts nothing about a phone. These are measurements with a simplified collation (see below), and the correctness coverage is incomplete.

Findings that stand on their own:

- 95% of the 5.10 MB bundle is the 23 non-English locale files (an English-only bundle is 0.43 MB). A native host should deliver languages as files it reads, not inside the bundle. Evaluating the full bundle costs about 109 ms; loading the store from SQLite is two thirds of the cold launch.
- `packages/core/src/task-utils.ts` builds three `Intl.Collator` objects at module scope, so an engine without `Intl` cannot even load the core. The experiment used a code-point polyfill; sorting of non-English titles can then differ from the current app, and the ASCII dataset did not test it.
- The core's guard against overwriting data with an empty snapshot fixes the start order for any host: open the database, make sure the data is there, and only then attach storage and load the store.
- Reading SQLite column names before the first step silently lost every row in an early run. Host ports need their own tests.

Not measured: a failed or partial database read, a query arriving in the middle of a merge and not at its start, the first write after launch (320.83 ms, against a 20.35 ms warm p95), a second engine, the current React Native app's Focus and merge times on the same phone and data, the full sync cycle (retries, fingerprints, attachments, encryption), non-English sort parity (which the parity check cannot reach, because phone and workstation share the stand-in), and anything about screens.

To be re-measured before any comparison with the React Native app: the during-sync rows (100 or more probes, random arrival, per-round merge times), cold launch from process start, the Focus split with one clock per iteration, memory (three readings each, forced garbage collection), and the local-edit-during-merge test. To be added: a boot assertion that fails when the database has rows and the store has none, value-level parity with a committed reference, the SQLite pragma record on both sides, and SHA-256 hashes of the bundle and the APK, which are not reproducible from the tag today.

Next, in this order (approved by the maintainer on 2026-09-21): an independent review of the experiment's source, harness, raw samples and fixture; and a baseline of the current React Native app on the same phone, fixture and core revision, reporting the same core operations (inside its packaged Hermes, which runs precompiled bytecode and is not the same thing as a just-in-time compiler) separately from the real screen experience. A slow baseline would not excuse a slow native host; the targets stay. Only after that: a second engine behind the experiment's `Engine` interface, and, if blocking is still unacceptable, a merge computed by a second engine instance from snapshots while one owner keeps the store and persistence. That last step is a concurrency change with its own data-transfer, reconciliation and memory costs. If Focus stays expensive across engines, profile the derivation itself: one fix in the shared core helps every client. The Rust option stays out of scope. The core's computations and scheduling may need work; that is not a reason to replace its language.

### Gate 1 correction pass (2026-09-22)

The one correction pass answered the review. Originals are kept under the tag `gate1-result-20260921`; corrected data is under `results-corrected/`, tagged `gate1-corrected-20260922`. The coordinator recomputed the during-merge waits, the Focus split, memory and the edit timing from the raw corrected files; they match the worker's figures within rounding. The cold-launch figure is the worker's.

| Figure | Original | After correction |
| --- | ---: | --- |
| Boundary round trip, warm Inbox, Focus total, complete → notice / → list, warm write, process-kill and failed-write tests, push and pull, STOP conditions | as above | stand |
| Focus split | 444 / 19 / 13 ms from three runs | one clock per iteration: boundary (JSON + Kotlin decode) 23.94 ms p50, 65.72 ms p95, about 5% of the total at the median |
| First write after launch | not reported | 322.08 ms, against a 22.14 ms warm p95 |
| Cold launch → first usable Inbox | 497.41 ms p95 from `onCreate`, 4,398 rows | 559.65 ms p95 from process start, full 5,000-row fixture, the 25.96 ms bundle read now attributed |
| Query during an unchanged sync | "p95" 1,107.70 (n=17) | n=98 at random arrival: p50 601.88, p95 1,311.70 |
| Query during a merge with 250 changes | "p95" 1,792.07 (n=16) | n=98 at random arrival: p50 677.59, p95 1,421.63 |
| Incremental memory | 59.17 MiB, one reading | 52.73 MiB, three readings per state after forced garbage collection |
| Parity | ids and positions | 24,180 field values, 0 differences, reference file committed |

New correctness results:

- **Edit during a merge.** With one engine thread an edit cannot land inside a merge; it queues. An edit submitted 1,200 ms in (inside merge round 1) waited 677 ms, was applied the instant the round ended, and survived ten further rounds with one row in the database. When the experiment forced a gap between the merge's read of the store and its save, an edit made in that gap was written to the database and then deleted by the merge's save of the older snapshot: still visible in memory, gone after the next load, and neither of the core's guards fired. Nothing in the host as written can reach that gap, because nothing yields there. This is the experiment's simplified merge path, not the apps' sync cycle, which has its own local-change guard; it shows concretely why any change that lets edits and merge computation interleave must be its own reviewed patch with this test in it.
- **Failed and partial reads.** A read that throws fails boot loudly and writes nothing. An empty database boots clean. A partial read (projects returning no rows) boots without any error into a silently wrong store with 0 projects; a following write succeeds; the 125 project rows survive only because the core deletes only rows the adapter has seen. The experiment now has a boot guard that throws when rows exist and the store loads none.
- **Collation.** Phone and workstation agree exactly with the stand-in, so the engine and the storage port add no difference. The stand-in differs from real ICU in all three orderings tested: capitals sort first, accented letters sort after `z`, NFC and NFD forms of the same word swap places, and four pairs that ICU treats as equal under `sensitivity: 'base'` are not equal. Numeric ordering agrees. All performance numbers here were measured with this simplified collation; real ICU would be slower. An engine without `Intl` is not acceptable for production as it stands.

### Baseline of the current React Native app (2026-09-21, corrected after independent review)

Same phone, same frozen 5,000-task dataset (generator copied verbatim from Gate 1; every seeding produced 2,350,532 bytes with hash `6b34f324`), same reference time and the same core revision, in an isolated build (`tech.dongdongbh.mindwtr.rnbaseline`) that the review confirmed is release, non-debuggable, `__DEV__` false, Hermes "for RN 0.81.5" running precompiled bytecode (version 96), debugger off. The work lives on the local branch `experiment/rn-baseline` under `experiments/rn-baseline/`.

An independent review found that the worker's report was written from an earlier run than the raw files it committed, so several figures in the first version of this section were wrong. The numbers below are rebuilt from the committed raw data. The Focus rows were right from the start.

Same core calls inside each engine (ms):

| Measure | Hermes | QuickJS (Gate 1) |
| --- | ---: | ---: |
| Focus, core derivation only, p50 / p95 | 202.83 / 209.46 | 443.67 / 452.89 |
| Focus, plus the JSON text, p50 | 213.49 | 462.72 (also copies the text into Kotlin, at most 19 ms of it) |
| Inbox status filter, plus the JSON text, p50 | 3.77 | 6.72 (also decodes in Kotlin) |
| One merge round, unchanged sync | 746.81 merge + 16.14 save (p50 of 15) | 888.01 average round |
| One merge round, 250 changed tasks | 761.85 merge + 58.77 save (p50 of 15) | 1,074.41 average round |

Gate 1's 869.19 and 1,704.78 ms were single rounds, not medians, so the merge rows compare a median with an average: the current app's merge round is about 86 percent of Gate 1's for an unchanged sync and about 76 percent with 250 tasks changed. With 15 rounds a "p95" is the maximum, so none is given.

JavaScript thread contention, probed from a native thread on a random 3 to 25 ms gap (not the one-at-a-time probe Gate 1 used, so the two are not the same measurement): of 911 probes during an unchanged sync, 742 waited more than 100 ms and 39 less than 1 ms. A probe arriving at a random moment waited 371.0 ms at the median and 908.2 ms at p95 (unchanged), 348.7 and 729.7 ms with 250 changed; the worst was 1,514.6 ms. Arrivals were even across the merge and all 15 rounds were sampled. The earlier sentences "each merge blocks the thread exactly once" and "two separate clocks agree" do not rebuild from the data and are withdrawn.

The real screen (not comparable with Gate 1, which drew nothing): launch to first frame 286 ms p50 and launch to the app's own `js.interactive_ready` mark 1,044 ms p50 over 10 cold launches (1,039 to 1,058 ms), re-measured after the review on a fixture restored from scratch; the reviewed batch gave 299 and 1,060 ms. That mark means "data loaded and the Focus screen laid out and painted once", not "answers a touch", and the build carried the startup profiler and the experiment's own imports. During a 250-change merge the frame counters show 702 frames, 4 janky, no missed vsync (a later re-run: 642 frames, 9 janky, none missed, 345 flagged). 465 of those 702 frames were flagged "high input latency"; that counter reports input events more than 30 ms old when the interface thread began handling them, with injected swipes and no control run, so it is a diagnostic signal and says nothing yet about how long a tap waits for an answer. A merge cost about 70 percent more with the Focus screen in front than with only the measurement screen in front; the rise began before the first swipe and lasted 25 s after the last, so scrolling is not the cause, and the cause is not established. Whether a warm return to Focus re-derives cannot be read from frame counters; that claim is withdrawn.

What this establishes: on this phone, with these 5,000 tasks, the Focus derivation as written takes 202.83 ms at p50 on Hermes, about four times the 50 ms target, and a sync merge keeps the one JavaScript thread busy for about three quarters of a second. Both Gate 1 red flags therefore describe costs the shipping app already has: QuickJS roughly doubled the Focus cost; how the two engines compare on the merge is not established (see "Device state" below). Two engines have now run the same work and neither is close to the targets, which says the cost sits mostly in the computation and not in an engine or a boundary. It does not measure any other engine, language or implementation, and it puts no floor under a rewritten derivation. So the first fix belongs in the shared core, where it helps the current app and any future client.

After the review the worker rewrote its report from the corrected raw data and re-measured with random probe arrival, which is where the figures above come from (commits `ab4e98529`, `166762a33`; the reviewed state is tagged `rn-baseline-reviewed-20260921`). Its re-run of the scrolling test produced probe waits longer than the longest merge round, which means the probes queued behind each other; those waits are not reported. Known gaps, from the review: the edit-during-merge check in the reviewed run did not overlap a merge (its own script reports the edit "submitted between rounds"); the re-run keeps an edit outstanding across a merge and it survives a reload, but the edit is queued just before the synchronous block, not injected into it; the integrity check after the merge batch reported 4,400 tasks and an Inbox of 467, not the fixture's 4,398 and 465, although the first report said it passed; the APK left in the worktree matches neither build in the identity table, so the committed merge data came from a third, undocumented build; a Focus-screen log marker never reached logcat, most likely from a mismatch between the source read and the APK built. Not done: network sync, non-English sorting, a direct tap-to-answer measurement during a merge (proposed: a log line in the Focus row press handler plus timed `adb shell input tap`, ten taps during a merge and ten idle). Review: `.orchestrator/tasks/baseline-review-20260921-01/review.md` (local).

### Device state decides the absolute numbers (2026-09-22)

Two later runs on the same phone changed how every absolute figure above must be read.

1. **A clean rerun of Gate 1's during-merge measurement.** The correction-pass run had been disturbed: the other experiment's app re-seeded on the phone in the middle of it (a coordination error, not the worker's). The rerun, alone on the phone, was slower, not faster: merge round p50 1,670 ms (unchanged sync) and 1,686 ms (250 changed), query wait p50 758 / p95 1,587 ms and 901 / 1,631 ms (n=98 and 100). The per-round times explain why. Inside one run the same merge costs about 585 ms for the first six rounds, then steps to about 865 ms, and ends near 1,670 ms; the disturbed run shows the same staircase (572 → 860 → 1,410 ms). CPU sensors read 80 to 86 °C afterwards. The original Gate 1 figure (869 ms, 15 rounds) sits on the second step. So a merge round in QuickJS costs anywhere from 585 to 1,690 ms on this phone depending on how long the phone has been working, and the 15-round Hermes figure (747 ms) was taken at an unknown point on its own staircase. **The comparison of merge cost between the two engines is therefore not established**, in either direction; the sentence above that QuickJS "lengthened the merge by about a sixth to a third" is withdrawn. What stands: in both engines one merge is a single uninterrupted block of several hundred milliseconds to well over a second on a 5,000-task store, and a query arriving during it waits for the rest of it.
2. **The Focus samples show the same two states.** In the unpatched run the first 30 samples cost 116 ms and the rest 207 ms. The baseline worker saw the same step (first 40 samples 114.5 ms, then about 200 ms), and Gate 1's QuickJS samples have it too (fastest 222 ms, median 444 ms). The Hermes to QuickJS ratio holds in both states (1.95 to 2.19 times). So "203 ms" and "444 ms" are sustained-load figures; in the first seconds after launch, which is when a person opens Focus, both engines are nearly twice as fast. Comparisons are sound only between runs in the same state, best taken back to back with a control measure.

### Focus patch measured on the phone (2026-09-22)

The patch from `perf/focus-derivation` (dates parsed once per task and not inside sort comparators, today's bounds computed once per derivation, and no filter pass when there are no criteria; parity with the old code proven over 192 cases) was measured in the baseline app: unpatched build, then the same app rebuilt with the three patched core files, 200 samples each, dataset integrity exact before and after both batches.

| Measure, p50 / p95 (ms) | Unpatched | Patched |
| --- | ---: | ---: |
| Focus, core derivation only, sustained state | 207.05 / 213.00 | 113.99 / 115.87 |
| Focus, plus the JSON text, sustained state | 217.35 | 119.20 |
| Inbox status filter (control) | 2.58 | 2.57 |

The unchanged control shows both runs were in the same sustained state, so the patch cuts the derivation by about 45 percent there (the workstation showed 57 percent on two engines). The patched run never showed the fast first phase, so its fast-state cost was not observed; the unpatched fast-state cost is 116 ms. The 50 ms target is still missed in the sustained state by a factor of about 2.3. Going further needs a cache that lives across derivations, a signature change that threads parsed dates through the pool builders, or a semantic change; each is a product decision.

### Gate 2: the product question

With Gate 1 passed, build Inbox, the task editor and Focus in Compose on the same core, the same database and the same phone as the React Native app. Exercise the failure families from ADR 0028's evidence: large lists, keyboard and insets, sheets, navigation and deep links. Compare startup to a usable Inbox, list frame behavior, open, complete and save latency, memory, responsiveness during sync, code size, and the amount of workaround code. Record how it feels as well as the numbers.

## Non-goals

This ADR does not decide to migrate. It does not choose the Android engine, does not cover iOS work (no Apple hardware is available yet), and does not change the React Native app, which stays the production client. The public discussion of a native direction waits for Gate 2 numbers.

## Consequences

If Gate 1 passes, the project gets native presentation with one authoritative core, shared translations, and no second merge engine, and the same boundary can be reproduced in Swift later. The costs are a JS engine inside the native app, a set of native ports to write and keep correct, a query and notification API to design and version, and a boundary that every screen interaction crosses. Making the core boot in a plain engine with a known host API list is useful even if the native client is never built. If Gate 1 fails, the project holds concrete numbers for the larger Rust decision instead of an expectation.
