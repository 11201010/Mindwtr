# Plan 106: Seed Getting Started with deterministic ids so two devices converge

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report; do not improvise. When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 0b9ea1d0e..HEAD -- <in-scope paths>` — if any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW-MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `0b9ea1d0e`, 2026-09-16

## Why this matters

Each fresh device seeds its own Getting Started project with random ids; onboarding opens on any device with no data and sync off, which is exactly a second device before pairing. After pairing, sync unions by id and keeps both projects and ~16 duplicate starter tasks.

## Current state

- `packages/core/src/getting-started-seed.ts:230` — `const projectId = uuidv4();`; `:318-322` de-duplicates by title inside one store only.
- Onboarding triggers: `apps/desktop/src/lib/desktop-onboarding-events.ts:31-36`, `apps/mobile/lib/mobile-onboarding-events.ts:22-25` (`visibleDataCount === 0 && syncBackend === 'off'`).
- Sync unions entities by id (`packages/core/src/sync.ts` `mergeEntitiesWithStats`); a tombstone for a fixed id keeps a user's deletion (desired).
- `isGettingStartedProject` is used by the seed and two UI call sites.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Core tests | `rtk bun run --filter @mindwtr/core test -- src/getting-started-seed src/sync` | pass |
| Typecheck | `rtk bun run typecheck:core` | exit 0 |

## Scope

**In scope** (the only files you may modify):
- `packages/core/src/getting-started-seed.ts` (+ test)

**Out of scope** (do NOT touch):
- Sync merge code; onboarding triggers; a new setting
- Locale files under `packages/core/src/i18n/locales/` (frozen this batch; reuse existing keys only).

## Git workflow

- One commit for this plan, message: `fix(core): seed Getting Started with stable ids so devices converge`; repo style, no tooling mentions, do not push.

## Steps

### Step 1: red test
Seed into two empty stores (two device ids), merge with `mergeAppDataWithStats` → exactly one Getting Started project and one copy of each starter task.
### Step 2: fixed ids
One fixed UUID constant per starter item (project + each task), generated once and pasted as constants (or `generateDeterministicUUID('getting-started', slug)` — core already has it). Keep the title-based repair for old installs and the language re-localisation. Existing seed tests must pass.
**Verify**: red→green; `rtk bun run schema:check` unaffected (no new fields).

## Test plan

- The two-device convergence case; existing seed tests.

## Done criteria

- [ ] core seed + sync tests pass; typecheck clean
- [ ] `git status --short` shows no files outside the in-scope list
- [ ] `git diff --check` clean

## STOP conditions

- A fixed id collides with the tombstone-retention expectations in an existing test (report).
- The "Current state" excerpt does not match the live code.
- The fix needs a new locale key (report the proposed key + English text instead).
