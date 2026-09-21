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
| Cold launch → first usable Inbox (no screen drawn) | 497.41 | 700 | 1,500 |
| Incremental memory (total PSS) | 59.17 MiB | 60 MiB | 120 MiB |
| **Warm Focus query, decoded in Kotlin** | **484.99** | 50 | 150 |
| **Query sent during an unchanged sync** | **1,107.70** | 100 | 300 |
| **Query sent during a merge with 250 changes** | **1,792.07** | 100 | 300 |

Correctness held everywhere it was checked: Inbox, Focus and search matched the workstation id for id and position for position; a write survived a process kill right after its persistence acknowledgment; an injected storage failure never reported success; a local edit made during a merge survived; a push and a pull went through the ADR 0014 seams with nothing copied from `apps/mobile`. No STOP condition fired.

The two red flags are related but not the same, and neither is the boundary. (1) Focus: the boundary is 7% of the time (444 ms core derivation, 19 ms JSON, 13 ms Kotlin decode), so shrinking the boundary cannot fix it. This does not show that QuickJS alone is responsible; the algorithm, allocations and runtime services may share the cost. (2) Contention: during a merge the query runs in 5 ms and waits about 890 ms, because the merge is one unbroken block of JavaScript on the single engine thread. A faster engine shortens the block; it does not remove the waiting. The same bundle ran 20 to 35 times faster on the workstation under a just-in-time compiling engine, but that comparison changes the hardware and the engine at once, so it predicts nothing about a phone. These results are unreviewed measurements with a simplified collation (see below), and the correctness coverage is incomplete.

Findings that stand on their own:

- 95% of the 5.10 MB bundle is the 23 non-English locale files (an English-only bundle is 0.43 MB). A native host should deliver languages as files it reads, not inside the bundle. Evaluating the full bundle costs about 109 ms; loading the store from SQLite is two thirds of the cold launch.
- `packages/core/src/task-utils.ts` builds three `Intl.Collator` objects at module scope, so an engine without `Intl` cannot even load the core. The experiment used a code-point polyfill; sorting of non-English titles can then differ from the current app, and the ASCII dataset did not test it.
- The core's guard against overwriting data with an empty snapshot fixes the start order for any host: open the database, make sure the data is there, and only then attach storage and load the store.
- Reading SQLite column names before the first step silently lost every row in an early run. Host ports need their own tests.

Not measured: a second engine, the current React Native app's Focus and merge times on the same phone and data, the full sync cycle (retries, fingerprints, attachments, encryption), non-English sort parity, and anything about screens.

Next, in this order (approved by the maintainer on 2026-09-21): an independent review of the experiment's source, harness, raw samples and fixture; and a baseline of the current React Native app on the same phone, fixture and core revision, reporting the same core operations (inside its packaged Hermes, which runs precompiled bytecode and is not the same thing as a just-in-time compiler) separately from the real screen experience. A slow baseline would not excuse a slow native host; the targets stay. Only after that: a second engine behind the experiment's `Engine` interface, and, if blocking is still unacceptable, a merge computed by a second engine instance from snapshots while one owner keeps the store and persistence. That last step is a concurrency change with its own data-transfer, reconciliation and memory costs. If Focus stays expensive across engines, profile the derivation itself: one fix in the shared core helps every client. The Rust option stays out of scope. The core's computations and scheduling may need work; that is not a reason to replace its language.

### Gate 2: the product question

With Gate 1 passed, build Inbox, the task editor and Focus in Compose on the same core, the same database and the same phone as the React Native app. Exercise the failure families from ADR 0028's evidence: large lists, keyboard and insets, sheets, navigation and deep links. Compare startup to a usable Inbox, list frame behavior, open, complete and save latency, memory, responsiveness during sync, code size, and the amount of workaround code. Record how it feels as well as the numbers.

## Non-goals

This ADR does not decide to migrate. It does not choose the Android engine, does not cover iOS work (no Apple hardware is available yet), and does not change the React Native app, which stays the production client. The public discussion of a native direction waits for Gate 2 numbers.

## Consequences

If Gate 1 passes, the project gets native presentation with one authoritative core, shared translations, and no second merge engine, and the same boundary can be reproduced in Swift later. The costs are a JS engine inside the native app, a set of native ports to write and keep correct, a query and notification API to design and version, and a boundary that every screen interaction crosses. Making the core boot in a plain engine with a known host API list is useful even if the native client is never built. If Gate 1 fails, the project holds concrete numbers for the larger Rust decision instead of an expectation.
