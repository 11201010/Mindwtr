# Plan 127: Give the desktop and mobile test suites a 30-second harness timeout

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report; do not improvise. Do NOT edit `plans/README.md`; the coordinator maintains the index.
>
> **Drift check (run first)**: `rtk git diff --stat 561cfdfa0..HEAD -- apps/desktop/vitest.config.ts apps/mobile/vitest.config.ts scripts/ci/validate-coverage-config.test.ts` — if any of these changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `561cfdfa0`, 2026-09-19

## Why this matters

A harness timeout is the time the test runner waits before it calls a test "hung" and fails it. No Mindwtr package sets one, so every test gets Vitest's default of 5 seconds. Some desktop tests mount a whole screen in a simulated browser and need 3 to 5 seconds on a quiet machine. When other work runs on the same machine they cross 5 seconds and `bun run verify` goes red for no real reason. That costs a rerun each time and teaches people to ignore red. After this plan the desktop and mobile suites wait 30 seconds, so a busy machine no longer fails them, while a truly hung test still fails.

This is a test-harness timeout. It is NOT a performance budget. Performance budgets are explicit `expect(duration)` checks in the perf suite, and they do not change here.

## Current state

Files:

- `apps/desktop/vitest.config.ts` — desktop Vitest config. Its `test` block starts at `:25` and has no `testTimeout`:

```ts
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: './src/test/setup.ts',
        css: true,
        // Vitest 4 narrowed discovery defaults; retain the Vitest 3 boundary.
        exclude: [
```

- `apps/mobile/vitest.config.ts` — mobile Vitest config. Its `test` block starts at `:12` and has no `testTimeout`:

```ts
  test: {
    environment: 'node',
    setupFiles: ['vitest.setup.ts'],
    // Vitest 4 narrowed discovery defaults; retain the Vitest 3 boundary.
    exclude: [
```

  Note the indentation: desktop uses 4 spaces (8 inside `test`), mobile uses 2 spaces (4 inside `test`). Match each file.

- `scripts/ci/validate-coverage-config.test.ts` — a bun governance test that already imports all three Vitest configs (`:7-9`) and checks them. It runs in `bun run test:governance` (`package.json:100`, which runs `bun test scripts/ci ...`) and therefore in CI. Its config type at `:11-15`:

```ts
type ConfigObject = {
  test?: {
    coverage?: unknown;
  };
};
```

  and its existing block at `:106-118` uses `describe.each(CONFIGS)("$name Vitest coverage config", ({ name, config }) => { test(...) })`. Match that style (double quotes, 2-space indent, `bun:test`).

Measured at this commit on the planning machine, while other agents were running builds (load average 21): `cd apps/desktop && bun run test -- src/components/views/AgendaView.test.tsx src/components/InboxProcessingPanels.test.tsx src/components/Layout.test.tsx` → 147 tests, 4 failed, every failure a timeout with no assertion message. Durations of the four: 11,400 ms (`AgendaView.test.tsx:243`, "collapses populated non-focus sections while keeping Focus and every heading available"), 5,506 ms, 5,347 ms (`Layout.test.tsx`), 5,057 ms. Eight more tests passed between 3,600 and 4,800 ms. The slowest observed case is 11.4 s, so 15 s would leave only about 30 % headroom; 30 s leaves about 2.6 times. That is why this plan uses `30_000`, not `15_000`.

Things that must NOT change, and why they are safe:

- The perf suite sets its own per-test timeouts, which win over the config value: `apps/desktop/src/components/views/ListView.performance.test.tsx:83` (`}, 15_000);`), `apps/desktop/src/components/views/TimelineView.performance.test.tsx:93`, `apps/mobile/tests/large-store-performance.test.tsx:951`, `:1006`, `:1169`. Three other tests in the mobile perf file have no timeout of their own and will inherit 30 s; their budgets are `expect(...)` checks on measured time and are not affected.
- `packages/core/vitest.config.ts` stays without a `testTimeout`: core tests are pure logic and the 5 s default has not been a problem there.

## Commands you will need

Run all commands from the repository root unless the command says `cd`.

| Purpose | Command | Expected |
|---|---|---|
| Governance test | `rtk bun test scripts/ci/validate-coverage-config.test.ts` | see each step |
| Desktop sample | `cd apps/desktop && rtk bun run test -- src/components/Layout.test.tsx` | all pass |
| Mobile sample | `rtk bun run --filter mobile test -- lib/widget-list-destination.test.ts` | all pass |
| Typecheck | `rtk bun run typecheck:desktop && rtk bun run typecheck:mobile` | exit 0 |
| Whitespace | `rtk git diff --check` | no output |

## Scope

**In scope** (the only files you may modify):
- `apps/desktop/vitest.config.ts`
- `apps/mobile/vitest.config.ts`
- `scripts/ci/validate-coverage-config.test.ts`

**Out of scope** (do NOT touch):
- `packages/core/vitest.config.ts`, `apps/cloud`, `apps/mcp-server`, `bunfig.toml`.
- Every perf file: `packages/core/src/performance-large-store.test.ts`, `apps/desktop/src/components/views/ListView.performance.test.tsx`, `apps/desktop/src/components/views/TimelineView.performance.test.tsx`, `apps/mobile/tests/large-store-performance.test.tsx`.
- `docs/performance/budgets.md` — no budget changes.
- Any individual test file. Do not add per-test timeouts and do not split or speed up `AgendaView.test.tsx`.
- `plans/README.md`.

