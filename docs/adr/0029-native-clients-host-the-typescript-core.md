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

### Gate 2: the product question

With Gate 1 passed, build Inbox, the task editor and Focus in Compose on the same core, the same database and the same phone as the React Native app. Exercise the failure families from ADR 0028's evidence: large lists, keyboard and insets, sheets, navigation and deep links. Compare startup to a usable Inbox, list frame behavior, open, complete and save latency, memory, responsiveness during sync, code size, and the amount of workaround code. Record how it feels as well as the numbers.

## Non-goals

This ADR does not decide to migrate. It does not choose the Android engine, does not cover iOS work (no Apple hardware is available yet), and does not change the React Native app, which stays the production client. The public discussion of a native direction waits for Gate 2 numbers.

## Consequences

If Gate 1 passes, the project gets native presentation with one authoritative core, shared translations, and no second merge engine, and the same boundary can be reproduced in Swift later. The costs are a JS engine inside the native app, a set of native ports to write and keep correct, a query and notification API to design and version, and a boundary that every screen interaction crosses. Making the core boot in a plain engine with a known host API list is useful even if the native client is never built. If Gate 1 fails, the project holds concrete numbers for the larger Rust decision instead of an expectation.
