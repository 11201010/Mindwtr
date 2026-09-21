# Plan 128: Gate 1 — run the TypeScript core inside a native Android host, without React Native

> **Executor instructions**: This is an experiment with a pass/fail report, not a product change. Work in a git worktree under `/home/dd/worktrees/Mindwtr/gate1-embedded-core` (never in `/tmp`; keep `node_modules`, Gradle output and build caches on disk under `/home/dd`). Do NOT change `apps/mobile`, do NOT change behavior in `packages/core` beyond what step 1 allows, do NOT touch any user's database: use a generated dataset in the experiment app's own data directory. Run every measurement on the physical phone, not an emulator. If a STOP condition occurs, stop and report; do not improvise. Subagents must run on Opus, never Fable.

## Status

- **Priority**: P2 (decision input, no user impact)
- **Effort**: L
- **Risk**: LOW for users (nothing ships); HIGH for wasted effort if the budgets below are not fixed before coding
- **Depends on**: ADR 0029 (Proposed), ADR 0028
- **Category**: architecture experiment
- **Planned at**: commit `d66fc830b`, 2026-09-21

## Why this matters

A native screen cannot work without reading the core: Focus sections, visibility rules, sorting, quick-add parsing, recurrence and translations all live in `@mindwtr/core`. ADR 0029 proposes keeping that core and embedding a JavaScript engine in the native app. Gate 1 answers one question with numbers: **can a native Android process host the core as a long-lived engine, with call overhead a user cannot feel?** If yes, native screens become mostly mechanical work. If no, we learn the concrete limit before spending effort on Rust or on screens.

## Current state (measured 2026-09-21)

- Core runtime dependencies are pure JS: `date-fns`, `date-fns-jalali`, `chrono-node`, `fflate`, `uqr`, `@noble/hashes`, `zustand`. No React Native or Expo import in `packages/core/src`.
- `packages/core/src/store.ts` builds the store with `zustand/traditional`, which imports `react`; two other files import `react`. `react` is a peer dependency.
- Host features the core uses (non-test files): `URL` 12, `setTimeout` 10, `TextEncoder`/`TextDecoder` 9, `Intl` 7, `AbortController` 5, `performance.now` 4, `structuredClone` 3, `crypto.subtle` 2, `crypto.getRandomValues` 2, `localStorage` mentioned in 14. No `fetch`.
- First feasibility check (2026-09-21): `bun build packages/core/src/index.ts --target=browser --format=esm --minify` succeeds with no unresolved import: 1,599 modules, **5.17 MB minified**. That size is a boot risk: bundle evaluation time is measured separately in step 9, and the report names what dominates the bundle (likely date libraries with their locales, `chrono-node`, and the 23 translation files) and whether lazy loading or engine bytecode (Hermes) removes the cost.
- Storage goes through `StorageAdapter` (`setStorageAdapter` in `packages/core/src/store.ts`; default is `noopStorage`). The mobile adapter is `apps/mobile/lib/storage-adapter.ts` (op-sqlite). Sync IO goes through the ports of ADR 0014.
- ⚠️ A runtime that never calls `setStorageAdapter` "saves" to nothing. The experiment must connect storage before its first write and must verify rows in SQLite.
- ⚠️ Never construct `TextEncoder`/`TextDecoder` at module scope in core; a past Android startup crash came from that.
- Performance budgets and 5,000-task generators already exist: `docs/performance/budgets.md`, `packages/core/src/performance-large-store.test.ts`, `apps/mobile/tests/large-store-performance.test.tsx`.
- Phone: OnePlus CPH2655, Android 16, adb serial `44882663`.

## Budgets (proposed; the maintainer confirms or changes them BEFORE step 2)

| Measure (5,000 tasks, release build, physical phone) | Pass | Fail |
| --- | ---: | ---: |
| Empty native→JS→native call, p50 / p95 | ≤ 1 ms / ≤ 3 ms | > 10 ms p95 |
| `queryInbox` warm, including serialization, p95 | ≤ 30 ms | > 100 ms |
| `queryFocus` warm, including serialization, p95 | ≤ 50 ms | > 150 ms |
| `completeTask` → change notice, p95 (durable write may finish later) | ≤ 30 ms | > 100 ms |
| Cold process start → first `queryInbox` result | ≤ 700 ms | > 1500 ms |
| Any query while a sync merge runs, p95 | ≤ 100 ms | > 300 ms |
| Engine + core resident memory after load | ≤ 60 MB | > 120 MB |

