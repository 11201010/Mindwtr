# Plan 117: Keep the AI endpoint URL and extra request body on the device, like the API key

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report; do not improvise. The coordinator maintains `plans/README.md`; do not edit it.
>
> **Drift check (run first)**: `rtk git diff --stat 561cfdfa0..HEAD -- packages/core/src/sync-merge-settings.ts packages/core/src/sync-helpers.ts packages/core/src/store-helpers.ts` — if any of these changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW–MED
- **Depends on**: none (plan 124 depends on this one)
- **Category**: security
- **Planned at**: commit `561cfdfa0`, 2026-09-19

## Why this matters

Mindwtr syncs one JSON document between a user's devices. The AI settings group in that document is synced with the API key removed on purpose: the key lives only on the device. But the address the key is sent to (`ai.baseUrl`), the speech address (`ai.speechToText.baseUrl`) and the extra request body (`ai.openAIExtraBodyParams`) are still taken from the incoming document. So whoever can write the sync document (a self-hosted server operator, a broken-into WebDAV or Dropbox account, another device) can make this device send its locally stored API key and task text to a server they choose. After this plan those three fields are device-local, exactly like `apiKey` and `offlineModelPath`: the merge keeps the local value, and the outgoing document omits them. No new setting, no prompt.

## Current state

All paths are relative to the repo root. Files and roles:

- `packages/core/src/sync-merge-settings.ts` — merges incoming settings into local ones. `sanitizeAiForSync` is the one function that decides which AI fields survive a merge.
- `packages/core/src/sync-helpers.ts` — `sanitizeSettingsForRemote` builds the settings object that leaves the device.
- `packages/core/src/store-helpers.ts` — `normalizeAiSettingsForSync` is used by the store to decide whether an AI settings edit should bump the sync timestamp of the `ai` group.

`packages/core/src/sync-merge-settings.ts:132-152` (today):

```ts
const sanitizeAiForSync = (
    ai: AiSettings | undefined,
    localAi?: AiSettings
): AiSettings | undefined => {
    if (!ai) return ai;
    const sanitized: AiSettings = {
        ...ai,
        apiKey: undefined,
    };
    if (sanitized.speechToText) {
        const localSpeechToText = localAi?.speechToText;
        const keepLocalOfflineModelPath = Boolean(localSpeechToText?.offlineModelPath)
            && sanitized.speechToText.provider === localSpeechToText?.provider
            && sanitized.speechToText.model === localSpeechToText?.model;
        sanitized.speechToText = {
            ...sanitized.speechToText,
            offlineModelPath: keepLocalOfflineModelPath ? localSpeechToText?.offlineModelPath : undefined,
        };
    }
    return sanitized;
};
```

It is called from the merge at `sync-merge-settings.ts:1086-1094`:

```ts
    mergeGroup(
        'ai',
        localSettings.ai,
        incomingSettings.ai,
        (value) => {
            merged.ai = sanitizeAiForSync(value, localSettings.ai);
        },
        (localValue, incomingValue, incomingWins) => chooseGroupFieldValue(localValue, incomingValue, incomingWins)
    );
```

`value` is the whole `ai` object of whichever side won (`chooseGroupFieldValue`, `:823-828`, picks one whole object). `localSettings.ai` is always this device's own value.

`packages/core/src/sync-helpers.ts:249-260` (today):

```ts
    if (prefs.ai === true && settings.ai) {
        next.ai = {
            ...settings.ai,
            apiKey: undefined,
            speechToText: settings.ai.speechToText
                ? {
                    ...settings.ai.speechToText,
                    offlineModelPath: undefined,
                }
                : settings.ai.speechToText,
        };
    }
```

`packages/core/src/store-helpers.ts:1213-1224` (today):

```ts
export const normalizeAiSettingsForSync = (ai?: AiSettings): AiSettings | undefined => {
    if (!ai) return ai;
    const { apiKey: _apiKey, ...rest } = ai;
    if (!rest.speechToText) return rest;
    return {
        ...rest,
        speechToText: {
            ...rest.speechToText,
            offlineModelPath: undefined,
        },
    };
};
```

