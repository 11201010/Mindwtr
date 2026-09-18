# UI simplification compatibility contract

The desktop and mobile cleanup reduces the number of decisions shown at once.
It does not change task storage, synchronization, or lifecycle rules.

## Navigation and history

- History is one navigation destination with separate **Done** and **Archived**
  tabs. The old Done and Archived routes continue opening the matching tab.
- Completing, auto-archiving, reopening, and restoring tasks retain their
  existing behavior. Trash is separate from History, with its existing
  retention policy. Archived tasks do not gain an expiry date.
- Desktop Board and Reference remain reachable from secondary navigation;
  Contexts stays under Organize. Mobile Menu uses a three-column, two-row grid
  for Waiting, Review, Someday, Calendar, Contexts, and Reference, with History,
  Trash, Board, and Settings as smaller shortcuts. Context filtering remains
  available within task lists.
- Mobile Menu rows are Waiting / Someday / Review and
  Reference / Contexts / Calendar, placing Review and Calendar on the right;
  the smaller shortcuts run Trash, Board, History, Settings from left to right.
  Explicit bottom-tab quick-access choices remain honored, with Projects
  replacing that destination in the Menu to avoid duplication.
  The bottom sheet has an opaque edge where it meets the tab bar; underlying
  list content must not show through that seam.
- Existing explicitly selected navigation preferences are preserved.
- Desktop History aligns the Done/Archived tabs with the current list toolbar
  in one wrapping top row. Controls retain their list-owned behavior and focus
  handling; standalone list headers remain unchanged.
- Timeline remains an optional desktop feature, including its setting and
  route. It is not retired by this cleanup.

## Task actions and presentation

- Dates groups Start, Due, and Review without changing date-only or reminder
  semantics. Relevant review actions remain available.
- Move to and the editor's Destination picker present Projects and Areas as
  two groups in one choice. They retain the existing mutually exclusive
  container contract; project sections only apply within their own project.
- Project and section conversion remain available in task details. Reference
  remains a status choice without a duplicate main action.
- Desktop exposes presentation controls directly. Active filtering stays visible;
  structural list operations live in overflow.
  Desktop keeps its frequently used Details toggle directly on the toolbar;
  Sort and Group are directly accessible on the top toolbar, including Focus,
  without a View options wrapper. A toolbar with only Sort, such as Projects,
  exposes only Sort. Controls wrap at narrow window widths. Density
  is controlled only in global appearance settings and applies across views;
  existing density preferences remain intact.
  Contexts also has a direct Details toggle. Reference omits this redundant
  toggle because its description preview and metadata already remain visible.
  Sort does not belong in Filters.
- Mobile Focus keeps its Focus only / Expand sections toggle directly on the
  page, alongside Filters and View options; Sort, Group, and Details remain
  in View options. Other mobile lists consolidate their existing controls
  into a single overflow menu, with Filters, Sort, Group, and Details directly
  in that menu where supported, without a nested View options step. Inbox
  keeps direct Sort, Group, and Filters buttons: 32dp circular visuals with
  16dp icons inside 44dp touch targets. Mind Sweep and Process Inbox remain
  direct. Inbox avoids stacking extra local padding beneath Process Inbox;
  the list's 12dp top inset separates it from the retained area summary. Active
  filters retain a visible, tappable indicator. Unsupported controls are not
  added just for symmetry. Someday's New section action lives in overflow.
  On pages with a navigation header, overflow belongs at the top-right rather
  than occupying an otherwise empty toolbar row.
- Desktop Sort and Group each indicate when they differ from that page's own
  default. Density and Details do not affect their highlighting.
  Active filters retain their separate visible indication.
- Collapsed rows prioritize the title, dates, project, and contexts. Secondary
  metadata remains in details; existing values are not removed or rewritten.
- Task opening, double-click editing, rename, and the mobile Edit/Preview
  preference are intentionally unchanged.

## Mobile filters

- The filter overview shows category summaries instead of every option at once.
  Contexts/tags and projects have searchable pickers within the same sheet;
  their search fields only narrow choices, not the task list's search query.
- Time and energy expand inline. Less common priority and location controls
  live under More filters, respecting the existing metadata visibility rules.
