# Neutral Inbox decisions — September 13, 2026

Issue: [#1208](https://github.com/dongdongbh/Mindwtr/issues/1208). Base: `1efb5655d`, including the #1207 callback correction.

## Decision

Competing answers to an Inbox clarification question have no universally preferred outcome. Give those answers equal neutral visual emphasis. This applies the visual hierarchy principle in [Apple’s button guidance](https://developer.apple.com/design/human-interface-guidelines/buttons): prominence communicates a preferred action. Next, File it, project creation and other confirmations remain distinct after the choice; destructive Trash and actual selected states remain recognizable.

Mobile Quick/actionable decisions share neutral choice controls, and two-answer steps have matching full-width stacked buttons. Compact choices keep stable column widths even with an odd final item. Large text uses a single column to keep labels readable. Desktop guided actionable, project-check, two-minute and do/delegate pairs use the same neutral style and visible keyboard focus. Desktop Quick already distinguishes real selections from unselected choices and does not need changing. No labels, handlers, persistence rules, or step order changed. No new preference was added.

## Validation

- Mobile Inbox processing component suite: 90 tests passed; desktop Inbox processing panels: 19 passed. Both platform typechecks, scoped lint and whitespace checks passed.
- Independent Sol review identified the odd final tile expanding to full width and mixed-line buttons not filling equal-height cells. Both were corrected. Physical large-text checks then motivated stacking compact choices to avoid a one-letter wrap.
- Chromium: light/dark/sepia at 1280×800 and 800×800, six complete guided flows passed. All four question pairs had equal resting computed colors, typography, padding and rendered geometry, with targets at least 48 px and visible Tab focus. Actual choices persisted the task as a Next action in the selected project. The 24 screenshots and disposable harness are retained under `.orchestrator/tasks/issue-1208/browser/`; harness-only hover timing and accessible-name corrections are recorded in its acceptance report.
- Physical OnePlus CPH2655 / Android 16, separate Mindwtr Dev package, installed native version 1.3.0-rc.2 with a fresh Metro bundle from the dedicated worktree. Inspected Quick/actionable choices and two-minute questions in light, dark and sepia; exercised the guided execution/project-check steps through File it without filing the task. Confirmed selected-area/project styling and primary File it still render distinctly. Android geometry showed equal 465 px widths for default compact choices (including an odd final Reference tile), and equal 960×156 px two-answer controls at default font scale (3 px/dp).
- At Android font scale 1.5, all compact choices use full-width single-column controls with complete labels; scrolling reaches Trash. Guided two-minute buttons measured the same 960×170 px and labels remained readable. The earlier mixed-line Reference wrap and intermediate geometry are retained as failed visual evidence; final screenshots end in `-final`. A cold JS reload was used after Android recreated the activity for the font-scale change. One uiautomator dump timed out; a direct screenshot confirmed the state and subsequent dumps worked. Device evidence is under `/home/dd/.cache/mindwtr-checklist-focus/issue-1208-*`.
- Restored original Android font scale 1.0, Dark theme, Quick mode, and the original Inbox processing switches (two-minute off, early project off, Contexts/Tags off, scheduling on). Switch states were compared against the saved original XML. Stopped the Dev app and task-owned Metro, removed its ADB reverse, and left production untouched. The browser server was separately stopped. No live sync was attempted.
- Final independent closure review approved the fixed widths, filled row heights, and large-text single column. No substantive findings remain.

This is a visible UI correction; no diagnostic marker or public docs change is needed. It is not a measured performance improvement. No release or tag is authorized.