Its only caller is `packages/core/src/store-settings.ts:560-566`, which marks the `ai` group as changed when the normalized before/after values differ.

Why the remote document will not be rewritten in a loop: before deciding to upload, the sync run passes BOTH sides (local and the downloaded remote) through `toRemoteSyncDocument` = `sanitizeAppDataForRemote` (`packages/core/src/sync-document.ts:306-307`). Once the outgoing sanitizer omits the three fields, a remote copy that still carries them (written by an older app version) compares equal to a local copy without them.

Convention to match — the existing test style in `packages/core/src/sync-merge-settings.test.ts:74-91`:

```ts
const OLDER = '2026-07-01T00:00:00.000Z';
const NEWER = '2026-08-01T00:00:00.000Z';

const stamp = (settings: Settings, group: SettingsSyncGroup | 'preferences', at: string): Settings => ({
    ...settings,
    syncPreferencesUpdatedAt: { ...settings.syncPreferencesUpdatedAt, [group]: at },
});

describe('mergeSettingsForSync > AI request timeout', () => {
    it('preserves a local explicit timeout when a newer old-version peer omits it', () => {
        const local = stamp({ ai: { model: 'local-model', requestTimeoutSeconds: 120 } }, 'ai', OLDER);
        const incoming = stamp({ ai: { model: 'incoming-model' } }, 'ai', NEWER);

        const merged = mergeSettingsForSync(local, incoming);

        expect(merged.ai).toMatchObject({ model: 'incoming-model', requestTimeoutSeconds: 120 });
        expect(mergeSettingsForSync(merged, incoming)).toEqual(merged);
    });
```

The last line (merge again, expect no change) is the repo's required convergence check. Every new merge test in this plan must include it.

The outgoing-document test to extend is `packages/core/src/sync-helpers.test.ts:364-403` (the fixture has `ai: { enabled, provider, apiKey: 'secret', requestTimeoutSeconds, speechToText: { …, offlineModelPath } }` and asserts `sanitized.settings.ai?.apiKey` and `…offlineModelPath` are undefined).

## Commands you will need

Run from the repo root.

| Purpose | Command | Expected |
|---|---|---|
| Core tests (one file) | `rtk bun run --filter @mindwtr/core test -- sync-merge-settings` | all pass |
| Core tests (one file) | `rtk bun run --filter @mindwtr/core test -- sync-helpers` | all pass |
| Core tests (one file) | `rtk bun run --filter @mindwtr/core test -- store-settings` | all pass |
| Typecheck | `rtk bun run typecheck:core` | exit 0 |
| Whitespace | `rtk git diff --check` | no output |

## Scope

**In scope** (the only files you may modify):
- `packages/core/src/sync-merge-settings.ts`
- `packages/core/src/sync-merge-settings.test.ts`
- `packages/core/src/sync-helpers.ts`
- `packages/core/src/sync-helpers.test.ts`
- `packages/core/src/store-helpers.ts`
- `packages/core/src/store-helpers.test.ts` (only if it already tests `normalizeAiSettingsForSync`; otherwise put that test in `sync-helpers.test.ts`)

**Out of scope** (do NOT touch):
- `packages/core/src/ai-config.ts`, `packages/core/src/ai/**` — how the key is paired with the URL stays as is.
- Any settings screen in `apps/desktop` or `apps/mobile` — no new switch, no prompt.
- Locale files under `packages/core/src/i18n/locales/`.
- `plans/README.md`.
- The public docs repo (see Step 5: report the sentences, do not edit them unless told to).

## Git workflow

- One commit for this plan, message: `fix(sync): keep the AI endpoint and extra request body on the device`. Repo style, no tooling mentions, do not push.

## Steps

### Step 1: write the failing tests

In `packages/core/src/sync-merge-settings.test.ts`, add a new block `describe('mergeSettingsForSync > device-local AI fields', …)` with these cases (use the `stamp`, `OLDER`, `NEWER` helpers already in the file):

