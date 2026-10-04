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
}
