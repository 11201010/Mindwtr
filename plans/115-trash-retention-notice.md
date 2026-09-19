# Plan 115: The Trash screen says that items are removed for good after 90 days

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report; do not improvise. Do NOT edit `plans/README.md` — the coordinator maintains the index.
>
> **Drift check (run first)**: `rtk git diff --stat 561cfdfa0..HEAD -- packages/core/src/sync.ts packages/core/src/i18n/locales apps/desktop/src/components/views/TrashView.tsx apps/desktop/src/components/views/TrashView.test.tsx "apps/mobile/app/(drawer)/trash.tsx"` — if any of these changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch treat it as a STOP condition. (If plan 111 already landed, `TrashView.tsx`, its test and `trash.tsx` will show changes in `handleClearTrash` / `handleClearAll` only; that is expected and not a STOP.)

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (touches the same three app files as plan 111; land 111 first if both are queued)
- **Category**: bug
- **Planned at**: commit `561cfdfa0`, 2026-09-19

## Why this matters

A deleted task or project sits in Trash and can be restored. But the app's clean-up rule removes every deleted record once it is older than the retention window, 90 days by default, including items the user never chose to "delete permanently". Nothing on the Trash screen says so. A user who keeps something in Trash "just in case" finds it gone with no warning. The 90-day rule is a recorded design decision and does not change. This plan adds one calm line of text on both apps' Trash screens.

## Current state

- `packages/core/src/sync-tombstones.ts:6` — `export const DEFAULT_TOMBSTONE_RETENTION_DAYS = 90;`. `:24-36` — a task or project with `deletedAt` and no `purgedAt` counts as expired once `deletedAt` is older than the cutoff; expired records are dropped when data loads.
- `packages/core/src/sync.ts:67` — `export { purgeExpiredTombstones } from './sync-tombstones';`. `packages/core/src/index.ts:42` is `export * from './sync';`. The constant is NOT re-exported yet, so apps cannot import it from `@mindwtr/core`.
- `packages/core/src/i18n/locales/en.ts:1804` and `:1811` — `'trash.emptyHint'` and `'trash.emptyHintWithProjects'`; no `trash.*` key mentions a time limit.
- Placeholder convention — `{{name}}` filled by `formatI18nTemplate` from `@mindwtr/core` (`packages/core/src/i18n/index.ts:105`). Exemplar: `en.ts:904` `'review.staleDaysInactive': '{{days}} days inactive'`, used at `apps/desktop/src/components/views/review/WeeklyReviewModal.tsx:789` as `formatI18nTemplate(t('review.staleDaysInactive'), { days: daysStale })`. Match it.
- Locale rule (`packages/core/src/i18n/locales/README.md`): a locale whose `translatedKeyFloor` is `'all'` in `packages/core/src/i18n/i18n-locales.ts` must translate every new English key, or `rtk bun run i18n:check` fails. Those locales are: `zh-Hans`, `zh-Hant`, `es`, `hu`, `uk`, `ja`, `fa`, `sv`, `da`. All other locales fall back to English; do not add the key there.
- Desktop, `apps/desktop/src/components/views/TrashView.tsx:304-327` — the `<header>` with the title, the counts line (`:307-309`, class `text-sm text-muted-foreground`) and the buttons. `trashedItemCount` is the number of shown items.
- Mobile, `apps/mobile/app/(drawer)/trash.tsx:438-464` — `{trashItems.length > 0 && (<View style={styles.summaryRow}> ... </View>)}`; `:589-592` — `summaryText: { fontSize: 13, fontWeight: '500' }`; colours come from `tc` (`tc.secondaryText` is the muted text colour).
- Test to extend: `apps/desktop/src/components/views/TrashView.test.tsx` (renders `<LanguageProvider><TrashView /></LanguageProvider>` with one trashed task and one trashed project; English strings are asserted literally, e.g. `'Delete Permanently'`).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Locale check | `rtk bun run i18n:check` | exit 0 |
| Core i18n tests | `rtk bun run --filter @mindwtr/core test -- src/i18n` | pass |
| Desktop test | `cd apps/desktop && rtk bun run test -- TrashView.test.tsx` | pass |
| Mobile key test | `rtk bun run --filter mobile test -- i18n-missing-keys` | pass |
| Typecheck | `rtk bun run typecheck:core && rtk bun run typecheck:desktop && rtk bun run typecheck:mobile` | exit 0 |
| Whitespace | `rtk git diff --check` | no output |

## Scope

**In scope** (the only files you may modify):
- `packages/core/src/sync.ts` (the re-export line only)
- `packages/core/src/i18n/locales/en.ts`, `zh-Hans.ts`, `zh-Hant.ts`, `es.ts`, `hu.ts`, `uk.ts`, `ja.ts`, `fa.ts`, `sv.ts`, `da.ts`
- any file that `rtk bun run scripts/i18n-locale-parity.ts --fix` regenerates (only if `i18n:check` asks for it)
- `apps/desktop/src/components/views/TrashView.tsx`, `apps/desktop/src/components/views/TrashView.test.tsx`
- `apps/mobile/app/(drawer)/trash.tsx`

**Out of scope** (do NOT touch):
- `packages/core/src/sync-tombstones.ts` and every clean-up rule — the 90 days stay.
- Other locale files. No warning colours, icons, banners or dismiss buttons — one muted line of text.
- Public docs (plan 116 owns them); `plans/README.md`.

## Git workflow

- One commit, message: `feat(trash): say when trashed items are removed for good`. Repo style is `type(scope): imperative summary`; no tooling mentions; do not push.

## Steps

### Step 1: red desktop test