1. Incoming wins, local has no URL: local `stamp({ ai: { enabled: true, provider: 'openai' } }, 'ai', OLDER)`, incoming `stamp({ ai: { enabled: true, provider: 'openai', baseUrl: 'https://other-host.example/v1', openAIExtraBodyParams: { x: 1 }, speechToText: { enabled: true, provider: 'openai', baseUrl: 'https://other-host.example/v1' } } }, 'ai', NEWER)`. Expect `merged.ai?.baseUrl` undefined, `merged.ai?.openAIExtraBodyParams` undefined, `merged.ai?.speechToText?.baseUrl` undefined, and `merged.ai?.speechToText?.enabled` true (other fields still sync). Then the convergence line.
2. Incoming wins, local has its own values: local `ai: { provider: 'openai', baseUrl: 'http://localhost:1234/v1', openAIExtraBodyParams: { keep: true }, speechToText: { provider: 'openai', baseUrl: 'http://localhost:8000/v1' } }` (OLDER), incoming with different values for all three (NEWER) and `model: 'incoming-model'`. Expect the three local values unchanged and `merged.ai?.model` to be `'incoming-model'`. Then the convergence line.
3. Incoming wins and has NO `speechToText` object while local has `speechToText: { baseUrl: 'http://localhost:8000/v1' }`: expect `merged.ai?.speechToText?.baseUrl` to be `'http://localhost:8000/v1'`. Then the convergence line.

In `packages/core/src/sync-helpers.test.ts`, extend the fixture at `:364-374` with `baseUrl: 'http://localhost:1234/v1'`, `openAIExtraBodyParams: { keep: true }` and `speechToText.baseUrl: 'http://localhost:8000/v1'`, and add next to the asserts at `:401-403`:

```ts
        expect(sanitized.settings.ai?.baseUrl).toBeUndefined();
        expect(sanitized.settings.ai?.openAIExtraBodyParams).toBeUndefined();
        expect(sanitized.settings.ai?.speechToText?.baseUrl).toBeUndefined();
```

Add one more test in `sync-helpers.test.ts` (import `toRemoteSyncDocument` from `./sync-document`): two `AppData` objects that are identical except that one carries the three fields in `settings.ai` (both with `syncPreferences: { ai: true }`) produce deep-equal `toRemoteSyncDocument` results. This is the "no rewrite loop against an older peer" proof.

**Verify**: `rtk bun run --filter @mindwtr/core test -- sync-merge-settings` and `… -- sync-helpers` → the new cases FAIL, everything else passes.

### Step 2: make the merge keep the local values

In `sanitizeAiForSync` (`sync-merge-settings.ts:132`), set the two top-level fields from `localAi` unconditionally, and the speech URL from `localAi?.speechToText`. Target shape:

```ts
    const sanitized: AiSettings = {
        ...ai,
        apiKey: undefined,
        // Device-local, like apiKey: the sync document must never choose where
        // this device sends its key or what the request body carries.
        baseUrl: localAi?.baseUrl,
        openAIExtraBodyParams: localAi?.openAIExtraBodyParams,
    };
    const localSpeechBaseUrl = localAi?.speechToText?.baseUrl;
    if (sanitized.speechToText || localSpeechBaseUrl) {
        …existing offlineModelPath logic, using `sanitized.speechToText ?? {}`…
        sanitized.speechToText = {
            ...(sanitized.speechToText ?? {}),
            offlineModelPath: …as today…,
            baseUrl: localSpeechBaseUrl,
        };
    }
```

Keep the existing `offlineModelPath` rule exactly as it is. Clone object values with the file's existing `cloneSettingValue` helper when copying `openAIExtraBodyParams`.

**Verify**: `rtk bun run --filter @mindwtr/core test -- sync-merge-settings` → all pass, including the three new cases and the pre-existing case at `:509-517` (`toEqual({ enabled: true, model: 'shared-model', apiKey: undefined })` — `toEqual` ignores keys whose value is `undefined`, so it must still pass; if it fails, that is a STOP condition).

### Step 3: omit the fields from the outgoing document

