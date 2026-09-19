# Plan 121: Make the log sanitizer redact today's AI API key shapes, from one pattern list

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report; do not improvise. The coordinator maintains `plans/README.md`; do not edit it.
>
> **Drift check (run first)**: `rtk git diff --stat 561cfdfa0..HEAD -- packages/core/src/log-sanitize.ts packages/core/src/sync-service-utils.ts` — if either changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `561cfdfa0`, 2026-09-19

## Why this matters

The log sanitizer is the last safeguard before text reaches the app's log files, which users attach to GitHub issues and in-app feedback. Its API-key patterns need ten letters or digits right after the prefix. Today's keys do not look like that: an OpenAI project key starts `sk-proj-` and contains `_` and `-`; an Anthropic key starts `sk-ant-api03-`; xAI, Groq and OpenRouter keys use `xai-`, `gsk_` and `sk-or-v1-`. A check with made-up strings of those shapes showed the whole key passing through unchanged. There are also two copies of the pattern list that already disagree. After this plan there is one list, in `log-sanitize.ts`, it covers the current shapes, and a table test fails when it stops doing so.

**Never put a real key in a test, a fixture, a commit message or a report.** Build every test string from a prefix plus repeated filler characters, as shown below.

## Current state

All paths are relative to the repo root.

- `packages/core/src/log-sanitize.ts` — the sanitizer. `redactSensitiveText` applies the patterns to free text.
- `packages/core/src/sync-service-utils.ts` — `sanitizeSyncErrorMessage` for sync error text. It already imports from `./log-sanitize` (`:1`), so sharing one list adds no new dependency edge.

`packages/core/src/log-sanitize.ts:35-40` (today):

```ts
const AI_KEY_PATTERNS = [
    /sk-[A-Za-z0-9]{10,}/g,
    /sk-ant-[A-Za-z0-9]{10,}/g,
    /rk-[A-Za-z0-9]{10,}/g,
    /AIza[0-9A-Za-z\-_]{10,}/g,
];
```

Used at `packages/core/src/log-sanitize.ts:90-92`:

```ts
    for (const pattern of AI_KEY_PATTERNS) {
        result = result.replace(pattern, '[redacted]');
    }
```

`packages/core/src/sync-service-utils.ts:81-86` (today, the second copy):

```ts
const AI_KEY_PATTERNS = [
    /sk-[A-Za-z0-9-]{10,}/g,
    /sk-ant-[A-Za-z0-9-]{10,}/g,
    /rk-[A-Za-z0-9]{10,}/g,
    /AIza[0-9A-Za-z\-_]{10,}/g,
];
```

`packages/core/src/sync-service-utils.ts:164-173` (today):

```ts
export const sanitizeSyncErrorMessage = (value: string): string => {
    // One redactor: sanitizeLogMessage already covers the auth header, query-string
    // credentials and URL userinfo. Only the AI-key patterns stay on top of it -- these
    // span hyphens (sk-ant-api03-...), log-sanitize's stop at the first one.
    let result = sanitizeLogMessage(value);
    for (const pattern of AI_KEY_PATTERNS) {
        result = result.replace(pattern, '[redacted]');
    }
    return result;
};
```

Existing test that must keep passing, `packages/core/src/sync-service-utils.test.ts:79-86` — it expects `'sk-test-1234567890'` (15 characters after `sk-`, with a dash) to be redacted. So the new `sk-` pattern must keep a minimum of 10 and must allow `-`.

Test style to copy, `packages/core/src/log-sanitize.test.ts:4-8`:

```ts
describe('log sanitization', () => {
    it('redacts credentials in plain text', () => {
        expect(sanitizeForLog('Authorization: Bearer secret-token')).toContain('[redacted]');
        expect(sanitizeForLog('password=hunter2')).toContain('password=[redacted]');
    });
```

## Commands you will need

Run from the repo root.

| Purpose | Command | Expected |
|---|---|---|
| Sanitizer tests | `rtk bun run --filter @mindwtr/core test -- log-sanitize` | all pass |
| Sync utils tests | `rtk bun run --filter @mindwtr/core test -- sync-service-utils` | all pass |
| Typecheck | `rtk bun run typecheck:core` | exit 0 |
| Whitespace | `rtk git diff --check` | no output |

## Scope

**In scope** (the only files you may modify):
- `packages/core/src/log-sanitize.ts`
- `packages/core/src/log-sanitize.test.ts`
- `packages/core/src/sync-service-utils.ts`

**Out of scope** (do NOT touch):
- `SENSITIVE_KEYS`, `PRIVATE_CONTENT_KEYS` and `sanitizeUrl` in `log-sanitize.ts` — key-name redaction works and is not part of this plan.
- `packages/core/src/index.ts` and `packages/core/src/index-exports.baseline.json` — do not add a public export; the list stays private to `log-sanitize.ts`.
- `packages/core/src/ai/**`; `plans/README.md`.

