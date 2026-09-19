# Plan 124: Pin in one test which settings may leave the device and which an incoming sync document may change

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report; do not improvise. The coordinator maintains `plans/README.md`; do not edit it.
>
> **Drift check (run first)**: `rtk git diff --stat 561cfdfa0..HEAD -- packages/core/src/sync-helpers.ts packages/core/src/sync-merge-settings.ts packages/core/src/types.ts` — plan 117 is EXPECTED to have changed the first two files (that is this plan's dependency). Any other change: compare the "Current state" facts against the live code before proceeding; on a mismatch treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/117-ai-endpoint-stays-on-device.md` (must be DONE first; without it the AI part of this test fails)
- **Category**: tests
- **Planned at**: commit `561cfdfa0`, 2026-09-19

## Why this matters

Every Mindwtr setting is either synced between devices or device-local. Two hand-written functions decide this: one builds the settings that leave the device, the other merges incoming settings into local ones. No test states the rule as a whole, so a field that holds a URL, a path or a device switch can start travelling between devices without anyone deciding it should. Plan 117 fixed one such field (`ai.baseUrl`, which let a sync document choose where the device sends its AI key). This plan adds the test that makes the next one fail in CI: a written-down list of what may leave the device, a written-down list of what must never arrive from another device, and a check that every setting in the type is on one of the lists. Test-only; no production code changes.

## Current state

All paths are relative to the repo root.

- `packages/core/src/sync-helpers.ts:176-262` — `sanitizeSettingsForRemote` builds the outgoing settings. It is private; reach it through the exported `sanitizeAppDataForRemote(data)` (`:265`), whose result's `.settings` is exactly that object (`:323`).
- `packages/core/src/sync-merge-settings.ts:787` — `export const mergeSettingsForSync = (localSettings, incomingSettings) => …`.
- `packages/core/src/types.ts:456-469` — `export interface NotificationSettings { … }`; `:546-600` — `export interface AppSettings extends NotificationSettings { … }`. Together they list every top-level settings key. Sync groups: `types.ts:30` — `'appearance' | 'language' | 'gtd' | 'externalCalendars' | 'ai' | 'savedFilters'`.

What leaves the device today, read from `sync-helpers.ts:201-260` at the planned commit (with every sync preference switched on):

| Always | `syncPreferences`, `syncPreferencesUpdatedAt`, `analyticsProfileId`, `supportPrompt` |
|---|---|
| group `appearance` | `theme`, `appearance`, `keybindingStyle` (and `globalQuickAddShortcut` is set to `undefined` on purpose) |
| group `language` | `language`, `weekStart`, `dateFormat`, `timeFormat` |
| group `gtd` | `gtd`, `quickAddAutoClean`, `markdownEditorAssist`, `features` |
| group `savedFilters` | `savedFilters` |
| group `externalCalendars` | `externalCalendars` (without `file://` and `content://` entries) |
| group `ai` | `ai`, minus `apiKey`, `speechToText.offlineModelPath`, and — after plan 117 — `baseUrl`, `openAIExtraBodyParams`, `speechToText.baseUrl` |

Every other top-level key is device-local, for example: `deviceId`, `migrations`, `filters`, `window`, `sidebarCollapsed`, `network`, `security`, `diagnostics`, `analytics`, `attachments`, `calendar`, `calendarSystem`, `taskSortBy`, `savedSearches`, `globalQuickAddShortcut`, all `lastSync*` and `pendingRemoteWrite*` keys, and all `NotificationSettings` keys.

Convention to match — a core test that reads a source file, `packages/core/src/local-api-action-parity.test.ts:1-2,36`:

```ts
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
…
    readFileSync(new URL('./recurrence-local-api-parity.fixtures.json', import.meta.url), 'utf8')
```

Merge test helpers to reuse, `packages/core/src/sync-merge-settings.test.ts:74-80`:

```ts
const OLDER = '2026-07-01T00:00:00.000Z';
const NEWER = '2026-08-01T00:00:00.000Z';

const stamp = (settings: Settings, group: SettingsSyncGroup | 'preferences', at: string): Settings => ({
    ...settings,
    syncPreferencesUpdatedAt: { ...settings.syncPreferencesUpdatedAt, [group]: at },
});
```

## Commands you will need

Run from the repo root.

| Purpose | Command | Expected |
|---|---|---|
| The new test | `rtk bun run --filter @mindwtr/core test -- sync-settings-scope` | all pass |
| Neighbours | `rtk bun run --filter @mindwtr/core test -- sync-merge-settings` | all pass |
| Whitespace | `rtk git diff --check` | no output |

## Scope

**In scope** (the only file you may create or modify):
- `packages/core/src/sync-settings-scope.contract.test.ts` (create)

**Out of scope** (do NOT touch):
- Every production file. If the test reveals a setting that crosses devices and should not, that is a finding to REPORT, not to fix here.
- `packages/core/src/types.ts`; `plans/README.md`.

## Git workflow

- One commit for this plan, message: `test(sync): pin which settings cross devices`. Repo style, no tooling mentions, do not push.

## Steps

### Step 1: the classification table and its completeness check

Create `packages/core/src/sync-settings-scope.contract.test.ts` with:

1. `const SYNCED_TOP_LEVEL_KEYS = [...]` — exactly the keys in the table above (`syncPreferences`, `syncPreferencesUpdatedAt`, `analyticsProfileId`, `supportPrompt`, `theme`, `appearance`, `keybindingStyle`, `language`, `weekStart`, `dateFormat`, `timeFormat`, `gtd`, `quickAddAutoClean`, `markdownEditorAssist`, `features`, `savedFilters`, `externalCalendars`, `ai`), each with a short comment naming its group.
2. `const DEVICE_LOCAL_TOP_LEVEL_KEYS = [...]` — every other key of `AppSettings` and `NotificationSettings`, each with a one-line reason.
3. A test `every settings key is classified exactly once`: read `types.ts` with `readFileSync(new URL('./types.ts', import.meta.url), 'utf8')`, cut out the bodies of `export interface NotificationSettings {` and `export interface AppSettings extends NotificationSettings {` (from the header line to the first line that is exactly `}`), collect property names with `/^\s{4}([A-Za-z]+)\??:/gm`, and assert: the set of names equals the union of the two lists, and the two lists do not overlap. If a name is missing, the failure message must say: `Classify "<name>" as synced or device-local in sync-settings-scope.contract.test.ts`.

**Verify**: `rtk bun run --filter @mindwtr/core test -- sync-settings-scope` → passes. Then prove it can fail: temporarily delete one name from `DEVICE_LOCAL_TOP_LEVEL_KEYS`, run again → FAILS with the message above; restore the name.

### Step 2: what leaves the device

Add a test `only classified-synced keys leave the device`: build one `AppData` whose `settings` has a non-default value for EVERY key in both lists, with all six sync preferences `true` (for `externalCalendars` use one `https://` entry and one `file://` entry; for `ai` include `apiKey`, `baseUrl`, `openAIExtraBodyParams`, and `speechToText` with `offlineModelPath` and `baseUrl`). Call `sanitizeAppDataForRemote(data)`, round-trip the settings through `JSON.parse(JSON.stringify(...))` so `undefined` values drop out, and assert:

- `Object.keys(result).sort()` equals `[...SYNCED_TOP_LEVEL_KEYS].sort()`.
- `result.ai` has none of `apiKey`, `baseUrl`, `openAIExtraBodyParams`; `result.ai.speechToText` has none of `offlineModelPath`, `baseUrl`.
- `result.externalCalendars` holds only the `https://` entry.

Values must be valid for their type (read the type in `types.ts`); an invalid value may be dropped by a normalizer and make the key list shorter than expected.

**Verify**: the test command → passes. If the key list differs from `SYNCED_TOP_LEVEL_KEYS`, do NOT edit the list to match: see STOP conditions.

### Step 3: what an incoming document may not change

Add a test `an incoming document never changes a device-local setting`: `local` = the full settings object from Step 2 stamped `OLDER` for every group and for `'preferences'`; `incoming` = a copy in which every DEVICE-LOCAL top-level key, plus `ai.apiKey`, `ai.baseUrl`, `ai.openAIExtraBodyParams`, `ai.speechToText.baseUrl` and `ai.speechToText.offlineModelPath`, holds a different valid value, all groups stamped `NEWER`, all sync preferences `true`. Run `const merged = mergeSettingsForSync(local, incoming)` and assert, in a loop with the key name in the failure message:

- for each key in `DEVICE_LOCAL_TOP_LEVEL_KEYS`: `merged[key]` deep-equals `local[key]`;
- `merged.ai?.baseUrl`, `merged.ai?.openAIExtraBodyParams`, `merged.ai?.speechToText?.baseUrl` equal the LOCAL values; `merged.ai?.apiKey` is `undefined`;
- convergence: `mergeSettingsForSync(merged, incoming)` deep-equals `merged`.

Exclude from the loop only keys the merge itself is documented to rewrite, and say why in a comment: the sync bookkeeping keys (`lastSyncAt`, `lastSyncStatus`, `lastSyncError`, `lastSyncStats`, `lastSyncHistory`, `pendingRemoteWriteAt`, `pendingRemoteWriteRetryAt`, `pendingRemoteWriteAttempts`) if — and only if — the test shows the merge touches them.

**Verify**: the test command → passes; `rtk bun run --filter @mindwtr/core test -- sync-merge-settings` → still passes.

## Test plan

- One new file, three tests: completeness (Step 1), outgoing allowlist (Step 2), incoming device-local protection plus convergence (Step 3).
- Falsifiability check in Step 1 is mandatory and must be mentioned in your report.

## Done criteria

- [ ] `rtk bun run --filter @mindwtr/core test -- sync-settings-scope` passes with 3 tests
- [ ] The Step 1 falsifiability check was performed (removed a name → red; restored → green)
- [ ] `rtk git status --short` shows only the new test file
- [ ] `rtk git diff --check` clean

## STOP conditions

- Plan 117 is not merged (the AI assertions in Steps 2–3 then fail): stop, report, do not weaken the assertions.
- Step 2 shows a key leaving the device that is not in the table above, or Step 3 shows a device-local key (or AI field) adopting the incoming value. This is exactly what the test exists to catch. Report the key, the two values and the function that let it through. Do NOT move the key to the synced list and do NOT exclude it to get a green run.
- The property-name regex cannot parse the interfaces (for example a multi-line property type breaks it). Report the offending lines.

## Maintenance notes

- Adding a setting now fails this test until the author classifies it. That is the point; the failure message tells them where.
- The test pins top-level keys plus the AI sub-fields that carry credentials, URLs or paths. Fields inside `gtd`, `appearance` and `features` are covered by the per-field tests in `sync-merge-settings.test.ts`.
- If a group is added to `SettingsSyncGroup` (`types.ts:30`), extend the fixture's `syncPreferences` and the table in this plan's test comments.
