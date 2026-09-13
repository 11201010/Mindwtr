# Android checklist insertion focus — September 13, 2026

The user recording showed Add Item after a cold task-editor launch jumping upward and leaving the software keyboard closed. The prior implementation already waited for the input's first layout. On the connected OnePlus CPH2655 / Android 16, the inserted input could own a caret while the IME rejected its show request at `PHASE_CLIENT_VIEW_SERVED`.

## Change

Keep first-layout ownership and defer its focus request by one animation frame on Android. Stable native ref callbacks, target/frame identity checks, and cancellation on unmount, task/field changes, row removal or replacement, and newer insertions prevent stale focus. Add Item and keyboard Next share the path. iOS retains immediate first-layout focus. No fixed timeout, retry loop, blur/refocus cycle, or scroll geometry adjustment was added.

A separate warm-path check found that the outer horizontal pager's default keyboard tap handling consumed Add Item taps before the inner form button. The pager now uses `keyboardShouldPersistTaps="handled"`, matching the form scroller. The existing pager/input-focus regression checks this setting.

The diagnostic `v1.3.0/checklist-insert-focus` proves that the deferred Android focus request ran. It does not prove keyboard visibility; that requires native observation. See the diagnostics ledger.

## Evidence

Tests used only `tech.dongdongbh.mindwtr.dev` on physical device `44882663`, with a fresh `--clear` Metro bundle from `/home/dd/worktrees/Mindwtr/reference-checklist-list`. Production data was untouched. The Dev database was backed up before adding two synthetic 16-item fixtures; existing data and completion flags were retained.

- Baseline reproduction: focused inserted input, hidden IME; repeated baseline failed the same visible-keyboard gate.
- One-frame prototype: new input focused above the visible keyboard.
- Final content-field implementation: two cold launches passed focus and visible-keyboard assertions. Four-second PNG bursts around Add Item showed the new row and IME stable, without the observed jump to unrelated fields. Sampling was roughly 250 ms, not frame-perfect video proof.
- The physical soft-keyboard Next button inserted and focused the next row with the keyboard still open. ADB hardware Enter briefly hid the IME, so it is not used as a software-keyboard persistence oracle.
- With the supplemental pager setting, a further cold run passed. One earlier run was invalidated when Android opened its Display over other apps settings before Add Item; its screenshots and failed verdict remain archived.
- Warm first-tap Add Item after the supplemental pager change passed: one new input focused above a visible IME (`warm-first-tap-verdict.json` and screenshot). Previously saved Add/Next text was visible after cold restart (`warm-before-add.xml`).
- New focus lifecycle regressions: 7 passed. ContentField/FormTab/pager suite: 51 passed. Full modal suite after the pager change: 34 passed. Mobile typecheck, scoped lint and diagnostic-field checks passed.
- Independent Sol review found no blocking source defects, including the supplemental pager setting. Direct native-ref replacement and field-only transitions are protected in code but not separate test cases.

Evidence is under `/home/dd/.cache/mindwtr-checklist-focus/`, including `baseline-repeat`, `final-cold-1`, `final-cold-2`, `final-soft-next.png`, `final-pager-cold` (invalid), `final-pager-cold-2`, component reports and fresh Metro logs. These artifacts are local, not guaranteed to survive cleanup. Review packets are in the worktree's ignored `.orchestrator/tasks/reference-checklist-20260913/`.

## Device cleanup

After Save and stopping only Dev, independent SQLite readback found all 22 items, including both final warm additions; the original 16 IDs and completion flags were intact. SQLite integrity was valid. Only the two synthetic fixtures (`checklist-focus-repro` and `reference-list-repro`) were then removed from a copy of the current database, preserving all other rows and later Dev changes. The cleaned database was returned while Dev was stopped. Evidence: `saved-readback-verdict.json`, `final-saved-db/`, and `cleaned-dev.db`. The original full backup was not restored over newer data.

This is a correctness fix, not a quantified performance improvement or completion of the broader performance audit. iOS behavior is covered by unit tests, without new physical iPhone testing. Check the actual published revision and its CI independently of this pre-commit report.
