# Plan 109: Add Test connection to the desktop self-hosted panel and toast on a blank mobile token

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

Desktop has Test handlers for Dropbox, WebDAV and the sync folder but the self-hosted panel only has Save, so a wrong token is discovered only by the full verification sync. On mobile, Save with an empty token returns silently, so sync stays off with no explanation; desktop's equivalent case toasts `settings.sync.readyToVerify`.

## Current state

- `apps/desktop/src/components/views/settings/sync/SyncConfigurationSection.tsx:295-359` — self-hosted panel: Save only (Dropbox test `:180`, WebDAV `:467-472`, folder `onTestSyncPath` `:27`); mobile has one: `apps/mobile/components/settings/sync-settings-selfhosted-panel.tsx:145-156`.
- `apps/mobile/components/settings/use-sync-settings-transport-actions.ts:711-712` — `if (!nextSettings.token.trim()) return;` after Save; desktop toasts at `useSyncSettings.ts:800-802`.
- Keys: `settings.testConnection`, `settings.cloudTestHint`, `settings.sync.readyToVerify` exist.
- NOT in scope: a folder probe for the mobile file panel (needs design).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Desktop | `cd apps/desktop && rtk bun run test -- SyncConfigurationSection useSyncSettings` | pass |
| Mobile | `rtk bun run --filter mobile test -- use-sync-settings-transport-actions sync-settings` | pass |
| Typecheck/lint | `rtk bun run typecheck:desktop && rtk bun run typecheck:mobile && rtk bun run lint:mobile` | clean |

## Scope

**In scope** (the only files you may modify):
- `SyncConfigurationSection.tsx`, `useSyncSettings.ts` (desktop; + tests)
- `use-sync-settings-transport-actions.ts` (mobile; + test)

**Out of scope** (do NOT touch):
- The verification-sync path itself; the mobile file panel
- Locale files under `packages/core/src/i18n/locales/` (frozen this batch; reuse existing keys only).

## Git workflow

- One commit for this plan, message: `fix: test the self-hosted connection on desktop and explain a blank mobile token`; repo style, no tooling mentions, do not push.

## Steps

### Step 1: red tests
Desktop: the self-hosted panel renders a Test connection button that calls the probe the mobile panel uses (find the shared core/cloud probe the mobile `onTest` calls and reuse it through the desktop transport). Mobile: Save with a blank token → `settings.sync.readyToVerify` toast.
### Step 2: implement with the existing keys and the existing probe.
**Verify**: red→green.

## Test plan

- The two cases.

## Done criteria

- [ ] suites pass; typecheck + lint clean
- [ ] `git status --short` shows no files outside the in-scope list
- [ ] `git diff --check` clean

## STOP conditions

- No shared probe exists for self-hosted on desktop without a new Tauri command (report; do not add a command).
- The "Current state" excerpt does not match the live code.
- The fix needs a new locale key (report the proposed key + English text instead).