## Git workflow

- One commit for this plan. Message: `test: give the desktop and mobile suites a 30 s harness timeout`. Repo style is conventional commits (example from `git log`: `test: stop wall-clock caps from failing under load`). No tooling mentions. Do not push.

## Steps

### Step 1: write the failing governance test

In `scripts/ci/validate-coverage-config.test.ts`:

1. Widen the type at `:11-15`:

```ts
type ConfigObject = {
  test?: {
    coverage?: unknown;
    testTimeout?: number;
  };
};
```

2. Append at the end of the file:

```ts
// A harness timeout, not a performance budget: full-screen render tests need
// 3-5 s on a quiet machine and were seen at 11.4 s on a busy one, so Vitest's
// 5 s default failed them at random. Budgets live in the perf suite.
describe("Vitest harness timeout", () => {
  test.each([
    { name: "desktop", config: desktopConfig as ConfigObject },
    { name: "mobile", config: mobileConfig as ConfigObject },
  ])("$name waits 30 s before calling a test hung", ({ config }) => {
    expect(config.test?.testTimeout).toBe(30_000);
  });

  test("core keeps Vitest's default", () => {
    expect((coreConfig as ConfigObject).test?.testTimeout).toBeUndefined();
  });
});
```

**Verify**: `rtk bun test scripts/ci/validate-coverage-config.test.ts` → the two new `waits 30 s` cases FAIL (`Expected: 30000`, `Received: undefined`); the `core keeps` case and every older case pass.

### Step 2: set the timeout in both configs

1. `apps/desktop/vitest.config.ts`: inside `test: {`, directly after the line `css: true,`, add (8 spaces of indent):

```ts
        // Harness timeout, not a performance budget: full-screen jsdom mounts cross
        // Vitest's 5 s default when the machine is busy. Budgets live in the perf suite.
        testTimeout: 30_000,
```

2. `apps/mobile/vitest.config.ts`: inside `test: {`, directly after the line `setupFiles: ['vitest.setup.ts'],`, add (4 spaces of indent):

```ts
    // Harness timeout, not a performance budget: heavy screen renders cross
    // Vitest's 5 s default when the machine is busy. Budgets live in the perf suite.
    testTimeout: 30_000,
```

**Verify**: `rtk bun test scripts/ci/validate-coverage-config.test.ts` → 0 fail.

### Step 3: check both suites still load their config

**Verify**, each must end with 0 failed:
- `cd apps/desktop && rtk bun run test -- src/components/Layout.test.tsx`
- `rtk bun run --filter mobile test -- lib/widget-list-destination.test.ts`
- `rtk bun run typecheck:desktop && rtk bun run typecheck:mobile` → exit 0
- `rtk git diff --check` → no output

If `Layout.test.tsx` fails only with a timeout at 30,000 ms, the machine is badly overloaded; wait and rerun once before treating it as a failure.

## Test plan

- New cases: three, in `scripts/ci/validate-coverage-config.test.ts` (desktop is 30 s, mobile is 30 s, core is unset). Written first and seen failing in Step 1.
- Structural pattern: the existing `describe.each(CONFIGS)` block in the same file (`:106-118`).
- Verification: `rtk bun test scripts/ci/validate-coverage-config.test.ts` → all pass.

## Done criteria

ALL must hold:

- [ ] `rtk bun test scripts/ci/validate-coverage-config.test.ts` → 0 fail, including the 3 new cases.
- [ ] `/usr/bin/grep -c "testTimeout: 30_000" apps/desktop/vitest.config.ts apps/mobile/vitest.config.ts` → prints two lines, each ending in `:1`.
- [ ] `/usr/bin/grep -c "testTimeout" packages/core/vitest.config.ts` → `0`.
- [ ] Before committing, `rtk git status --short -- docs/performance packages/core/src/performance-large-store.test.ts apps/desktop/src/components/views/ListView.performance.test.tsx apps/desktop/src/components/views/TimelineView.performance.test.tsx apps/mobile/tests/large-store-performance.test.tsx` → no output (no perf file and no budget changed).
- [ ] `rtk bun run typecheck:desktop && rtk bun run typecheck:mobile` → exit 0.
- [ ] `rtk git status --short` lists only the three in-scope files; `rtk git diff --check` prints nothing.

## STOP conditions

Stop and report (do not improvise) if:

- Either config already contains `testTimeout`, `hookTimeout` or a `pool`/`maxWorkers` setting (someone chose a different fix; report it).
- The excerpts in "Current state" do not match the live code.
- The Step 1 cases do not fail before Step 2 (the imported config is not the object you think it is).
- You feel the need to change a perf file, a budget in `docs/performance/budgets.md`, or any single test to make something pass. That is out of scope by decision.
- A verification fails twice after a reasonable fix attempt, or the fix seems to need a file outside the scope list.

## Maintenance notes

- A test that really hangs now takes 30 s to fail instead of 5 s. That is the accepted cost.
- If a test needs more than 30 s, it is doing too much; split it rather than raising this number. If the slow files (`AgendaView.test.tsx`, 2,893 lines; `Layout.test.tsx`; `InboxProcessingPanels.test.tsx`) keep growing, the better long-term fix is to mount less per test, not a larger timeout.
- Per-test timeouts (the `}, 15_000);` form used by the perf files) still win over this value.
- Reviewer: confirm that no perf file and no budget changed, and that core's config is untouched.