- Active criteria remain visible and removable, including criteria hidden
  inside collapsed categories. Clear retains its existing meaning.
- Filtering remains live; Done closes the sheet. Back from a picker returns
  to the overview without resetting selections. Token exclusions, Any/All
  matching, saved filters, and persisted preferences keep their semantics.
- Someday exposes Filters, Sort, Group, and Details directly alongside
  New section. Its default section grouping and order are unchanged; choosing
  a presentation option never reassigns tasks to sections or projects.
- Projects uses a direct Tag filter Show/Hide disclosure. Collapsing preserves
  the selected tag and names it in the disclosure; All tags clears it.
  Mobile project rows omit anonymous tag dots, without removing tags or tag
  filtering. Their one-line next-action preview remains available.
- Contexts uses one horizontally scrolling row for All, No context, contexts,
  and tags. Counts, selection, search, and conditional Any/All matching remain.
- Board keeps Search and Filters side by side with a clear gap, wrapping when
  needed for available width or text size. Its filter sheet uses the same
  compact category pickers; Due date is a disclosure, not a wall of presets.
  Due-date, project, token, and title-search predicates retain their semantics.

## Desktop filters

- Filter categories expand inline, one at a time, with compact summaries.
  Long context/tag and project lists have their own option search, separate
  from task search. Focus labels its title-only task search explicitly.
- The Projects Tag filter and Waiting For person selector use quiet, transparent
  native controls with subtle borders. Local appearance styling avoids the
  platform's heavy filled chrome; keyboard focus and selected values stay clear.
- Removing an active chip clears that criterion; it does not turn an included
  token into an exclusion. Tri-state selection remains available in the picker.
- Active criteria remain removable when categories are collapsed. Closing the
  filter panel returns keyboard focus to its toolbar trigger.

## Projects

- Mobile rows keep a one-line next-task preview beneath the title. A smaller
  trailing focus star has its own 44dp target, with a plain task count beside
  it. Focus uses the star, not an additional yellow card outline. Area headings
  use their chosen icon, falling back to a color dot only when no icon exists.
  Row opening, focus limits, swipe actions, and area collapse remain unchanged.
- Desktop's project sidebar is a project switcher, not a second task list:
  it omits next-task previews while retaining counts and no-next-action warnings.
  All project states share title alignment. Focused stars remain visible beside
  counts; only the selected project has a highlighted row. Idle drag/focus
  controls remain available on hover, keyboard focus, and no-hover devices.
- New project is a compact, labelled sidebar header action. Its inline input
  supports Enter/Escape and retains an unsubmitted draft when dismissed.
- The desktop project header prioritizes title, status, area, due date, and
  completion count. Details is a direct toggle; project lifecycle operations
  remain in overflow. Notes/attachments have their own disclosure.
- Add task and Sort stay direct. Less frequent structural and layout actions are in
  overflow. Section headers retain disclosure, name, count, and Add task;
  move, notes, rename, and delete remain available in the section menu.
- This organization does not change project/task data, completion preferences,
  drag-and-drop ordering, or archived-project read-only rules. Mobile retains
  its next-action preview because project tasks open on a separate screen.

## Settings

- AI and Integrations remain top-level desktop settings destinations; desktop
  space makes direct navigation preferable to nested pages. Mobile keeps them
  under Advanced. Existing settings-page identifiers and direct links still work.
- Regional overrides are grouped under Regional formats. Desktop keyboard
  mode, shortcut reference, and window behavior move together to Advanced;
  language, accessibility, quick capture, and sync remain easy to reach.
- Language pickers and selected-language summaries show native names without
  translation-coverage suffixes. Translation coverage checks and English
  fallback behavior are unchanged.
- The time-estimate preset-list editor is retired. Quick picks and Custom
  duration input remain. Previously saved preset lists continue to be read;
  no persisted preset values or task estimates are discarded.

## Verification

Cover both the normal UI and upgrade fixtures: old routes, saved navigation
choices, existing date and container data, custom estimate presets, enabled
Timeline, and separate Done/Archived/Trash contents. Use component tests for
keyboard/accessibility and draft cancellation, browser tests for navigation
and reload, and mobile device checks for sheets and touch layouts.
