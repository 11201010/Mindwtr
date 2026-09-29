import XCTest

final class FoundationUITests: XCTestCase {
    override func setUpWithError() throws {
        try super.setUpWithError()
        continueAfterFailure = false
    }

    override func tearDownWithError() throws {
        if (testRun?.failureCount ?? 0) > 0 {
            let attachment = XCTAttachment(screenshot: XCUIApplication().screenshot())
            attachment.name = "Failure UI"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
        try super.tearDownWithError()
    }

    /// Root stages this isolated 103-item fixture; the first and last legacy IDs repeat.
    func testPagedChecklistGlobalIndexesSaveAndRestart() throws {
        let app = XCUIApplication()
        let library = "df4c1bdd-13ca-44e7-b660-e510bb5d0732"
        app.launchArguments = ["--native-ui-test-library", library]
        print("Paged checklist isolated library: " + library)
        app.launch()
        boardEnabled(app.buttons["capture-open"], timeout: 30)
        let task = app.buttons["Paged checklist fixture"]
        guard task.waitForExistence(timeout: 5) else {
            throw XCTSkip("Requires the isolated 103-item checklist fixture")
        }
        task.tap()
        let scroll = app.scrollViews["task-editor-scroll"]
        func row(_ index: Int) -> XCUIElement { app.buttons["task-view-checklist-toggle-\(index)"] }
        func loadThrough(_ index: Int) {
            revealPagedElement(app, row(index), in: scroll, more: "task-view-more", ready: app.buttons["task-view-close"])
        }
        loadThrough(0)
        XCTAssertNotEqual(row(0).value as? String, "Done")
        loadThrough(50)
        XCTAssertEqual(row(50).label, "Paged action 050")
        boardTap(app, row(50).identifier)
        boardEnabled(app.buttons["task-view-close"])
        XCTAssertEqual(row(50).value as? String, "Done")
        loadThrough(102)
        XCTAssertEqual(row(102).label, "Paged action 102")
        boardTap(app, row(102).identifier)
        boardEnabled(app.buttons["task-view-close"])
        XCTAssertEqual(row(102).value as? String, "Done")
        XCTAssertFalse(app.buttons["task-view-more"].exists)
        boardTap(app, "task-editor-save")
        boardEnabled(task)
        app.terminate(); app.launch()
        boardEnabled(task, timeout: 30)
        task.tap()
        loadThrough(0)
        XCTAssertNotEqual(row(0).value as? String, "Done", "Repeated legacy IDs must not redirect the last toggle to the first item")
        loadThrough(50)
        XCTAssertEqual(row(50).value as? String, "Done")
        loadThrough(102)
        XCTAssertEqual(row(102).value as? String, "Done")
        boardTap(app, "task-view-close")
        XCTAssertFalse(app.buttons["task-editor-discard"].exists)
        boardEnabled(task)
    }

    func testReferenceChecklistUsesBulletsAndPersists() {
        let app = XCUIApplication()
        let library = UUID().uuidString.lowercased()
        app.launchArguments = ["--native-ui-test-library", library]
        print("Reference checklist isolated library: " + library)
        app.launch()
        boardEnabled(app.buttons["capture-open"], timeout: 30)
        boardTap(app, "capture-open")
        app.textViews["capture-input"].typeText("Reference checklist")
        boardTap(app, "capture-save")
        func openReference() {
            boardTap(app, "tab-menu")
            boardTap(app, "menu-reference")
            boardEnabled(app.buttons["Reference checklist"])
            app.buttons["Reference checklist"].tap()
        }
        // RN reveals Reference checklists only when they already contain items.
        // Create the checklist in Inbox, then file that task as Reference.
        boardEnabled(app.buttons["Reference checklist"])
        app.buttons["Reference checklist"].tap()
        boardTap(app, "task-mode-edit")
        let scroll = app.scrollViews["task-editor-scroll"]
        func editorTap(_ id: String) {
            revealPagedElement(app, app.buttons[id], in: scroll)
            boardTap(app, id)
        }
        func showChecklist() {
            if !app.buttons["task-checklist-add"].exists { editorTap("task-editor-section-details") }
            revealPagedElement(app, app.buttons["task-checklist-add"], in: scroll)
        }
        showChecklist()
        editorTap("task-checklist-add")
        boardEnabled(app.textFields["task-checklist-input-0"])
        app.typeText("Reference first\n")
        boardEnabled(app.textFields["task-checklist-input-1"])
        app.typeText("Reference second")
        boardTap(app, "task-editor-save")
        boardEnabled(app.buttons["inbox-process-primary"])
        boardTap(app, "inbox-process-primary")
        let reference = app.buttons["process-inbox-choice-reference"]
        revealPagedElement(app, reference, in: app.scrollViews["process-inbox-scroll"])
        boardTap(app, "process-inbox-choice-reference")
        boardEnabled(app.buttons["process-inbox-close"])
        boardTap(app, "process-inbox-close")
        openReference()
        boardTap(app, "task-mode-edit")
        showChecklist()
        XCTAssertFalse(app.buttons["task-checklist-toggle-0"].exists)
        XCTAssertFalse(app.buttons["task-checklist-toggle-1"].exists)
        XCTAssertFalse(app.buttons["task-checklist-reset"].exists)
        boardTap(app, "task-mode-view")
        XCTAssertFalse(app.buttons["task-view-checklist-toggle-0"].exists)
        XCTAssertFalse(app.textFields["task-view-checklist-append"].exists)
        boardTap(app, "task-mode-edit")
        showChecklist()
        editorTap("task-checklist-add")
        boardEnabled(app.textFields["task-checklist-input-2"])
        app.typeText("Reference third")
        boardEnabled(app.buttons["task-editor-save"])
        boardTap(app, "task-editor-save")
        app.terminate(); app.launch()
        boardEnabled(app.buttons["tab-menu"], timeout: 30)
        openReference()
        XCTAssertFalse(app.buttons["task-view-checklist-toggle-0"].exists)
        boardTap(app, "task-mode-edit")
        showChecklist()
        for (index, expected) in ["Reference first", "Reference second", "Reference third"].enumerated() {
            let field = app.textFields["task-checklist-input-\(index)"]
            revealPagedElement(app, field, in: scroll)
            XCTAssertEqual(field.value as? String, expected)
            XCTAssertFalse(app.buttons["task-checklist-toggle-\(index)"].exists)
        }
        XCTAssertFalse(app.buttons["task-checklist-reset"].exists)
        boardTap(app, "task-view-close")
        XCTAssertFalse(app.buttons["task-editor-discard"].exists)
        boardEnabled(app.buttons["Reference checklist"])
    }

    func testChecklistFormViewSaveResetAndDiscard() {
        let app = XCUIApplication()
        let library = UUID().uuidString.lowercased()
        app.launchArguments = ["--native-ui-test-library", library]
        print("Checklist isolated library: " + library)
        app.launch()
        boardEnabled(app.buttons["capture-open"], timeout: 30)
        boardTap(app, "capture-open")
        app.textViews["capture-input"].typeText("Checklist original")
        boardTap(app, "capture-save")
        boardEnabled(app.buttons["Checklist original"])
        app.buttons["Checklist original"].tap()
        boardTap(app, "task-mode-edit")
        let scroll = app.scrollViews["task-editor-scroll"]
        func editorTap(_ id: String) {
            revealPagedElement(app, app.buttons[id], in: scroll)
            boardTap(app, id)
        }
        func input(_ index: Int) -> XCUIElement { app.textFields["task-checklist-input-\(index)"] }
        func assertFocusedRowVisible(_ index: Int) {
            let field = input(index)
            expectation(for: NSPredicate { _, _ in
                guard field.exists, field.isHittable, app.keyboards.firstMatch.exists else { return false }
                let bottom = min(scroll.frame.maxY, app.keyboards.firstMatch.frame.minY)
                return field.frame.minY >= scroll.frame.minY && field.frame.maxY <= bottom
            }, evaluatedWith: field)
            waitForExpectations(timeout: 10)
        }
        func setItem(_ index: Int, _ title: String) {
            revealPagedElement(app, input(index), in: scroll)
            // Add focuses this blank single-line field; type without tapping
            // its far-right edge beside the Remove button.
            app.typeText(title)
            XCTAssertEqual(input(index).value as? String, title)
        }
        func showChecklist() {
            if !app.buttons["task-checklist-add"].exists { editorTap("task-editor-section-details") }
            revealPagedElement(app, app.buttons["task-checklist-add"], in: scroll)
        }
        showChecklist()
        editorTap("task-checklist-add")
        assertFocusedRowVisible(0)
        setItem(0, "First action")
        input(0).typeText("\n")
        boardEnabled(input(1))
        assertFocusedRowVisible(1)
        // Return inserts and focuses the new row; typing needs no second tap.
        input(1).typeText("Second action")
        XCTAssertEqual(input(1).value as? String, "Second action")
        editorTap("task-checklist-toggle-0")
        editorTap("task-checklist-reorder")
        editorTap("task-checklist-down-0")
        editorTap("task-checklist-reorder")
        XCTAssertEqual(input(0).value as? String, "Second action")
        XCTAssertEqual(input(1).value as? String, "First action")
        boardTap(app, "task-mode-view")
        let append = app.textFields["task-view-checklist-append"]
        revealPagedElement(app, append, in: scroll)
        append.tap(); append.typeText("Third action\n")
        boardEnabled(app.buttons["task-view-checklist-toggle-2"])
        boardTap(app, "task-mode-edit")
        let title = app.descendants(matching: .any).matching(identifier: "task-editor-title").firstMatch
        func revealTitle() {
            // Lazy form rows above the viewport can be absent from the AX tree.
            for _ in 0..<12 {
                if title.exists && title.isHittable && title.frame.minY >= scroll.frame.minY
                    && title.frame.maxY <= scroll.frame.maxY { break }
                scroll.swipeDown()
            }
            revealPagedElement(app, title, in: scroll)
        }
        revealTitle()
        replaceTextView(title, with: "Checklist saved")
        boardTap(app, "task-editor-save")
        boardEnabled(app.buttons["Checklist saved"])
        app.terminate(); app.launch()
        boardEnabled(app.buttons["Checklist saved"], timeout: 30)
        app.buttons["Checklist saved"].tap()
        boardTap(app, "task-mode-edit")
        showChecklist()
        XCTAssertEqual(input(0).value as? String, "Second action")
        XCTAssertEqual(input(1).value as? String, "First action")
        XCTAssertEqual(input(2).value as? String, "Third action")
        XCTAssertEqual(app.buttons["task-checklist-toggle-1"].value as? String, "Done")
        revealTitle()
        replaceTextView(title, with: "Unsaved checklist title")
        editorTap("task-checklist-add")
        setItem(3, "Unsaved fourth action")
        editorTap("task-checklist-reset")
        boardEnabled(app.buttons["task-editor-save"])
        XCTAssertEqual(input(3).value as? String, "Unsaved fourth action")
        XCTAssertNotEqual(app.buttons["task-checklist-toggle-1"].value as? String, "Done")
        revealTitle()
        XCTAssertEqual(title.value as? String, "Unsaved checklist title")
        boardTap(app, "task-view-close")
        boardTap(app, "task-editor-discard")
        app.terminate(); app.launch()
        boardEnabled(app.buttons["Checklist saved"], timeout: 30)
        app.buttons["Checklist saved"].tap()
        boardTap(app, "task-mode-edit")
        showChecklist()
        XCTAssertEqual(input(2).value as? String, "Third action")
        XCTAssertFalse(input(3).exists)
        for index in 0..<3 {
            XCTAssertNotEqual(app.buttons["task-checklist-toggle-\(index)"].value as? String, "Done")
        }
        // Checklist-only edits must prompt on Close and disappear on Discard.
        editorTap("task-checklist-toggle-0")
        boardTap(app, "task-view-close")
        boardTap(app, "task-editor-discard")
        boardEnabled(app.buttons["Checklist saved"])
        let taskID = String(app.buttons["Checklist saved"].identifier.dropFirst("task-title-".count))
        boardTap(app, "task-status-" + taskID)
        boardTap(app, "task-complete")
        boardTap(app, "tab-menu")
        boardTap(app, "menu-history")
        boardEnabled(app.buttons["Checklist saved"])
        app.buttons["Checklist saved"].tap()
        boardTap(app, "task-mode-edit")
        showChecklist()
        // Reset also clears a completed task's stored date and rebases its draft.
        editorTap("task-checklist-reset")
        boardEnabled(app.buttons["task-view-close"])
        XCTAssertFalse(app.staticTexts["task-view-error"].exists)
        boardTap(app, "task-view-close")
        XCTAssertFalse(app.buttons["task-editor-discard"].exists)
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.buttons["Checklist saved"])
        waitForExpectations(timeout: 10)
    }

    func testProcessInboxEditsSkipConversionAndReviewReturn() {
        let app = XCUIApplication()
        let library = UUID().uuidString.lowercased()
        app.launchArguments = ["--native-ui-test-library", library]
        print("Process Inbox isolated library: " + library)
        app.launch()
        boardEnabled(app.buttons["tab-inbox"], timeout: 30)
        let first = "Process original"
        let second = "Process project"
        let third = "Process remainder"
        for title in [first, second, third] {
            boardTap(app, "capture-open")
            app.textViews["capture-input"].typeText(title)
            boardTap(app, "capture-save")
            expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.textViews["capture-input"])
            waitForExpectations(timeout: 10)
        }
        boardTap(app, "inbox-process-primary")
        let scroll = app.scrollViews["process-inbox-scroll"]
        let title = app.textFields["process-inbox-title"]
        func processTap(_ id: String) {
            revealPagedElement(app, app.buttons[id], in: scroll)
            boardTap(app, id)
        }
        func processText(_ id: String, _ value: String) {
            let field = app.textFields[id]
            revealPagedElement(app, field, in: scroll)
            replaceTextView(field, with: value)
        }
        boardEnabled(title)
        XCTAssertEqual(title.value as? String, first)
        for id in ["capture-open", "inbox-process-primary", "tab-menu"] {
            XCTAssertFalse(app.buttons[id].exists && app.buttons[id].isEnabled)
            XCTAssertFalse(app.buttons[id].isHittable)
        }
        processText("process-inbox-title", "Process edited final")
        processTap("process-inbox-notes-toggle")
        processText("process-inbox-notes", "Saved notes final")
        // Skip must flush the last keystroke before advancing the original queue.
        boardTap(app, "process-inbox-skip")
        expectation(for: NSPredicate(format: "value == %@", second), evaluatedWith: title)
        waitForExpectations(timeout: 15)
        boardTap(app, "process-inbox-mode")
        processTap("process-inbox-choice-project")
        processTap("process-inbox-choice-project")
        processText("process-inbox-next-action", "Project next final")
        processTap("process-inbox-add-action")
        processText("process-inbox-extra-0", "Project extra one final")
        processTap("process-inbox-add-action")
        processText("process-inbox-extra-1", "Project extra two final")
        processTap("process-inbox-create-project")
        expectation(for: NSPredicate(format: "value == %@", third), evaluatedWith: title)
        waitForExpectations(timeout: 15)
        XCTAssertTrue(title.isHittable, "The next task opens at the top, as in RN")
        XCTAssertGreaterThanOrEqual(title.frame.minY, scroll.frame.minY)
        XCTAssertEqual(app.staticTexts["process-inbox-progress"].label, "2/5 tasks")
        boardTap(app, "process-inbox-close")
        boardEnabled(app.buttons["inbox-process-primary"])
        app.terminate(); app.launch()
        boardEnabled(app.buttons["inbox-process-primary"], timeout: 30)
        boardTap(app, "inbox-process-primary")
        boardEnabled(title)
        XCTAssertEqual(title.value as? String, "Process edited final")
        XCTAssertEqual(app.staticTexts["process-inbox-progress"].label, "0/4 tasks")
        processTap("process-inbox-notes-toggle")
        XCTAssertEqual(app.textFields["process-inbox-notes"].value as? String, "Saved notes final")
        processText("process-inbox-title", "Unsaved close draft")
        boardTap(app, "process-inbox-close")
        boardEnabled(app.buttons["inbox-process-primary"])
        boardTap(app, "inbox-process-primary")
        boardEnabled(title)
        XCTAssertEqual(title.value as? String, "Process edited final")
        boardTap(app, "process-inbox-close")
        if app.buttons["tab-review"].exists { boardTap(app, "tab-review") }
        else { boardTap(app, "tab-menu"); boardTap(app, "menu-review") }
        for kind in ["daily", "weekly"] {
            boardTap(app, "review-start"); boardTap(app, "review-start-" + kind)
            boardEnabled(app.buttons["review-guide-close"])
            let entry = app.buttons["review-" + kind + "-process-inbox"]
            for _ in 0..<8 where !entry.exists {
                boardTap(app, "review-guide-next")
                boardEnabled(app.buttons["review-guide-close"])
            }
            let step = app.staticTexts["review-guide-step"].label
            revealPagedElement(app, entry, in: app.scrollViews["review-guide-content-inbox"])
            boardTap(app, entry.identifier)
            boardEnabled(app.buttons["process-inbox-close"])
            for id in ["review-guide-close", "review-guide-next", "tab-menu"] {
                XCTAssertFalse(app.buttons[id].exists && app.buttons[id].isEnabled)
                XCTAssertFalse(app.buttons[id].isHittable)
            }
            boardTap(app, "process-inbox-close")
            boardEnabled(app.buttons["review-guide-close"])
            XCTAssertEqual(app.staticTexts["review-guide-step"].label, step)
            boardTap(app, "review-guide-close")
        }
    }

    func testWeeklyReviewMindSweepReturnsToCheckpoint() {
        let app = XCUIApplication()
        app.launch()
        boardEnabled(app.buttons["tab-inbox"], timeout: 30)
        boardSelectAllAreas(app)
        func openReview() {
            if app.buttons["tab-review"].exists { boardTap(app, "tab-review") }
            else { boardTap(app, "tab-menu"); boardTap(app, "menu-review") }
            boardEnabled(app.buttons["review-start"])
        }
        func startWeekly() {
            boardTap(app, "review-start"); boardTap(app, "review-start-weekly")
            boardEnabled(app.buttons["review-guide-close"])
        }
        func guideStep() -> String {
            boardEnabled(app.buttons["review-guide-close"])
            return app.staticTexts["review-guide-step"].label
        }
        func openSweep(at step: String) {
            let scroll = app.scrollViews["review-guide-content-" + step]
            revealPagedElement(app, app.buttons["review-mind-sweep-button"], in: scroll)
            boardTap(app, "review-mind-sweep-button")
            boardEnabled(app.buttons["mind-sweep-start"])
            for id in ["review-guide-close", "review-guide-next", "review-guide-finish", "review-guide-area", "review-guide-search", "tab-menu"] {
                let underlay = app.buttons[id]
                XCTAssertFalse(underlay.exists && underlay.isEnabled, "Mind Sweep underlay enabled: " + id)
                XCTAssertFalse(underlay.isHittable, "Mind Sweep underlay hittable: " + id)
            }
        }
        openReview(); startWeekly()
        if app.buttons["review-guide-finish"].exists {
            boardTap(app, "review-guide-finish"); startWeekly()
        }
        for _ in 0..<10 where app.buttons["review-guide-back"].isEnabled {
            boardTap(app, "review-guide-back")
            boardEnabled(app.buttons["review-guide-close"])
        }
        let firstStep = guideStep()
        let countLabel = app.staticTexts.matching(identifier: "review-guide-count").firstMatch
        let countBefore = countLabel.label
        XCTAssertFalse(countBefore.isEmpty)
        openSweep(at: "inbox")
        boardTap(app, "mind-sweep-scope-work"); boardTap(app, "mind-sweep-start")
        let prefix = "iOS review sweep " + String(UUID().uuidString.prefix(8)).lowercased()
        let title = prefix + " +NeverCreate /due:tomorrow"
        let input = app.textFields["mind-sweep-input"]
        let sweepScroll = app.scrollViews["mind-sweep-scroll"]
        revealPagedElement(app, input, in: sweepScroll)
        replaceTextView(input, with: title)
        revealPagedElement(app, app.buttons["mind-sweep-add"], in: sweepScroll)
        boardTap(app, "mind-sweep-add")
        let captured = app.staticTexts["mind-sweep-captured-commitments-0"]
        XCTAssertTrue(captured.waitForExistence(timeout: 15)); XCTAssertTrue(captured.label.contains(title))
        boardTap(app, "mind-sweep-close")
        XCTAssertEqual(guideStep(), firstStep)
        XCTAssertNotEqual(countLabel.label, countBefore)
        // Closing and reopening the nested sheet leaves the guide checkpoint intact.
        openSweep(at: "inbox")
        XCTAssertTrue(app.buttons["mind-sweep-scope-all"].isSelected)
        boardTap(app, "mind-sweep-close")
        XCTAssertEqual(guideStep(), firstStep)
        for _ in 0..<10 where !app.buttons["review-guide-finish"].exists {
            boardTap(app, "review-guide-next")
            boardEnabled(app.buttons["review-guide-close"])
        }
        let completedStep = guideStep()
        XCTAssertNotEqual(completedStep, firstStep)
        openSweep(at: "completed")
        boardTap(app, "mind-sweep-close")
        XCTAssertEqual(guideStep(), completedStep)
        boardTap(app, "review-guide-close")
        app.terminate(); app.launch()
        boardEnabled(app.buttons["tab-menu"], timeout: 30)
        openReview(); startWeekly()
        XCTAssertEqual(guideStep(), completedStep)
        openSweep(at: "completed")
        XCTAssertTrue(app.buttons["mind-sweep-scope-all"].isSelected)
        boardTap(app, "mind-sweep-close")
        boardTap(app, "review-guide-finish")
        boardEnabled(app.buttons["search-open"])
        boardTap(app, "search-open")
        replaceTextView(app.textFields["search-input"], with: prefix)
        let results = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "search-task-"))
        boardEnabled(results.firstMatch)
        XCTAssertEqual(results.count, 1)
        let id = String(results.firstMatch.identifier.dropFirst("search-task-".count))
        XCTAssertNotNil(UUID(uuidString: id))
        results.firstMatch.tap()
        let viewTitle = app.staticTexts.matching(identifier: "task-view-task-title").firstMatch
        XCTAssertTrue(viewTitle.waitForExistence(timeout: 10)); XCTAssertTrue(viewTitle.label.hasSuffix(title))
        boardTap(app, "task-view-close")
        boardTap(app, "search-complete-" + id)
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.buttons["search-complete-" + id])
        waitForExpectations(timeout: 10)
        boardTap(app, "search-close")
    }

    func testMindSweepLiteralAddDoneNavigationAndRestart() {
        let app = XCUIApplication()
        app.launch()
        boardEnabled(app.buttons["tab-inbox"], timeout: 30)
        boardSelectAllAreas(app)
        boardTap(app, "tab-inbox")
        func openSweep() {
            let entry = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "inbox-mind-sweep-")).firstMatch
            boardEnabled(entry); entry.tap()
            boardEnabled(app.buttons["mind-sweep-start"])
        }
        openSweep()
        XCTAssertTrue(app.buttons["mind-sweep-scope-all"].isSelected)
        boardTap(app, "mind-sweep-scope-personal")
        XCTAssertTrue(app.buttons["mind-sweep-scope-personal"].isSelected)
        boardTap(app, "mind-sweep-start")
        XCTAssertEqual(app.staticTexts["mind-sweep-group-title"].label, "Home & belongings")
        XCTAssertEqual(app.staticTexts["mind-sweep-progress"].label, "1 of 5")
        boardTap(app, "mind-sweep-close")
        openSweep()
        XCTAssertTrue(app.buttons["mind-sweep-scope-all"].isSelected)
        boardTap(app, "mind-sweep-scope-work"); boardTap(app, "mind-sweep-start")
        let scroll = app.scrollViews["mind-sweep-scroll"]
        func sweepTap(_ id: String) {
            revealPagedElement(app, app.buttons[id], in: scroll)
            boardTap(app, id)
        }
        let input = app.textFields["mind-sweep-input"]
        func sweepText(_ value: String) {
            revealPagedElement(app, input, in: scroll)
            replaceTextView(input, with: value)
        }
        XCTAssertEqual(app.staticTexts["mind-sweep-group-title"].label, "Promises & projects")
        XCTAssertEqual(app.staticTexts["mind-sweep-progress"].label, "1 of 4")
        XCTAssertEqual(app.staticTexts.matching(NSPredicate(format: "identifier BEGINSWITH %@", "mind-sweep-prompt-commitments-")).count, 5)
        XCTAssertFalse(app.buttons["mind-sweep-back"].isEnabled)
        XCTAssertFalse(app.buttons["mind-sweep-add"].isEnabled)
        let suffix = String(UUID().uuidString.prefix(8)).lowercased()
        let firstPrefix = "iOS sweep literal " + suffix
        let firstTitle = firstPrefix + " +NeverCreate /due:tomorrow"
        let secondTitle = "iOS sweep done " + suffix
        sweepText(firstTitle); sweepTap("mind-sweep-add")
        let capturedFirst = app.staticTexts["mind-sweep-captured-commitments-0"]
        XCTAssertTrue(capturedFirst.waitForExistence(timeout: 15))
        XCTAssertTrue(capturedFirst.label.contains(firstTitle))
        XCTAssertTrue((input.value as? String ?? "").isEmpty || (input.value as? String) == input.placeholderValue)
        XCTAssertTrue(app.keyboards.firstMatch.exists, "Add retains keyboard focus")
        sweepText("Unsaved draft " + suffix)
        sweepTap("mind-sweep-next")
        XCTAssertEqual(app.staticTexts["mind-sweep-group-title"].label, "People & messages")
        XCTAssertEqual(input.value as? String, "Unsaved draft " + suffix)
        sweepTap("mind-sweep-back")
        XCTAssertEqual(input.value as? String, "Unsaved draft " + suffix)
        sweepText(secondTitle); input.typeText("\n")
        let capturedSecond = app.staticTexts["mind-sweep-captured-commitments-1"]
        XCTAssertTrue(capturedSecond.waitForExistence(timeout: 15))
        XCTAssertTrue(capturedSecond.label.contains(secondTitle))
        XCTAssertTrue((input.value as? String ?? "").isEmpty || (input.value as? String) == input.placeholderValue)
        XCTAssertTrue(app.keyboards.firstMatch.exists, "Done retains keyboard focus")
        for (index, title) in ["People & messages", "Ideas & improvements", "Work admin"].enumerated() {
            sweepTap("mind-sweep-next")
            XCTAssertEqual(app.staticTexts["mind-sweep-group-title"].label, title)
            XCTAssertEqual(app.staticTexts["mind-sweep-progress"].label, "\(index + 2) of 4")
        }
        sweepTap("mind-sweep-next")
        XCTAssertTrue(app.otherElements["mind-sweep-summary"].exists || app.staticTexts["mind-sweep-summary-count"].exists)
        XCTAssertEqual(app.staticTexts["mind-sweep-summary-count"].label, "You captured 2 items into your Inbox.")
        sweepTap("mind-sweep-finish")
        openSweep()
        XCTAssertTrue(app.buttons["mind-sweep-scope-all"].isSelected)
        boardTap(app, "mind-sweep-scope-work"); boardTap(app, "mind-sweep-start")
        XCTAssertEqual(app.staticTexts.matching(NSPredicate(format: "identifier BEGINSWITH %@", "mind-sweep-captured-")).count, 0)
        for _ in 0..<4 { sweepTap("mind-sweep-next") }
        XCTAssertEqual(app.staticTexts["mind-sweep-summary-count"].label,
            "Nothing surfaced this time — your head may already be clear.")
        boardTap(app, "mind-sweep-close")
        app.terminate(); app.launch()
        boardEnabled(app.buttons["search-open"], timeout: 30)
        boardTap(app, "search-open")
        let search = app.textFields["search-input"]
        var taskIDs: [String] = []
        for (prefix, title) in [(firstPrefix, firstTitle), (secondTitle, secondTitle)] {
            replaceTextView(search, with: prefix)
            let result = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "search-task-")).firstMatch
            boardEnabled(result)
            let id = String(result.identifier.dropFirst("search-task-".count))
            XCTAssertNotNil(UUID(uuidString: id)); taskIDs.append(id)
            result.tap()
            let viewTitle = app.staticTexts.matching(identifier: "task-view-task-title").firstMatch
            XCTAssertTrue(viewTitle.waitForExistence(timeout: 10)); XCTAssertTrue(viewTitle.label.hasSuffix(title))
            boardTap(app, "task-view-close")
            boardTap(app, "search-complete-" + id)
            expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.buttons["search-complete-" + id])
            waitForExpectations(timeout: 10)
        }
        XCTAssertEqual(Set(taskIDs).count, 2)
        let identity = XCTAttachment(string: taskIDs.joined(separator: "\n"))
        identity.name = "Mind Sweep created task IDs"; identity.lifetime = .keepAlways; add(identity)
        boardTap(app, "search-close")
    }

    func testBoardSwipeDuplicateTrashAndReturn() {
        let app = XCUIApplication()
        app.launch()
        boardEnabled(app.buttons["capture-open"], timeout: 30)
        boardSelectAllAreas(app)
        let title = "iOS swipe " + String(UUID().uuidString.prefix(8)).lowercased()
        boardTap(app, "capture-open")
        app.textViews["capture-input"].typeText(title + " @nativeboard /next /due:tomorrow")
        boardTap(app, "capture-save")
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.textViews["capture-input"])
        waitForExpectations(timeout: 10)
        boardOpen(app)
        let query = app.textFields["board-search"]
        query.tap(); query.typeText(title + "\n")
        boardEnabled(app.buttons["board-filter-open"])
        let cards = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "board-task-", title))
        XCTAssertEqual(cards.count, 1)
        let originalID = cards.firstMatch.identifier
        let original = app.buttons[originalID]
        let scroll = app.scrollViews["board-scroll"]
        revealPagedElement(app, original, in: scroll)
        original.tap()
        boardEnabled(app.buttons["task-mode-view"])
        XCTAssertTrue(app.buttons["task-mode-view"].isSelected)
        boardTap(app, "task-view-close")
        revealPagedElement(app, original, in: scroll)
        // A taller viewport can fit all five columns without any scroll range.
        if app.staticTexts["board-column-done"].frame.maxY > scroll.frame.maxY {
            let originalY = original.frame.minY
            original.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(forDuration: 0.05,
                thenDragTo: scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.1)))
            XCTAssertLessThan(original.frame.minY, originalY - 20, "A vertical drag over a card scrolls the Board")
            XCTAssertFalse(app.buttons["task-view-close"].exists)
            XCTAssertEqual(cards.count, 1)
            revealPagedElement(app, original, in: scroll)
        }
        // A short horizontal drag must not duplicate, trash, or open the editor.
        let shortStart = original.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.5))
        shortStart.press(forDuration: 0.05, thenDragTo: shortStart.withOffset(CGVector(dx: 45, dy: 0)))
        XCTAssertFalse(app.buttons["task-view-close"].exists)
        XCTAssertEqual(cards.count, 1)
        original.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.5)).press(forDuration: 0.05,
            thenDragTo: original.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5)))
        boardEnabled(app.buttons["task-mode-edit"])
        XCTAssertTrue(app.buttons["task-mode-edit"].isSelected, "RN Duplicate opens the copy in Edit")
        let input = app.descendants(matching: .any).matching(identifier: "task-editor-title").firstMatch
        boardEnabled(input)
        XCTAssertTrue((input.value as? String ?? "").contains(title))
        let copyTitle = title + " native copy"
        replaceTextView(input, with: copyTitle)
        boardTap(app, "task-editor-save")
        boardEnabled(app.buttons["board-filter-open"])
        XCTAssertEqual(query.value as? String, title)
        XCTAssertEqual(cards.count, 2)
        let copy = cards.matching(NSPredicate(format: "label CONTAINS %@", "native copy")).firstMatch
        revealPagedElement(app, copy, in: scroll)
        let copyID = copy.identifier
        XCTAssertNotEqual(copyID, originalID)
        copy.tap()
        boardEnabled(app.buttons["task-mode-view"])
        XCTAssertTrue(app.buttons["task-mode-view"].isSelected, "An ordinary tap still opens View")
        boardTap(app, "task-view-close")
        revealPagedElement(app, copy, in: scroll)
        copy.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5)).press(forDuration: 0.05,
            thenDragTo: copy.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.5)))
        boardEnabled(app.buttons["board-filter-open"])
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.buttons[copyID])
        waitForExpectations(timeout: 10)
        XCTAssertTrue(original.exists)
        XCTAssertEqual(cards.count, 1)
        XCTAssertFalse(app.buttons["task-view-close"].exists)
        app.terminate(); app.launch()
        boardEnabled(app.buttons["capture-open"], timeout: 30)
        boardOpen(app)
        query.tap(); query.typeText(title + "\n")
        boardEnabled(app.buttons["board-filter-open"])
        XCTAssertTrue(original.exists)
        XCTAssertFalse(app.buttons[copyID].exists)
        XCTAssertEqual(cards.count, 1)
    }

    func testBoardSearchFiltersEditorDiscardAndReturn() {
        let app = XCUIApplication()
        app.launch()
        boardEnabled(app.buttons["capture-open"], timeout: 30)
        boardSelectAllAreas(app)
        let suffix = String(UUID().uuidString.prefix(8)).lowercased()
        let title = "iOS Board " + suffix
        let token = "@zzboard" + suffix
        let second = token + "b"
        let project = "Board project " + suffix
        for command in [title + " inbox " + token + " " + second + " +\"" + project + "\"",
                        title + " next " + token + " " + second + " +\"" + project + "\" /next /due:today"] {
            boardTap(app, "capture-open")
            app.textViews["capture-input"].typeText(command)
            boardTap(app, "capture-save")
            expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.textViews["capture-input"])
            waitForExpectations(timeout: 10)
        }
        boardOpen(app)
        let query = app.textFields["board-search"]
        boardEnabled(query)
        query.tap(); query.typeText(title + "\n")
        boardEnabled(app.buttons["board-filter-open"])
        for (status, count) in [("inbox", "1"), ("next", "1"), ("waiting", "0"), ("someday", "0"), ("done", "0")] {
            XCTAssertTrue(app.staticTexts["board-column-" + status].exists)
            XCTAssertEqual(app.staticTexts["board-count-" + status].label, count)
        }
        // Exercise search recovery through transient Area/Menu presentation.
        query.tap(); query.typeText(" next")
        app.buttons["area-open"].tap()
        boardEnabled(app.buttons["area-option-__all__"])
        app.buttons["area-dismiss"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
        boardEnabled(app.buttons["board-filter-open"])
        XCTAssertEqual(query.value as? String, title + " next")
        XCTAssertEqual(app.staticTexts["board-count-inbox"].label, "0")
        XCTAssertEqual(app.staticTexts["board-count-next"].label, "1")
        query.tap(); query.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 5))
        app.buttons["tab-menu"].tap()
        boardEnabled(app.buttons["menu-dismiss"])
        app.buttons["menu-dismiss"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
        boardEnabled(app.buttons["board-filter-open"])
        XCTAssertEqual(query.value as? String, title)
        XCTAssertEqual(app.staticTexts["board-count-inbox"].label, "1")
        XCTAssertEqual(app.staticTexts["board-count-next"].label, "1")
        boardTap(app, "board-filter-open")
        XCTAssertFalse(app.buttons["search-open"].isHittable)
        XCTAssertFalse(app.buttons["capture-open"].isHittable)
        boardTap(app, "board-filter-due")
        boardTap(app, "board-due-today")
        boardEnabled(app.buttons["board-due-today"])
        XCTAssertTrue(app.buttons["board-due-today"].isSelected)
        boardTap(app, "board-filter-close")
        XCTAssertEqual(app.staticTexts["board-count-inbox"].label, "0")
        XCTAssertEqual(app.staticTexts["board-count-next"].label, "1")
        boardTap(app, "board-filter-open")
        boardTap(app, "board-filter-due")
        boardTap(app, "board-due-today")
        boardEnabled(app.buttons["board-picker-tokens"])
        boardTap(app, "board-picker-tokens")
        let picker = app.scrollViews["board-filter-scroll"]
        let firstOption = app.buttons["board-filter-token-" + token]
        revealPagedElement(app, firstOption, in: picker, more: "board-more-tokens")
        firstOption.tap()
        boardEnabled(firstOption)
        XCTAssertTrue(firstOption.isSelected)
        firstOption.tap()
        boardEnabled(firstOption)
        XCTAssertEqual(firstOption.value as? String, "Excluded")
        firstOption.tap()
        boardEnabled(firstOption)
        XCTAssertFalse(firstOption.isSelected)
        firstOption.tap()
        boardEnabled(firstOption)
        let secondOption = app.buttons["board-filter-token-" + second]
        revealPagedElement(app, secondOption, in: picker, more: "board-more-tokens")
        secondOption.tap()
        boardEnabled(secondOption)
        let matchAll = app.buttons["board-match-context-all"]
        revealPagedElement(app, matchAll, in: picker)
        boardTap(app, "board-match-context-all")
        boardEnabled(matchAll)
        XCTAssertTrue(matchAll.isSelected)
        boardTap(app, "board-picker-back")
        boardTap(app, "board-picker-projects")
        let projectOption = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label == %@", "board-filter-project-", project)).firstMatch
        revealPagedElement(app, projectOption, in: picker, more: "board-more-projects")
        projectOption.tap()
        boardEnabled(projectOption)
        XCTAssertTrue(projectOption.isSelected)
        boardTap(app, "board-filter-close")
        let task = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "board-task-", title + " next")).firstMatch
        revealPagedElement(app, task, in: app.scrollViews["board-scroll"], more: "board-more-next")
        let taskID = String(task.identifier.dropFirst("board-task-".count))
        task.tap()
        boardTap(app, "task-mode-edit")
        let titleInput = app.descendants(matching: .any).matching(identifier: "task-editor-title").firstMatch
        titleInput.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.8)).tap()
        titleInput.typeText(" discard")
        boardTap(app, "task-view-close")
        boardTap(app, "task-editor-discard")
        boardEnabled(app.buttons["board-filter-open"])
        XCTAssertEqual(query.value as? String, title)
        XCTAssertTrue(task.isHittable, "Editor discard retains the Board anchor")
        XCTAssertFalse(task.label.contains("discard"))
        boardTap(app, "search-open")
        let search = app.textFields["search-input"]
        boardEnabled(search)
        search.tap(); search.typeText(title + " next")
        boardEnabled(app.buttons["search-task-" + taskID])
        boardTap(app, "search-close")
        boardEnabled(app.buttons["board-filter-open"])
        XCTAssertEqual(query.value as? String, title)
        XCTAssertTrue(task.isHittable, "Global Search returns to the loaded Board anchor")
        boardTap(app, "board-filter-open")
        boardTap(app, "board-picker-projects")
        revealPagedElement(app, projectOption, in: picker, more: "board-more-projects")
        XCTAssertTrue(projectOption.isSelected)
        boardTap(app, "board-filter-close")
        app.terminate(); app.launch()
        boardEnabled(app.buttons["capture-open"], timeout: 30)
        boardOpen(app)
        query.tap(); query.typeText(title + "\n")
        boardEnabled(app.buttons["board-filter-open"])
        XCTAssertEqual(app.staticTexts["board-count-inbox"].label, "1")
        XCTAssertEqual(app.staticTexts["board-count-next"].label, "1")
    }

    /// Root stages the existing, read-only 103-task Contexts fixture on the simulator.
    /// No fixture data is created or edited by this paging regression.
    func testBoardExistingContextsFixturePagesAndReturn() throws {
        let app = XCUIApplication()
        app.launch()
        boardEnabled(app.buttons["capture-open"], timeout: 30)
        boardSelectAllAreas(app)
        boardOpen(app)
        let query = app.textFields["board-search"]
        query.tap(); query.typeText("Native contexts page\n")
        boardEnabled(app.buttons["board-filter-open"])
        guard app.staticTexts["board-count-next"].label == "103" else {
            throw XCTSkip("Requires the existing contexts-evidence.py 103-task simulator fixture")
        }
        let tasks = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "board-task-"))
        XCTAssertEqual(tasks.count, 50)
        boardTap(app, "board-filter-open")
        boardTap(app, "board-picker-tokens")
        let fixtureToken = app.buttons["board-filter-token-@native-contexts-page"]
        let picker = app.scrollViews["board-filter-scroll"]
        // The fixture supplies 104 context choices, so More must cross page zero.
        let more = app.buttons["board-more-tokens"]
        revealPagedElement(app, more, in: picker)
        XCTAssertTrue(more.exists)
        more.tap()
        boardEnabled(app.buttons["board-filter-clear"])
        revealPagedElement(app, fixtureToken, in: picker, more: "board-more-tokens")
        fixtureToken.tap()
        boardEnabled(fixtureToken)
        XCTAssertTrue(fixtureToken.isSelected)
        boardTap(app, "board-filter-close")
        let scroll = app.scrollViews["board-scroll"]
        revealPagedElement(app, app.buttons["board-more-next"], in: scroll)
        boardTap(app, "board-more-next")
        boardEnabled(app.buttons["board-filter-open"])
        XCTAssertEqual(tasks.count, 100)
        revealPagedElement(app, app.buttons["board-more-next"], in: scroll)
        boardTap(app, "board-more-next")
        boardEnabled(app.buttons["board-filter-open"])
        XCTAssertEqual(tasks.count, 103)
        XCTAssertFalse(app.buttons["board-more-next"].exists)
        let last = tasks.matching(NSPredicate(format: "label CONTAINS %@", "Native contexts page 102")).firstMatch
        revealPagedElement(app, last, in: scroll)
        boardTap(app, "search-open")
        boardTap(app, "search-close")
        boardEnabled(app.buttons["board-filter-open"])
        XCTAssertEqual(tasks.count, 103)
        XCTAssertTrue(last.isHittable, "The loaded depth and scrolled anchor survive global Search")
        XCTAssertEqual(query.value as? String, "Native contexts page")
    }

    private func boardSelectAllAreas(_ app: XCUIApplication) {
        boardTap(app, "area-open")
        boardTap(app, "area-option-__all__")
        boardEnabled(app.buttons["area-option-__all__"])
        XCTAssertTrue(app.buttons["area-option-__all__"].isSelected)
        app.buttons["area-dismiss"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.staticTexts["area-title"])
        waitForExpectations(timeout: 10)
    }

    private func boardEnabled(_ element: XCUIElement, timeout: TimeInterval = 10) {
        XCTAssertTrue(element.waitForExistence(timeout: timeout))
        expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: element)
        waitForExpectations(timeout: timeout)
    }

    private func boardTap(_ app: XCUIApplication, _ id: String) {
        let element = app.buttons.matching(identifier: id).firstMatch
        boardEnabled(element)
        XCTAssertTrue(element.isHittable, id)
        element.tap()
    }

    private func boardOpen(_ app: XCUIApplication) {
        if app.buttons["tab-board"].exists { boardTap(app, "tab-board") }
        else { boardTap(app, "tab-menu"); boardTap(app, "menu-board") }
        boardEnabled(app.buttons["board-filter-open"])
        XCTAssertTrue(app.staticTexts["board-title"].exists)
    }

    private func replaceTextView(_ input: XCUIElement, with text: String, normalizedValue: String? = nil, tapOffset: CGVector = CGVector(dx: 0.98, dy: 0.8)) {
        input.coordinate(withNormalizedOffset: tapOffset).tap()
        input.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: (input.value as? String ?? "").count) + text)
        if let normalizedValue {
            expectation(for: NSPredicate(format: "value == %@", normalizedValue), evaluatedWith: input)
            waitForExpectations(timeout: 10)
        } else { XCTAssertEqual(input.value as? String, text) }
    }

    private func revealPagedElement(_ app: XCUIApplication, _ element: XCUIElement, in scroll: XCUIElement, more: String = "", ready: XCUIElement? = nil, outerEdge: Bool = false) {
        XCTAssertTrue(scroll.waitForExistence(timeout: 10))
        func visibleViewport() -> CGRect {
            var frame = scroll.frame.intersection(app.frame)
            let keyboard = app.keyboards.firstMatch
            if keyboard.exists && keyboard.frame.intersects(frame) {
                frame.size.height = max(0, keyboard.frame.minY - frame.minY)
            }
            return frame
        }
        func fullyVisible(_ item: XCUIElement) -> Bool {
            guard item.exists, item.isHittable else { return false }
            let frame = visibleViewport()
            return item.frame.minY >= frame.minY && item.frame.maxY <= frame.maxY
        }
        for _ in 0..<120 {
            if fullyVisible(element) { break }
            let next = app.buttons[more]
            if !element.exists && !more.isEmpty && fullyVisible(next) {
                boardEnabled(next); next.tap()
                boardEnabled(ready ?? (app.buttons["board-filter-close"].exists ? app.buttons["board-filter-clear"] : app.buttons["board-filter-open"]))
                continue
            }
            let frame = visibleViewport()
            XCTAssertGreaterThan(frame.height, 0)
            let exists = element.exists
            let above = exists && element.frame.minY < frame.minY
            let startY = frame.minY + frame.height * (exists ? (above ? 0.3 : 0.7) : 0.85)
            let needed = exists ? (above ? frame.minY - element.frame.minY : element.frame.maxY - frame.maxY) + 4 : frame.height * 0.7
            let distance = min(max(44, needed + 24), frame.height * (exists ? 0.4 : 0.7))
            let endY = startY + (above ? distance : -distance)
            let origin = app.coordinate(withNormalizedOffset: .zero)
            let x = outerEdge ? frame.maxX - 4 : frame.midX
            origin.withOffset(CGVector(dx: x, dy: startY)).press(forDuration: 0.05,
                thenDragTo: origin.withOffset(CGVector(dx: x, dy: endY)),
                withVelocity: .slow, thenHoldForDuration: 0.2)
        }
        boardEnabled(element)
        XCTAssertTrue(element.isHittable, element.identifier)
        XCTAssertTrue(fullyVisible(element), "\(element.identifier): row \(element.frame), viewport \(scroll.frame)")
    }

    func testCalendarPopulatedDayRemainsHittableAfterClosingDetails() {
        let app = XCUIApplication()
        app.launch()
        func tap(_ id: String) {
            let button = app.buttons.matching(identifier: id).firstMatch
            XCTAssertTrue(button.waitForExistence(timeout: 30))
            expectation(for: NSPredicate(format: "enabled == true AND hittable == true"), evaluatedWith: button)
            waitForExpectations(timeout: 10)
            button.tap()
        }
        let prefix = "iOS Month AX " + String(UUID().uuidString.prefix(8))
        for index in 1...2 {
            tap("capture-open")
            app.textViews["capture-input"].typeText(prefix + " " + String(index) + " /next /due:today")
            tap("capture-save")
            expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.textViews["capture-input"])
            waitForExpectations(timeout: 10)
        }
        tap("tab-menu"); tap("menu-calendar")
        tap("calendar-mode-month"); tap("calendar-today")
        XCTAssertTrue(app.buttons["calendar-details-close"].waitForExistence(timeout: 10))
        let day = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND selected == true", "calendar-day-")).firstMatch.identifier
        XCTAssertFalse(day.isEmpty)
        tap("calendar-details-close")
        let cell = app.buttons.matching(identifier: day).firstMatch
        expectation(for: NSPredicate(format: "hittable == true"), evaluatedWith: cell)
        waitForExpectations(timeout: 10)
        cell.tap()
        XCTAssertTrue(app.buttons["calendar-details-close"].waitForExistence(timeout: 10))
    }

    func testCalendarLandscapeTimelineIsReachableBelowAllDayTasks() {
        let originalOrientation = XCUIDevice.shared.orientation
        defer { XCUIDevice.shared.orientation = originalOrientation }
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launch()
        boardEnabled(app.buttons["capture-open"], timeout: 30)
        boardSelectAllAreas(app)
        boardTap(app, "capture-open")
        let title = "iOS landscape " + String(UUID().uuidString.prefix(8))
        app.textViews["capture-input"].typeText(title + " /next /due:tomorrow")
        boardTap(app, "capture-save")
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.textViews["capture-input"])
        waitForExpectations(timeout: 10)
        boardTap(app, "tab-menu"); boardTap(app, "menu-calendar")
        boardEnabled(app.buttons["calendar-today"])
        let initialMode = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND selected == true", "calendar-mode-")).firstMatch.identifier
        XCTAssertFalse(initialMode.isEmpty)
        boardTap(app, "calendar-mode-day"); boardTap(app, "calendar-today"); boardTap(app, "calendar-next")
        let allDay = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "calendar-item-deadline-", title)).firstMatch
        XCTAssertTrue(allDay.waitForExistence(timeout: 10))
        XCTAssertTrue(allDay.isHittable, "The fixture must render an accessible all-day row")
        let timeline = app.scrollViews["calendar-day-timeline"]
        XCTAssertTrue(timeline.waitForExistence(timeout: 10))
        let hours = app.staticTexts.matching(NSPredicate(format: "identifier BEGINSWITH %@", "calendar-hour-label-"))
        let before = hours.allElementsBoundByIndex.first { timeline.frame.contains($0.frame) }
        XCTAssertNotNil(before)
        let beforeID = before?.identifier ?? ""
        let beforeY = (before?.frame.minY ?? 0) - timeline.frame.minY
        XCUIDevice.shared.orientation = .landscapeLeft
        expectation(for: NSPredicate { _, _ in app.frame.width > app.frame.height }, evaluatedWith: app)
        waitForExpectations(timeout: 10)
        let layout = app.scrollViews["calendar-layout-scroll"]
        XCTAssertTrue(layout.waitForExistence(timeout: 10))
        for _ in 0..<6 {
            if timeline.frame.intersection(layout.frame).height >= 120 { break }
            layout.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8)).press(forDuration: 0.05,
                thenDragTo: layout.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)))
        }
        let visibleTimeline = timeline.frame.intersection(layout.frame).intersection(app.frame)
        XCTAssertGreaterThanOrEqual(visibleTimeline.height, 120, "The timeline must actually be revealed, not only have an offscreen frame")
        XCTAssertTrue(hours.allElementsBoundByIndex.contains {
            $0.isHittable && $0.frame.minY >= visibleTimeline.minY && $0.frame.minY + 20 <= visibleTimeline.maxY
        }, "An hour label must be reachable below the all-day section")
        XCUIDevice.shared.orientation = .portrait
        expectation(for: NSPredicate { _, _ in app.frame.height > app.frame.width }, evaluatedWith: app)
        waitForExpectations(timeout: 10)
        expectation(for: NSPredicate { _, _ in
            let restored = app.staticTexts[beforeID]
            return restored.exists && abs(restored.frame.minY - timeline.frame.minY - beforeY) <= 3
        }, evaluatedWith: timeline)
        waitForExpectations(timeout: 10)
        boardTap(app, "calendar-today"); boardTap(app, initialMode)
    }

    func testCalendarExistingTaskComposerValidationSaveAndRestart() {
        let app = XCUIApplication()
        app.launch()
        boardEnabled(app.buttons["capture-open"], timeout: 30)
        boardSelectAllAreas(app)
        let title = "iOS scheduled " + String(UUID().uuidString.prefix(8)).lowercased()
        boardTap(app, "capture-open")
        app.textViews["capture-input"].typeText(title + " /next")
        boardTap(app, "capture-save")
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.textViews["capture-input"])
        waitForExpectations(timeout: 10)
        func openCalendar() {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-calendar")
            boardEnabled(app.buttons["calendar-today"])
        }
        openCalendar()
        let initialMode = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND selected == true", "calendar-mode-")).firstMatch.identifier
        XCTAssertFalse(initialMode.isEmpty)
        boardTap(app, "calendar-mode-day"); boardTap(app, "calendar-today"); boardTap(app, "calendar-next")
        boardTap(app, "calendar-mode-month")
        if !app.buttons["calendar-details-close"].exists {
            let day = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND selected == true", "calendar-day-")).firstMatch
            boardEnabled(day); XCTAssertTrue(day.isHittable); day.tap()
        }
        let query = app.textFields["calendar-query"]
        boardEnabled(query); query.tap(); query.typeText(title)
        let returnKey = app.keyboards.buttons["Return"]
        if returnKey.exists && returnKey.isHittable { returnKey.tap() }
        let candidate = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "calendar-candidate-", title)).firstMatch
        boardEnabled(candidate)
        let taskID = String(candidate.identifier.dropFirst("calendar-candidate-".count))
        let identity = XCTAttachment(string: taskID)
        identity.name = "Calendar composer scheduled task ID"; identity.lifetime = .keepAlways; add(identity)
        let composerScroll = app.scrollViews.containing(.button, identifier: "calendar-composer-save").firstMatch
        func composerTap(_ id: String) {
            revealPagedElement(app, app.buttons[id], in: composerScroll)
            boardTap(app, id)
        }
        func composerText(_ input: XCUIElement, _ text: String, normalizedValue: String? = nil) {
            revealPagedElement(app, input, in: composerScroll)
            replaceTextView(input, with: text, normalizedValue: normalizedValue)
        }
        candidate.tap()
        XCTAssertTrue(app.staticTexts["calendar-composer-title"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["search-open"].isHittable)
        composerTap("calendar-composer-cancel")
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.staticTexts["calendar-composer-title"])
        waitForExpectations(timeout: 10)
        boardEnabled(candidate); candidate.tap()
        let composerQuery = app.textFields["calendar-composer-query"]
        boardEnabled(composerQuery)
        composerText(composerQuery, String(title.dropLast()))
        expectation(for: NSPredicate(format: "enabled == false"), evaluatedWith: app.buttons["calendar-composer-save"])
        waitForExpectations(timeout: 10)
        composerTap("calendar-composer-candidate-" + taskID)
        boardEnabled(app.buttons["calendar-composer-save"])
        let start = app.textFields["calendar-composer-start"]
        let end = app.textFields["calendar-composer-end"]
        composerText(start, "10:00")
        composerText(end, "09:00")
        composerTap("calendar-composer-save")
        XCTAssertTrue(app.staticTexts["calendar-composer-error"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["calendar-composer-title"].exists)
        // Shared RN composer rounds a 45-minute typed interval to its supported 60-minute estimate.
        composerText(end, "10:45", normalizedValue: "11:00")
        composerTap("calendar-composer-duration-30")
        composerTap("calendar-composer-duration-60")
        composerTap("calendar-composer-save")
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.staticTexts["calendar-composer-title"])
        waitForExpectations(timeout: 15)
        boardEnabled(app.buttons["calendar-today"])
        XCTAssertTrue(app.buttons["calendar-mode-day"].isSelected)
        let scheduled = app.buttons["calendar-item-" + taskID]
        boardEnabled(scheduled)
        XCTAssertTrue(scheduled.isHittable, "Acknowledged scheduling must scroll to its task")
        scheduled.tap(); boardTap(app, "calendar-action-edit")
        let viewTitle = app.staticTexts.matching(identifier: "task-view-task-title").firstMatch
        XCTAssertTrue(viewTitle.waitForExistence(timeout: 10)); XCTAssertTrue(viewTitle.label.hasSuffix(title))
        boardTap(app, "task-view-close")
        app.terminate(); app.launch(); openCalendar()
        XCTAssertTrue(app.buttons["calendar-mode-day"].isSelected)
        boardTap(app, "search-open")
        let search = app.textFields["search-input"]
        boardEnabled(search); search.tap(); search.typeText(title)
        boardTap(app, "search-task-" + taskID)
        XCTAssertTrue(viewTitle.waitForExistence(timeout: 10)); XCTAssertTrue(viewTitle.label.hasSuffix(title))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", "Start Date", "10:00")).firstMatch.exists)
        boardTap(app, "task-view-close")
        // Finish this test's own task so repeat runs do not reserve the same Calendar slot.
        boardTap(app, "search-complete-" + taskID)
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.buttons["search-complete-" + taskID])
        waitForExpectations(timeout: 10)
        boardTap(app, "search-close")
        boardTap(app, "calendar-today"); boardTap(app, initialMode)
    }

    func testCalendarBlankDayAndWeekEntryPreserveScroll() {
        let app = XCUIApplication()
        app.launch()
        boardEnabled(app.buttons["tab-menu"], timeout: 30)
        boardTap(app, "tab-menu"); boardTap(app, "menu-calendar")
        boardEnabled(app.buttons["calendar-today"])
        let initialMode = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND selected == true", "calendar-mode-")).firstMatch.identifier
        XCTAssertFalse(initialMode.isEmpty)
        boardTap(app, "calendar-mode-day"); boardTap(app, "calendar-today"); boardTap(app, "calendar-next")
        let timeline = app.scrollViews["calendar-day-timeline"]
        let hour = app.staticTexts["calendar-hour-label-16"]
        revealPagedElement(app, app.staticTexts["calendar-hour-label-17"], in: timeline)
        XCTAssertTrue(hour.isHittable)
        XCTAssertFalse(app.staticTexts["calendar-composer-title"].exists, "Scrolling must not create a task")
        let targetDay = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "calendar-day-free-slot-")).firstMatch.identifier
        XCTAssertFalse(targetDay.isEmpty)
        let beforeOffset = hour.frame.minY - timeline.frame.minY
        let point = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: timeline.frame.midX, dy: hour.frame.minY + 42))
        XCTAssertLessThan(hour.frame.minY + 42, timeline.frame.maxY)
        point.tap()
        boardEnabled(app.buttons["calendar-composer-mode-new"])
        XCTAssertTrue(app.buttons["calendar-composer-mode-new"].isSelected)
        XCTAssertEqual(app.textFields["calendar-composer-start"].value as? String, "4:30 PM")
        let selectedDate = app.staticTexts["calendar-composer-date"]
        XCTAssertTrue(selectedDate.waitForExistence(timeout: 10))
        let selectedDayLabel = selectedDate.label
        XCTAssertFalse(selectedDayLabel.isEmpty)
        boardTap(app, "calendar-composer-cancel")
        expectation(for: NSPredicate { _, _ in
            hour.exists && abs(hour.frame.minY - timeline.frame.minY - beforeOffset) <= 3
        }, evaluatedWith: timeline)
        waitForExpectations(timeout: 10)
        boardTap(app, "calendar-mode-week")
        let selectedKey = String(targetDay.dropFirst("calendar-day-free-slot-".count))
        let week = app.scrollViews["calendar-week-timeline"]
        boardEnabled(week)
        let choices = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "calendar-week-add-")).allElementsBoundByIndex
        let itemFrames = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "calendar-item-"))
            .allElementsBoundByIndex.filter(\.exists).map(\.frame)
        // The pinned hour gutter covers part of a horizontally clipped day column.
        let gutterRight = app.staticTexts.matching(NSPredicate(format: "identifier BEGINSWITH %@", "calendar-hour-label-"))
            .allElementsBoundByIndex.filter(\.exists).map { $0.frame.maxX }.max() ?? week.frame.minX
        let columnsViewport = CGRect(x: max(week.frame.minX, gutterRight), y: week.frame.minY,
            width: max(0, week.frame.maxX - max(week.frame.minX, gutterRight)), height: week.frame.height)
        var blankWeekTarget: (day: XCUIElement, point: CGPoint)?
        for day in choices where day.identifier != "calendar-week-add-" + selectedKey && day.isHittable {
            let visible = day.frame.intersection(columnsViewport).intersection(app.frame)
            guard visible.width >= 40, visible.height >= 44 else { continue }
            for y in stride(from: visible.minY + 20, through: visible.maxY - 20, by: 12) {
                let point = CGPoint(x: visible.midX, y: y)
                if !itemFrames.contains(where: { $0.contains(point) }) {
                    blankWeekTarget = (day, point)
                    break
                }
            }
            if blankWeekTarget != nil { break }
        }
        guard let blankWeekTarget else { XCTFail("A visible neighboring Week day must have a blank tap target"); return }
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: blankWeekTarget.point.x, dy: blankWeekTarget.point.y)).tap()
        boardEnabled(app.buttons["calendar-composer-mode-new"])
        XCTAssertTrue(app.buttons["calendar-composer-mode-new"].isSelected)
        let weekDate = app.staticTexts["calendar-composer-date"]
        XCTAssertTrue(weekDate.waitForExistence(timeout: 10))
        let weekDayLabel = weekDate.label
        XCTAssertFalse(weekDayLabel.isEmpty)
        XCTAssertNotEqual(weekDayLabel, selectedDayLabel, "Week blank tap must open the tapped day, not the selected Day date")
        XCTAssertFalse(app.buttons["calendar-composer-save"].isEnabled)
        boardTap(app, "calendar-composer-cancel")
        boardTap(app, "calendar-today"); boardTap(app, initialMode)
    }

    func testCalendarNewTaskComposerProjectModeSwitchSaveAndRestart() {
        let app = XCUIApplication()
        app.launch()
        boardEnabled(app.buttons["capture-open"], timeout: 30)
        boardSelectAllAreas(app)
        let suffix = String(UUID().uuidString.prefix(8)).lowercased()
        let existingTitle = "iOS Calendar pick " + suffix
        let title = "iOS Calendar new " + suffix
        let project = "Calendar project " + suffix
        boardTap(app, "capture-open")
        app.textViews["capture-input"].typeText(existingTitle + " /next")
        boardTap(app, "capture-save")
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.textViews["capture-input"])
        waitForExpectations(timeout: 10)
        func openCalendar() {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-calendar")
            boardEnabled(app.buttons["calendar-today"])
        }
        openCalendar()
        let initialMode = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND selected == true", "calendar-mode-")).firstMatch.identifier
        XCTAssertFalse(initialMode.isEmpty)
        boardTap(app, "calendar-mode-day"); boardTap(app, "calendar-today"); boardTap(app, "calendar-next")
        boardTap(app, "calendar-mode-month")
        if !app.buttons["calendar-details-close"].exists {
            let day = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND selected == true", "calendar-day-")).firstMatch
            boardEnabled(day); day.tap()
        }
        boardTap(app, "calendar-add-selected-day")
        let composerScroll = app.scrollViews.containing(.button, identifier: "calendar-composer-save").firstMatch
        func composerTap(_ id: String) {
            revealPagedElement(app, app.buttons[id], in: composerScroll)
            boardTap(app, id)
        }
        func composerText(_ input: XCUIElement, _ text: String) {
            revealPagedElement(app, input, in: composerScroll)
            replaceTextView(input, with: text)
        }
        boardEnabled(app.buttons["calendar-composer-mode-new"])
        XCTAssertTrue(app.buttons["calendar-composer-mode-new"].isSelected)
        XCTAssertFalse(app.buttons["calendar-composer-save"].isEnabled)
        XCTAssertTrue(app.staticTexts["calendar-composer-help"].exists)
        let newTitle = app.textFields["calendar-composer-new-title"]
        composerText(newTitle, title)
        composerTap("calendar-composer-mode-existing")
        XCTAssertFalse(app.buttons["calendar-composer-save"].isEnabled)
        composerText(app.textFields["calendar-composer-query"], existingTitle)
        let existing = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label == %@", "calendar-composer-candidate-", existingTitle)).firstMatch
        revealPagedElement(app, existing, in: composerScroll)
        boardEnabled(existing); existing.tap()
        let selectedTaskID = String(existing.identifier.dropFirst("calendar-composer-candidate-".count))
        XCTAssertNotNil(UUID(uuidString: selectedTaskID))
        boardEnabled(app.buttons["calendar-composer-save"])
        composerTap("calendar-composer-mode-new")
        boardEnabled(newTitle)
        XCTAssertEqual(newTitle.value as? String, title)
        XCTAssertTrue(app.buttons["calendar-composer-mode-new"].isSelected)
        composerTap("calendar-composer-mode-existing")
        XCTAssertEqual(app.textFields["calendar-composer-query"].value as? String, existingTitle)
        boardEnabled(existing)
        expectation(for: NSPredicate(format: "selected == true"), evaluatedWith: existing)
        waitForExpectations(timeout: 10)
        boardEnabled(app.buttons["calendar-composer-save"])
        composerTap("calendar-composer-mode-new")
        XCTAssertEqual(newTitle.value as? String, title)
        composerText(newTitle, title + " /due:not-a-date")
        composerTap("calendar-composer-save")
        XCTAssertTrue(app.staticTexts["calendar-composer-error"].waitForExistence(timeout: 10))
        XCTAssertTrue(newTitle.exists)
        composerTap("calendar-composer-mode-new")
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.staticTexts["calendar-composer-error"])
        waitForExpectations(timeout: 10)
        composerTap("calendar-composer-save")
        XCTAssertTrue(app.staticTexts["calendar-composer-error"].waitForExistence(timeout: 10))
        composerText(newTitle, title + " +\"" + project + "\" /due:tomorrow")
        composerText(app.textFields["calendar-composer-start"], "14:00")
        composerTap("calendar-composer-duration-60")
        composerTap("calendar-composer-save")
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.staticTexts["calendar-composer-title"])
        waitForExpectations(timeout: 15)
        XCTAssertTrue(app.buttons["calendar-mode-day"].isSelected)
        let created = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND NOT (identifier BEGINSWITH %@) AND label CONTAINS %@", "calendar-item-", "calendar-item-deadline-", title)).firstMatch
        boardEnabled(created)
        XCTAssertTrue(created.isHittable)
        let taskID = String(created.identifier.dropFirst("calendar-item-".count))
        XCTAssertNotNil(UUID(uuidString: taskID))
        let identity = XCTAttachment(string: taskID)
        identity.name = "Calendar composer created task ID"; identity.lifetime = .keepAlways; add(identity)
        created.tap(); boardTap(app, "calendar-action-edit")
        let viewTitle = app.staticTexts.matching(identifier: "task-view-task-title").firstMatch
        XCTAssertTrue(viewTitle.waitForExistence(timeout: 10)); XCTAssertTrue(viewTitle.label.hasSuffix(title))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", "Project", project)).firstMatch.exists)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", "Start Date", "2:00 PM")).firstMatch.exists)
        boardTap(app, "task-view-close")
        app.terminate(); app.launch(); openCalendar()
        XCTAssertTrue(app.buttons["calendar-mode-day"].isSelected)
        boardTap(app, "search-open")
        let search = app.textFields["search-input"]
        boardEnabled(search); search.tap(); search.typeText(title)
        boardTap(app, "search-task-" + taskID)
        XCTAssertTrue(viewTitle.waitForExistence(timeout: 10)); XCTAssertTrue(viewTitle.label.hasSuffix(title))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", "Project", project)).firstMatch.exists)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", "Start Date", "2:00 PM")).firstMatch.exists)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Due Date")).firstMatch.exists)
        boardTap(app, "task-view-close")
        // Finish this test's own task so repeat runs do not reserve the same Calendar slot.
        boardTap(app, "search-complete-" + taskID)
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.buttons["search-complete-" + taskID])
        waitForExpectations(timeout: 10)
        replaceTextView(search, with: existingTitle)
        boardEnabled(app.buttons["search-task-" + selectedTaskID])
        boardTap(app, "search-complete-" + selectedTaskID)
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.buttons["search-complete-" + selectedTaskID])
        waitForExpectations(timeout: 10)
        boardTap(app, "search-close")
        boardTap(app, "calendar-today"); boardTap(app, initialMode)
    }

    func testCalendarModesSelectionEditDiscardSearchAndRestart() {
        let originalOrientation = XCUIDevice.shared.orientation
        defer { XCUIDevice.shared.orientation = originalOrientation }
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launch()
        func enabled(_ element: XCUIElement, timeout: TimeInterval = 10) {
            XCTAssertTrue(element.waitForExistence(timeout: timeout))
            expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: element)
            waitForExpectations(timeout: timeout)
        }
        func tap(_ id: String) {
            let element = app.buttons.matching(identifier: id).firstMatch
            enabled(element)
            expectation(for: NSPredicate(format: "hittable == true"), evaluatedWith: element)
            waitForExpectations(timeout: 10)
            element.tap()
        }
        func selected(_ id: String) {
            expectation(for: NSPredicate(format: "selected == true"), evaluatedWith: app.buttons[id])
            waitForExpectations(timeout: 10)
        }
        func savedCapture(_ text: String) {
            tap("capture-open")
            app.textViews["capture-input"].typeText(text)
            tap("capture-save")
            expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.textViews["capture-input"])
            waitForExpectations(timeout: 10)
        }
        func openCalendar() {
            enabled(app.buttons["tab-menu"], timeout: 30)
            if app.buttons["tab-calendar"].exists { tap("tab-calendar") }
            else { tap("tab-menu"); tap("menu-calendar") }
            enabled(app.buttons["calendar-today"])
        }
        let suffix = String(UUID().uuidString.prefix(8)).lowercased()
        let title = "iOS Calendar " + suffix
        let candidate = "iOS Calendar candidate " + suffix
        enabled(app.buttons["capture-open"], timeout: 30)
        savedCapture(title + " /next /start:today 9am /due:today")
        savedCapture(candidate + " /next")
        tap("search-open")
        let search = app.textFields["search-input"]
        enabled(search)
        search.tap()
        search.typeText(title)
        let result = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "search-task-", title)).firstMatch
        enabled(result)
        let taskID = String(result.identifier.dropFirst("search-task-".count))
        tap("search-close")
        openCalendar()
        let initialMode = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND selected == true", "calendar-mode-")).firstMatch.identifier
        XCTAssertFalse(initialMode.isEmpty)
        tap("calendar-mode-month")
        selected("calendar-mode-month")
        tap("calendar-today")
        let selectedDate = app.staticTexts["calendar-selected-date"]
        XCTAssertTrue(selectedDate.waitForExistence(timeout: 10))
        let selectedLabel = selectedDate.label
        let selectedDay = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND selected == true", "calendar-day-")).firstMatch.identifier
        XCTAssertFalse(selectedDay.isEmpty)
        let monthTitle = app.staticTexts["calendar-period-title"].label
        tap("calendar-next")
        enabled(app.buttons["calendar-previous"])
        XCTAssertNotEqual(app.staticTexts["calendar-period-title"].label, monthTitle)
        tap("calendar-previous")
        enabled(app.buttons["calendar-today"])
        XCTAssertEqual(app.staticTexts["calendar-period-title"].label, monthTitle)
        tap("calendar-details-close")
        let monthGrid = app.scrollViews["calendar-month-grid"]
        var checkedLeadingBlanks = false
        // Use a rendered core date key and native cell geometry; no fixture date or weekday assumption.
        for _ in 0..<3 {
            let renderedDay = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "calendar-day-")).firstMatch
            XCTAssertTrue(renderedDay.waitForExistence(timeout: 10))
            let monthKey = String(renderedDay.identifier.dropFirst("calendar-day-".count).prefix(7))
            let first = app.buttons["calendar-day-" + monthKey + "-01"]
            let second = app.buttons["calendar-day-" + monthKey + "-02"]
            XCTAssertTrue(first.waitForExistence(timeout: 10), "The first day must survive leading blank cell identities")
            XCTAssertTrue(second.exists, "The second day must survive leading blank cell identities")
            XCTAssertTrue(first.isHittable)
            XCTAssertTrue(second.isHittable)
            if first.frame.minX > monthGrid.frame.minX + first.frame.width / 2 {
                checkedLeadingBlanks = true
                break
            }
            tap("calendar-next")
            enabled(app.buttons["calendar-today"])
        }
        XCTAssertTrue(checkedLeadingBlanks, "Verify day1/day2 in a month with leading blank cells")
        tap("calendar-today")
        tap("calendar-details-close")
        tap(selectedDay)
        XCTAssertEqual(selectedDate.label, selectedLabel)
        func calendarTask(_ title: String) -> XCUIElement {
            let item = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "calendar-item-", title)).firstMatch
            let list = app.scrollViews["calendar-details"].exists ? app.scrollViews["calendar-details"] : app.scrollViews["calendar-schedule"]
            revealPagedElement(app, item, in: list, more: "calendar-more", ready: app.buttons["calendar-today"])
            enabled(item)
            XCTAssertTrue(item.isHittable)
            return item
        }
        calendarTask(title).tap()
        enabled(app.buttons["calendar-action-edit"])
        XCTAssertFalse(app.buttons["calendar-mode-month"].isHittable)
        XCTAssertFalse(app.buttons["calendar-action-delete"].exists)
        XCTAssertFalse(app.buttons["calendar-action-unschedule"].exists)
        tap("calendar-action-edit")
        let viewTitle = app.staticTexts.matching(identifier: "task-view-task-title").firstMatch
        XCTAssertTrue(viewTitle.waitForExistence(timeout: 10))
        let originalViewTitle = viewTitle.label
        XCTAssertTrue(originalViewTitle.hasSuffix(title))
        tap("task-mode-edit")
        let titleInput = app.descendants(matching: .any).matching(identifier: "task-editor-title").firstMatch
        replaceTextView(titleInput, with: title + " changed")
        tap("task-editor-save")
        enabled(app.buttons["calendar-today"])
        selected("calendar-mode-month")
        XCTAssertEqual(selectedDate.label, selectedLabel)
        calendarTask(title + " changed").tap()
        tap("calendar-action-edit")
        tap("task-mode-edit")
        replaceTextView(titleInput, with: title + " changed discard")
        tap("task-view-close")
        tap("task-editor-discard")
        enabled(app.buttons["calendar-today"])
        XCTAssertEqual(selectedDate.label, selectedLabel)
        _ = calendarTask(title + " changed")
        let query = app.textFields["calendar-query"]
        enabled(query)
        query.tap()
        query.typeText(candidate)
        let match = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "calendar-candidate-", candidate)).firstMatch
        XCTAssertTrue(match.waitForExistence(timeout: 10))
        tap("area-open")
        enabled(app.buttons["area-dismiss"])
        app.buttons["area-dismiss"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.staticTexts["area-title"])
        waitForExpectations(timeout: 10)
        XCTAssertEqual(query.value as? String, candidate)
        tap("search-open")
        enabled(search)
        search.tap()
        search.typeText(title)
        enabled(app.buttons["search-task-" + taskID])
        tap("search-close")
        enabled(app.buttons["calendar-today"])
        selected("calendar-mode-month")
        XCTAssertEqual(query.value as? String, candidate)
        XCTAssertEqual(selectedDate.label, selectedLabel)
        tap("calendar-query-clear")
        func visibleHour(in timeline: XCUIElement) -> XCUIElement {
            let hours = app.staticTexts.matching(NSPredicate(format: "identifier BEGINSWITH %@", "calendar-hour-label-")).allElementsBoundByIndex
            let visible = hours.first { $0.frame.minY >= timeline.frame.minY + 2 && $0.frame.maxY <= timeline.frame.maxY - 2 }
            XCTAssertNotNil(visible, "A complete hour label must be visible in the timeline")
            return visible ?? hours[0]
        }
        func timelineSearchReturn(_ mode: String, weekHeader: XCUIElement? = nil) {
            let timeline = app.scrollViews["calendar-" + mode + "-timeline"]
            XCTAssertTrue(timeline.waitForExistence(timeout: 10))
            let before = visibleHour(in: timeline)
            let beforeID = before.identifier
            let beforeY = before.frame.minY
            let hour = Int(beforeID.dropFirst("calendar-hour-label-".count)) ?? 0
            let visibleFrame = timeline.frame.intersection(app.frame)
            let startY: CGFloat = hour < 12 ? 0.8 : 0.25
            let endY: CGFloat = hour < 12 ? 0.25 : 0.8
            let origin = timeline.coordinate(withNormalizedOffset: .zero)
            origin.withOffset(CGVector(dx: visibleFrame.midX - timeline.frame.minX, dy: visibleFrame.height * startY)).press(forDuration: 0.05,
                thenDragTo: origin.withOffset(CGVector(dx: visibleFrame.midX - timeline.frame.minX, dy: visibleFrame.height * endY)))
            let hourAfterScroll = visibleHour(in: timeline)
            XCTAssertTrue(hourAfterScroll.identifier != beforeID || abs(hourAfterScroll.frame.minY - beforeY) > 10,
                "The regression must leave the initial timeline viewport")
            let hourID = hourAfterScroll.identifier
            let relativeY = hourAfterScroll.frame.minY - timeline.frame.minY
            let columns = app.scrollViews["calendar-week-columns"]
            let relativeX = weekHeader.map { $0.frame.minX - columns.frame.minX }
            tap("search-open")
            enabled(search)
            tap("search-close")
            enabled(app.buttons["calendar-today"])
            selected("calendar-mode-" + mode)
            func assertPosition() {
                expectation(for: NSPredicate { _, _ in
                    let restored = app.staticTexts[hourID]
                    return restored.exists && abs(restored.frame.minY - timeline.frame.minY - relativeY) <= 3
                }, evaluatedWith: timeline)
                waitForExpectations(timeout: 10)
                if let weekHeader, let relativeX {
                    expectation(for: NSPredicate { _, _ in
                        weekHeader.exists && abs(weekHeader.frame.minX - columns.frame.minX - relativeX) <= 3
                    }, evaluatedWith: columns)
                    waitForExpectations(timeout: 10)
                }
            }
            assertPosition()
            if mode == "week" {
                XCUIDevice.shared.orientation = .landscapeLeft
                expectation(for: NSPredicate { _, _ in app.frame.width > app.frame.height }, evaluatedWith: app)
                waitForExpectations(timeout: 10)
                let layout = app.scrollViews["calendar-layout-scroll"]
                XCTAssertTrue(layout.waitForExistence(timeout: 10))
                XCTAssertGreaterThanOrEqual(layout.frame.height, 44)
                XCTAssertGreaterThanOrEqual(timeline.frame.height, 120, "Landscape retains a scrollable timeline below the controls")
                XCUIDevice.shared.orientation = .portrait
                expectation(for: NSPredicate { _, _ in app.frame.height > app.frame.width }, evaluatedWith: app)
                waitForExpectations(timeout: 10)
                enabled(app.buttons["calendar-today"])
                assertPosition()
            }
        }
        tap("calendar-mode-week")
        selected("calendar-mode-week")
        let initialDensity = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND selected == true", "calendar-week-density-")).firstMatch.identifier
        XCTAssertFalse(initialDensity.isEmpty)
        tap("calendar-week-density-3")
        enabled(app.buttons["calendar-today"])
        selected("calendar-week-density-3")
        let columns = app.scrollViews["calendar-week-columns"]
        XCTAssertTrue(columns.waitForExistence(timeout: 10))
        let headers = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "calendar-week-day-")).allElementsBoundByIndex
        XCTAssertEqual(headers.count, 7)
        XCTAssertGreaterThan(headers[0].frame.width * CGFloat(headers.count) + 56, columns.frame.width + 2,
            "The selected three-day density must exercise horizontal return")
        let firstX = headers[0].frame.minX
        let startX: CGFloat = firstX < columns.frame.minX + 45 ? 0.25 : 0.8
        let endX: CGFloat = startX < 0.5 ? 0.8 : 0.25
        columns.coordinate(withNormalizedOffset: CGVector(dx: startX, dy: 0.06)).press(forDuration: 0.05,
            thenDragTo: columns.coordinate(withNormalizedOffset: CGVector(dx: endX, dy: 0.06)))
        XCTAssertGreaterThan(abs(headers[0].frame.minX - firstX), 10, "Week must scroll horizontally before Search")
        let scrolledHeader = headers.first { $0.frame.minX >= columns.frame.minX + 56 && $0.frame.maxX <= columns.frame.maxX + 1 }
        XCTAssertNotNil(scrolledHeader)
        timelineSearchReturn("week", weekHeader: scrolledHeader)
        tap("calendar-today")
        let weekDay = "calendar-week-day-" + String(selectedDay.dropFirst("calendar-day-".count))
        tap(weekDay)
        selected("calendar-mode-day")
        timelineSearchReturn("day")
        tap("calendar-next")
        enabled(app.buttons["calendar-today"])
        tap("calendar-today")
        tap("calendar-mode-schedule")
        selected("calendar-mode-schedule")
        calendarTask(title + " changed").tap()
        tap("calendar-action-cancel")
        selected("calendar-mode-schedule")
        app.terminate()
        app.launch()
        openCalendar()
        selected("calendar-mode-schedule")
        tap("calendar-mode-schedule")
        tap("calendar-today")
        calendarTask(title + " changed").tap()
        tap("calendar-action-edit")
        XCTAssertTrue(viewTitle.waitForExistence(timeout: 10))
        XCTAssertEqual(viewTitle.label, originalViewTitle.replacingOccurrences(of: title, with: title + " changed"))
        tap("task-view-close")
        tap("calendar-mode-week")
        enabled(app.buttons["calendar-today"])
        tap(initialDensity)
        enabled(app.buttons["calendar-today"])
        selected(initialDensity)
        tap(initialMode)
        enabled(app.buttons["calendar-today"])
        selected(initialMode)
    }

    func testCalendarPreferencesPersistCompletedVisibilityDensityAndMode() {
        let app = XCUIApplication()
        app.launch()
        func enabled(_ element: XCUIElement, timeout: TimeInterval = 10) {
            XCTAssertTrue(element.waitForExistence(timeout: timeout))
            expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: element)
            waitForExpectations(timeout: timeout)
        }
        func tap(_ id: String) {
            let element = app.buttons.matching(identifier: id).firstMatch
            enabled(element)
            XCTAssertTrue(element.isHittable)
            element.tap()
        }
        func selected(_ id: String, _ value: Bool = true) {
            expectation(for: NSPredicate(format: "selected == %@", NSNumber(value: value)), evaluatedWith: app.buttons[id])
            waitForExpectations(timeout: 10)
        }
        func calendarReady() {
            enabled(app.buttons["calendar-today"])
            enabled(app.buttons["calendar-show-completed"])
        }
        func openCalendar() {
            enabled(app.buttons["tab-menu"], timeout: 30)
            if app.buttons["tab-calendar"].exists { tap("tab-calendar") }
            else { tap("tab-menu"); tap("menu-calendar") }
            calendarReady()
        }
        func mode(_ id: String) {
            tap(id)
            calendarReady()
            selected(id)
        }
        func completed(_ value: Bool) {
            if app.buttons["calendar-show-completed"].isSelected != value { tap("calendar-show-completed") }
            calendarReady()
            selected("calendar-show-completed", value)
        }
        let title = "iOS Calendar preferences " + String(UUID().uuidString.prefix(8)).lowercased()
        enabled(app.buttons["capture-open"], timeout: 30)
        tap("capture-open")
        app.textViews["capture-input"].typeText(title + " /next /due:today")
        tap("capture-save")
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.textViews["capture-input"])
        waitForExpectations(timeout: 10)
        tap("search-open")
        let search = app.textFields["search-input"]
        enabled(search)
        search.tap()
        search.typeText(title)
        let result = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "search-task-", title)).firstMatch
        enabled(result)
        let taskID = String(result.identifier.dropFirst("search-task-".count))
        tap("search-complete-" + taskID)
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.buttons["search-complete-" + taskID])
        waitForExpectations(timeout: 10)
        tap("search-close")
        openCalendar()
        let initialMode = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND selected == true", "calendar-mode-")).firstMatch.identifier
        let initialCompleted = app.buttons["calendar-show-completed"].isSelected
        XCTAssertFalse(initialMode.isEmpty)
        mode("calendar-mode-week")
        let densityOptions = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "calendar-week-density-")).allElementsBoundByIndex
        let initialDensity = densityOptions.first(where: { $0.isSelected })?.identifier ?? ""
        let changedDensity = densityOptions.first(where: { $0.identifier != initialDensity })?.identifier ?? ""
        XCTAssertFalse(initialDensity.isEmpty)
        XCTAssertFalse(changedDensity.isEmpty)
        mode("calendar-mode-schedule")
        tap("calendar-today")
        calendarReady()
        completed(true)
        let item = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "calendar-item-", title)).firstMatch
        func revealCompleted() {
            let list = app.scrollViews["calendar-schedule"]
            for _ in 0..<120 where !item.exists {
                if app.buttons["calendar-more"].exists && app.buttons["calendar-more"].isHittable {
                    tap("calendar-more")
                    calendarReady()
                } else {
                    list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.9)).press(forDuration: 0.05,
                        thenDragTo: list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15)))
                }
            }
            XCTAssertTrue(item.waitForExistence(timeout: 10))
            XCTAssertFalse(item.isEnabled, "Completed Calendar rows remain read-only")
        }
        revealCompleted()
        completed(false)
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: item)
        waitForExpectations(timeout: 10)
        completed(true)
        revealCompleted()
        mode("calendar-mode-week")
        tap(changedDensity)
        calendarReady()
        selected(changedDensity)
        tap("calendar-next")
        calendarReady()
        let period = app.staticTexts["calendar-period-title"].label
        tap("search-open")
        enabled(search)
        tap("search-close")
        calendarReady()
        selected("calendar-mode-week")
        selected(changedDensity)
        selected("calendar-show-completed")
        XCTAssertEqual(app.staticTexts["calendar-period-title"].label, period)
        app.terminate()
        app.launch()
        openCalendar()
        selected("calendar-mode-week")
        selected(changedDensity)
        selected("calendar-show-completed")
        mode("calendar-mode-schedule")
        tap("calendar-today")
        calendarReady()
        revealCompleted()
        completed(initialCompleted)
        mode("calendar-mode-week")
        tap(initialDensity)
        calendarReady()
        selected(initialDensity)
        mode(initialMode)
        selected("calendar-show-completed", initialCompleted)
    }

    func testReviewFoldedContextsScheduledGroupsAndFocusStatus() {
        let app = XCUIApplication()
        app.launch()
        func enabled(_ element: XCUIElement, timeout: TimeInterval = 10) {
            XCTAssertTrue(element.waitForExistence(timeout: timeout))
            expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: element)
            waitForExpectations(timeout: timeout)
        }
        func reveal(_ element: XCUIElement) {
            for _ in 0..<30 where !element.isHittable {
                let content = app.scrollViews.matching(NSPredicate(format: "identifier BEGINSWITH %@", "review-guide-content-")).firstMatch
                let absent = !element.exists
                let more = app.buttons["review-guide-more"]
                if absent && more.exists && more.isHittable {
                    enabled(more)
                    more.tap()
                    enabled(app.buttons["review-guide-close"])
                    continue
                }
                let viewport: XCUIElement = content.exists ? content : app
                let upward = absent || element.frame.minY >= viewport.frame.minY
                let startY: CGFloat = upward ? (absent ? 0.85 : 0.7) : 0.3
                let endY: CGFloat = upward ? (absent ? 0.15 : 0.3) : 0.7
                viewport.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: startY)).press(forDuration: 0.05,
                    thenDragTo: viewport.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: endY)))
            }
            enabled(element)
            XCTAssertTrue(element.isHittable)
        }
        func tap(_ id: String) {
            let element = app.buttons.matching(identifier: id).firstMatch
            reveal(element)
            element.tap()
        }
        func selection(_ id: String, _ selected: Bool) {
            expectation(for: NSPredicate(format: "selected == %@", NSNumber(value: selected)), evaluatedWith: app.buttons[id])
            waitForExpectations(timeout: 10)
        }
        let prefix = "iOS Review folds " + String(UUID().uuidString.prefix(8)).lowercased()
        let context = "@rv" + String(UUID().uuidString.prefix(8)).lowercased()
        func capture(_ title: String, tokens: String = "") {
            tap("capture-open")
            app.textViews["capture-input"].typeText(title + " " + tokens)
            tap("capture-save")
        }
        enabled(app.buttons["capture-open"], timeout: 30)
        for index in 1...5 { capture(prefix + " context " + String(index), tokens: "/next /due:today " + context) }
        capture(prefix + " inbox")
        for kind in ["waiting", "someday"] {
            capture(prefix + " " + kind + " visible", tokens: "/" + kind)
            capture(prefix + " " + kind + " scheduled", tokens: "/" + kind + " /review:tomorrow")
        }
        if app.buttons["tab-review"].exists { tap("tab-review") }
        else { tap("tab-menu"); tap("menu-review") }
        func start(_ kind: String) {
            tap("review-start")
            tap("review-start-" + kind)
            enabled(app.buttons["review-guide-close"])
            if app.buttons["review-guide-finish"].exists {
                tap("review-guide-finish")
                tap("review-start")
                tap("review-start-" + kind)
                enabled(app.buttons["review-guide-close"])
            }
            for _ in 0..<10 where app.buttons["review-guide-back"].isEnabled {
                tap("review-guide-back")
                enabled(app.buttons["review-guide-close"])
            }
        }
        func goTo(_ step: String, direction: String = "next") {
            let content = app.scrollViews["review-guide-content-" + step]
            for _ in 0..<10 where !content.exists {
                XCTAssertTrue(app.buttons["review-guide-" + direction].waitForExistence(timeout: 5),
                    "No " + direction + " action while seeking core Review step: " + step)
                tap("review-guide-" + direction)
                enabled(app.buttons["review-guide-close"])
            }
            XCTAssertTrue(content.exists, "Missing core Review step: " + step)
        }
        func searchAndReturn() {
            tap("review-guide-search")
            let search = app.textFields["search-input"]
            enabled(search)
            search.tap()
            search.typeText(prefix)
            let result = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "search-task-", prefix)).firstMatch
            enabled(result)
            tap("search-close")
            enabled(app.buttons["review-guide-close"])
        }
        start("daily")
        let area = app.buttons["review-guide-area"]
        XCTAssertGreaterThanOrEqual(area.frame.width, 44)
        XCTAssertGreaterThanOrEqual(area.frame.height, 44)
        area.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        enabled(app.buttons["area-dismiss"])
        app.buttons["area-dismiss"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.staticTexts["area-title"])
        waitForExpectations(timeout: 10)
        goTo("today")
        let todayTask = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "task-title-", prefix + " context")).firstMatch
        reveal(todayTask)
        let todayID = String(todayTask.identifier.dropFirst("task-title-".count))
        XCTAssertTrue(app.buttons["task-status-" + todayID].exists)
        goTo("inbox")
        let inboxTask = app.buttons[prefix + " inbox"]
        reveal(inboxTask)
        let inboxID = String(inboxTask.identifier.dropFirst("task-title-".count))
        XCTAssertTrue(app.buttons["task-status-" + inboxID].exists)
        goTo("waiting")
        let waitingTask = app.buttons[prefix + " waiting visible"]
        reveal(waitingTask)
        let waitingID = String(waitingTask.identifier.dropFirst("task-title-".count))
        XCTAssertTrue(app.buttons["task-status-" + waitingID].exists)
        goTo("focus")
        reveal(app.buttons["task-title-" + todayID])
        XCTAssertFalse(app.buttons["task-status-" + todayID].exists)
        XCTAssertEqual(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "task-status-")).count, 0)
        tap("review-guide-close")

        start("weekly")
        goTo("waiting")
        func scheduledGroup(_ kind: String) {
            let toggle = "review-scheduled-toggle-" + kind
            let visible = app.buttons[prefix + " " + kind + " visible"]
            reveal(visible)
            XCTAssertFalse(app.buttons[prefix + " " + kind + " scheduled"].exists)
            selection(toggle, false)
            tap(toggle)
            selection(toggle, true)
            let scheduled = app.buttons[prefix + " " + kind + " scheduled"]
            reveal(scheduled)
            scheduled.tap()
            tap("task-view-close")
            enabled(app.buttons["review-guide-close"])
            selection(toggle, true)
            searchAndReturn()
            reveal(app.buttons[toggle])
            selection(toggle, true)
            reveal(scheduled)
            tap(toggle)
            selection(toggle, false)
            XCTAssertFalse(scheduled.exists)
            tap(toggle)
            selection(toggle, true)
        }
        scheduledGroup("waiting")
        goTo("contexts")
        let toggle = "review-context-toggle-" + context
        reveal(app.buttons[toggle])
        selection(toggle, false)
        let contextRows = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "review-guide-task-", prefix + " context"))
        XCTAssertEqual(contextRows.count, 4)
        XCTAssertEqual(app.staticTexts["review-context-count-" + context].label, "5")
        XCTAssertTrue(app.buttons[toggle].label.contains("1"))
        tap(toggle)
        selection(toggle, true)
        XCTAssertEqual(contextRows.count, 5)
        let contextTask = contextRows.firstMatch
        reveal(contextTask)
        contextTask.tap()
        tap("task-mode-edit")
        let title = app.descendants(matching: .any).matching(identifier: "task-editor-title").firstMatch
        title.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.8)).tap()
        title.typeText(" changed")
        tap("task-editor-save")
        enabled(app.buttons["review-guide-close"])
        selection(toggle, true)
        XCTAssertEqual(contextRows.count, 5)
        searchAndReturn()
        reveal(app.buttons[toggle])
        selection(toggle, true)
        XCTAssertEqual(contextRows.count, 5)
        tap(toggle)
        selection(toggle, false)
        XCTAssertEqual(contextRows.count, 4)
        tap(toggle)
        selection(toggle, true)
        XCTAssertEqual(contextRows.count, 5)
        goTo("someday")
        scheduledGroup("someday")
        goTo("waiting", direction: "back")
        selection("review-scheduled-toggle-waiting", true)
        reveal(app.buttons[prefix + " waiting scheduled"])
        tap("review-guide-close")
    }

    func testReviewOverviewEditSearchAndGuideCheckpointRestart() {
        let app = XCUIApplication()
        app.launch()
        func enabled(_ element: XCUIElement, timeout: TimeInterval = 10) {
            XCTAssertTrue(element.waitForExistence(timeout: timeout))
            expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: element)
            waitForExpectations(timeout: timeout)
        }
        func tap(_ id: String) {
            let element = app.buttons.matching(identifier: id).firstMatch
            enabled(element)
            XCTAssertTrue(element.isHittable, "Review control is not hittable: " + id)
            element.tap()
        }
        func selected(_ id: String) {
            expectation(for: NSPredicate(format: "selected == true"), evaluatedWith: app.buttons[id])
            waitForExpectations(timeout: 10)
        }
        func openReview() {
            enabled(app.buttons["tab-menu"], timeout: 30)
            if app.buttons["tab-review"].exists { tap("tab-review") }
            else { tap("tab-menu"); tap("menu-review") }
            enabled(app.buttons["review-start"])
        }
        func revealTask(_ title: String) -> XCUIElement {
            let task = app.buttons[title]
            for _ in 0..<20 where !task.isHittable {
                let more = app.buttons["review-more"]
                if more.exists && more.isHittable { tap("review-more") }
                else { app.swipeUp() }
            }
            enabled(task)
            XCTAssertTrue(task.isHittable)
            return task
        }
        let suffix = String(UUID().uuidString.prefix(8)).lowercased()
        let title = "iOS Review due " + suffix
        let inboxTitle = "iOS Review inbox " + suffix
        let project = "Review project " + suffix
        enabled(app.buttons["capture-open"], timeout: 30)
        tap("capture-open")
        app.textViews["capture-input"].typeText(title + " +" + project + " /next /due:today /review:today")
        tap("capture-save")
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.textViews["capture-input"])
        waitForExpectations(timeout: 10)
        tap("capture-open")
        app.textViews["capture-input"].typeText(inboxTitle)
        tap("capture-save")
        openReview()
        selected("review-scope-due")
        let initialCycle = app.buttons["review-expand-cycle"].label
        tap("review-expand-cycle")
        enabled(app.buttons["review-expand-cycle"])
        let areasCycle = app.buttons["review-expand-cycle"].label
        XCTAssertNotEqual(areasCycle, initialCycle)
        tap("review-expand-cycle")
        let task = revealTask(title)
        let taskID = String(task.identifier.dropFirst("task-title-".count))
        XCTAssertFalse(taskID.isEmpty)
        tap("review-expand-cycle")
        enabled(app.buttons["review-expand-cycle"])
        XCTAssertEqual(app.buttons["review-expand-cycle"].label, initialCycle)
        XCTAssertFalse(app.buttons[title].exists)
        tap("review-scope-all")
        selected("review-scope-all")
        XCTAssertTrue(app.buttons["review-history"].exists)
        tap("review-expand-cycle")
        tap("review-expand-cycle")
        revealTask(title).tap()
        tap("task-mode-edit")
        let titleInput = app.descendants(matching: .any).matching(identifier: "task-editor-title").firstMatch
        titleInput.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.8)).tap()
        titleInput.typeText(" changed")
        tap("task-editor-save")
        enabled(app.buttons["review-start"])
        selected("review-scope-all")
        _ = revealTask(title + " changed")
        let expandedCycle = app.buttons["review-expand-cycle"].label
        tap("search-open")
        let search = app.textFields["search-input"]
        enabled(search)
        search.tap()
        search.typeText(title)
        enabled(app.buttons["search-task-" + taskID])
        tap("search-close")
        enabled(app.buttons["review-start"])
        selected("review-scope-all")
        XCTAssertEqual(app.buttons["review-expand-cycle"].label, expandedCycle)
        _ = revealTask(title + " changed")

        func startGuide(_ kind: String) {
            tap("review-start")
            XCTAssertFalse(app.buttons["search-open"].isHittable)
            tap("review-start-" + kind)
            enabled(app.buttons["review-guide-close"])
        }
        func stepTitle() -> String {
            enabled(app.buttons["review-guide-close"])
            let heading = app.staticTexts["review-guide-step"]
            XCTAssertTrue(heading.waitForExistence(timeout: 10))
            XCTAssertFalse(heading.label.isEmpty)
            return heading.label
        }
        for kind in ["daily", "weekly"] {
            startGuide(kind)
            // Existing device-local sessions may be on any step. Navigate using
            // only exposed Back/Finish controls, then test a fresh first step.
            if app.buttons["review-guide-finish"].exists {
                tap("review-guide-finish")
                enabled(app.buttons["review-start"])
                startGuide(kind)
            }
            for _ in 0..<10 where app.buttons["review-guide-back"].isEnabled {
                tap("review-guide-back")
                enabled(app.buttons["review-guide-close"])
            }
            let first = stepTitle()
            XCTAssertFalse(app.buttons["review-guide-back"].isEnabled)
            for id in ["tab-inbox", "tab-menu", "review-start", "review-scope-due"] {
                let background = app.buttons[id]
                XCTAssertFalse(background.exists && background.isEnabled, "Review modal background enabled: " + id)
                XCTAssertFalse(background.isHittable)
            }
            tap("review-guide-next")
            let second = stepTitle()
            XCTAssertNotEqual(second, first)
            tap("review-guide-back")
            XCTAssertEqual(stepTitle(), first)
            tap("review-guide-next")
            XCTAssertEqual(stepTitle(), second)
            tap("review-guide-search")
            enabled(search)
            search.tap()
            search.typeText(title)
            enabled(app.buttons["search-task-" + taskID])
            tap("search-close")
            XCTAssertEqual(stepTitle(), second)
            tap("review-guide-close")
            enabled(app.buttons["review-start"])
            startGuide(kind)
            XCTAssertEqual(stepTitle(), second)
            app.terminate()
            app.launch()
            openReview()
            // Overview state is session-only, while the opaque guide resumes.
            selected("review-scope-due")
            XCTAssertEqual(app.buttons["review-expand-cycle"].label, initialCycle)
            startGuide(kind)
            XCTAssertEqual(stepTitle(), second)
            for _ in 0..<10 where !app.buttons["review-guide-finish"].exists {
                tap("review-guide-next")
                enabled(app.buttons["review-guide-close"])
            }
            tap("review-guide-finish")
            enabled(app.buttons["review-start"])
            startGuide(kind)
            XCTAssertEqual(stepTitle(), first)
            tap("review-guide-close")
            enabled(app.buttons["review-start"])
        }
        // Complete only the task this test created, then check the due row is gone.
        tap("review-expand-cycle")
        tap("review-expand-cycle")
        _ = revealTask(title + " changed")
        tap("task-status-" + taskID)
        tap("task-complete")
        enabled(app.buttons["review-start"])
        XCTAssertFalse(app.buttons[title + " changed"].exists)
    }

    func testFocusSectionFoldsSurviveRestart() { focusFoldFlow(library: "12882f08-9ccf-4f12-aa89-509367d413b8") }
    func testFocusSectionFoldsLargestText() { focusFoldFlow(library: "306952c5-378a-45ce-bcbd-f3ad3ad0c6bb") }

    private func focusFoldFlow(library: String) {
        let app = XCUIApplication(); app.launchArguments = ["--native-ui-test-library", library]
        func focus() {
            boardEnabled(app.buttons["tab-focus"], timeout: 30); boardTap(app, "tab-focus")
            boardEnabled(app.buttons["focus-view-options"])
        }
        func section(_ key: String, open: Bool) {
            let button = app.buttons["focus-section-" + key]
            revealPagedElement(app, button, in: app.scrollViews.containing(.button, identifier: "focus-view-options").firstMatch)
            XCTAssertEqual(button.value as? String, open ? "Collapse" : "Expand")
            XCTAssertGreaterThanOrEqual(button.frame.height, 44 - 0.001)
        }
        func toggle(_ id: String) {
            let button = app.buttons[id]
            revealPagedElement(app, button, in: app.scrollViews.containing(.button, identifier: "focus-view-options").firstMatch)
            boardEnabled(button); button.tap()
        }
        func restart() { app.terminate(); app.launch(); focus() }
        app.launch(); focus(); section("focus", open: true); section("next", open: true)
        toggle("focus-section-focus"); section("focus", open: false)
        boardTap(app, "tab-inbox"); focus(); section("focus", open: false); restart(); section("focus", open: false)
        toggle("focus-toggle-sections"); section("focus", open: true); section("next", open: false)
        restart(); section("focus", open: true); section("next", open: false)
        toggle("focus-toggle-sections"); section("next", open: true)
        restart(); section("focus", open: true); section("next", open: true)
        toggle("focus-section-next"); section("next", open: false)
        restart(); section("focus", open: true); section("next", open: false)
        toggle("focus-section-next"); toggle("focus-toggle-sections")
        section("focus", open: true); section("next", open: false)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Focus persisted section folds"
        shot.lifetime = .keepAlways; add(shot); app.terminate()
    }

    func testFocusLegacyFoldAliasAndStrictBooleans() { focusLegacyFolds(focusOpen: false, nextOpen: false) }
    func testFocusLegacyFoldNativeOverrideAndNextPrecedence() { focusLegacyFolds(focusOpen: true, nextOpen: true) }
    func testFocusLegacyMalformedFoldsDefaultExpanded() { focusLegacyFolds(focusOpen: true, nextOpen: true, details: false) }

    private func focusLegacyFolds(focusOpen: Bool, nextOpen: Bool, details: Bool = true) {
        let app = XCUIApplication(); app.launchArguments = ["--native-rn-rehearsal"]
        func focus() {
            boardEnabled(app.buttons["tab-focus"], timeout: 30); boardTap(app, "tab-focus")
            boardEnabled(app.buttons["focus-view-options"])
        }
        func section(_ key: String, open: Bool) {
            let button = app.buttons["focus-section-" + key]
            revealPagedElement(app, button, in: app.scrollViews.containing(.button, identifier: "focus-view-options").firstMatch)
            XCTAssertEqual(button.value as? String, open ? "Collapse" : "Expand")
        }
        app.launch(); focus(); section("focus", open: focusOpen); section("next", open: nextOpen)
        section("focus", open: focusOpen); app.buttons["focus-section-focus"].tap()
        app.terminate(); app.launch(); focus()
        section("focus", open: !focusOpen); section("next", open: nextOpen)
        let view = app.buttons["focus-view-options"]
        revealPagedElement(app, view, in: app.scrollViews.containing(.button, identifier: "focus-view-options").firstMatch)
        view.tap()
        let toggle = app.buttons["focus-details"]
        revealPagedElement(app, toggle, in: app.scrollViews.containing(.button, identifier: "focus-details").firstMatch)
        XCTAssertEqual(toggle.isSelected, details, "Section changes preserve Show details")
        boardTap(app, "focus-controls-close"); app.terminate()
    }

    func testFocusShowDetailsAndRestart() { focusDetailsFlow(library: "102a6841-a77e-456e-8fa6-2db0e1e38fb0") }
    func testFocusShowDetailsLargestTextAndRestart() { focusDetailsFlow(library: "ddd588d0-4618-4628-83ee-9d682b487b78") }

    func testFocusDetailsTextOpensTask() { focusDetailsFlow(library: "d1980ea3-24b9-4292-bb1e-8ca84db7f4ba", checkTextTaps: true) }

    func testFocusDescriptionReferencesOpenLinkedTargets() {
        let app = XCUIApplication(); app.launchArguments = ["--native-ui-test-library", "69f11d50-6500-4170-a3bc-3371ecbaa399"]
        app.launch(); boardEnabled(app.buttons["tab-focus"], timeout: 30); boardTap(app, "tab-focus")
        boardEnabled(app.buttons["focus-view-options"]); boardTap(app, "focus-view-options")
        let toggle = app.buttons["focus-details"]
        revealPagedElement(app, toggle, in: app.scrollViews.containing(.button, identifier: "focus-details").firstMatch)
        toggle.tap(); boardTap(app, "focus-controls-close")
        func link(_ label: String, sourceID: String) {
            let preview = app.descendants(matching: .any).matching(identifier: "task-description-" + sourceID).firstMatch
            revealPagedElement(app, preview, in: app.scrollViews.containing(.button, identifier: "focus-view-options").firstMatch)
            XCTAssertTrue(preview.label.contains(label))
            let link = app.links.matching(NSPredicate(format: "label == %@", label)).firstMatch
            if link.exists { link.tap() } else { preview.tap() }
        }
        link("Open linked task", sourceID: "b2468ac9-a2e9-46f4-978b-71d00b19b88d")
        boardEnabled(app.buttons["task-mode-edit"])
        XCTAssertTrue(app.staticTexts["Linked preview reference"].exists)
        boardTap(app, "task-view-close")
        link("Open linked Project", sourceID: "c65e201b-6868-411a-80aa-5cc6a8f8ec63")
        boardEnabled(app.buttons["project-details-toggle"])
        XCTAssertEqual(app.staticTexts["project-detail-title"].label, "Linked preview Project")
        boardTap(app, "project-back"); boardEnabled(app.buttons["focus-view-options"])
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Focus resolved internal description links"
        shot.lifetime = .keepAlways; add(shot); app.terminate()
    }

    func testWaitingAndSomedayDescriptionLinksOpenTargets() {
        let app = XCUIApplication(); app.launchArguments = ["--native-ui-test-library", "3e588702-b6d0-4dd0-9a87-32a6b4061248"]
        app.launch(); boardEnabled(app.buttons["tab-menu"], timeout: 30)
        for (surface, taskSource, projectSource) in [
            ("waiting", "8d0bb037-7dc5-4c67-b001-dabb5546aa51", "bd999c43-7c51-4634-9a0a-b731176a404b"),
            ("someday", "7eb15219-68b4-433c-8156-12e383629acf", "fcc02a38-1e34-4d44-86d4-2f9b15586c0d")
        ] {
            if app.buttons["waiting-back"].exists { boardTap(app, "waiting-back") }
            boardTap(app, "tab-menu"); boardTap(app, "menu-" + surface)
            if surface == "someday" {
                boardTap(app, "someday-overflow-button"); boardTap(app, "someday-toggle-details")
            }
            for (source, label) in [(taskSource, "Open linked task"), (projectSource, "Open linked Project")] {
                let preview = app.descendants(matching: .any).matching(identifier: "task-description-" + source).firstMatch
                XCTAssertTrue(preview.waitForExistence(timeout: 10))
                revealPagedElement(app, preview, in: app.scrollViews.containing(.any, identifier: preview.identifier).firstMatch)
                let link = app.links.matching(NSPredicate(format: "label == %@", label)).firstMatch
                XCTAssertTrue(link.exists); link.tap()
                if source == taskSource {
                    boardEnabled(app.buttons["task-mode-edit"])
                    XCTAssertTrue(app.staticTexts["Linked preview reference"].exists)
                    boardTap(app, "task-view-close")
                } else {
                    boardEnabled(app.buttons["project-details-toggle"])
                    XCTAssertEqual(app.staticTexts["project-detail-title"].label, "Linked preview Project")
                    boardTap(app, "project-back")
                }
            }
        }
        app.terminate()
    }

    // Root stages and restores a copied RN library and the app preference domain.
    func testFocusLegacyDetailsTrueAndLocalFalseOverride() { focusLegacyDetails(expected: true) }
    func testFocusLegacyDetailsInvalidDefaultsFalse() { focusLegacyDetails(expected: false) }

    private func focusLegacyDetails(expected: Bool) {
        let app = XCUIApplication(); app.launchArguments = ["--native-rn-rehearsal"]
        func view() {
            boardEnabled(app.buttons["tab-focus"], timeout: 30); boardTap(app, "tab-focus")
            boardTap(app, "focus-view-options")
            revealPagedElement(app, app.buttons["focus-details"],
                in: app.scrollViews.containing(.button, identifier: "focus-details").firstMatch)
            boardEnabled(app.buttons["focus-details"])
        }
        app.launch(); view()
        XCTAssertEqual(app.buttons["focus-details"].isSelected, expected)
        if expected {
            app.buttons["focus-details"].tap()
            XCTAssertFalse(app.buttons["focus-details"].isSelected)
            boardTap(app, "focus-controls-close")
            app.terminate(); app.launch(); view()
            XCTAssertFalse(app.buttons["focus-details"].isSelected, "Explicit native false overrides legacy true")
        }
        boardTap(app, "focus-controls-close"); app.terminate()
    }

    private func focusDetailsFlow(library: String, checkTextTaps: Bool = false) {
        let app = XCUIApplication(); app.launchArguments = ["--native-ui-test-library", library]
        let taskID = "9f16a906-178b-411f-a2a3-e57a7d00047a"
        let description = app.descendants(matching: .any).matching(identifier: "task-description-" + taskID).firstMatch
        let age = app.descendants(matching: .any).matching(identifier: "task-age-" + taskID).firstMatch
        func focus() {
            boardEnabled(app.buttons["tab-focus"], timeout: 30); boardTap(app, "tab-focus")
            boardEnabled(app.buttons["focus-view-options"])
        }
        func view() {
            let button = app.buttons["focus-view-options"]
            revealPagedElement(app, button, in: app.scrollViews.containing(.button, identifier: "focus-view-options").firstMatch)
            button.tap()
            let toggle = app.buttons["focus-details"]
            revealPagedElement(app, toggle, in: app.scrollViews.containing(.button, identifier: "focus-details").firstMatch)
            boardEnabled(toggle)
        }
        func visibleDetails() {
            revealPagedElement(app, description, in: app.scrollViews.containing(.button, identifier: "focus-view-options").firstMatch)
            XCTAssertTrue(description.exists); XCTAssertTrue(description.label.contains("Detail preview"))
            revealPagedElement(app, age, in: app.scrollViews.containing(.button, identifier: "focus-view-options").firstMatch)
            XCTAssertTrue(age.exists); XCTAssertFalse(age.label.isEmpty)
        }
        func toggle(_ selected: Bool) {
            let button = app.buttons["focus-details"]
            XCTAssertGreaterThanOrEqual(button.frame.height, 44 - 0.001)
            button.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0)).withOffset(CGVector(dx: 0, dy: 4)).tap()
            expectation(for: NSPredicate(format: "selected == %@", NSNumber(value: selected)), evaluatedWith: button)
            waitForExpectations(timeout: 10)
            XCTAssertEqual(button.label, selected ? "Hide details" : "Show details")
        }
        app.launch(); focus()
        XCTAssertFalse(description.exists); XCTAssertFalse(age.exists)
        view(); XCTAssertFalse(app.buttons["focus-details"].isSelected); toggle(true)
        let options = XCTAttachment(screenshot: app.screenshot()); options.name = "Focus Show details View options"
        options.lifetime = .keepAlways; add(options)
        boardTap(app, "focus-controls-close"); visibleDetails()
        let rows = XCTAttachment(screenshot: app.screenshot()); rows.name = "Focus task description and age"
        rows.lifetime = .keepAlways; add(rows)
        if checkTextTaps {
            XCTAssertFalse(app.buttons["hourglass"].exists, "The decorative age icon must not be an accessibility action")
            for text in [description, age] {
                visibleDetails(); text.tap()
                boardEnabled(app.buttons["task-mode-edit"]); boardTap(app, "task-view-close")
            }
        }
        let title = app.buttons.matching(identifier: "task-title-" + taskID).firstMatch
        revealPagedElement(app, title, in: app.scrollViews.containing(.button, identifier: "focus-view-options").firstMatch)
        title.tap(); boardEnabled(app.buttons["task-mode-edit"]); boardTap(app, "task-view-close")
        visibleDetails()
        let filters = app.buttons["focus-filters-open"]
        revealPagedElement(app, filters, in: app.scrollViews.containing(.button, identifier: "focus-view-options").firstMatch)
        filters.tap(); boardTap(app, "focus-controls-close"); visibleDetails()
        boardTap(app, "tab-inbox"); focus(); visibleDetails()
        app.terminate(); app.launch(); focus(); visibleDetails()
        view(); XCTAssertTrue(app.buttons["focus-details"].isSelected); toggle(false)
        boardTap(app, "focus-controls-close"); XCTAssertFalse(description.exists); XCTAssertFalse(age.exists)
        app.terminate(); app.launch(); focus(); XCTAssertFalse(description.exists); XCTAssertFalse(age.exists)
        app.terminate()
    }

    func testFocusControlsTokensSortEditSearchAndRestart() {
        let app = XCUIApplication()
        app.launch()
        func enabled(_ element: XCUIElement, timeout: TimeInterval = 10) {
            XCTAssertTrue(element.waitForExistence(timeout: timeout))
            expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: element)
            waitForExpectations(timeout: timeout)
        }
        func tap(_ id: String) {
            let element = app.buttons.matching(identifier: id).firstMatch
            enabled(element)
            if id.hasPrefix("focus-filter-token-") {
                // XCTest misreports selected picker rows with the keyboard open.
                // Use a real onscreen tap; every following assertion checks the state transition.
                let center = CGPoint(x: element.frame.midX, y: element.frame.midY)
                XCTAssertTrue(app.scrollViews["focus-filter-picker-list"].frame.contains(center))
                XCTAssertTrue(app.frame.contains(center))
                element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            } else {
                XCTAssertTrue(element.isHittable, "Focus control is not hittable: " + id)
                element.tap()
            }
        }
        func selected(_ id: String) {
            expectation(for: NSPredicate(format: "selected == true"), evaluatedWith: app.buttons[id])
            waitForExpectations(timeout: 10)
        }
        let suffix = String(UUID().uuidString.prefix(8)).lowercased()
        let title = "iOS Focus controls " + suffix
        let first = "@fc" + suffix + "a"
        let second = "@fc" + suffix + "b"
        enabled(app.buttons["capture-open"], timeout: 30)
        tap("capture-open")
        app.textViews["capture-input"].typeText(title + " /next /priority:low " + first + " " + second)
        tap("capture-save")
        tap("tab-focus")
        tap("focus-filters-open")
        tap("focus-filter-tokens")
        let query = app.textFields["focus-filter-picker-search"]
        enabled(query)
        query.tap()
        query.typeText(suffix)
        tap("focus-filter-token-" + first)
        selected("focus-filter-token-" + first)
        tap("focus-filter-token-" + first)
        expectation(for: NSPredicate(format: "value == %@", "Excluded"), evaluatedWith: app.buttons["focus-filter-token-" + first])
        waitForExpectations(timeout: 10)
        tap("focus-filter-token-" + first)
        expectation(for: NSPredicate(format: "selected == false AND value == %@", ""), evaluatedWith: app.buttons["focus-filter-token-" + first])
        waitForExpectations(timeout: 10)
        // Consecutive accepted taps are applied against successive core states.
        tap("focus-filter-token-" + first)
        tap("focus-filter-token-" + second)
        selected("focus-filter-token-" + first)
        selected("focus-filter-token-" + second)
        tap("focus-filter-match-context-all")
        selected("focus-filter-match-context-all")
        tap("focus-filter-picker-back")
        tap("focus-controls-close")
        enabled(app.buttons[title])
        let taskID = String(app.buttons[title].identifier.dropFirst("task-title-".count))
        tap("focus-view-options")
        tap("focus-sort-created-desc")
        selected("focus-sort-created-desc")
        tap("focus-controls-close")
        enabled(app.buttons[title])
        app.buttons[title].tap()
        tap("task-mode-edit")
        let titleInput = app.descendants(matching: .any).matching(identifier: "task-editor-title").firstMatch
        titleInput.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.8)).tap()
        titleInput.typeText(" changed")
        tap("task-editor-save")
        enabled(app.buttons[title + " changed"])
        tap("search-open")
        let search = app.textFields["search-input"]
        enabled(search)
        search.tap()
        search.typeText(title)
        enabled(app.buttons["search-task-" + taskID])
        tap("search-close")
        enabled(app.buttons[title + " changed"])
        tap("focus-view-options")
        selected("focus-sort-created-desc")
        tap("focus-controls-close")
        tap("focus-filters-open")
        tap("focus-filter-tokens")
        enabled(query)
        query.tap()
        query.typeText(suffix)
        selected("focus-filter-token-" + first)
        selected("focus-filter-token-" + second)
        selected("focus-filter-match-context-all")
        tap("focus-controls-close")
        app.terminate()
        app.launch()
        enabled(app.buttons["tab-focus"], timeout: 30)
        tap("tab-focus")
        tap("focus-view-options")
        selected("focus-sort-default")
        tap("focus-controls-close")
        tap("focus-filters-open")
        XCTAssertFalse(app.buttons["focus-filter-clear"].exists)
        tap("focus-filter-tokens")
        enabled(query)
        query.tap()
        query.typeText(suffix)
        enabled(app.buttons["focus-filter-token-" + first])
        XCTAssertFalse(app.buttons["focus-filter-token-" + first].isSelected)
        tap("focus-filter-token-" + first)
        selected("focus-filter-token-" + first)
        tap("focus-controls-close")
        enabled(app.buttons[title + " changed"])
        tap("task-status-" + taskID)
        tap("task-complete")
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.buttons[title + " changed"])
        waitForExpectations(timeout: 10)
    }

    func testFocusInitialReadFailureRetryAndModalContainment() {
        let app = XCUIApplication()
        app.launchArguments.append("--native-focus-initial-read-failure")
        app.launch()
        func tap(_ id: String) {
            let element = app.buttons[id]
            XCTAssertTrue(element.waitForExistence(timeout: 30))
            expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: element)
            waitForExpectations(timeout: 10)
            XCTAssertTrue(element.isHittable, "Focus control is not hittable: " + id)
            element.tap()
        }
        tap("tab-focus")
        XCTAssertTrue(app.staticTexts["focus-error"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["focus-view-options"].exists)
        tap("focus-retry")
        tap("focus-filters-open")
        XCTAssertFalse(app.staticTexts["focus-error"].exists)
        for id in ["tab-focus", "tab-inbox", "tab-review", "tab-projects", "tab-menu", "capture-open"] {
            let background = app.buttons[id]
            // XCTest can retain hidden SwiftUI descendants in its query tree.
            XCTAssertFalse(background.exists && background.isEnabled, "Background action enabled under Focus panel: " + id)
            XCTAssertFalse(background.isHittable, "Background action hittable under Focus panel: " + id)
        }
        XCTAssertTrue(app.buttons["focus-controls-close"].isHittable)
        XCTAssertTrue(app.buttons["focus-controls-dismiss"].exists)
        tap("focus-controls-close")
        tap("tab-inbox")
        XCTAssertTrue(app.buttons["capture-open"].isHittable)
    }

    func testFocusRefusedLocationCorrectionAndClear() {
        let app = XCUIApplication()
        app.launch()
        func enabled(_ element: XCUIElement) {
            XCTAssertTrue(element.waitForExistence(timeout: 30))
            expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: element)
            waitForExpectations(timeout: 10)
        }
        func tap(_ id: String) {
            let element = app.buttons[id]
            enabled(element)
            XCTAssertTrue(element.isHittable, "Focus control is not hittable: " + id)
            element.tap()
        }
        func reveal(_ element: XCUIElement) {
            enabled(element)
            // Only scroll the filter body for its offscreen location/priority
            // fields. Fixed header/footer actions must already be hittable.
            let body = app.scrollViews.firstMatch
            for _ in 0..<4 where !element.isHittable {
                if element.frame.minY < body.frame.minY { body.swipeDown() }
                else { body.swipeUp() }
            }
            XCTAssertTrue(element.isHittable)
        }
        func replace(_ field: XCUIElement, with value: String) {
            reveal(field)
            field.tap()
            field.typeKey("a", modifierFlags: .command)
            field.typeText(value)
        }
        func waitForFailure() {
            XCTAssertTrue(app.staticTexts["focus-filter-error"].waitForExistence(timeout: 10))
        }
        func waitForRecovery() {
            expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.staticTexts["focus-filter-error"])
            waitForExpectations(timeout: 10)
        }
        tap("tab-focus")
        tap("focus-filters-open")
        tap("focus-filter-more")
        let location = app.textFields["focus-filter-location"]
        reveal(location)
        location.tap()
        let refused = String(repeating: "x", count: 501)
        location.typeText(refused)
        waitForFailure()
        XCTAssertTrue(app.buttons["focus-filter-clear"].exists)
        // Keep a different accepted edit behind the refused location. Its
        // selected state must survive the explicit location correction.
        let low = app.buttons["focus-filter-priority-low"]
        reveal(low)
        low.tap()
        replace(location, with: "Home")
        location.typeText("\n")
        expectation(for: NSPredicate(format: "selected == true"), evaluatedWith: low)
        waitForExpectations(timeout: 10)
        waitForRecovery()
        XCTAssertEqual(location.value as? String, "Home")

        // Clear must also supersede a definite refusal, and remain reachable
        // even when a failed first location has no published active chip.
        replace(location, with: refused)
        waitForFailure()
        let high = app.buttons["focus-filter-priority-high"]
        reveal(high)
        high.tap()
        tap("focus-filter-clear")
        waitForRecovery()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.buttons["focus-filter-clear"])
        waitForExpectations(timeout: 10)
        XCTAssertFalse(low.isSelected)
        XCTAssertFalse(high.isSelected)
        tap("focus-controls-close")
        tap("focus-view-options")
        tap("focus-controls-close")
    }

    func testContextsTokensEditSearchCompleteAndRestart() {
        let app = XCUIApplication()
        app.launch()
        func enabled(_ element: XCUIElement, timeout: TimeInterval = 10) {
            XCTAssertTrue(element.waitForExistence(timeout: timeout))
            expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: element)
            waitForExpectations(timeout: timeout)
        }
        func tap(_ id: String) {
            let element = app.buttons.matching(identifier: id).firstMatch
            enabled(element)
            element.tap()
        }
        func selected(_ id: String) {
            expectation(for: NSPredicate(format: "selected == true"), evaluatedWith: app.buttons[id])
            waitForExpectations(timeout: 10)
        }
        enabled(app.buttons["capture-open"], timeout: 30)
        tap("capture-open")
        let suffix = String(UUID().uuidString.prefix(8)).lowercased()
        let title = "iOS contexts " + suffix
        let first = "@cx" + suffix + "a"
        let second = "@cx" + suffix + "b"
        app.textViews["capture-input"].typeText(title + " " + first + " " + second)
        tap("capture-save")
        tap("tab-menu")
        tap("menu-contexts")
        let query = app.textFields["contexts-search"]
        XCTAssertTrue(query.waitForExistence(timeout: 10))
        var queryText = ""
        func searchChips(_ text: String) {
            query.tap()
            query.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: queryText.count) + text)
            queryText = text
        }
        searchChips(first)
        tap("contexts-chip-" + first)
        selected("contexts-chip-" + first)
        enabled(app.buttons[title])
        let id = String(app.buttons[title].identifier.dropFirst("task-title-".count))
        searchChips("missing-" + suffix)
        // Contexts search filters chips only; a selected task is still visible.
        enabled(app.buttons[title])
        XCTAssertFalse(app.buttons["contexts-chip-" + first].exists)
        searchChips(second)
        tap("contexts-chip-" + second)
        selected("contexts-chip-" + second)
        selected("contexts-match-all")
        tap("contexts-match-any")
        selected("contexts-match-any")
        tap("task-token-" + id + "-" + first)
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.buttons["contexts-match-any"])
        waitForExpectations(timeout: 10)
        searchChips(first)
        // Accept a control immediately after text input, including focus resignation.
        tap("contexts-chip-all")
        selected("contexts-chip-all")
        tap("contexts-chip-" + first)
        selected("contexts-chip-" + first)
        enabled(app.buttons[title])
        app.buttons[title].tap()
        tap("task-mode-edit")
        let titleInput = app.descendants(matching: .any).matching(identifier: "task-editor-title").firstMatch
        titleInput.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.8)).tap()
        titleInput.typeText(" changed")
        tap("task-editor-save")
        enabled(app.buttons[title + " changed"])
        XCTAssertEqual(query.value as? String, first)
        selected("contexts-chip-" + first)
        tap("search-open")
        let globalQuery = app.textFields["search-input"]
        XCTAssertTrue(globalQuery.waitForExistence(timeout: 5))
        globalQuery.tap()
        globalQuery.typeText(title)
        enabled(app.buttons["search-task-" + id])
        tap("search-close")
        enabled(app.buttons[title + " changed"])
        XCTAssertEqual(query.value as? String, first)
        selected("contexts-chip-" + first)
        tap("contexts-back")
        XCTAssertTrue(app.staticTexts["inbox-title"].waitForExistence(timeout: 10))
        app.terminate()
        app.launch()
        enabled(app.buttons["tab-menu"], timeout: 30)
        tap("tab-menu")
        tap("menu-contexts")
        XCTAssertTrue(query.waitForExistence(timeout: 10))
        queryText = ""
        searchChips(first)
        tap("contexts-chip-" + first)
        selected("contexts-chip-" + first)
        enabled(app.buttons[title + " changed"])
        tap("task-status-" + id)
        tap("task-complete")
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "contexts-empty").firstMatch.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons[title + " changed"].exists)
        tap("contexts-back")
    }

    func testTrashMenuSearchReturnAndRestart() {
        let app = XCUIApplication()
        app.launch()
        func tap(_ id: String, timeout: TimeInterval = 10) {
            let element = app.buttons.matching(identifier: id).firstMatch
            XCTAssertTrue(element.waitForExistence(timeout: timeout))
            expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: element)
            waitForExpectations(timeout: timeout)
            element.tap()
        }
        tap("tab-menu", timeout: 30)
        tap("menu-trash")
        XCTAssertTrue(app.staticTexts["trash-title"].waitForExistence(timeout: 10))
        tap("search-open")
        let query = app.textFields["search-input"]
        XCTAssertTrue(query.waitForExistence(timeout: 5))
        query.tap()
        query.typeText("Trash return " + String(UUID().uuidString.prefix(8)))
        tap("search-close")
        XCTAssertTrue(app.staticTexts["trash-title"].waitForExistence(timeout: 10))
        tap("trash-back")
        XCTAssertTrue(app.staticTexts["inbox-title"].waitForExistence(timeout: 10))
        app.terminate()
        app.launch()
        tap("tab-menu", timeout: 30)
        tap("menu-trash")
        XCTAssertTrue(app.staticTexts["trash-title"].waitForExistence(timeout: 10))
        tap("trash-back")
    }

    func testHistoryDoneFilterEditSearchArchiveAndRestart() {
        let app = XCUIApplication()
        app.launch()
        func enabled(_ element: XCUIElement, timeout: TimeInterval = 10) {
            XCTAssertTrue(element.waitForExistence(timeout: timeout))
            expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: element)
            waitForExpectations(timeout: timeout)
        }
        func tap(_ id: String) {
            let element = app.buttons.matching(identifier: id).firstMatch
            enabled(element)
            element.tap()
        }
        enabled(app.buttons["capture-open"], timeout: 30)
        tap("capture-open")
        let title = "iOS history " + String(UUID().uuidString.prefix(8))
        app.textViews["capture-input"].typeText(title + " #native-history")
        tap("capture-save")
        enabled(app.buttons[title])
        let id = String(app.buttons[title].identifier.dropFirst("task-title-".count))
        tap("task-status-" + id)
        tap("task-complete")
        tap("tab-menu")
        tap("menu-history")
        XCTAssertTrue(app.buttons["history-tab-done"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["history-tab-done"].isSelected)
        tap("done-overflow-button")
        tap("done-filter-action")
        let filter = app.textFields["done-filter-search"]
        XCTAssertTrue(filter.waitForExistence(timeout: 5))
        filter.tap()
        filter.typeText(title)
        tap("done-filters-close")
        enabled(app.buttons[title])
        app.buttons[title].tap()
        tap("task-mode-edit")
        let titleInput = app.descendants(matching: .any).matching(identifier: "task-editor-title").firstMatch
        titleInput.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.8)).tap()
        titleInput.typeText(" changed")
        tap("task-editor-save")
        enabled(app.buttons[title + " changed"])
        tap("search-open")
        let query = app.textFields["search-input"]
        XCTAssertTrue(query.waitForExistence(timeout: 5))
        query.tap()
        query.typeText(title)
        tap("search-filters-open")
        tap("search-include-completed")
        tap("search-filters-close")
        enabled(app.buttons["search-task-" + id])
        tap("search-close")
        enabled(app.buttons[title + " changed"])
        tap("history-tab-archived")
        let archiveQuery = app.textFields["archive-search"]
        // Core hides Archive search for an empty library until a filter is active.
        let archiveHasSearch = archiveQuery.waitForExistence(timeout: 5)
        if archiveHasSearch {
            archiveQuery.tap()
            archiveQuery.typeText("Archive query " + title)
        }
        enabled(app.buttons["archive-segment-projects"])
        tap("archive-segment-projects")
        XCTAssertTrue(app.buttons["archive-segment-projects"].isSelected)
        tap("history-tab-done")
        enabled(app.buttons[title + " changed"])
        tap("done-overflow-button")
        tap("done-filter-action")
        XCTAssertEqual(filter.value as? String, title)
        tap("done-filters-close")
        tap("history-tab-archived")
        XCTAssertTrue(app.buttons["archive-segment-projects"].isSelected)
        tap("archive-segment-tasks")
        if archiveHasSearch { XCTAssertEqual(archiveQuery.value as? String, "Archive query " + title) }
        tap("history-back")
        XCTAssertTrue(app.staticTexts["inbox-title"].waitForExistence(timeout: 10))
        app.terminate()
        app.launch()
        enabled(app.buttons["tab-menu"], timeout: 30)
        tap("tab-menu")
        tap("menu-history")
        tap("done-overflow-button")
        tap("done-filter-action")
        XCTAssertTrue(filter.waitForExistence(timeout: 5))
        filter.tap()
        filter.typeText(title)
        tap("done-filters-close")
        enabled(app.buttons[title + " changed"])
        app.buttons[title + " changed"].tap()
        tap("task-view-close")
    }

    func testReferenceFilterEditSearchAndRestart() {
        let app = XCUIApplication()
        app.launch()
        func enabled(_ element: XCUIElement, timeout: TimeInterval = 10) {
            XCTAssertTrue(element.waitForExistence(timeout: timeout))
            expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: element)
            waitForExpectations(timeout: timeout)
        }
        func tap(_ id: String) {
            let element = app.buttons.matching(identifier: id).firstMatch
            enabled(element)
            element.tap()
        }
        enabled(app.buttons["capture-open"], timeout: 30)
        tap("capture-open")
        let title = "iOS reference " + String(UUID().uuidString.prefix(8))
        app.textViews["capture-input"].typeText(title + " /reference #native-reference")
        tap("capture-save")
        tap("tab-menu")
        tap("menu-reference")
        tap("reference-overflow-button")
        XCTAssertTrue(app.buttons["reference-sort-action"].exists)
        XCTAssertTrue(app.buttons["reference-sort-action"].isEnabled)
        tap("reference-filter-action")
        let filter = app.textFields["reference-filter-search"]
        XCTAssertTrue(filter.waitForExistence(timeout: 5))
        filter.tap()
        filter.typeText(title)
        tap("reference-filters-close")
        enabled(app.buttons[title])
        let id = String(app.buttons[title].identifier.dropFirst("task-title-".count))
        app.buttons[title].tap()
        tap("task-mode-edit")
        let titleInput = app.descendants(matching: .any).matching(identifier: "task-editor-title").firstMatch
        titleInput.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.8)).tap()
        titleInput.typeText(" changed")
        tap("task-editor-save")
        enabled(app.buttons[title + " changed"])
        tap("search-open")
        let query = app.textFields["search-input"]
        XCTAssertTrue(query.waitForExistence(timeout: 5))
        query.tap()
        query.typeText(title)
        enabled(app.buttons["search-task-" + id])
        tap("search-close")
        enabled(app.buttons[title + " changed"])
        tap("reference-overflow-button")
        tap("reference-filter-action")
        XCTAssertEqual(filter.value as? String, title)
        tap("reference-filters-close")
        tap("reference-back")
        XCTAssertTrue(app.staticTexts["inbox-title"].waitForExistence(timeout: 10))
        app.terminate()
        app.launch()
        enabled(app.buttons["tab-menu"], timeout: 30)
        tap("tab-menu")
        tap("menu-reference")
        // A large Reference library may place the new task beyond the first window.
        tap("reference-overflow-button")
        tap("reference-filter-action")
        XCTAssertTrue(filter.waitForExistence(timeout: 5))
        filter.tap()
        filter.typeText(title)
        tap("reference-filters-close")
        enabled(app.buttons[title + " changed"])
        app.buttons[title + " changed"].tap()
        XCTAssertTrue(app.buttons["task-mode-edit"].waitForExistence(timeout: 10))
        tap("task-view-close")
    }

    func testSomedayGroupFilterEditSearchCompleteAndRestart() {
        let app = XCUIApplication()
        app.launch()
        func enabled(_ element: XCUIElement, timeout: TimeInterval = 10) {
            XCTAssertTrue(element.waitForExistence(timeout: timeout))
            expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: element)
            waitForExpectations(timeout: timeout)
        }
        func tap(_ id: String) {
            let element = app.buttons.matching(identifier: id).firstMatch
            enabled(element)
            element.tap()
        }
        enabled(app.buttons["capture-open"], timeout: 30)
        tap("capture-open")
        let title = "iOS someday " + String(UUID().uuidString.prefix(8))
        app.textViews["capture-input"].typeText(title + " /someday #native-someday")
        tap("capture-save")
        tap("tab-menu")
        tap("menu-someday")
        enabled(app.buttons[title])
        let id = String(app.buttons[title].identifier.dropFirst("task-title-".count))
        tap("someday-overflow-button")
        tap("someday-group-action")
        tap("someday-group-none")
        tap("someday-overflow-button")
        tap("someday-toggle-details")
        tap("someday-overflow-button")
        tap("someday-filter-action")
        let filter = app.textFields["someday-filter-search"]
        XCTAssertTrue(filter.waitForExistence(timeout: 5))
        filter.tap()
        filter.typeText(title)
        tap("someday-filters-close")
        enabled(app.buttons[title])
        app.buttons[title].tap()
        tap("task-mode-edit")
        let titleInput = app.descendants(matching: .any).matching(identifier: "task-editor-title").firstMatch
        titleInput.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.8)).tap()
        titleInput.typeText(" changed")
        tap("task-editor-save")
        enabled(app.buttons[title + " changed"])
        tap("search-open")
        let query = app.textFields["search-input"]
        XCTAssertTrue(query.waitForExistence(timeout: 5))
        query.tap()
        query.typeText(title)
        enabled(app.buttons["search-task-" + id])
        tap("search-close")
        enabled(app.buttons[title + " changed"])
        tap("task-status-" + id)
        tap("task-complete")
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.buttons[title + " changed"])
        waitForExpectations(timeout: 10)
        tap("someday-back")
        XCTAssertTrue(app.staticTexts["inbox-title"].waitForExistence(timeout: 10))
        app.terminate()
        app.launch()
        enabled(app.buttons["tab-menu"], timeout: 30)
        tap("tab-menu")
        tap("menu-someday")
        XCTAssertFalse(app.buttons[title + " changed"].exists)
    }

    func testWaitingPersonSearchEditCompleteAndRestart() {
        let app = XCUIApplication()
        app.launch()
        func enabled(_ element: XCUIElement, timeout: TimeInterval = 10) {
            XCTAssertTrue(element.waitForExistence(timeout: timeout))
            expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: element)
            waitForExpectations(timeout: timeout)
        }
        enabled(app.buttons["capture-open"], timeout: 30)
        app.buttons["capture-open"].tap()
        let suffix = String(UUID().uuidString.prefix(8))
        let title = "iOS waiting " + suffix
        let person = "Native person " + suffix
        app.textViews["capture-input"].typeText(title + " /waiting")
        app.buttons["capture-options"].tap()
        let note = app.descendants(matching: .any).matching(identifier: "capture-note").firstMatch
        XCTAssertTrue(note.waitForExistence(timeout: 5))
        note.tap()
        note.typeText("Waiting for: " + person)
        enabled(app.buttons["capture-save"])
        app.buttons["capture-save"].tap()
        enabled(app.buttons["tab-menu"])
        app.buttons["tab-menu"].tap()
        enabled(app.buttons["menu-waiting"])
        app.buttons["menu-waiting"].tap()
        XCTAssertTrue(app.staticTexts["waiting-title"].waitForExistence(timeout: 10))
        let chip = app.buttons["waiting-person-" + person]
        enabled(chip)
        chip.tap()
        enabled(app.buttons[title])
        let id = String(app.buttons[title].identifier.dropFirst("task-title-".count))
        app.buttons["search-open"].tap()
        let query = app.textFields["search-input"]
        XCTAssertTrue(query.waitForExistence(timeout: 5))
        query.tap()
        query.typeText(title)
        enabled(app.buttons["search-task-" + id])
        app.buttons["search-close"].tap()
        enabled(chip)
        XCTAssertTrue(chip.isSelected)
        app.buttons[title].tap()
        enabled(app.buttons["task-mode-edit"])
        app.buttons["task-mode-edit"].tap()
        let titleInput = app.descendants(matching: .any).matching(identifier: "task-editor-title").firstMatch
        titleInput.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.8)).tap()
        titleInput.typeText(" changed")
        app.buttons["task-editor-save"].tap()
        enabled(app.buttons[title + " changed"])
        XCTAssertTrue(chip.isSelected)
        app.buttons["task-status-" + id].tap()
        let complete = app.buttons.matching(identifier: "task-complete").firstMatch
        enabled(complete)
        complete.tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: chip)
        waitForExpectations(timeout: 10)
        XCTAssertFalse(app.buttons[title + " changed"].exists)
        XCTAssertTrue(app.buttons["waiting-person-all"].isSelected)
        app.buttons["waiting-back"].tap()
        XCTAssertTrue(app.staticTexts["inbox-title"].waitForExistence(timeout: 10))
        app.terminate()
        app.launch()
        enabled(app.buttons["tab-menu"], timeout: 30)
        app.buttons["tab-menu"].tap()
        enabled(app.buttons["menu-waiting"])
        app.buttons["menu-waiting"].tap()
        XCTAssertTrue(app.staticTexts["waiting-title"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons[title + " changed"].exists)
    }

    func testAreaCreateDuplicateCancelColorAndProjectRelaunch() {
        let app = XCUIApplication()
        let library = UUID().uuidString.lowercased()
        app.launchArguments = ["--native-ui-test-library", library]
        print("Area creation isolated library: " + library)
        app.launch()
        func openProjects() {
            boardTap(app, "tab-menu")
            boardTap(app, "menu-projects")
            boardEnabled(app.buttons["projects-manage-areas"])
        }
        boardEnabled(app.buttons["tab-menu"], timeout: 30)
        openProjects()
        boardTap(app, "projects-manage-areas")
        let name = app.textFields["area-create-name"]
        let save = app.buttons["area-create-save"]
        let scroll = app.scrollViews["area-manager-scroll"]
        boardEnabled(name)
        XCTAssertFalse(save.isEnabled)
        name.tap(); name.typeText("Native Area Green")
        let green = app.buttons["area-create-color-#10b981"]
        revealPagedElement(app, green, in: scroll)
        boardTap(app, green.identifier)
        XCTAssertTrue(green.isSelected)
        revealPagedElement(app, save, in: scroll)
        boardEnabled(save)
        XCTAssertGreaterThanOrEqual(save.frame.height, 44)
        save.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: name)
        waitForExpectations(timeout: 15)
        boardTap(app, "projects-manage-areas")
        boardEnabled(name)
        XCTAssertTrue(app.staticTexts["Native Area Green"].exists)
        revealPagedElement(app, green, in: scroll)
        XCTAssertTrue(green.isSelected, "RN retains the selected creation color")
        revealPagedElement(app, name, in: scroll)
        name.tap(); name.typeText(" native area green ")
        XCTAssertTrue(app.staticTexts["area-create-name-taken"].waitForExistence(timeout: 10))
        XCTAssertFalse(save.isEnabled)
        replaceTextView(name, with: "Cancelled Area")
        revealPagedElement(app, app.buttons["area-create-cancel"], in: scroll)
        let cancel = app.buttons["area-create-cancel"]
        boardEnabled(cancel)
        XCTAssertGreaterThanOrEqual(cancel.frame.height, 44)
        cancel.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.5)).tap()
        boardEnabled(app.buttons["projects-manage-areas"])
        let project = app.textFields["projects-create-title"]
        project.tap(); project.typeText("Area project")
        let chip = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label == %@",
            "projects-create-area-", "Native Area Green")).firstMatch
        boardEnabled(chip)
        chip.tap()
        XCTAssertTrue(chip.isSelected)
        boardTap(app, "projects-create-add")
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@",
            "project-open-", "Area project")).firstMatch
        boardEnabled(row)
        let projectID = row.identifier
        app.terminate(); app.launch()
        boardEnabled(app.buttons["tab-menu"], timeout: 30)
        openProjects()
        boardEnabled(app.buttons[projectID])
        boardTap(app, "projects-manage-areas")
        boardEnabled(name)
        XCTAssertTrue(app.staticTexts["Native Area Green"].exists)
        XCTAssertFalse(app.staticTexts["Cancelled Area"].exists)
        boardTap(app, "area-manager-close")
    }

    func testAreaColorNonePresetProjectPropagationAndRelaunch() {
        let app = XCUIApplication()
        let library = UUID().uuidString.lowercased()
        app.launchArguments = ["--native-ui-test-library", library]
        print("Area color isolated library: " + library)
        app.launch()
        func openProjects() {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu")
            boardTap(app, "menu-projects")
            boardEnabled(app.buttons["projects-manage-areas"])
        }
        openProjects()
        boardTap(app, "projects-manage-areas")
        let name = app.textFields["area-create-name"]
        let scroll = app.scrollViews["area-manager-scroll"]
        boardEnabled(name)
        name.tap(); name.typeText("Color Work")
        let save = app.buttons["area-create-save"]
        revealPagedElement(app, save, in: scroll)
        boardTap(app, "area-create-save")
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: name)
        waitForExpectations(timeout: 15)
        let project = app.textFields["projects-create-title"]
        boardEnabled(project)
        project.tap(); project.typeText("Color project")
        let chip = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label == %@",
            "projects-create-area-", "Color Work")).firstMatch
        boardEnabled(chip); chip.tap()
        boardTap(app, "projects-create-add")
        boardEnabled(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@",
            "project-open-", "Color project")).firstMatch)
        boardTap(app, "projects-manage-areas")
        boardEnabled(name)
        let dot = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "area-color-open-")).firstMatch
        boardEnabled(dot)
        let areaID = String(dot.identifier.dropFirst("area-color-open-".count))
        name.tap(); name.typeText("Retained creation draft")
        let green = app.buttons["area-create-color-#10b981"]
        revealPagedElement(app, green, in: scroll)
        boardTap(app, green.identifier)
        revealPagedElement(app, dot, in: scroll)
        boardTap(app, dot.identifier)
        let red = app.buttons["area-color-" + areaID + "-#ef4444"]
        revealPagedElement(app, red, in: scroll)
        boardTap(app, red.identifier)
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: red)
        waitForExpectations(timeout: 15)
        boardEnabled(dot)
        XCTAssertEqual(name.value as? String, "Retained creation draft")
        revealPagedElement(app, green, in: scroll)
        XCTAssertTrue(green.isSelected, "Editing an Area keeps the independent creation color")
        revealPagedElement(app, dot, in: scroll)
        boardTap(app, dot.identifier)
        revealPagedElement(app, red, in: scroll)
        XCTAssertTrue(red.isSelected)
        let none = app.buttons["area-color-" + areaID + "-none"]
        revealPagedElement(app, none, in: scroll)
        boardTap(app, none.identifier)
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: none)
        waitForExpectations(timeout: 15)
        boardEnabled(dot)
        XCTAssertEqual(name.value as? String, "Retained creation draft")
        boardTap(app, "area-manager-close")
        app.terminate(); app.launch()
        openProjects()
        boardEnabled(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@",
            "project-open-", "Color project")).firstMatch)
        boardTap(app, "projects-manage-areas")
        boardTap(app, "area-color-open-" + areaID)
        revealPagedElement(app, none, in: scroll)
        XCTAssertTrue(none.isSelected)
        XCTAssertFalse(app.staticTexts["Retained creation draft"].exists)
        boardTap(app, "area-manager-close")
    }

    func testProjectFlowControlsAndRelaunch() throws {
        try projectFlowControls(library: "d69109d6-f924-47ba-9c02-e1394b1cf895")
    }

    func testProjectFlowControlsLargestTextAndRelaunch() throws {
        try projectFlowControls(library: "05230751-96f3-4736-a883-917223d4c202")
    }

    private func projectFlowControls(library: String) throws {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", library]
        app.launch()
        let targetID = "776dd5c5-1926-4da1-96ff-5d5096971050"
        func projects() {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
            boardEnabled(app.textFields["projects-create-title"])
        }
        func open(_ id: String) {
            let row = app.buttons["project-open-" + id]
            let scroll = app.scrollViews["projects-scroll"]
            for _ in 0..<12 {
                var viewport = scroll.frame.intersection(app.frame)
                if app.keyboards.firstMatch.exists {
                    viewport.size.height = max(0, min(viewport.maxY, app.keyboards.firstMatch.frame.minY) - viewport.minY)
                }
                func scrollVisibleViewport(up: Bool) {
                    let origin = app.coordinate(withNormalizedOffset: .zero)
                    let top = viewport.minY + 30
                    let bottom = viewport.maxY - 30
                    origin.withOffset(CGVector(dx: viewport.midX, dy: up ? bottom : top))
                        .press(forDuration: 0.05, thenDragTo: origin.withOffset(CGVector(dx: viewport.midX, dy: up ? top : bottom)))
                }
                if row.exists {
                    let visible = row.frame.intersection(viewport)
                    if row.isHittable && visible.height >= 44 && visible.width >= 44 {
                        app.coordinate(withNormalizedOffset: .zero)
                            .withOffset(CGVector(dx: visible.midX, dy: visible.midY)).tap()
                        boardEnabled(app.buttons["project-details-toggle"])
                        return
                    }
                    if row.frame.minY < viewport.minY { scrollVisibleViewport(up: false) }
                    else { scrollVisibleViewport(up: true) }
                } else { scrollVisibleViewport(up: true) }
            }
            XCTFail("Project flow fixture row is not tappable")
        }
        func tap(_ id: String) {
            let button = app.buttons[id]
            revealPagedElement(app, button, in: app.scrollViews.firstMatch)
            boardEnabled(button)
            XCTAssertGreaterThanOrEqual(button.frame.height + 0.000001, 44)
            button.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: button.frame.width - 4, dy: 4)).tap()
        }
        func type(_ expected: String) {
            let label = app.staticTexts["project-detail-meta-type"]
            XCTAssertTrue(label.waitForExistence(timeout: 15))
            let match = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", expected), object: label)
            XCTAssertEqual(XCTWaiter.wait(for: [match], timeout: 15), .completed)
        }
        func selected(_ scope: String) {
            let match = XCTNSPredicateExpectation(predicate: NSPredicate(format: "selected == true"),
                object: app.buttons["project-flow-scope-" + scope])
            XCTAssertEqual(XCTWaiter.wait(for: [match], timeout: 15), .completed)
        }
        projects()
        let input = app.textFields["projects-create-title"]
        input.tap(); input.typeText("Retained flow Project draft")
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 10))
        let keyboardLaidOut = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let frame = keyboard.frame
            return frame.height > 100 && frame.maxY <= app.frame.maxY + 1
                && app.scrollViews["projects-scroll"].frame.maxY <= frame.minY
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [keyboardLaidOut], timeout: 10), .completed)
        open(targetID)
        XCTAssertEqual(app.buttons["project-details-toggle"].value as? String, "Expand")
        tap("project-details-toggle"); type("Parallel")
        XCTAssertFalse(app.buttons["project-flow-scope-project"].exists)
        tap("project-flow-type"); type("Sequential")
        selected("project")
        tap("project-flow-scope-project") // Materialize the missing raw scope once.
        boardTap(app, "project-back"); open(targetID); tap("project-details-toggle"); selected("project")
        tap("project-flow-scope-project") // The repeated exact scope is a no-op.
        boardTap(app, "project-back"); open(targetID); tap("project-details-toggle"); selected("project")
        tap("project-flow-scope-section")
        selected("section")
        tap("project-flow-type"); type("Parallel")
        XCTAssertFalse(app.buttons["project-flow-scope-section"].exists)
        tap("project-flow-type"); type("Sequential")
        selected("section")
        tap("project-flow-scope-project")
        selected("project")
        let task = app.buttons["task-title-ca84a4da-ed78-4860-8b63-1f6412ec93bd"]
        revealPagedElement(app, task, in: app.scrollViews.firstMatch)
        XCTAssertTrue(task.exists)
        boardTap(app, "project-back")
        XCTAssertEqual(input.value as? String, "Retained flow Project draft")
        let archived = app.buttons["projects-section-archived"]
        revealPagedElement(app, archived, in: app.scrollViews["projects-scroll"])
        if archived.value as? String == "Expand" { archived.tap() }
        open("98432619-81dd-480e-9c35-d4dfa1705ff1")
        tap("project-details-toggle")
        XCTAssertTrue(app.staticTexts["project-detail-meta-type"].exists)
        XCTAssertFalse(app.buttons["project-flow-type"].exists && app.buttons["project-flow-type"].isEnabled)
        app.terminate(); app.launch(); projects(); open(targetID)
        XCTAssertEqual(app.buttons["project-details-toggle"].value as? String, "Expand")
        tap("project-details-toggle"); type("Sequential")
        selected("project")
        revealPagedElement(app, task, in: app.scrollViews.firstMatch)
        XCTAssertTrue(task.exists)
    }

    func testProjectNotesPreviewPagingAndTaskMarkdown() {
        projectNotesPreview(library: "c0ca7600-ff4b-4048-8891-9873a28e2f7c")
    }

    func testProjectNotesPreviewLargestText() {
        projectNotesPreview(library: "a48bb446-b1bc-45aa-9d2d-3f51d8b2acbe")
    }

    private func projectNotesPreview(library: String) {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", library]
        app.launch()
        func projects() {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
            boardEnabled(app.textFields["projects-create-title"])
        }
        func open(_ id: String) {
            let row = app.buttons["project-open-" + id]
            revealPagedElement(app, row, in: app.scrollViews["projects-scroll"])
            row.tap(); boardEnabled(app.buttons["project-details-toggle"])
            XCTAssertEqual(app.buttons["project-details-toggle"].value as? String, "Expand")
        }
        func tap(_ id: String) {
            let button = app.buttons[id]
            revealPagedElement(app, button, in: app.scrollViews.firstMatch)
            boardEnabled(button)
            XCTAssertGreaterThanOrEqual(button.frame.height + 0.000001, 44)
            button.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: button.frame.width - 4, dy: 4)).tap()
        }
        func text(_ label: String) {
            let value = app.staticTexts[label]
            revealPagedElement(app, value, in: app.scrollViews.firstMatch)
            XCTAssertTrue(value.exists)
        }
        func notes() {
            tap("project-details-toggle")
            XCTAssertEqual(app.buttons["project-notes-toggle"].value as? String, "Expand")
            tap("project-notes-toggle")
            XCTAssertEqual(app.buttons["project-notes-toggle"].value as? String, "Collapse")
            if app.buttons["project-notes-mode-preview"].exists {
                tap("project-notes-mode-preview")
            }
        }
        projects(); open("776dd5c5-1926-4da1-96ff-5d5096971050")
        XCTAssertFalse(app.buttons["project-notes-toggle"].exists)
        notes(); text("Project notes heading")
        XCTAssertFalse(app.staticTexts["Last notes page"].exists)
        tap("project-notes-more")
        text("Last notes page")
        text("Bold and italic and code.")
        text("Notes checked item")
        let copy = app.buttons["Copy code"]
        revealPagedElement(app, copy, in: app.scrollViews.firstMatch)
        XCTAssertGreaterThanOrEqual(copy.frame.height + 0.000001, 44)
        copy.tap()
        XCTAssertFalse(app.buttons["project-notes-more"].exists)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Project Notes preview"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        tap("project-notes-toggle")
        XCTAssertFalse(app.staticTexts["Last notes page"].exists)
        tap("project-notes-toggle")
        tap("project-notes-mode-preview")
        text("Last notes page")
        XCTAssertFalse(app.buttons["project-notes-more"].exists)
        tap("project-details-toggle"); tap("project-details-toggle")
        XCTAssertEqual(app.buttons["project-notes-toggle"].value as? String, "Collapse")
        tap("project-details-toggle")
        let task = app.buttons["task-title-ca84a4da-ed78-4860-8b63-1f6412ec93bd"]
        revealPagedElement(app, task, in: app.scrollViews.firstMatch)
        task.tap(); boardEnabled(app.buttons["task-view-close"])
        text("Task Markdown heading")
        text("Task bold and italic.")
        let check = app.buttons["task-view-checklist-toggle-0"]
        revealPagedElement(app, check, in: app.scrollViews["task-editor-scroll"])
        XCTAssertEqual(check.label, "Task **checklist** item")
        XCTAssertNotEqual(check.value as? String, "Done")
        check.tap()
        let checked = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "Done"), object: check)
        XCTAssertEqual(XCTWaiter.wait(for: [checked], timeout: 15), .completed)
        boardTap(app, "task-view-close"); boardTap(app, "task-editor-discard")
        boardEnabled(app.buttons["project-back"])
        boardTap(app, "project-back")
        open("86e22c70-2149-43b5-b30f-b037518f5309"); notes()
        let empty = app.staticTexts["project-notes-empty"]
        revealPagedElement(app, empty, in: app.scrollViews.firstMatch)
        XCTAssertEqual(empty.label, "None")
        boardTap(app, "project-back")
        open("120596fd-e02e-4187-8403-c70bcd0fb35a"); notes()
        let failure = app.staticTexts["project-notes-error"]
        XCTAssertTrue(failure.waitForExistence(timeout: 15))
        tap("project-notes-retry")
        XCTAssertTrue(failure.waitForExistence(timeout: 15))
        boardTap(app, "project-back")
        let closed = app.buttons["projects-section-archived"]
        revealPagedElement(app, closed, in: app.scrollViews["projects-scroll"])
        if closed.value as? String == "Expand" { closed.tap() }
        open("98432619-81dd-480e-9c35-d4dfa1705ff1"); notes()
        text("ملاحظات المشروع")
        text("مرحبا بالعالم")
        XCTAssertFalse(app.staticTexts["project-notes-error"].exists)
        app.terminate(); app.launch(); projects()
        open("776dd5c5-1926-4da1-96ff-5d5096971050"); notes()
        text("Project notes heading")
        XCTAssertFalse(app.staticTexts["Last notes page"].exists)
        XCTAssertTrue(app.buttons["project-notes-more"].exists)
    }

    func testMarkdownCodeCopyLargestText() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", "39a7bb97-a880-4480-861b-3b58b8527a3b"]
        app.launch()
        boardEnabled(app.buttons["tab-menu"], timeout: 30)
        boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
        let project = app.buttons["project-open-776dd5c5-1926-4da1-96ff-5d5096971050"]
        revealPagedElement(app, project, in: app.scrollViews["projects-scroll"])
        project.tap(); boardTap(app, "project-details-toggle")
        let notes = app.buttons["project-notes-toggle"]
        revealPagedElement(app, notes, in: app.scrollViews.firstMatch)
        notes.tap()
        let preview = app.buttons["project-notes-mode-preview"]
        if preview.exists {
            revealPagedElement(app, preview, in: app.scrollViews.firstMatch)
            preview.tap()
        }
        func copy(_ title: String) {
            let button = app.buttons["Copy code"]
            revealPagedElement(app, button, in: app.scrollViews.firstMatch)
            XCTAssertEqual(button.frame.width, 44, accuracy: 0.001)
            XCTAssertEqual(button.frame.height, 44, accuracy: 0.001)
            button.tap()
            let capture = XCTAttachment(screenshot: app.screenshot())
            capture.name = title
            capture.lifetime = .keepAlways
            add(capture)
        }
        copy("Project Notes copy at largest text")
        let details = app.buttons["project-details-toggle"]
        revealPagedElement(app, details, in: app.scrollViews.firstMatch)
        details.tap()
        let task = app.buttons["task-title-ca84a4da-ed78-4860-8b63-1f6412ec93bd"]
        revealPagedElement(app, task, in: app.scrollViews.firstMatch)
        task.tap(); boardEnabled(app.buttons["task-view-close"])
        copy("Task Markdown copy at largest text")
        boardTap(app, "task-view-close")
    }

    func testProjectDateSaveFailureKeepsPickerDraft() {
        projectDateRecovery(expectFailure: true)
    }

    func testProjectDateColdWriteRecovery() {
        projectDateRecovery(expectFailure: false)
    }

    private func projectDateRecovery(expectFailure: Bool) {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", "7f249d6d-f39a-435b-984a-9b7f2ff28a45"]
        app.launch()
        if expectFailure {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
        } else {
            boardEnabled(app.textFields["projects-create-title"], timeout: 30)
        }
        let row = app.buttons["project-open-776dd5c5-1926-4da1-96ff-5d5096971050"]
        revealPagedElement(app, row, in: app.scrollViews["projects-scroll"])
        row.tap(); boardTap(app, "project-details-toggle")
        let open = app.buttons["project-start-date-open"]
        revealPagedElement(app, open, in: app.scrollViews.firstMatch)
        boardEnabled(open); open.tap()
        let picker = app.datePickers["project-date-picker"]
        XCTAssertTrue(picker.waitForExistence(timeout: 10))
        let day = picker.pickerWheels.allElementsBoundByIndex.first {
            guard let value = $0.value as? String, let number = Int(value) else { return false }
            return (1...31).contains(number)
        }
        XCTAssertNotNil(day)
        guard let day else { return }
        let sheet = app.scrollViews["project-date-sheet"]
        func tap(_ id: String) {
            let button = app.buttons[id]
            revealPagedElement(app, button, in: sheet)
            boardEnabled(button)
            XCTAssertGreaterThanOrEqual(button.frame.height + 0.000001, 44)
            button.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: button.frame.width - 4, dy: 4)).tap()
        }
        if expectFailure {
            XCTAssertEqual(day.value as? String, "8")
            day.adjust(toPickerWheelValue: "9")
            let selected = picker.pickerWheels.allElementsBoundByIndex.map { $0.value as? String ?? "" }
            tap("project-date-done")
            let failure = app.staticTexts["project-date-error"]
            XCTAssertTrue(failure.waitForExistence(timeout: 15))
            for _ in 0..<2 {
                XCTAssertFalse(app.buttons["project-date-cancel"].isEnabled)
                XCTAssertFalse(app.buttons["project-date-done"].isEnabled)
                XCTAssertFalse(picker.isEnabled)
                XCTAssertEqual(picker.pickerWheels.allElementsBoundByIndex.map { $0.value as? String ?? "" }, selected)
                tap("project-date-retry")
                boardEnabled(app.buttons["project-date-retry"])
                XCTAssertTrue(failure.exists)
            }
            let capture = XCTAttachment(screenshot: app.screenshot())
            capture.name = "Project date failed save retains wheel draft"
            capture.lifetime = .keepAlways; add(capture)
        } else {
            XCTAssertEqual(day.value as? String, "9")
            XCTAssertFalse(app.staticTexts["project-date-error"].exists)
            tap("project-date-cancel")
            boardTap(app, "project-back")
        }
        app.terminate()
    }

    func testProjectSectionCreateFailureKeepsDraft() {
        projectSectionFailure(expectFailure: true)
    }

    func testProjectSectionCreateColdRecovery() {
        projectSectionFailure(expectFailure: false)
    }

    private func projectSectionFailure(expectFailure: Bool) {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", "b489f62a-41b6-44af-8582-b5af0045fc96"]
        app.launch()
        if !expectFailure {
            XCTAssertTrue(app.staticTexts["projects-title"].waitForExistence(timeout: 30))
        } else {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
        }
        func tap(_ id: String) {
            let button = app.buttons[id]
            revealPagedElement(app, button, in: app.scrollViews["project-sections-scroll"].exists ? app.scrollViews["project-sections-scroll"] : app.scrollViews.firstMatch)
            boardEnabled(button)
            XCTAssertGreaterThanOrEqual(button.frame.height + 0.000001, 44)
            button.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: button.frame.width - 4, dy: 4)).tap()
        }
        let project = app.buttons["project-open-776dd5c5-1926-4da1-96ff-5d5096971050"]
        revealPagedElement(app, project, in: app.scrollViews["projects-scroll"])
        project.tap(); boardEnabled(app.buttons["project-details-toggle"])
        tap("project-details-toggle"); tap("project-sections-open")
        let title = app.textFields["project-section-title"]
        let rows = app.staticTexts.matching(NSPredicate(format: "identifier BEGINSWITH %@", "project-section-row-"))
        if expectFailure {
            tap("project-section-add")
            revealPagedElement(app, title, in: app.scrollViews["project-sections-scroll"].exists ? app.scrollViews["project-sections-scroll"] : app.scrollViews.firstMatch)
            title.tap(); title.typeText("Retry Section")
            tap("project-section-save")
            let failure = app.staticTexts["project-section-error"]
            XCTAssertTrue(failure.waitForExistence(timeout: 20))
            for _ in 0..<2 {
                XCTAssertEqual(title.value as? String, "Retry Section")
                XCTAssertFalse(title.isEnabled)
                XCTAssertFalse(app.buttons["project-section-cancel"].isEnabled)
                XCTAssertFalse(app.buttons["project-section-save"].isEnabled)
                XCTAssertFalse(app.buttons["project-sections-close"].isEnabled)
                XCTAssertEqual(rows.count, 0)
                tap("project-section-retry")
                boardEnabled(app.buttons["project-section-retry"], timeout: 20)
                XCTAssertTrue(failure.exists)
            }
            let capture = XCTAttachment(screenshot: app.screenshot())
            capture.name = "Section creation failed save retains exact title"
            capture.lifetime = .keepAlways; add(capture)
        } else {
            XCTAssertFalse(title.exists)
            XCTAssertFalse(app.staticTexts["project-section-error"].exists)
            XCTAssertEqual(rows.count, 1)
            XCTAssertEqual(rows.firstMatch.label, "Retry Section")
            boardTap(app, "project-sections-close")
            tap("project-sections-open")
            XCTAssertEqual(rows.count, 1)
            boardTap(app, "project-sections-close"); boardTap(app, "project-back")
        }
        app.terminate()
    }

    func testProjectSectionCreateAndRelaunch() {
        projectSectionCreation(library: "f2062175-b09a-4485-9f2b-98cf248274f1")
    }

    func testProjectSectionCreateLargestTextAndRelaunch() {
        projectSectionCreation(library: "2b2a9d05-de6f-4cac-a983-f8680cc356fb")
    }

    private func projectSectionCreation(library: String) {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", library]
        app.launch()
        let target = "776dd5c5-1926-4da1-96ff-5d5096971050"
        let title = app.textFields["project-section-title"]
        let rows = app.staticTexts.matching(NSPredicate(format: "identifier BEGINSWITH %@", "project-section-row-"))
        func projects() {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
        }
        func tap(_ id: String) {
            let button = app.buttons[id]
            revealPagedElement(app, button, in: app.scrollViews["project-sections-scroll"].exists ? app.scrollViews["project-sections-scroll"] : app.scrollViews.firstMatch)
            boardEnabled(button)
            XCTAssertGreaterThanOrEqual(button.frame.height + 0.000001, 44)
            button.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: button.frame.width - 4, dy: 4)).tap()
        }
        func open(_ id: String = "776dd5c5-1926-4da1-96ff-5d5096971050") {
            let row = app.buttons["project-open-" + id]
            revealPagedElement(app, row, in: app.scrollViews["projects-scroll"])
            row.tap(); boardEnabled(app.buttons["project-details-toggle"])
            tap("project-details-toggle")
        }
        func saved(_ count: Int) {
            let closed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: title)
            XCTAssertEqual(XCTWaiter.wait(for: [closed], timeout: 15), .completed)
            XCTAssertEqual(rows.count, count)
            XCTAssertTrue(rows.allElementsBoundByIndex.allSatisfy { $0.label == "Native Section" })
        }
        projects()
        let draft = app.textFields["projects-create-title"]
        draft.tap(); draft.typeText("Retained Section Project draft")
        open()
        tap("project-notes-toggle")
        let notes = app.textViews["project-notes-input"]
        revealPagedElement(app, notes, in: app.scrollViews["project-sections-scroll"].exists ? app.scrollViews["project-sections-scroll"] : app.scrollViews.firstMatch)
        replaceProjectNotesText(notes, with: "Notes before Sections\n")
        tap("project-sections-open") // First tap must join the dirty Notes save.
        boardEnabled(app.buttons["project-section-add"])
        XCTAssertFalse(app.buttons["project-back"].isHittable)
        XCTAssertEqual(rows.count, 0)
        tap("project-section-add")
        revealPagedElement(app, title, in: app.scrollViews["project-sections-scroll"].exists ? app.scrollViews["project-sections-scroll"] : app.scrollViews.firstMatch)
        XCTAssertFalse(app.buttons["project-section-save"].isEnabled)
        title.tap(); title.typeText("Discarded Section")
        tap("project-section-cancel")
        XCTAssertFalse(title.exists); XCTAssertEqual(rows.count, 0)
        tap("project-section-add")
        revealPagedElement(app, title, in: app.scrollViews["project-sections-scroll"].exists ? app.scrollViews["project-sections-scroll"] : app.scrollViews.firstMatch)
        title.tap(); title.typeText("  Native Section  \n")
        saved(1)
        tap("project-section-add")
        revealPagedElement(app, title, in: app.scrollViews["project-sections-scroll"].exists ? app.scrollViews["project-sections-scroll"] : app.scrollViews.firstMatch)
        title.tap(); title.typeText("Native Section")
        tap("project-section-save") // Duplicate titles are allowed by RN.
        saved(2)
        let identifiers = rows.allElementsBoundByIndex.map(\.identifier).sorted()
        XCTAssertEqual(Set(identifiers).count, 2)
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "Created duplicate-titled Sections retain distinct identities"
        capture.lifetime = .keepAlways; add(capture)
        boardTap(app, "project-sections-close")
        XCTAssertEqual(notes.value as? String, "Notes before Sections\n")
        XCTAssertEqual(app.staticTexts["project-detail-meta-sections"].label, "Native Section\nNative Section")
        boardTap(app, "project-back")
        XCTAssertEqual(draft.value as? String, "Retained Section Project draft")
        let archived = app.buttons["projects-section-archived"]
        revealPagedElement(app, archived, in: app.scrollViews["projects-scroll"])
        if archived.value as? String == "Expand" { archived.tap() }
        open("98432619-81dd-480e-9c35-d4dfa1705ff1")
        tap("project-sections-open")
        XCTAssertFalse(app.buttons["project-section-add"].exists)
        XCTAssertFalse(title.exists)
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows.firstMatch.label, "Archived metadata section")
        boardTap(app, "project-sections-close"); boardTap(app, "project-back")
        app.terminate(); app.launch(); projects(); open(target)
        tap("project-sections-open")
        XCTAssertEqual(rows.allElementsBoundByIndex.map(\.identifier).sorted(), identifiers)
        saved(2)
        boardTap(app, "project-sections-close")
        tap("project-notes-toggle")
        XCTAssertEqual(notes.value as? String, "Notes before Sections\n")
        let task = app.buttons["task-title-ca84a4da-ed78-4860-8b63-1f6412ec93bd"]
        revealPagedElement(app, task, in: app.scrollViews["project-sections-scroll"].exists ? app.scrollViews["project-sections-scroll"] : app.scrollViews.firstMatch)
        task.tap(); boardEnabled(app.buttons["task-view-close"]); boardTap(app, "task-view-close")
        boardTap(app, "project-back")
        app.terminate()
    }

    func testProjectSectionOrderAndRelaunch() {
        projectSectionOrder(library: "d354d682-4947-4cb7-b435-0eb356ab6302")
    }

    func testProjectSectionOrderLargestTextAndRelaunch() {
        projectSectionOrder(library: "e27e7c0b-54bd-4200-b8d9-c61bf5f58c5c")
    }

    private func projectSectionOrder(library: String) {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", library]
        app.launch()
        let first = "d3918ccf-d6bf-4317-b93e-cf229334b0b4"
        let second = "7ede4d8e-359b-4612-8d5f-f0f11e9218a9"
        let third = "6eb78a42-e503-4098-a905-b703935fe657"
        func scroll() -> XCUIElement {
            let sheet = app.scrollViews["project-sections-scroll"]
            return sheet.exists ? sheet : app.scrollViews.firstMatch
        }
        func tap(_ id: String) {
            let button = app.buttons[id]
            revealPagedElement(app, button, in: scroll()); boardEnabled(button)
            XCTAssertGreaterThanOrEqual(button.frame.height + 0.000001, 44)
            button.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: button.frame.width - 4, dy: 4)).tap()
        }
        func projects() {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
        }
        func open(_ id: String = "776dd5c5-1926-4da1-96ff-5d5096971050") {
            let row = app.buttons["project-open-" + id]
            revealPagedElement(app, row, in: app.scrollViews["projects-scroll"])
            row.tap(); tap("project-details-toggle")
        }
        func assertOrder(_ ids: [String]) {
            boardEnabled(app.buttons["project-sections-close"])
            let rows = app.staticTexts.matching(NSPredicate(format: "identifier BEGINSWITH %@", "project-section-row-"))
            XCTAssertEqual(rows.allElementsBoundByIndex.map(\.identifier), ids.map { "project-section-row-" + $0 })
            XCTAssertFalse(app.buttons["project-section-up-" + ids.first!].isEnabled)
            XCTAssertFalse(app.buttons["project-section-down-" + ids.last!].isEnabled)
        }
        projects()
        let draft = app.textFields["projects-create-title"]
        draft.tap(); draft.typeText("Retained Section order Project")
        open(); tap("project-notes-toggle")
        let notes = app.textViews["project-notes-input"]
        revealPagedElement(app, notes, in: scroll())
        replaceProjectNotesText(notes, with: "Notes before Section order\n")
        tap("project-sections-open"); assertOrder([first, second, third])
        XCTAssertEqual(app.staticTexts["project-section-row-" + first].label, "Renamed Section")
        XCTAssertEqual(app.staticTexts["project-section-row-" + second].label, "Renamed Section")
        tap("project-section-down-" + first); assertOrder([second, first, third])
        tap("project-section-up-" + third); assertOrder([second, third, first])
        tap("project-section-up-" + first); assertOrder([second, first, third])
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "Section order RN controls and duplicate titles"
        capture.lifetime = .keepAlways; add(capture)
        boardTap(app, "project-sections-close")
        XCTAssertEqual(notes.value as? String, "Notes before Section order\n")
        boardTap(app, "project-back"); XCTAssertEqual(draft.value as? String, "Retained Section order Project")
        let archived = app.buttons["projects-section-archived"]
        revealPagedElement(app, archived, in: app.scrollViews["projects-scroll"])
        if archived.value as? String == "Expand" { archived.tap() }
        open("98432619-81dd-480e-9c35-d4dfa1705ff1"); tap("project-sections-open")
        for prefix in ["project-section-up-", "project-section-down-"] {
            XCTAssertEqual(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", prefix)).count, 0)
        }
        boardTap(app, "project-sections-close"); boardTap(app, "project-back")
        app.terminate(); app.launch(); projects(); open(); tap("project-sections-open")
        assertOrder([second, first, third])
        boardTap(app, "project-sections-close"); tap("project-notes-toggle")
        XCTAssertEqual(notes.value as? String, "Notes before Section order\n")
        boardTap(app, "project-back"); app.terminate()
    }

    func testProjectSectionOrderFailureKeepsIntent() {
        projectSectionOrderRecovery(expectFailure: true)
    }

    func testProjectSectionOrderColdRecovery() {
        projectSectionOrderRecovery(expectFailure: false)
    }

    private func projectSectionOrderRecovery(expectFailure: Bool) {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", "e0b4ab84-f022-4568-9fa8-274c04b72ffb"]
        app.launch()
        if expectFailure {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
        } else { XCTAssertTrue(app.staticTexts["projects-title"].waitForExistence(timeout: 30)) }
        let project = app.buttons["project-open-776dd5c5-1926-4da1-96ff-5d5096971050"]
        revealPagedElement(app, project, in: app.scrollViews["projects-scroll"]); project.tap()
        func tap(_ id: String) {
            let sheet = app.scrollViews["project-sections-scroll"]
            let button = app.buttons[id]
            revealPagedElement(app, button, in: sheet.exists ? sheet : app.scrollViews.firstMatch)
            boardEnabled(button); XCTAssertGreaterThanOrEqual(button.frame.height + 0.000001, 44)
            button.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: button.frame.width - 4, dy: 4)).tap()
        }
        tap("project-details-toggle"); tap("project-sections-open")
        let first = "d3918ccf-d6bf-4317-b93e-cf229334b0b4"
        let second = "7ede4d8e-359b-4612-8d5f-f0f11e9218a9"
        let third = "6eb78a42-e503-4098-a905-b703935fe657"
        let rows = app.staticTexts.matching(NSPredicate(format: "identifier BEGINSWITH %@", "project-section-row-"))
        if expectFailure {
            tap("project-section-down-" + first)
            let failure = app.staticTexts["project-section-error"]
            XCTAssertTrue(failure.waitForExistence(timeout: 20))
            for _ in 0..<2 {
                XCTAssertEqual(rows.allElementsBoundByIndex.map(\.identifier), [first, second, third].map { "project-section-row-" + $0 })
                for id in ["project-section-add", "project-sections-close"] + [first, second, third].flatMap({ id in
                    ["project-section-edit-", "project-section-delete-", "project-section-up-", "project-section-down-"].map { $0 + id }
                }) { XCTAssertFalse(app.buttons[id].isEnabled) }
                tap("project-section-retry"); boardEnabled(app.buttons["project-section-retry"], timeout: 20)
                XCTAssertTrue(failure.exists)
            }
            let capture = XCTAttachment(screenshot: app.screenshot())
            capture.name = "Section order failed save retains exact intent"
            capture.lifetime = .keepAlways; add(capture)
        } else {
            XCTAssertEqual(rows.allElementsBoundByIndex.map(\.identifier), [second, first, third].map { "project-section-row-" + $0 })
            XCTAssertFalse(app.staticTexts["project-section-error"].exists)
            XCTAssertFalse(app.buttons["project-section-up-" + second].isEnabled)
            XCTAssertFalse(app.buttons["project-section-down-" + third].isEnabled)
            boardEnabled(app.buttons["project-section-add"])
            boardTap(app, "project-sections-close"); boardTap(app, "project-back")
        }
        app.terminate()
    }

    func testProjectSectionDeleteAndRelaunch() {
        projectSectionDelete(library: "35d7ec08-3a52-439e-a708-8491a089675b")
    }

    func testProjectSectionDeleteLargestTextAndRelaunch() {
        projectSectionDelete(library: "3ba501ae-f34f-437b-8c81-9aa9503c38bf")
    }

    private func projectSectionDelete(library: String) {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", library]
        app.launch()
        let first = "d3918ccf-d6bf-4317-b93e-cf229334b0b4"
        let second = "7ede4d8e-359b-4612-8d5f-f0f11e9218a9"
        func scroll() -> XCUIElement {
            let sheet = app.scrollViews["project-sections-scroll"]
            return sheet.exists ? sheet : app.scrollViews.firstMatch
        }
        func tap(_ id: String) {
            let button = app.buttons[id]
            revealPagedElement(app, button, in: scroll()); boardEnabled(button)
            XCTAssertGreaterThanOrEqual(button.frame.height + 0.000001, 44)
            button.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: button.frame.width - 4, dy: 4)).tap()
        }
        func projects() {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
        }
        func open(_ id: String = "776dd5c5-1926-4da1-96ff-5d5096971050") {
            let row = app.buttons["project-open-" + id]
            revealPagedElement(app, row, in: app.scrollViews["projects-scroll"])
            row.tap(); boardEnabled(app.buttons["project-details-toggle"]); tap("project-details-toggle")
        }
        projects()
        let draft = app.textFields["projects-create-title"]
        draft.tap(); draft.typeText("Retained Section delete Project")
        open(); tap("project-notes-toggle")
        let notes = app.textViews["project-notes-input"]
        revealPagedElement(app, notes, in: scroll())
        replaceProjectNotesText(notes, with: "Notes before Section delete\n")
        tap("project-sections-open")
        XCTAssertEqual(app.staticTexts["project-section-row-" + first].label, "Renamed Section")
        tap("project-section-delete-" + first)
        let cancel = app.alerts.buttons.matching(identifier: "Cancel").firstMatch
        boardEnabled(cancel); cancel.tap()
        XCTAssertTrue(app.staticTexts["project-section-row-" + first].exists)
        XCTAssertTrue(app.staticTexts["project-section-row-" + second].exists)
        tap("project-section-delete-" + first)
        let confirm = app.alerts.buttons.matching(identifier: "Delete").firstMatch
        boardEnabled(confirm)
        let confirmation = XCTAttachment(screenshot: app.screenshot())
        confirmation.name = "Section deletion explicit confirmation"
        confirmation.lifetime = .keepAlways; add(confirmation)
        confirm.tap()
        let removed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"),
            object: app.staticTexts["project-section-row-" + first])
        XCTAssertEqual(XCTWaiter.wait(for: [removed], timeout: 15), .completed)
        boardEnabled(app.buttons["project-sections-close"])
        XCTAssertEqual(app.staticTexts["project-section-row-" + second].label, "Renamed Section")
        XCTAssertFalse(app.buttons["project-section-delete-" + first].exists)
        XCTAssertEqual(app.staticTexts.matching(NSPredicate(format: "identifier BEGINSWITH %@", "project-section-row-")).count, 1)
        boardTap(app, "project-sections-close")
        XCTAssertEqual(notes.value as? String, "Notes before Section delete\n")
        boardTap(app, "project-back"); XCTAssertEqual(draft.value as? String, "Retained Section delete Project")
        let archived = app.buttons["projects-section-archived"]
        revealPagedElement(app, archived, in: app.scrollViews["projects-scroll"])
        if archived.value as? String == "Expand" { archived.tap() }
        open("98432619-81dd-480e-9c35-d4dfa1705ff1"); tap("project-sections-open")
        XCTAssertEqual(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "project-section-delete-")).count, 0)
        boardTap(app, "project-sections-close"); boardTap(app, "project-back")
        app.terminate(); app.launch(); projects(); open(); tap("project-sections-open")
        XCTAssertFalse(app.staticTexts["project-section-row-" + first].exists)
        XCTAssertEqual(app.staticTexts["project-section-row-" + second].label, "Renamed Section")
        boardTap(app, "project-sections-close"); tap("project-notes-toggle")
        XCTAssertEqual(notes.value as? String, "Notes before Section delete\n")
        boardTap(app, "project-back"); app.terminate()
    }

    func testProjectSectionDeleteFailureKeepsIntent() {
        projectSectionDeleteRecovery(expectFailure: true)
    }

    func testProjectSectionDeleteColdRecovery() {
        projectSectionDeleteRecovery(expectFailure: false)
    }

    private func projectSectionDeleteRecovery(expectFailure: Bool) {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", "8281bd09-1e45-48ee-9fca-8cf8b0dc53a2"]
        app.launch()
        if expectFailure {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
        } else { XCTAssertTrue(app.staticTexts["projects-title"].waitForExistence(timeout: 30)) }
        let project = app.buttons["project-open-776dd5c5-1926-4da1-96ff-5d5096971050"]
        revealPagedElement(app, project, in: app.scrollViews["projects-scroll"]); project.tap()
        func tap(_ id: String) {
            let sheet = app.scrollViews["project-sections-scroll"]
            let button = app.buttons[id]
            revealPagedElement(app, button, in: sheet.exists ? sheet : app.scrollViews.firstMatch)
            boardEnabled(button); XCTAssertGreaterThanOrEqual(button.frame.height + 0.000001, 44)
            button.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: button.frame.width - 4, dy: 4)).tap()
        }
        tap("project-details-toggle"); tap("project-sections-open")
        let first = "d3918ccf-d6bf-4317-b93e-cf229334b0b4"
        let second = "7ede4d8e-359b-4612-8d5f-f0f11e9218a9"
        if expectFailure {
            tap("project-section-delete-" + first)
            let confirm = app.alerts.buttons.matching(identifier: "Delete").firstMatch
            boardEnabled(confirm); confirm.tap()
            let failure = app.staticTexts["project-section-error"]
            XCTAssertTrue(failure.waitForExistence(timeout: 20))
            for _ in 0..<2 {
                XCTAssertEqual(app.staticTexts["project-section-row-" + first].label, "Renamed Section")
                for id in ["project-section-add", "project-sections-close",
                    "project-section-edit-" + first, "project-section-delete-" + first,
                    "project-section-edit-" + second, "project-section-delete-" + second] {
                    XCTAssertFalse(app.buttons[id].isEnabled)
                }
                tap("project-section-retry"); boardEnabled(app.buttons["project-section-retry"], timeout: 20)
                XCTAssertTrue(failure.exists)
            }
            let capture = XCTAttachment(screenshot: app.screenshot())
            capture.name = "Section deletion failed save retains exact intent"
            capture.lifetime = .keepAlways; add(capture)
        } else {
            XCTAssertFalse(app.staticTexts["project-section-row-" + first].exists)
            XCTAssertEqual(app.staticTexts["project-section-row-" + second].label, "Renamed Section")
            XCTAssertFalse(app.staticTexts["project-section-error"].exists)
            boardEnabled(app.buttons["project-section-add"])
            boardTap(app, "project-sections-close"); boardTap(app, "project-back")
        }
        app.terminate()
    }

    func testProjectSectionRenameAndRelaunch() {
        projectSectionRename(library: "3d8d172f-e857-40a2-b3f9-ada98105e1a1")
    }

    func testProjectSectionRenameLargestTextAndRelaunch() {
        projectSectionRename(library: "4689f51e-c1c0-4e10-9495-f92d47dc3411")
    }

    private func projectSectionRename(library: String) {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", library]
        app.launch()
        let first = "d3918ccf-d6bf-4317-b93e-cf229334b0b4"
        let second = "7ede4d8e-359b-4612-8d5f-f0f11e9218a9"
        let title = app.textFields["project-section-title"]
        let rows = app.staticTexts.matching(NSPredicate(format: "identifier BEGINSWITH %@", "project-section-row-"))
        func scroll() -> XCUIElement {
            let sheet = app.scrollViews["project-sections-scroll"]
            return sheet.exists ? sheet : app.scrollViews.firstMatch
        }
        func tap(_ id: String) {
            let button = app.buttons[id]
            revealPagedElement(app, button, in: scroll()); boardEnabled(button)
            XCTAssertGreaterThanOrEqual(button.frame.height + 0.000001, 44)
            button.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: button.frame.width - 4, dy: 4)).tap()
        }
        func projects() {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
        }
        func open(_ id: String = "776dd5c5-1926-4da1-96ff-5d5096971050") {
            let row = app.buttons["project-open-" + id]
            revealPagedElement(app, row, in: app.scrollViews["projects-scroll"])
            row.tap(); boardEnabled(app.buttons["project-details-toggle"]); tap("project-details-toggle")
        }
        func edit(_ id: String, _ value: String) {
            tap("project-section-edit-" + id); boardEnabled(title)
            revealPagedElement(app, title, in: scroll()); replaceTextView(title, with: value, tapOffset: CGVector(dx: 0.85, dy: 0.5))
        }
        func saved(_ id: String, _ value: String) {
            let closed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: title)
            XCTAssertEqual(XCTWaiter.wait(for: [closed], timeout: 15), .completed)
            XCTAssertEqual(app.staticTexts["project-section-row-" + id].label, value)
            XCTAssertEqual(rows.count, 2)
        }
        projects()
        let draft = app.textFields["projects-create-title"]
        draft.tap(); draft.typeText("Retained Section rename Project")
        open(); tap("project-notes-toggle")
        let notes = app.textViews["project-notes-input"]
        revealPagedElement(app, notes, in: scroll())
        replaceProjectNotesText(notes, with: "Notes before Section rename\n")
        tap("project-sections-open")
        tap("project-section-edit-" + first); boardEnabled(title)
        XCTAssertEqual(title.value as? String, "Native Section")
        revealPagedElement(app, title, in: scroll()); replaceTextView(title, with: "   ", tapOffset: CGVector(dx: 0.85, dy: 0.5))
        XCTAssertFalse(app.buttons["project-section-save"].isEnabled)
        tap("project-section-cancel"); saved(first, "Native Section")
        edit(first, " Native Section "); tap("project-section-save"); saved(first, "Native Section")
        edit(first, " Renamed Section "); title.typeText("\n"); saved(first, "Renamed Section")
        edit(second, "Renamed Section"); tap("project-section-save"); saved(second, "Renamed Section")
        XCTAssertEqual(Set(rows.allElementsBoundByIndex.map(\.identifier)),
            Set(["project-section-row-" + first, "project-section-row-" + second]))
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "Renamed duplicate Sections preserve identities"
        capture.lifetime = .keepAlways; add(capture)
        boardTap(app, "project-sections-close")
        XCTAssertEqual(notes.value as? String, "Notes before Section rename\n")
        boardTap(app, "project-back"); XCTAssertEqual(draft.value as? String, "Retained Section rename Project")
        let archived = app.buttons["projects-section-archived"]
        revealPagedElement(app, archived, in: app.scrollViews["projects-scroll"])
        if archived.value as? String == "Expand" { archived.tap() }
        open("98432619-81dd-480e-9c35-d4dfa1705ff1"); tap("project-sections-open")
        XCTAssertEqual(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "project-section-edit-")).count, 0)
        XCTAssertFalse(title.exists); boardTap(app, "project-sections-close"); boardTap(app, "project-back")
        app.terminate(); app.launch(); projects(); open(); tap("project-sections-open")
        saved(first, "Renamed Section"); saved(second, "Renamed Section")
        boardTap(app, "project-sections-close"); tap("project-notes-toggle")
        XCTAssertEqual(notes.value as? String, "Notes before Section rename\n")
        boardTap(app, "project-back"); app.terminate()
    }

    func testProjectSectionRenameFailureKeepsDraft() {
        projectSectionRenameRecovery(expectFailure: true)
    }

    func testProjectSectionRenameColdRecovery() {
        projectSectionRenameRecovery(expectFailure: false)
    }

    private func projectSectionRenameRecovery(expectFailure: Bool) {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", "5433200b-f0f1-467f-977c-c5333c1de27b"]
        app.launch()
        if expectFailure {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
        } else { XCTAssertTrue(app.staticTexts["projects-title"].waitForExistence(timeout: 30)) }
        let project = app.buttons["project-open-776dd5c5-1926-4da1-96ff-5d5096971050"]
        revealPagedElement(app, project, in: app.scrollViews["projects-scroll"]); project.tap()
        func tap(_ id: String) {
            let sheet = app.scrollViews["project-sections-scroll"]
            let button = app.buttons[id]
            revealPagedElement(app, button, in: sheet.exists ? sheet : app.scrollViews.firstMatch)
            boardEnabled(button); XCTAssertGreaterThanOrEqual(button.frame.height + 0.000001, 44)
            button.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: button.frame.width - 4, dy: 4)).tap()
        }
        tap("project-details-toggle"); tap("project-sections-open")
        let first = "d3918ccf-d6bf-4317-b93e-cf229334b0b4"
        let title = app.textFields["project-section-title"]
        if expectFailure {
            tap("project-section-edit-" + first); boardEnabled(title)
            revealPagedElement(app, title, in: app.scrollViews["project-sections-scroll"])
            replaceTextView(title, with: "Retry Section rename", tapOffset: CGVector(dx: 0.85, dy: 0.5)); tap("project-section-save")
            let failure = app.staticTexts["project-section-error"]
            XCTAssertTrue(failure.waitForExistence(timeout: 20))
            for _ in 0..<2 {
                XCTAssertEqual(title.value as? String, "Retry Section rename")
                XCTAssertFalse(title.isEnabled)
                for id in ["project-section-save", "project-section-cancel", "project-sections-close"] {
                    XCTAssertFalse(app.buttons[id].isEnabled)
                }
                XCTAssertEqual(app.staticTexts["project-section-row-" + first].label, "Native Section")
                tap("project-section-retry"); boardEnabled(app.buttons["project-section-retry"], timeout: 20)
                XCTAssertTrue(failure.exists)
            }
            let capture = XCTAttachment(screenshot: app.screenshot())
            capture.name = "Section rename failed save retains exact draft"
            capture.lifetime = .keepAlways; add(capture)
        } else {
            XCTAssertFalse(title.exists)
            XCTAssertEqual(app.staticTexts["project-section-row-" + first].label, "Retry Section rename")
            XCTAssertEqual(app.staticTexts["project-section-row-7ede4d8e-359b-4612-8d5f-f0f11e9218a9"].label, "Native Section")
            boardTap(app, "project-sections-close"); tap("project-sections-open")
            XCTAssertEqual(app.staticTexts["project-section-row-" + first].label, "Retry Section rename")
            boardTap(app, "project-sections-close"); boardTap(app, "project-back")
        }
        app.terminate()
    }

    func testProjectTagsAndNotes() {
        projectTagsFlow(library: "6ae40cb9-dffd-4ac2-b975-c8fb9541b8d3")
    }

    func testProjectTagsLargestText() {
        projectTagsFlow(library: "fc910ca9-85a8-4c65-8060-1f5ee079b4ce")
    }

    private func revealProjectTagControl(_ app: XCUIApplication, _ element: XCUIElement, towardTop: Bool = false) {
        let sheet = app.scrollViews["project-tags-sheet"]
        XCTAssertTrue(sheet.waitForExistence(timeout: 10))
        for _ in 0..<40 {
            let frame = sheet.frame.intersection(app.frame)
            if element.exists && element.isHittable && element.frame.minY >= frame.minY
                && element.frame.maxY <= frame.maxY { return }
            let above = element.exists ? element.frame.minY < frame.minY : towardTop
            if above { sheet.swipeDown() } else { sheet.swipeUp() }
        }
        XCTFail("Tags control could not be scrolled into view")
    }

    private func projectTagsFlow(library: String) {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", library]
        app.launch()
        let target = "776dd5c5-1926-4da1-96ff-5d5096971050"
        func scroll() -> XCUIElement {
            let sheet = app.scrollViews["project-tags-sheet"]
            return sheet.exists ? sheet : app.scrollViews.firstMatch
        }
        func tapButton(_ button: XCUIElement, towardTop: Bool = false) {
            if app.scrollViews["project-tags-sheet"].exists { revealProjectTagControl(app, button, towardTop: towardTop) }
            else { revealPagedElement(app, button, in: scroll(), outerEdge: true) }
            boardEnabled(button)
            XCTAssertGreaterThanOrEqual(button.frame.height + 0.000001, 48)
            button.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: button.frame.width - 4, dy: 4)).tap()
        }
        func tap(_ id: String) {
            tapButton(app.buttons[id], towardTop: ["project-tags-add", "project-tags-close"].contains(id))
        }
        func tag(_ value: String) -> XCUIElement {
            // Lazy rows enter the accessibility tree when scrolled into view.
            let candidate = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label == %@",
                "project-tags-choice-", value)).firstMatch
            revealProjectTagControl(app, candidate)
            let matches = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "project-tags-choice-"))
                .allElementsBoundByIndex.filter { $0.label.utf8.elementsEqual(value.utf8) }
            XCTAssertEqual(matches.count, 1, value)
            return matches.first ?? app.buttons["missing-tag-choice"]
        }
        func fill(_ id: String, _ text: String) {
            let field = app.textFields[id]
            if app.scrollViews["project-tags-sheet"].exists { revealProjectTagControl(app, field) }
            else { revealPagedElement(app, field, in: scroll(), outerEdge: true) }
            boardEnabled(field); field.tap()
            field.typeKey("a", modifierFlags: .command); field.typeText(text)
            XCTAssertTrue((field.value as? String ?? "").utf8.elementsEqual(text.utf8))
        }
        func closed() {
            let condition = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"),
                object: app.buttons["project-tags-close"])
            XCTAssertEqual(XCTWaiter.wait(for: [condition], timeout: 15), .completed)
        }
        func projects() {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
        }
        func open(_ id: String = "776dd5c5-1926-4da1-96ff-5d5096971050") {
            let row = app.buttons["project-open-" + id]
            revealPagedElement(app, row, in: app.scrollViews["projects-scroll"])
            row.tap(); boardTap(app, "project-details-toggle")
        }
        func addTag(_ value: String) {
            tap("project-tags-add"); fill("project-tags-create-name", value)
            tap("project-tags-create-save"); closed()
        }
        projects(); fill("projects-create-title", "Retained Tags project draft")
        boardTap(app, "area-open"); boardTap(app, "area-option-__none__")
        boardEnabled(app.buttons["area-option-__none__"])
        XCTAssertTrue(app.buttons["area-option-__none__"].isSelected)
        app.buttons["area-dismiss"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
        open()
        revealPagedElement(app, app.buttons["project-notes-toggle"], in: scroll(), outerEdge: true)
        boardTap(app, "project-notes-toggle")
        let notes = app.textViews["project-notes-input"]
        revealPagedElement(app, notes, in: scroll(), outerEdge: true)
        replaceProjectNotesText(notes, with: "Notes before Tags opens\n")
        tap("project-tags-open")
        XCTAssertTrue(tag("#caf\u{00E9}").isSelected)
        XCTAssertTrue(tag("#cafe\u{0301}").isSelected)
        XCTAssertTrue(tag("bare").isSelected)
        tap("project-tags-add"); XCTAssertFalse(app.buttons["project-tags-create-save"].isEnabled)
        tap("project-tags-create-cancel")
        addTag("   ") // RN blank input is a no-op; do not rewrite duplicate legacy tags.
        tap("project-tags-open"); XCTAssertTrue(tag("#Keep").isSelected)
        addTag("  Added Tag  ")
        tap("project-tags-open"); XCTAssertTrue(tag("#Added Tag").isSelected)
        tapButton(tag("#Added Tag")); closed()
        tap("project-tags-open"); tapButton(tag("#Option-29")); closed()
        tap("project-tags-open"); XCTAssertTrue(tag("#Option-29").isSelected)
        tap("project-tags-clear"); closed()
        tap("project-tags-open"); XCTAssertFalse(tag("#Option-29").isSelected)
        tap("project-tags-clear"); closed() // Already empty must not add a revision.
        tap("project-tags-open"); addTag("Final Tag")
        XCTAssertEqual(app.staticTexts["project-detail-meta-tags"].label, "#Final Tag")
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "Project Tags and Notes preserved"
        capture.lifetime = .keepAlways; add(capture)
        boardTap(app, "project-back")
        XCTAssertEqual(app.textFields["projects-create-title"].value as? String, "Retained Tags project draft")
        XCTAssertTrue(app.buttons["projects-create-area-none"].isSelected)
        XCTAssertTrue(app.buttons["project-open-" + target].exists)
        boardTap(app, "area-open"); XCTAssertTrue(app.buttons["area-option-__none__"].isSelected)
        boardTap(app, "area-option-__all__"); boardEnabled(app.buttons["area-option-__all__"])
        app.buttons["area-dismiss"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
        let archived = "98432619-81dd-480e-9c35-d4dfa1705ff1"
        let archivedSection = app.buttons["projects-section-archived"]
        revealPagedElement(app, archivedSection, in: app.scrollViews["projects-scroll"])
        if archivedSection.value as? String == "Expand" { archivedSection.tap() }
        open(archived); XCTAssertFalse(app.buttons["project-tags-open"].exists)
        app.terminate(); app.launch(); projects(); open()
        XCTAssertEqual(app.staticTexts["project-detail-meta-tags"].label, "#Final Tag")
        tap("project-tags-open"); XCTAssertTrue(tag("#Final Tag").isSelected)
        tap("project-tags-close")
        revealPagedElement(app, app.buttons["project-notes-toggle"], in: scroll(), outerEdge: true)
        boardTap(app, "project-notes-toggle")
        XCTAssertEqual(notes.value as? String, "Notes before Tags opens\n")
        app.terminate()
    }

    func testProjectTagsFailureKeepsDraft() { projectTagsRecovery(expectFailure: true) }
    func testProjectTagsColdRecovery() { projectTagsRecovery(expectFailure: false) }

    private func projectTagsRecovery(expectFailure: Bool) {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", "003e2d6e-741f-4f42-ab3b-8cc0b19bc823"]
        app.launch()
        if expectFailure {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
        } else { boardEnabled(app.textFields["projects-create-title"], timeout: 30) }
        let row = app.buttons["project-open-776dd5c5-1926-4da1-96ff-5d5096971050"]
        revealPagedElement(app, row, in: app.scrollViews["projects-scroll"])
        row.tap(); boardTap(app, "project-details-toggle")
        func tap(_ id: String) {
            let button = app.buttons[id]; let sheet = app.scrollViews["project-tags-sheet"]
            if sheet.exists { revealProjectTagControl(app, button, towardTop: id == "project-tags-close") }
            else { revealPagedElement(app, button, in: app.scrollViews.firstMatch, outerEdge: true) }
            boardEnabled(button); XCTAssertGreaterThanOrEqual(button.frame.height + 0.000001, 48)
            button.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: button.frame.width - 4, dy: 4)).tap()
        }
        tap("project-tags-open")
        if expectFailure {
            tap("project-tags-add")
            let name = app.textFields["project-tags-create-name"]
            boardEnabled(name); name.tap(); name.typeText("  Recover Tags  ")
            tap("project-tags-create-save")
            XCTAssertTrue(app.staticTexts["project-tags-error"].waitForExistence(timeout: 15))
            for _ in 0..<2 {
                XCTAssertFalse(app.buttons["project-tags-close"].isEnabled)
                XCTAssertFalse(name.isEnabled)
                XCTAssertEqual(name.value as? String, "  Recover Tags  ")
                XCTAssertFalse(app.buttons["project-tags-create-save"].isEnabled)
                XCTAssertFalse(app.buttons["project-tags-create-cancel"].isEnabled)
                tap("project-tags-retry"); boardEnabled(app.buttons["project-tags-retry"])
            }
            let capture = XCTAttachment(screenshot: app.screenshot())
            capture.name = "Failed Tags save retains exact input"
            capture.lifetime = .keepAlways; add(capture)
        } else {
            let choice = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label == %@",
                "project-tags-choice-", "#Recover Tags"))
            revealProjectTagControl(app, choice.firstMatch)
            XCTAssertEqual(choice.count, 1); XCTAssertTrue(choice.firstMatch.isSelected)
            XCTAssertFalse(app.staticTexts["project-tags-error"].exists)
            tap("project-tags-close")
        }
        app.terminate()
    }

    func testProjectAddAreaAndNotes() {
        projectAddAreaFlow(library: "e97d0d0a-14b4-46d8-82b7-c24cd0a8756b")
    }

    func testProjectAddAreaLargestText() {
        projectAddAreaFlow(library: "02add2f6-6904-4d51-82c5-7546a51fe06b")
    }

    private func projectAddAreaFlow(library: String) {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", library]
        app.launch()
        let target = "776dd5c5-1926-4da1-96ff-5d5096971050"
        let title = "Added Project Area"
        func scroll() -> XCUIElement {
            if app.scrollViews["project-area-sheet"].exists { return app.scrollViews["project-area-sheet"] }
            if app.scrollViews["area-manager-scroll"].exists { return app.scrollViews["area-manager-scroll"] }
            return app.scrollViews.firstMatch
        }
        func tap(_ id: String, minimum: CGFloat = 48) {
            let button = app.buttons[id]
            revealPagedElement(app, button, in: scroll(), outerEdge: true)
            boardEnabled(button)
            XCTAssertGreaterThanOrEqual(button.frame.height + 0.000001, minimum)
            button.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: button.frame.width - 4, dy: 4)).tap()
        }
        func fill(_ id: String, _ text: String) {
            let field = app.textFields[id]
            revealPagedElement(app, field, in: scroll(), outerEdge: true)
            boardEnabled(field); field.tap()
            field.typeKey("a", modifierFlags: .command)
            field.typeText(text)
            XCTAssertEqual(field.value as? String, text)
        }
        func projects() {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
        }
        func open() {
            let row = app.buttons["project-open-" + target]
            revealPagedElement(app, row, in: app.scrollViews["projects-scroll"])
            row.tap(); boardTap(app, "project-details-toggle")
        }
        func closed(_ id: String) {
            let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.buttons[id])
            XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 15), .completed)
        }
        projects()
        fill("projects-create-title", "Retained Add Area project draft")
        boardTap(app, "projects-manage-areas")
        fill("area-create-name", "Retained manager Area draft")
        revealPagedElement(app, app.buttons["area-create-color-#ef4444"], in: scroll(), outerEdge: true)
        boardTap(app, "area-create-color-#ef4444")
        boardTap(app, "area-manager-close")
        boardTap(app, "area-open")
        XCTAssertFalse(app.keyboards.firstMatch.exists)
        boardTap(app, "area-option-__none__")
        boardEnabled(app.buttons["area-option-__none__"])
        XCTAssertTrue(app.buttons["area-option-__none__"].isSelected)
        app.buttons["area-dismiss"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
        open()
        revealPagedElement(app, app.buttons["project-notes-toggle"], in: scroll(), outerEdge: true)
        boardTap(app, "project-notes-toggle")
        let notes = app.textViews["project-notes-input"]
        revealPagedElement(app, notes, in: scroll(), outerEdge: true)
        replaceProjectNotesText(notes, with: "Notes before Add Area\n")
        tap("project-area-open"); tap("project-area-add")
        XCTAssertFalse(app.buttons["project-area-create-save"].isEnabled)
        tap("project-area-create-cancel")
        XCTAssertTrue(app.buttons["project-area-none"].isSelected)
        tap("project-area-add")
        fill("project-area-create-name", "   ")
        let checkedName = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"),
            object: app.descendants(matching: .any).matching(identifier: "project-area-create-name-checking").firstMatch)
        XCTAssertEqual(XCTWaiter.wait(for: [checkedName], timeout: 10), .completed)
        XCTAssertFalse(app.buttons["project-area-create-save"].isEnabled)
        XCTAssertFalse(app.buttons["project-area-create-read-retry"].exists)
        fill("project-area-create-name", "Metadata Area")
        XCTAssertTrue(app.staticTexts["project-area-create-name-taken"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["project-area-create-save"].isEnabled)
        fill("project-area-create-name", "  " + title + "  ")
        tap("project-area-create-color-#10b981", minimum: 44)
        tap("project-area-create-save")
        closed("project-area-close")
        XCTAssertEqual(app.staticTexts["project-detail-meta-area"].label, title)
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "Created Area assigned with Notes preserved"
        capture.lifetime = .keepAlways; add(capture)
        tap("project-area-open")
        let choice = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label == %@",
            "project-area-choice-", title))
        XCTAssertEqual(choice.count, 1)
        XCTAssertTrue(choice.firstMatch.isSelected)
        tap(choice.firstMatch.identifier); closed("project-area-close")
        boardTap(app, "project-back")
        XCTAssertEqual(app.textFields["projects-create-title"].value as? String, "Retained Add Area project draft")
        XCTAssertTrue(app.buttons["projects-create-area-none"].isSelected)
        XCTAssertFalse(app.buttons["project-open-" + target].exists)
        boardTap(app, "area-open")
        XCTAssertTrue(app.buttons["area-option-__none__"].isSelected)
        boardTap(app, "area-option-__all__"); boardEnabled(app.buttons["area-option-__all__"])
        app.buttons["area-dismiss"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
        boardTap(app, "projects-manage-areas")
        XCTAssertEqual(app.textFields["area-create-name"].value as? String, "Retained manager Area draft")
        let red = app.buttons["area-create-color-#ef4444"]
        revealPagedElement(app, red, in: scroll(), outerEdge: true)
        XCTAssertTrue(red.isSelected)
        boardTap(app, "area-manager-close")
        app.terminate(); app.launch(); projects(); open()
        XCTAssertEqual(app.staticTexts["project-detail-meta-area"].label, title)
        tap("project-area-open")
        XCTAssertEqual(choice.count, 1); XCTAssertTrue(choice.firstMatch.isSelected)
        tap("project-area-close")
        revealPagedElement(app, app.buttons["project-notes-toggle"], in: scroll(), outerEdge: true)
        boardTap(app, "project-notes-toggle")
        XCTAssertEqual(notes.value as? String, "Notes before Add Area\n")
        app.terminate()
    }

    func testProjectAddAreaCreateFailure() {
        projectAddAreaRecovery(createPhase: true, expectFailure: true)
    }

    func testProjectAddAreaCreateColdRecovery() {
        projectAddAreaRecovery(createPhase: true, expectFailure: false)
    }

    func testProjectAddAreaAssignmentFailure() {
        projectAddAreaRecovery(createPhase: false, expectFailure: true)
    }

    func testProjectAddAreaAssignmentColdRecovery() {
        projectAddAreaRecovery(createPhase: false, expectFailure: false)
    }

    private func projectAddAreaRecovery(createPhase: Bool, expectFailure: Bool) {
        let app = XCUIApplication()
        let library = createPhase ? "1c42be0d-eb75-4e5e-b6c9-6f773e9208a8" : "05f235e0-3a86-4105-aa49-f0e48280210f"
        let title = createPhase ? "Recover Created Area" : "Recover Assigned Area"
        app.launchArguments = ["--native-ui-test-library", library]
        app.launch()
        if expectFailure {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
        } else { boardEnabled(app.textFields["projects-create-title"], timeout: 30) }
        let row = app.buttons["project-open-776dd5c5-1926-4da1-96ff-5d5096971050"]
        revealPagedElement(app, row, in: app.scrollViews["projects-scroll"])
        row.tap(); boardTap(app, "project-details-toggle")
        func tap(_ id: String, minimum: CGFloat = 48) {
            let button = app.buttons[id]
            let sheet = app.scrollViews["project-area-sheet"]
            revealPagedElement(app, button, in: sheet.exists ? sheet : app.scrollViews.firstMatch, outerEdge: true)
            boardEnabled(button); XCTAssertGreaterThanOrEqual(button.frame.height + 0.000001, minimum)
            button.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: button.frame.width - 4, dy: 4)).tap()
        }
        tap("project-area-open")
        if expectFailure {
            tap("project-area-add")
            let name = app.textFields["project-area-create-name"]
            revealPagedElement(app, name, in: app.scrollViews["project-area-sheet"], outerEdge: true)
            boardEnabled(name); name.tap(); name.typeText(title)
            tap("project-area-create-color-#10b981", minimum: 44)
            tap("project-area-create-save")
            let error = app.staticTexts[createPhase ? "project-area-create-error" : "project-area-error"]
            XCTAssertTrue(error.waitForExistence(timeout: 15))
            for _ in 0..<2 {
                XCTAssertFalse(app.buttons["project-area-close"].isEnabled)
                if createPhase {
                    XCTAssertFalse(name.isEnabled)
                    XCTAssertEqual(name.value as? String, title)
                    XCTAssertFalse(app.buttons["project-area-create-save"].isEnabled)
                    XCTAssertFalse(app.buttons["project-area-create-cancel"].isEnabled)
                    tap("project-area-create-retry"); boardEnabled(app.buttons["project-area-create-retry"])
                } else {
                    let choice = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label == %@",
                        "project-area-choice-", title)).firstMatch
                    XCTAssertTrue(choice.isSelected); XCTAssertFalse(choice.isEnabled)
                    XCTAssertFalse(app.buttons["project-area-none"].isEnabled)
                    tap("project-area-retry"); boardEnabled(app.buttons["project-area-retry"])
                }
                XCTAssertTrue(error.exists)
            }
            let capture = XCTAttachment(screenshot: app.screenshot())
            capture.name = createPhase ? "Area creation failure keeps exact draft" : "Area assignment failure keeps created Area"
            capture.lifetime = .keepAlways; add(capture)
        } else {
            let choice = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label == %@",
                "project-area-choice-", title))
            XCTAssertEqual(choice.count, 1)
            XCTAssertEqual(choice.firstMatch.isSelected, !createPhase)
            XCTAssertEqual(app.buttons["project-area-none"].isSelected, createPhase)
            XCTAssertFalse(app.staticTexts["project-area-error"].exists)
            tap("project-area-close")
        }
        app.terminate()
    }

    func testProjectAreaAndNotes() {
        projectAreaSelection(library: "a7085484-e69d-4193-8041-bd496971e640")
    }

    func testProjectAreaLargestText() {
        projectAreaSelection(library: "2fb190cc-0959-4031-aaf0-267f1d9d3f32")
    }

    private func projectAreaSelection(library: String) {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", library]
        app.launch()
        let target = "776dd5c5-1926-4da1-96ff-5d5096971050"
        let areaID = "3abf38fa-7ec4-45f4-ad79-4e30f08b78ad"
        let choice = "project-area-choice-" + areaID
        let notes = app.textViews["project-notes-input"]
        func tap(_ id: String) {
            let button = app.buttons[id]
            let sheet = app.scrollViews["project-area-sheet"]
            revealPagedElement(app, button, in: sheet.exists ? sheet : app.scrollViews.firstMatch, outerEdge: true)
            boardEnabled(button)
            XCTAssertGreaterThanOrEqual(button.frame.height + 0.000001, 48)
            button.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: button.frame.width - 4, dy: 4)).tap()
        }
        func open(_ id: String) {
            let row = app.buttons["project-open-" + id]
            revealPagedElement(app, row, in: app.scrollViews["projects-scroll"])
            row.tap(); boardTap(app, "project-details-toggle")
        }
        func select(_ id: String) {
            tap(id)
            let closed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.buttons["project-area-close"])
            XCTAssertEqual(XCTWaiter.wait(for: [closed], timeout: 15), .completed)
        }
        func projects() {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
        }
        projects()
        let draft = app.textFields["projects-create-title"]
        draft.tap(); draft.typeText("Retained Area assignment draft")
        open(target)
        tap("project-area-open")
        XCTAssertTrue(app.buttons["project-area-none"].isSelected)
        XCTAssertFalse(app.buttons["project-area-choice-5f6a5911-186b-4680-9e42-63c90f1c7c31"].exists)
        XCUIDevice.shared.press(.home)
        app.activate()
        boardEnabled(app.buttons["project-area-none"])
        XCTAssertTrue(app.buttons["project-area-none"].isSelected)
        select("project-area-none") // Same canonical selection does not write.
        revealPagedElement(app, app.buttons["project-notes-toggle"], in: app.scrollViews.firstMatch, outerEdge: true)
        boardTap(app, "project-notes-toggle"); boardEnabled(notes)
        revealPagedElement(app, notes, in: app.scrollViews.firstMatch)
        notes.tap(); revealPagedElement(app, notes, in: app.scrollViews.firstMatch, outerEdge: true)
        replaceProjectNotesText(notes, with: "Notes before Area opens\n")
        tap("project-area-open"); select(choice) // First tap flushes Notes before opening.
        XCTAssertEqual(app.staticTexts["project-detail-meta-area"].label, "Metadata Area")
        tap("project-area-open"); XCTAssertTrue(app.buttons[choice].isSelected); select(choice)
        tap("project-area-open"); select("project-area-none")
        tap("project-area-open"); XCTAssertTrue(app.buttons["project-area-none"].isSelected)
        select(choice)
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "Project Area preserves Notes and Details"
        capture.lifetime = .keepAlways; add(capture)
        boardTap(app, "project-back")
        XCTAssertEqual(draft.value as? String, "Retained Area assignment draft")
        XCTAssertTrue(app.buttons["projects-create-area-none"].isSelected)
        boardTap(app, "area-open"); boardTap(app, "area-option-" + areaID)
        boardEnabled(app.buttons["area-option-" + areaID])
        XCTAssertTrue(app.buttons["area-option-" + areaID].isSelected)
        app.buttons["area-dismiss"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
        open(target)
        tap("project-area-open"); select("project-area-none")
        boardTap(app, "project-back")
        XCTAssertEqual(draft.value as? String, "Retained Area assignment draft")
        XCTAssertTrue(app.buttons["projects-create-area-" + areaID].isSelected)
        XCTAssertFalse(app.buttons["project-open-" + target].exists)
        boardTap(app, "area-open")
        XCTAssertTrue(app.buttons["area-option-" + areaID].isSelected)
        boardTap(app, "area-option-__all__"); boardEnabled(app.buttons["area-option-__all__"])
        app.buttons["area-dismiss"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
        let archived = app.buttons["projects-section-archived"]
        revealPagedElement(app, archived, in: app.scrollViews["projects-scroll"])
        if archived.value as? String == "Expand" { archived.tap() }
        open("98432619-81dd-480e-9c35-d4dfa1705ff1")
        XCTAssertFalse(app.buttons["project-area-open"].exists)
        XCTAssertTrue(app.staticTexts["project-detail-meta-area"].exists)
        app.terminate(); app.launch(); projects(); open(target)
        tap("project-area-open"); XCTAssertTrue(app.buttons["project-area-none"].isSelected)
        select("project-area-close")
        revealPagedElement(app, app.buttons["project-notes-toggle"], in: app.scrollViews.firstMatch, outerEdge: true)
        boardTap(app, "project-notes-toggle")
        XCTAssertEqual(notes.value as? String, "Notes before Area opens\n")
        app.terminate()
    }

    func testProjectAreaFailureKeepsSelection() {
        projectAreaRecovery(expectFailure: true)
    }

    func testProjectAreaColdRecovery() {
        projectAreaRecovery(expectFailure: false)
    }

    private func projectAreaRecovery(expectFailure: Bool) {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", "b41b1a6b-cb7b-4720-9e03-032b458e96fb"]
        app.launch()
        if expectFailure {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
        } else { boardEnabled(app.textFields["projects-create-title"], timeout: 30) }
        let row = app.buttons["project-open-776dd5c5-1926-4da1-96ff-5d5096971050"]
        revealPagedElement(app, row, in: app.scrollViews["projects-scroll"])
        row.tap(); boardTap(app, "project-details-toggle")
        func tap(_ id: String) {
            let button = app.buttons[id]
            let sheet = app.scrollViews["project-area-sheet"]
            revealPagedElement(app, button, in: sheet.exists ? sheet : app.scrollViews.firstMatch, outerEdge: true)
            boardEnabled(button); XCTAssertGreaterThanOrEqual(button.frame.height + 0.000001, 48)
            button.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: button.frame.width - 4, dy: 4)).tap()
        }
        tap("project-area-open")
        let choice = "project-area-choice-3abf38fa-7ec4-45f4-ad79-4e30f08b78ad"
        if expectFailure {
            tap(choice)
            let error = app.staticTexts["project-area-error"]
            XCTAssertTrue(error.waitForExistence(timeout: 15))
            for _ in 0..<2 {
                XCTAssertFalse(app.buttons["project-area-close"].isEnabled)
                XCTAssertFalse(app.buttons[choice].isEnabled)
                XCTAssertTrue(app.buttons[choice].isSelected)
                XCTAssertFalse(app.buttons["project-area-none"].isEnabled)
                tap("project-area-retry"); boardEnabled(app.buttons["project-area-retry"])
                XCTAssertTrue(error.exists)
            }
            let capture = XCTAttachment(screenshot: app.screenshot())
            capture.name = "Failed Project Area save retains exact selection"
            capture.lifetime = .keepAlways; add(capture)
        } else {
            XCTAssertTrue(app.buttons[choice].isSelected)
            XCTAssertFalse(app.staticTexts["project-area-error"].exists)
            tap("project-area-close")
        }
        app.terminate()
    }

    func testProjectReviewDateAndNotes() {
        projectReviewDates(library: "db25c637-3853-46f5-9625-2f965304217a")
    }

    func testProjectReviewDateLargestText() {
        projectReviewDates(library: "540cc44b-e491-4816-a367-1cbf53d9f5ee")
    }

    private func projectReviewDates(library: String) {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", library]
        app.launchEnvironment["TZ"] = "America/New_York"
        app.launch()
        let picker = app.datePickers["project-date-picker"]
        let notes = app.textViews["project-notes-input"]
        func tap(_ id: String) {
            let button = app.buttons[id]
            let scroll = app.scrollViews["project-date-sheet"].exists
                ? app.scrollViews["project-date-sheet"] : app.scrollViews.firstMatch
            revealPagedElement(app, button, in: scroll)
            boardEnabled(button)
            XCTAssertGreaterThanOrEqual(button.frame.height + 0.000001, id.hasPrefix("project-date-") ? 44 : 48)
            button.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: button.frame.width - 4, dy: 4)).tap()
        }
        func projects() {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
        }
        func open(_ id: String) {
            let row = app.buttons["project-open-" + id]
            revealPagedElement(app, row, in: app.scrollViews["projects-scroll"])
            row.tap(); boardTap(app, "project-details-toggle")
        }
        func day(_ expected: String, change: String? = nil) {
            XCTAssertTrue(picker.waitForExistence(timeout: 10))
            let wheel = picker.pickerWheels.allElementsBoundByIndex.first {
                guard let value = $0.value as? String, let number = Int(value) else { return false }
                return (1...31).contains(number)
            }
            XCTAssertNotNil(wheel); XCTAssertEqual(wheel?.value as? String, expected)
            if let change { wheel?.adjust(toPickerWheelValue: change) }
        }
        func close(_ action: String) {
            tap(action)
            let hidden = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: picker)
            XCTAssertEqual(XCTWaiter.wait(for: [hidden], timeout: 15), .completed)
        }
        projects()
        let draft = app.textFields["projects-create-title"]
        draft.tap(); draft.typeText("Retained review date draft")
        open("776dd5c5-1926-4da1-96ff-5d5096971050")
        tap("project-review-date-open"); day("28"); close("project-date-done")
        tap("project-review-date-open"); day("28", change: "29"); close("project-date-cancel")
        boardTap(app, "project-notes-toggle"); boardEnabled(notes)
        revealPagedElement(app, notes, in: app.scrollViews.firstMatch)
        notes.tap()
        // Reveal the editor above the keyboard without scrolling inside its text.
        revealPagedElement(app, notes, in: app.scrollViews.firstMatch, outerEdge: true)
        replaceProjectNotesText(notes, with: "Notes before Review Date opens\n")
        tap("project-review-date-open"); day("28"); close("project-date-done")
        boardTap(app, "project-back")
        XCTAssertEqual(draft.value as? String, "Retained review date draft")
        open("61181128-5b30-4622-95d0-601658a9d216")
        tap("project-review-date-open"); day("7"); close("project-date-done")
        tap("project-review-date-open"); day("7", change: "8"); close("project-date-done")
        tap("project-review-date-open"); day("8"); close("project-date-done")
        boardTap(app, "project-back")
        open("7c299e65-4a02-410d-8e85-c01d0655ebda")
        XCTAssertFalse(app.buttons["project-review-date-clear"].exists)
        tap("project-review-date-open"); close("project-date-done")
        XCTAssertTrue(app.buttons["project-review-date-clear"].exists)
        tap("project-review-date-open"); close("project-date-done")
        tap("project-review-date-clear")
        XCTAssertFalse(app.buttons["project-review-date-clear"].exists)
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "Review Date native controls after clear"
        capture.lifetime = .keepAlways; add(capture)
        boardTap(app, "project-back")
        let archived = app.buttons["projects-section-archived"]
        revealPagedElement(app, archived, in: app.scrollViews["projects-scroll"])
        if archived.value as? String == "Expand" { archived.tap() }
        open("98432619-81dd-480e-9c35-d4dfa1705ff1")
        XCTAssertFalse(app.buttons["project-review-date-open"].isEnabled)
        app.terminate(); app.launch(); projects()
        open("776dd5c5-1926-4da1-96ff-5d5096971050")
        tap("project-review-date-open"); day("28"); close("project-date-cancel")
        boardTap(app, "project-notes-toggle")
        XCTAssertEqual(notes.value as? String, "Notes before Review Date opens\n")
        app.terminate()
    }

    func testProjectReviewDateFailureKeepsDraft() {
        projectReviewDateRecovery(expectFailure: true)
    }

    func testProjectReviewDateColdRecovery() {
        projectReviewDateRecovery(expectFailure: false)
    }

    private func projectReviewDateRecovery(expectFailure: Bool) {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", "8d1aaf12-81b3-43e0-9b4b-fbdd1ea87b26"]
        app.launchEnvironment["TZ"] = "America/New_York"
        app.launch()
        if expectFailure {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
        } else { boardEnabled(app.textFields["projects-create-title"], timeout: 30) }
        let row = app.buttons["project-open-61181128-5b30-4622-95d0-601658a9d216"]
        revealPagedElement(app, row, in: app.scrollViews["projects-scroll"])
        row.tap(); boardTap(app, "project-details-toggle")
        let open = app.buttons["project-review-date-open"]
        revealPagedElement(app, open, in: app.scrollViews.firstMatch)
        boardEnabled(open); open.tap()
        let picker = app.datePickers["project-date-picker"]
        XCTAssertTrue(picker.waitForExistence(timeout: 10))
        let day = picker.pickerWheels.allElementsBoundByIndex.first {
            guard let value = $0.value as? String, let number = Int(value) else { return false }
            return (1...31).contains(number)
        }
        XCTAssertNotNil(day); guard let day else { return }
        func tap(_ id: String) {
            let button = app.buttons[id]
            revealPagedElement(app, button, in: app.scrollViews["project-date-sheet"], outerEdge: true)
            boardEnabled(button); XCTAssertGreaterThanOrEqual(button.frame.height + 0.000001, id.hasPrefix("project-date-") ? 44 : 48)
            button.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: button.frame.width - 4, dy: 4)).tap()
        }
        if expectFailure {
            XCTAssertEqual(day.value as? String, "7"); day.adjust(toPickerWheelValue: "8")
            let selected = picker.pickerWheels.allElementsBoundByIndex.map { $0.value as? String ?? "" }
            tap("project-date-done")
            let failure = app.staticTexts["project-date-error"]
            XCTAssertTrue(failure.waitForExistence(timeout: 15))
            for _ in 0..<2 {
                XCTAssertFalse(app.buttons["project-date-cancel"].isEnabled)
                XCTAssertFalse(app.buttons["project-date-done"].isEnabled)
                XCTAssertFalse(picker.isEnabled)
                XCTAssertEqual(picker.pickerWheels.allElementsBoundByIndex.map { $0.value as? String ?? "" }, selected)
                tap("project-date-retry"); boardEnabled(app.buttons["project-date-retry"])
                XCTAssertTrue(failure.exists)
            }
            let capture = XCTAttachment(screenshot: app.screenshot())
            capture.name = "Review Date failed save retains wheel"
            capture.lifetime = .keepAlways; add(capture)
        } else {
            XCTAssertEqual(day.value as? String, "8")
            XCTAssertFalse(app.staticTexts["project-date-error"].exists)
            tap("project-date-cancel")
        }
        app.terminate()
    }

    func testProjectDatesAndNotesFirstTap() {
        projectDatesAndNotes(library: "3f4e958e-4a42-4207-9fb8-1a1b873af354")
    }

    func testProjectDatesAndNotesLargestText() {
        projectDatesAndNotes(library: "a36d3670-2f2b-40b5-9ef2-af2ba88776e8")
    }

    private func projectDatesAndNotes(library: String) {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", library]
        app.launch()
        let notes = app.textViews["project-notes-input"]
        let picker = app.datePickers["project-date-picker"]
        func projects() {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
        }
        func tap(_ id: String) {
            let button = app.buttons[id]
            revealPagedElement(app, button, in: app.scrollViews.firstMatch)
            boardEnabled(button)
            XCTAssertGreaterThanOrEqual(button.frame.height + 0.000001, 44)
            button.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: button.frame.width - 4, dy: 4)).tap()
        }
        func open(_ id: String = "776dd5c5-1926-4da1-96ff-5d5096971050") {
            let row = app.buttons["project-open-" + id]
            revealPagedElement(app, row, in: app.scrollViews["projects-scroll"])
            row.tap(); boardEnabled(app.buttons["project-details-toggle"])
            tap("project-details-toggle")
        }
        func sheetTap(_ id: String) {
            let button = app.buttons[id]
            boardEnabled(button)
            XCTAssertGreaterThanOrEqual(button.frame.height + 0.000001, 44)
            button.tap()
        }
        func changeDay() {
            XCTAssertTrue(picker.waitForExistence(timeout: 10))
            let wheel = picker.pickerWheels.allElementsBoundByIndex.first {
                guard let value = $0.value as? String, let day = Int(value) else { return false }
                return (1...31).contains(day)
            }
            XCTAssertNotNil(wheel)
            guard let wheel, let day = Int(wheel.value as? String ?? "") else { return }
            wheel.adjust(toPickerWheelValue: String(day < 27 ? day + 1 : day - 1))
        }
        func closed() {
            let hidden = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: picker)
            XCTAssertEqual(XCTWaiter.wait(for: [hidden], timeout: 15), .completed)
        }
        projects()
        let draft = app.textFields["projects-create-title"]
        draft.tap(); draft.typeText("Retained date Project draft")
        open()
        // Opening/cancelling must preserve the fixture's legacy timed start date.
        tap("project-start-date-open"); changeDay(); sheetTap("project-date-cancel"); closed()
        tap("project-notes-toggle"); boardEnabled(notes)
        replaceProjectNotesText(notes, with: "Notes before date opens\n")
        tap("project-start-date-open") // One tap joins Notes persistence and presents the wheel.
        changeDay(); sheetTap("project-date-done"); closed()
        boardEnabled(app.buttons["project-start-date-open"])
        XCTAssertTrue(app.buttons["project-start-date-open"].isHittable,
                      "Saving a date must retain the scrolled Project Details position")
        tap("project-start-date-open")
        let selected = picker.pickerWheels.allElementsBoundByIndex.map { $0.value as? String ?? "" }
        sheetTap("project-date-done"); closed() // Same literal day is a no-op.
        tap("project-start-date-open"); changeDay(); sheetTap("project-date-cancel"); closed()
        tap("project-start-date-open")
        XCTAssertEqual(picker.pickerWheels.allElementsBoundByIndex.map { $0.value as? String ?? "" }, selected)
        sheetTap("project-date-cancel"); closed()
        tap("project-due-date-open"); sheetTap("project-date-done"); closed()
        revealPagedElement(app, notes, in: app.scrollViews.firstMatch)
        replaceProjectNotesText(notes, with: "Notes before date clears\n")
        tap("project-start-date-clear") // Dirty Notes must not swallow the first Clear action.
        XCTAssertFalse(app.buttons["project-start-date-clear"].exists)
        tap("project-due-date-clear")
        XCTAssertFalse(app.buttons["project-due-date-clear"].exists)
        XCTAssertEqual(notes.value as? String, "Notes before date clears\n")
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Project date clear retains Notes"
        screenshot.lifetime = .keepAlways; add(screenshot)
        let task = app.buttons["task-title-ca84a4da-ed78-4860-8b63-1f6412ec93bd"]
        revealPagedElement(app, task, in: app.scrollViews.firstMatch)
        task.tap(); boardEnabled(app.buttons["task-view-close"]); boardTap(app, "task-view-close")
        boardTap(app, "project-back")
        XCTAssertEqual(draft.value as? String, "Retained date Project draft")
        let archived = app.buttons["projects-section-archived"]
        revealPagedElement(app, archived, in: app.scrollViews["projects-scroll"])
        if archived.value as? String == "Expand" { archived.tap() }
        open("98432619-81dd-480e-9c35-d4dfa1705ff1")
        XCTAssertFalse(app.buttons["project-start-date-open"].isEnabled)
        XCTAssertFalse(app.buttons["project-due-date-open"].isEnabled)
        app.terminate(); app.launch(); projects(); open()
        tap("project-notes-toggle")
        XCTAssertEqual(notes.value as? String, "Notes before date clears\n")
        XCTAssertFalse(app.buttons["project-start-date-clear"].exists)
        XCTAssertFalse(app.buttons["project-due-date-clear"].exists)
        revealPagedElement(app, task, in: app.scrollViews.firstMatch)
        XCTAssertTrue(task.exists)
        boardTap(app, "project-back")
    }

    func testProjectStatusAndNotesFirstTap() {
        projectStatusAndNotes(library: "416f946c-6ad0-4adb-baf4-cd1a4e85a124")
    }

    func testProjectStatusAndNotesLargestText() {
        projectStatusAndNotes(library: "7bbdba1a-e395-456a-92a4-ad32f68173fd")
    }

    private func projectStatusAndNotes(library: String) {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", library]
        app.launch()
        let target = "776dd5c5-1926-4da1-96ff-5d5096971050"
        let notes = app.textViews["project-notes-input"]
        func projects() {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
        }
        func tap(_ id: String) {
            let button = app.buttons[id]
            revealPagedElement(app, button, in: app.scrollViews.firstMatch)
            boardEnabled(button)
            XCTAssertGreaterThanOrEqual(button.frame.height + 0.000001, 44)
            button.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: button.frame.width - 4, dy: 4)).tap()
        }
        func open(_ id: String = "776dd5c5-1926-4da1-96ff-5d5096971050") {
            let row = app.buttons["project-open-" + id]
            revealPagedElement(app, row, in: app.scrollViews["projects-scroll"])
            row.tap(); boardEnabled(app.buttons["project-details-toggle"])
            tap("project-details-toggle")
        }
        func status(_ label: String) {
            let value = app.staticTexts["project-detail-meta-status"]
            XCTAssertTrue(value.waitForExistence(timeout: 15))
            let expected = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", label), object: value)
            XCTAssertEqual(XCTWaiter.wait(for: [expected], timeout: 15), .completed)
        }
        projects()
        let draft = app.textFields["projects-create-title"]
        draft.tap(); draft.typeText("Retained status Project draft")
        open(); status("Active"); tap("project-notes-toggle")
        boardEnabled(notes)
        replaceProjectNotesText(notes, with: "Notes before status opens\n")
        tap("project-status-open") // One tap joins the Notes save and opens the selector.
        boardEnabled(app.buttons["project-status-waiting"])
        revealPagedElement(app, notes, in: app.scrollViews.firstMatch)
        replaceProjectNotesText(notes, with: "Notes before status changes\n")
        tap("project-status-waiting") // A second Notes save must retain this requested choice.
        status("Waiting")
        XCTAssertFalse(app.buttons["project-status-someday"].exists)
        XCTAssertEqual(notes.value as? String, "Notes before status changes\n")
        boardTap(app, "project-back")
        XCTAssertEqual(draft.value as? String, "Retained status Project draft")
        let deferred = app.buttons["projects-section-deferred"]
        revealPagedElement(app, deferred, in: app.scrollViews["projects-scroll"])
        if deferred.value as? String == "Expand" { deferred.tap() }
        open(); status("Waiting")
        tap("project-status-open"); tap("project-status-someday"); status("Someday")
        tap("project-status-open"); tap("project-status-active"); status("Active")
        tap("project-status-open"); tap("project-status-active") // Exact same-status no-op.
        XCTAssertFalse(app.buttons["project-status-waiting"].exists)
        tap("project-status-open"); tap("project-status-open") // RN header re-tap closes without a write.
        XCTAssertFalse(app.buttons["project-status-waiting"].exists)
        tap("project-notes-toggle")
        XCTAssertEqual(notes.value as? String, "Notes before status changes\n")
        tap("project-status-open")
        tap("project-details-toggle"); tap("project-details-toggle")
        XCTAssertFalse(app.buttons["project-status-waiting"].exists)
        XCTAssertEqual(notes.value as? String, "Notes before status changes\n")
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "Project status retains Notes after transitions"
        capture.lifetime = .keepAlways; add(capture)
        let task = app.buttons["task-title-ca84a4da-ed78-4860-8b63-1f6412ec93bd"]
        revealPagedElement(app, task, in: app.scrollViews.firstMatch)
        task.tap(); boardEnabled(app.buttons["task-view-close"]); boardTap(app, "task-view-close")
        boardTap(app, "project-back")
        XCTAssertEqual(draft.value as? String, "Retained status Project draft")
        let archived = app.buttons["projects-section-archived"]
        revealPagedElement(app, archived, in: app.scrollViews["projects-scroll"])
        if archived.value as? String == "Expand" { archived.tap() }
        open("98432619-81dd-480e-9c35-d4dfa1705ff1")
        XCTAssertFalse(app.buttons["project-status-open"].exists)
        app.terminate(); app.launch(); projects(); open(target); status("Active")
        tap("project-notes-toggle")
        XCTAssertEqual(notes.value as? String, "Notes before status changes\n")
        revealPagedElement(app, task, in: app.scrollViews.firstMatch)
        XCTAssertTrue(task.exists)
        boardTap(app, "project-back")
    }

    func testProjectNotesAutosaveAndRelaunch() {
        projectNotesAutosave(library: "069a529e-c285-4800-b5ef-2f45ac6f73c3")
    }

    func testProjectNotesAutosaveLargestTextAndRelaunch() {
        projectNotesAutosave(library: "6e4aebc0-530c-438c-aa5d-b9e137cda191")
    }

    private func replaceProjectNotesText(_ input: XCUIElement, with text: String) {
        input.tap()
        if !(input.value as? String ?? "").isEmpty {
            input.press(forDuration: 1)
            let app = XCUIApplication()
            let selectAll = app.descendants(matching: .any)["Select All"].firstMatch
            for _ in 0..<3 {
                if selectAll.waitForExistence(timeout: 1), selectAll.isHittable { break }
                let next = app.buttons["Next Page"]
                guard next.exists else {
                    print("Text selection menu AX: " + app.debugDescription)
                    break
                }
                next.tap()
            }
            XCTAssertTrue(selectAll.exists)
            selectAll.tap()
            input.typeText(XCUIKeyboardKey.delete.rawValue)
        }
        XCTAssertEqual(input.value as? String ?? "", "")
        if !text.isEmpty { input.typeText(text) }
        XCTAssertEqual(input.value as? String ?? "", text)
    }

    private func projectNotesAutosave(library: String) {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", library]
        app.launch()
        let target = "776dd5c5-1926-4da1-96ff-5d5096971050"
        let input = app.textViews["project-notes-input"]
        func projects() {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
        }
        func tap(_ id: String) {
            let button = app.buttons[id]
            revealPagedElement(app, button, in: app.scrollViews.firstMatch)
            boardEnabled(button)
            XCTAssertGreaterThanOrEqual(button.frame.height + 0.000001, 44)
            button.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: button.frame.width - 4, dy: 4)).tap()
        }
        func open() {
            let project = app.buttons["project-open-" + target]
            revealPagedElement(app, project, in: app.scrollViews["projects-scroll"])
            project.tap(); boardEnabled(app.buttons["project-details-toggle"])
            tap("project-details-toggle"); tap("project-notes-toggle")
            XCTAssertTrue(input.waitForExistence(timeout: 15))
            boardEnabled(input)
        }
        func edit(_ text: String) {
            if !input.exists { tap("project-notes-mode-edit") }
            revealPagedElement(app, input, in: app.scrollViews.firstMatch)
            boardEnabled(input)
            replaceProjectNotesText(input, with: text)
        }
        func raw(_ expected: String) {
            XCTAssertTrue(input.waitForExistence(timeout: 15))
            XCTAssertEqual(input.value as? String ?? "", expected)
        }
        projects(); open(); raw("")
        let first = "  # Notes autosave\n\nraw line  \n"
        edit(first); tap("project-notes-mode-preview")
        XCTAssertFalse(input.exists)
        let heading = app.staticTexts["Notes autosave"]
        revealPagedElement(app, heading, in: app.scrollViews.firstMatch)
        XCTAssertTrue(heading.exists)
        tap("project-notes-mode-edit"); raw(first)
        boardTap(app, "project-back") // Unchanged raw Notes must not write.
        open(); raw(first)
        edit("Back saves once\n"); boardTap(app, "project-back")
        boardEnabled(app.textFields["projects-create-title"])
        open(); raw("Back saves once\n")
        edit("Rename opens once\n"); boardTap(app, "project-rename-open")
        boardEnabled(app.textFields["project-rename-title"])
        boardTap(app, "project-rename-cancel")
        raw("Rename opens once\n")
        edit("Details collapse saves\n"); tap("project-details-toggle")
        XCTAssertEqual(app.buttons["project-details-toggle"].value as? String, "Expand")
        tap("project-details-toggle"); raw("Details collapse saves\n")
        edit("Type changes once\n"); tap("project-flow-type")
        let sequential = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "Sequential"),
            object: app.staticTexts["project-detail-meta-type"])
        XCTAssertEqual(XCTWaiter.wait(for: [sequential], timeout: 15), .completed)
        raw("Type changes once\n")
        edit("Task opens once\n")
        let task = app.buttons["task-title-ca84a4da-ed78-4860-8b63-1f6412ec93bd"]
        revealPagedElement(app, task, in: app.scrollViews.firstMatch)
        task.tap(); boardEnabled(app.buttons["task-view-close"])
        boardTap(app, "task-view-close"); raw("Task opens once\n")
        edit(""); tap("project-notes-mode-preview")
        let empty = app.staticTexts["project-notes-empty"]
        revealPagedElement(app, empty, in: app.scrollViews.firstMatch)
        XCTAssertEqual(empty.label, "None")
        let final = "  # Preserved Notes\n\n**Bold** and café.  \n\n```txt\ncode\n```\n"
        edit(final); boardTap(app, "project-back")
        boardEnabled(app.textFields["projects-create-title"])
        app.terminate(); app.launch(); projects(); open(); raw(final)
        tap("project-notes-mode-preview")
        let title = app.staticTexts["Preserved Notes"]
        revealPagedElement(app, title, in: app.scrollViews.firstMatch)
        XCTAssertTrue(title.exists)
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "Project Notes autosave after restart"
        capture.lifetime = .keepAlways
        add(capture)
        boardTap(app, "project-back")
    }

    func testProjectNotesDraftDirection() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", "2911871e-082c-4c77-b36b-ef9405c77bd1"]
        app.launch()
        boardEnabled(app.buttons["tab-menu"], timeout: 30)
        boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
        let project = app.buttons["project-open-776dd5c5-1926-4da1-96ff-5d5096971050"]
        revealPagedElement(app, project, in: app.scrollViews["projects-scroll"])
        project.tap(); boardTap(app, "project-details-toggle")
        func tap(_ id: String) {
            let button = app.buttons[id]
            revealPagedElement(app, button, in: app.scrollViews.firstMatch)
            boardTap(app, id)
        }
        tap("project-notes-toggle")
        let input = app.textViews["project-notes-input"]
        func draft(_ text: String, captureName: String) {
            revealPagedElement(app, input, in: app.scrollViews.firstMatch)
            replaceProjectNotesText(input, with: text)
            let capture = XCTAttachment(screenshot: app.screenshot())
            capture.name = captureName; capture.lifetime = .keepAlways; add(capture)
        }
        draft("مرحبا بالعالم", captureName: "Arabic draft before first save")
        tap("project-notes-mode-preview")
        XCTAssertFalse(input.exists)
        tap("project-notes-mode-edit")
        draft("English draft", captureName: "English draft after stored Arabic")
        tap("project-notes-mode-preview")
        XCTAssertFalse(input.exists)
        boardTap(app, "project-back")
    }

    func testProjectNotesSaveFailureKeepsDraft() {
        projectNotesWriteRecovery(expectPendingFailure: true)
    }

    func testProjectNotesColdWriteRecovery() {
        projectNotesWriteRecovery(expectPendingFailure: false)
    }

    private func projectNotesWriteRecovery(expectPendingFailure: Bool) {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", "ffde5ad8-9d51-49d5-8a59-a09725929926"]
        app.launch()
        if expectPendingFailure {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
        } else {
            boardEnabled(app.textFields["projects-create-title"], timeout: 30)
        }
        let project = app.buttons["project-open-776dd5c5-1926-4da1-96ff-5d5096971050"]
        revealPagedElement(app, project, in: app.scrollViews["projects-scroll"])
        project.tap(); boardTap(app, "project-details-toggle")
        let toggle = app.buttons["project-notes-toggle"]
        revealPagedElement(app, toggle, in: app.scrollViews.firstMatch)
        toggle.tap()
        let input = app.textViews["project-notes-input"]
        boardEnabled(input)
        if expectPendingFailure {
            revealPagedElement(app, input, in: app.scrollViews.firstMatch)
            replaceProjectNotesText(input, with: "Retry Notes")
            let preview = app.buttons["project-notes-mode-preview"]
            revealPagedElement(app, preview, in: app.scrollViews.firstMatch)
            preview.tap()
            let failure = app.staticTexts["project-notes-write-error"]
            XCTAssertTrue(failure.waitForExistence(timeout: 15))
            XCTAssertEqual(input.value as? String, "Retry Notes")
            XCTAssertFalse(input.isEnabled)
            XCTAssertFalse(app.buttons["project-notes-discard"].exists)
            XCTAssertFalse(app.buttons["project-back"].isEnabled)
            let retry = app.buttons["project-notes-write-retry"]
            revealPagedElement(app, retry, in: app.scrollViews.firstMatch)
            boardTap(app, "project-notes-write-retry")
            boardEnabled(retry)
            XCTAssertTrue(failure.exists)
            XCTAssertEqual(input.value as? String, "Retry Notes")
            let capture = XCTAttachment(screenshot: app.screenshot())
            capture.name = "Project Notes failed write retains draft"
            capture.lifetime = .keepAlways; add(capture)
        } else {
            XCTAssertEqual(input.value as? String, "Retry Notes")
            XCTAssertFalse(app.staticTexts["project-notes-write-error"].exists)
            boardTap(app, "project-back")
        }
        app.terminate()
    }

    func testProjectClosedSectionExpansion() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", "520b1d3f-f28d-4a2b-90f9-796cc1669c7c"]
        app.launch()
        boardEnabled(app.buttons["tab-menu"], timeout: 30)
        boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
        let archived = app.buttons["projects-section-archived"]
        revealPagedElement(app, archived, in: app.scrollViews["projects-scroll"])
        XCTAssertEqual(archived.value as? String, "Expand")
        archived.tap()
        XCTAssertEqual(archived.value as? String, "Collapse")
        let area = app.buttons["project-area-archived-no-area"]
        if !area.waitForExistence(timeout: 10) { print("Closed expansion AX: " + app.debugDescription) }
        XCTAssertTrue(area.exists)
        XCTAssertTrue(app.buttons["project-open-98432619-81dd-480e-9c35-d4dfa1705ff1"].exists)
    }

    func testProjectDetailsMetadataReadOnlyAndRelaunch() throws {
        let app = XCUIApplication()
        let library = "520b1d3f-f28d-4a2b-90f9-796cc1669c7c"
        app.launchArguments = ["--native-ui-test-library", library]
        print("Project metadata isolated library: " + library)
        app.launch()
        func openProjects() {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
            boardEnabled(app.textFields["projects-create-title"])
        }
        func open(_ title: String) {
            let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@",
                "project-open-", title)).firstMatch
            revealPagedElement(app, row, in: app.scrollViews["projects-scroll"])
            row.tap(); boardEnabled(app.buttons["project-details-toggle"])
            XCTAssertGreaterThanOrEqual(app.buttons["project-back"].frame.height + 0.000001, 44)
            XCTAssertGreaterThanOrEqual(app.buttons["project-back"].frame.width + 0.000001, 44)
        }
        func value(_ field: String, _ expected: String) {
            let text = app.staticTexts["project-detail-meta-" + field]
            revealPagedElement(app, text, in: app.scrollViews.firstMatch)
            XCTAssertEqual(text.label, expected)
        }
        func toggle() {
            let button = app.buttons["project-details-toggle"]
            revealPagedElement(app, button, in: app.scrollViews.firstMatch)
            XCTAssertGreaterThanOrEqual(button.frame.height + 0.000001, 44)
            button.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: button.frame.width - 4, dy: 4)).tap()
        }
        openProjects()
        let seeded = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@",
            "project-open-", "Metadata active Project")).firstMatch
        guard seeded.waitForExistence(timeout: 5) else { throw XCTSkip("Requires isolated Project metadata fixture") }
        open("Metadata active Project")
        XCTAssertTrue(app.staticTexts["project-details-summary"].label.contains("Metadata Area"))
        XCTAssertFalse(app.staticTexts["project-detail-meta-status"].exists)
        toggle()
        value("status", "Active"); value("type", "Sequential")
        value("sequential-scope", "Within sections")
        value("sections", "First metadata section\nSecond metadata section")
        value("area", "Metadata Area"); value("tags", "#home, #project-details-long-tag")
        for field in ["start-date", "due-date", "review-date"] {
            let text = app.staticTexts["project-detail-meta-" + field]
            revealPagedElement(app, text, in: app.scrollViews.firstMatch)
            XCTAssertFalse(text.label.isEmpty); XCTAssertFalse(text.label.contains("Not set"))
        }
        toggle(); XCTAssertTrue(app.staticTexts["project-details-summary"].exists)
        boardTap(app, "project-back")
        open("Metadata parallel Project")
        XCTAssertFalse(app.staticTexts["project-detail-meta-status"].exists)
        toggle(); value("type", "Parallel")
        XCTAssertFalse(app.staticTexts["project-detail-meta-sequential-scope"].exists)
        boardTap(app, "project-back")
        let archived = app.buttons["projects-section-archived"]
        revealPagedElement(app, archived, in: app.scrollViews["projects-scroll"])
        if archived.value as? String == "Expand" { archived.tap() }
        open("Metadata archived Project")
        XCTAssertFalse(app.buttons["project-rename-open"].isEnabled)
        toggle(); value("status", "Cancelled"); value("sections", "Archived metadata section")
        app.terminate(); app.launch(); openProjects(); open("Metadata active Project")
        XCTAssertTrue(app.staticTexts["project-details-summary"].label.contains("Metadata Area"))
        XCTAssertFalse(app.staticTexts["project-detail-meta-status"].exists)
        toggle(); value("tags", "#home, #project-details-long-tag")
    }

    /// Root stages two deferred Projects in this isolated simulator library.
    func testDeferredProjectRenameOpensOnFirstTap() throws {
        let app = XCUIApplication()
        let library = "83bae1d1-a6d7-450f-ae93-3f3bd398338d"
        app.launchArguments = ["--native-ui-test-library", library]
        print("Deferred Project rename isolated library: " + library)
        app.launch()
        for (surface, title) in [("waiting", "Deferred rename Waiting"), ("someday", "Deferred rename Someday")] {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-" + surface)
            let toggle = app.buttons[surface + "-projects-toggle"]
            guard toggle.waitForExistence(timeout: 5) else {
                throw XCTSkip("Requires the isolated deferred Project rename fixture")
            }
            if toggle.value as? String == "Expand" { boardTap(app, toggle.identifier) }
            let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@",
                surface + "-project-", title)).firstMatch
            boardEnabled(row); row.tap()
            boardTap(app, "project-rename-open")
            let field = app.textFields["project-rename-title"]
            boardEnabled(field)
            XCTAssertEqual(field.value as? String, title)
            XCTAssertFalse(app.buttons["project-back"].isEnabled)
            boardTap(app, "project-rename-cancel")
            XCTAssertEqual(app.staticTexts["project-detail-title"].label, title)
            boardTap(app, "project-back"); boardTap(app, surface + "-back")
        }
    }

    func testProjectRenameCancelTrimDuplicateDraftAndRelaunch() {
        let app = XCUIApplication()
        let library = UUID().uuidString.lowercased()
        app.launchArguments = ["--native-ui-test-library", library]
        print("Project rename isolated library: " + library)
        app.launch()
        func openProjects() {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
            boardEnabled(app.textFields["projects-create-title"])
        }
        openProjects()
        let scroll = app.scrollViews["projects-scroll"]
        let input = app.textFields["projects-create-title"]
        var ids: [String] = []
        for title in ["Rename project initial", "Rename destination"] {
            revealPagedElement(app, input, in: scroll); input.tap(); input.typeText(title + "\n")
            let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@",
                "project-open-", title)).firstMatch
            XCTAssertTrue(row.waitForExistence(timeout: 15))
            ids.append(String(row.identifier.dropFirst("project-open-".count)))
        }
        boardTap(app, "capture-open")
        app.textViews["capture-input"].typeText("Action survives Project rename /next +\"Rename project initial\"")
        boardTap(app, "capture-save")
        boardEnabled(input); revealPagedElement(app, input, in: scroll)
        input.tap(); input.typeText("Retained rename project draft")
        let target = app.buttons["project-open-" + ids[0]]
        func openTarget() {
            for _ in 0..<12 {
                XCTAssertTrue(target.waitForExistence(timeout: 10))
                var viewport = scroll.frame.intersection(app.frame)
                if app.keyboards.firstMatch.exists {
                    viewport.size.height = max(0, min(viewport.maxY, app.keyboards.firstMatch.frame.minY) - viewport.minY)
                }
                let visible = target.frame.intersection(viewport)
                if target.isHittable && visible.height >= 44 && visible.width >= 44 {
                    app.coordinate(withNormalizedOffset: .zero)
                        .withOffset(CGVector(dx: visible.midX, dy: visible.midY)).tap()
                    return
                }
                if target.frame.minY < viewport.minY { scroll.swipeDown() }
                else { scroll.swipeUp() }
            }
            XCTFail("Project row has no tappable visible region")
        }
        openTarget()
        boardEnabled(app.buttons["project-rename-open"])
        let field = app.textFields["project-rename-title"]
        func edit(_ value: String) {
            boardTap(app, "project-rename-open"); boardEnabled(field)
            field.tap()
            field.typeKey("a", modifierFlags: .command)
            field.typeText(value)
            XCTAssertEqual(field.value as? String, value)
        }
        func title(_ expected: String) {
            let header = app.staticTexts["project-detail-title"]
            XCTAssertTrue(header.waitForExistence(timeout: 15)); XCTAssertEqual(header.label, expected)
        }
        edit("Discarded Project title")
        XCTAssertFalse(app.buttons["project-back"].isEnabled)
        boardTap(app, "project-rename-cancel"); title("Rename project initial")
        edit("   "); boardTap(app, "project-rename-save"); title("Rename project initial")
        edit("Rename project initial"); field.typeText("\n"); title("Rename project initial")
        edit("  Renamed native project  ")
        boardTap(app, "project-rename-save"); title("Renamed native project")
        boardEnabled(app.buttons["Action survives Project rename"])
        XCTAssertFalse(app.staticTexts["project-rename-error"].exists)
        boardTap(app, "project-back"); boardEnabled(input)
        XCTAssertEqual(input.value as? String, "Retained rename project draft")
        openTarget()
        edit("Rename destination"); field.typeText("\n"); title("Rename destination")
        boardEnabled(app.buttons["Action survives Project rename"])
        app.terminate(); app.launch(); openProjects()
        for id in ids { XCTAssertTrue(app.buttons["project-open-" + id].exists) }
        openTarget(); title("Rename destination")
        boardEnabled(app.buttons["Action survives Project rename"])
        XCTAssertFalse(app.staticTexts["Discarded Project title"].exists)
    }

    func testProjectFocusLimitDraftAndRelaunch() {
        let app = XCUIApplication()
        let library = UUID().uuidString.lowercased()
        app.launchArguments = ["--native-ui-test-library", library]
        print("Project Focus isolated library: " + library)
        app.launch()
        func openProjects() {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
            boardEnabled(app.textFields["projects-create-title"])
        }
        openProjects()
        let scroll = app.scrollViews["projects-scroll"]
        let input = app.textFields["projects-create-title"]
        var ids: [String] = []
        for index in 1...6 {
            revealPagedElement(app, input, in: scroll)
            input.tap(); input.typeText("Focus project \(index)\n")
            let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@",
                "project-open-", "Focus project \(index)")).firstMatch
            XCTAssertTrue(row.waitForExistence(timeout: 15))
            ids.append(String(row.identifier.dropFirst("project-open-".count)))
        }
        boardTap(app, "capture-open")
        app.textViews["capture-input"].typeText("Focus project next action /next +\"Focus project 6\"")
        boardTap(app, "capture-save")
        boardTap(app, "tab-focus")
        boardEnabled(app.buttons["Focus project next action"])
        openProjects()
        func star(_ index: Int) -> XCUIElement { app.buttons["project-focus-" + ids[index]] }
        for index in 0..<5 {
            let button = star(index)
            revealPagedElement(app, button, in: scroll); boardEnabled(button)
            XCTAssertGreaterThanOrEqual(button.frame.height, 44 - 0.000001)
            XCTAssertGreaterThanOrEqual(button.frame.width, 44 - 0.000001)
            XCTAssertFalse(button.isSelected)
            button.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.5)).tap()
            expectation(for: NSPredicate(format: "selected == true"), evaluatedWith: button)
            waitForExpectations(timeout: 15)
        }
        XCTAssertFalse(star(5).isEnabled)
        revealPagedElement(app, input, in: scroll)
        input.tap(); input.typeText("Retained Focus project draft")
        revealPagedElement(app, star(0), in: scroll); boardEnabled(star(0)); star(0).tap()
        expectation(for: NSPredicate(format: "selected == false"), evaluatedWith: star(0))
        waitForExpectations(timeout: 15)
        boardEnabled(star(5)); XCTAssertEqual(input.value as? String, "Retained Focus project draft")
        revealPagedElement(app, star(5), in: scroll); star(5).tap()
        expectation(for: NSPredicate(format: "selected == true"), evaluatedWith: star(5))
        waitForExpectations(timeout: 15)
        XCTAssertFalse(star(0).isEnabled)
        XCTAssertEqual(input.value as? String, "Retained Focus project draft")
        XCTAssertFalse(app.staticTexts["project-focus-error"].exists)
        app.terminate(); app.launch(); openProjects()
        for index in 0..<6 {
            XCTAssertTrue(star(index).exists)
            XCTAssertEqual(star(index).isSelected, index != 0)
            XCTAssertEqual(star(index).isEnabled, index != 0)
        }
        XCTAssertNotEqual(input.value as? String, "Retained Focus project draft")
        boardTap(app, "tab-focus")
        boardEnabled(app.buttons["Focus project next action"])
        XCTAssertEqual(app.buttons.matching(identifier: "Focus project next action").count, 1)
    }

    private func revealAreaRenameControl(_ app: XCUIApplication, _ element: XCUIElement) {
        let scroll = app.scrollViews["area-manager-scroll"]
        XCTAssertTrue(scroll.waitForExistence(timeout: 10))
        for _ in 0..<30 {
            var viewport = scroll.frame.intersection(app.frame)
            let keyboard = app.keyboards.firstMatch
            if keyboard.exists && keyboard.frame.intersects(viewport) {
                viewport.size.height = max(0, keyboard.frame.minY - viewport.minY)
            }
            if element.exists && element.isHittable && element.frame.minY >= viewport.minY
                && element.frame.maxY <= viewport.maxY { return }
            let downward = element.exists && element.frame.minY < viewport.minY
            if keyboard.exists && keyboard.frame.intersects(scroll.frame) {
                // Swipe inside the visible content, not the keyboard covering the scroll view.
                let top = app.coordinate(withNormalizedOffset: .zero).withOffset(
                    CGVector(dx: viewport.midX, dy: viewport.minY + viewport.height * 0.2))
                let bottom = app.coordinate(withNormalizedOffset: .zero).withOffset(
                    CGVector(dx: viewport.midX, dy: viewport.minY + viewport.height * 0.8))
                (downward ? top : bottom).press(forDuration: 0.01, thenDragTo: downward ? bottom : top)
            } else if downward { scroll.swipeDown() }
            else { scroll.swipeUp() }
        }
        XCTFail("Area rename control could not be scrolled into view")
    }

    private func openProjectAreaManager(_ app: XCUIApplication, recovering: Bool = false) {
        if recovering { boardEnabled(app.textFields["projects-create-title"], timeout: 30) }
        else {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
        }
        let row = app.buttons["project-open-776dd5c5-1926-4da1-96ff-5d5096971050"]
        revealPagedElement(app, row, in: app.scrollViews["projects-scroll"])
        row.tap(); boardTap(app, "project-details-toggle")
        projectManagerTap(app, "project-area-open")
        projectManagerTap(app, "project-area-manage")
        boardEnabled(app.textFields["area-create-name"])
    }

    private func projectManagerTap(_ app: XCUIApplication, _ id: String) {
        let button = app.buttons[id]
        if id == "area-manager-close" {
            // The fixed header is outside the manager's scrollable content.
            XCTAssertTrue(button.waitForExistence(timeout: 10))
        } else if app.scrollViews["area-manager-scroll"].exists {
            revealAreaRenameControl(app, button)
        } else {
            let sheet = app.scrollViews["project-area-sheet"]
            revealPagedElement(app, button, in: sheet.exists ? sheet : app.scrollViews.firstMatch,
                               outerEdge: !app.scrollViews["projects-scroll"].exists)
        }
        boardEnabled(button)
        // AX converts frame coordinates through CGFloat; allow rounding noise only.
        XCTAssertGreaterThanOrEqual(button.frame.height, 44 - 0.001)
        XCTAssertGreaterThanOrEqual(button.frame.width, 44 - 0.001)
        button.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: button.frame.width - 4, dy: 4)).tap()
    }

    func testProjectManageAreasAndDrafts() {
        projectManageAreas(library: "a0bd15a2-6f9f-49fa-b7c2-22a6fec99944")
    }

    func testProjectManageAreasLargestText() {
        projectManageAreas(library: "b1b59904-c83b-4f85-9c72-9992deec83fb")
    }

    private func projectManageAreas(library: String) {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", library]; app.launch()
        let source = "170c1eab-65ec-4a38-931d-3f03399b7d17"
        let destination = "af884128-31d5-41eb-978c-2fd1a44b62e8"
        let managerName = app.textFields["area-create-name"]
        let projectName = app.textFields["project-area-create-name"]
        func tap(_ id: String) { projectManagerTap(app, id) }
        func closeWait(_ id: String) {
            expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.buttons[id])
            waitForExpectations(timeout: 15)
        }
        func manager() { tap("project-area-open"); tap("project-area-manage") }
        openProjectAreaManager(app)
        revealAreaRenameControl(app, managerName)
        replaceTextView(managerName, with: "Retained manager draft")
        tap("area-manager-close"); closeWait("area-manager-close")
        XCTAssertTrue(app.buttons["project-area-open"].exists)
        tap("project-area-open"); tap("project-area-add")
        boardEnabled(projectName)
        replaceTextView(projectName, with: "Retained Project Area draft")
        tap("project-area-create-cancel"); tap("project-area-close")
        let notesToggle = app.buttons["project-notes-toggle"]
        revealPagedElement(app, notesToggle, in: app.scrollViews.firstMatch, outerEdge: true)
        boardTap(app, "project-notes-toggle")
        let notes = app.textViews["project-notes-input"]
        revealPagedElement(app, notes, in: app.scrollViews.firstMatch, outerEdge: true)
        replaceProjectNotesText(notes, with: "# Project manager Notes\n\n**Bold** and café.\n")
        manager()
        XCTAssertEqual(managerName.value as? String, "Retained manager draft")
        XCTAssertFalse(app.buttons["area-delete-" + source].isEnabled)
        for (value, cancel) in [("Cancelled Area", true), ("  Renamed Source  ", false),
                                ("  Renamed Source  ", false), ("  HOME  ", false)] {
            tap("area-rename-open-" + source)
            let input = app.textFields["area-rename-name"]
            boardEnabled(input); revealAreaRenameControl(app, input)
            replaceTextView(input, with: value)
            tap(cancel ? "area-rename-cancel" : "area-rename-save")
            expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: input)
            waitForExpectations(timeout: 15)
            XCTAssertEqual(managerName.value as? String, "Retained manager draft")
        }
        XCTAssertFalse(app.buttons["area-rename-open-" + source].exists)
        let survivor = app.buttons["area-rename-open-" + destination]
        revealAreaRenameControl(app, survivor); boardEnabled(survivor)
        XCTAssertTrue(survivor.label.contains("HOME"))
        tap("area-manager-close"); closeWait("area-manager-close")
        XCTAssertEqual(app.staticTexts["project-detail-meta-area"].label, "HOME")
        XCTAssertEqual(notes.value as? String, "# Project manager Notes\n\n**Bold** and café.\n")
        manager(); revealAreaRenameControl(app, managerName)
        replaceTextView(managerName, with: "  Project Managed Area  ")
        tap("area-create-color-#10b981"); tap("area-create-save")
        closeWait("area-manager-close")
        XCTAssertEqual(app.staticTexts["project-detail-meta-area"].label, "Project Managed Area")
        tap("project-area-open")
        let created = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label == %@",
            "project-area-choice-", "Project Managed Area"))
        XCTAssertEqual(created.count, 1); XCTAssertTrue(created.firstMatch.isSelected)
        tap("project-area-add"); boardEnabled(projectName)
        XCTAssertEqual(projectName.value as? String, projectName.placeholderValue)
        tap("project-area-create-cancel"); tap("project-area-close")
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "Project Manage Areas preserves Notes and returns to Details"
        capture.lifetime = .keepAlways; add(capture)
        app.terminate(); app.launch(); openProjectAreaManager(app)
        tap("area-manager-close"); closeWait("area-manager-close")
        XCTAssertEqual(app.staticTexts["project-detail-meta-area"].label, "Project Managed Area")
        app.terminate()
    }

    func testProjectManageAreaControls() {
        projectManageAreaControls(library: "0517b22c-ec66-49ce-aee7-ab512ff708eb")
    }

    func testProjectManageAreaControlsLargestText() {
        projectManageAreaControls(library: "044fc514-5bc6-45ee-a04a-db142539a8fe")
    }

    private func projectManageAreaControls(library: String) {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", library]; app.launch()
        let source = "170c1eab-65ec-4a38-931d-3f03399b7d17"
        let home = "af884128-31d5-41eb-978c-2fd1a44b62e8"
        let metadata = "3abf38fa-7ec4-45f4-ad79-4e30f08b78ad"
        let eligible = "446f1b63-d93c-4372-8b06-49f5db93d8d0"
        let target = "776dd5c5-1926-4da1-96ff-5d5096971050"
        let archivedID = "98432619-81dd-480e-9c35-d4dfa1705ff1"
        let projectDraft = app.textFields["projects-create-title"]
        func tap(_ id: String) { projectManagerTap(app, id) }
        func assertOrder(_ ids: [String]) {
            let expected = ids.map { "area-order-up-" + $0 }
            let query = app.buttons.matching(NSPredicate(
                format: "identifier BEGINSWITH %@", "area-order-up-"))
            expectation(for: NSPredicate { _, _ in
                query.allElementsBoundByIndex.map(\.identifier) == expected
            }, evaluatedWith: app)
            waitForExpectations(timeout: 15)
            XCTAssertFalse(app.buttons[expected[0]].isEnabled)
        }
        func chooseSourceColor(_ color: String, initiallySelected: Bool) {
            tap("area-color-open-" + source)
            let swatch = app.buttons["area-color-" + source + "-" + color]
            revealAreaRenameControl(app, swatch); boardEnabled(swatch)
            XCTAssertEqual(swatch.isSelected, initiallySelected)
            tap(swatch.identifier)
            expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: swatch)
            waitForExpectations(timeout: 15)
            boardEnabled(app.buttons["area-manager-close"], timeout: 15)
            XCTAssertFalse(app.staticTexts["area-color-error"].exists)
        }
        func openProject(_ id: String) {
            let row = app.buttons["project-open-" + id]
            revealPagedElement(app, row, in: app.scrollViews["projects-scroll"])
            boardEnabled(row); row.tap(); boardTap(app, "project-details-toggle")
        }

        boardEnabled(app.buttons["tab-menu"], timeout: 30)
        boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
        boardEnabled(projectDraft)
        boardTap(app, "area-open"); boardTap(app, "area-option-" + source)
        boardEnabled(app.buttons["area-option-" + source])
        XCTAssertTrue(app.buttons["area-option-" + source].isSelected)
        app.buttons["area-dismiss"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.staticTexts["area-title"])
        waitForExpectations(timeout: 10)

        projectDraft.tap(); projectDraft.typeText("Retained controls Project draft")
        let sourceChip = app.buttons["projects-create-area-" + source]
        boardEnabled(sourceChip); XCTAssertTrue(sourceChip.isSelected)
        openProject(target)
        tap("project-area-open"); tap("project-area-manage")
        boardEnabled(app.textFields["area-create-name"])

        let protectedDelete = app.buttons["area-delete-" + source]
        revealAreaRenameControl(app, protectedDelete)
        XCTAssertTrue(protectedDelete.exists); XCTAssertFalse(protectedDelete.isEnabled)
        assertOrder([metadata, source, home, eligible])

        chooseSourceColor("#10b981", initiallySelected: false)
        chooseSourceColor("#10b981", initiallySelected: true)
        tap("area-order-sort-name")
        boardEnabled(app.buttons["area-manager-close"], timeout: 15)
        assertOrder([eligible, home, metadata, source])
        tap("area-order-sort-color")
        boardEnabled(app.buttons["area-manager-close"], timeout: 15)
        assertOrder([source, home, metadata, eligible])
        tap("area-order-up-" + eligible)
        boardEnabled(app.buttons["area-manager-close"], timeout: 15)
        assertOrder([source, home, eligible, metadata])

        tap("area-delete-" + eligible)
        expectation(for: NSPredicate(format: "exists == false"),
                    evaluatedWith: app.buttons["area-delete-" + eligible])
        waitForExpectations(timeout: 15)
        XCTAssertFalse(app.staticTexts["area-delete-error"].exists)
        revealAreaRenameControl(app, protectedDelete)
        XCTAssertTrue(protectedDelete.exists); XCTAssertFalse(protectedDelete.isEnabled)
        assertOrder([source, home, metadata])

        tap("area-manager-close")
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.buttons["area-manager-close"])
        waitForExpectations(timeout: 15)
        XCTAssertEqual(app.staticTexts["project-detail-title"].label, "Metadata parallel Project")
        XCTAssertEqual(app.staticTexts["project-detail-meta-area"].label, "Rename Source")
        boardTap(app, "project-back")
        boardEnabled(projectDraft)
        XCTAssertEqual(projectDraft.value as? String, "Retained controls Project draft")
        XCTAssertTrue(app.buttons["projects-create-area-" + source].isSelected)

        boardTap(app, "area-open")
        boardEnabled(app.buttons["area-option-" + source])
        XCTAssertTrue(app.buttons["area-option-" + source].isSelected)
        boardTap(app, "area-option-__all__")
        boardEnabled(app.buttons["area-option-__all__"])
        XCTAssertTrue(app.buttons["area-option-__all__"].isSelected)
        app.buttons["area-dismiss"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.staticTexts["area-title"])
        waitForExpectations(timeout: 10)

        let archived = app.buttons["projects-section-archived"]
        revealPagedElement(app, archived, in: app.scrollViews["projects-scroll"])
        if archived.value as? String == "Expand" { archived.tap() }
        openProject(archivedID)
        XCTAssertFalse(app.buttons["project-area-open"].exists)
        XCTAssertFalse(app.buttons["project-area-manage"].exists)
        XCTAssertTrue(app.staticTexts["project-detail-meta-area"].exists)
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "Project-origin Area controls preserve drafts and archived read-only state"
        capture.lifetime = .keepAlways; add(capture)
        app.terminate()
    }


    func testProjectTaskFiltersNormalText() { projectTaskFilterFlow(library: "f2f2a252-5f4e-44d0-a89d-bfb60c90e500") }
    func testProjectTaskFiltersLargestText() { projectTaskFilterFlow(library: "fc77542c-170f-447f-812d-0e0b2bd38d56") }

    private func projectFilterTap(_ app: XCUIApplication, _ id: String) {
        let button = app.buttons[id]
        if id.hasPrefix("project-filter-token-") {
            // This flow searches for a single token; XCTest performs its own scroll-to-hit.
            boardEnabled(button)
            print("Filtered token: " + button.debugDescription)
            XCTAssertGreaterThanOrEqual(button.frame.height, 44 - 0.001)
            button.tap()
            return
        } else if ["project-filter-tokens", "project-filter-more", "project-filter-retry"].contains(id) {
            let scroll = app.scrollViews["project-filter-picker-scroll"].exists
                ? app.scrollViews["project-filter-picker-scroll"] : app.scrollViews["project-filter-overview-scroll"]
            revealPagedElement(app, button, in: scroll, outerEdge: true)
        }
        boardEnabled(button); XCTAssertGreaterThanOrEqual(button.frame.height, 44 - 0.001)
        button.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: button.frame.width - 4, dy: button.frame.height / 2)).tap()
    }

    private func projectTaskFilterFlow(library: String) {
        let app = XCUIApplication(); app.launchArguments = ["--native-ui-test-library", library]; app.launch()
        openProjectTaskSortTest(app)
        func tap(_ id: String) { projectFilterTap(app, id) }
        func filters() { tap("project-task-view-options-button"); tap("project-view-filters-option") }
        func search(_ text: String) {
            let input = app.textFields["project-filter-search"]
            revealPagedElement(app, input, in: app.scrollViews["project-filter-overview-scroll"])
            boardEnabled(input); input.tap(); input.typeText(text + "\n")
        }
        filters()
        XCTAssertFalse(app.buttons["project-filter-projects"].exists)
        XCTAssertFalse(app.buttons["project-filter-timeEstimates"].exists)
        search("Alpha action"); tap("project-filters-close")
        let alpha = app.buttons["task-title-d55f6859-cf8e-4643-a1ad-eff6db59262e"]
        let zulu = app.buttons["task-title-acc031d9-9cac-4296-8420-840bcd17a562"]
        boardEnabled(alpha); XCTAssertFalse(zulu.exists)
        alpha.tap(); boardEnabled(app.buttons["task-mode-edit"]); boardTap(app, "task-view-close")
        boardEnabled(app.buttons["project-filter-button"])
        tap("project-task-view-options-button"); tap("project-view-sort-option"); tap("project-sort-close")
        XCTAssertFalse(zulu.exists)
        tap("project-filter-button"); tap("project-filters-clear"); tap("project-filter-tokens")
        let query = app.textFields["project-filter-picker-search"]
        boardEnabled(query); query.tap(); query.typeText("token-124\n")
        let token = app.buttons["project-filter-token-@token-124"]
        boardEnabled(token)
        tap(token.identifier); boardEnabled(token); XCTAssertTrue(token.isSelected)
        tap(token.identifier); boardEnabled(token); XCTAssertEqual(token.value as? String, "Excluded")
        tap(token.identifier); boardEnabled(token); XCTAssertFalse(token.isSelected)
        XCTAssertEqual(token.value as? String ?? "", "")
        tap(token.identifier); boardEnabled(token); XCTAssertTrue(token.isSelected)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Project task token filters"
        shot.lifetime = .keepAlways; add(shot)
        tap("project-filters-close"); boardEnabled(alpha); XCTAssertFalse(zulu.exists)
        tap("project-filter-clear")
        filters(); search("no-match-project-filter-proof"); tap("project-filters-close")
        boardEnabled(app.buttons["project-filter-clear"]); XCTAssertFalse(alpha.exists)
        let emptyShot = XCTAttachment(screenshot: app.screenshot()); emptyShot.name = "Project task no-match filters"
        emptyShot.lifetime = .keepAlways; add(emptyShot)
        tap("project-filter-clear")
        filters(); search("Alpha action"); tap("project-filters-close")
        boardEnabled(app.buttons["project-filter-button"]); boardTap(app, "project-back")
        let row = app.buttons["project-open-b6b325b0-c0d7-411d-9114-f5b816ec6286"]
        revealPagedElement(app, row, in: app.scrollViews["projects-scroll"]); row.tap()
        boardEnabled(app.buttons["project-details-toggle"]); XCTAssertFalse(app.buttons["project-filter-button"].exists)
        app.terminate(); app.launch(); openProjectTaskSortTest(app)
        XCTAssertFalse(app.buttons["project-filter-button"].exists)
        boardTap(app, "project-back")
        let closed = app.buttons["projects-section-archived"]
        revealPagedElement(app, closed, in: app.scrollViews["projects-scroll"])
        if closed.value as? String == "Expand" { closed.tap() }
        let archived = app.buttons["project-open-35361330-8e78-4a4c-8197-aaca63070b98"]
        revealPagedElement(app, archived, in: app.scrollViews["projects-scroll"]); archived.tap()
        filters(); search("Archived-task action"); tap("project-filters-close")
        boardEnabled(app.buttons["project-filter-button"]); app.terminate()
    }

    func testProjectTaskFilterReadFailureRetriesOneTokenEdit() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", "afd15f4c-55f2-4b80-b757-4205054628b1", "--native-project-filter-read-failure"]
        app.launch(); openProjectTaskSortTest(app)
        func tap(_ id: String) { projectFilterTap(app, id) }
        tap("project-task-view-options-button"); tap("project-view-filters-option"); tap("project-filter-tokens")
        let query = app.textFields["project-filter-picker-search"]
        boardEnabled(query); query.tap(); query.typeText("token-124\n")
        tap("project-filter-token-@token-124")
        boardEnabled(app.buttons["project-filter-retry"])
        XCTAssertFalse(app.buttons["project-filter-token-@token-124"].exists && app.buttons["project-filter-token-@token-124"].isEnabled)
        tap("project-filter-retry")
        let token = app.buttons["project-filter-token-@token-124"]
        boardEnabled(token); XCTAssertTrue(token.isSelected); XCTAssertNotEqual(token.value as? String, "Excluded")
        tap("project-filters-close")
        boardEnabled(app.buttons["task-title-d55f6859-cf8e-4643-a1ad-eff6db59262e"])
        XCTAssertFalse(app.buttons["task-title-acc031d9-9cac-4296-8420-840bcd17a562"].exists)
        app.terminate()
    }

    func testProjectTaskFilterCorrectedLocationRecoversFailedRead() {
        let app = XCUIApplication(); app.launchArguments = ["--native-ui-test-library", "5e87538e-e1e5-4f7c-9a5c-bb75de6e6f9e"]
        app.launch(); openProjectTaskSortTest(app)
        func tap(_ id: String) { projectFilterTap(app, id) }
        tap("project-task-view-options-button"); tap("project-view-filters-option"); tap("project-filter-more")
        let input = app.textFields["project-filter-location"]
        revealPagedElement(app, input, in: app.scrollViews["project-filter-overview-scroll"])
        boardEnabled(input); input.tap(); input.typeText(String(repeating: "x", count: 501))
        boardEnabled(app.buttons["project-filter-retry"])
        // Keep the caret at the end while correcting the rejected value.
        input.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 501) + "Office\n")
        XCTAssertEqual(input.value as? String, "Office")
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.buttons["project-filter-retry"])
        waitForExpectations(timeout: 10)
        tap("project-filters-close")
        boardEnabled(app.buttons["task-title-d55f6859-cf8e-4643-a1ad-eff6db59262e"])
        XCTAssertFalse(app.buttons["task-title-acc031d9-9cac-4296-8420-840bcd17a562"].exists)
        app.terminate()
    }

    func testProjectTaskFiltersFlushNotesAndRetainCompleted() {
        let app = XCUIApplication(); app.launchArguments = ["--native-ui-test-library", "8c6011c9-d626-40ad-81c1-065f8fb15f09"]
        app.launch(); openProjectTaskSortTest(app)
        projectManagerTap(app, "project-details-toggle"); projectManagerTap(app, "project-notes-toggle")
        let notes = app.textViews["project-notes-input"]
        revealPagedElement(app, notes, in: app.scrollViews["project-detail-scroll"], outerEdge: true)
        replaceProjectNotesText(notes, with: "Notes before Project filters\n")
        func tap(_ id: String) { projectFilterTap(app, id) }
        tap("project-task-view-options-button"); tap("project-view-filters-option")
        let search = app.textFields["project-filter-search"]
        boardEnabled(search); search.tap(); search.typeText("Done action\n"); tap("project-filters-close")
        boardEnabled(app.buttons["project-filter-button"])
        XCTAssertFalse(app.buttons["task-title-8da3e93c-4ddc-4092-9713-54ba386b6873"].exists)
        tap("project-task-view-options-button"); tap("project-view-completed-option")
        let completed = app.buttons["project-completed-toggle"]
        revealPagedElement(app, completed, in: app.scrollViews["project-detail-scroll"], outerEdge: true)
        boardEnabled(completed); XCTAssertEqual(completed.value as? String, "Expand"); completed.tap()
        boardEnabled(app.buttons["task-title-8da3e93c-4ddc-4092-9713-54ba386b6873"])
        XCTAssertFalse(app.buttons["task-title-d55f6859-cf8e-4643-a1ad-eff6db59262e"].exists)
        tap("project-filter-clear")
        revealPagedElement(app, completed, in: app.scrollViews["project-detail-scroll"], outerEdge: true)
        XCTAssertEqual(completed.value as? String, "Collapse")
        app.terminate(); app.launch(); openProjectTaskSortTest(app)
        XCTAssertFalse(app.buttons["project-filter-button"].exists)
        revealPagedElement(app, completed, in: app.scrollViews["project-detail-scroll"], outerEdge: true)
        XCTAssertEqual(completed.value as? String, "Expand")
        app.terminate()
    }

    func testReferenceSortNormal() { referenceSortFlow(library: "92022107-8ca9-4b05-b6b4-b1d10f405b54") }
    func testReferenceSortLargestText() { referenceSortFlow(library: "c25483f6-39b2-44d3-9e38-cb5af4cc7e78") }

    private func openReferenceSortTest(_ app: XCUIApplication, recovered: Bool = false) {
        if !recovered {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu")
            let reference = app.buttons["menu-reference"]
            if !reference.isHittable {
                revealPagedElement(app, reference, in: app.scrollViews.containing(.button, identifier: "menu-projects").firstMatch)
            }
            boardTap(app, "menu-reference")
        }
        boardEnabled(app.buttons["reference-overflow-button"], timeout: 30)
    }

    private func referenceSortTap(_ app: XCUIApplication, _ id: String) {
        let button = app.buttons[id]
        if !button.isHittable, app.scrollViews["reference-panel-scroll"].exists {
            revealPagedElement(app, button, in: app.scrollViews["reference-panel-scroll"])
        }
        boardEnabled(button); XCTAssertTrue(button.isHittable)
        XCTAssertGreaterThanOrEqual(button.frame.height, 44 - 0.001); button.tap()
    }

    private func openReferenceSortChoices(_ app: XCUIApplication) {
        boardTap(app, "reference-overflow-button"); boardTap(app, "reference-sort-action")
        boardEnabled(app.buttons["reference-sort-default"])
        XCTAssertFalse(app.buttons["reference-back"].isHittable)
    }

    private func referenceSortFlow(library: String) {
        let app = XCUIApplication(); app.launchArguments = ["--native-ui-test-library", library, "--native-reference-sort-read-failure"]
        app.launch(); openReferenceSortTest(app)
        boardTap(app, "reference-overflow-button"); boardTap(app, "reference-sort-action")
        XCTAssertTrue(app.staticTexts["reference-sort-error"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["reference-sort-default"].exists)
        boardTap(app, "reference-sort-retry"); boardEnabled(app.buttons["reference-sort-default"])
        XCTAssertTrue(app.buttons["reference-sort-default"].isSelected)
        referenceSortTap(app, "reference-menu-close")
        for choice in ["title", "title", "due", "start", "review", "timeEstimate", "created", "created-desc", "default", "title"] {
            openReferenceSortChoices(app)
            referenceSortTap(app, "reference-sort-" + choice)
            boardEnabled(app.buttons["reference-overflow-button"])
            XCTAssertFalse(app.staticTexts["reference-sort-error"].exists)
        }
        openReferenceSortChoices(app)
        let title = app.buttons["reference-sort-title"]
        if !title.isHittable { revealPagedElement(app, title, in: app.scrollViews["reference-panel-scroll"]) }
        XCTAssertTrue(title.isSelected)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Reference saved Sort"
        shot.lifetime = .keepAlways; add(shot)
        referenceSortTap(app, "reference-menu-close")
        boardTap(app, "reference-back"); openReferenceSortTest(app)
        openReferenceSortChoices(app); XCTAssertTrue(title.isSelected)
        referenceSortTap(app, "reference-menu-close")
        app.terminate(); app.launchArguments = ["--native-ui-test-library", library]
        app.launch(); openReferenceSortTest(app)
        openReferenceSortChoices(app); XCTAssertTrue(title.isSelected)
        referenceSortTap(app, "reference-menu-close"); app.terminate()
    }

    func testReferenceSortFailureKeepsExactRequest() {
        let app = XCUIApplication(); app.launchArguments = ["--native-ui-test-library", "09491429-1569-4dd0-9926-53c7e26f44d8"]
        app.launch(); openReferenceSortTest(app); openReferenceSortChoices(app)
        referenceSortTap(app, "reference-sort-title")
        XCTAssertTrue(app.staticTexts["reference-sort-error"].waitForExistence(timeout: 15))
        for _ in 0..<2 {
            XCTAssertFalse(app.buttons["reference-menu-close"].isEnabled)
            XCTAssertFalse(app.buttons["reference-panel-back"].isEnabled)
            XCTAssertFalse(app.buttons["reference-sort-default"].isEnabled)
            referenceSortTap(app, "reference-sort-retry"); boardEnabled(app.buttons["reference-sort-retry"])
        }
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Reference sort exact retry"
        shot.lifetime = .keepAlways; add(shot); app.terminate()
    }

    func testReferenceSortColdRecovery() {
        let app = XCUIApplication(); app.launchArguments = ["--native-ui-test-library", "09491429-1569-4dd0-9926-53c7e26f44d8"]
        app.launch(); openReferenceSortTest(app, recovered: true); openReferenceSortChoices(app)
        XCTAssertTrue(app.buttons["reference-sort-title"].isSelected)
        referenceSortTap(app, "reference-menu-close"); app.terminate()
        app.launch(); openReferenceSortTest(app); openReferenceSortChoices(app)
        XCTAssertTrue(app.buttons["reference-sort-title"].isSelected)
        referenceSortTap(app, "reference-menu-close"); app.terminate()
    }

    func testFocusSavedFiltersNormal() { focusSavedFilterFlow(library: "0d96fc3d-f11b-4d95-b97d-ba470755e7f6") }
    func testFocusSavedFiltersLargestText() { focusSavedFilterFlow(library: "7483ade0-876f-4f71-9452-e686cdf4fe56") }

    private func openFocusSavedFilterTest(_ app: XCUIApplication) {
        boardEnabled(app.buttons["tab-focus"], timeout: 30); boardTap(app, "tab-focus")
        boardEnabled(app.buttons["focus-view-options"])
    }

    private func beginFocusFilterSave(_ app: XCUIApplication, name: String) {
        boardTap(app, "focus-filters-open")
        let scroll = app.scrollViews["focus-controls-scroll"]
        revealPagedElement(app, app.buttons["focus-filter-more"], in: scroll)
        boardTap(app, "focus-filter-more")
        revealPagedElement(app, app.buttons["focus-filter-priority-high"], in: scroll)
        boardTap(app, "focus-filter-priority-high")
        boardEnabled(app.buttons["focus-filter-save"]); boardTap(app, "focus-filter-save")
        let field = app.textFields["focus-saved-name"]
        boardEnabled(field); replaceTextView(field, with: name)
        boardEnabled(app.buttons["focus-saved-confirm"])
    }

    private func savedFilterTap(_ app: XCUIApplication, _ target: XCUIElement) {
        for _ in 0..<8 {
            if target.exists && target.isHittable { break }
            app.scrollViews["focus-saved-strip"].swipeLeft()
        }
        boardEnabled(target); XCTAssertTrue(target.isHittable); target.tap()
    }

    private func focusSavedFilterFlow(library: String) {
        let app = XCUIApplication(); app.launchArguments = ["--native-ui-test-library", library]
        app.launch(); openFocusSavedFilterTest(app)
        beginFocusFilterSave(app, name: "Native saved filter")
        let name = app.textFields["focus-saved-name"]
        replaceTextView(name, with: " ")
        XCTAssertFalse(app.buttons["focus-saved-confirm"].isEnabled)
        replaceTextView(name, with: "Native saved filter")
        let card = app.descendants(matching: .any).matching(identifier: "focus-saved-card").firstMatch
        XCTAssertTrue(card.exists); XCTAssertLessThan(card.frame.height, app.frame.height * 0.85)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Save Focus filter"; shot.lifetime = .keepAlways; add(shot)
        boardTap(app, "focus-saved-confirm")
        let saved = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label == %@", "focus-saved-", "Native saved filter")).firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 15)); boardEnabled(saved)
        XCTAssertTrue(saved.isSelected)
        let id = String(saved.identifier.dropFirst("focus-saved-".count))
        boardTap(app, "tab-inbox"); boardTap(app, "tab-focus"); XCTAssertTrue(saved.isSelected)
        app.terminate(); app.launch(); openFocusSavedFilterTest(app)
        savedFilterTap(app, app.buttons["focus-saved-" + id]); XCTAssertTrue(app.buttons["focus-saved-" + id].isSelected)
        savedFilterTap(app, app.buttons["focus-saved-delete-" + id])
        boardTap(app, "focus-saved-cancel"); XCTAssertTrue(app.buttons["focus-saved-" + id].exists)
        savedFilterTap(app, app.buttons["focus-saved-delete-" + id]); boardTap(app, "focus-saved-confirm")
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.buttons["focus-saved-" + id]); waitForExpectations(timeout: 15)
        app.scrollViews["focus-saved-strip"].swipeRight()
        savedFilterTap(app, app.buttons["focus-saved-task73-advanced"])
        boardTap(app, "focus-filters-open")
        let criterion = app.buttons["focus-filter-advanced-advanced:dueDateRange"]
        revealPagedElement(app, criterion, in: app.scrollViews["focus-controls-scroll"])
        boardEnabled(criterion); criterion.tap(); boardTap(app, "focus-saved-cancel")
        XCTAssertTrue(criterion.exists); criterion.tap(); boardTap(app, "focus-saved-confirm")
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: criterion); waitForExpectations(timeout: 15)
        XCTAssertFalse(app.staticTexts["focus-saved-error"].exists)
        boardTap(app, "focus-controls-close")
        app.terminate(); app.launch(); openFocusSavedFilterTest(app)
        savedFilterTap(app, app.buttons["focus-saved-task73-advanced"]); boardTap(app, "focus-filters-open")
        XCTAssertFalse(criterion.exists); boardTap(app, "focus-controls-close"); app.terminate()
    }

    func testFocusSavedFilterFailureKeepsExactRequest() {
        let app = XCUIApplication(); app.launchArguments = ["--native-ui-test-library", "6e30400b-1516-4735-8e08-74d3efc004f0"]
        app.launch(); openFocusSavedFilterTest(app); beginFocusFilterSave(app, name: "Native recovered filter")
        boardTap(app, "focus-saved-confirm")
        XCTAssertTrue(app.staticTexts["focus-saved-error"].waitForExistence(timeout: 15))
        for _ in 0..<2 {
            XCTAssertFalse(app.buttons["focus-saved-cancel"].isEnabled)
            XCTAssertFalse(app.textFields["focus-saved-name"].isEnabled)
            XCTAssertEqual(app.textFields["focus-saved-name"].value as? String, "Native recovered filter")
            let retry = app.buttons["focus-saved-retry"]
            boardEnabled(retry); XCTAssertTrue(retry.isHittable); XCTAssertGreaterThanOrEqual(retry.frame.height, 44)
            retry.tap(); boardEnabled(retry)
        }
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Saved filter exact retry"; shot.lifetime = .keepAlways; add(shot)
        app.terminate()
    }

    func testFocusSavedFilterColdRecovery() {
        let app = XCUIApplication(); app.launchArguments = ["--native-ui-test-library", "6e30400b-1516-4735-8e08-74d3efc004f0"]
        app.launch(); boardEnabled(app.buttons["focus-view-options"], timeout: 30)
        let saved = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label == %@", "focus-saved-", "Native recovered filter")).firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 15)); XCTAssertTrue(saved.isSelected)
        XCTAssertFalse(app.staticTexts["focus-saved-error"].exists)
        app.terminate(); app.launch(); openFocusSavedFilterTest(app); XCTAssertTrue(saved.exists); app.terminate()
    }

    func testFocusOrderNormal() { focusOrderFlow(library: "d617ac56-809d-4509-b8a6-e0bcc3f403d7") }
    func testFocusOrderLargestText() { focusOrderFlow(library: "6d5cd93a-7fad-4ecb-b9fe-b7cf84406e24") }

    private func openFocusOrderTest(_ app: XCUIApplication) {
        boardEnabled(app.buttons["tab-focus"], timeout: 30); boardTap(app, "tab-focus")
        let toggle = app.buttons["focus-reorder-toggle"]
        revealPagedElement(app, toggle, in: app.scrollViews.containing(.button, identifier: "focus-view-options").firstMatch)
        boardEnabled(toggle); toggle.tap(); boardEnabled(app.buttons["focus-reorder-done"])
    }

    private func focusOrderRow(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: "focus-reorder-row-" + id).firstMatch
    }

    private func dragFocusOrder(_ app: XCUIApplication, _ source: String, below destination: String) {
        let a = focusOrderRow(app, source); let b = focusOrderRow(app, destination)
        XCTAssertTrue(a.waitForExistence(timeout: 15)); XCTAssertTrue(b.exists)
        let list = app.descendants(matching: .any).matching(identifier: "focus-reorder-list").firstMatch
        let origin = app.coordinate(withNormalizedOffset: .zero)
        origin.withOffset(CGVector(dx: list.frame.maxX - 24, dy: a.frame.midY))
            .press(forDuration: 0.8, thenDragTo: origin.withOffset(CGVector(dx: list.frame.maxX - 24, dy: b.frame.maxY - 5)))
    }

    private func focusOrderFlow(library: String) {
        let app = XCUIApplication(); app.launchArguments = ["--native-ui-test-library", library]
        app.launch(); openFocusOrderTest(app)
        let a = "acc031d9-9cac-4296-8420-840bcd17a562"
        let b = "dd5c836f-26ad-47a6-8d1e-d22f178db1c4"
        let c = "e6b85a73-6e89-4a98-826d-f8d109805591"
        XCTAssertFalse(focusOrderRow(app, "a007e3b4-2789-43b0-8e79-86617f91c5c5").exists)
        func position(_ id: String, _ number: Int) {
            let row = focusOrderRow(app, id)
            expectation(for: NSPredicate(format: "label CONTAINS %@", "Position \(number) of 3"), evaluatedWith: row)
            waitForExpectations(timeout: 15)
            boardEnabled(app.buttons["focus-reorder-done"])
        }
        position(a, 1); dragFocusOrder(app, a, below: c); position(a, 3)
        dragFocusOrder(app, b, below: c); position(c, 1); position(b, 2)
        XCTAssertFalse(app.staticTexts["focus-reorder-error"].exists)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Focus reorder"; shot.lifetime = .keepAlways; add(shot)
        boardTap(app, "focus-reorder-done")
        boardTap(app, "tab-inbox"); openFocusOrderTest(app); position(c, 1)
        boardTap(app, "tab-inbox"); XCTAssertFalse(app.buttons["focus-reorder-done"].exists)
        app.terminate(); app.launch(); openFocusOrderTest(app); position(c, 1); position(a, 3)
        boardTap(app, "focus-reorder-done"); app.terminate()
    }

    func testFocusOrderFailureKeepsExactRequest() {
        let app = XCUIApplication(); app.launchArguments = ["--native-ui-test-library", "8e7e47b0-bbe8-4187-827e-d78e41ae68a0"]
        app.launch(); openFocusOrderTest(app)
        dragFocusOrder(app, "acc031d9-9cac-4296-8420-840bcd17a562", below: "e6b85a73-6e89-4a98-826d-f8d109805591")
        XCTAssertTrue(app.staticTexts["focus-reorder-error"].waitForExistence(timeout: 15))
        for _ in 0..<2 {
            XCTAssertFalse(app.buttons["focus-reorder-done"].isEnabled)
            XCTAssertFalse(app.buttons["tab-inbox"].isEnabled)
            let retry = app.buttons["focus-reorder-retry"]
            boardEnabled(retry); XCTAssertTrue(retry.isHittable); XCTAssertGreaterThanOrEqual(retry.frame.height, 44)
            retry.tap(); boardEnabled(retry)
        }
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Focus order exact retry"; shot.lifetime = .keepAlways; add(shot)
        app.terminate()
    }

    func testFocusOrderColdRecovery() {
        let app = XCUIApplication(); app.launchArguments = ["--native-ui-test-library", "8e7e47b0-bbe8-4187-827e-d78e41ae68a0"]
        app.launch(); openFocusOrderTest(app)
        XCTAssertTrue(focusOrderRow(app, "acc031d9-9cac-4296-8420-840bcd17a562").label.contains("Position 3 of 3"))
        XCTAssertFalse(app.staticTexts["focus-reorder-error"].exists)
        boardTap(app, "focus-reorder-done"); app.terminate()
    }

    func testFocusGroupingNormal() { focusGroupingFlow(library: "200e5e94-1e41-4b90-a43f-190ae4d55bdc", largest: false) }
    func testFocusGroupingLargestText() { focusGroupingFlow(library: "b7dc20b6-14a0-4240-b9cb-bee8dbf63c10", largest: true) }

    private func focusGroupChoice(_ app: XCUIApplication, _ value: String) {
        let choice = app.buttons["focus-group-" + value]
        revealPagedElement(app, choice, in: app.scrollViews["focus-controls-scroll"])
        boardEnabled(choice); choice.tap()
        expectation(for: NSPredicate(format: "selected == true AND enabled == true"), evaluatedWith: choice)
        waitForExpectations(timeout: 15)
        XCTAssertFalse(app.staticTexts["focus-group-error"].exists)
    }

    private func focusGroupingFlow(library: String, largest: Bool) {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", library]
        app.launch(); boardEnabled(app.buttons["tab-focus"], timeout: 30)
        boardTap(app, "tab-focus"); boardEnabled(app.buttons["focus-view-options"])
        if !largest { boardTap(app, "focus-saved-task71-filter") }
        boardTap(app, "focus-view-options")
        if !largest {
            focusGroupChoice(app, "area") // Same effective grouping still detaches the saved filter.
            boardTap(app, "focus-controls-close")
            XCTAssertFalse(app.buttons["focus-saved-task71-filter"].isSelected)
            boardTap(app, "focus-view-options")
            XCTAssertTrue(app.buttons["focus-sort-due"].isSelected)
        }
        for value in largest ? ["project", "tag", "none", "project"] : ["context", "energy", "priority", "person", "tag", "none", "project"] {
            focusGroupChoice(app, value)
        }
        focusGroupChoice(app, "project") // Repeating the selected value must not write.
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = largest ? "Largest Focus grouping" : "Focus grouping choices"
        shot.lifetime = .keepAlways; add(shot)
        boardTap(app, "focus-controls-close")
        let headers = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "focus-group-header-"))
        revealPagedElement(app, headers.firstMatch, in: app.scrollViews.containing(.button, identifier: "focus-view-options").firstMatch)
        XCTAssertGreaterThan(headers.count, 0)
        boardTap(app, "tab-inbox"); boardTap(app, "tab-focus")
        boardTap(app, "focus-view-options"); XCTAssertTrue(app.buttons["focus-group-project"].isSelected)
        boardTap(app, "focus-controls-close")
        app.terminate(); app.launch(); boardEnabled(app.buttons["tab-focus"], timeout: 30)
        boardTap(app, "tab-focus"); boardTap(app, "focus-view-options")
        XCTAssertTrue(app.buttons["focus-group-project"].isSelected)
        XCTAssertFalse(app.staticTexts["focus-group-error"].exists)
        app.terminate()
    }

    func testFocusGroupingFailureKeepsExactRequest() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", "5f53038f-21b9-4b7a-98e5-ff571b1fad91"]
        app.launch(); boardEnabled(app.buttons["tab-focus"], timeout: 30)
        boardTap(app, "tab-focus"); boardTap(app, "focus-view-options")
        let choice = app.buttons["focus-group-project"]
        revealPagedElement(app, choice, in: app.scrollViews["focus-controls-scroll"])
        choice.tap()
        XCTAssertTrue(app.staticTexts["focus-group-error"].waitForExistence(timeout: 15))
        XCTAssertEqual(app.staticTexts["focus-group-error"].label, "Couldn't save this setting. Try again.")
        for _ in 0..<2 {
            XCTAssertFalse(choice.isEnabled)
            XCTAssertFalse(app.buttons["focus-controls-close"].isEnabled)
            let retry = app.buttons["focus-group-retry"]
            boardEnabled(retry); XCTAssertTrue(retry.isHittable)
            XCTAssertGreaterThanOrEqual(retry.frame.height, 44)
            retry.tap(); boardEnabled(retry)
        }
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "Focus grouping exact retry"; shot.lifetime = .keepAlways; add(shot)
        app.terminate()
    }

    func testFocusGroupingColdRecovery() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", "5f53038f-21b9-4b7a-98e5-ff571b1fad91"]
        app.launch(); boardEnabled(app.buttons["focus-view-options"], timeout: 30)
        boardTap(app, "focus-view-options")
        XCTAssertTrue(app.buttons["focus-group-project"].isSelected)
        XCTAssertFalse(app.staticTexts["focus-group-error"].exists)
        boardTap(app, "focus-controls-close"); app.terminate()
    }

    func testFocusCompactLabelsNormal() { compactFocusLabels(library: "3f93f362-9eb7-4a5c-87f4-aee622376c17", largest: false) }
    func testFocusCompactLabelsLargestText() { compactFocusLabels(library: "9248813b-29bc-4015-b2d1-8468b3cd8276", largest: true) }

    private func compactFocusLabels(library: String, largest: Bool) {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", library]
        app.launch(); boardEnabled(app.buttons["tab-focus"], timeout: 30)
        boardTap(app, "tab-focus"); boardEnabled(app.buttons["focus-view-options"])
        let heading = app.buttons["focus-section-focus"]
        boardEnabled(heading)
        XCTAssertEqual(heading.label, "Today's Focus · 1")
        XCTAssertGreaterThanOrEqual(heading.frame.height, 44)
        XCTAssertLessThanOrEqual(heading.frame.height, 60)
        let reorder = app.buttons["focus-reorder-toggle"]
        XCTAssertTrue(reorder.exists); XCTAssertTrue(reorder.isEnabled)
        XCTAssertLessThanOrEqual(heading.frame.maxX, reorder.frame.minX)
        let title = app.buttons["task-title-acc031d9-9cac-4296-8420-840bcd17a562"]
        boardEnabled(title)
        if largest { XCTAssertGreaterThan(title.frame.height, 60) }
        for (id, label) in [("tab-focus", "Focus"), ("tab-inbox", "Inbox"), ("tab-review", "Review"), ("tab-menu", "Menu")] {
            let tab = app.buttons[id]; boardEnabled(tab)
            XCTAssertEqual(tab.label, label)
            XCTAssertGreaterThanOrEqual(tab.frame.width, 44)
            XCTAssertGreaterThanOrEqual(tab.frame.height, 44)
        }
        let capture = app.buttons["capture-open"]; boardEnabled(capture)
        XCTAssertGreaterThanOrEqual(capture.frame.width, 44)
        XCTAssertGreaterThanOrEqual(capture.frame.height, 44)
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = largest ? "Compact labels and full-size task text" : "Normal Focus compact labels"
        shot.lifetime = .keepAlways; add(shot)
        boardTap(app, "tab-inbox"); boardEnabled(app.buttons["tab-review"])
        boardTap(app, "tab-review"); boardEnabled(app.buttons["review-start"])
        boardTap(app, "tab-focus"); boardEnabled(heading)
        XCTAssertEqual(heading.value as? String, "Collapse")
        app.terminate(); app.launch(); boardEnabled(app.buttons["tab-focus"], timeout: 30)
        boardTap(app, "tab-focus"); boardEnabled(heading)
        XCTAssertEqual(heading.label, "Today's Focus · 1")
        app.terminate()
    }

    private func openTaskFocusTest(_ app: XCUIApplication) {
        boardEnabled(app.buttons["tab-focus"], timeout: 30); boardTap(app, "tab-focus")
        boardEnabled(app.buttons["focus-view-options"])
        let next = app.buttons["focus-section-next"]
        revealPagedElement(app, next, in: app.scrollViews.containing(.button, identifier: "focus-view-options").firstMatch)
        if next.value as? String == "Expand" { next.tap() }
    }

    func testTaskFocusStarAndLimit() { taskFocusStarFlow(library: "163d398f-1da1-4310-aa97-17ef3f25ce5e") }
    func testTaskFocusStarLargestText() { taskFocusStarFlow(library: "9c637945-abf8-407b-8153-b10f63d805d9") }

    private func taskFocusStarFlow(library: String) {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", library]
        app.launch(); openTaskFocusTest(app)
        let aID = "acc031d9-9cac-4296-8420-840bcd17a562"
        let bID = "d55f6859-cf8e-4643-a1ad-eff6db59262e"
        let star = app.buttons["task-focus-" + aID].firstMatch
        let focusScroll = app.scrollViews.containing(.button, identifier: "focus-view-options").firstMatch
        func expectStar(_ label: String) {
            revealPagedElement(app, star, in: focusScroll)
            boardEnabled(star)
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "label == %@", label), object: star)], timeout: 15), .completed)
        }
        expectStar("Add to today's focus")
        XCTAssertGreaterThanOrEqual(star.frame.width, 44)
        XCTAssertGreaterThanOrEqual(star.frame.height, 44)
        star.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: star.frame.width - 3, dy: 3)).tap()
        expectStar("Remove from focus")
        XCTAssertFalse(app.buttons["task-view-close"].exists)
        let blocked = app.buttons["task-focus-" + bID]
        revealPagedElement(app, blocked, in: focusScroll)
        boardEnabled(blocked); blocked.tap()
        XCTAssertTrue(app.staticTexts["task-focus-blocked"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["task-focus-blocked"].label.contains("1"))
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "Task Focus star and shared limit"; shot.lifetime = .keepAlways; add(shot)
        app.terminate(); app.launch(); openTaskFocusTest(app)
        expectStar("Remove from focus")
        let focusStar = app.buttons["task-focus-" + aID].firstMatch
        boardEnabled(focusStar); XCTAssertEqual(focusStar.label, "Remove from focus")
        focusStar.tap()
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in !focusStar.exists || focusStar.label != "Remove from focus" }, object: nil)], timeout: 15), .completed)
        boardEnabled(app.buttons["tab-menu"])
        XCTAssertFalse(app.buttons["task-view-close"].exists)
        app.terminate(); app.launch(); openTaskFocusTest(app)
        expectStar("Add to today's focus")
        app.buttons["task-title-" + aID].firstMatch.tap()
        boardEnabled(app.buttons["task-view-close"]); boardTap(app, "task-view-close")
        app.terminate()
    }

    func testDailyReviewTaskFocusStar() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", "e331ca00-fa05-40cc-8ef0-be82a1bd4d41"]
        app.launch(); boardEnabled(app.buttons["tab-menu"], timeout: 30)
        if app.buttons["tab-review"].exists { boardTap(app, "tab-review") }
        else { boardTap(app, "tab-menu"); boardTap(app, "menu-review") }
        boardTap(app, "review-start"); boardTap(app, "review-start-daily")
        boardEnabled(app.buttons["review-guide-close"])
        let scroll = app.scrollViews["review-guide-content-focus"]
        for _ in 0..<6 where !scroll.exists {
            boardTap(app, "review-guide-next")
            boardEnabled(app.buttons["review-guide-close"])
        }
        XCTAssertTrue(scroll.waitForExistence(timeout: 15))
        let star = app.buttons["task-focus-acc031d9-9cac-4296-8420-840bcd17a562"]
        revealPagedElement(app, star, in: scroll, more: "review-guide-more", ready: app.buttons["review-guide-close"])
        boardEnabled(star); XCTAssertEqual(star.label, "Add to today's focus"); star.tap()
        boardEnabled(app.buttons["review-guide-close"])
        revealPagedElement(app, star, in: scroll, more: "review-guide-more", ready: app.buttons["review-guide-close"])
        boardEnabled(star); XCTAssertEqual(star.label, "Remove from focus")
        let blocked = app.buttons["task-focus-d55f6859-cf8e-4643-a1ad-eff6db59262e"]
        revealPagedElement(app, blocked, in: scroll, more: "review-guide-more", ready: app.buttons["review-guide-close"])
        boardEnabled(blocked); blocked.tap()
        let notice = app.staticTexts["task-focus-blocked"]
        XCTAssertTrue(notice.waitForExistence(timeout: 15)); XCTAssertTrue(notice.isHittable)
        XCTAssertTrue(notice.label.contains("1"))
        revealPagedElement(app, star, in: scroll)
        boardEnabled(star); star.tap(); boardEnabled(app.buttons["review-guide-close"])
        revealPagedElement(app, star, in: scroll)
        boardEnabled(star); XCTAssertEqual(star.label, "Add to today's focus")
        XCTAssertFalse(app.buttons["task-view-close"].exists)
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "Daily Review task Focus star"; shot.lifetime = .keepAlways; add(shot)
        boardTap(app, "review-guide-close"); app.terminate()
    }

    func testTaskFocusStarFailureKeepsExactRequest() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", "53675bda-dd8f-4c63-88e0-0e44de40eb52"]
        app.launch(); openTaskFocusTest(app)
        let star = app.buttons["task-focus-acc031d9-9cac-4296-8420-840bcd17a562"]
        revealPagedElement(app, star, in: app.scrollViews.containing(.button, identifier: "focus-view-options").firstMatch)
        boardEnabled(star); star.tap()
        XCTAssertTrue(app.staticTexts["persistence-error"].waitForExistence(timeout: 15))
        for _ in 0..<2 {
            XCTAssertFalse(star.isEnabled)
            let retry = app.buttons["persistence-retry"]
            boardEnabled(retry); XCTAssertGreaterThanOrEqual(retry.frame.height, 44)
            retry.tap(); boardEnabled(retry)
        }
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "Task Focus exact retry"; shot.lifetime = .keepAlways; add(shot)
        app.terminate()
    }

    func testTaskFocusStarColdRecovery() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", "53675bda-dd8f-4c63-88e0-0e44de40eb52"]
        app.launch()
        let star = app.buttons["task-focus-acc031d9-9cac-4296-8420-840bcd17a562"].firstMatch
        boardEnabled(star, timeout: 30); XCTAssertEqual(star.label, "Remove from focus")
        XCTAssertFalse(app.staticTexts["persistence-error"].exists)
        app.terminate()
    }

    func testProjectTaskOrderPreservesHiddenRowsAndRelaunches() {
        projectTaskOrderFlow(library: "ead8d6f2-f4c3-4cef-abdc-56e6ec2fb5a5")
    }

    func testProjectTaskOrderLargestText() {
        projectTaskOrderFlow(library: "6a3cfb27-3fb6-4f24-b32c-af97cd9e1d61")
    }

    private func projectTaskOrderFlow(library: String) {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", library]
        app.launch(); openProjectTaskSortTest(app)
        projectFilterTap(app, "project-task-view-options-button")
        projectFilterTap(app, "project-view-filters-option")
        let search = app.textFields["project-filter-search"]
        boardEnabled(search); search.tap(); search.typeText("Order action\n")
        projectFilterTap(app, "project-filters-close")
        projectSortTap(app, "project-task-view-options-button")
        projectSortTap(app, "project-view-order-option")
        let list = app.tables["project-task-order-list"]
        XCTAssertTrue(list.waitForExistence(timeout: 15))
        let aID = "acc031d9-9cac-4296-8420-840bcd17a562"
        let cID = "a007e3b4-2789-43b0-8e79-86617f91c5c5"
        func row(_ id: String) -> XCUIElement {
            app.descendants(matching: .any).matching(identifier: "project-task-order-row-" + id).firstMatch
        }
        let a = row(aID); let c = row(cID)
        XCTAssertTrue(a.waitForExistence(timeout: 15)); XCTAssertTrue(c.exists)
        XCTAssertFalse(row("d55f6859-cf8e-4643-a1ad-eff6db59262e").exists)
        XCTAssertFalse(row("8da3e93c-4ddc-4092-9713-54ba386b6873").exists)
        let done = app.buttons["project-task-order-done"]
        boardEnabled(done)
        func drag(_ source: XCUIElement, below destination: XCUIElement) {
            let start = app.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: list.frame.maxX - 22, dy: source.frame.midY))
            let end = app.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: list.frame.maxX - 22, dy: min(list.frame.maxY - 8, destination.elementType == .staticText
                    ? destination.frame.maxY + source.frame.height / 2 : destination.frame.minY + 8)))
            start.press(forDuration: 0.8, thenDragTo: end)
            boardEnabled(done)
        }
        XCTAssertLessThan(a.frame.minY, c.frame.minY)
        drag(a, below: c)
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in a.frame.minY > c.frame.minY }, object: nil)], timeout: 10), .completed)
        let empty = app.staticTexts["project-task-order-section-order-empty-section"]
        XCTAssertTrue(empty.exists)
        XCTAssertLessThan(a.frame.maxY, empty.frame.minY)
        drag(a, below: empty)
        XCTAssertGreaterThan(a.frame.minY, empty.frame.minY)
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "Project task order after filtered cross-section move"; shot.lifetime = .keepAlways; add(shot)
        done.tap(); boardEnabled(app.buttons["project-task-view-options-button"])
        app.terminate(); app.launch(); openProjectTaskSortTest(app)
        projectSortTap(app, "project-task-view-options-button")
        projectSortTap(app, "project-view-order-option")
        boardEnabled(done)
        XCTAssertTrue(row("d55f6859-cf8e-4643-a1ad-eff6db59262e").exists)
        XCTAssertGreaterThan(a.frame.minY, empty.frame.minY)
        done.tap(); boardTap(app, "project-back")
        app.terminate()
    }

    func testProjectDetailsExpansionWithTaskOrder() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", "ead8d6f2-f4c3-4cef-abdc-56e6ec2fb5a5"]
        app.launch(); openProjectTaskSortTest(app)
        for _ in 0..<2 {
            projectSortTap(app, "project-details-toggle")
            XCTAssertTrue(app.buttons["project-status-open"].waitForExistence(timeout: 10))
            projectSortTap(app, "project-details-toggle")
            XCTAssertFalse(app.buttons["project-status-open"].exists)
        }
        app.terminate()
    }

    func testProjectTaskOrderFailureRetainsExactMove() { projectTaskOrderRecovery(failed: true) }
    func testProjectTaskOrderColdRecovery() { projectTaskOrderRecovery(failed: false) }

    private func projectTaskOrderRecovery(failed: Bool) {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", "8e2a95e9-6e94-4050-b346-e9e61b8a37b0"]
        app.launch(); openProjectTaskSortTest(app, recovered: !failed)
        projectSortTap(app, "project-task-view-options-button")
        projectSortTap(app, "project-view-order-option")
        let list = app.tables["project-task-order-list"]
        XCTAssertTrue(list.waitForExistence(timeout: 15))
        let a = app.descendants(matching: .any).matching(identifier:
            "project-task-order-row-acc031d9-9cac-4296-8420-840bcd17a562").firstMatch
        let c = app.descendants(matching: .any).matching(identifier:
            "project-task-order-row-a007e3b4-2789-43b0-8e79-86617f91c5c5").firstMatch
        XCTAssertTrue(a.waitForExistence(timeout: 15)); XCTAssertTrue(c.exists)
        let done = app.buttons["project-task-order-done"]
        if failed {
            boardEnabled(done)
            let start = app.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: list.frame.maxX - 22, dy: a.frame.midY))
            let end = app.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: list.frame.maxX - 22, dy: c.frame.minY + 8))
            start.press(forDuration: 0.8, thenDragTo: end)
            XCTAssertTrue(app.staticTexts["project-task-order-error"].waitForExistence(timeout: 15))
            for _ in 0..<2 {
                XCTAssertFalse(done.isEnabled)
                projectSortTap(app, "project-task-order-retry")
                boardEnabled(app.buttons["project-task-order-retry"])
            }
        } else {
            boardEnabled(done)
            XCTAssertGreaterThan(a.frame.minY, c.frame.minY)
            done.tap()
        }
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = failed ? "Project task order exact retry" : "Project task order cold recovery"
        shot.lifetime = .keepAlways; add(shot)
        app.terminate()
    }

    func testProjectTaskSortAndNotes() { projectTaskSortFlow(library: "13d4bc99-20dd-49b5-a395-835b78de7ebb") }
    func testProjectTaskSortLargestText() { projectTaskSortFlow(library: "43017675-b987-4402-b220-f097fea28b70") }

    private func openProjectTaskSortTest(_ app: XCUIApplication, recovered: Bool = false) {
        if recovered { boardEnabled(app.textFields["projects-create-title"], timeout: 30) }
        else { boardEnabled(app.buttons["tab-menu"], timeout: 30); boardTap(app, "tab-menu"); boardTap(app, "menu-projects") }
        let row = app.buttons["project-open-b6b325b0-c0d7-411d-9114-f5b816ec6286"]
        revealPagedElement(app, row, in: app.scrollViews["projects-scroll"])
        row.tap(); boardEnabled(app.buttons["project-details-toggle"])
    }

    private func projectSortTap(_ app: XCUIApplication, _ id: String) {
        let button = app.buttons[id]
        if id.hasPrefix("project-sort-option-") {
            revealPagedElement(app, button, in: app.scrollViews["project-sort-scroll"])
        } else if id == "project-completed-toggle" {
            revealPagedElement(app, button, in: app.scrollViews["project-detail-scroll"], outerEdge: true)
        }
        boardEnabled(button); XCTAssertGreaterThanOrEqual(button.frame.height, 44 - 0.001)
        button.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: button.frame.width - 4, dy: 4)).tap()
    }

    private func projectTaskSortFlow(library: String) {
        let app = XCUIApplication(); app.launchArguments = ["--native-ui-test-library", library]; app.launch()
        openProjectTaskSortTest(app)
        func tap(_ id: String) { projectSortTap(app, id) }
        func sort(_ selected: String, choose: String? = nil) {
            tap("project-task-view-options-button"); tap("project-view-sort-option")
            let current = app.buttons["project-sort-option-" + selected]
            XCTAssertTrue(current.waitForExistence(timeout: 10)); XCTAssertTrue(current.isSelected)
            tap(choose.map { "project-sort-option-" + $0 } ?? "project-sort-close")
            boardEnabled(app.buttons["project-task-view-options-button"])
        }
        func first(_ title: String) {
            let expected = app.buttons["task-title-" + title]
            revealPagedElement(app, expected, in: app.scrollViews["project-detail-scroll"])
            boardEnabled(expected)
            let visible = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "task-title-"))
                .allElementsBoundByIndex.filter { $0.exists && $0.frame.minY >= app.scrollViews["project-detail-scroll"].frame.minY }
            XCTAssertEqual(visible.first?.identifier, "task-title-" + title)
        }
        sort("default")
        projectManagerTap(app, "project-details-toggle"); projectManagerTap(app, "project-notes-toggle")
        let input = app.textViews["project-notes-input"]
        revealPagedElement(app, input, in: app.scrollViews["project-detail-scroll"], outerEdge: true)
        boardEnabled(input); replaceProjectNotesText(input, with: "Saved before task sort\n")
        sort("default", choose: "title")
        XCTAssertEqual(input.value as? String, "Saved before task sort\n")
        boardTap(app, "project-back")
        let reopened = app.buttons["project-open-b6b325b0-c0d7-411d-9114-f5b816ec6286"]
        revealPagedElement(app, reopened, in: app.scrollViews["projects-scroll"])
        reopened.tap(); boardEnabled(app.buttons["project-details-toggle"])
        first("d55f6859-cf8e-4643-a1ad-eff6db59262e")
        sort("title", choose: "title") // Same choice must not add a revision.
        tap("project-task-view-options-button"); tap("project-view-completed-option")
        boardEnabled(app.buttons["project-completed-toggle"])
        tap("project-completed-toggle")
        XCTAssertEqual(app.buttons["project-completed-toggle"].value as? String, "Collapse")
        for (choice, firstID) in [("due", "a007e3b4-2789-43b0-8e79-86617f91c5c5"), ("start", "d55f6859-cf8e-4643-a1ad-eff6db59262e"), ("review", "acc031d9-9cac-4296-8420-840bcd17a562"),
                                  ("timeEstimate", "d55f6859-cf8e-4643-a1ad-eff6db59262e"), ("created", "acc031d9-9cac-4296-8420-840bcd17a562"),
                                  ("created-desc", "a007e3b4-2789-43b0-8e79-86617f91c5c5"), ("default", "acc031d9-9cac-4296-8420-840bcd17a562")] {
            tap("project-task-view-options-button"); tap("project-view-sort-option")
            tap("project-sort-option-" + choice)
            boardEnabled(app.buttons["project-task-view-options-button"])
            XCTAssertEqual(app.buttons["project-completed-toggle"].value as? String, "Collapse")
            first(firstID)
        }
        sort("default", choose: "title")
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Project task Sort retains completed view"
        shot.lifetime = .keepAlways; add(shot)
        sort("title")
        app.terminate(); app.launch(); openProjectTaskSortTest(app)
        sort("title"); first("d55f6859-cf8e-4643-a1ad-eff6db59262e")
        XCTAssertEqual(app.buttons["project-completed-toggle"].value as? String, "Expand")
        boardTap(app, "project-back")
        let archived = app.buttons["project-open-35361330-8e78-4a4c-8197-aaca63070b98"]
        let closed = app.buttons["projects-section-archived"]
        revealPagedElement(app, closed, in: app.scrollViews["projects-scroll"])
        if closed.value as? String == "Expand" { closed.tap() }
        revealPagedElement(app, archived, in: app.scrollViews["projects-scroll"])
        archived.tap(); tap("project-task-view-options-button")
        XCTAssertFalse(app.buttons["project-view-sort-option"].isEnabled)
        XCTAssertFalse(app.buttons["project-view-completed-option"].exists)
        tap("project-view-options-close"); app.terminate()
    }

    func testProjectTaskSortFailureRetainsChoice() { projectTaskSortRecovery(failed: true) }
    func testProjectTaskSortColdRecovery() { projectTaskSortRecovery(failed: false) }
    private func projectTaskSortRecovery(failed: Bool) {
        let app = XCUIApplication(); app.launchArguments = ["--native-ui-test-library", "962b774b-b259-45cd-839a-66bd22371154"]
        app.launch(); openProjectTaskSortTest(app, recovered: !failed)
        projectSortTap(app, "project-task-view-options-button"); projectSortTap(app, "project-view-sort-option")
        if failed {
            projectSortTap(app, "project-sort-option-title")
            XCTAssertTrue(app.staticTexts["project-sort-error"].waitForExistence(timeout: 15))
            for _ in 0..<2 {
                XCTAssertFalse(app.buttons["project-sort-close"].isEnabled)
                XCTAssertTrue(app.buttons["project-sort-option-default"].isSelected)
                XCTAssertFalse(app.buttons["project-sort-option-due"].isEnabled)
                projectSortTap(app, "project-sort-retry"); boardEnabled(app.buttons["project-sort-retry"])
            }
        } else {
            XCTAssertTrue(app.buttons["project-sort-option-title"].isSelected)
            projectSortTap(app, "project-sort-close")
        }
        app.terminate()
    }

    func testProjectTaskSortHiddenLegacyEstimateClearsDefault() {
        let app = XCUIApplication(); app.launchArguments = ["--native-ui-test-library", "3a9f2190-c9e8-4fd4-9390-2ba2a7a41fce"]
        app.launch(); openProjectTaskSortTest(app)
        projectSortTap(app, "project-task-view-options-button"); projectSortTap(app, "project-view-sort-option")
        XCTAssertFalse(app.buttons["project-sort-option-timeEstimate"].exists)
        XCTAssertTrue(app.buttons["project-sort-option-default"].isSelected)
        projectSortTap(app, "project-sort-option-default")
        boardEnabled(app.buttons["project-task-view-options-button"])
        app.terminate(); app.launch(); openProjectTaskSortTest(app)
        projectSortTap(app, "project-task-view-options-button"); projectSortTap(app, "project-view-sort-option")
        XCTAssertTrue(app.buttons["project-sort-option-default"].isSelected)
        projectSortTap(app, "project-sort-close"); app.terminate()
    }

    func testProjectCompletedViewFlushesNotesAndResetsAfterTypeChange() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", "36654896-3803-4740-a74b-87899cdb5dd8"]
        app.launch()
        func open() {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
            let row = app.buttons["project-open-8fd27048-fa48-432a-9b21-c2f210be3f88"]
            revealPagedElement(app, row, in: app.scrollViews["projects-scroll"])
            row.tap(); boardEnabled(app.buttons["project-details-toggle"])
        }
        func tap(_ id: String) {
            if ["project-task-view-options-button", "project-view-completed-option", "project-view-options-close"].contains(id) {
                boardTap(app, id)
            } else { projectManagerTap(app, id) }
        }
        open(); tap("project-details-toggle"); tap("project-notes-toggle")
        let input = app.textViews["project-notes-input"]
        revealPagedElement(app, input, in: app.scrollViews["project-detail-scroll"], outerEdge: true)
        boardEnabled(input); replaceProjectNotesText(input, with: "Saved before completed view\n")
        tap("project-task-view-options-button")
        boardEnabled(app.buttons["project-view-completed-option"])
        tap("project-view-completed-option")
        XCTAssertEqual(input.value as? String, "Saved before completed view\n")
        tap("project-notes-toggle"); tap("project-completed-toggle")
        XCTAssertEqual(app.buttons["project-completed-toggle"].value as? String, "Collapse")
        tap("project-flow-type")
        let sequential = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "Sequential"),
            object: app.staticTexts["project-detail-meta-type"])
        XCTAssertEqual(XCTWaiter.wait(for: [sequential], timeout: 15), .completed)
        XCTAssertFalse(app.buttons["project-completed-toggle"].exists)
        tap("project-flow-type")
        let parallel = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "Parallel"),
            object: app.staticTexts["project-detail-meta-type"])
        XCTAssertEqual(XCTWaiter.wait(for: [parallel], timeout: 15), .completed)
        XCTAssertEqual(app.buttons["project-completed-toggle"].value as? String, "Expand")
        app.terminate(); app.launch(); open(); tap("project-details-toggle"); tap("project-notes-toggle")
        XCTAssertEqual(input.value as? String, "Saved before completed view\n")
        XCTAssertEqual(app.buttons["project-completed-toggle"].value as? String, "Expand")
        app.terminate()
    }

    func testProjectCompletedViewPersistsAndCollapsesLikeRN() {
        projectCompletedView(library: "0777753b-1f9b-4923-9d3d-4b8504d77161")
    }

    func testProjectCompletedViewLargestText() {
        projectCompletedView(library: "335af245-0318-4746-8e95-780fa9bb0334")
    }

    private func projectCompletedView(library: String) {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", library]
        app.launch()
        func projects() {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
        }
        func open(_ id: String) {
            let row = app.buttons["project-open-" + id]
            revealPagedElement(app, row, in: app.scrollViews["projects-scroll"])
            row.tap(); boardEnabled(app.buttons["project-details-toggle"])
        }
        func tap(_ id: String) {
            let button = app.buttons[id]
            if id == "project-completed-toggle" {
                revealPagedElement(app, button, in: app.scrollViews["project-detail-scroll"])
            }
            boardEnabled(button)
            XCTAssertGreaterThanOrEqual(button.frame.height, 44 - 0.001)
            button.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: button.frame.width - 4, dy: 4)).tap()
        }
        func option(_ selected: Bool) {
            tap("project-task-view-options-button")
            boardEnabled(app.buttons["project-view-completed-option"])
            XCTAssertEqual(app.buttons["project-view-completed-option"].isSelected, selected)
        }
        projects()
        let draft = app.textFields["projects-create-title"]
        boardEnabled(draft); draft.tap(); draft.typeText("Retained completed view draft")
        projectManagerTap(app, "projects-create-area-af884128-31d5-41eb-978c-2fd1a44b62e8")
        open("8fd27048-fa48-432a-9b21-c2f210be3f88")
        XCTAssertFalse(app.buttons["project-completed-toggle"].exists)
        XCTAssertFalse(app.buttons["task-title-bf985bef-aab5-4a64-8ccb-72695daa4f0f"].exists)
        option(false); tap("project-view-completed-option")
        boardEnabled(app.buttons["project-completed-toggle"])
        XCTAssertEqual(app.buttons["project-completed-toggle"].value as? String, "Expand")
        XCTAssertFalse(app.buttons["task-title-bf985bef-aab5-4a64-8ccb-72695daa4f0f"].exists)
        tap("project-completed-toggle")
        let done = app.buttons["task-title-bf985bef-aab5-4a64-8ccb-72695daa4f0f"]
        revealPagedElement(app, done, in: app.scrollViews["project-detail-scroll"])
        boardEnabled(done); done.tap(); boardTap(app, "task-view-close")
        XCTAssertEqual(app.buttons["project-completed-toggle"].value as? String, "Collapse")
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Project completed group and RN task-view control"
        shot.lifetime = .keepAlways; add(shot)
        option(true); tap("project-view-completed-option")
        XCTAssertFalse(app.buttons["project-completed-toggle"].exists)
        option(false); tap("project-view-completed-option")
        XCTAssertEqual(app.buttons["project-completed-toggle"].value as? String, "Expand")
        boardTap(app, "project-back")
        XCTAssertEqual(draft.value as? String, "Retained completed view draft")
        XCTAssertTrue(app.buttons["projects-create-area-af884128-31d5-41eb-978c-2fd1a44b62e8"].isSelected)
        boardTap(app, "search-open"); boardEnabled(app.textFields["search-input"]); boardTap(app, "search-close")
        XCTAssertEqual(draft.value as? String, "Retained completed view draft")
        open("8fd27048-fa48-432a-9b21-c2f210be3f88")
        XCTAssertEqual(app.buttons["project-completed-toggle"].value as? String, "Expand")
        boardTap(app, "project-back")
        open("7b208aac-9534-4433-b301-ffbd036a6c66")
        XCTAssertFalse(app.buttons["project-completed-toggle"].exists)
        let inline = app.buttons["task-title-774d586d-7ea6-46de-930a-e8ecfd33a34c"]
        revealPagedElement(app, inline, in: app.scrollViews["project-detail-scroll"])
        XCTAssertTrue(inline.exists)
        option(true); tap("project-view-options-close"); boardTap(app, "project-back")
        let closed = app.buttons["projects-section-archived"]
        revealPagedElement(app, closed, in: app.scrollViews["projects-scroll"])
        if closed.value as? String == "Expand" { closed.tap() }
        open("89b11efe-3801-4a20-9ff5-dc096795a045")
        tap("project-task-view-options-button")
        XCTAssertFalse(app.buttons["project-view-completed-option"].exists)
        XCTAssertFalse(app.buttons["project-view-sort-option"].isEnabled)
        tap("project-view-options-close")
        let archived = app.buttons["task-title-df02dc4c-dc78-4dda-b53f-dd1f8f147bbf"]
        revealPagedElement(app, archived, in: app.scrollViews["project-detail-scroll"])
        XCTAssertTrue(archived.exists)
        XCTAssertFalse(app.buttons["task-status-df02dc4c-dc78-4dda-b53f-dd1f8f147bbf"].isEnabled)
        app.terminate(); app.launch(); projects(); open("8fd27048-fa48-432a-9b21-c2f210be3f88")
        option(true); tap("project-view-options-close")
        XCTAssertEqual(app.buttons["project-completed-toggle"].value as? String, "Expand")
        XCTAssertFalse(app.buttons["task-title-bf985bef-aab5-4a64-8ccb-72695daa4f0f"].exists)
        app.terminate()
    }

    func testProjectCompletedReadFailureRetainsSelectionAndRetries() {
        projectCompletedFailure(library: "69a072e4-f8b9-4189-b5ef-3a511c4d6b35", cold: false)
    }

    func testProjectCompletedReadFailureDoesNotPersist() {
        projectCompletedFailure(library: "4122fa71-f1aa-4d1b-b3bb-9adca10f4689", cold: true)
    }

    private func projectCompletedFailure(library: String, cold: Bool) {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", library, "--native-project-view-read-failure"]
        app.launch()
        func open() {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
            let row = app.buttons["project-open-8fd27048-fa48-432a-9b21-c2f210be3f88"]
            revealPagedElement(app, row, in: app.scrollViews["projects-scroll"])
            row.tap(); boardEnabled(app.buttons["project-task-view-options-button"])
        }
        open()
        boardTap(app, "project-task-view-options-button")
        XCTAssertFalse(app.buttons["project-view-completed-option"].isSelected)
        boardTap(app, "project-view-completed-option")
        XCTAssertTrue(app.staticTexts["project-error"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["project-task-view-options-button"].isSelected)
        XCTAssertFalse(app.buttons["project-task-view-options-button"].isEnabled)
        XCTAssertFalse(app.buttons["project-completed-toggle"].exists)
        XCTAssertTrue(app.buttons["task-title-b05710fd-01cc-4a41-af99-dd47a51bb1db"].exists)
        if cold {
            app.terminate(); app.launchArguments = ["--native-ui-test-library", library]; app.launch(); open()
            boardTap(app, "project-task-view-options-button")
            XCTAssertFalse(app.buttons["project-view-completed-option"].isSelected)
            boardTap(app, "project-view-options-close")
        } else {
            let retry = app.buttons["project-retry"]
            revealPagedElement(app, retry, in: app.scrollViews["project-detail-scroll"])
            boardEnabled(retry); XCTAssertGreaterThanOrEqual(retry.frame.height, 44 - 0.001)
            retry.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: retry.frame.width - 4, dy: 4)).tap()
            boardEnabled(app.buttons["project-task-view-options-button"])
            XCTAssertTrue(app.buttons["project-task-view-options-button"].isSelected)
            XCTAssertEqual(app.buttons["project-completed-toggle"].value as? String, "Expand")
        }
        app.terminate()
    }

    func testProjectTagFiltersPreserveDraftsAndNavigation() {
        projectTagFilters(library: "47c10eb8-9f1c-4971-b288-5fdf4e6fd3c9")
    }

    func testProjectTagFiltersLargestText() {
        projectTagFilters(library: "61471a3f-a953-4cac-b343-31e89f56a841")
    }


    func testProjectTagFilterReadFailureRetainsViewAndRetriesIntendedSelection() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", "17df0f4e-5eb2-42fe-8c94-5776070fc071",
                               "--native-project-tag-read-failure"]
        app.launch()
        boardEnabled(app.buttons["tab-menu"], timeout: 30)
        boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
        let draft = app.textFields["projects-create-title"]
        boardEnabled(draft); draft.tap(); draft.typeText("Retained failed filter draft")
        projectManagerTap(app, "projects-create-area-af884128-31d5-41eb-978c-2fd1a44b62e8")
        projectManagerTap(app, "projects-tag-filter-toggle")
        projectManagerTap(app, "projects-tag-filter-4")
        XCTAssertTrue(app.staticTexts["projects-create-read-error"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["projects-tag-filter-all"].isSelected)
        XCTAssertFalse(app.buttons["projects-tag-filter-4"].isSelected)
        XCTAssertFalse(app.buttons["projects-tag-filter-4"].isEnabled)
        XCTAssertEqual(draft.value as? String, "Retained failed filter draft")
        XCTAssertTrue(app.buttons["projects-create-area-af884128-31d5-41eb-978c-2fd1a44b62e8"].isSelected)
        let previous = app.buttons["project-open-53b2bd73-6240-4998-b0fc-4f3af333dc01"]
        revealPagedElement(app, previous, in: app.scrollViews["projects-scroll"])
        XCTAssertTrue(previous.exists)
        projectManagerTap(app, "projects-create-read-retry")
        boardEnabled(app.buttons["projects-tag-filter-4"])
        XCTAssertTrue(app.buttons["projects-tag-filter-4"].isSelected)
        XCTAssertFalse(app.buttons["projects-tag-filter-all"].isSelected)
        XCTAssertFalse(app.staticTexts["projects-create-read-error"].exists)
        XCTAssertFalse(previous.exists)
        XCTAssertEqual(draft.value as? String, "Retained failed filter draft")
        XCTAssertTrue(app.buttons["projects-create-area-af884128-31d5-41eb-978c-2fd1a44b62e8"].isSelected)
        app.terminate()
    }

    private func projectTagFilters(library: String) {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", library]; app.launch()
        let target = "776dd5c5-1926-4da1-96ff-5d5096971050"
        let destination = "53b2bd73-6240-4998-b0fc-4f3af333dc01"
        let source = "170c1eab-65ec-4a38-931d-3f03399b7d17"
        let home = "af884128-31d5-41eb-978c-2fd1a44b62e8"
        let draft = app.textFields["projects-create-title"]
        let toggle = "projects-tag-filter-toggle"
        func tap(_ id: String) { projectManagerTap(app, id) }
        func selected(_ id: String) {
            boardEnabled(app.buttons[id])
            expectation(for: NSPredicate(format: "selected == true"), evaluatedWith: app.buttons[id])
            waitForExpectations(timeout: 15)
        }
        func choose(_ id: String) { tap(id); selected(id) }
        func row(_ id: String) -> XCUIElement {
            let value = app.buttons["project-open-" + id]
            revealPagedElement(app, value, in: app.scrollViews["projects-scroll"])
            boardEnabled(value)
            return value
        }
        func section(_ name: String) {
            let button = app.buttons["projects-section-" + name]
            revealPagedElement(app, button, in: app.scrollViews["projects-scroll"])
            boardEnabled(button)
            if button.value as? String == "Expand" { button.tap() }
        }
        func area(_ id: String) {
            boardTap(app, "area-open"); boardTap(app, "area-option-" + id)
            selected("area-option-" + id)
            app.buttons["area-dismiss"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
            expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.staticTexts["area-title"])
            waitForExpectations(timeout: 10)
        }
        boardEnabled(app.buttons["tab-menu"], timeout: 30)
        boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
        boardEnabled(draft)
        XCTAssertFalse(app.buttons["projects-tag-filter-all"].exists)
        draft.tap(); draft.typeText("Retained tag filter Project draft")
        choose("projects-create-area-" + home)
        tap(toggle); selected("projects-tag-filter-all")
        choose("projects-tag-filter-4") // #work, inventory sorted by shared JS policy.
        XCTAssertFalse(app.keyboards.firstMatch.exists)
        XCTAssertEqual(draft.value as? String, "Retained tag filter Project draft")
        XCTAssertTrue(app.buttons["projects-create-area-" + home].isSelected)
        _ = row(target)
        XCTAssertFalse(app.buttons["project-open-" + destination].exists)
        section("deferred"); _ = row("603a295c-f5cf-4704-8b31-ae73c7f31bea")
        section("archived"); _ = row("98432619-81dd-480e-9c35-d4dfa1705ff1")
        tap(toggle)
        XCTAssertFalse(app.buttons["projects-tag-filter-all"].exists)
        XCTAssertTrue(app.buttons[toggle].label.contains("#work"))
        tap(toggle); selected("projects-tag-filter-4")

        choose("projects-tag-filter-2") // composed Unicode
        _ = row(target)
        XCTAssertFalse(app.buttons["project-open-" + destination].exists)
        choose("projects-tag-filter-1") // canonically equivalent, distinct raw tag
        _ = row(destination)
        XCTAssertFalse(app.buttons["project-open-" + target].exists)
        choose("projects-tag-filter-none")
        _ = row("120596fd-e02e-4187-8403-c70bcd0fb35a")
        XCTAssertEqual(app.buttons["projects-tag-filter-0"].label, "Empty tag")
        choose("projects-tag-filter-0") // existing empty raw tag is not No tags.
        _ = row("60b46b37-77c2-40c0-b3ce-17faf3217f1e")
        XCTAssertFalse(app.buttons["project-open-120596fd-e02e-4187-8403-c70bcd0fb35a"].exists)
        choose("projects-tag-filter-4")
        area(source)
        selected("projects-tag-filter-4")
        XCTAssertTrue(app.buttons["projects-tag-filter-3"].exists) // global #home inventory survives Area filtering.
        choose("projects-tag-filter-3")
        XCTAssertTrue(app.staticTexts["projects-empty"].waitForExistence(timeout: 10))
        choose("projects-tag-filter-4"); _ = row(target)
        area("__all__")
        selected("projects-tag-filter-4")
        choose("projects-create-area-" + home)
        row(target).tap(); boardTap(app, "project-details-toggle")
        tap("project-area-open"); tap("project-area-manage")
        boardEnabled(app.textFields["area-create-name"])
        tap("area-manager-close"); boardTap(app, "project-back")
        selected("projects-tag-filter-4")
        XCTAssertEqual(draft.value as? String, "Retained tag filter Project draft")
        XCTAssertTrue(app.buttons["projects-create-area-" + home].isSelected)
        boardTap(app, "search-open"); boardEnabled(app.textFields["search-input"])
        boardTap(app, "search-close"); selected("projects-tag-filter-4")
        XCTAssertEqual(draft.value as? String, "Retained tag filter Project draft")
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "Project tag filter retains raw selection and creation draft"
        capture.lifetime = .keepAlways; add(capture)
        app.terminate(); app.launch()
        boardEnabled(app.buttons["tab-menu"], timeout: 30)
        boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
        boardEnabled(draft)
        XCTAssertFalse(app.buttons["projects-tag-filter-all"].exists)
        tap(toggle); selected("projects-tag-filter-all")
        _ = row(target); _ = row(destination)
        app.terminate()
    }

    func testProjectManageAreaRenameFailure() { projectManagerRecovery(phase: "rename", failed: true) }
    func testProjectManageAreaRenameColdRecovery() { projectManagerRecovery(phase: "rename", failed: false) }
    func testProjectManageAreaCreateFailure() { projectManagerRecovery(phase: "create", failed: true) }
    func testProjectManageAreaCreateColdRecovery() { projectManagerRecovery(phase: "create", failed: false) }
    func testProjectManageAreaAssignmentFailure() { projectManagerRecovery(phase: "assignment", failed: true) }
    func testProjectManageAreaAssignmentColdRecovery() { projectManagerRecovery(phase: "assignment", failed: false) }

    func testProjectManageCreatedAreaCanCloseAfterReadFailure() {
        projectManagerCreatedAreaCorrection(blocked: false)
    }

    func testProjectManageBlockedAssignmentRetainsCreatedAreaForExplicitChoice() {
        projectManagerCreatedAreaCorrection(blocked: true)
    }

    private func projectManagerCreatedAreaCorrection(blocked: Bool) {
        let library = blocked ? "6960ec5e-6fd7-4585-a0bf-545cf572e71f" : "18fd02e5-6f4c-45dd-8730-e464416028ca"
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", library,
            blocked ? "--native-project-area-blocked-write" : "--native-project-area-read-failure"]
        app.launch()
        openProjectAreaManager(app)
        let name = app.textFields["area-create-name"]
        revealAreaRenameControl(app, name); boardEnabled(name)
        replaceTextView(name, with: "  Unassigned Managed Area  ")
        projectManagerTap(app, "area-create-save")
        XCTAssertTrue(app.staticTexts["project-area-created-status"].waitForExistence(timeout: 15))
        boardEnabled(app.buttons["area-manager-close"])
        XCTAssertFalse(name.isEnabled)
        XCTAssertFalse(app.buttons["area-create-save"].isEnabled)
        if blocked {
            projectManagerTap(app, "project-area-read-retry")
            boardEnabled(app.buttons["project-area-close"])
            XCTAssertFalse(app.buttons["area-manager-close"].exists)
            XCTAssertTrue(app.staticTexts["project-area-created-status"].exists)
            let createdChoice = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label == %@",
                "project-area-choice-", "Unassigned Managed Area"))
            XCTAssertEqual(createdChoice.count, 1)
            XCTAssertFalse(createdChoice.firstMatch.isSelected)
            XCTAssertTrue(app.buttons["project-area-choice-170c1eab-65ec-4a38-931d-3f03399b7d17"].isSelected)
            // Refresh offers the durable Area without silently changing the Project.
            boardTap(app, "project-area-close")
        } else {
            XCTAssertTrue(app.staticTexts["project-area-read-error"].exists)
            projectManagerTap(app, "area-manager-close")
        }
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.buttons["area-manager-close"])
        waitForExpectations(timeout: 15)
        boardTap(app, "project-back")
        boardEnabled(app.buttons["projects-manage-areas"])
        app.terminate()
        app.launchArguments = ["--native-ui-test-library", library]; app.launch()
        boardEnabled(app.buttons["tab-menu"], timeout: 30)
        boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
        boardTap(app, "projects-manage-areas")
        let created = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@",
            "area-rename-open-", "Unassigned Managed Area"))
        XCTAssertEqual(created.count, 1)
        boardTap(app, "area-manager-close"); app.terminate()
    }

    private func projectManagerRecovery(phase: String, failed: Bool) {
        let libraries = ["rename": "1ea636a9-a4db-4fbe-bc53-792602d89d25",
                         "create": "ae81cf6a-fb14-48b7-8966-77a7ebbfff6e",
                         "assignment": "e88e8d77-780c-4151-a148-ec4c68e82305"]
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", libraries[phase]!]; app.launch()
        let source = "170c1eab-65ec-4a38-931d-3f03399b7d17"
        let rawName = phase == "rename" ? "  HOME  " : "  Recover Managed Area  "
        func tap(_ id: String) { projectManagerTap(app, id) }
        openProjectAreaManager(app, recovering: !failed)
        if failed {
            if phase == "rename" { tap("area-rename-open-" + source) }
            let name = app.textFields[phase == "rename" ? "area-rename-name" : "area-create-name"]
            revealAreaRenameControl(app, name); boardEnabled(name)
            replaceTextView(name, with: rawName)
            tap(phase == "rename" ? "area-rename-save" : "area-create-save")
            let prefix = phase == "assignment" ? "project-area" : "area-" + phase
            let error = app.staticTexts[prefix + "-error"]
            XCTAssertTrue(error.waitForExistence(timeout: 15))
            for _ in 0..<2 {
                XCTAssertFalse(app.buttons["area-manager-close"].isEnabled)
                XCTAssertFalse(app.buttons["area-create-save"].isEnabled)
                XCTAssertFalse(app.textFields["area-create-name"].isEnabled)
                if phase != "assignment" { XCTAssertEqual(name.value as? String, rawName) }
                tap(prefix + "-retry"); boardEnabled(app.buttons[prefix + "-retry"])
                XCTAssertTrue(error.exists)
            }
            let capture = XCTAttachment(screenshot: app.screenshot())
            capture.name = "Project manager exact " + phase + " retry"
            capture.lifetime = .keepAlways; add(capture)
        } else {
            tap("area-manager-close")
            expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.buttons["area-manager-close"])
            waitForExpectations(timeout: 15)
            XCTAssertEqual(app.staticTexts["project-detail-meta-area"].label,
                phase == "rename" ? "HOME" : phase == "assignment" ? "Recover Managed Area" : "Rename Source")
            tap("project-area-open")
            if phase != "rename" {
                let created = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label == %@",
                    "project-area-choice-", "Recover Managed Area"))
                XCTAssertEqual(created.count, 1)
                XCTAssertEqual(created.firstMatch.isSelected, phase == "assignment")
            }
            tap("project-area-close")
        }
        app.terminate()
    }

    func testAreaRenameMergeAndDrafts() {
        areaRenameFlow(library: "a5fce02c-72ca-4ff9-8380-efbcb868d496")
    }

    func testAreaRenameMergeLargestText() {
        areaRenameFlow(library: "73a80a74-f4c2-4a93-b9c0-a28e934a688b")
    }

    private func areaRenameFlow(library: String) {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", library]
        app.launch()
        let source = "170c1eab-65ec-4a38-931d-3f03399b7d17"
        let destination = "af884128-31d5-41eb-978c-2fd1a44b62e8"
        let input = app.textFields["area-rename-name"]
        let create = app.textFields["area-create-name"]
        let project = app.textFields["projects-create-title"]
        func openProjects() {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
            boardEnabled(project)
        }
        func tap(_ id: String) {
            let button = app.buttons[id]
            revealAreaRenameControl(app, button); boardEnabled(button)
            if id.hasPrefix("area-rename-") {
                // The native medium sheet scales its 48pt layout; check the screen-space hit region.
                XCTAssertGreaterThanOrEqual(button.frame.height, 44)
                XCTAssertGreaterThanOrEqual(button.frame.width, 44)
            }
            button.tap()
        }
        func rename(_ value: String, cancel: Bool = false) {
            tap("area-rename-open-" + source)
            boardEnabled(input); revealAreaRenameControl(app, input)
            replaceTextView(input, with: value)
            if cancel {
                let decomposed = value.decomposedStringWithCanonicalMapping
                replaceTextView(input, with: decomposed)
                XCTAssertEqual(Array((input.value as? String ?? "").utf8), Array(decomposed.utf8))
            }
            tap(cancel ? "area-rename-cancel" : "area-rename-save")
            expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: input)
            waitForExpectations(timeout: 15)
            XCTAssertFalse(app.staticTexts["area-rename-error"].exists)
            XCTAssertEqual(create.value as? String, "Retained Area draft")
        }
        openProjects()
        project.tap(); project.typeText("Retained Project draft")
        boardTap(app, "projects-manage-areas")
        boardEnabled(create); revealAreaRenameControl(app, create)
        create.tap(); create.typeText("Retained Area draft")
        rename("Cancelled Caf\u{e9}", cancel: true)
        rename("  Renamed Source  ")
        XCTAssertTrue(app.buttons["area-rename-open-" + source].label.contains("Renamed Source"))
        rename("  Renamed Source  ")
        rename("  HOME  ")
        XCTAssertFalse(app.buttons["area-rename-open-" + source].exists)
        let survivor = app.buttons["area-rename-open-" + destination]
        revealAreaRenameControl(app, survivor); boardEnabled(survivor)
        XCTAssertTrue(survivor.label.contains("HOME"))
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "Area merge preserves destination and Area draft"
        capture.lifetime = .keepAlways; add(capture)
        boardTap(app, "area-manager-close")
        XCTAssertEqual(project.value as? String, "Retained Project draft")
        app.terminate(); app.launch(); openProjects()
        boardTap(app, "projects-manage-areas"); boardEnabled(create)
        XCTAssertFalse(app.buttons["area-rename-open-" + source].exists)
        revealAreaRenameControl(app, survivor); boardEnabled(survivor)
        XCTAssertTrue(survivor.label.contains("HOME"))
        boardTap(app, "area-manager-close"); app.terminate()
    }

    func testAreaRenameFailureRetainsRawDraft() {
        areaRenameRecovery(expectFailure: true)
    }

    func testAreaRenameColdRecovery() {
        areaRenameRecovery(expectFailure: false)
    }

    private func areaRenameRecovery(expectFailure: Bool) {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-test-library", "0c4675cf-9a62-4a03-bd1e-c5ce2d64e6dd"]
        app.launch()
        let source = "170c1eab-65ec-4a38-931d-3f03399b7d17"
        let destination = "af884128-31d5-41eb-978c-2fd1a44b62e8"
        func tap(_ id: String) {
            let button = app.buttons[id]
            revealAreaRenameControl(app, button); boardEnabled(button); button.tap()
        }
        if expectFailure {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
        } else { boardEnabled(app.textFields["projects-create-title"], timeout: 30) }
        boardTap(app, "projects-manage-areas")
        boardEnabled(app.textFields["area-create-name"])
        if expectFailure {
            tap("area-rename-open-" + source)
            let input = app.textFields["area-rename-name"]
            boardEnabled(input); revealAreaRenameControl(app, input)
            replaceTextView(input, with: "  HOME  "); tap("area-rename-save")
            let error = app.staticTexts["area-rename-error"]
            XCTAssertTrue(error.waitForExistence(timeout: 15))
            for _ in 0..<2 {
                XCTAssertEqual(input.value as? String, "  HOME  ")
                XCTAssertFalse(input.isEnabled)
                for id in ["area-manager-close", "area-create-save", "area-create-cancel",
                           "area-rename-save", "area-rename-cancel", "area-order-sort-name",
                           "area-order-sort-color", "area-color-open-" + source,
                           "area-rename-open-" + destination, "area-order-up-" + source] {
                    XCTAssertFalse(app.buttons[id].isEnabled, id)
                }
                XCTAssertFalse(app.textFields["area-create-name"].isEnabled)
                tap("area-rename-retry"); boardEnabled(app.buttons["area-rename-retry"])
                XCTAssertTrue(error.exists)
            }
            let capture = XCTAttachment(screenshot: app.screenshot())
            capture.name = "Failed Area merge retains raw draft and Retry"
            capture.lifetime = .keepAlways; add(capture)
        } else {
            XCTAssertFalse(app.buttons["area-rename-open-" + source].exists)
            let survivor = app.buttons["area-rename-open-" + destination]
            revealAreaRenameControl(app, survivor); boardEnabled(survivor)
            XCTAssertTrue(survivor.label.contains("HOME"))
            XCTAssertFalse(app.staticTexts["area-rename-error"].exists)
            XCTAssertFalse(app.textFields["area-rename-name"].exists)
            boardTap(app, "area-manager-close")
        }
        app.terminate()
    }

    func testAreaDeleteProtectsProjectsRetainsTaskAndDraftAcrossRelaunch() {
        let app = XCUIApplication()
        let library = UUID().uuidString.lowercased()
        app.launchArguments = ["--native-ui-test-library", library]
        print("Area deletion isolated library: " + library)
        app.launch()
        func openProjects() {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
            boardEnabled(app.buttons["projects-manage-areas"])
        }
        openProjects()
        let name = app.textFields["area-create-name"]
        let scroll = app.scrollViews["area-manager-scroll"]
        func createArea(_ title: String, _ color: String) {
            boardTap(app, "projects-manage-areas")
            boardEnabled(name); revealPagedElement(app, name, in: scroll)
            name.tap(); name.typeText(title)
            let swatch = app.buttons["area-create-color-" + color]
            revealPagedElement(app, swatch, in: scroll); boardTap(app, swatch.identifier)
            revealPagedElement(app, app.buttons["area-create-save"], in: scroll)
            boardTap(app, "area-create-save")
            expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: name)
            waitForExpectations(timeout: 15)
        }
        createArea("Delete target", "#10b981")
        createArea("Protected Area", "#3b82f6")
        let project = app.textFields["projects-create-title"]
        boardEnabled(project); project.tap(); project.typeText("Protected project")
        let protectedChip = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label == %@",
            "projects-create-area-", "Protected Area")).firstMatch
        boardEnabled(protectedChip); protectedChip.tap()
        boardTap(app, "projects-create-add")
        boardEnabled(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@",
            "project-open-", "Protected project")).firstMatch)
        boardTap(app, "tab-inbox")
        boardTap(app, "capture-open")
        app.textViews["capture-input"].typeText("Task kept after Area deletion")
        boardTap(app, "capture-save")
        let task = app.buttons["Task kept after Area deletion"]
        boardEnabled(task); task.tap(); boardTap(app, "task-mode-edit")
        revealPagedElement(app, app.buttons["task-editor-destination"], in: app.scrollViews["task-editor-scroll"])
        boardTap(app, "task-editor-destination")
        let targetChoice = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@",
            "task-destination-choice-area-", "Delete target")).firstMatch
        boardEnabled(targetChoice); targetChoice.tap()
        boardEnabled(app.buttons["task-editor-destination"])
        XCTAssertEqual(app.buttons["task-editor-destination"].value as? String, "Delete target")
        boardTap(app, "task-editor-save")
        boardEnabled(task)
        openProjects(); boardTap(app, "projects-manage-areas"); boardEnabled(name)
        func areaID(_ title: String) -> String {
            let dot = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label ENDSWITH %@",
                "area-color-open-", title)).firstMatch
            XCTAssertTrue(dot.waitForExistence(timeout: 10))
            return String(dot.identifier.dropFirst("area-color-open-".count))
        }
        let targetID = areaID("Delete target"), protectedID = areaID("Protected Area")
        let remove = app.buttons["area-delete-" + targetID]
        let protectedRemove = app.buttons["area-delete-" + protectedID]
        XCTAssertTrue(protectedRemove.exists); XCTAssertFalse(protectedRemove.isEnabled)
        func changeColor(_ id: String, _ color: String) {
            let dot = app.buttons["area-color-open-" + id]
            revealPagedElement(app, dot, in: scroll); boardTap(app, dot.identifier)
            let swatch = app.buttons["area-color-" + id + "-" + color]
            revealPagedElement(app, swatch, in: scroll); boardTap(app, swatch.identifier)
            expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: swatch)
            waitForExpectations(timeout: 15); boardEnabled(dot)
        }
        changeColor(targetID, "#ef4444")
        revealPagedElement(app, app.buttons["area-order-sort-name"], in: scroll)
        boardTap(app, "area-order-sort-name"); boardEnabled(remove)
        revealPagedElement(app, name, in: scroll)
        name.tap(); name.typeText("Retained deletion draft")
        revealPagedElement(app, remove, in: scroll)
        XCTAssertGreaterThanOrEqual(remove.frame.height, 44)
        remove.tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: remove)
        waitForExpectations(timeout: 15)
        boardEnabled(name)
        XCTAssertEqual(name.value as? String, "Retained deletion draft")
        XCTAssertFalse(protectedRemove.isEnabled)
        XCTAssertFalse(app.staticTexts["area-delete-error"].exists)
        changeColor(protectedID, "none")
        XCTAssertFalse(protectedRemove.isEnabled)
        XCTAssertEqual(name.value as? String, "Retained deletion draft")
        let blue = app.buttons["area-create-color-#3b82f6"]
        revealPagedElement(app, blue, in: scroll); XCTAssertTrue(blue.isSelected)
        boardTap(app, "area-manager-close")
        app.terminate(); app.launch()
        boardEnabled(app.buttons["tab-inbox"], timeout: 30); boardTap(app, "tab-inbox")
        boardEnabled(task); task.tap(); boardTap(app, "task-mode-edit")
        boardEnabled(app.buttons["task-editor-destination"])
        XCTAssertEqual(app.buttons["task-editor-destination"].value as? String, "None")
        boardTap(app, "task-view-close")
        openProjects(); boardTap(app, "projects-manage-areas"); boardEnabled(name)
        XCTAssertFalse(remove.exists)
        XCTAssertTrue(protectedRemove.exists); XCTAssertFalse(protectedRemove.isEnabled)
        XCTAssertFalse(app.staticTexts["Retained deletion draft"].exists)
        boardTap(app, "area-manager-close")
    }

    func testAreaOrderingColorFreshnessDraftAndRelaunch() {
        let app = XCUIApplication()
        let library = UUID().uuidString.lowercased()
        app.launchArguments = ["--native-ui-test-library", library]
        print("Area ordering isolated library: " + library)
        app.launch()
        func openProjects() {
            boardEnabled(app.buttons["tab-menu"], timeout: 30)
            boardTap(app, "tab-menu"); boardTap(app, "menu-projects")
            boardEnabled(app.buttons["projects-manage-areas"])
        }
        openProjects()
        let name = app.textFields["area-create-name"]
        let scroll = app.scrollViews["area-manager-scroll"]
        func createArea(_ title: String, _ color: String) {
            boardTap(app, "projects-manage-areas")
            boardEnabled(name)
            revealPagedElement(app, name, in: scroll)
            name.tap(); name.typeText(title)
            let swatch = app.buttons["area-create-color-" + color]
            revealPagedElement(app, swatch, in: scroll)
            boardTap(app, swatch.identifier)
            revealPagedElement(app, app.buttons["area-create-save"], in: scroll)
            boardTap(app, "area-create-save")
            expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: name)
            waitForExpectations(timeout: 15)
        }
        createArea("Zulu", "#3b82f6")
        createArea("Alpha", "#ef4444")
        createArea("Beta", "#10b981")
        let project = app.textFields["projects-create-title"]
        boardEnabled(project); project.tap(); project.typeText("Ordered Area project")
        let betaChip = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label == %@",
            "projects-create-area-", "Beta")).firstMatch
        boardEnabled(betaChip); betaChip.tap()
        boardTap(app, "projects-create-add")
        boardEnabled(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@",
            "project-open-", "Ordered Area project")).firstMatch)
        boardTap(app, "projects-manage-areas")
        boardEnabled(name)
        var ids: [String: String] = [:]
        for title in ["Zulu", "Alpha", "Beta"] {
            let dot = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label ENDSWITH %@",
                "area-color-open-", title)).firstMatch
            boardEnabled(dot)
            ids[title] = String(dot.identifier.dropFirst("area-color-open-".count))
        }
        func assertOrder(_ titles: [String]) {
            let expected = titles.map { "area-order-up-" + ids[$0]! }
            let query = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "area-order-up-"))
            expectation(for: NSPredicate { _, _ in
                query.allElementsBoundByIndex.map(\.identifier) == expected
            }, evaluatedWith: app)
            waitForExpectations(timeout: 15)
            XCTAssertFalse(app.buttons[expected[0]].isEnabled)
        }
        func tapOrder(_ identifier: String) {
            let button = app.buttons[identifier]
            revealPagedElement(app, button, in: scroll)
            boardTap(app, identifier)
        }
        func chooseBetaColor(_ color: String) {
            let dot = app.buttons["area-color-open-" + ids["Beta"]!]
            revealPagedElement(app, dot, in: scroll)
            boardTap(app, dot.identifier)
            let swatch = app.buttons["area-color-" + ids["Beta"]! + "-" + color]
            revealPagedElement(app, swatch, in: scroll)
            boardTap(app, swatch.identifier)
            expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: swatch)
            waitForExpectations(timeout: 15)
            boardEnabled(dot)
            XCTAssertFalse(app.staticTexts["area-color-error"].exists)
        }
        assertOrder(["Zulu", "Alpha", "Beta"])
        revealPagedElement(app, name, in: scroll)
        name.tap(); name.typeText("Retained ordering draft")
        tapOrder("area-order-sort-name")
        assertOrder(["Alpha", "Beta", "Zulu"])
        XCTAssertEqual(name.value as? String, "Retained ordering draft")
        tapOrder("area-order-up-" + ids["Zulu"]!)
        assertOrder(["Alpha", "Zulu", "Beta"])
        chooseBetaColor("none")
        tapOrder("area-order-sort-color")
        assertOrder(["Zulu", "Alpha", "Beta"])
        chooseBetaColor("#10b981")
        tapOrder("area-order-sort-color")
        assertOrder(["Beta", "Zulu", "Alpha"])
        XCTAssertEqual(name.value as? String, "Retained ordering draft")
        XCTAssertFalse(app.staticTexts["area-order-error"].exists)
        let green = app.buttons["area-create-color-#10b981"]
        revealPagedElement(app, green, in: scroll)
        XCTAssertTrue(green.isSelected)
        boardTap(app, "area-manager-close")
        app.terminate(); app.launch()
        openProjects()
        boardTap(app, "projects-manage-areas")
        boardEnabled(name)
        assertOrder(["Beta", "Zulu", "Alpha"])
        XCTAssertFalse(app.staticTexts["Retained ordering draft"].exists)
        boardTap(app, "area-manager-close")
    }

    func testProjectsQuickAddDonePlusDuplicateAndRelaunch() {
        let app = XCUIApplication()
        let library = UUID().uuidString.lowercased()
        app.launchArguments = ["--native-ui-test-library", library]
        print("Projects quick-add isolated library: " + library)
        app.launch()
        func openProjects() {
            boardTap(app, "tab-menu")
            boardTap(app, "menu-projects")
            XCTAssertTrue(app.staticTexts["projects-title"].waitForExistence(timeout: 10))
            XCTAssertTrue(app.scrollViews["projects-scroll"].waitForExistence(timeout: 10))
        }
        func rows(_ title: String) -> XCUIElementQuery {
            app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@",
                                             "project-open-", title))
        }
        boardEnabled(app.buttons["tab-menu"], timeout: 30)
        openProjects()
        let input = app.textFields["projects-create-title"]
        let add = app.buttons["projects-create-add"]
        XCTAssertTrue(input.waitForExistence(timeout: 10))
        XCTAssertTrue(add.exists)
        XCTAssertFalse(add.isEnabled)
        input.tap()
        input.typeText("Ready")
        boardEnabled(add)
        input.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 5))
        XCTAssertFalse(add.isEnabled)
        let originalCount = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "project-open-")).count
        input.typeText("   ")
        XCTAssertFalse(add.isEnabled)
        input.typeText("\n")
        XCTAssertEqual(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "project-open-")).count,
                       originalCount)

        let suffix = String(library.prefix(8))
        let doneTitle = "iOS quick project Done " + suffix
        input.tap()
        input.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 3) + doneTitle + "\n")
        let doneRow = rows(doneTitle).firstMatch
        boardEnabled(doneRow)
        let doneID = doneRow.identifier
        XCTAssertTrue(doneID.hasPrefix("project-open-"))
        XCTAssertEqual(rows(doneTitle).count, 1)

        let plusTitle = "iOS quick project Plus " + suffix
        input.tap()
        input.typeText(plusTitle)
        boardTap(app, "projects-create-add")
        let plusRow = rows(plusTitle).firstMatch
        boardEnabled(plusRow)
        let plusID = plusRow.identifier
        XCTAssertNotEqual(plusID, doneID)
        XCTAssertEqual(rows(plusTitle).count, 1)

        input.tap()
        input.typeText(doneTitle)
        boardTap(app, "projects-create-add")
        expectation(for: NSPredicate { _, _ in (input.value as? String) != doneTitle }, evaluatedWith: input)
        waitForExpectations(timeout: 10)
        XCTAssertEqual(rows(doneTitle).count, 1)
        XCTAssertEqual(rows(plusTitle).count, 1)
        XCTAssertFalse(app.staticTexts["projects-create-error"].exists)

        app.terminate()
        app.launch()
        boardEnabled(app.buttons["tab-menu"], timeout: 30)
        openProjects()
        boardEnabled(app.buttons[doneID])
        boardEnabled(app.buttons[plusID])
        XCTAssertEqual(rows(doneTitle).count, 1)
        XCTAssertEqual(rows(plusTitle).count, 1)
    }

    func testProjectsMenuTaskEditSearchAndRestart() {
        let app = XCUIApplication()
        app.launch()
        func enabled(_ element: XCUIElement, timeout: TimeInterval = 10) {
            XCTAssertTrue(element.waitForExistence(timeout: timeout))
            expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: element)
            waitForExpectations(timeout: timeout)
        }
        enabled(app.buttons["capture-open"], timeout: 30)
        app.buttons["capture-open"].tap()
        let suffix = String(UUID().uuidString.prefix(8))
        let title = "iOS project task " + suffix
        let projectTitle = "iOS project " + suffix
        app.textViews["capture-input"].typeText(title + " +" + projectTitle)
        enabled(app.buttons["capture-save"])
        app.buttons["capture-save"].tap()
        enabled(app.buttons["tab-menu"])
        let underlyingTask = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "task-title-")).firstMatch.identifier
        XCTAssertFalse(underlyingTask.isEmpty)
        app.buttons["tab-menu"].tap()
        enabled(app.buttons["menu-projects"])
        XCTAssertFalse(app.buttons[underlyingTask].exists)
        XCTAssertTrue(app.buttons["menu-dismiss"].exists)
        app.buttons["menu-projects"].tap()
        XCTAssertTrue(app.staticTexts["projects-title"].waitForExistence(timeout: 10))
        let project = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "project-open-", projectTitle)).firstMatch
        enabled(project)
        let id = String(project.identifier.dropFirst("project-open-".count))
        project.tap()
        XCTAssertTrue(app.staticTexts["project-detail-title"].waitForExistence(timeout: 10))
        enabled(app.buttons[title])
        app.buttons[title].tap()
        enabled(app.buttons["task-mode-edit"])
        app.buttons["task-mode-edit"].tap()
        let titleInput = app.descendants(matching: .any).matching(identifier: "task-editor-title").firstMatch
        titleInput.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.8)).tap()
        titleInput.typeText(" changed")
        app.buttons["task-editor-save"].tap()
        enabled(app.buttons[title + " changed"])
        enabled(app.buttons["project-back"])
        app.buttons["project-back"].tap()
        enabled(app.buttons["search-open"])
        app.buttons["search-open"].tap()
        let query = app.textFields["search-input"]
        XCTAssertTrue(query.waitForExistence(timeout: 5))
        query.tap()
        query.typeText(projectTitle)
        let searchProject = app.buttons["search-project-" + id]
        enabled(searchProject)
        searchProject.tap()
        enabled(app.buttons[title + " changed"])
        app.buttons["project-back"].tap()
        enabled(searchProject)
        XCTAssertEqual(query.value as? String, projectTitle)
        app.buttons["search-close"].tap()
        XCTAssertTrue(app.staticTexts["projects-title"].waitForExistence(timeout: 10))
        app.terminate()
        app.launch()
        enabled(app.buttons["tab-menu"], timeout: 30)
        app.buttons["tab-menu"].tap()
        enabled(app.buttons["menu-projects"])
        app.buttons["menu-projects"].tap()
        enabled(app.buttons["project-open-" + id])
        app.buttons["project-open-" + id].tap()
        enabled(app.buttons[title + " changed"])
    }

    func testSearchEditCompleteFilterAndReturnToFocus() {
        let app = XCUIApplication()
        app.launch()
        func enabled(_ element: XCUIElement, timeout: TimeInterval = 10) {
            XCTAssertTrue(element.waitForExistence(timeout: timeout))
            expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: element)
            waitForExpectations(timeout: timeout)
        }
        enabled(app.buttons["capture-open"], timeout: 30)
        app.buttons["capture-open"].tap()
        let title = "iOS search " + String(UUID().uuidString.prefix(8))
        app.textViews["capture-input"].typeText(title + " /next")
        enabled(app.buttons["capture-save"])
        app.buttons["capture-save"].tap()
        enabled(app.buttons["tab-focus"])
        app.buttons["tab-focus"].tap()
        let task = app.buttons[title]
        XCTAssertTrue(task.waitForExistence(timeout: 10))
        let id = String(task.identifier.dropFirst("task-title-".count))
        enabled(app.buttons["search-open"])
        app.buttons["search-open"].tap()
        let query = app.textFields["search-input"]
        XCTAssertTrue(query.waitForExistence(timeout: 5))
        query.tap()
        query.typeText(title)
        let result = app.buttons["search-task-" + id]
        enabled(result)
        query.typeText(" nonexistent")
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: result)
        waitForExpectations(timeout: 10)
        query.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: " nonexistent".count))
        enabled(result)
        result.tap()
        enabled(app.buttons["task-mode-edit"])
        app.buttons["task-mode-edit"].tap()
        let titleInput = app.descendants(matching: .any).matching(identifier: "task-editor-title").firstMatch
        titleInput.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.8)).tap()
        titleInput.typeText(" changed")
        app.buttons["task-editor-save"].tap()
        enabled(result)
        XCTAssertEqual(query.value as? String, title)
        enabled(app.buttons["search-complete-" + id])
        app.buttons["search-complete-" + id].tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: result)
        waitForExpectations(timeout: 10)
        enabled(app.buttons["search-filters-open"])
        app.buttons["search-filters-open"].tap()
        let includeCompleted = app.buttons["search-include-completed"]
        enabled(includeCompleted)
        includeCompleted.tap()
        app.buttons["search-filters-close"].tap()
        enabled(result)
        XCTAssertFalse(app.buttons["search-complete-" + id].exists)
        enabled(app.buttons["search-close"])
        app.buttons["search-close"].tap()
        XCTAssertTrue(app.staticTexts["focus-date"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.textFields["search-input"].exists)
    }

    func testTaskDatesRelativeFocusedSavePreviewDiscardAndRestart() {
        let app = XCUIApplication()
        app.launch()
        func enabled(_ element: XCUIElement, timeout: TimeInterval = 10) {
            XCTAssertTrue(element.waitForExistence(timeout: timeout))
            expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: element)
            waitForExpectations(timeout: timeout)
        }
        func reveal(_ element: XCUIElement, upward: Bool = true) {
            for _ in 0..<10 where !element.isHittable {
                if upward { app.swipeUp() } else { app.swipeDown() }
            }
            enabled(element)
        }
        func tap(_ id: String, upward: Bool = true) {
            let element = app.buttons.matching(identifier: id).firstMatch
            reveal(element, upward: upward)
            element.tap()
        }
        func assertValue(_ element: XCUIElement, _ value: String) {
            expectation(for: NSPredicate(format: "value == %@", value), evaluatedWith: element)
            waitForExpectations(timeout: 10)
        }
        let suffix = String(UUID().uuidString.prefix(8))
        let title = "iOS dates " + suffix
        let project = "Date project " + suffix
        func openOwnedTask() {
            if !app.textFields["search-input"].exists {
                enabled(app.buttons["search-open"], timeout: 30)
                app.buttons["search-open"].tap()
                let query = app.textFields["search-input"]
                enabled(query)
                query.tap()
                query.typeText(title)
            }
            let result = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "search-task-", title)).firstMatch
            enabled(result)
            result.tap()
            tap("task-mode-edit")
        }
        func showScheduling() {
            if !app.buttons["task-editor-startTime"].exists { tap("task-editor-section-scheduling") }
            reveal(app.buttons["task-editor-startTime"])
        }
        enabled(app.buttons["capture-open"], timeout: 30)
        app.buttons["capture-open"].tap()
        app.textViews["capture-input"].typeText(title + " /priority:low +" + project + " /due:tomorrow 5pm")
        enabled(app.buttons["capture-save"])
        app.buttons["capture-save"].tap()
        openOwnedTask()
        // Tomorrow and Next week coincide on Sundays; tapping a selected
        // quick chip clears it. Choose an unselected chip from the current UI.
        let quickDateID = ["today", "next_week", "next_month"].map { "task-date-dueDate-quick-" + $0 }
            .first { !app.buttons[$0].isSelected }!
        tap(quickDateID)
        expectation(for: NSPredicate(format: "selected == true"), evaluatedWith: app.buttons[quickDateID])
        waitForExpectations(timeout: 10)
        let dueLabel = app.buttons["task-editor-dueDate"].value as? String ?? ""
        XCTAssertFalse(dueLabel.isEmpty)
        tap("task-editor-dueDate")
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "task-date-dueDate-picker").firstMatch.waitForExistence(timeout: 5))
        tap("task-date-dueDate-done")
        assertValue(app.buttons["task-editor-dueDate"], dueLabel)
        showScheduling()
        let initialReviewLabel = app.buttons["task-editor-reviewAt"].value as? String ?? ""
        tap("task-start-mode-relative")
        let amount = app.textFields["task-start-relative-amount"]
        reveal(amount)
        amount.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        amount.typeText(XCUIKeyboardKey.delete.rawValue + "5")
        // A unit change must read the pending amount, not the previous core reply.
        tap("task-start-relative-unit-week")
        assertValue(amount, "5")
        if !app.buttons["task-editor-priority-urgent"].exists { tap("task-editor-section-organization") }
        tap("task-editor-priority-urgent")
        tap("task-editor-destination", upward: false)
        tap("task-destination-close")
        XCTAssertEqual(app.buttons["task-editor-destination"].value as? String, project)
        reveal(amount)
        amount.tap()
        amount.typeText(XCUIKeyboardKey.delete.rawValue)
        // A zero-offset start label proves the blank edit's core reply arrived.
        // Keep the raw field empty while focused instead of feeding normalized 0
        // back into UIKit between Delete and the next digit.
        assertValue(app.buttons["task-editor-startTime"], dueLabel)
        let rawAmount = amount.value as? String ?? ""
        XCTAssertTrue(rawAmount.isEmpty || rawAmount == amount.placeholderValue,
                      "Core reply replaced the focused empty relative amount")
        amount.typeText("2")
        app.buttons["task-editor-save"].tap()
        XCTAssertTrue(app.textFields["search-input"].waitForExistence(timeout: 15))
        openOwnedTask()
        showScheduling()
        assertValue(amount, "2")
        // Retain the original same-call Delete + digit + immediate Save path too.
        amount.tap()
        amount.typeText(XCUIKeyboardKey.delete.rawValue + "2")
        app.buttons["task-editor-save"].tap()
        XCTAssertTrue(app.textFields["search-input"].waitForExistence(timeout: 15))
        app.terminate()
        app.launch()
        openOwnedTask()
        assertValue(app.buttons["task-editor-dueDate"], dueLabel)
        XCTAssertEqual(app.buttons["task-editor-destination"].value as? String, project)
        showScheduling()
        assertValue(app.textFields["task-start-relative-amount"], "2")
        XCTAssertTrue(app.buttons["task-start-relative-unit-week"].isSelected)
        let startLabel = app.buttons["task-editor-startTime"].value as? String ?? ""
        XCTAssertFalse(startLabel.isEmpty)
        if !app.buttons["task-editor-priority-urgent"].exists { tap("task-editor-section-organization") }
        XCTAssertTrue(app.buttons["task-editor-priority-urgent"].isSelected)
        // Date-only, review date and clear remain unsaved through Preview/discard.
        tap("task-date-dueDate-date-only", upward: false)
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.buttons["task-date-dueDate-date-only"])
        waitForExpectations(timeout: 10)
        tap("task-date-reviewAt-quick-tomorrow")
        tap("task-date-startTime-clear", upward: false)
        tap("task-mode-view")
        XCTAssertTrue(app.staticTexts[title].waitForExistence(timeout: 10))
        tap("task-view-close")
        tap("task-editor-discard")
        openOwnedTask()
        assertValue(app.buttons["task-editor-dueDate"], dueLabel)
        showScheduling()
        assertValue(app.buttons["task-editor-startTime"], startLabel)
        assertValue(app.textFields["task-start-relative-amount"], "2")
        assertValue(app.buttons["task-editor-reviewAt"], initialReviewLabel)
        tap("task-view-close")
    }

    func testTaskRecurrenceFocusedSaveWeeklyCustomUntilDiscardAndRestart() {
        let app = XCUIApplication()
        app.launch()
        func enabled(_ element: XCUIElement, timeout: TimeInterval = 10) {
            XCTAssertTrue(element.waitForExistence(timeout: timeout))
            expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: element)
            waitForExpectations(timeout: timeout)
        }
        func reveal(_ element: XCUIElement, upward: Bool = true) {
            for _ in 0..<12 where !element.isHittable {
                if upward { app.swipeUp() } else { app.swipeDown() }
            }
            enabled(element)
            XCTAssertTrue(element.isHittable)
        }
        func tap(_ id: String, upward: Bool = true) {
            let element = app.buttons.matching(identifier: id).firstMatch
            reveal(element, upward: upward)
            element.tap()
        }
        func selected(_ id: String, _ value: Bool = true) {
            expectation(for: NSPredicate(format: "selected == %@", NSNumber(value: value)), evaluatedWith: app.buttons[id])
            waitForExpectations(timeout: 10)
        }
        func assertValue(_ element: XCUIElement, _ value: String) {
            expectation(for: NSPredicate(format: "value == %@", value), evaluatedWith: element)
            waitForExpectations(timeout: 10)
        }
        let title = "iOS recurrence " + String(UUID().uuidString.prefix(8))
        func openOwnedTask() {
            if !app.textFields["search-input"].exists {
                enabled(app.buttons["search-open"], timeout: 30)
                app.buttons["search-open"].tap()
                let query = app.textFields["search-input"]
                enabled(query)
                query.tap()
                query.typeText(title)
            }
            let result = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "search-task-", title)).firstMatch
            enabled(result)
            result.tap()
            tap("task-mode-edit")
            if !app.buttons["task-recurrence-rule-none"].exists { tap("task-editor-section-scheduling") }
            reveal(app.buttons["task-recurrence-rule-none"])
        }
        func saveAndOpen(relaunch: Bool = false) {
            tap("task-editor-save")
            XCTAssertTrue(app.textFields["search-input"].waitForExistence(timeout: 15))
            if relaunch { app.terminate(); app.launch() }
            openOwnedTask()
        }
        enabled(app.buttons["capture-open"], timeout: 30)
        app.buttons["capture-open"].tap()
        app.textViews["capture-input"].typeText(title)
        enabled(app.buttons["capture-save"])
        app.buttons["capture-save"].tap()
        openOwnedTask()
        tap("task-recurrence-rule-daily")
        selected("task-recurrence-rule-daily")
        let interval = app.textFields["task-recurrence-interval"]
        reveal(interval)
        interval.tap()
        interval.typeText(XCUIKeyboardKey.delete.rawValue + "5")
        assertValue(interval, "5")
        interval.typeText(XCUIKeyboardKey.delete.rawValue)
        // The existing title field is disabled while the shared draft queue
        // runs. Its re-enable observes the normalized blank reply without blur.
        enabled(app.descendants(matching: .any).matching(identifier: "task-editor-title").firstMatch)
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        let blank = interval.value as? String ?? ""
        XCTAssertTrue(blank.isEmpty || blank == interval.placeholderValue, "Core replaced a focused blank interval")
        interval.typeText("2")
        saveAndOpen(relaunch: true)
        selected("task-recurrence-rule-daily")
        assertValue(interval, "2")

        tap("task-recurrence-rule-weekly")
        selected("task-recurrence-rule-weekly")
        let monday = "task-recurrence-weekday-MO"
        let tuesday = "task-recurrence-weekday-TU"
        reveal(app.buttons[monday])
        let initialMonday = app.buttons[monday].isSelected
        let initialTuesday = app.buttons[tuesday].isSelected
        // Three ordered toggles must not collapse into one stale draft snapshot.
        app.buttons[monday].tap()
        app.buttons[tuesday].tap()
        app.buttons[monday].tap()
        selected(monday, initialMonday)
        selected(tuesday, !initialTuesday)
        tap("task-recurrence-ends-count")
        let count = app.textFields["task-recurrence-count"]
        reveal(count)
        count.tap()
        count.typeText(XCUIKeyboardKey.delete.rawValue + "7")
        tap("task-recurrence-strategy")
        selected("task-recurrence-strategy")
        let future = app.switches["task-recurrence-show-future"]
        reveal(future)
        XCTAssertGreaterThan(future.frame.width, 100, "The accessible toggle represents the entire Calendar card")
        future.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.3)).tap()
        assertValue(future, "1")
        saveAndOpen(relaunch: true)
        selected("task-recurrence-rule-weekly")
        selected(monday, initialMonday)
        selected(tuesday, !initialTuesday)
        reveal(count)
        assertValue(count, "7")
        selected("task-recurrence-strategy")
        assertValue(future, "1")

        // Preview and discard must leave the complete saved recurrence tuple.
        tap("task-recurrence-ends-never", upward: false)
        tap("task-recurrence-strategy")
        reveal(future)
        future.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.3)).tap()
        assertValue(future, "0")
        tap("task-mode-view")
        XCTAssertTrue(app.staticTexts[title].waitForExistence(timeout: 10))
        tap("task-view-close")
        tap("task-editor-discard")
        openOwnedTask()
        selected("task-recurrence-rule-weekly")
        reveal(count)
        assertValue(count, "7")
        selected("task-recurrence-strategy")
        assertValue(future, "1")

        tap("task-recurrence-rule-monthly", upward: false)
        selected("task-recurrence-monthly-day")
        selected("task-recurrence-monthly-custom", false)
        tap("task-recurrence-monthly-custom")
        tap("task-recurrence-custom-mode-lastDay")
        tap("task-recurrence-custom-cancel")
        selected("task-recurrence-monthly-day")
        selected("task-recurrence-monthly-custom", false)
        tap("task-recurrence-monthly-custom")
        tap("task-recurrence-custom-mode-nth")
        tap("task-recurrence-custom-ordinal--1")
        tap("task-recurrence-custom-weekday-WEEKDAY")
        let customInterval = app.textFields["task-recurrence-custom-interval"]
        reveal(customInterval, upward: false)
        customInterval.tap()
        customInterval.typeText(XCUIKeyboardKey.delete.rawValue + "3")
        tap("task-recurrence-custom-apply")
        selected("task-recurrence-monthly-custom")
        selected("task-recurrence-monthly-day", false)
        saveAndOpen(relaunch: true)
        selected("task-recurrence-rule-monthly")
        selected("task-recurrence-monthly-custom")
        selected("task-recurrence-monthly-day", false)
        assertValue(interval, "3")
        tap("task-recurrence-monthly-custom")
        selected("task-recurrence-custom-mode-nth")
        selected("task-recurrence-custom-ordinal--1")
        selected("task-recurrence-custom-weekday-WEEKDAY")
        tap("task-recurrence-custom-cancel")

        tap("task-recurrence-ends-until")
        let picker = app.datePickers["task-recurrence-until-picker"]
        XCTAssertTrue(picker.waitForExistence(timeout: 10))
        let dayWheel = picker.pickerWheels.allElementsBoundByIndex.first { wheel in
            guard let value = wheel.value as? String, let day = Int(value) else { return false }
            return (1...31).contains(day)
        }
        XCTAssertNotNil(dayWheel, "The native date wheel must expose a day")
        let day = Int(dayWheel!.value as! String)!
        dayWheel!.adjust(toPickerWheelValue: String(day < 27 ? day + 1 : day - 1))
        let wheelValues = picker.pickerWheels.allElementsBoundByIndex.map { $0.value as? String ?? "" }
        tap("task-recurrence-until-done", upward: false)
        let untilLabel = app.buttons["task-recurrence-until"].value as? String ?? ""
        XCTAssertFalse(untilLabel.isEmpty)
        saveAndOpen(relaunch: true)
        tap("task-recurrence-until")
        assertValue(app.buttons["task-recurrence-until"], untilLabel)
        XCTAssertEqual(picker.pickerWheels.allElementsBoundByIndex.map { $0.value as? String ?? "" }, wheelValues)
        tap("task-recurrence-until-done", upward: false)
        tap("task-recurrence-rule-none", upward: false)
        saveAndOpen(relaunch: true)
        selected("task-recurrence-rule-none")
        XCTAssertFalse(interval.exists)
        XCTAssertFalse(future.exists)
        // The real draft boundary refuses numeric input over 200 characters.
        // A failed pure edit must remain discardable without a successful read.
        tap("task-recurrence-rule-daily")
        reveal(interval)
        interval.tap()
        interval.typeText(XCUIKeyboardKey.delete.rawValue + String(repeating: "1", count: 201))
        tap("task-mode-view")
        XCTAssertTrue(app.staticTexts["task-view-error"].waitForExistence(timeout: 15))
        tap("task-view-close")
        tap("task-editor-discard")
        openOwnedTask()
        selected("task-recurrence-rule-none")
        tap("task-view-close")
    }

    func testTaskTokensFocusedSaveSuggestionsPreviewDiscardAndRestart() {
        let app = XCUIApplication()
        app.launch()
        func enabled(_ element: XCUIElement, timeout: TimeInterval = 10) {
            XCTAssertTrue(element.waitForExistence(timeout: timeout))
            expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: element)
            waitForExpectations(timeout: timeout)
        }
        func reveal(_ element: XCUIElement, upward: Bool = true) {
            for _ in 0..<8 where !element.isHittable {
                if upward { app.swipeUp() } else { app.swipeDown() }
            }
            enabled(element)
        }
        func tap(_ id: String, upward: Bool = true) {
            let button = app.buttons.matching(identifier: id).firstMatch
            reveal(button, upward: upward)
            button.tap()
        }
        func inboxTask(_ title: String) -> XCUIElement {
            XCTAssertTrue(app.staticTexts["inbox-title"].waitForExistence(timeout: 30))
            let row = app.buttons[title]
            for _ in 0..<12 where !row.exists { app.swipeUp() }
            enabled(row)
            return row
        }
        func capture(_ text: String) {
            enabled(app.buttons["capture-open"], timeout: 30)
            app.buttons["capture-open"].tap()
            app.textViews["capture-input"].typeText(text)
            enabled(app.buttons["capture-save"])
            app.buttons["capture-save"].tap()
        }
        func assertValue(_ element: XCUIElement, _ value: String) {
            expectation(for: NSPredicate(format: "value == %@", value), evaluatedWith: element)
            waitForExpectations(timeout: 10)
        }
        let suffix = String(UUID().uuidString.prefix(8)).lowercased()
        let title = "iOS tokens " + suffix
        let project = "Token project " + suffix
        let context = "@ctx" + suffix + "known"
        let tag = "#tag" + suffix + "known"
        let lastTag = "#last" + suffix
        capture("Token companion " + suffix + " " + context + " " + tag)
        capture(title + " /priority:low +" + project)
        inboxTask(title).tap()
        tap("task-mode-edit")
        let contexts = app.textFields["task-editor-contexts"]
        reveal(contexts)
        contexts.tap()
        contexts.typeText("ctx" + suffix)
        tap("task-contexts-suggestion-" + context)
        XCTAssertTrue(app.keyboards.firstMatch.exists, "Selecting a suggestion keeps the token input focused")
        let quick = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "task-contexts-quick-")).firstMatch
        reveal(quick)
        let quickID = quick.identifier
        let wasSelected = quick.isSelected
        quick.tap()
        let sameQuick = app.buttons[quickID]
        expectation(for: NSPredicate(format: "selected == %@ AND enabled == true", NSNumber(value: !wasSelected)), evaluatedWith: sameQuick)
        waitForExpectations(timeout: 10)
        sameQuick.tap()
        expectation(for: NSPredicate(format: "selected == %@ AND enabled == true", NSNumber(value: wasSelected)), evaluatedWith: sameQuick)
        waitForExpectations(timeout: 10)
        assertValue(contexts, context)
        if !app.buttons["task-editor-priority-urgent"].exists { tap("task-editor-section-organization") }
        tap("task-editor-priority-urgent")
        tap("task-editor-destination", upward: false)
        tap("task-destination-close")
        XCTAssertEqual(app.buttons["task-editor-destination"].value as? String, project)
        let tags = app.textFields["task-editor-tags"]
        reveal(tags)
        tags.tap()
        tags.typeText("tag" + suffix)
        tap("task-tags-suggestion-" + tag)
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        // Save directly from a focused raw buffer, with no Done/blur normalization wait.
        tags.typeText(String(lastTag.dropFirst()))
        tap("task-editor-save")
        _ = inboxTask(title)
        app.terminate()
        app.launch()
        inboxTask(title).tap()
        tap("task-mode-edit")
        assertValue(app.textFields["task-editor-contexts"], context)
        XCTAssertEqual(app.buttons["task-editor-destination"].value as? String, project)
        if !app.buttons["task-editor-priority-urgent"].exists { tap("task-editor-section-organization") }
        XCTAssertTrue(app.buttons["task-editor-priority-urgent"].isSelected)
        assertValue(app.textFields["task-editor-tags"], tag + ", " + lastTag)
        // Preview resolves both buffers but does not persist them; discard restores saved tokens.
        let editContexts = app.textFields["task-editor-contexts"]
        for _ in 0..<8 where !editContexts.isHittable { app.swipeDown() }
        enabled(editContexts)
        editContexts.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.5)).tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        editContexts.typeText(", discarded" + suffix)
        tap("task-mode-view")
        XCTAssertTrue(app.staticTexts[title].waitForExistence(timeout: 10))
        tap("task-mode-edit")
        assertValue(app.textFields["task-editor-contexts"], context + ", @discarded" + suffix)
        tap("task-view-close")
        tap("task-editor-discard")
        inboxTask(title).tap()
        tap("task-mode-edit")
        assertValue(app.textFields["task-editor-contexts"], context)
        if !app.textFields["task-editor-tags"].exists { tap("task-editor-section-organization") }
        assertValue(app.textFields["task-editor-tags"], tag + ", " + lastTag)
        tap("task-view-close")
    }

    func testTaskDestinationSelectDiscardClearAndRestart() {
        let app = XCUIApplication()
        app.launch()
        func enabled(_ element: XCUIElement, timeout: TimeInterval = 10) {
            XCTAssertTrue(element.waitForExistence(timeout: timeout))
            expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: element)
            waitForExpectations(timeout: timeout)
        }
        func inboxTask(_ title: String) -> XCUIElement {
            XCTAssertTrue(app.staticTexts["inbox-title"].waitForExistence(timeout: 30))
            let row = app.buttons[title]
            for _ in 0..<12 where !row.exists { app.swipeUp() }
            return row
        }
        func tap(_ id: String) {
            let button = app.buttons.matching(identifier: id).firstMatch
            for _ in 0..<6 where !button.isHittable { app.swipeUp() }
            enabled(button)
            button.tap()
        }
        func capture(_ text: String) {
            enabled(app.buttons["capture-open"], timeout: 30)
            app.buttons["capture-open"].tap()
            app.textViews["capture-input"].typeText(text)
            enabled(app.buttons["capture-save"])
            app.buttons["capture-save"].tap()
        }
        let suffix = String(UUID().uuidString.prefix(8))
        let title = "iOS destination " + suffix
        let projectA = "Destination A " + suffix
        let projectB = "Destination B " + suffix
        capture(title + " +" + projectA)
        capture("Destination companion " + suffix + " +" + projectB)
        enabled(inboxTask(title))
        app.buttons[title].tap()
        tap("task-mode-edit")
        let titleInput = app.descendants(matching: .any).matching(identifier: "task-editor-title").firstMatch
        titleInput.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.8)).tap()
        titleInput.typeText(" changed")
        tap("task-editor-destination")
        let query = app.textFields["task-destination-query"]
        XCTAssertTrue(query.waitForExistence(timeout: 5))
        query.tap()
        query.typeText(projectB)
        let choice = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@",
            "task-destination-choice-project-", projectB)).firstMatch
        enabled(choice)
        choice.tap()
        enabled(app.buttons["task-editor-destination"])
        XCTAssertEqual(app.buttons["task-editor-destination"].value as? String, projectB)
        tap("task-mode-view")
        XCTAssertTrue(app.staticTexts[title + " changed"].waitForExistence(timeout: 10))
        tap("task-editor-save")
        enabled(inboxTask(title + " changed"))
        app.terminate()
        app.launch()
        enabled(inboxTask(title + " changed"), timeout: 30)
        app.buttons[title + " changed"].tap()
        tap("task-mode-edit")
        enabled(app.buttons["task-editor-destination"])
        XCTAssertEqual(app.buttons["task-editor-destination"].value as? String, projectB)
        tap("task-editor-destination")
        tap("task-destination-choice-none-none")
        tap("task-view-close")
        tap("task-editor-discard")
        enabled(inboxTask(title + " changed"))
        app.buttons[title + " changed"].tap()
        tap("task-mode-edit")
        enabled(app.buttons["task-editor-destination"])
        XCTAssertEqual(app.buttons["task-editor-destination"].value as? String, projectB)
        tap("task-editor-destination")
        tap("task-destination-choice-none-none")
        tap("task-editor-save")
        enabled(inboxTask(title + " changed"))
        app.terminate()
        app.launch()
        enabled(inboxTask(title + " changed"), timeout: 30)
        app.buttons[title + " changed"].tap()
        tap("task-mode-edit")
        enabled(app.buttons["task-editor-destination"])
        XCTAssertEqual(app.buttons["task-editor-destination"].value as? String, "None")
        tap("task-view-close")
    }

    func testTaskMetadataEditPreviewDiscardAndRestart() {
        let app = XCUIApplication()
        app.launch()
        func enabled(_ element: XCUIElement, timeout: TimeInterval = 10) {
            XCTAssertTrue(element.waitForExistence(timeout: timeout))
            expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: element)
            waitForExpectations(timeout: timeout)
        }
        func inboxTask(_ title: String) -> XCUIElement {
            XCTAssertTrue(app.staticTexts["inbox-title"].waitForExistence(timeout: 30))
            let row = app.buttons[title]
            for _ in 0..<12 where !row.exists { app.swipeUp() }
            return row
        }
        func tap(_ id: String) {
            let button = app.buttons.matching(identifier: id).firstMatch
            for _ in 0..<6 where !button.isHittable { app.swipeUp() }
            enabled(button)
            button.tap()
        }
        enabled(app.buttons["capture-open"], timeout: 30)
        app.buttons["capture-open"].tap()
        let title = "iOS metadata " + String(UUID().uuidString.prefix(8))
        app.textViews["capture-input"].typeText(title + " /priority:low /energy:low")
        enabled(app.buttons["capture-save"])
        app.buttons["capture-save"].tap()
        enabled(inboxTask(title))
        app.buttons[title].tap()
        tap("task-mode-edit")
        let titleInput = app.descendants(matching: .any).matching(identifier: "task-editor-title").firstMatch
        titleInput.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.8)).tap()
        titleInput.typeText(" changed")
        // Metadata is revealed by its captured value, preserving the default hidden-field preference.
        if !app.buttons["task-editor-priority-urgent"].exists { tap("task-editor-section-organization") }
        tap("task-editor-priority-urgent")
        tap("task-editor-energyLevel-high")
        XCTAssertTrue(app.buttons["task-editor-priority-urgent"].isSelected)
        XCTAssertTrue(app.buttons["task-editor-energyLevel-high"].isSelected)
        tap("task-mode-view")
        XCTAssertTrue(app.staticTexts[title + " changed"].waitForExistence(timeout: 10))
        tap("task-editor-save")
        enabled(inboxTask(title + " changed"))
        app.terminate()
        app.launch()
        enabled(inboxTask(title + " changed"), timeout: 30)
        app.buttons[title + " changed"].tap()
        tap("task-mode-edit")
        if !app.buttons["task-editor-priority-urgent"].exists { tap("task-editor-section-organization") }
        XCTAssertTrue(app.buttons["task-editor-priority-urgent"].isSelected)
        XCTAssertTrue(app.buttons["task-editor-energyLevel-high"].isSelected)
        tap("task-editor-priority-low")
        tap("task-view-close")
        tap("task-editor-discard")
        enabled(inboxTask(title + " changed"))
        app.buttons[title + " changed"].tap()
        tap("task-mode-edit")
        if !app.buttons["task-editor-priority-urgent"].exists { tap("task-editor-section-organization") }
        XCTAssertTrue(app.buttons["task-editor-priority-urgent"].isSelected)
        tap("task-editor-priority-none")
        tap("task-editor-energyLevel-none")
        tap("task-editor-save")
        enabled(inboxTask(title + " changed"))
        app.terminate()
        app.launch()
        enabled(inboxTask(title + " changed"), timeout: 30)
        app.buttons[title + " changed"].tap()
        tap("task-mode-edit")
        XCTAssertFalse(app.buttons["task-editor-priority-urgent"].exists)
        XCTAssertFalse(app.buttons["task-editor-energyLevel-high"].exists)
        tap("task-view-close")
    }

    func testTaskTextEditPreviewDiscardAndRestart() {
        let app = XCUIApplication()
        app.launch()
        func enabled(_ element: XCUIElement, timeout: TimeInterval = 10) {
            XCTAssertTrue(element.waitForExistence(timeout: timeout))
            expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: element)
            waitForExpectations(timeout: timeout)
        }
        let capture = app.buttons["capture-open"]
        enabled(capture, timeout: 30)
        capture.tap()
        let title = "iOS edit " + String(UUID().uuidString.prefix(8))
        app.textViews["capture-input"].typeText(title)
        enabled(app.buttons["capture-save"])
        app.buttons["capture-save"].tap()
        let task = app.buttons[title]
        XCTAssertTrue(task.waitForExistence(timeout: 10))
        task.tap()
        enabled(app.buttons["task-mode-edit"])
        app.buttons["task-mode-edit"].tap()
        let titleInput = app.descendants(matching: .any).matching(identifier: "task-editor-title").firstMatch
        XCTAssertTrue(titleInput.waitForExistence(timeout: 5))
        titleInput.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.8)).tap()
        titleInput.typeText(" changed")
        let editedTitle = title + " changed"
        XCTAssertEqual(titleInput.value as? String, editedTitle)
        let note = app.textViews["task-editor-note"]
        if !note.exists { app.buttons["task-editor-section-details"].tap() }
        note.tap()
        note.typeText("**Native edit** survives restart.")
        app.buttons["task-mode-view"].tap()
        XCTAssertTrue(app.staticTexts["Native edit survives restart."].waitForExistence(timeout: 10))
        app.buttons["task-view-close"].tap()
        let discard = app.buttons.matching(identifier: "task-editor-discard").firstMatch
        XCTAssertTrue(discard.waitForExistence(timeout: 5))
        app.buttons.matching(identifier: "task-editor-keep-editing").firstMatch.tap()
        enabled(app.buttons["task-editor-save"])
        app.buttons["task-editor-save"].tap()
        let renamed = app.buttons[editedTitle]
        XCTAssertTrue(renamed.waitForExistence(timeout: 10))
        app.terminate()
        app.launch()
        XCTAssertTrue(renamed.waitForExistence(timeout: 30))
        let titleID = renamed.identifier
        renamed.tap()
        XCTAssertTrue(app.staticTexts["Native edit survives restart."].waitForExistence(timeout: 10))
        app.buttons["task-mode-edit"].tap()
        note.tap()
        note.typeText(" Discard this.")
        app.buttons["task-view-close"].tap()
        XCTAssertTrue(discard.waitForExistence(timeout: 5))
        discard.tap()
        XCTAssertTrue(renamed.waitForExistence(timeout: 10))
        renamed.tap()
        XCTAssertTrue(app.staticTexts["Native edit survives restart."].waitForExistence(timeout: 10))
        app.buttons["task-view-close"].tap()
        let status = app.buttons["task-status-" + String(titleID.dropFirst("task-title-".count))]
        enabled(status)
        status.tap()
        app.buttons.matching(identifier: "task-complete").firstMatch.tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: renamed)
        waitForExpectations(timeout: 10)
    }

    func testTaskViewShowsSavedNoteWithoutCompletingTask() {
        let app = XCUIApplication()
        app.launch()
        let capture = app.buttons["capture-open"]
        XCTAssertTrue(capture.waitForExistence(timeout: 30))
        expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: capture)
        waitForExpectations(timeout: 30)
        capture.tap()
        let title = "iOS task view " + UUID().uuidString
        let input = app.textViews["capture-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        input.typeText(title)
        app.buttons["capture-options"].tap()
        let note = app.descendants(matching: .any).matching(identifier: "capture-note").firstMatch
        XCTAssertTrue(note.waitForExistence(timeout: 5))
        note.tap()
        note.typeText("**Saved note** remains readable.")
        let save = app.buttons["capture-save"]
        expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: save)
        waitForExpectations(timeout: 10)
        save.tap()
        XCTAssertTrue(app.buttons[title].waitForExistence(timeout: 10))
        app.terminate()
        app.launch()
        let task = app.buttons[title]
        XCTAssertTrue(task.waitForExistence(timeout: 30))
        let titleID = task.identifier
        task.tap()
        XCTAssertTrue(app.buttons["task-mode-view"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", title)).firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Saved note remains readable."].waitForExistence(timeout: 10))
        app.buttons["task-view-close"].tap()
        XCTAssertTrue(task.waitForExistence(timeout: 10))
        XCTAssertTrue(titleID.hasPrefix("task-title-"))
        let status = app.buttons["task-status-" + String(titleID.dropFirst("task-title-".count))]
        status.tap()
        app.buttons.matching(identifier: "task-complete").firstMatch.tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: task)
        waitForExpectations(timeout: 10)
    }

    func testAreaScopeCycleAndPersistence() {
        let app = XCUIApplication()
        app.launch()
        let capture = app.buttons["capture-open"]
        let area = app.buttons["area-open"]
        let all = app.buttons["area-option-__all__"]
        let noArea = app.buttons["area-option-__none__"]
        func waitEnabled(_ element: XCUIElement, timeout: TimeInterval = 10) {
            XCTAssertTrue(element.waitForExistence(timeout: timeout))
            expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: element)
            waitForExpectations(timeout: timeout)
        }
        func closeArea() {
            // The RN-style dismissal target is the backdrop above the sheet.
            app.buttons["area-dismiss"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
            expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.staticTexts["area-title"])
            waitForExpectations(timeout: 10)
        }

        waitEnabled(capture, timeout: 30)
        area.tap()
        waitEnabled(all)
        all.tap()
        expectation(for: NSPredicate(format: "selected == true"), evaluatedWith: all)
        waitForExpectations(timeout: 10)
        waitEnabled(all)
        XCTAssertTrue(all.isSelected)
        closeArea()
        let allLabel = area.value as? String

        capture.tap()
        let input = app.textViews["capture-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        let title = "iOS area " + UUID().uuidString
        input.typeText(title + " /next")
        let save = app.buttons["capture-save"]
        waitEnabled(save)
        save.tap()
        let focus = app.buttons["tab-focus"]
        waitEnabled(focus)
        focus.tap()
        let task = app.buttons[title]
        XCTAssertTrue(task.waitForExistence(timeout: 10))

        waitEnabled(area)
        area.tap()
        waitEnabled(noArea)
        noArea.tap()
        expectation(for: NSPredicate(format: "selected == true"), evaluatedWith: noArea)
        waitForExpectations(timeout: 10)
        waitEnabled(noArea)
        XCTAssertTrue(noArea.isSelected)
        closeArea()
        XCTAssertNotEqual(area.value as? String, allLabel)
        XCTAssertTrue(task.exists)

        area.tap()
        waitEnabled(noArea)
        noArea.tap()
        expectation(for: NSPredicate(format: "selected == false AND value != nil AND value != ''"), evaluatedWith: noArea)
        waitForExpectations(timeout: 10)
        waitEnabled(noArea)
        XCTAssertFalse(noArea.isSelected)
        let excluded = noArea.value as? String
        XCTAssertFalse(excluded?.isEmpty ?? true)
        closeArea()
        XCTAssertFalse(task.exists)
        let excludedLabel = area.value as? String

        app.terminate()
        app.launch()
        waitEnabled(capture, timeout: 30)
        XCTAssertEqual(area.value as? String, excludedLabel)
        focus.tap()
        XCTAssertTrue(app.staticTexts["focus-date"].waitForExistence(timeout: 10))
        waitEnabled(area)
        XCTAssertFalse(task.exists)
        area.tap()
        waitEnabled(noArea)
        XCTAssertEqual(noArea.value as? String, excluded)

        // Finish the core cycle, then exercise All from a non-default selection.
        noArea.tap()
        expectation(for: NSPredicate(format: "selected == true"), evaluatedWith: all)
        waitForExpectations(timeout: 10)
        waitEnabled(all)
        XCTAssertTrue(all.isSelected)
        noArea.tap()
        expectation(for: NSPredicate(format: "selected == true"), evaluatedWith: noArea)
        waitForExpectations(timeout: 10)
        waitEnabled(noArea)
        XCTAssertTrue(noArea.isSelected)
        all.tap()
        expectation(for: NSPredicate(format: "selected == true"), evaluatedWith: all)
        waitForExpectations(timeout: 10)
        waitEnabled(all)
        XCTAssertTrue(all.isSelected)
        closeArea()
        XCTAssertEqual(area.value as? String, allLabel)
        XCTAssertTrue(task.waitForExistence(timeout: 10))

        // Remove only this test's own task. Leave scope at All for the other tests.
        let titleID = task.identifier
        XCTAssertTrue(titleID.hasPrefix("task-title-"))
        let status = app.buttons["task-status-" + String(titleID.dropFirst("task-title-".count))]
        waitEnabled(status)
        status.tap()
        app.buttons.matching(identifier: "task-complete").firstMatch.tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: task)
        waitForExpectations(timeout: 10)
    }

    func testFocusCaptureAndCompleteSurviveRelaunch() {
        let app = XCUIApplication()
        app.launch()
        let capture = app.buttons["capture-open"]
        XCTAssertTrue(capture.waitForExistence(timeout: 30))
        expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: capture)
        waitForExpectations(timeout: 30)
        XCTAssertTrue(app.staticTexts["inbox-title"].exists)
        capture.tap()
        let input = app.textViews["capture-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        let title = "iOS Focus " + UUID().uuidString
        input.typeText(title + " /next")
        // Keep this task visible independently of the existing Next list's size.
        let star = app.buttons["capture-focus"]
        expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: star)
        waitForExpectations(timeout: 10)
        star.tap()
        let save = app.buttons["capture-save"]
        expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: save)
        waitForExpectations(timeout: 10)
        save.tap()

        let focus = app.buttons["tab-focus"]
        expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: focus)
        waitForExpectations(timeout: 10)
        focus.tap()
        let task = app.buttons[title]
        XCTAssertTrue(task.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["focus-date"].exists)

        // A tab change refreshes its own surface without changing the default launch tab.
        let inbox = app.buttons["tab-inbox"]
        expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: inbox)
        waitForExpectations(timeout: 10)
        inbox.tap()
        expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: focus)
        waitForExpectations(timeout: 10)
        XCTAssertFalse(task.exists)
        focus.tap()
        XCTAssertTrue(task.waitForExistence(timeout: 10))
        let titleID = task.identifier
        XCTAssertTrue(titleID.hasPrefix("task-title-"))
        let status = app.buttons["task-status-" + String(titleID.dropFirst("task-title-".count))]
        expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: status)
        waitForExpectations(timeout: 10)
        status.tap()
        app.buttons.matching(identifier: "task-complete").firstMatch.tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: task)
        waitForExpectations(timeout: 10)

        app.terminate()
        app.launch()
        XCTAssertTrue(capture.waitForExistence(timeout: 30))
        expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: capture)
        waitForExpectations(timeout: 30)
        XCTAssertTrue(app.staticTexts["inbox-title"].exists)
        focus.tap()
        XCTAssertTrue(app.staticTexts["focus-date"].waitForExistence(timeout: 10))
        expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: capture)
        waitForExpectations(timeout: 10)
        XCTAssertFalse(task.exists)
    }

    func testCaptureNoteAndContextPreserveDraftAndSave() {
        let app = XCUIApplication()
        app.launch()
        let capture = app.buttons["capture-open"]
        XCTAssertTrue(capture.waitForExistence(timeout: 30))
        expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: capture)
        waitForExpectations(timeout: 30)
        capture.tap()

        let suffix = UUID().uuidString.lowercased()
        let title = "iOS note context " + suffix
        let token = "ios-" + String(suffix.prefix(8))
        let note = "Keep this note after choosing a context."
        let input = app.textViews["capture-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        input.typeText(title)
        app.buttons["capture-options"].tap()
        let noteInput = app.descendants(matching: .any).matching(identifier: "capture-note").firstMatch
        XCTAssertTrue(noteInput.waitForExistence(timeout: 5))
        noteInput.tap()
        noteInput.typeText("Keep this note ")

        app.buttons["capture-contexts"].tap()
        let query = app.textFields["capture-context-query"]
        XCTAssertTrue(query.waitForExistence(timeout: 5))
        query.typeText(token)
        let add = app.buttons["capture-context-add"]
        XCTAssertTrue(add.waitForExistence(timeout: 10))
        expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: add)
        waitForExpectations(timeout: 10)
        add.tap()
        let selected = app.buttons["capture-context-remove-@" + token]
        XCTAssertTrue(selected.waitForExistence(timeout: 10))
        selected.tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: selected)
        waitForExpectations(timeout: 10)
        query.tap()
        query.typeText(token)
        XCTAssertTrue(add.waitForExistence(timeout: 10))
        expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: add)
        waitForExpectations(timeout: 10)
        add.tap()
        XCTAssertTrue(selected.waitForExistence(timeout: 10))
        app.buttons["capture-context-close"].tap()

        XCTAssertEqual(noteInput.value as? String, "Keep this note ")
        noteInput.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        noteInput.typeText("after choosing a context.")
        app.buttons["capture-close"].tap()
        capture.tap()
        app.buttons["capture-options"].tap()
        XCTAssertEqual(noteInput.value as? String, note)
        XCTAssertEqual(input.value as? String, title)
        let save = app.buttons["capture-save"]
        expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: save)
        waitForExpectations(timeout: 10)
        save.tap()
        XCTAssertTrue(app.buttons[title].waitForExistence(timeout: 10))

        app.terminate()
        app.launch()
        XCTAssertTrue(app.buttons[title].waitForExistence(timeout: 30))
        XCTAssertTrue(app.staticTexts["@" + token].exists)

        // The saved context is now a core suggestion: selecting and clearing it
        // uses the same picker edits without persisting a second task.
        capture.tap()
        app.buttons["capture-contexts"].tap()
        XCTAssertTrue(query.waitForExistence(timeout: 5))
        query.typeText(token)
        let option = app.buttons["capture-context-option-@" + token]
        XCTAssertTrue(option.waitForExistence(timeout: 10))
        expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: option)
        waitForExpectations(timeout: 10)
        option.tap()
        XCTAssertTrue(selected.waitForExistence(timeout: 10))
        query.tap()
        query.typeText(token + "\n")
        expectation(for: NSPredicate(format: "value == '' OR value == %@", query.placeholderValue ?? ""), evaluatedWith: query)
        waitForExpectations(timeout: 10)
        XCTAssertTrue(selected.exists)
        app.buttons["capture-context-clear"].tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: query)
        waitForExpectations(timeout: 10)
        app.buttons["capture-close"].tap()
    }

    func testCaptureAndCompleteSurviveRelaunch() {
        let app = XCUIApplication()
        app.launch()
        let capture = app.buttons["capture-open"]
        XCTAssertTrue(capture.waitForExistence(timeout: 30))
        expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: capture)
        waitForExpectations(timeout: 30)
        capture.tap()
        let input = app.textViews["capture-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        let title = "iOS foundation " + UUID().uuidString
        input.typeText(title)
        let save = app.buttons["capture-save"]
        let enabled = NSPredicate(format: "enabled == true")
        expectation(for: enabled, evaluatedWith: save)
        waitForExpectations(timeout: 10)
        save.tap()
        XCTAssertTrue(app.buttons[title].waitForExistence(timeout: 10))
        app.terminate()
        app.launch()
        XCTAssertTrue(app.buttons[title].waitForExistence(timeout: 30))
        let titleID = app.buttons[title].identifier
        XCTAssertTrue(titleID.hasPrefix("task-title-"))
        let status = app.buttons["task-status-" + String(titleID.dropFirst("task-title-".count))]
        XCTAssertTrue(status.exists)
        status.tap()
        // SwiftUI's confirmation dialog also exposes a nested button with the
        // same identifier on iOS 27. Tap its first (accessible) outer control.
        app.buttons.matching(identifier: "task-complete").firstMatch.tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.buttons[title])
        waitForExpectations(timeout: 10)
        app.terminate()
        app.launch()
        XCTAssertTrue(app.buttons["capture-open"].waitForExistence(timeout: 30))
        expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: app.buttons["capture-open"])
        waitForExpectations(timeout: 30)
        XCTAssertFalse(app.buttons[title].exists)
    }
}
