# Plan 116: The public user guide describes the 1.3.1 screens (History, density, key preset path, Trash time limit)

> **Executor instructions**: This plan edits a DIFFERENT repository: the public docs site `/home/dd/code/mindwtr-web` (branch `agent/docs-20260918`, checked out at `/home/dd/worktrees/mindwtr-web/docs-20260918`). Work only there. Follow the plan step by step, run every verification, and stop on any STOP condition; do not improvise. Do NOT edit `plans/README.md` in the app repository — the coordinator maintains the index.
>
> **Drift check (run first)**: `rtk git -C /home/dd/worktrees/mindwtr-web/docs-20260918 diff --stat e76e49b..HEAD -- docs/use docs/start docs/de docs/es docs/fr docs/zh-Hans docs/zh-Hant` — if `desktop.md`, `mobile.md` or `faq.md` changed since this plan was written, compare the "Current state" excerpts against the live text first; on a mismatch treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/113-sidebar-drop-onto-history.md (edit E2 only)
- **Category**: docs
- **Planned at**: docs repo commit `e76e49b` (branch `agent/docs-20260918`), app repo commit `561cfdfa0`, 2026-09-19

## Why this matters

App version 1.3.1 changed several screens, and the public guide still describes the old ones. It never mentions **History**, the one entry that now holds the Done and Archived tabs on both apps. It says list density is switched in the list toolbar; that button was removed and the choice lives in Settings. It lists the key preset and "Launch at Startup" under Settings → General; they moved to Advanced. It says a task can be dragged onto Done or Archived in the sidebar; those entries no longer exist. And it never says that items left in Trash are removed for good after 90 days. A reader who follows the guide looks for controls that are not there.

## Current state

Facts from the app (repo `/home/dd/worktrees/Mindwtr/integrate-20260918`, commit `561cfdfa0`), so you do not need to read app code:

- Desktop sidebar group **More** contains Reference, Board, **History**, Trash (`apps/desktop/src/components/Layout.tsx:366-390`). History has two tabs, **Done** and **Archived** (`apps/desktop/src/components/views/HistoryView.tsx:26-29`). The mobile menu has one **History** entry with the same two tabs (`apps/mobile/app/(drawer)/(tabs)/_layout.tsx:358`, `apps/mobile/app/(drawer)/history.tsx:20-23`).
- The list toolbar has Filters, Select, Sort, Group and Show details; no density button (`apps/desktop/src/components/views/list/ListHeader.tsx:127-200`). Density is at Settings → General → Density (`.../settings/SettingsMainPage.tsx:279`); the shortcut `Ctrl+Shift+C` / `Cmd+Shift+C` still cycles it (`apps/desktop/src/components/KeybindingHelpModal.tsx:46`).
- Key preset, window decorations, close behaviour, tray icon and launch at startup are in Settings → Advanced → **Keyboard and window**, a folded card (`.../settings/SettingsAdvancedPage.tsx:75-145`).
- After plan 113: dropping a task on **History** marks it done; holding a dragged task over a folded sidebar group's header opens the group.
- Deleted items older than 90 days are removed for good (`packages/core/src/sync-tombstones.ts:6`).

Docs files (English paths; each has a copy under `docs/de`, `docs/es`, `docs/fr`, `docs/zh-Hans`, `docs/zh-Hant`):

- `docs/use/desktop.md:21` — "...for selecting tasks, filtering, sorting, grouping, showing details, and switching list density (Comfortable, Compact, or Condensed). Use **Group** to ..."
- `docs/use/desktop.md:25` — "Drag a task onto **Inbox**, **Someday/Maybe**, **Waiting For**, **Reference**, **Done**, or **Archived** in the sidebar to change its status; the toast offers **Undo**. **Trash** is not a drop target. ..."
- `docs/use/desktop.md:180` — heading `### ✅ Done`; `:188` — `### 📦 Archived`; `:196-198` — `### 🗑️ Trash` and its paragraph "Deleted tasks and projects, newest first. ... Permanent deletion always asks for confirmation."
- `docs/use/desktop.md:544` — "Mindwtr supports **Standard** (Gmail/Todoist-style), **Vim**, and **Emacs** keybinding presets. Change in Settings."
- `docs/use/desktop.md:579-585` — `### General` list, which contains `- **Keyboard Shortcuts**: Standard, Vim, or Emacs preset` and `- **Launch at Startup**: Start Mindwtr automatically when you sign in`. The next headings are `### Notifications` (`:587`), `### GTD`, `### Data & Sync`, `### About` (`:640`). There is no `### Advanced` heading.
- `docs/use/mobile.md:56-57` — menu bullets `- ✅ **Done**: Recently completed tasks` and `- 📦 **Archived**: Completed tasks and projects filed away from normal lists`; `:61` — "Open **Done** and tap **Select** ..."; `:67` — "Open **Trash** and tap **Select** ... Permanent deletion always asks for confirmation."
- `docs/start/faq.md:250` — "... stay visible in the Done view, ..."; `:252` — "... remain available in the Archived view for search, restore, or permanent deletion. ..."

