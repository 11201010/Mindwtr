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

### Baseline of the current React Native app (2026-09-21)

Same phone, same frozen 5,000-task dataset (hash identical on both sides), same reference time and the same core revision, in an isolated non-debuggable build (`tech.dongdongbh.mindwtr.rnbaseline`, Hermes "for RN 0.81.5", bytecode version 96, debugger off). Dataset integrity was asserted before and after every batch. The work lives on the local branch `experiment/rn-baseline` under `experiments/rn-baseline/`. It has not been independently reviewed.

Layer A, the same core calls inside each engine (ms):

| Measure | Hermes p50 / p95 | QuickJS p50 / p95 (Gate 1) |
| --- | ---: | ---: |
| Focus, core derivation only (section sizes returned) | 202.83 / 209.46 | 443.67 / 452.89 |
| Focus, plus the JSON text | 213.49 / 219.84 | 462.72 / 471.24 |
| Inbox, plus the JSON text (Gate 1's figure also decodes in Kotlin) | 3.77 / 4.13 | 6.72 / 7.15 |
| Core merge step, unchanged sync, p50 of 15 rounds | 726.42 | 869.19 |
| Core merge step, 250 changed tasks, p50 of 15 rounds | 738.51 | 1,074 average round (Gate 1 reported one round, 1,704.78) |

JavaScript thread blocking, probed from a native thread: each merge blocks the thread once, for about 725 ms (unchanged) and 740 ms (250 changed); every other probe got through in under 1 ms. The sum of the long waits gives 737 and 741 ms per round, which matches the core merge step from a separate clock.

Layer B, the real screen (not comparable with Gate 1, which drew nothing): launch to first frame 288 ms p50; launch to an interactive Focus 1,027 ms p50 (on a build with the startup profiler on); a warm return to Focus costs one frame, about 25 ms, because the screen is cached and does not re-derive. Scrolling during a 250-change merge: 702 frames, 4 janky, no missed vsync, but 465 frames flagged high input latency, and the merge itself took 60 to 80 percent longer while someone scrolled (1,175 and 1,325 ms), because the list and the merge share one thread.

What this establishes: both Gate 1 red flags describe costs the shipping app already has. About half of Gate 1's Focus derivation cost and about 80 percent of its merge stall exist today on Hermes, with no native boundary. Measured against the same targets, the current app is also past the red flag on both (203 ms against 150 ms; about 725 ms against 300 ms). QuickJS roughly doubled the Focus cost and added about a fifth to the merge; it did not create either problem. A better engine alone does not reach the 50 ms Focus target: the derivation itself is about four times over it on Hermes. So the first fix belongs in the shared core, where it helps the current app and any future client: profile and cut the Focus derivation, and stop the merge from holding the thread in one block.

Not done: network sync, non-English sorting (ASCII data, the same limit as Gate 1), and the existing macrobenchmark runner (its build accepts only the lab app id). A Focus-screen log marker never reached logcat and the cause was not found; Layer B used the app's own interactive-ready marker instead.

### Gate 2: the product question

With Gate 1 passed, build Inbox, the task editor and Focus in Compose on the same core, the same database and the same phone as the React Native app. Exercise the failure families from ADR 0028's evidence: large lists, keyboard and insets, sheets, navigation and deep links. Compare startup to a usable Inbox, list frame behavior, open, complete and save latency, memory, responsiveness during sync, code size, and the amount of workaround code. Record how it feels as well as the numbers.

## Non-goals

This ADR does not decide to migrate. It does not choose the Android engine, does not cover iOS work (no Apple hardware is available yet), and does not change the React Native app, which stays the production client. The public discussion of a native direction waits for Gate 2 numbers.

## Consequences

If Gate 1 passes, the project gets native presentation with one authoritative core, shared translations, and no second merge engine, and the same boundary can be reproduced in Swift later. The costs are a JS engine inside the native app, a set of native ports to write and keep correct, a query and notification API to design and version, and a boundary that every screen interaction crosses. Making the core boot in a plain engine with a known host API list is useful even if the native client is never built. If Gate 1 fails, the project holds concrete numbers for the larger Rust decision instead of an expectation.
