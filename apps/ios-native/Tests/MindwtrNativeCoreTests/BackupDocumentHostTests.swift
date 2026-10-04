import XCTest
import SQLite3
@testable import MindwtrNativeCore

final class BackupDocumentHostTests: XCTestCase {
    private var root: URL!
    private var bundle: URL!
    private var database: URL { root.appendingPathComponent("core.sqlite") }
    private var journal: URL { database.appendingPathExtension("pending.json") }

    override func setUpWithError() throws {
        guard let path = ProcessInfo.processInfo.environment["MINDWTR_CORE_BUNDLE"] else { throw XCTSkip("Core bundle required") }
        bundle = URL(fileURLWithPath: path)
        root = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".mindwtr-native-tests/" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { if let root { try FileManager.default.removeItem(at: root) } }
    private func host(_ faults: HostIOFaults = HostIOFaults()) -> CoreHost {
        let value = CoreHost(databaseURL: database, bundleURL: bundle, faults: faults)
        addTeardownBlock { await value.close() }
        return value
    }
    private func json(_ value: Any) throws -> String {
        String(decoding: try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), as: UTF8.self)
    }
    private func object(_ value: String) throws -> [String: Any] {
        try XCTUnwrap(NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any])
    }
    private func rows(_ sql: String, _ params: [Any] = []) throws -> [[String: Any]] {
        let db = try SQLiteBridge(url: database); defer { db.close() }
        return try XCTUnwrap(NativeJSON.jsonObject(with: Data(db.execute(sql, parametersJSON: json(params)).utf8)) as? [[String: Any]])
    }
    private func capture(_ core: CoreHost, _ title: String) async throws -> String {
        let id = UUID().uuidString.lowercased()
        let opened = try object(await core.call("captureOpen"))
        let options = try XCTUnwrap(opened["options"])
        _ = try await core.call("captureSubmit", argumentsJSON: json([json(["text": title, "options": options, "captureId": id, "openAfterSave": false])]))
        return id
    }
    private func source(_ core: CoreHost, title: String = "Imported 日本語 🦉") async throws -> (URL, String) {
        let exported = try await core.prepareDataBackup()
        var document = try object(String(contentsOf: exported.url, encoding: .utf8))
        await core.discardDataBackup(exported.id)
        let id = UUID().uuidString.lowercased()
        document["tasks"] = [["id": id, "title": title, "status": "inbox", "tags": [], "contexts": [],
            "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z", "rev": 1]]
        document["projects"] = []; document["sections"] = []; document["areas"] = []; document["people"] = []
        let url = root.appendingPathComponent("selected-" + UUID().uuidString + ".json")
        try json(document).write(to: url, atomically: true, encoding: .utf8)
        return (url, id)
    }
    private func failure(_ work: () async throws -> Void) async {
        do { try await work(); XCTFail("Expected failure") } catch { }
    }
    private func snapshots(_ core: CoreHost) async throws -> [[String: Any]] {
        let encoded = try await core.listBackupSnapshots()
        return try XCTUnwrap(NativeJSON.jsonObject(with: Data(encoded.utf8)) as? [[String: Any]])
    }

    func testInspectionCancelAndInvalidInputDoNotWriteDomainOrSnapshot() async throws {
        let core = host(); _ = try await core.start()
        _ = try await capture(core, "Existing")
        let (url, _) = try await source(core)
        let before = try json(rows("SELECT * FROM tasks ORDER BY id"))
        let preview = try await core.prepareBackupImport(url)
        XCTAssertEqual(try object(preview.json)["valid"] as? Bool, true)
        XCTAssertEqual(try json(rows("SELECT * FROM tasks ORDER BY id")), before)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        let initial = try await snapshots(core); XCTAssertTrue(initial.isEmpty)
        await core.discardBackupImport(preview.id)
        await failure { _ = try await core.mergeBackupImport(preview.id) }
        try "{invalid".write(to: url, atomically: true, encoding: .utf8)
        let invalid = try await core.prepareBackupImport(url)
        XCTAssertEqual(try object(invalid.json)["valid"] as? Bool, false)
        XCTAssertEqual(try json(rows("SELECT * FROM tasks ORDER BY id")), before)
        let final = try await snapshots(core); XCTAssertTrue(final.isEmpty)
    }

    func testConfirmationMergesLatestStateAndRestartUndoUsesExactSnapshot() async throws {
        let core = host(); _ = try await core.start()
        let original = try await capture(core, "Before preview")
        let (url, imported) = try await source(core)
        let preview = try await core.prepareBackupImport(url)
        // Provider changes after selection must not replace the staged bytes.
        try "changed provider".write(to: url, atomically: true, encoding: .utf8)
        let intervening = try await capture(core, "After preview before confirm")
        let reply = try object(await core.mergeBackupImport(preview.id))
        XCTAssertEqual(reply["added"] as? Int, 1)
        XCTAssertEqual(try rows("SELECT id FROM tasks WHERE deletedAt IS NULL").count, 3)
        let roster = try await snapshots(core); XCTAssertEqual(roster.count, 1)
        XCTAssertEqual(roster.first?["name"] as? String, reply["snapshotName"] as? String)
        let afterMerge = try await capture(core, "After merge must be rolled back by Undo")
        await core.close()
        // Optional isolated UI seed uses the same real host operation and its
        // completed recovery files. Refuse overwrite; never target app storage.
        if let path = ProcessInfo.processInfo.environment["MINDWTR_BACKUP_UI_SEED"] {
            let target = URL(fileURLWithPath: path, isDirectory: true)
            guard path.hasPrefix(FileManager.default.homeDirectoryForCurrentUser.path + "/"),
                  !FileManager.default.fileExists(atPath: path) else { throw HostFailure("UI seed path unavailable") }
            try FileManager.default.copyItem(at: root, to: target)
        }
        let reopened = host(); _ = try await reopened.start()
        let restoredRoster = try await snapshots(reopened)
        XCTAssertEqual(try json(restoredRoster), try json(roster))
        let ref = try json(XCTUnwrap(restoredRoster.first))
        let confirmation = try object(await reopened.backupSnapshotRestoreModel(ref))
        XCTAssertFalse((confirmation["message"] as? String ?? "").isEmpty)
        let undo = try object(await reopened.restoreBackupSnapshot(ref))
        XCTAssertEqual(undo["operation"] as? String, "restore")
        let live = Set(try rows("SELECT id FROM tasks WHERE deletedAt IS NULL").compactMap { $0["id"] as? String })
        XCTAssertEqual(live, [original, intervening])
        for id in [imported, afterMerge] {
            XCTAssertNotNil(try rows("SELECT deletedAt FROM tasks WHERE id = ?", [id]).first?["deletedAt"] as? String)
        }
        let finalRoster = try await snapshots(reopened); XCTAssertEqual(finalRoster.count, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testColdReplayAfterLostAcknowledgmentKeepsLaterEditsAndSnapshot() async throws {
        for terminal in [false, true] {
            let faults = HostIOFaults(); let core = host(faults); _ = try await core.start()
            let (url, imported) = try await source(core)
            let preview = try await core.prepareBackupImport(url)
            if terminal { faults.journalRemove = { throw HostFailure("Injected journal cleanup") } }
            else { var writes = 0; faults.journalWrite = { writes += 1; if writes == 2 { throw HostFailure("Injected lost reply") } } }
            await failure { _ = try await core.mergeBackupImport(preview.id) }
            XCTAssertTrue(FileManager.default.fileExists(atPath: journal.path))
            let compact = try object(String(contentsOf: journal, encoding: .utf8))
            XCTAssertLessThan((compact["argumentsJSON"] as? String ?? "").utf8.count, 1024)
            await core.close()
            _ = try rows("UPDATE tasks SET title = ?, rev = rev + 1, updatedAt = ? WHERE id = ?", ["Later edit survives replay", "2037-01-01T00:00:00.000Z", imported])
            let before = try json(rows("SELECT * FROM tasks ORDER BY id"))
            let reopened = host(); let startup = try object(await reopened.start())
            XCTAssertEqual((startup["recovery"] as? [String: Any])?["method"] as? String, "backupDocumentCommit")
            XCTAssertEqual(try json(rows("SELECT * FROM tasks ORDER BY id")), before)
            let roster = try await snapshots(reopened); XCTAssertFalse(roster.isEmpty)
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            await reopened.close()
        }
    }

    func testFirstJournalFailureRetriesSamePlanAndReactivatesHost() async throws {
        let faults = HostIOFaults(); let core = host(faults); _ = try await core.start()
        let (url, imported) = try await source(core)
        let preview = try await core.prepareBackupImport(url)
        faults.journalWrite = { throw HostFailure("Injected first journal failure") }
        await failure { _ = try await core.mergeBackupImport(preview.id) }
        XCTAssertTrue(try rows("SELECT id FROM tasks WHERE id = ?", [imported]).isEmpty)
        await failure { _ = try await core.prepareBackupImport(url) }
        faults.journalWrite = nil
        let recovered = try await core.retryPending()
        XCTAssertEqual(try object(XCTUnwrap(recovered))["operation"] as? String, "merge")
        _ = try await capture(core, "Normal activation resumed")
        let roster = try await snapshots(core); XCTAssertEqual(roster.count, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testLargeUnicodeSourceUsesCompactJournalAndExactOwnedPlan() async throws {
        let faults = HostIOFaults(); let core = host(faults); _ = try await core.start()
        let (url, imported) = try await source(core)
        var document = try object(String(contentsOf: url, encoding: .utf8))
        var tasks = try XCTUnwrap(document["tasks"] as? [[String: Any]])
        let note = String(repeating: "incoming 日本語 🦉", count: 700_000)
        tasks[0]["description"] = note; document["tasks"] = tasks
        let encoded = try json(document)
        XCTAssertGreaterThan(encoded.utf8.count, 12 * 1024 * 1024)
        try encoded.write(to: url, atomically: true, encoding: .utf8)
        let preview = try await core.prepareBackupImport(url)
        XCTAssertEqual(try object(preview.json)["valid"] as? Bool, true)
        faults.journalRemove = { throw HostFailure("Injected large document cleanup failure") }
        await failure { _ = try await core.mergeBackupImport(preview.id) }
        XCTAssertLessThan(try Data(contentsOf: journal).count, 4096)
        XCTAssertEqual(try rows("SELECT description FROM tasks WHERE id = ?", [imported]).first?["description"] as? String, note)
        await core.close()
        let reopened = host(); _ = try await reopened.start()
        XCTAssertEqual(try rows("SELECT description FROM tasks WHERE id = ?", [imported]).first?["description"] as? String, note)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testActivationFailureAfterCleanupRetainsReplyWithoutReimport() async throws {
        let faults = HostIOFaults(); let core = host(faults); _ = try await core.start()
        let (url, imported) = try await source(core)
        let preview = try await core.prepareBackupImport(url)
        faults.journalRemove = {
            faults.beforeSQL = { _ in throw HostFailure("Injected post-cleanup activation read failure") }
        }
        await failure { _ = try await core.mergeBackupImport(preview.id) }
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        XCTAssertEqual(try rows("SELECT id FROM tasks WHERE id = ?", [imported]).count, 1)
        let before = try json(rows("SELECT * FROM tasks ORDER BY id"))
        faults.beforeSQL = nil; faults.journalRemove = nil
        let reply = try await core.retryPending()
        XCTAssertEqual(try object(XCTUnwrap(reply))["operation"] as? String, "merge")
        XCTAssertEqual(try json(rows("SELECT * FROM tasks ORDER BY id")), before)
        let second = try await core.retryPending(); XCTAssertNil(second)
    }

    func testActualCommitAcknowledgmentLossReplaysReceiptWithoutReapplying() async throws {
        let faults = HostIOFaults(); let core = host(faults); _ = try await core.start()
        let (url, imported) = try await source(core)
        let preview = try await core.prepareBackupImport(url)
        var lost = false
        faults.afterSQL = { sql in
            if sql.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() == "COMMIT", !lost {
                lost = true; throw HostFailure("Injected committed acknowledgment loss")
            }
        }
        await failure { _ = try await core.mergeBackupImport(preview.id) }
        XCTAssertTrue(lost)
        XCTAssertEqual(try rows("SELECT id FROM tasks WHERE id = ?", [imported]).count, 1)
        await core.close()
        _ = try rows("UPDATE tasks SET title = ?, rev = rev + 1 WHERE id = ?", ["Edited after lost COMMIT reply", imported])
        let before = try json(rows("SELECT * FROM tasks ORDER BY id"))
        let reopened = host(); _ = try await reopened.start()
        XCTAssertEqual(try json(rows("SELECT * FROM tasks ORDER BY id")), before)
        let roster = try await snapshots(reopened); XCTAssertEqual(roster.count, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testExternalWriteAfterPreparationRejectsBeforeReplacingData() async throws {
        let faults = HostIOFaults(); let core = host(faults); _ = try await core.start()
        let local = try await capture(core, "Before import")
        let (url, imported) = try await source(core)
        let preview = try await core.prepareBackupImport(url)
        var changed = false
        faults.beforeSQL = { sql in
            if sql.trimmingCharacters(in: .whitespacesAndNewlines).uppercased().hasPrefix("BEGIN"), !changed {
                changed = true
                _ = try self.rows("UPDATE tasks SET title = ?, rev = rev + 1 WHERE id = ?", ["External edit wins", local])
            }
        }
        do { _ = try await core.mergeBackupImport(preview.id); XCTFail("Stale merge must refuse") }
        catch { XCTAssertTrue(error is CoreHostRejection, String(describing: error)) }
        XCTAssertTrue(changed)
        XCTAssertTrue(try rows("SELECT id FROM tasks WHERE id = ?", [imported]).isEmpty)
        XCTAssertEqual(try rows("SELECT title FROM tasks WHERE id = ?", [local]).first?["title"] as? String, "External edit wins")
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        faults.beforeSQL = nil
        let roster = try await snapshots(core); XCTAssertTrue(roster.isEmpty)
    }

    func testTerminalMissingReceiptCannotReapplyEvenAgainstOriginalState() async throws {
        let faults = HostIOFaults(); let core = host(faults); _ = try await core.start()
        let (url, _) = try await source(core)
        let preview = try await core.prepareBackupImport(url)
        faults.journalRemove = { throw HostFailure("Injected terminal retention") }
        await failure { _ = try await core.mergeBackupImport(preview.id) }
        await core.close()
        _ = try rows("DELETE FROM native_request_receipts WHERE method LIKE '[\"backupDocument\",%'")
        let before = try json(rows("SELECT * FROM tasks ORDER BY id"))
        let journalBefore = try Data(contentsOf: journal)
        let reopened = host(); await failure { _ = try await reopened.start() }
        XCTAssertEqual(try json(rows("SELECT * FROM tasks ORDER BY id")), before)
        XCTAssertEqual(try Data(contentsOf: journal), journalBefore)
    }

    func testMissingPlanAndMalformedJournalPreserveRecoveryFiles() async throws {
        let faults = HostIOFaults(); let core = host(faults); _ = try await core.start()
        let (url, _) = try await source(core)
        let preview = try await core.prepareBackupImport(url)
        faults.journalRemove = { throw HostFailure("Injected terminal retention") }
        await failure { _ = try await core.mergeBackupImport(preview.id) }
        await core.close()
        let owned = root.appendingPathComponent("backup-operations")
        let names = try FileManager.default.contentsOfDirectory(atPath: owned.path)
        let originalJournal = try Data(contentsOf: journal)
        try Data("unknown journal".utf8).write(to: journal)
        let corrupt = host(); await failure { _ = try await corrupt.start() }; await corrupt.close()
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: owned.path), names)
        try originalJournal.write(to: journal)
        let plan = owned.appendingPathComponent(try XCTUnwrap(names.first)).appendingPathComponent("plan.json")
        try Data("tampered".utf8).write(to: plan)
        let before = try json(rows("SELECT * FROM tasks ORDER BY id"))
        let missing = host(); await failure { _ = try await missing.start() }
        XCTAssertEqual(try json(rows("SELECT * FROM tasks ORDER BY id")), before)
        XCTAssertEqual(try Data(contentsOf: journal), originalJournal)
        XCTAssertTrue(FileManager.default.fileExists(atPath: plan.path))
    }
    func testCSVImportUsesOwnedBytesFreshBaselineAndColdSnapshotUndo() async throws {
        let core = host(); _ = try await core.start()
        let before = try await capture(core, "CSV existing")
        let imported = UUID().uuidString.lowercased()
        let csv = "Title,Status,Project,Section,Area,Checklist,Due Date,ID\nCSV 日本語 🦉,waiting,CSV project,CSV section,CSV area,[x] First|[ ] Second,2035-03-09,\(imported)\n"
        let url = root.appendingPathComponent("selected.csv")
        try csv.write(to: url, atomically: true, encoding: .utf8)
        let preview = try await core.prepareBackupImport(url, action: .csv)
        XCTAssertEqual(preview.action, .csv)
        XCTAssertEqual(try object(preview.json)["valid"] as? Bool, true)
        let duringPreview = try await capture(core, "CSV before confirmation")
        try "Changed provider bytes".write(to: url, atomically: true, encoding: .utf8)
        let result = try object(await core.mergeBackupImport(preview.id))
        XCTAssertEqual(result["operation"] as? String, "csv")
        let counts = try XCTUnwrap(result["result"] as? [String: Any])
        XCTAssertEqual(counts["importedTaskCount"] as? Int, 1)
        XCTAssertEqual(counts["importedSectionCount"] as? Int, 1)
        let task = try XCTUnwrap(rows("SELECT * FROM tasks WHERE title = ?", ["CSV 日本語 🦉"]).first)
        XCTAssertEqual(task["title"] as? String, "CSV 日本語 🦉")
        XCTAssertEqual(task["status"] as? String, "waiting")
        XCTAssertEqual(task["dueDate"] as? String, "2035-03-09")
        let checklist = try XCTUnwrap(NativeJSON.jsonObject(with: Data((task["checklist"] as? String ?? "").utf8)) as? [[String: Any]])
        XCTAssertEqual(checklist.count, 2)
        XCTAssertEqual(checklist[0]["isCompleted"] as? Bool, true)
        XCTAssertEqual(try rows("SELECT id FROM tasks WHERE deletedAt IS NULL").count, 3)
        let model = try object(await core.backupDocumentResultModel(json(result)))
        XCTAssertFalse((model["undoLabel"] as? String ?? "").isEmpty)
        let roster = try await snapshots(core)
        let reference = try json(XCTUnwrap(roster.first))
        _ = try await capture(core, "CSV later change undone")
        await core.close()
        let reopened = host(); _ = try await reopened.start()
        _ = try await reopened.restoreBackupSnapshot(reference)
        let ids = Set(try rows("SELECT id FROM tasks WHERE deletedAt IS NULL").compactMap { $0["id"] as? String })
        XCTAssertEqual(ids, [before, duringPreview])
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        await reopened.close()
        let cold = host(); _ = try await cold.start()
        XCTAssertEqual(Set(try rows("SELECT id FROM tasks WHERE deletedAt IS NULL").compactMap { $0["id"] as? String }), ids)
    }

    func testCSVLostAcknowledgmentColdReplayPreservesLaterEditsAndDoesNotDuplicate() async throws {
        let faults = HostIOFaults(); let core = host(faults); _ = try await core.start()
        let url = root.appendingPathComponent("selected.csv")
        try "Title,Status\nCSV once,next\n".write(to: url, atomically: true, encoding: .utf8)
        let preview = try await core.prepareBackupImport(url, action: .csv)
        var writes = 0
        faults.journalWrite = { writes += 1; if writes == 2 { throw HostFailure("Injected CSV lost reply") } }
        await failure { _ = try await core.mergeBackupImport(preview.id) }
        XCTAssertTrue(FileManager.default.fileExists(atPath: journal.path))
        await core.close()
        let imported = try XCTUnwrap(rows("SELECT id FROM tasks WHERE deletedAt IS NULL").first?["id"] as? String)
        _ = try rows("UPDATE tasks SET title = ?, rev = rev + 1, updatedAt = ? WHERE id = ?", ["Later CSV edit", "2037-01-01T00:00:00.000Z", imported])
        let before = try json(rows("SELECT * FROM tasks ORDER BY id"))
        let reopened = host(); let startup = try object(await reopened.start())
        let recovery = try XCTUnwrap(startup["recovery"] as? [String: Any])
        XCTAssertEqual(recovery["method"] as? String, "backupDocumentCommit")
        XCTAssertEqual(try json(rows("SELECT * FROM tasks ORDER BY id")), before)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        XCTAssertEqual(try rows("SELECT id FROM tasks WHERE deletedAt IS NULL").count, 1)
    }

    func testCSVZipBinaryInputAndReimportSkipExistingIDs() async throws {
        let core = host(); _ = try await core.start()
        let url = root.appendingPathComponent("tasks.zip")
        let bytes = try XCTUnwrap(Data(base64Encoded: "UEsDBBQAAAAIAIeDRF2RWUdxQAAAAEEAAAAJAAAAdGFza3MuY3N2C8ksyUnVCS5JLCkt1nFJLU4uyiwoyczP41JyDg5TqMosUPgwf1mnkk5eakWJjpJPZl6qQn5eKheYUVKer8QFAFBLAQIUAxQAAAAIAIeDRF2RWUdxQAAAAEEAAAAJAAAAAAAAAAAAAACAAQAAAAB0YXNrcy5jc3ZQSwUGAAAAAAEAAQA3AAAAZwAAAAAA"))
        try bytes.write(to: url)
        let preview = try await core.prepareBackupImport(url, action: .csv)
        XCTAssertEqual(try object(preview.json)["valid"] as? Bool, true)
        let imported = try object(await core.mergeBackupImport(preview.id))
        XCTAssertEqual((imported["result"] as? [String: Any])?["importedTaskCount"] as? Int, 1)
        let task = try XCTUnwrap(rows("SELECT * FROM tasks WHERE deletedAt IS NULL").first)
        XCTAssertEqual(task["title"] as? String, "CSV zip 🦉")
        XCTAssertEqual(task["description"] as? String, "Line one\nLine two")
        let export = try await core.prepareDataBackup(format: .csv)
        let replayURL = root.appendingPathComponent("replay.csv")
        try Data(contentsOf: export.url).write(to: replayURL)
        let ownCsv = try await core.prepareBackupImport(export.url, action: .csv)
        await core.discardDataBackup(export.id)
        let repeated = try object(await core.mergeBackupImport(ownCsv.id))
        XCTAssertEqual((repeated["result"] as? [String: Any])?["importedTaskCount"] as? Int, 0)
        XCTAssertEqual(try rows("SELECT id FROM tasks WHERE deletedAt IS NULL").count, 1)
        let id = try XCTUnwrap(task["id"] as? String)
        XCTAssertEqual(try rows("SELECT title, description FROM tasks WHERE id = ?", [id]).first?["description"] as? String, "Line one\nLine two")
        let roster = try await snapshots(core)
        let original = try XCTUnwrap(roster.first { $0["name"] as? String == imported["snapshotName"] as? String })
        _ = try await core.restoreBackupSnapshot(json(original))
        let deletedCSV = try await core.prepareBackupImport(replayURL, action: .csv)
        let deletedResult = try await core.mergeBackupImport(deletedCSV.id)
        let deletedReply = try object(deletedResult)
        XCTAssertEqual((deletedReply["result"] as? [String: Any])?["importedTaskCount"] as? Int, 0)
        XCTAssertEqual(try rows("SELECT id FROM tasks WHERE deletedAt IS NULL").count, 0)
        let model = try object(await core.backupDocumentResultModel(deletedResult))
        XCTAssertTrue((model["message"] as? String ?? "").contains("previously imported or deleted"))
    }

    func testReplacementCommitAcknowledgmentLossPreservesLaterEdits() async throws {
        let faults = HostIOFaults(); let core = host(faults); _ = try await core.start()
        let (url, imported) = try await source(core)
        let preview = try await core.prepareBackupImport(url, action: .replace)
        var lost = false
        faults.afterSQL = { sql in
            if sql.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() == "COMMIT", !lost {
                lost = true; throw HostFailure("Injected committed acknowledgment loss")
            }
        }
        await failure { _ = try await core.mergeBackupImport(preview.id) }
        XCTAssertTrue(lost)
        XCTAssertEqual(try rows("SELECT id FROM tasks WHERE id = ?", [imported]).count, 1)
        await core.close()
        _ = try rows("UPDATE tasks SET title = ?, rev = rev + 1 WHERE id = ?", ["Edited after lost COMMIT reply", imported])
        let before = try json(rows("SELECT * FROM tasks ORDER BY id"))
        let reopened = host(); _ = try await reopened.start()
        XCTAssertEqual(try json(rows("SELECT * FROM tasks ORDER BY id")), before)
        let roster = try await snapshots(reopened); XCTAssertEqual(roster.count, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testReplacementRejectsConcurrentExternalWrite() async throws {
        let faults = HostIOFaults(); let core = host(faults); _ = try await core.start()
        let local = try await capture(core, "Before import")
        let (url, imported) = try await source(core)
        let preview = try await core.prepareBackupImport(url, action: .replace)
        var changed = false
        faults.beforeSQL = { sql in
            if sql.trimmingCharacters(in: .whitespacesAndNewlines).uppercased().hasPrefix("BEGIN"), !changed {
                changed = true
                _ = try self.rows("UPDATE tasks SET title = ?, rev = rev + 1 WHERE id = ?", ["External edit wins", local])
            }
        }
        do { _ = try await core.mergeBackupImport(preview.id); XCTFail("Stale merge must refuse") }
        catch { XCTAssertTrue(error is CoreHostRejection, String(describing: error)) }
        XCTAssertTrue(changed)
        XCTAssertTrue(try rows("SELECT id FROM tasks WHERE id = ?", [imported]).isEmpty)
        XCTAssertEqual(try rows("SELECT title FROM tasks WHERE id = ?", [local]).first?["title"] as? String, "External edit wins")
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        faults.beforeSQL = nil
        let roster = try await snapshots(core); XCTAssertTrue(roster.isEmpty)
    }

    func testReplacementInspectionCancelAndInvalidInputDoNotWrite() async throws {
        let core = host(); _ = try await core.start()
        _ = try await capture(core, "Existing")
        let (url, _) = try await source(core)
        let before = try json(rows("SELECT * FROM tasks ORDER BY id"))
        let preview = try await core.prepareBackupImport(url, action: .replace)
        XCTAssertEqual(try object(preview.json)["valid"] as? Bool, true)
        XCTAssertEqual(try json(rows("SELECT * FROM tasks ORDER BY id")), before)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        let initial = try await snapshots(core); XCTAssertTrue(initial.isEmpty)
        await core.discardBackupImport(preview.id)
        await failure { _ = try await core.mergeBackupImport(preview.id) }
        try "{invalid".write(to: url, atomically: true, encoding: .utf8)
        let invalid = try await core.prepareBackupImport(url, action: .replace)
        XCTAssertEqual(try object(invalid.json)["valid"] as? Bool, false)
        XCTAssertEqual(try json(rows("SELECT * FROM tasks ORDER BY id")), before)
        let final = try await snapshots(core); XCTAssertTrue(final.isEmpty)
    }


    func testSelectedReplacementOwnsBytesAndFreshSnapshotUndoSurvivesRestart() async throws {
        let core = host(); _ = try await core.start()
        let before = try await capture(core, "Before replacement preview")
        let (url, imported) = try await source(core)
        let preview = try await core.prepareBackupImport(url, action: .replace)
        XCTAssertEqual(preview.action, .replace)
        let confirmation = try object(preview.json)
        XCTAssertEqual(confirmation["valid"] as? Bool, true)
        XCTAssertTrue((confirmation["summary"] as? String ?? "").contains("replace"))
        let during = try await capture(core, "Before replacement confirmation")
        try "Provider changed after preview".write(to: url, atomically: true, encoding: .utf8)
        let reply = try object(await core.mergeBackupImport(preview.id))
        XCTAssertEqual(reply["operation"] as? String, "replace")
        XCTAssertEqual(reply["added"] as? Int, 0)
        XCTAssertEqual(reply["updated"] as? Int, 0)
        XCTAssertEqual(Set(try rows("SELECT id FROM tasks WHERE deletedAt IS NULL").compactMap { $0["id"] as? String }), [imported])
        for id in [before, during] {
            XCTAssertNotNil(try rows("SELECT deletedAt FROM tasks WHERE id = ?", [id]).first?["deletedAt"] as? String)
        }
        let model = try object(await core.backupDocumentResultModel(json(reply)))
        XCTAssertFalse((model["undoLabel"] as? String ?? "").isEmpty)
        let roster = try await snapshots(core); XCTAssertEqual(roster.count, 1)
        let reference = try json(XCTUnwrap(roster.first))
        let later = try await capture(core, "Later replacement edit undone")
        await core.close()
        let reopened = host(); _ = try await reopened.start()
        let undo = try object(await reopened.restoreBackupSnapshot(reference))
        XCTAssertEqual(undo["operation"] as? String, "restore")
        let live = Set(try rows("SELECT id FROM tasks WHERE deletedAt IS NULL").compactMap { $0["id"] as? String })
        XCTAssertEqual(live, [before, during])
        for id in [imported, later] {
            XCTAssertNotNil(try rows("SELECT deletedAt FROM tasks WHERE id = ?", [id]).first?["deletedAt"] as? String)
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        await reopened.close()
        let cold = host(); _ = try await cold.start()
        XCTAssertEqual(Set(try rows("SELECT id FROM tasks WHERE deletedAt IS NULL").compactMap { $0["id"] as? String }), live)
    }


    func testTodoistUsesSharedPolicyOwnedCSVAndColdSnapshotUndo() async throws {
        let core = host(); _ = try await core.start()
        let local = try await capture(core, "Existing before Todoist")
        let url = root.appendingPathComponent("Launch.csv")
        let csv = "TYPE,CONTENT,PRIORITY,INDENT,DATE,DESCRIPTION\nsection,Planning,,,,\ntask,Plan launch @work,1,1,2035-04-02,Write launch brief\nnote,Share with leadership,,,,\ntask,Follow up @ops,4,2,2035-04-03,Check dependencies\ntask,Weekly review @home,2,1,every Monday,\n"
        try csv.write(to: url, atomically: true, encoding: .utf8)
        let preview = try await core.prepareBackupImport(url, action: .todoist)
        XCTAssertEqual(preview.action, .todoist)
        XCTAssertEqual(try object(preview.json)["valid"] as? Bool, true)
        let during = try await capture(core, "After Todoist preview")
        try "Changed provider bytes".write(to: url, atomically: true, encoding: .utf8)
        let reply = try object(await core.mergeBackupImport(preview.id))
        XCTAssertEqual(reply["operation"] as? String, "todoist")
        let result = try XCTUnwrap(reply["result"] as? [String: Any])
        XCTAssertEqual(Set(result.keys), ["importedTaskCount", "importedProjectCount", "importedSectionCount", "importedChecklistItemCount", "warnings"])
        XCTAssertEqual(result["importedTaskCount"] as? Int, 2)
        XCTAssertEqual(result["importedProjectCount"] as? Int, 1)
        XCTAssertEqual(result["importedSectionCount"] as? Int, 1)
        XCTAssertEqual(result["importedChecklistItemCount"] as? Int, 1)
        let task = try XCTUnwrap(rows("SELECT * FROM tasks WHERE title = ?", ["Plan launch"]).first)
        XCTAssertEqual(task["status"] as? String, "next")
        XCTAssertEqual(task["dueDate"] as? String, "2035-04-02")
        XCTAssertTrue((task["description"] as? String ?? "").contains("Share with leadership"))
        let checklist = try XCTUnwrap(NativeJSON.jsonObject(with: Data((task["checklist"] as? String ?? "").utf8)) as? [[String: Any]])
        XCTAssertEqual(checklist.count, 1)
        let model = try object(await core.backupDocumentResultModel(json(reply)))
        XCTAssertFalse((model["undoLabel"] as? String ?? "").isEmpty)
        try csv.write(to: url, atomically: true, encoding: .utf8)
        let repeatedPreview = try await core.prepareBackupImport(url, action: .todoist)
        let repeated = try object(await core.mergeBackupImport(repeatedPreview.id))
        XCTAssertEqual((repeated["result"] as? [String: Any])?["importedTaskCount"] as? Int, 0)
        XCTAssertEqual(try rows("SELECT id FROM tasks WHERE deletedAt IS NULL").count, 4)
        let roster = try await snapshots(core)
        let original = try XCTUnwrap(roster.first { $0["name"] as? String == reply["snapshotName"] as? String })
        await core.close()
        let reopened = host(); _ = try await reopened.start()
        _ = try await reopened.restoreBackupSnapshot(json(original))
        await reopened.close()
        let cold = host(); _ = try await cold.start()
        XCTAssertEqual(Set(try rows("SELECT id FROM tasks WHERE deletedAt IS NULL").compactMap { $0["id"] as? String }), [local, during])
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testTodoistLostAcknowledgmentColdReplayKeepsLaterEdits() async throws {
        let faults = HostIOFaults(); let core = host(faults); _ = try await core.start()
        let url = root.appendingPathComponent("Tasks.csv")
        try "TYPE,CONTENT\ntask,Todoist once\n".write(to: url, atomically: true, encoding: .utf8)
        let preview = try await core.prepareBackupImport(url, action: .todoist)
        var writes = 0
        faults.journalWrite = { writes += 1; if writes == 2 { throw HostFailure("Injected Todoist lost reply") } }
        await failure { _ = try await core.mergeBackupImport(preview.id) }
        XCTAssertTrue(FileManager.default.fileExists(atPath: journal.path))
        await core.close()
        let id = try XCTUnwrap(rows("SELECT id FROM tasks WHERE deletedAt IS NULL").first?["id"] as? String)
        _ = try rows("UPDATE tasks SET title = ?, rev = rev + 1, updatedAt = ? WHERE id = ?", ["Later Todoist edit", "2037-01-01T00:00:00.000Z", id])
        let before = try json(rows("SELECT * FROM tasks ORDER BY id"))
        let reopened = host(); _ = try await reopened.start()
        XCTAssertEqual(try json(rows("SELECT * FROM tasks ORDER BY id")), before)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testTodoistZIPPreviewCancelAndImport() async throws {
        let core = host(); _ = try await core.start()
        _ = try await capture(core, "Todoist ZIP baseline")
        let url = root.appendingPathComponent("todoist.zip")
        try XCTUnwrap(Data(base64Encoded: "UEsDBBQAAAAIAJKJRF0HhfoMKwAAACgAAAALAAAAV2Vla2VuZC5jc3YLiQxw1XH29wtx9QvhKkksztYJyU/JzywuUYjyDFB4Nn3pszlrXqyaxwUAUEsBAhQDFAAAAAgAkolEXQeF+gwrAAAAKAAAAAsAAAAAAAAAAAAAAIABAAAAAFdlZWtlbmQuY3N2UEsFBgAAAAABAAEAOQAAAFQAAAAAAA==" )).write(to: url)
        let before = try json(rows("SELECT * FROM tasks ORDER BY id"))
        let preview = try await core.prepareBackupImport(url, action: .todoist)
        XCTAssertEqual(try object(preview.json)["valid"] as? Bool, true)
        await core.discardBackupImport(preview.id)
        await failure { _ = try await core.mergeBackupImport(preview.id) }
        XCTAssertEqual(try json(rows("SELECT * FROM tasks ORDER BY id")), before)
        let initial = try await snapshots(core); XCTAssertTrue(initial.isEmpty)
        let accepted = try await core.prepareBackupImport(url, action: .todoist)
        let reply = try object(await core.mergeBackupImport(accepted.id))
        XCTAssertEqual((reply["result"] as? [String: Any])?["importedTaskCount"] as? Int, 1)
        XCTAssertEqual(try rows("SELECT title FROM tasks WHERE title = ?", ["Todoist ZIP 日本語"]).count, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }
    func testTickTickUsesSharedPolicyOwnedCSVAndColdSnapshotUndo() async throws {
        let core = host(); _ = try await core.start()
        let local = try await capture(core, "Existing before TickTick")
        let url = root.appendingPathComponent("TickTick.csv")
        let csv = "Folder Name,List Name,Title,Content,Due Date,Is All Day,Repeat,Tags,Status,taskId,parentId\nWork,Launch,Task207 plan release,Write launch brief,2035-04-02,true,FREQ=WEEKLY;BYDAY=MO,#work,0,100,\nWork,Launch,Task207 follow up,Check dependencies,,,,#ops,1,101,100\nWork,Launch,Task207 review,,,,,,0,102,\n"
        try csv.write(to: url, atomically: true, encoding: .utf8)
        let preview = try await core.prepareBackupImport(url, action: .ticktick)
        XCTAssertEqual(preview.action, .ticktick)
        XCTAssertEqual(try object(preview.json)["valid"] as? Bool, true)
        let during = try await capture(core, "After TickTick preview")
        try "Changed provider bytes".write(to: url, atomically: true, encoding: .utf8)
        let reply = try object(await core.mergeBackupImport(preview.id))
        XCTAssertEqual(reply["operation"] as? String, "ticktick")
        let result = try XCTUnwrap(reply["result"] as? [String: Any])
        XCTAssertEqual(Set(result.keys), ["importedAreaCount", "importedTaskCount", "importedProjectCount", "importedSectionCount", "importedChecklistItemCount", "warnings"])
        XCTAssertEqual(result["importedTaskCount"] as? Int, 2)
        XCTAssertEqual(result["importedProjectCount"] as? Int, 1)
        XCTAssertEqual(result["importedAreaCount"] as? Int, 1)
        XCTAssertEqual(result["importedSectionCount"] as? Int, 0)
        XCTAssertEqual(result["importedChecklistItemCount"] as? Int, 1)
        XCTAssertFalse((result["warnings"] as? [String] ?? []).isEmpty)
        let task = try XCTUnwrap(rows("SELECT * FROM tasks WHERE title = ?", ["Task207 plan release"]).first)
        XCTAssertEqual(task["status"] as? String, "next")
        XCTAssertEqual(task["dueDate"] as? String, "2035-04-02")
        XCTAssertTrue((task["description"] as? String ?? "").contains("Check dependencies"))
        let recurrence = try XCTUnwrap(NativeJSON.jsonObject(with: Data((task["recurrence"] as? String ?? "").utf8)) as? [String: Any])
        XCTAssertEqual(recurrence["rule"] as? String, "weekly")
        let checklist = try XCTUnwrap(NativeJSON.jsonObject(with: Data((task["checklist"] as? String ?? "").utf8)) as? [[String: Any]])
        XCTAssertEqual(checklist.count, 1)
        XCTAssertEqual(checklist.first?["isCompleted"] as? Bool, true)
        let model = try object(await core.backupDocumentResultModel(json(reply)))
        XCTAssertFalse((model["undoLabel"] as? String ?? "").isEmpty)
        try csv.write(to: url, atomically: true, encoding: .utf8)
        let repeatedPreview = try await core.prepareBackupImport(url, action: .ticktick)
        let repeated = try object(await core.mergeBackupImport(repeatedPreview.id))
        XCTAssertEqual((repeated["result"] as? [String: Any])?["importedTaskCount"] as? Int, 0)
        XCTAssertEqual(try rows("SELECT id FROM tasks WHERE deletedAt IS NULL").count, 4)
        let roster = try await snapshots(core)
        let original = try XCTUnwrap(roster.first { $0["name"] as? String == reply["snapshotName"] as? String })
        await core.close()
        let reopened = host(); _ = try await reopened.start()
        _ = try await reopened.restoreBackupSnapshot(json(original))
        await reopened.close()
        let cold = host(); _ = try await cold.start()
        XCTAssertEqual(Set(try rows("SELECT id FROM tasks WHERE deletedAt IS NULL").compactMap { $0["id"] as? String }), [local, during])
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testTickTickLostAcknowledgmentColdReplayKeepsLaterEdits() async throws {
        let faults = HostIOFaults(); let core = host(faults); _ = try await core.start()
        let url = root.appendingPathComponent("Tasks.csv")
        try "List Name,Title\nLaunch,TickTick once\n".write(to: url, atomically: true, encoding: .utf8)
        let preview = try await core.prepareBackupImport(url, action: .ticktick)
        var writes = 0
        faults.journalWrite = { writes += 1; if writes == 2 { throw HostFailure("Injected TickTick lost reply") } }
        await failure { _ = try await core.mergeBackupImport(preview.id) }
        XCTAssertTrue(FileManager.default.fileExists(atPath: journal.path))
        await core.close()
        let id = try XCTUnwrap(rows("SELECT id FROM tasks WHERE deletedAt IS NULL").first?["id"] as? String)
        _ = try rows("UPDATE tasks SET title = ?, rev = rev + 1, updatedAt = ? WHERE id = ?", ["Later TickTick edit", "2037-01-01T00:00:00.000Z", id])
        let before = try json(rows("SELECT * FROM tasks ORDER BY id"))
        let reopened = host(); _ = try await reopened.start()
        XCTAssertEqual(try json(rows("SELECT * FROM tasks ORDER BY id")), before)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testTickTickZIPPreviewCancelAndImport() async throws {
        let core = host(); _ = try await core.start()
        _ = try await capture(core, "TickTick ZIP baseline")
        let url = root.appendingPathComponent("ticktick.zip")
        try XCTUnwrap(Data(base64Encoded: "UEsDBBQAAAAIAOGNRF2TwL8wLgAAAC8AAAALAAAAV2Vla2VuZC5jc3bzySwuUfBLzE3VCcksyUnlCk9NzU7NSwHykrNBWCHKM0Dh2fSlz+asebFqHhcAUEsBAhQDFAAAAAgA4Y1EXZPAvzAuAAAALwAAAAsAAAAAAAAAAAAAAIABAAAAAFdlZWtlbmQuY3N2UEsFBgAAAAABAAEAOQAAAFcAAAAAAA==")).write(to: url)
        let before = try json(rows("SELECT * FROM tasks ORDER BY id"))
        let preview = try await core.prepareBackupImport(url, action: .ticktick)
        XCTAssertEqual(try object(preview.json)["valid"] as? Bool, true)
        await core.discardBackupImport(preview.id)
        await failure { _ = try await core.mergeBackupImport(preview.id) }
        XCTAssertEqual(try json(rows("SELECT * FROM tasks ORDER BY id")), before)
        let initial = try await snapshots(core); XCTAssertTrue(initial.isEmpty)
        let accepted = try await core.prepareBackupImport(url, action: .ticktick)
        let reply = try object(await core.mergeBackupImport(accepted.id))
        XCTAssertEqual((reply["result"] as? [String: Any])?["importedTaskCount"] as? Int, 1)
        XCTAssertEqual(try rows("SELECT title FROM tasks WHERE title = ?", ["TickTick ZIP 日本語"]).count, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testTickTickOversizedWarningsKeepLocalizedReasonBeforeJournalOrSnapshot() async throws {
        let core = host(); _ = try await core.start()
        _ = try await capture(core, "TickTick capacity baseline")
        let exported = try await core.prepareDataBackup()
        var document = try object(String(contentsOf: exported.url, encoding: .utf8))
        await core.discardDataBackup(exported.id)
        let names = (0..<40).map { "Project\($0)-" + String(repeating: "A", count: 1000) }
        document["projects"] = names.map { ["id": UUID().uuidString.lowercased(), "title": $0,
            "status": "active", "color": "#94a3b8", "createdAt": "2026-01-01T00:00:00.000Z",
            "updatedAt": "2026-01-01T00:00:00.000Z", "rev": 1] as [String: Any] }
        let baselineURL = root.appendingPathComponent("baseline.json")
        try json(document).write(to: baselineURL, atomically: true, encoding: .utf8)
        let baseline = try await core.prepareBackupImport(baselineURL)
        _ = try await core.mergeBackupImport(baseline.id)
        let beforeTasks = try json(rows("SELECT * FROM tasks ORDER BY id"))
        let beforeProjects = try json(rows("SELECT * FROM projects ORDER BY id"))
        let beforeSnapshots = try await core.listBackupSnapshots()
        let url = root.appendingPathComponent("ticktick-large-result.csv")
        let csv = "List Name,Title,taskId\n" + names.enumerated().map { "\($0.element),Imported,\($0.offset)" }.joined(separator: "\n")
        try csv.write(to: url, atomically: true, encoding: .utf8)
        let preview = try await core.prepareBackupImport(url, action: .ticktick)
        XCTAssertEqual(try object(preview.json)["valid"] as? Bool, true)
        do {
            _ = try await core.mergeBackupImport(preview.id)
            XCTFail("Expected bounded TickTick result refusal")
        } catch {
            XCTAssertEqual(error.localizedDescription, "INVALID_INPUT: TickTick import result exceeds 64 KiB")
        }
        XCTAssertEqual(try json(rows("SELECT * FROM tasks ORDER BY id")), beforeTasks)
        XCTAssertEqual(try json(rows("SELECT * FROM projects ORDER BY id")), beforeProjects)
        let afterSnapshots = try await core.listBackupSnapshots()
        XCTAssertEqual(afterSnapshots, beforeSnapshots)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

}
