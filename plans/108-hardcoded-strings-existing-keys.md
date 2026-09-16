# Plan 108: Replace hardcoded English with existing keys in sync setup, attachment progress and the mobile clarify loader

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

Three desktop strings and one mobile string are hardcoded English although translated keys already exist, so German or Chinese users see English next to translated forms and screen readers hear English progress text.

## Current state

- `apps/desktop/src/components/views/settings/sync/SyncConfigurationSection.tsx:309, :423` — `Enter a valid http(s) URL.` (mobile uses `t('settings.invalidUrlHttp')`, en.ts:1289).
- `apps/desktop/src/components/AttachmentProgressIndicator.tsx:31, :35` — `aria-label="Attachment transfer progress"`, `aria-valuetext="…% complete"` (mobile uses `t('attachments.transferProgress')`, en.ts:356).
- `apps/mobile/components/inbox-processing-modal.tsx:89-91` — `'Loading next item...'` hand-rolled although `tFallback` is imported at `:4` (`common.loading` exists).
- NOT in scope: `SyncConfigurationSection.tsx:163` `Dropbox app key is not configured in this build.` needs a new key (locale freeze) — leave it and note it in the result.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Desktop | `cd apps/desktop && rtk bun run test -- SyncConfigurationSection AttachmentProgressIndicator` | pass |
| Mobile | `rtk bun run --filter mobile test -- inbox-processing-modal` | pass |
| i18n | `rtk bun run i18n:check` | exit 0 |

## Scope

**In scope** (the only files you may modify):
- The three files above (+ tests)

**Out of scope** (do NOT touch):
- Locale files; the Dropbox-not-configured string
- Locale files under `packages/core/src/i18n/locales/` (frozen this batch; reuse existing keys only).

## Git workflow

- One commit for this plan, message: `fix(i18n): use existing keys for sync URL errors, transfer progress and the clarify loader`; repo style, no tooling mentions, do not push.

## Steps

### Step 1: red tests asserting the translated text via the test locale helper.
### Step 2: swap to `t('settings.invalidUrlHttp')`, `t('attachments.transferProgress')` (aria-label + valuetext), `tFallback(t, 'common.loading', ...)`.
**Verify**: red→green; `i18n:check` green.

## Test plan

- The cases above.

## Done criteria

- [ ] suites pass; i18n:check green
- [ ] `git status --short` shows no files outside the in-scope list
- [ ] `git diff --check` clean

## STOP conditions

- A key's existing English text does not fit the context (report; do not add a key).
- The "Current state" excerpt does not match the live code.
- The fix needs a new locale key (report the proposed key + English text instead).