Line numbers are the same in most translated copies but not all. Find each spot with these anchors, run once per language folder `L` in `de es fr zh-Hans zh-Hant`:
`rtk proxy grep -n "^### ✅\|^### 📦\|^### 🗑️\|Vim\*\*\|✅ \*\*\|📦 \*\*" docs/$L/use/desktop.md docs/$L/use/mobile.md`; the density sentence is line 21 and the drag sentence line 25 of every `desktop.md`; the FAQ answer sits under the heading about the difference between Done and Archived.

Convention to match: commit `c3f443c docs: add Danish to the translated language lists` — one commit, the same edit in all six languages, the surrounding sentence style kept. UI names in a translated page must be the app's own words. Use this table (from the app's locale files) verbatim:

| English | de | es | fr | zh-Hans | zh-Hant |
|---|---|---|---|---|---|
| History | Verlauf | Historial | Historique | 历史记录 | 歷史記錄 |
| More | Mehr | Más | Plus | 更多 | 更多 |
| Settings | Einstellungen | Ajustes | Paramètres | 设置 | 設置 |
| General | Allgemein | General | Général | 通用 | 通用 |
| Advanced | Erweitert | Avanzado | Avancé | 高级 | 進階 |
| Keyboard and window | Tastatur und Fenster | Teclado y ventana | Clavier et fenêtre | 键盘与窗口 | 鍵盤與視窗 |
| Density | Dichte | Densidad | Densité | 密度 | 密度 |

For Done, Archived and Trash keep the word each translated page already uses (for example `docs/es` says **Terminadas** / **Archivadas**); do not swap them.

## Commands you will need

| Purpose | Command (run in `/home/dd/worktrees/mindwtr-web/docs-20260918`) | Expected |
|---|---|---|
| Full check | `rtk bun run check` | exit 0 |
| Whitespace | `rtk git diff --check` | no output |
| Plan 113 landed? | `rtk git -C /home/dd/worktrees/Mindwtr/integrate-20260918 log --oneline --grep "History sidebar entry"` | one commit |

## Scope

**In scope** (the only files you may modify, in the docs repo):
- `docs/use/desktop.md`, `docs/use/mobile.md`, `docs/start/faq.md`
- the same three files under `docs/de/`, `docs/es/`, `docs/fr/`, `docs/zh-Hans/`, `docs/zh-Hant/`

**Out of scope** (do NOT touch):
- Anything in the app repository, including its `docs/` folder and `plans/README.md`.
- Screenshots, the landing site, `docs/data-sync/*`, `docs/use/keyboard-shortcuts.md`.
- Rewriting the Done / Archived sections: they stay, because Done and Archived are still the tab names.

## Git workflow

- Branch: stay on `agent/docs-20260918`. One commit: `docs: describe History, the density setting and the moved keyboard settings`. No tooling mentions; do not push.

## Steps

Do each edit in English first, then make the same edit in the five translated copies, translating the new English words in the style of the sentence around them and using the glossary terms.

### E1: density (`desktop.md` line 21)

Replace `grouping, showing details, and switching list density (Comfortable, Compact, or Condensed).` with `grouping, and showing details. List density (Comfortable, Compact, or Condensed) is set in **Settings → General → Density**, or cycled with \`Ctrl+Shift+C\` / \`Cmd+Shift+C\`.`

**Verify**: `rtk proxy grep -c "Settings → General → Density" docs/use/desktop.md` → `1`.