In `TrashView.test.tsx` add:

```ts
it('says how long trashed items are kept', () => {
    render(<LanguageProvider><TrashView /></LanguageProvider>);
    expect(screen.getByText('Items in Trash are removed for good after 90 days')).toBeInTheDocument();
});
```

**Verify**: `cd apps/desktop && rtk bun run test -- TrashView.test.tsx` → the new test FAILS.

### Step 2: the key and its translations

Add the key directly after `'trash.emptyHintWithProjects'` in each file, in that file's own quote and indent style (`es.ts` is unindented with double quotes; `uk.ts` uses double-quoted keys near that line; do not reformat anything else):

| File | Value |
|---|---|
| `en.ts` | `Items in Trash are removed for good after {{days}} days` |
| `zh-Hans.ts` | `垃圾桶中的项目会在 {{days}} 天后永久移除` |
| `zh-Hant.ts` | `垃圾桶中的項目會在 {{days}} 天後永久移除` |
| `es.ts` | `Los elementos de la Papelera se eliminan definitivamente después de {{days}} días` |
| `hu.ts` | `A Kukában lévő elemek {{days}} nap után véglegesen törlődnek` |
| `uk.ts` | `Елементи у смітті остаточно видаляються через {{days}} днів` |
| `ja.ts` | `ゴミ箱の項目は{{days}}日後に完全に削除されます` |
| `fa.ts` | `موارد زباله‌دان پس از {{days}} روز برای همیشه حذف می‌شوند` |
| `sv.ts` | `Objekt i papperskorgen tas bort permanent efter {{days}} dagar` |
| `da.ts` | `Elementer i papirkurven fjernes permanent efter {{days}} dage` |

The key name is `trash.retentionHint`.

**Verify**: `rtk bun run i18n:check` → exit 0. If it reports generated-file drift, run `rtk bun run scripts/i18n-locale-parity.ts --fix` once and re-run the check. `rtk bun run --filter @mindwtr/core test -- src/i18n` → pass.

### Step 3: export the number

In `packages/core/src/sync.ts:67` change the line to `export { DEFAULT_TOMBSTONE_RETENTION_DAYS, purgeExpiredTombstones } from './sync-tombstones';`.

**Verify**: `rtk bun run typecheck:core` → exit 0.

### Step 4: show it on desktop

In `TrashView.tsx` import `DEFAULT_TOMBSTONE_RETENTION_DAYS` and `formatI18nTemplate` from `@mindwtr/core`, and directly after the closing `</header>` (`:327`) add:

```tsx
{trashedItemCount > 0 && (
    <p className="text-sm text-muted-foreground">
        {formatI18nTemplate(t('trash.retentionHint'), { days: DEFAULT_TOMBSTONE_RETENTION_DAYS })}
    </p>
)}
```

**Verify**: Step 1 command → passes. `rtk bun run typecheck:desktop` → exit 0.

### Step 5: show it on mobile

In `apps/mobile/app/(drawer)/trash.tsx` add the two names to the `@mindwtr/core` import on line 2. Directly after the `summaryRow` block (after `:464`, still outside `selectionMode`) add:

```tsx
{trashItems.length > 0 && (
  <Text style={[styles.retentionHint, { color: tc.secondaryText }]}>
    {formatI18nTemplate(tFallback(t, 'trash.retentionHint', 'Items in Trash are removed for good after {{days}} days'), { days: DEFAULT_TOMBSTONE_RETENTION_DAYS })}
  </Text>
)}
```

and in the `StyleSheet.create` block, after `summaryText`: `retentionHint: { fontSize: 12, paddingHorizontal: 16, paddingTop: 4 },`.

**Verify**: `rtk bun run typecheck:mobile` → exit 0; `rtk bun run --filter mobile test -- i18n-missing-keys` → pass; `rtk git diff --check` → no output.

## Test plan

- Desktop: the Step 1 case (model: the other cases in `TrashView.test.tsx`). It proves the key resolves and the number comes through.
- Locale gate: `i18n:check` plus the core `src/i18n` tests prove every required locale has the key and keeps the `{{days}}` placeholder.
- Mobile: no Trash screen test exists; typecheck plus the mobile missing-keys test cover it.

## Done criteria

- [ ] `rtk bun run i18n:check` exits 0; core `src/i18n` tests pass
- [ ] `cd apps/desktop && rtk bun run test -- TrashView.test.tsx` passes with the new test
- [ ] all three typechecks exit 0
- [ ] `rtk proxy grep -rn "trash.retentionHint" packages/core/src/i18n/locales | wc -l` prints `10`
- [ ] `rtk proxy grep -rn "90" apps/desktop/src/components/views/TrashView.tsx "apps/mobile/app/(drawer)/trash.tsx"` shows no hardcoded day count
- [ ] `rtk git status --short` lists only in-scope files; `rtk git diff --check` is clean

## STOP conditions

- A "Current state" excerpt does not match the live code.
- `i18n:check` still fails after Step 2 for a reason other than the new key (report its output).
- A locale-quality check rejects one of the translations in the table (report which; do not invent a replacement).
- `DEFAULT_TOMBSTONE_RETENTION_DAYS` is already exported under another path, or the export causes a duplicate-name error in `index.ts`.
- A verification fails twice after a reasonable fix attempt.

## Maintenance notes

- Sync can run with a custom retention (`io.tombstoneRetentionDays` in `packages/core/src/sync.ts`); the load-time clean-up uses the default. If a user-facing retention setting is ever added, the notice must read that value instead of the constant.
- The translations were written without a native review; a native reader should glance at them in the release pass.
- Reviewer: the line must stay muted text. No warning colour.