## Git workflow

- One commit for this plan, message: `fix(core): redact current AI API key shapes in logs from one pattern list`. Repo style, no tooling mentions, do not push.

## Steps

### Step 1: failing table test

In `packages/core/src/log-sanitize.test.ts` add:

```ts
    // Made-up strings in the public shape of each provider's key. Never a real key.
    const FAKE_KEYS: Array<[string, string]> = [
        ['openai legacy', `sk-${'A'.repeat(48)}`],
        ['openai project', `sk-proj-${'Ab1_'.repeat(6)}-${'Cd2'.repeat(10)}`],
        ['anthropic', `sk-ant-api03-${'Ef3-'.repeat(5)}${'Gh4_'.repeat(10)}`],
        ['openrouter', `sk-or-v1-${'e'.repeat(64)}`],
        ['xai', `xai-${'C'.repeat(40)}`],
        ['groq', `gsk_${'D'.repeat(40)}`],
        ['gemini', `AIza${'B'.repeat(35)}`],
    ];

    it.each(FAKE_KEYS)('redacts a %s key in free text and in context values', (_name, key) => {
        const text = sanitizeForLog(`Request failed: 401 Incorrect API key provided: ${key}.`);
        expect(text).not.toContain(key.slice(-12));
        expect(text).toContain('[redacted]');
        const context = JSON.stringify(sanitizeLogContext({ detail: `bad ${key}` }));
        expect(context).not.toContain(key.slice(-12));
    });

    it('leaves ordinary words that contain "sk-" alone', () => {
        expect(sanitizeForLog('task-management-system and risk-assessment-notes'))
            .toBe('task-management-system and risk-assessment-notes');
    });
```

**Verify**: `rtk bun run --filter @mindwtr/core test -- log-sanitize` → the `openai project`, `anthropic`, `openrouter`, `xai` and `groq` rows FAIL; `openai legacy` and `gemini` pass.

### Step 2: one wider list in `log-sanitize.ts`

Replace `AI_KEY_PATTERNS` at `:35-40` with:

```ts
// One home for provider key shapes (sync error text reuses it through sanitizeLogMessage).
// `\b` keeps words such as "task-management" from matching; the character class allows
// the `-` and `_` that current keys contain (sk-proj-…, sk-ant-api03-…, sk-or-v1-…).
const AI_KEY_PATTERNS = [
    /\bsk-[A-Za-z0-9_-]{10,}/g,
    /\bxai-[A-Za-z0-9]{20,}/g,
    /\bgsk_[A-Za-z0-9]{20,}/g,
    /\brk-[A-Za-z0-9]{10,}/g,
    /\bAIza[0-9A-Za-z\-_]{10,}/g,
];
```

**Verify**: `rtk bun run --filter @mindwtr/core test -- log-sanitize` → all pass.

### Step 3: delete the second copy

In `packages/core/src/sync-service-utils.ts` delete the `AI_KEY_PATTERNS` constant (`:81-86`) and reduce `sanitizeSyncErrorMessage` to:

```ts
export const sanitizeSyncErrorMessage = (value: string): string => (
    // One redactor and one key-pattern list: both live in log-sanitize.
    sanitizeLogMessage(value)
);
```

**Verify**: `rtk bun run --filter @mindwtr/core test -- sync-service-utils` → all pass (including `:79-86`). `rtk proxy grep -rn "AI_KEY_PATTERNS" packages/core/src` → matches only in `log-sanitize.ts`. `rtk bun run typecheck:core` → exit 0.

## Test plan

- The 7-row table and the ordinary-words case in `log-sanitize.test.ts` (Step 1). Failing first.
- `sync-service-utils.test.ts:79-86` is the regression test for Step 3; it is not edited.

## Done criteria

- [ ] `rtk bun run --filter @mindwtr/core test -- log-sanitize` passes with the new cases
- [ ] `rtk bun run --filter @mindwtr/core test -- sync-service-utils` passes unchanged
- [ ] `rtk proxy grep -rn "AI_KEY_PATTERNS" packages/core/src` matches only `log-sanitize.ts`
- [ ] `rtk bun run typecheck:core` exits 0
- [ ] `rtk git status --short` shows no files outside the in-scope list
- [ ] `rtk git diff --check` clean

## STOP conditions

- A "Current state" excerpt does not match the live code.
- Another test in `packages/core` fails because ordinary text is now redacted (run `rtk bun run --filter @mindwtr/core test -- log` to check the logging tests). Report the text that matched; do not loosen the new patterns on your own.
- You are tempted to paste a real key to "see if it works". Do not.

## Maintenance notes

- When a provider changes its key format, add one row to `FAKE_KEYS` first, watch it fail, then widen the list.
- The sanitizer still depends on key NAMES for structured fields (`apiKey`, `token`, …); that part is unchanged.
- The desktop Rust logger has its own redaction and was not reviewed here.