Between Pass and Fail is "works with a bottleneck": name it, fix the boundary, engine or port, measure again.

## Steps

1. **Bundle the core for a plain engine.** In the worktree add `experiments/embedded-core/bundle/` with an entry file that imports `@mindwtr/core` and exposes one global object `MindwtrHost` (see step 3). Build one ES2020 bundle with `bun build` (no Node or browser built-ins). Boot it first in a bare engine on the workstation (QuickJS CLI if installable under `/home/dd`, otherwise `bun` with every non-ECMAScript global deleted before import). Record every missing host API. Allowed core change: none, unless an import makes booting impossible; then STOP and report the exact import.
   - Verify: the bundle evaluates and `MindwtrHost.ping()` returns. Output: `host-api-list.md` (each host API, who provides it: engine, polyfill in bundle, or native port).
2. **Android host app.** `experiments/embedded-core/android/`: a Kotlin app with its own application id (`tech.dongdongbh.mindwtr.gate1`), no React Native, no Expo. Embed one engine first, chosen by how fast it can be integrated (QuickJS through a maintained Android binding, or Hermes standalone). Keep the engine behind a small Kotlin interface (`evaluate`, `call`, `registerHostFunction`) so a second engine can be swapped in for comparison.
3. **Host API (keep it this small).** JSON in, JSON out, all calls on one dedicated engine thread:
   - `boot(config)`, `ping()`
   - `queryInbox(opts)`, `queryFocus(nowIso)`, `getTask(id)`, `getProject(id)`, `search(text)` → plain data objects. Reuse core functions: `buildFocusTaskSections` is already in `packages/core/src/focus-sections.ts` (the mobile file only re-exports it and adds `deriveFocusTaskLists`; if Focus parity needs that second function, report it as a finding rather than moving it).
   - `addTask(title, props)`, `updateTask(id, patch)`, `completeTask(id)`, `deleteTask(id)` → existing store actions, then `flushPendingSave`.
   - `onChange(callback)` → `{ revision, domains: ['tasks' | 'projects' | 'focus' | 'settings'] }`, driven by a store subscription.
4. **Native ports.** Implement `StorageAdapter` in Kotlin over Android's SQLite with the same schema the mobile adapter creates (read `apps/mobile/lib/storage-adapter.ts` and `packages/core/src/sqlite-adapter.ts`; reuse the core SQL, do not invent a schema). Provide timers, `crypto.getRandomValues`, `TextEncoder`/`TextDecoder`, `URL`, `performance.now` as host functions or bundle polyfills per `host-api-list.md`.
5. **Dataset.** Generate 5,000 mixed tasks with the same generator the perf tests use, write them through the core into the experiment app's database, and keep the generator seed in the report.
6. **Parity.** For the same database file, compare `queryInbox` and `queryFocus` output (ids and order) with the same functions run under `bun` on the workstation. Any difference is a FAIL of reads, not a note.
7. **Writes and reactivity.** Add, update, complete and delete from Kotlin; assert the rows with `sqlite3` on a pulled copy of the database; assert one change notice per write and that the rerun query reflects it.
8. **Sync both ways.** Point the experiment app at a throwaway WebDAV folder or a local self-hosted test server (never the maintainer's live folder `dav/Mindwtr`). Native write → visible in a desktop dev profile; desktop edit → change notice → rerun query shows it. If the sync ports need more than the ADR 0014 seams, STOP and report what is missing instead of copying `apps/mobile/lib/sync-service.ts`.
9. **Measure.** Release build. 200 samples per measure after 20 warm-ups; report p50, p95, max, and the raw samples. Measure memory with `dumpsys meminfo`. Run the "during sync" measure while a merge of two 5,000-task snapshots is in flight.
10. **Report.** `experiments/embedded-core/REPORT.md`: the budget table filled in, `host-api-list.md`, bundle size, engine used and its version, lines of Kotlin written for ports, every surprise, and one of the three outcomes from ADR 0029. No recommendation about migrating; evidence only. Writing style: short sentences, common words, every technical term defined once.

## STOP conditions

- The core cannot be bundled without editing core behavior.
- The only way to make a query work is to write or read Mindwtr tables from Kotlin outside the `StorageAdapter`.
- Any step would touch a real user profile, the live sync folder, or `apps/mobile`.
- The engine needs a native build that does not fit the FOSS build rules (note it and continue with the other engine; stop only if both fail).

## Out of scope

Compose screens (Gate 2), iOS, Rust, widgets, notifications, attachments, encryption, the public discussion.
