# Plan 105: Remove the 'Skip occurrence' action the docs and ADR 0027 promise but no app has

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report; do not improvise. When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 0b9ea1d0e..HEAD -- <in-scope paths>` — if any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `0b9ea1d0e`, 2026-09-16

## Why this matters

The public GTD workflow page and ADR 0027 both say a 'Skip occurrence' action exists as a separate operation. No locale key, store action, or menu item implements it; the only series action is Cancel recurring series. Readers look for a control that is not there.

## Current state

- `/home/dd/code/mindwtr-web/docs/use/gtd-workflow.md:418` — '**Skip occurrence** remains a separate operation.' (+ localized copies under docs/<locale>/use/gtd-workflow.md).
- `docs/adr/0027-cancellation-outcome.md:22` — '…; Skip occurrence keeps its existing meaning.'
- `rtk rg -i 'skipOccurrence|skip occurrence' packages/core/src apps/desktop/src apps/mobile` → nothing.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Web docs | `cd /home/dd/worktrees/mindwtr-web/docs-20260916 && rtk bun run docs:build && rtk bun run check` | exit 0 |

## Scope

**In scope** (the only files you may modify):
- mindwtr-web: `docs/use/gtd-workflow.md` + localized copies (worktree /home/dd/worktrees/mindwtr-web/docs-20260916)
- Mindwtr: `docs/adr/0027-cancellation-outcome.md` (one sentence)

**Out of scope** (do NOT touch):
- Any code
- Locale files under `packages/core/src/i18n/locales/` (frozen this batch; reuse existing keys only).

## Git workflow

- One commit for this plan, message: `docs: drop the Skip occurrence promise (web: `docs(gtd): remove the Skip occurrence sentence`; Mindwtr: `docs(adr): note that no separate skip action exists`)`; repo style, no tooling mentions, do not push.

## Steps

### Step 1
Delete the sentence in every locale copy of gtd-workflow.md; reword the ADR line to state that no separate skip action exists today (a future one would be a new core action with the recurrence matrix).
**Verify**: docs build + check green.

## Test plan

- None beyond the docs build.

## Done criteria

- [ ] web docs build/check green; ADR sentence updated
- [ ] `git status --short` shows no files outside the in-scope list
- [ ] `git diff --check` clean

## STOP conditions

- A localized page has diverged so the sentence cannot be located (report the locale).
- The "Current state" excerpt does not match the live code.
- The fix needs a new locale key (report the proposed key + English text instead).