In `sanitizeSettingsForRemote` (`sync-helpers.ts:249-260`), add `baseUrl: undefined` and `openAIExtraBodyParams: undefined` next to `apiKey: undefined`, and `baseUrl: undefined` next to `offlineModelPath: undefined` inside `speechToText`.

**Verify**: `rtk bun run --filter @mindwtr/core test -- sync-helpers` → all pass.

### Step 4: stop an endpoint-only edit from bumping the `ai` sync timestamp

In `normalizeAiSettingsForSync` (`store-helpers.ts:1213-1224`), also drop `baseUrl` and `openAIExtraBodyParams` from `rest`, and set `speechToText.baseUrl: undefined`. Add one test next to the existing tests of this function (search `normalizeAiSettingsForSync` in `packages/core/src/*.test.ts`; if none exists, add it to `sync-helpers.test.ts`): two AI settings objects that differ only in the three fields normalize to deep-equal values.

**Verify**: `rtk bun run --filter @mindwtr/core test -- store-settings` and `rtk bun run --filter @mindwtr/core test -- store-helpers` → all pass. `rtk bun run typecheck:core` → exit 0.

### Step 5: report the public docs sentences (do not edit unless told to)

The public docs live in a separate repository at `/home/dd/code/mindwtr-web`. Four English sentences say which AI values never sync and must gain "custom endpoint URLs and extra request parameters":

- `docs/data-sync/index.md:325` — "> API keys and local model paths are never synced."
- `docs/data-sync/sync-algorithm.md:68` — "Secrets (API keys, local model paths) are never synced."
- `docs/use/desktop.md:632` — "API keys and local model paths are never synced"
- `docs/use/mobile.md:843` — "…API keys and local model paths are never synced."

Proposed wording: "API keys, custom AI endpoint URLs, extra request parameters and local model paths are never synced." List these four locations in your final report. Also propose this release-note line: "A custom AI endpoint URL is now kept per device. If you use one, enter it once on each device."

**Verify**: none (report only).

## Test plan

- New: three merge cases (Step 1), three outgoing asserts, one `toRemoteSyncDocument` equality case, one `normalizeAiSettingsForSync` case.
- Pattern to copy: `sync-merge-settings.test.ts:82-91`.
- Failing first: Step 1 must be red before Step 2.

## Done criteria

- [ ] `rtk bun run --filter @mindwtr/core test -- sync-merge-settings` passes with the 3 new cases
- [ ] `rtk bun run --filter @mindwtr/core test -- sync-helpers` passes with the new asserts and the equality case
- [ ] `rtk bun run typecheck:core` exits 0
- [ ] `rtk proxy grep -n "baseUrl" packages/core/src/sync-helpers.ts packages/core/src/sync-merge-settings.ts packages/core/src/store-helpers.ts` shows the new lines in all three files
- [ ] `rtk git status --short` shows no files outside the in-scope list
- [ ] `rtk git diff --check` clean

## STOP conditions

- A "Current state" excerpt does not match the live code.
- Any convergence line (`expect(mergeSettingsForSync(merged, incoming)).toEqual(merged)`) fails after Step 2 — the merge is not idempotent; report the diff instead of adjusting the test.
- A pre-existing test in the three test files fails and the fix would need a change outside the in-scope files.
- You find another place that copies `ai.baseUrl` out of an incoming sync document (search: `rtk proxy grep -rn "baseUrl" packages/core/src --include=*.ts` and look for sync/merge files). Report it; do not widen the change.

## Maintenance notes

- Mixed versions: an older app version still uploads the three fields. This device ignores them (Steps 2–3). The reverse also holds: when this device's `ai` group wins a merge on an older peer, that peer's `ai` object is replaced by one without `baseUrl`, so the older peer loses its custom endpoint until the user re-enters it or updates. That is the reason for the release-note line in Step 5.
- If syncing the endpoint is ever wanted again, the safe design is to store the endpoint origin next to the key on the device and refuse to attach the key when the origins differ — not to re-add the field to the sync document.
- Plan 124 adds the test that stops the next device-local field from slipping into the sync document.