### E2: drag sentence (`desktop.md` line 25) — only if plan 113 landed

Run the "Plan 113 landed?" command. If it prints no commit, skip E2 and say so in your report. Otherwise replace the first two sentences with: `Drag a task onto **Inbox**, **Someday/Maybe**, **Waiting For**, **Reference**, or **History** in the sidebar to change its status; dropping it on **History** marks it done, and the toast offers **Undo**. Hold the task over a folded sidebar group such as **More** to open it while you drag. **Trash** is not a drop target.` Leave the Calendar sentences that follow unchanged.

**Verify**: `rtk proxy grep -c "or \*\*Archived\*\* in the sidebar" docs/use/desktop.md` → `0`.

### E3: name History (`desktop.md`, `mobile.md`, `faq.md`)

- `desktop.md`: insert one paragraph plus a blank line directly above `### ✅ Done`: `**Done** and **Archived** are the two tabs of **History**, in the sidebar's **More** group.`
- `mobile.md`: replace the two menu bullets (`:56-57`) with one bullet in the same indent as the Trash bullet below them: ` - 🕘 **History**: Done and Archived tabs — completed tasks, and tasks and projects filed away`. In `:61` change `Open **Done** and tap` to `Open **History**, stay on the **Done** tab, and tap`.
- `faq.md`: `in the Done view` → `in **History → Done**`; `in the Archived view` → `in **History → Archived**`.

**Verify**: `rtk proxy grep -c "History" docs/use/desktop.md docs/use/mobile.md docs/start/faq.md` → every file ≥ 1.

### E4: moved settings (`desktop.md`)

- In `### General` delete the `**Keyboard Shortcuts**` and `**Launch at Startup**` bullets and add after the `**Font**` bullet: `- **Density**: Comfortable, Compact, or Condensed list rows`.
- Directly above `### About` add:
  ```md
  ### Advanced
  - **Keyboard and window**: keyboard shortcut preset (Standard, Vim, or Emacs), window decorations, close behaviour, tray icon, and **Launch at Startup**. Click the card to open it.

  ```
- Line 544: replace `Change in Settings.` with `Change it in **Settings → Advanced → Keyboard and window**.`

**Verify**: `rtk proxy grep -n "^### Advanced" docs/use/desktop.md` → one line; `rtk proxy grep -c "Change in Settings\." docs/use/desktop.md` → `0`.

### E5: Trash time limit (`desktop.md` Trash paragraph, `mobile.md` Trash paragraph)

Append to each paragraph: ` Items left in Trash are removed for good after 90 days.`

**Verify**: `rtk proxy grep -c "after 90 days" docs/use/desktop.md docs/use/mobile.md` → `1` each.

### Final check

For each language folder `L`: `rtk proxy grep -c "<that language's word for History>" docs/$L/use/desktop.md docs/$L/use/mobile.md docs/$L/start/faq.md` → every file ≥ 1. Then `rtk bun run check` → exit 0, and `rtk git diff --check` → no output. `rtk git status --short` → at most 18 files, all in scope.

## Test plan

Docs have no unit tests. The gates are the grep checks after each edit and `rtk bun run check` (it builds the docs site and fails on broken links or bad front matter).

## Done criteria

- [ ] every Verify above holds for English, and the History grep holds for all five translated folders
- [ ] `rtk proxy grep -rn "switching list density" docs/use/desktop.md` returns nothing
- [ ] `rtk bun run check` exits 0; `rtk git diff --check` is clean
- [ ] `rtk git status --short` lists only in-scope files; one commit with the message above

## STOP conditions

- An English excerpt in "Current state" does not match the live file.
- A translated copy lacks the sentence to edit (the page was never translated that far) — skip that spot, list it in your report, do not write a new section for it.
- You are not confident a translated sentence is correct in that language — leave the English sentence in place at that spot and list it in your report rather than guess.
- `rtk bun run check` fails twice after a reasonable fix attempt.

## Maintenance notes

- E2 describes behaviour that plan 113 adds; if 113 is rejected, E2 must instead just drop **Done** and **Archived** from the list of drop targets.
- The "90 days" in E5 repeats `DEFAULT_TOMBSTONE_RETENTION_DAYS`; if that number changes, these two sentences change too.
- A native reader should glance at the five translated edits before publishing.
