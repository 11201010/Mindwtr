# Plan 110: Add the Read the guide link to the mobile Getting Started card

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report; do not improvise. When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 0b9ea1d0e..HEAD -- <in-scope paths>` — if any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `0b9ea1d0e`, 2026-09-16

## Why this matters

Desktop's Getting Started card links to the public guide; the mobile card renders only the three action chips, so the hand-off from the seeded tutorial to the guide exists on desktop only.

## Current state

- `apps/desktop/src/components/GettingStartedActions.tsx:23-27` — `getDocsGuideUrl('start/getting-started', language, 'basic-workflow')` with `onboarding.readGuide`.
- `apps/mobile/components/GettingStartedActions.tsx:12-27` — chips only. Mobile already uses the helper at `apps/mobile/components/settings/sync-settings-screen.tsx:773`; `packages/core/src/onboarding-guidance.ts:16-18` maps mobile sections.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Mobile | `rtk bun run --filter mobile test -- GettingStartedActions` | pass |
| Typecheck/lint | `rtk bun run typecheck:mobile && rtk bun run lint:mobile` | clean |

## Scope

**In scope** (the only files you may modify):
- `apps/mobile/components/GettingStartedActions.tsx` (+ test)

**Out of scope** (do NOT touch):
- Desktop card; core guidance map
- Locale files under `packages/core/src/i18n/locales/` (frozen this batch; reuse existing keys only).

## Git workflow

- One commit for this plan, message: `fix(mobile): link the Getting Started card to the guide`; repo style, no tooling mentions, do not push.

## Steps

### Step 1: red test — the card renders a link with `onboarding.readGuide` whose href is `getDocsGuideUrl(..., 'mobile')`.
### Step 2: add the `ExternalLink` row.
**Verify**: red→green.

## Test plan

- The case above.

## Done criteria

- [ ] suite passes; typecheck + lint clean
- [ ] `git status --short` shows no files outside the in-scope list
- [ ] `git diff --check` clean

## STOP conditions

- none beyond the shared conditions
- The "Current state" excerpt does not match the live code.
- The fix needs a new locale key (report the proposed key + English text instead).
