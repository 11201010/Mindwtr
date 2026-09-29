import XCTest
import JavaScriptCore
import Darwin
import SQLite3
@testable import MindwtrNativeCore

final class CoreHostTests: XCTestCase {
    private var directory: URL!
    private var bundle: URL!
    private var database: URL { directory.appendingPathComponent("core.sqlite") }
    private var journal: URL { database.appendingPathExtension("pending.json") }

    override func setUpWithError() throws {
        guard let path = ProcessInfo.processInfo.environment["MINDWTR_CORE_BUNDLE"] else {
            throw XCTSkip("Build core-host.js and set MINDWTR_CORE_BUNDLE to its absolute path")
        }
        bundle = URL(fileURLWithPath: path)
        directory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".mindwtr-native-tests/\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        if let directory { try FileManager.default.removeItem(at: directory) }
    }

    private func host(_ faults: HostIOFaults = HostIOFaults(), bundleURL: URL? = nil) -> CoreHost {
        let host = CoreHost(databaseURL: database, bundleURL: bundleURL ?? bundle, faults: faults)
        addTeardownBlock { await host.close() }
        return host
    }

    private func json(_ object: Any) throws -> String {
        String(decoding: try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]), as: UTF8.self)
    }

    private func object(_ text: String) throws -> [String: Any] {
        try XCTUnwrap(NativeJSON.jsonObject(with: Data(text.utf8)) as? [String: Any])
    }

    private func storedTask(_ id: String) throws -> [String: Any] {
        let sqlite = try SQLiteBridge(url: database)
        defer { sqlite.close() }
        let rows = try JSONSerialization.jsonObject(with: Data(sqlite.execute("SELECT * FROM tasks WHERE id = ?", parametersJSON: json([id])).utf8)) as? [[String: Any]]
        return try XCTUnwrap(rows?.first)
    }

    private func seedDestinationTask() async throws -> String {
        let writer = host()
        _ = try await writer.start()
        let id = UUID().uuidString.lowercased()
        _ = try await writer.call("captureSubmit", argumentsJSON: capture(writer, title: "Destination task", id: id))
        await writer.close()
        let sqlite = try SQLiteBridge(url: database)
        defer { sqlite.close() }
        let at = "2026-01-01T12:00:00.000Z"
        for (area, name, order, deleted) in [("destination-area-a", "Alpha area", 0, false),
                                             ("destination-area-b", "Beta area", 1, false),
                                             ("destination-area-deleted", "Deleted area", 2, true)] {
            _ = try sqlite.execute("INSERT OR IGNORE INTO areas (id, name, orderNum, createdAt, updatedAt, deletedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json([area, name, order, at, at, deleted ? at as Any : NSNull(), 1]))
        }
        for (project, title, area, status, deleted) in [
            ("destination-project-a", "Alpha project", "destination-area-a", "active", false),
            ("destination-project-b", "Beta project", "destination-area-b", "active", false),
            ("destination-project-archived", "Archived project", "destination-area-a", "archived", false),
            ("destination-project-deleted", "Deleted project", "destination-area-a", "active", true),
        ] {
            _ = try sqlite.execute("INSERT OR IGNORE INTO projects (id, title, status, color, areaId, isSequential, isFocused, createdAt, updatedAt, deletedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json([project, title, status, "#94a3b8", area, 0, 0, at, at, deleted ? at as Any : NSNull(), 1]))
        }
        for (section, project, title, deleted) in [
            ("destination-section-a", "destination-project-a", "Alpha section", false),
            ("destination-section-b", "destination-project-b", "Beta section", false),
            ("destination-section-deleted", "destination-project-a", "Deleted section", true),
        ] {
            _ = try sqlite.execute("INSERT OR IGNORE INTO sections (id, projectId, title, orderNum, isCollapsed, createdAt, updatedAt, deletedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json([section, project, title, 0, 0, at, at, deleted ? at as Any : NSNull(), 1]))
        }
        _ = try sqlite.execute("UPDATE tasks SET status = 'next', projectId = ?, sectionId = ?, areaId = NULL, description = ?, dueDate = ?, startTime = ?, checklist = ?, attachments = ?, tags = ?, contexts = ?, priority = ?, energyLevel = ?, timeEstimate = ?, orderNum = ? WHERE id = ?",
                               parametersJSON: json(["destination-project-a", "destination-section-a", "Keep destination note", "2036-10-02", "2036-10-01T14:30:00.000Z",
                                                     json([["id": "keep-step", "title": "Keep checklist", "isCompleted": false]]),
                                                     json([["id": "keep-file", "kind": "file", "title": "Keep attachment", "uri": "file:///retained.txt", "createdAt": at, "updatedAt": at]]),
                                                     json(["#keep"]), json(["@desk"]), "high", "low", "15min", 37, id]))
        _ = try sqlite.execute("INSERT INTO tasks (id, title, status, projectId, tags, contexts, isFocusedToday, showFutureRecurrence, suppressMindwtrReminders, pushCount, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json([id + "-protected", "Protected destination", "reference", "destination-project-archived", "[]", "[]", 0, 0, 0, 0, at, at, 1]))
        return id
    }

    private func destinationPreservedFields(_ row: [String: Any]) throws -> String {
        let changed: Set<String> = ["projectId", "sectionId", "areaId", "rev", "revBy", "updatedAt"]
        var fields = row.filter { !changed.contains($0.key) }
        // Compare every nested JSON value while retaining exact scalar/date values.
        for name in ["checklist", "attachments"] {
            if let encoded = fields[name] as? String {
                fields[name] = try JSONSerialization.jsonObject(with: Data(encoded.utf8))
            }
        }
        return try json(fields)
    }

    private func tokenPreservedFields(_ row: [String: Any]) throws -> String {
        let changed: Set<String> = ["contexts", "tags", "rev", "revBy", "updatedAt"]
        var fields = row.filter { !changed.contains($0.key) }
        for name in ["checklist", "attachments"] {
            if let encoded = fields[name] as? String {
                fields[name] = try JSONSerialization.jsonObject(with: Data(encoded.utf8))
            }
        }
        return try json(fields)
    }

    private func datePayload(_ id: String, editor: [String: Any], patch: [String: Any]) throws -> String {
        let draft = try XCTUnwrap(editor["draft"] as? [String: Any])
        let base = Dictionary(uniqueKeysWithValues: patch.keys.map { ($0, draft[$0] ?? NSNull()) })
        return try json([json(["id": id, "base": base, "patch": patch, "scheduleBase": try XCTUnwrap(editor["scheduleBase"])])])
    }

    private func datePreservedFields(_ row: [String: Any], excluding changed: Set<String> = ["startTime", "dueDate", "reviewAt", "relativeStartOffset", "pushCount", "rev", "revBy", "updatedAt"]) throws -> String {
        var fields = row.filter { !changed.contains($0.key) }
        for name in ["checklist", "attachments"] {
            if let encoded = fields[name] as? String { fields[name] = try JSONSerialization.jsonObject(with: Data(encoded.utf8)) }
        }
        return try json(fields)
    }

    private let recurrenceFields = ["recurrence", "recurrenceStrategy", "recurrenceRRule", "showFutureRecurrence"]

    private func recurrenceRequest(_ id: String, opening: [String: Any], edited: [String: Any], dates: [String: Any] = [:]) throws -> [String: Any] {
        let original = try XCTUnwrap(opening["draft"] as? [String: Any])
        let current = try XCTUnwrap(edited["draft"] as? [String: Any])
        var patch = try Dictionary(uniqueKeysWithValues: recurrenceFields.map { ($0, try XCTUnwrap(current[$0])) })
        patch.merge(dates) { _, new in new }
        let base = try Dictionary(uniqueKeysWithValues: patch.keys.map { ($0, try XCTUnwrap(original[$0])) })
        return ["id": id, "base": base, "patch": patch,
                "scheduleBase": try XCTUnwrap(opening["scheduleBase"]),
                "recurrenceBase": try XCTUnwrap(opening["recurrenceBase"])]
    }

    private func recurrenceEdit(_ core: CoreHost, id: String, editor: [String: Any], action: [String: Any]) async throws -> [String: Any] {
        try object(await core.call("editDraft", argumentsJSON: json([json([
            "id": id, "draft": try XCTUnwrap(editor["draft"]), "edit": ["type": "recurrence", "edit": action],
        ])])))
    }

    private func taskCount() throws -> Int {
        let sqlite = try SQLiteBridge(url: database)
        defer { sqlite.close() }
        let rows = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(sqlite.execute("SELECT COUNT(*) AS count FROM tasks", parametersJSON: "[]").utf8)) as? [[String: Any]])
        return try XCTUnwrap(rows.first?["count"] as? Int)
    }

    private func pendingDraftCommit() throws -> [String: Any] {
        let saved = try object(String(contentsOf: journal))
        XCTAssertEqual(saved["method"] as? String, "draftCommit")
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(saved["argumentsJSON"] as? String).utf8)) as? [String])
        return try object(XCTUnwrap(args.first))
    }

    private func recurrenceComparableRow(_ row: [String: Any]) throws -> String {
        var comparable = row
        if let encoded = row["recurrence"] as? String {
            comparable["recurrence"] = try JSONSerialization.jsonObject(with: Data(encoded.utf8), options: [.fragmentsAllowed])
        }
        return try json(comparable)
    }

    private func dateBundle(at instant: String, rejectingPreparation: Bool = false, suffix: String = "") throws -> URL {
        let url = directory.appendingPathComponent("date-clock-\(UUID().uuidString).js")
        let clock = """
        (() => {
            const NativeDate = Date;
            const instant = NativeDate.parse('\(instant)');
            globalThis.Date = class extends NativeDate {
                constructor(...args) { super(...(args.length ? args : [instant])); }
                static now() { return instant; }
            };
        })();
        """
        let reject = rejectingPreparation ? "\nMindwtrHost.draftPrepare = function () { throw new Error('Replay must not prepare dates'); };" : ""
        try (clock + "\n" + String(contentsOf: bundle) + reject + "\n" + suffix).write(to: url, atomically: true, encoding: .utf8)
        return url
    }

    private func capture(_ host: CoreHost, title: String = "Capture from Swift", id: String = UUID().uuidString) async throws -> String {
        let opened = try object(await host.call("captureOpen"))
        return try json([json(["text": title, "options": XCTUnwrap(opened["options"]), "captureId": id, "openAfterSave": false])])
    }

    private func expectFailure(_ contains: String? = nil, _ work: () async throws -> Void) async {
        do { try await work(); XCTFail("Expected failure") }
        catch {
            if let contains { XCTAssertTrue(error.localizedDescription.contains(contains), error.localizedDescription) }
        }
    }

    func testCaptureCompleteAndReopen() async throws {
        let first = host()
        let empty = try object(await first.start())
        XCTAssertEqual(empty["total"] as? Int, 0)
        let id = UUID().uuidString
        let payload = try await capture(first, id: id)
        let saved = try object(await first.call("captureSubmit", argumentsJSON: payload))
        XCTAssertEqual(saved["kind"] as? String, "saved")
        XCTAssertEqual(saved["taskId"] as? String, id.lowercased())
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        await first.close()

        let second = host()
        let reopened = try object(await second.start())
        XCTAssertEqual(reopened["total"] as? Int, 1)
        await expectFailure("INVALID_INPUT") { _ = try await second.call("captureSubmit", argumentsJSON: payload) }
        let once = try object(await second.call("window", argumentsJSON: "[0,50,\"\"]"))
        XCTAssertEqual(once["total"] as? Int, 1)
        _ = try await second.call("complete", argumentsJSON: json([id.lowercased()]))
        await second.close()
        let third = host()
        let completed = try object(await third.start())
        XCTAssertEqual(completed["total"] as? Int, 0)
    }

    func testFailedCommitBlocksNewWorkAndExactRetryPersistsOnce() async throws {
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let payload = try await capture(core)
        faults.beforeSQL = { if $0.trimmingCharacters(in: .whitespacesAndNewlines) == "COMMIT" { throw HostFailure("Injected COMMIT failure") } }
        await expectFailure("SAVE_FAILED") { _ = try await core.call("captureSubmit", argumentsJSON: payload) }
        XCTAssertTrue(FileManager.default.fileExists(atPath: journal.path))
        let journaled = try object(String(contentsOf: journal))
        XCTAssertEqual(journaled["version"] as? Int, 2)
        XCTAssertEqual(journaled["method"] as? String, "captureCommit")
        await expectFailure("exact retry") { _ = try await core.call("captureOpen") }
        await expectFailure("SAVE_FAILED") { try await core.retryPending() }
        faults.beforeSQL = nil
        let retried = try await core.retryPending()
        let acknowledgment = try XCTUnwrap(retried)
        XCTAssertEqual(try object(acknowledgment)["kind"] as? String, "saved")
        let absent = try await core.retryPending()
        XCTAssertNil(absent)
        let saved = try object(await core.call("window", argumentsJSON: "[0,50,\"\"]"))
        XCTAssertEqual(saved["total"] as? Int, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        await core.close()
        let reopened = try object(await host().start())
        XCTAssertEqual(reopened["total"] as? Int, 1)
    }

    func testRestartReplaysBothUncommittedAndAcknowledgmentLostCaptures() async throws {
        for afterCommit in [false, true] {
            let faults = HostIOFaults()
            let core = host(faults)
            let initial = try object(await core.start())
            let expected = (initial["total"] as? Int ?? 0) + 1
            let payload = try await capture(core, title: afterCommit ? "Committed before lost reply" : "Pending before restart")
            if afterCommit {
                // SQLite committed; the journal clear failed before UI acknowledgment.
                faults.journalRemove = { throw HostFailure("Injected journal clear failure") }
            } else {
                faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected COMMIT failure") } }
            }
            await expectFailure { _ = try await core.call("captureSubmit", argumentsJSON: payload) }
            XCTAssertTrue(FileManager.default.fileExists(atPath: journal.path))
            await core.close()
            let reopened = host()
            let saved = try object(await reopened.start())
            XCTAssertEqual(saved["total"] as? Int, expected)
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            await reopened.close()
        }
    }

    func testPendingCompletionReplaysAfterRestart() async throws {
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let id = UUID().uuidString.lowercased()
        _ = try await core.call("captureSubmit", argumentsJSON: capture(core, id: id))
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected COMMIT failure") } }
        await expectFailure("SAVE_FAILED") { _ = try await core.call("complete", argumentsJSON: json([id])) }
        await core.close()
        let restored = try object(await host().start())
        XCTAssertEqual(restored["total"] as? Int, 0)
    }

    func testJournalFailureRunsNoCommandAndMalformedJournalFailsClosed() async throws {
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let payload = try await capture(core)
        var statements = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { throw HostFailure("Injected journal write failure") }
        await expectFailure("journal") { _ = try await core.call("captureSubmit", argumentsJSON: payload) }
        XCTAssertEqual(statements, 0)
        faults.journalWrite = nil
        try await core.retryPending()
        let saved = try object(await core.call("window", argumentsJSON: "[0,50,\"\"]"))
        XCTAssertEqual(saved["total"] as? Int, 1)
        await core.close()
        try Data("malformed".utf8).write(to: journal)
        let broken = host()
        await expectFailure { _ = try await broken.start() }
        await expectFailure("not ready") { _ = try await broken.call("complete", argumentsJSON: "[\"anything\"]") }
        XCTAssertEqual(try String(contentsOf: journal), "malformed")
    }

    func testValidationRejectionAllowsDraftEditing() async throws {
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let payload = try await capture(core, title: "")
        var journalWrites = 0
        var statements = 0
        faults.journalWrite = { journalWrites += 1 }
        faults.beforeSQL = { _ in statements += 1 }
        do { _ = try await core.call("captureSubmit", argumentsJSON: payload); XCTFail("Expected pure refusal") }
        catch { XCTAssertTrue(error is CoreHostRejection) }
        let lines = try await capture(core, title: "First task\nSecond task")
        let confirmation = try object(await core.call("captureSubmit", argumentsJSON: lines))
        XCTAssertEqual(confirmation["kind"] as? String, "confirmLines")
        let invalidDate = try await capture(core, title: "Task /due:whenever")
        let refusal = try object(await core.call("captureSubmit", argumentsJSON: invalidDate))
        XCTAssertEqual(refusal["kind"] as? String, "refused")
        XCTAssertEqual(journalWrites, 0)
        XCTAssertEqual(statements, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        _ = try await core.call("captureOpen")
    }

    func testTerminalCleanupRetryReturnsOriginalOutcomeWithoutReexecution() async throws {
        for rejected in [false, true] {
            let faults = HostIOFaults()
            var executions = 0
            faults.commandDiagnostic = { if $0 == (rejected ? "complete" : "quickCapture") { executions += 1 } }
            let core = host(faults)
            _ = try await core.start()
            let method = rejected ? "complete" : "captureSubmit"
            let payload = rejected ? try json(["missing-task"]) : try await capture(core, title: "Keep original acknowledgment")
            faults.journalRemove = { throw HostFailure("Injected cleanup failure") }
            await expectFailure("cleanup") { _ = try await core.call(method, argumentsJSON: payload) }
            XCTAssertEqual(executions, 1)
            let terminal = try object(String(contentsOf: journal))["terminal"] as? [String: Any]
            XCTAssertNotNil(terminal?[rejected ? "rejected" : "success"])
            faults.journalRemove = nil
            if rejected {
                do { _ = try await core.retryPending(); XCTFail("Expected known rejection") }
                catch {
                    XCTAssertTrue(error is CoreHostRejection)
                    XCTAssertTrue(error.localizedDescription.hasPrefix("TASK_NOT_FOUND:"))
                }
            } else {
                let retried = try await core.retryPending()
                let acknowledgment = try XCTUnwrap(retried)
                XCTAssertEqual(try object(acknowledgment)["kind"] as? String, "saved")
                let stored = try XCTUnwrap(terminal?["success"] as? [String: String])
                XCTAssertEqual(acknowledgment, stored["_0"])
            }
            XCTAssertEqual(executions, 1)
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            _ = try await core.call("captureOpen")
            let absent = try await core.retryPending()
            XCTAssertNil(absent)
            await core.close()
        }
    }

    func testTerminalCleanupAfterRestartNeverReexecutesSuccessOrRejection() async throws {
        for rejected in [false, true] {
            let faults = HostIOFaults()
            let core = host(faults)
            _ = try await core.start()
            let method = rejected ? "complete" : "captureSubmit"
            let payload = rejected ? try json(["missing-task"]) : try await capture(core, title: "Restart acknowledgment")
            faults.journalRemove = { throw HostFailure("Injected cleanup failure") }
            await expectFailure("cleanup") { _ = try await core.call(method, argumentsJSON: payload) }
            await core.close()
            let reopenFaults = HostIOFaults()
            var executions = 0
            reopenFaults.commandDiagnostic = { if $0 == (rejected ? "complete" : "quickCapture") { executions += 1 } }
            let reopened = host(reopenFaults)
            _ = try await reopened.start()
            XCTAssertEqual(executions, 0)
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            _ = try await reopened.call("captureOpen")
            let absent = try await reopened.retryPending()
            XCTAssertNil(absent)
            await reopened.close()
        }
    }

    func testTerminalPhaseWriteFailureKeepsKnownOutcomeInMemory() async throws {
        for rejected in [false, true] {
            let faults = HostIOFaults()
            var executions = 0
            var journalWrites = 0
            faults.commandDiagnostic = { if $0 == (rejected ? "complete" : "quickCapture") { executions += 1 } }
            let core = host(faults)
            _ = try await core.start()
            let method = rejected ? "complete" : "captureSubmit"
            let payload = rejected ? try json(["missing-task"]) : try await capture(core, title: "In-memory acknowledgment")
            faults.journalWrite = {
                journalWrites += 1
                if journalWrites == 2 { throw HostFailure("Injected terminal phase failure") }
            }
            await expectFailure("terminal phase") { _ = try await core.call(method, argumentsJSON: payload) }
            XCTAssertEqual(executions, 1)
            XCTAssertNil(try object(String(contentsOf: journal))["terminal"])
            faults.journalWrite = nil
            if rejected {
                do { _ = try await core.retryPending(); XCTFail("Expected known rejection") }
                catch { XCTAssertTrue(error is CoreHostRejection) }
            } else {
                let retried = try await core.retryPending()
                let acknowledgment = try XCTUnwrap(retried)
                XCTAssertEqual(try object(acknowledgment)["kind"] as? String, "saved")
            }
            XCTAssertEqual(executions, 1)
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            await core.close()
        }
    }

    func testUnrecordedRejectionStillFailsClosedAfterRestart() async throws {
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let payload = try json(["missing-task"])
        var writes = 0
        faults.journalWrite = {
            writes += 1
            if writes == 2 { throw HostFailure("Injected terminal phase failure") }
        }
        await expectFailure("terminal phase") { _ = try await core.call("complete", argumentsJSON: payload) }
        await core.close()
        let reopened = host()
        do { _ = try await reopened.start(); XCTFail("Unknown replay rejection must remain pending") }
        catch {
            XCTAssertFalse(error is CoreHostRejection)
            XCTAssertTrue(error.localizedDescription.hasPrefix("TASK_NOT_FOUND:"))
        }
        XCTAssertTrue(FileManager.default.fileExists(atPath: journal.path))
    }

    func testPreparedCommitIsPrivateAndOldRawJournalsFailClosed() async throws {
        let core = host()
        _ = try await core.start()
        let payload = try await capture(core)
        for method in ["capturePrepare", "captureCommit"] {
            await expectFailure("unavailable") { _ = try await core.call(method, argumentsJSON: payload) }
        }
        _ = try await core.call("captureSubmit", argumentsJSON: payload)
        await core.close()
        for command in [
            ["version": 1, "method": "captureSubmit", "argumentsJSON": payload] as [String: Any],
            ["version": 2, "method": "captureSubmit", "argumentsJSON": payload],
            ["version": 2, "method": "captureCommit", "argumentsJSON": "[\"{}\"]"],
        ] {
            let original = Data(try json(command).utf8)
            try original.write(to: journal)
            let mainBefore = try Data(contentsOf: database)
            let wal = URL(fileURLWithPath: database.path + "-wal")
            let walBefore = try Data(contentsOf: wal)
            await expectFailure { _ = try await host().start() }
            XCTAssertEqual(try Data(contentsOf: journal), original)
            XCTAssertEqual(try Data(contentsOf: database), mainBefore)
            XCTAssertEqual(try Data(contentsOf: wal), walBefore)
        }
    }

    func testPreparedReplayAcrossMidnightTimezoneAndSettingsUsesExactRowsAndResponse() async throws {
        let originalZone = NSTimeZone.default
        let originalTZ = getenv("TZ").map { String(cString: $0) }
        defer {
            if let originalTZ { setenv("TZ", originalTZ, 1) } else { unsetenv("TZ") }
            tzset()
            NSTimeZone.default = originalZone
        }
        func setZone(_ name: String) {
            setenv("TZ", name, 1)
            tzset()
            NSTimeZone.default = TimeZone(identifier: name)!
        }
        func bundleAt(_ date: String, rejectPreparation: Bool = false) throws -> URL {
            let url = directory.appendingPathComponent("clock-\(UUID().uuidString).js")
            let clock = """
            (() => {
                const NativeDate = Date;
                const instant = NativeDate.parse('\(date)');
                globalThis.Date = class extends NativeDate {
                    constructor(...args) { super(...(args.length ? args : [instant])); }
                    static now() { return instant; }
                };
            })();
            """
            let guardReplay = rejectPreparation ? "\nMindwtrHost.capturePrepare = function () { throw new Error('Replay must not prepare'); };" : ""
            try (clock + "\n" + String(contentsOf: bundle) + guardReplay).write(to: url, atomically: true, encoding: .utf8)
            return url
        }
        setZone("Pacific/Honolulu")
        let faults = HostIOFaults()
        let core = host(faults, bundleURL: try bundleAt("2026-09-26T23:50:00.000Z"))
        _ = try await core.start()
        let id = UUID().uuidString.lowercased()
        let opened = try object(await core.call("captureOpen"))
        var options = try XCTUnwrap(opened["options"] as? [String: Any])
        options["note"] = "Frozen note"
        options["addAnother"] = true
        options["startTime"] = "2026-10-01T14:30:00.000Z"
        let payload = try json([json(["text": "Review /due:tomorrow", "options": options, "captureId": id, "openAfterSave": false])])
        var writes = 0
        faults.journalWrite = {
            writes += 1
            if writes == 2 { throw HostFailure("Lost terminal phase acknowledgment") }
        }
        await expectFailure("terminal phase") { _ = try await core.call("captureSubmit", argumentsJSON: payload) }
        let savedJournal = try object(String(contentsOf: journal))
        XCTAssertNil(savedJournal["terminal"])
        let encoded = try XCTUnwrap(savedJournal["argumentsJSON"] as? String)
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(encoded.utf8)) as? [String])
        let commit = try object(args[0])
        let prepared = try XCTUnwrap(commit["prepared"] as? [String: Any])
        let task = try XCTUnwrap(prepared["task"] as? [String: Any])
        XCTAssertEqual(task["createdAt"] as? String, "2026-09-26T23:50:00.000Z")
        XCTAssertNotNil(task["dueDate"])
        let expectedResponse = try json(XCTUnwrap(prepared["result"]))
        await core.close()

        let sqlite = try SQLiteBridge(url: database)
        let before = try sqlite.execute("SELECT * FROM tasks WHERE id = ?", parametersJSON: json([id]))
        let settingsRows = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(sqlite.execute("SELECT data FROM settings WHERE id = 1").utf8)) as? [[String: Any]])
        var settings = try object(XCTUnwrap(settingsRows.first?["data"] as? String))
        settings["language"] = "de"
        settings["features"] = ["priorities": false]
        settings["gtd"] = ["defaultProjectFlowMode": "sequential"]
        _ = try sqlite.execute("UPDATE settings SET data = ? WHERE id = 1", parametersJSON: json([json(settings)]))
        sqlite.close()

        setZone("Pacific/Auckland")
        let reopenFaults = HostIOFaults()
        var taskWrites = 0
        var commits = 0
        reopenFaults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+tasks\b"#, options: .regularExpression) != nil { taskWrites += 1 }
        }
        reopenFaults.commandDiagnostic = { if $0 == "quickCapture" { commits += 1 } }
        reopenFaults.journalRemove = { throw HostFailure("Injected cleanup failure") }
        let reopened = host(reopenFaults, bundleURL: try bundleAt("2026-09-29T03:10:00.000Z", rejectPreparation: true))
        await expectFailure("cleanup") { _ = try await reopened.start() }
        let terminal = try XCTUnwrap(try object(String(contentsOf: journal))["terminal"] as? [String: Any])
        let success = try XCTUnwrap(terminal["success"] as? [String: String])
        XCTAssertEqual(try json(object(XCTUnwrap(success["_0"]))), expectedResponse)
        XCTAssertEqual(commits, 1)
        XCTAssertEqual(taskWrites, 0)
        let protected = try SQLiteBridge(url: database)
        let duringRecovery = try protected.execute("SELECT * FROM tasks WHERE id = ?", parametersJSON: json([id]))
        protected.close()
        XCTAssertEqual(try json(JSONSerialization.jsonObject(with: Data(before.utf8))), try json(JSONSerialization.jsonObject(with: Data(duringRecovery.utf8))))
        reopenFaults.journalRemove = nil
        _ = try await reopened.start()
        XCTAssertEqual(commits, 1)
        XCTAssertGreaterThan(taskWrites, 0)
        await reopened.close()
        let verify = try SQLiteBridge(url: database)
        let promoted = try verify.execute("SELECT * FROM tasks WHERE id = ?", parametersJSON: json([id]))
        verify.close()
        let rows = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(promoted.utf8)) as? [[String: Any]])
        XCTAssertEqual(rows.first?["status"] as? String, "next")
        XCTAssertEqual(rows.first?["rev"] as? Int, (task["rev"] as? Int ?? 0) + 1)
        XCTAssertEqual(rows.first?["updatedAt"] as? String, "2026-09-29T03:10:00.000Z")
        let settled = host(bundleURL: try bundleAt("2026-09-29T03:10:00.000Z", rejectPreparation: true))
        _ = try await settled.start()
        await settled.close()
        let final = try SQLiteBridge(url: database)
        let after = try final.execute("SELECT * FROM tasks WHERE id = ?", parametersJSON: json([id]))
        final.close()
        XCTAssertEqual(try json(JSONSerialization.jsonObject(with: Data(promoted.utf8))), try json(JSONSerialization.jsonObject(with: Data(after.utf8))))
    }

    func testCheckpointFailurePreventsSchemaWritesAndStartupCanRetry() async throws {
        let faults = HostIOFaults()
        var sqlCount = 0
        faults.beforeSQL = { _ in sqlCount += 1 }
        faults.checkpoint = { throw HostFailure("Injected checkpoint failure") }
        let core = host(faults)
        await expectFailure("checkpoint") { _ = try await core.start() }
        XCTAssertEqual(sqlCount, 0)
        await expectFailure("not ready") { _ = try await core.call("captureOpen") }
        faults.checkpoint = nil
        _ = try await core.start()
        XCTAssertGreaterThan(sqlCount, 0)
    }

    func testCorruptDatabaseAndPartialLoadBlockActivation() async throws {
        let core = host()
        _ = try await core.start()
        _ = try await core.call("captureSubmit", argumentsJSON: capture(core))
        await core.close()
        let faults = HostIOFaults()
        var interruptedRead = false
        faults.beforeSQL = { sql in
            if sql.contains("rowid as _rowid, * FROM tasks") {
                interruptedRead = true
                throw HostFailure("Injected incomplete read")
            }
        }
        let incomplete = host(faults)
        await expectFailure { _ = try await incomplete.start() }
        XCTAssertTrue(interruptedRead)
        await expectFailure("not ready") { _ = try await incomplete.call("complete", argumentsJSON: "[\"anything\"]") }
        await incomplete.close()
        let valid = host()
        let recovered = try object(await valid.start())
        XCTAssertEqual(recovered["total"] as? Int, 1)
        await valid.close()
        // A retained valid WAL can repair an overwritten main file. This case
        // intentionally has no usable recovery log; WAL preservation is tested separately.
        for suffix in ["-wal", "-shm"] {
            let sidecar = URL(fileURLWithPath: database.path + suffix)
            if FileManager.default.fileExists(atPath: sidecar.path) { try FileManager.default.removeItem(at: sidecar) }
        }
        try Data("not a SQLite database".utf8).write(to: database)
        await expectFailure("integrity") { _ = try await host().start() }
    }

    func testMalformedBundleAndConcurrentHostFailClosed() async throws {
        let invalid = directory.appendingPathComponent("bad.js")
        try Data("invalid javascript {".utf8).write(to: invalid)
        await expectFailure { _ = try await host(bundleURL: invalid).start() }
        XCTAssertFalse(FileManager.default.fileExists(atPath: database.appendingPathExtension("prewrite").path))
        let core = host()
        _ = try await core.start()
        await expectFailure("locked") { _ = try await host().start() }
        await expectFailure("unavailable") { _ = try await core.call("boot") }
    }

    func testPrewriteBackupIncludesCommittedWALAndCorruptCheckpointBlocksBoot() async throws {
        let source = try SQLiteBridge(url: database)
        _ = try source.execute("PRAGMA journal_mode = WAL")
        _ = try source.execute("PRAGMA wal_autocheckpoint = 0")
        _ = try source.execute("CREATE TABLE recovery_probe (value TEXT)")
        _ = try source.execute("INSERT INTO recovery_probe VALUES ('committed WAL value')")
        source.close()
        let wal = URL(fileURLWithPath: database.path + "-wal")
        let mainBefore = try Data(contentsOf: database)
        let walBefore = try Data(contentsOf: wal)
        XCTAssertFalse(walBefore.isEmpty)
        let checkpointURL = database.appendingPathExtension("prewrite")
        let writer = try SQLiteBridge(url: database)
        do { try writer.prepareRecovery(at: checkpointURL) }
        catch { writer.close(); throw error }
        writer.close()
        XCTAssertEqual(try Data(contentsOf: database), mainBefore)
        XCTAssertEqual(try Data(contentsOf: wal), walBefore)
        for suffix in ["-wal", "-shm"] {
            XCTAssertFalse(FileManager.default.fileExists(atPath: checkpointURL.path + suffix))
        }
        // Reopen through the host before any writable checkpoint inspection:
        // opening a WAL-header snapshot read/write would hide missing sidecars.
        let core = host()
        _ = try await core.start()
        await core.close()
        var checkpoint: OpaquePointer?
        XCTAssertEqual(sqlite3_open_v2(checkpointURL.path, &checkpoint, SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX, nil), SQLITE_OK)
        defer { if let checkpoint { sqlite3_close(checkpoint) } }
        for (sql, expected) in [("PRAGMA journal_mode", "delete"), ("PRAGMA quick_check", "ok"),
                                ("SELECT value FROM recovery_probe", "committed WAL value")] {
            var statement: OpaquePointer?
            XCTAssertEqual(sqlite3_prepare_v2(checkpoint, sql, -1, &statement, nil), SQLITE_OK)
            defer { sqlite3_finalize(statement) }
            XCTAssertEqual(sqlite3_step(statement), SQLITE_ROW)
            XCTAssertEqual(sqlite3_column_text(statement, 0).map { String(cString: $0) }, expected)
            XCTAssertEqual(sqlite3_step(statement), SQLITE_DONE)
        }
        sqlite3_close(checkpoint)
        checkpoint = nil
        try Data("corrupt checkpoint".utf8).write(to: checkpointURL)
        await expectFailure("integrity") { _ = try await host().start() }
    }

    func testFailedRecoveryPreservesLastConnectionMainAndWALBytes() async throws {
        let source = try SQLiteBridge(url: database)
        _ = try source.execute("PRAGMA journal_mode = WAL")
        _ = try source.execute("PRAGMA wal_autocheckpoint = 0")
        _ = try source.execute("CREATE TABLE recovery_probe (value TEXT)")
        _ = try source.execute("INSERT INTO recovery_probe VALUES ('uncheckpointed committed row')")
        source.close() // No other connection shields the source from teardown.
        let wal = URL(fileURLWithPath: database.path + "-wal")
        let shm = database.path + "-shm"
        let mainBefore = try Data(contentsOf: database)
        let walBefore = try Data(contentsOf: wal)
        XCTAssertFalse(walBefore.isEmpty)
        let shmBefore = FileManager.default.fileExists(atPath: shm)
        for corruptCheckpoint in [false, true] {
            let faults = HostIOFaults()
            var integrityRead = false
            faults.afterIntegrity = {
                integrityRead = true
                if !corruptCheckpoint { throw HostFailure("Injected failure after integrity read") }
            }
            if corruptCheckpoint { try Data("invalid checkpoint".utf8).write(to: database.appendingPathExtension("prewrite")) }
            await expectFailure { _ = try await host(faults).start() }
            XCTAssertTrue(integrityRead)
            XCTAssertEqual(try Data(contentsOf: database), mainBefore)
            XCTAssertEqual(try Data(contentsOf: wal), walBefore)
            XCTAssertEqual(FileManager.default.fileExists(atPath: shm), shmBefore)
        }
    }

    func testSearchUsesCoreFiltersAndHighlightsWithoutWrites() async throws {
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let activeID = UUID().uuidString.lowercased()
        let doneID = UUID().uuidString.lowercased()
        _ = try await core.call("captureSubmit", argumentsJSON: capture(core, title: "Café search active", id: activeID))
        _ = try await core.call("captureSubmit", argumentsJSON: capture(core, title: "Café search finished", id: doneID))
        _ = try await core.call("complete", argumentsJSON: json([doneID]))
        var writes = 0
        faults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT|UPDATE|DELETE|REPLACE)\b"#, options: .regularExpression) != nil { writes += 1 }
        }
        let initial = try object(await core.call("search", argumentsJSON: json([json([
            "query": "  Café search  ", "filters": NSNull(), "limit": 100,
        ])])))
        XCTAssertEqual(initial["query"] as? String, "Café search")
        let tasks = try XCTUnwrap(initial["tasks"] as? [[String: Any]])
        XCTAssertEqual(tasks.map { $0["id"] as? String }, [activeID])
        XCTAssertEqual(tasks.first?["inStore"] as? Bool, true)
        XCTAssertEqual((tasks.first?["tap"] as? [String: Any])?["kind"] as? String, "editor")
        XCTAssertFalse((tasks.first?["titleSegments"] as? [[String: Any]])?.isEmpty ?? true)
        var filters = try XCTUnwrap(initial["defaultFilters"] as? [String: Any])
        XCTAssertEqual(filters["includeReference"] as? Bool, true)
        filters["includeCompleted"] = true
        let all = try object(await core.call("search", argumentsJSON: json([json([
            "query": "Café search", "filters": filters, "limit": 100,
        ])])))
        XCTAssertEqual(Set((all["tasks"] as? [[String: Any]] ?? []).compactMap { $0["id"] as? String }), Set([activeID, doneID]))
        let finished = (all["tasks"] as? [[String: Any]])?.first { $0["id"] as? String == doneID }
        XCTAssertEqual(finished?["canComplete"] as? Bool, false)
        filters["includeCompleted"] = "true"
        await expectFailure("INVALID_INPUT") {
            _ = try await core.call("search", argumentsJSON: json([json(["query": "Café", "filters": filters, "limit": 100])]))
        }
        await expectFailure("INVALID_INPUT") {
            _ = try await core.call("search", argumentsJSON: json([json(["query": "Café", "filters": NSNull(), "limit": 101])]))
        }
        XCTAssertEqual(writes, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testTextEditorReadsAndSavesAtomicallyPreservingOtherFields() async throws {
        let writer = host()
        _ = try await writer.start()
        let id = UUID().uuidString.lowercased()
        _ = try await writer.call("captureSubmit", argumentsJSON: capture(writer, title: "Original title", id: id))
        await writer.close()
        let sqlite = try SQLiteBridge(url: database)
        _ = try sqlite.execute("UPDATE tasks SET description = ?, dueDate = ?, startTime = ?, checklist = ?, attachments = ?, tags = ?, contexts = ?, priority = ?, orderNum = ? WHERE id = ?", parametersJSON: json([
            "Original note", "2036-10-02", "2036-10-01T14:30:00.000Z",
            json([["id": "keep-step", "title": "Keep checklist", "isCompleted": true]]),
            json([["id": "keep-file", "kind": "file", "title": "Keep attachment", "uri": "file:///retained.txt",
                   "createdAt": "2026-09-01T00:00:00.000Z", "updatedAt": "2026-09-01T00:00:00.000Z"]]),
            json(["#keep"]), json(["@desk"]), "high", 37, id,
        ]))
        sqlite.close()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let before = try storedTask(id)
        let editor = try object(await core.call("editorModel", argumentsJSON: json([id])))
        XCTAssertEqual(editor["id"] as? String, id)
        XCTAssertEqual(editor["readOnly"] as? Bool, false)
        let draft = try XCTUnwrap(editor["draft"] as? [String: Any])
        XCTAssertEqual(draft["title"] as? String, "Original title")
        XCTAssertEqual(draft["description"] as? String, "Original note")
        var taskWrites = 0
        var diagnostics = 0
        var statements = 0
        var journalWrites = 0
        faults.beforeSQL = { sql in
            statements += 1
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+tasks\b"#, options: .regularExpression) != nil { taskWrites += 1 }
        }
        faults.journalWrite = { journalWrites += 1 }
        faults.commandDiagnostic = { if $0 == "saveTaskDraft" { diagnostics += 1 } }
        let title = "Updated title ü 😀"
        let note = "  Preserve note whitespace\n第二行\n"
        var unsaved = draft
        unsaved["title"] = title
        unsaved["description"] = note
        let metadata: [String: String] = ["priority": "urgent", "energyLevel": "high", "timeEstimate": "30min"]
        let preview = try object(await core.call("editDraft", argumentsJSON: json([json([
            "id": id, "draft": unsaved, "edit": ["type": "fields", "patch": metadata],
        ])])))
        let previewDraft = try XCTUnwrap(preview["draft"] as? [String: Any])
        XCTAssertEqual(previewDraft["title"] as? String, title)
        XCTAssertEqual(previewDraft["description"] as? String, note)
        for (field, value) in metadata { XCTAssertEqual(previewDraft[field] as? String, value) }
        let options = try XCTUnwrap(preview["options"] as? [String: Any])
        XCTAssertTrue((options["priorities"] as? [String])?.contains("urgent") == true)
        XCTAssertTrue((options["energyLevels"] as? [String])?.contains("high") == true)
        let estimates = try XCTUnwrap(options["timeEstimates"] as? [[String: Any]])
        XCTAssertFalse(try XCTUnwrap(estimates.first { $0["value"] as? String == "30min" }?["label"] as? String).isEmpty)
        let editable: Set<String> = ["title", "description", "priority", "energyLevel", "timeEstimate"]
        XCTAssertEqual(try json(draft.filter { !editable.contains($0.key) }), try json(previewDraft.filter { !editable.contains($0.key) }))
        XCTAssertEqual(statements, 0)
        XCTAssertEqual(journalWrites, 0)
        XCTAssertEqual(try json(storedTask(id)), try json(before))
        let result = try object(await core.call("saveDraft", argumentsJSON: json([json([
            "id": id, "base": ["title": "Original title", "description": "Original note", "priority": "high", "energyLevel": "", "timeEstimate": ""],
            "patch": ["title": title, "description": note, "priority": "urgent", "energyLevel": "high", "timeEstimate": "30min"],
        ])])))
        XCTAssertEqual(result["id"] as? String, id)
        XCTAssertEqual((result["draft"] as? [String: Any])?["description"] as? String, note)
        XCTAssertEqual(taskWrites, 1)
        XCTAssertEqual(diagnostics, 1)
        let after = try storedTask(id)
        XCTAssertEqual(after["title"] as? String, title)
        XCTAssertEqual(after["description"] as? String, note)
        for (field, value) in metadata { XCTAssertEqual(after[field] as? String, value) }
        XCTAssertEqual(after["rev"] as? Int, (before["rev"] as? Int ?? 0) + 1)
        let mutable = editable.union(["rev", "revBy", "updatedAt"])
        func preservedFields(_ row: [String: Any]) throws -> String {
            var fields = row.filter { !mutable.contains($0.key) }
            // These columns hold JSON: compare every nested value and array
            // position while allowing property order and escape spelling to
            // differ. Dates and all other scalar columns remain exact strings.
            for name in ["checklist", "attachments"] {
                if let encoded = fields[name] as? String {
                    fields[name] = try JSONSerialization.jsonObject(with: Data(encoded.utf8))
                }
            }
            return try json(fields)
        }
        XCTAssertEqual(try preservedFields(before), try preservedFields(after))
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        // RN keeps the existing title when its draft is blank; native delegates
        // that policy and permits clearing the description with an empty string.
        _ = try await core.call("saveDraft", argumentsJSON: json([json([
            "id": id, "base": ["title": title], "patch": ["title": " \n "],
        ])]))
        XCTAssertEqual(taskWrites, 1)
        _ = try await core.call("saveDraft", argumentsJSON: json([json([
            "id": id, "base": ["description": note, "priority": "urgent", "energyLevel": "high", "timeEstimate": "30min"],
            "patch": ["description": "", "priority": "", "energyLevel": "", "timeEstimate": ""],
        ])]))
        await core.close()
        let reopened = host()
        _ = try await reopened.start()
        let restored = try object(await reopened.call("editorModel", argumentsJSON: json([id])))
        let restoredDraft = try XCTUnwrap(restored["draft"] as? [String: Any])
        XCTAssertEqual(restoredDraft["title"] as? String, title)
        XCTAssertEqual(restoredDraft["description"] as? String, "")
        for field in metadata.keys { XCTAssertEqual(restoredDraft[field] as? String, "") }
        let persisted = try storedTask(id)
        for field in metadata.keys { XCTAssertTrue(persisted[field] is NSNull) }
        XCTAssertEqual(try preservedFields(before), try preservedFields(persisted))
    }

    func testDestinationDraftTransitionsPreserveUnrelatedRowsAndReopen() async throws {
        let id = try await seedDestinationTask()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let before = try storedTask(id)
        let editor = try object(await core.call("editorModel", argumentsJSON: json([id])))
        var draft = try XCTUnwrap(editor["draft"] as? [String: Any])
        var taskWrites = 0
        var statements = 0
        var journalWrites = 0
        var diagnostics = 0
        faults.beforeSQL = { sql in
            statements += 1
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+tasks\b"#, options: .regularExpression) != nil { taskWrites += 1 }
        }
        faults.journalWrite = { journalWrites += 1 }
        faults.commandDiagnostic = { if $0 == "saveTaskDraft" { diagnostics += 1 } }
        // These full destination patches are what buildTaskMovePatch returns.
        // Section selection itself is deliberately a one-field draft patch.
        let transitions: [[String: String]] = [
            ["projectId": "destination-project-a", "areaId": "", "sectionId": "destination-section-a"],
            ["sectionId": ""],
            ["sectionId": "destination-section-a"],
            ["projectId": "destination-project-b", "areaId": "", "sectionId": ""],
            ["sectionId": "destination-section-b"],
            ["projectId": "", "areaId": "destination-area-a", "sectionId": ""],
            ["projectId": "", "areaId": "", "sectionId": ""],
        ]
        var saves = 0
        var expectedPreserved = before
        for fields in transitions {
            let previousStatements = statements
            let previousJournalWrites = journalWrites
            let edited = try object(await core.call("editDraft", argumentsJSON: json([json([
                "id": id, "draft": draft, "edit": ["type": "fields", "patch": fields],
            ])])))
            let next = try XCTUnwrap(edited["draft"] as? [String: Any])
            for (field, value) in fields { XCTAssertEqual(next[field] as? String, value) }
            XCTAssertEqual(try json(next.filter { fields[$0.key] == nil }), try json(draft.filter { fields[$0.key] == nil }))
            XCTAssertEqual(statements, previousStatements)
            XCTAssertEqual(journalWrites, previousJournalWrites)
            var base: [String: String] = [:]
            var patch: [String: String] = [:]
            for (field, value) in fields where draft[field] as? String != value {
                base[field] = try XCTUnwrap(draft[field] as? String)
                patch[field] = value
            }
            if !patch.isEmpty {
                for field in ["projectId", "areaId", "sectionId"] {
                    base[field] = try XCTUnwrap(draft[field] as? String)
                    patch[field] = try XCTUnwrap(next[field] as? String)
                }
                let saved = try object(await core.call("saveDraft", argumentsJSON: json([json(["id": id, "base": base, "patch": patch])])))
                draft = try XCTUnwrap(saved["draft"] as? [String: Any])
                saves += 1
            } else {
                draft = next
            }
            for name in ["projectId", "areaId", "sectionId"] {
                XCTAssertEqual(draft[name] as? String, next[name] as? String)
                let value = try XCTUnwrap(next[name] as? String)
                let persisted = try storedTask(id)[name]
                if value.isEmpty { XCTAssertTrue(persisted is NSNull) }
                else { XCTAssertEqual(persisted as? String, value) }
            }
            let stored = try storedTask(id)
            // Core's container move clears the old project's ordering when
            // moving to an area or None; all other unrelated fields stay exact.
            if next["projectId"] as? String == "" { expectedPreserved["orderNum"] = NSNull() }
            XCTAssertEqual(try destinationPreservedFields(stored), try destinationPreservedFields(expectedPreserved))
            XCTAssertEqual(stored["rev"] as? Int, (before["rev"] as? Int ?? 0) + saves)
            XCTAssertEqual(taskWrites, saves)
            XCTAssertEqual(diagnostics, saves)
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        }
        XCTAssertEqual(saves, 6)
        await core.close()
        let reopened = host()
        _ = try await reopened.start()
        let restored = try object(await reopened.call("editorModel", argumentsJSON: json([id])))
        let restoredDraft = try XCTUnwrap(restored["draft"] as? [String: Any])
        for field in ["projectId", "areaId", "sectionId"] { XCTAssertEqual(restoredDraft[field] as? String, "") }
        XCTAssertEqual(try destinationPreservedFields(storedTask(id)), try destinationPreservedFields(expectedPreserved))
    }

    func testDestinationPickerReturnsCorePatchesWithoutSQLOrJournal() async throws {
        let id = try await seedDestinationTask()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let before = try storedTask(id)
        let editor = try object(await core.call("editorModel", argumentsJSON: json([id])))
        let draft = try XCTUnwrap(editor["draft"] as? [String: Any])
        var statements = 0
        var journalWrites = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journalWrites += 1 }
        func picker(_ current: [String: Any], query: String = "") async throws -> [String: Any] {
            try object(await core.call("destinationPicker", argumentsJSON: json([json(["id": id, "draft": current, "query": query])])))
        }
        func groups(_ model: [String: Any]) throws -> [[String: Any]] {
            try XCTUnwrap((model["destination"] as? [String: Any])?["groups"] as? [[String: Any]])
        }
        func choices(_ model: [String: Any], kind: String) throws -> [[String: Any]] {
            try XCTUnwrap(groups(model).first { $0["kind"] as? String == kind }?["choices"] as? [[String: Any]])
        }
        let model = try await picker(draft)
        XCTAssertEqual(model["version"] as? Int, 1)
        XCTAssertEqual(model["id"] as? String, id)
        XCTAssertEqual(model["readOnly"] as? Bool, false)
        XCTAssertEqual(model["query"] as? String, "")
        let destination = try XCTUnwrap(model["destination"] as? [String: Any])
        XCTAssertEqual(destination["value"] as? String, "Alpha project")
        XCTAssertNotNil(destination["fieldId"] as? String)
        XCTAssertFalse(try XCTUnwrap(destination["label"] as? String).isEmpty)
        XCTAssertEqual(try groups(model).compactMap { $0["kind"] as? String }, ["none", "project", "area"])
        let projects = try choices(model, kind: "project")
        XCTAssertEqual(Set(projects.compactMap { $0["id"] as? String }), Set(["destination-project-a", "destination-project-b"]))
        let current = try XCTUnwrap(projects.first { $0["id"] as? String == "destination-project-a" })
        XCTAssertEqual(current["selected"] as? Bool, true)
        XCTAssertEqual(try json(XCTUnwrap(current["patch"])), try json(["projectId": "destination-project-a", "areaId": "", "sectionId": "destination-section-a"]))
        let other = try XCTUnwrap(projects.first { $0["id"] as? String == "destination-project-b" })
        XCTAssertEqual(try json(XCTUnwrap(other["patch"])), try json(["projectId": "destination-project-b", "areaId": "", "sectionId": ""]))
        let area = try XCTUnwrap(choices(model, kind: "area").first { $0["id"] as? String == "destination-area-a" })
        XCTAssertEqual(try json(XCTUnwrap(area["patch"])), try json(["projectId": "", "areaId": "destination-area-a", "sectionId": ""]))
        let none = try XCTUnwrap(choices(model, kind: "none").first)
        XCTAssertEqual(try json(XCTUnwrap(none["patch"])), try json(["projectId": "", "areaId": "", "sectionId": ""]))
        let section = try XCTUnwrap(model["section"] as? [String: Any])
        XCTAssertEqual(section["visible"] as? Bool, true)
        XCTAssertEqual(section["value"] as? String, "Alpha section")
        let sections = try XCTUnwrap(section["choices"] as? [[String: Any]])
        XCTAssertEqual(sections.count, 2)
        XCTAssertEqual((sections.first?["patch"] as? [String: Any])?["sectionId"] as? String, "")
        XCTAssertEqual((sections.last?["patch"] as? [String: Any])?["sectionId"] as? String, "destination-section-a")
        XCTAssertEqual(sections.last?["selected"] as? Bool, true)
        let edited = try object(await core.call("editDraft", argumentsJSON: json([json([
            "id": id, "draft": draft, "edit": ["type": "fields", "patch": try XCTUnwrap(area["patch"])],
        ])])))
        let areaDraft = try XCTUnwrap(edited["draft"] as? [String: Any])
        let filtered = try await picker(areaDraft)
        XCTAssertEqual(try choices(filtered, kind: "project").compactMap { $0["id"] as? String }, ["destination-project-a"])
        XCTAssertEqual((filtered["section"] as? [String: Any])?["visible"] as? Bool, false)
        let searched = try await picker(areaDraft, query: "  bETA  ")
        XCTAssertEqual(try choices(searched, kind: "project").compactMap { $0["id"] as? String }, ["destination-project-b"])
        XCTAssertEqual(try choices(searched, kind: "area").compactMap { $0["id"] as? String }, ["destination-area-b"])
        XCTAssertEqual(try choices(searched, kind: "none").count, 1)
        let protectedID = id + "-protected"
        let protectedEditor = try object(await core.call("editorModel", argumentsJSON: json([protectedID])))
        let protectedModel = try object(await core.call("destinationPicker", argumentsJSON: json([json([
            "id": protectedID, "draft": try XCTUnwrap(protectedEditor["draft"]), "query": "",
        ])])))
        XCTAssertEqual(protectedModel["readOnly"] as? Bool, true)
        for malformed in ["[]", "null", "broken JSON"] {
            await expectFailure { _ = try await core.call("destinationPicker", argumentsJSON: json([malformed])) }
        }
        for invalid in [["id": id, "draft": draft, "query": true] as [String: Any], ["id": id, "draft": ["title": "Incomplete"], "query": ""],
                        ["id": id, "draft": draft, "query": "", "unknown": "field"]] {
            await expectFailure("INVALID_INPUT") { _ = try await core.call("destinationPicker", argumentsJSON: json([json(invalid)])) }
        }
        XCTAssertEqual(statements, 0)
        XCTAssertEqual(journalWrites, 0)
        XCTAssertEqual(try json(storedTask(id)), try json(before))
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testDestinationExactReplayAfterFailedCommitAndLostAcknowledgmentRetainsNewMetadata() async throws {
        for afterCommit in [false, true] {
            let id = try await seedDestinationTask()
            let faults = HostIOFaults()
            let core = host(faults)
            _ = try await core.start()
            let before = try storedTask(id)
            let payload = try json([json(["id": id,
                "base": ["projectId": "destination-project-a", "areaId": "", "sectionId": "destination-section-a"],
                "patch": ["projectId": "destination-project-b", "areaId": "", "sectionId": ""]])])
            if afterCommit {
                var writes = 0
                faults.journalWrite = {
                    writes += 1
                    if writes == 2 { throw HostFailure("Injected destination terminal phase failure") }
                }
            } else {
                faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected destination COMMIT failure") } }
            }
            await expectFailure { _ = try await core.call("saveDraft", argumentsJSON: payload) }
            let pending = try object(String(contentsOf: journal))
            XCTAssertEqual(pending["method"] as? String, "saveDraft")
            XCTAssertEqual(pending["argumentsJSON"] as? String, payload)
            XCTAssertNil(pending["terminal"])
            let attempted = try storedTask(id)
            XCTAssertEqual(attempted["projectId"] as? String, afterCommit ? "destination-project-b" : "destination-project-a")
            if afterCommit { XCTAssertTrue(attempted["sectionId"] is NSNull) }
            else { XCTAssertEqual(attempted["sectionId"] as? String, "destination-section-a") }
            await expectFailure("exact retry") { _ = try await core.call("destinationPicker", argumentsJSON: json(["{}"])) }
            await core.close()
            // A separate writer changes an unrelated field while the intent is
            // pending. Recovery must merge the destination without losing it.
            let sqlite = try SQLiteBridge(url: database)
            _ = try sqlite.execute("UPDATE tasks SET priority = ?, rev = rev + 1 WHERE id = ?", parametersJSON: json(["urgent", id]))
            sqlite.close()
            let newer = try storedTask(id)
            let reopenFaults = HostIOFaults()
            var taskWrites = 0
            reopenFaults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+tasks\b"#, options: .regularExpression) != nil { taskWrites += 1 }
            }
            reopenFaults.journalRemove = { throw HostFailure("Injected destination cleanup failure") }
            let reopened = host(reopenFaults)
            await expectFailure("cleanup") { _ = try await reopened.start() }
            XCTAssertEqual(taskWrites, afterCommit ? 0 : 1)
            XCTAssertTrue(FileManager.default.fileExists(atPath: journal.path))
            let terminal = try XCTUnwrap(try object(String(contentsOf: journal))["terminal"] as? [String: Any])
            let success = try XCTUnwrap(terminal["success"] as? [String: String])
            let savedResponse = try XCTUnwrap(success["_0"])
            let responseDraft = try XCTUnwrap(try object(savedResponse)["draft"] as? [String: Any])
            XCTAssertEqual(responseDraft["projectId"] as? String, "destination-project-b")
            XCTAssertEqual(responseDraft["sectionId"] as? String, "")
            XCTAssertEqual(responseDraft["areaId"] as? String, "")
            XCTAssertEqual(responseDraft["priority"] as? String, "urgent")
            reopenFaults.journalRemove = nil
            _ = try await reopened.start()
            let acknowledgment = try await reopened.retryPending()
            XCTAssertNil(acknowledgment)
            XCTAssertEqual(taskWrites, afterCommit ? 0 : 1)
            let recovered = try storedTask(id)
            XCTAssertEqual(recovered["projectId"] as? String, "destination-project-b")
            XCTAssertTrue(recovered["sectionId"] is NSNull)
            XCTAssertTrue(recovered["areaId"] is NSNull)
            XCTAssertEqual(recovered["rev"] as? Int, (before["rev"] as? Int ?? 0) + 2)
            XCTAssertEqual(try destinationPreservedFields(recovered), try destinationPreservedFields(newer))
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            await reopened.close()
        }
    }

    func testDestinationInvalidTargetsAndConcurrentConflictNeverOverwriteTask() async throws {
        let id = try await seedDestinationTask()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let before = try storedTask(id)
        let editor = try object(await core.call("editorModel", argumentsJSON: json([id])))
        let draft = try XCTUnwrap(editor["draft"] as? [String: Any])
        var statements = 0
        faults.beforeSQL = { _ in statements += 1 }
        for (field, invalid) in [("projectId", "missing-project"), ("projectId", "destination-project-deleted"),
                                 ("projectId", "destination-project-archived"), ("areaId", "missing-area"),
                                 ("areaId", "destination-area-deleted"), ("sectionId", "destination-section-b"),
                                 ("sectionId", "destination-section-deleted")] {
            let base = draft.filter { ["projectId", "areaId", "sectionId"].contains($0.key) }
            var patch = base
            patch[field] = invalid
            do {
                _ = try await core.call("saveDraft", argumentsJSON: json([json(["id": id,
                    "base": base, "patch": patch])]))
                XCTFail("Expected invalid destination refusal")
            } catch {
                XCTAssertTrue(error is CoreHostRejection)
                XCTAssertTrue(error.localizedDescription.hasPrefix("INVALID_INPUT:"))
            }
            XCTAssertEqual(try json(storedTask(id)), try json(before))
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        }
        for patch in [["projectId": NSNull()] as [String: Any], ["sectionId": 1], ["status": "done"]] {
            let field = try XCTUnwrap(patch.keys.first)
            await expectFailure("matching supported draft fields") {
                _ = try await core.call("saveDraft", argumentsJSON: json([json(["id": id, "base": [field: ""], "patch": patch])]))
            }
        }
        let protectedID = id + "-protected"
        let protected = try storedTask(protectedID)
        await expectFailure("read-only") {
            _ = try await core.call("saveDraft", argumentsJSON: json([json(["id": protectedID,
                "base": ["projectId": "destination-project-archived", "areaId": "", "sectionId": ""],
                "patch": ["projectId": "destination-project-a", "areaId": "", "sectionId": ""]])]))
        }
        XCTAssertEqual(try json(storedTask(protectedID)), try json(protected))
        XCTAssertEqual(statements, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        faults.beforeSQL = nil
        _ = try await core.call("saveDraft", argumentsJSON: json([json(["id": id,
            "base": ["projectId": "destination-project-a", "areaId": "", "sectionId": "destination-section-a"],
            "patch": ["projectId": "destination-project-b", "areaId": "", "sectionId": ""]])]))
        let moved = try storedTask(id)
        do {
            _ = try await core.call("saveDraft", argumentsJSON: json([json(["id": id,
                "base": ["projectId": "destination-project-a", "areaId": "", "sectionId": ""],
                "patch": ["projectId": "", "areaId": "", "sectionId": ""]])]))
            XCTFail("Expected initial destination conflict")
        } catch {
            XCTAssertTrue(error is CoreHostRejection)
            XCTAssertTrue(error.localizedDescription.hasPrefix("STALE_REVISION:"))
        }
        XCTAssertEqual(try json(storedTask(id)), try json(moved))
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        let payload = try json([json(["id": id,
            "base": ["projectId": "destination-project-b", "areaId": "", "sectionId": ""],
            "patch": ["projectId": "destination-project-a", "areaId": "", "sectionId": ""]])])
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected destination COMMIT failure") } }
        await expectFailure("SAVE_FAILED") { _ = try await core.call("saveDraft", argumentsJSON: payload) }
        await core.close()
        let sqlite = try SQLiteBridge(url: database)
        _ = try sqlite.execute("UPDATE tasks SET projectId = NULL, sectionId = NULL, areaId = ?, priority = ?, rev = rev + 1 WHERE id = ?",
                               parametersJSON: json(["destination-area-b", "urgent", id]))
        sqlite.close()
        let newer = try storedTask(id)
        let reopenFaults = HostIOFaults()
        var taskWrites = 0
        reopenFaults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+tasks\b"#, options: .regularExpression) != nil { taskWrites += 1 }
        }
        let reopened = host(reopenFaults)
        do { _ = try await reopened.start(); XCTFail("Unknown destination replay conflict must block") }
        catch {
            XCTAssertFalse(error is CoreHostRejection)
            XCTAssertTrue(error.localizedDescription.hasPrefix("STALE_REVISION:"))
        }
        XCTAssertEqual(taskWrites, 0)
        XCTAssertEqual(try json(storedTask(id)), try json(newer))
        let pending = try object(String(contentsOf: journal))
        XCTAssertEqual(pending["method"] as? String, "saveDraft")
        XCTAssertEqual(pending["argumentsJSON"] as? String, payload)
        XCTAssertNil(pending["terminal"])
        await expectFailure("not ready") { _ = try await reopened.call("editorModel", argumentsJSON: json([id])) }
    }

    func testDestinationMoveGuardsOriginallyEmptySectionBeforeSaveAndRecovery() async throws {
        for recovering in [false, true] {
            let id = try await seedDestinationTask()
            let setup = try SQLiteBridge(url: database)
            _ = try setup.execute("UPDATE tasks SET sectionId = NULL WHERE id = ?", parametersJSON: json([id]))
            setup.close()
            let base = ["projectId": "destination-project-a", "areaId": "", "sectionId": ""]
            let patch = ["projectId": "destination-project-b", "areaId": "", "sectionId": ""]
            let payload = try json([json(["id": id, "base": base, "patch": patch])])
            let faults = HostIOFaults()
            let first = host(faults)
            _ = try await first.start()
            let original = try storedTask(id)
            await expectFailure("all association fields") {
                _ = try await first.call("saveDraft", argumentsJSON: json([json(["id": id,
                    "base": ["projectId": "destination-project-a"], "patch": ["projectId": "destination-project-b"]])]))
            }
            XCTAssertEqual(try json(storedTask(id)), try json(original))
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            if recovering {
                faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected destination COMMIT failure") } }
                await expectFailure("SAVE_FAILED") { _ = try await first.call("saveDraft", argumentsJSON: payload) }
            }
            await first.close()
            let writer = try SQLiteBridge(url: database)
            _ = try writer.execute("UPDATE tasks SET sectionId = ?, rev = rev + 1 WHERE id = ?",
                                   parametersJSON: json(["destination-section-a", id]))
            writer.close()
            let newer = try storedTask(id)
            let reopenFaults = HostIOFaults()
            var writes = 0
            reopenFaults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+tasks\b"#, options: .regularExpression) != nil { writes += 1 }
            }
            let reopened = host(reopenFaults)
            if recovering {
                await expectFailure("STALE_REVISION") { _ = try await reopened.start() }
                let pending = try object(String(contentsOf: journal))
                XCTAssertEqual(pending["argumentsJSON"] as? String, payload)
                XCTAssertNil(pending["terminal"])
            } else {
                _ = try await reopened.start()
                writes = 0
                await expectFailure("STALE_REVISION") { _ = try await reopened.call("saveDraft", argumentsJSON: payload) }
                XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            }
            XCTAssertEqual(writes, 0)
            XCTAssertEqual(try json(storedTask(id)), try json(newer))
            await reopened.close()
        }
    }

    func testPreparedRecurrenceRoundTripPreservesRawMetadataAndCreatesNoChild() async throws {
        let id = try await seedDestinationTask()
        let rawRecurrence: [String: Any] = ["rule": "monthly", "strategy": "strict", "seriesId": UUID().uuidString.lowercased(),
                                            "count": 8, "completedOccurrences": 2, "anchorDay": 31,
                                            "startAnchorDay": 30, "dueAnchorDay": 31, "reviewAnchorDay": 29]
        let sqlite = try SQLiteBridge(url: database)
        _ = try sqlite.execute("UPDATE tasks SET recurrence = ?, showFutureRecurrence = 0 WHERE id = ?", parametersJSON: json([json(rawRecurrence), id]))
        sqlite.close()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let before = try storedTask(id)
        let count = try taskCount()
        var statements = 0
        var journalWrites = 0
        var recurrenceDiagnostics: [String] = []
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journalWrites += 1 }
        faults.commandDiagnostic = { if $0.hasPrefix("recurrenceSave:") { recurrenceDiagnostics.append($0) } }
        let opening = try object(await core.call("editorModel", argumentsJSON: json([id])))
        let baseline = try XCTUnwrap(opening["recurrenceBase"] as? [String: Any])
        XCTAssertEqual(Set(baseline.keys), Set(["recurrence", "showFutureRecurrence"]))
        let openingRecurrence = try XCTUnwrap(baseline["recurrence"] as? [String: Any])
        // SQLite load canonicalizes the rule before the editor opens. Pin every
        // supplied metadata value and use that actual opening baseline below.
        for field in rawRecurrence.keys {
            XCTAssertEqual(try json([openingRecurrence[field] ?? NSNull()]), try json([rawRecurrence[field] ?? NSNull()]))
        }
        let visible = try object(await core.call("editDraft", argumentsJSON: json([json([
            "id": id, "draft": try XCTUnwrap(opening["draft"]), "edit": ["type": "fields", "patch": ["showFutureRecurrence": true]],
        ])])))
        XCTAssertEqual(try json(XCTUnwrap(visible["recurrenceBase"])), try json(baseline))
        XCTAssertEqual(statements, 0)
        XCTAssertEqual(journalWrites, 0)
        XCTAssertTrue(recurrenceDiagnostics.isEmpty)
        _ = try await core.call("saveDraft", argumentsJSON: json([json(recurrenceRequest(id, opening: opening, edited: visible))]))
        let flagOnly = try storedTask(id)
        XCTAssertEqual(try json(JSONSerialization.jsonObject(with: Data(XCTUnwrap(flagOnly["recurrence"] as? String).utf8))), try json(openingRecurrence))
        XCTAssertEqual(recurrenceDiagnostics, ["recurrenceSave:applied"])
        XCTAssertEqual(flagOnly["showFutureRecurrence"] as? Int, 1)
        XCTAssertEqual(try taskCount(), count)
        XCTAssertEqual(try datePreservedFields(flagOnly, excluding: ["recurrence", "showFutureRecurrence", "rev", "revBy", "updatedAt"]),
                       try datePreservedFields(before, excluding: ["recurrence", "showFutureRecurrence", "rev", "revBy", "updatedAt"]))

        let current = try object(await core.call("editorModel", argumentsJSON: json([id])))
        var edited = try await recurrenceEdit(core, id: id, editor: current, action: ["kind": "rule", "rule": "daily"])
        edited = try await recurrenceEdit(core, id: id, editor: edited, action: ["kind": "interval", "text": "2"])
        edited = try await recurrenceEdit(core, id: id, editor: edited, action: ["kind": "ends", "ends": "count"])
        edited = try await recurrenceEdit(core, id: id, editor: edited, action: ["kind": "count", "text": "7"])
        edited = try await recurrenceEdit(core, id: id, editor: edited, action: ["kind": "strategy"])
        let request = try recurrenceRequest(id, opening: current, edited: edited)
        let result = try object(await core.call("saveDraft", argumentsJSON: json([json(request)])))
        XCTAssertEqual(recurrenceDiagnostics, ["recurrenceSave:applied", "recurrenceSave:applied"])
        let acknowledgedDraft = try XCTUnwrap(result["draft"] as? [String: Any])
        // The stored RRULE gains its canonical inherited series stamp. Compare
        // visible core controls, then pin that acknowledged draft across restart.
        let acknowledgedModel = try object(await core.call("editorModel", argumentsJSON: json([id])))
        XCTAssertEqual(try json((acknowledgedModel["fields"] as? [String: Any])?["recurrence"] ?? [:]),
                       try json((edited["fields"] as? [String: Any])?["recurrence"] ?? [:]))
        for field in recurrenceFields where field != "recurrenceRRule" {
            XCTAssertEqual(try json([acknowledgedDraft[field] ?? NSNull()]),
                           try json([(request["patch"] as? [String: Any])?[field] ?? NSNull()]))
        }
        let committed = try storedTask(id)
        XCTAssertEqual(try taskCount(), count)
        for field in ["startTime", "dueDate", "reviewAt", "relativeStartOffset"] {
            XCTAssertEqual(try json([committed[field] ?? NSNull()]), try json([before[field] ?? NSNull()]))
        }
        await core.close()
        let reopened = host()
        _ = try await reopened.start()
        let restored = try object(await reopened.call("editorModel", argumentsJSON: json([id])))
        XCTAssertEqual(try json((restored["draft"] as? [String: Any] ?? [:]).filter { recurrenceFields.contains($0.key) }),
                       try json(acknowledgedDraft.filter { recurrenceFields.contains($0.key) }))
        let cleared = try await recurrenceEdit(reopened, id: id, editor: restored, action: ["kind": "rule", "rule": ""])
        _ = try await reopened.call("saveDraft", argumentsJSON: json([json(recurrenceRequest(id, opening: restored, edited: cleared))]))
        let removed = try storedTask(id)
        XCTAssertTrue(removed["recurrence"] is NSNull)
        XCTAssertEqual(removed["showFutureRecurrence"] as? Int ?? 0, 0)
        XCTAssertEqual(try taskCount(), count)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testPreparedRecurrenceUnchangedLegacyRuleAndFalseRemainExact() async throws {
        let id = try await seedDestinationTask()
        let sqlite = try SQLiteBridge(url: database)
        _ = try sqlite.execute("UPDATE tasks SET recurrence = ?, showFutureRecurrence = 0 WHERE id = ?", parametersJSON: json(["\"daily\"", id]))
        sqlite.close()
        let core = host()
        _ = try await core.start()
        let count = try taskCount()
        let opening = try object(await core.call("editorModel", argumentsJSON: json([id])))
        let baseline = try XCTUnwrap(opening["recurrenceBase"] as? [String: Any])
        // The SQLite loader presents the legacy string as a rule object and
        // false as absent. Protect that opening baseline, not a pre-load shape.
        XCTAssertEqual((baseline["recurrence"] as? [String: Any])?["rule"] as? String, "daily")
        XCTAssertTrue(baseline["showFutureRecurrence"] is NSNull)
        XCTAssertEqual((opening["draft"] as? [String: Any])?["showFutureRecurrence"] as? Bool, false)
        let request = try recurrenceRequest(id, opening: opening, edited: opening, dates: ["dueDate": "2036-10-05"])
        _ = try await core.call("saveDraft", argumentsJSON: json([json(request)]))
        let saved = try storedTask(id)
        XCTAssertEqual(try json(JSONSerialization.jsonObject(with: Data(XCTUnwrap(saved["recurrence"] as? String).utf8))),
                       try json(XCTUnwrap(baseline["recurrence"])))
        XCTAssertEqual(saved["showFutureRecurrence"] as? Int, 0)
        XCTAssertEqual(saved["dueDate"] as? String, "2036-10-05")
        XCTAssertEqual(try taskCount(), count)
        await core.close()
        let reopened = host()
        _ = try await reopened.start()
        let restored = try object(await reopened.call("editorModel", argumentsJSON: json([id])))
        XCTAssertEqual(try json(XCTUnwrap(restored["recurrenceBase"])), try json(baseline))
    }

    func testPreparedRecurrenceRestartRetriesFrozenChangesAndPreservesNewerNotes() async throws {
        for afterCommit in [false, true] {
            let id = try await seedDestinationTask()
            let faults = HostIOFaults()
            let core = host(faults, bundleURL: try dateBundle(at: "2026-09-27T12:00:00.000Z"))
            _ = try await core.start()
            let before = try storedTask(id)
            let count = try taskCount()
            let opening = try object(await core.call("editorModel", argumentsJSON: json([id])))
            let edited = try await recurrenceEdit(core, id: id, editor: opening, action: ["kind": "rule", "rule": "weekly"])
            let request = try recurrenceRequest(id, opening: opening, edited: edited, dates: afterCommit ? ["dueDate": "2036-10-05"] : [:])
            if afterCommit {
                var writes = 0
                faults.journalWrite = { writes += 1; if writes == 2 { throw HostFailure("Injected recurrence lost acknowledgment") } }
            } else {
                faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected recurrence COMMIT failure") } }
            }
            await expectFailure { _ = try await core.call("saveDraft", argumentsJSON: json([json(request)])) }
            let commit = try pendingDraftCommit()
            let prepared = try XCTUnwrap(commit["prepared"] as? [String: Any])
            let frozenBefore = try XCTUnwrap(prepared["before"] as? [String: Any])
            let changes = try XCTUnwrap(prepared["changes"] as? [String: Any])
            XCTAssertEqual(try json(XCTUnwrap(commit["request"])), try json(request))
            XCTAssertEqual(try taskCount(), count)
            await core.close()
            let writer = try SQLiteBridge(url: database)
            _ = try writer.execute("UPDATE tasks SET description = ?, rev = rev + 1 WHERE id = ?", parametersJSON: json(["Newer recurrence-independent note", id]))
            writer.close()
            let newer = try storedTask(id)
            var taskWrites = 0
            var recurrenceDiagnostics: [String] = []
            let replayFaults = HostIOFaults()
            replayFaults.commandDiagnostic = { if $0.hasPrefix("recurrenceSave:") { recurrenceDiagnostics.append($0) } }
            replayFaults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+tasks\b"#, options: .regularExpression) != nil { taskWrites += 1 }
            }
            replayFaults.journalRemove = { throw HostFailure("Injected recurrence cleanup failure") }
            let reopened = host(replayFaults, bundleURL: try dateBundle(at: "2026-09-29T12:00:00.000Z", rejectingPreparation: true))
            await expectFailure("cleanup") { _ = try await reopened.start() }
            XCTAssertEqual(taskWrites, afterCommit ? 0 : 1)
            XCTAssertEqual(recurrenceDiagnostics, [afterCommit ? "recurrenceSave:replayed" : "recurrenceSave:applied"])
            let recovered = try storedTask(id)
            XCTAssertEqual(recovered["description"] as? String, "Newer recurrence-independent note")
            XCTAssertEqual(recovered["rev"] as? Int, (before["rev"] as? Int ?? 0) + 2)
            let expectedRecurrence = changes["recurrence"] ?? frozenBefore["recurrence"] ?? NSNull()
            XCTAssertEqual(try json(JSONSerialization.jsonObject(with: Data(XCTUnwrap(recovered["recurrence"] as? String).utf8))), try json(expectedRecurrence))
            for field in ["startTime", "dueDate", "reviewAt"] {
                XCTAssertEqual(try json([recovered[field] ?? NSNull()]), try json([changes[field] ?? frozenBefore[field] ?? NSNull()]))
            }
            XCTAssertEqual(try datePreservedFields(recovered, excluding: ["recurrence", "showFutureRecurrence", "dueDate", "pushCount", "rev", "revBy", "updatedAt"]),
                           try datePreservedFields(newer, excluding: ["recurrence", "showFutureRecurrence", "dueDate", "pushCount", "rev", "revBy", "updatedAt"]))
            replayFaults.beforeSQL = nil
            replayFaults.journalRemove = nil
            _ = try await reopened.start()
            let absent = try await reopened.retryPending()
            XCTAssertNil(absent)
            XCTAssertEqual(try recurrenceComparableRow(storedTask(id)), try recurrenceComparableRow(recovered))
            XCTAssertEqual(recurrenceDiagnostics.count, 1)
            XCTAssertEqual(try taskCount(), count)
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            await reopened.close()
        }
    }

    func testPreparedRecurrenceConflictsProtectOpeningMetadataAndPendingJournal() async throws {
        let id = try await seedDestinationTask()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let opening = try object(await core.call("editorModel", argumentsJSON: json([id])))
        let daily = try await recurrenceEdit(core, id: id, editor: opening, action: ["kind": "rule", "rule": "daily"])
        _ = try await core.call("saveDraft", argumentsJSON: json([json(recurrenceRequest(id, opening: opening, edited: daily))]))
        let changed = try storedTask(id)
        var journalWrites = 0
        faults.journalWrite = { journalWrites += 1 }
        let weekly = try await recurrenceEdit(core, id: id, editor: opening, action: ["kind": "rule", "rule": "weekly"])
        do {
            _ = try await core.call("saveDraft", argumentsJSON: json([json(recurrenceRequest(id, opening: opening, edited: weekly))]))
            XCTFail("Opening recurrence baseline must conflict")
        } catch {
            XCTAssertTrue(error is CoreHostRejection)
            XCTAssertTrue(error.localizedDescription.hasPrefix("STALE_REVISION:"))
        }
        XCTAssertEqual(journalWrites, 0)
        XCTAssertEqual(try json(storedTask(id)), try json(changed))
        let current = try object(await core.call("editorModel", argumentsJSON: json([id])))
        let monthly = try await recurrenceEdit(core, id: id, editor: current, action: ["kind": "rule", "rule": "monthly"])
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected recurrence conflict COMMIT failure") } }
        await expectFailure("SAVE_FAILED") {
            _ = try await core.call("saveDraft", argumentsJSON: json([json(recurrenceRequest(id, opening: current, edited: monthly))]))
        }
        await core.close()
        let frozenEnvelope = try object(String(contentsOf: journal, encoding: .utf8))
        let frozenArguments = Data(try XCTUnwrap(frozenEnvelope["argumentsJSON"] as? String).utf8)
        // A valid journal from another encoder may use different whitespace/order.
        // Recovery must preserve its exact prepared arguments, not that formatting.
        try JSONSerialization.data(withJSONObject: frozenEnvelope, options: [.prettyPrinted, .sortedKeys])
            .write(to: journal, options: .atomic)
        let writer = try SQLiteBridge(url: database)
        var newerRecurrence = try object(XCTUnwrap(changed["recurrence"] as? String))
        newerRecurrence["completedOccurrences"] = 3
        _ = try writer.execute("UPDATE tasks SET recurrence = ?, description = ?, rev = rev + 1 WHERE id = ?", parametersJSON: json([json(newerRecurrence), "Concurrent recurrence progress", id]))
        writer.close()
        let newer = try storedTask(id)
        let replayFaults = HostIOFaults()
        var taskWrites = 0
        replayFaults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+tasks\b"#, options: .regularExpression) != nil { taskWrites += 1 }
        }
        let reopened = host(replayFaults, bundleURL: try dateBundle(at: "2026-09-29T12:00:00.000Z", rejectingPreparation: true))
        await expectFailure("STALE_REVISION") { _ = try await reopened.start() }
        XCTAssertEqual(taskWrites, 0)
        XCTAssertEqual(try json(storedTask(id)), try json(newer))
        // Replay re-persists the envelope; JSONEncoder does not guarantee member order.
        // Its exact arguments string contains the frozen request and all prepared values.
        let retained = try object(String(contentsOf: journal, encoding: .utf8))
        XCTAssertEqual(try json(retained), try json(frozenEnvelope))
        XCTAssertEqual(Data(try XCTUnwrap(retained["argumentsJSON"] as? String).utf8), frozenArguments)
    }

    func testPreparedRecurrenceTransportAndRawLegacyJournalsFailBeforeSQLite() async throws {
        let id = try await seedDestinationTask()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let opening = try object(await core.call("editorModel", argumentsJSON: json([id])))
        let edited = try await recurrenceEdit(core, id: id, editor: opening, action: ["kind": "rule", "rule": "daily"])
        let request = try recurrenceRequest(id, opening: opening, edited: edited)
        let before = try storedTask(id)
        var malformed: [[String: Any]] = [request.filter { $0.key != "recurrenceBase" }, request.filter { $0.key != "scheduleBase" }]
        for field in recurrenceFields {
            var incomplete = request
            incomplete["base"] = (request["base"] as? [String: Any])?.filter { $0.key != field }
            incomplete["patch"] = (request["patch"] as? [String: Any])?.filter { $0.key != field }
            malformed.append(incomplete)
        }
        for side in ["base", "patch"] {
            for fake in [0 as Any, 1 as Any, "true" as Any, NSNull() as Any] {
                var invalid = request
                var fields = try XCTUnwrap(request[side] as? [String: Any])
                fields["showFutureRecurrence"] = fake
                invalid[side] = fields
                malformed.append(invalid)
            }
        }
        let raw = try XCTUnwrap(request["recurrenceBase"] as? [String: Any])
        let invalidBaselines: [[String: Any]] = [
            raw.filter { $0.key != "showFutureRecurrence" },
            raw.merging(["unexpected": true]) { _, new in new },
            ["recurrence": 1, "showFutureRecurrence": false],
            ["recurrence": [], "showFutureRecurrence": false],
            ["recurrence": NSNull(), "showFutureRecurrence": 0],
            ["recurrence": NSNull(), "showFutureRecurrence": 1],
        ]
        for rawBaseline in invalidBaselines {
            var invalid = request
            invalid["recurrenceBase"] = rawBaseline
            malformed.append(invalid)
        }
        var extra = request
        extra["status"] = "done"
        malformed.append(extra)
        var statements = 0
        var journalWrites = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journalWrites += 1 }
        for input in malformed {
            await expectFailure("INVALID_INPUT") { _ = try await core.call("saveDraft", argumentsJSON: json([json(input)])) }
        }
        for method in ["draftPrepare", "draftCommit"] {
            await expectFailure("unavailable") { _ = try await core.call(method, argumentsJSON: json([json(request)])) }
        }
        XCTAssertEqual(statements, 0)
        XCTAssertEqual(journalWrites, 0)
        XCTAssertEqual(try json(storedTask(id)), try json(before))
        await core.close()
        var commands: [[String: Any]] = [
            ["version": 2, "method": "saveDraft", "argumentsJSON": try json([json(request)])],
            ["version": 2, "method": "saveDraft", "argumentsJSON": try json([json(request.filter { !["scheduleBase", "recurrenceBase"].contains($0.key) })])],
        ]
        for input in malformed {
            let prepared: [String: Any] = ["version": 1, "request": input]
            commands.append(["version": 2, "method": "draftCommit", "argumentsJSON": try json([json(["request": input, "prepared": prepared])])])
        }
        var mismatched = request
        mismatched["id"] = "wrong-task"
        commands.append(["version": 2, "method": "draftCommit", "argumentsJSON": try json([json(["request": request, "prepared": ["version": 1, "request": mismatched]])])])
        for command in commands {
            let bytes = Data(try json(command).utf8)
            try bytes.write(to: journal)
            let mainBefore = try Data(contentsOf: database)
            let wal = URL(fileURLWithPath: database.path + "-wal")
            let walBefore = try? Data(contentsOf: wal)
            let reopened = host(faults)
            await expectFailure { _ = try await reopened.start() }
            XCTAssertEqual(statements, 0)
            XCTAssertEqual(journalWrites, 0)
            XCTAssertEqual(try Data(contentsOf: database), mainBefore)
            XCTAssertEqual(try? Data(contentsOf: wal), walBefore)
            XCTAssertEqual(try Data(contentsOf: journal), bytes)
            await reopened.close()
        }
    }

    func testPreparedRecurrenceDecoderRejectsForgedStoredChanges() async throws {
        let id = try await seedDestinationTask()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let opening = try object(await core.call("editorModel", argumentsJSON: json([id])))
        let edited = try await recurrenceEdit(core, id: id, editor: opening, action: ["kind": "rule", "rule": "yearly"])
        let before = try storedTask(id)
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected recurrence decoder COMMIT failure") } }
        await expectFailure("SAVE_FAILED") {
            _ = try await core.call("saveDraft", argumentsJSON: json([json(recurrenceRequest(id, opening: opening, edited: edited))]))
        }
        let commit = try pendingDraftCommit()
        let prepared = try XCTUnwrap(commit["prepared"] as? [String: Any])
        let originalChanges = try XCTUnwrap(prepared["changes"] as? [String: Any])
        let recurrence = try XCTUnwrap(originalChanges["recurrence"] as? [String: Any])
        await core.close()
        var altered = recurrence
        altered["seriesId"] = "forged-series"
        var counter = recurrence
        counter["completedOccurrences"] = 99
        let forgeries: [(String, Any)] = [("recurrence", altered), ("recurrence", counter), ("recurrence", NSNull()),
                                          ("recurrenceStrategy", "fluid"), ("recurrenceRRule", "FREQ=DAILY"), ("showFutureRecurrence", 1)]
        for (field, value) in forgeries {
            var candidate = prepared
            var changes = originalChanges
            changes[field] = value
            candidate["changes"] = changes
            let args = try json([json(["request": try XCTUnwrap(commit["request"]), "prepared": candidate])])
            try Data(json(["version": 2, "method": "draftCommit", "argumentsJSON": args]).utf8).write(to: journal)
            let replayFaults = HostIOFaults()
            var taskWrites = 0
            replayFaults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+tasks\b"#, options: .regularExpression) != nil { taskWrites += 1 }
            }
            let reopened = host(replayFaults, bundleURL: try dateBundle(at: "2026-09-29T12:00:00.000Z", rejectingPreparation: true))
            await expectFailure("INVALID_INPUT") { _ = try await reopened.start() }
            XCTAssertEqual(taskWrites, 0)
            XCTAssertEqual(try json(storedTask(id)), try json(before))
            XCTAssertEqual(try object(String(contentsOf: journal))["argumentsJSON"] as? String, args)
            await reopened.close()
        }
    }

    func testPreparedRecurrenceCompletionLostAcknowledgmentCreatesExactlyOneChild() async throws {
        let id = try await seedDestinationTask()
        let faults = HostIOFaults()
        let core = host(faults, bundleURL: try dateBundle(at: "2026-09-27T12:00:00.000Z"))
        _ = try await core.start()
        let opening = try object(await core.call("editorModel", argumentsJSON: json([id])))
        var edited = try await recurrenceEdit(core, id: id, editor: opening, action: ["kind": "rule", "rule": "daily"])
        edited = try await recurrenceEdit(core, id: id, editor: edited, action: ["kind": "ends", "ends": "count"])
        edited = try await recurrenceEdit(core, id: id, editor: edited, action: ["kind": "count", "text": "3"])
        _ = try await core.call("saveDraft", argumentsJSON: json([json(recurrenceRequest(id, opening: opening, edited: edited))]))
        let recurring = try storedTask(id)
        let rule = try object(XCTUnwrap(recurring["recurrence"] as? String))
        let count = try taskCount()
        var journalWrites = 0
        faults.journalWrite = {
            journalWrites += 1
            if journalWrites == 2 { throw HostFailure("Injected recurring completion lost acknowledgment") }
        }
        await expectFailure("lost acknowledgment") { _ = try await core.call("complete", argumentsJSON: json([id])) }
        XCTAssertEqual(try taskCount(), count + 1)
        let completed = try storedTask(id)
        XCTAssertEqual(completed["status"] as? String, "done")
        let sqlite = try SQLiteBridge(url: database)
        let children = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(sqlite.execute("SELECT * FROM tasks WHERE id NOT IN (?, ?)", parametersJSON: json([id, id + "-protected"])).utf8)) as? [[String: Any]])
        sqlite.close()
        XCTAssertEqual(children.count, 1)
        let child = try XCTUnwrap(children.first)
        let childID = try XCTUnwrap(child["id"] as? String)
        let childRule = try object(XCTUnwrap(child["recurrence"] as? String))
        for field in ["rule", "seriesId", "count"] {
            XCTAssertEqual(try json([childRule[field] ?? NSNull()]), try json([rule[field] ?? NSNull()]))
        }
        XCTAssertEqual(childRule["completedOccurrences"] as? Int, (rule["completedOccurrences"] as? Int ?? 0) + 1)
        await core.close()
        let replayFaults = HostIOFaults()
        var taskWrites = 0
        replayFaults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+tasks\b"#, options: .regularExpression) != nil { taskWrites += 1 }
        }
        replayFaults.journalRemove = { throw HostFailure("Injected recurring completion cleanup") }
        let reopened = host(replayFaults, bundleURL: try dateBundle(at: "2026-09-29T12:00:00.000Z", rejectingPreparation: true))
        await expectFailure("cleanup") { _ = try await reopened.start() }
        XCTAssertEqual(taskWrites, 0)
        XCTAssertEqual(try taskCount(), count + 1)
        XCTAssertEqual(try json(storedTask(id)), try json(completed))
        XCTAssertEqual(try json(storedTask(childID)), try json(child))
        replayFaults.beforeSQL = nil
        replayFaults.journalRemove = nil
        _ = try await reopened.start()
        let absent = try await reopened.retryPending()
        XCTAssertNil(absent)
        XCTAssertEqual(try taskCount(), count + 1)
        XCTAssertEqual(try json(storedTask(childID)), try json(child))
    }

    func testPreparedDateRawBaselineAndRepresentationsPreserveUnrelatedFields() async throws {
        let originalZone = NSTimeZone.default
        let originalTZ = getenv("TZ").map { String(cString: $0) }
        defer {
            if let originalTZ { setenv("TZ", originalTZ, 1) } else { unsetenv("TZ") }
            tzset(); NSTimeZone.default = originalZone
        }
        setenv("TZ", "America/New_York", 1); tzset(); NSTimeZone.default = TimeZone(identifier: "America/New_York")!
        let id = try await seedDestinationTask()
        let faults = HostIOFaults()
        let core = host(faults, bundleURL: try dateBundle(at: "2026-09-26T12:00:00.000Z"))
        _ = try await core.start()
        let before = try storedTask(id)
        var statements = 0
        var journalWrites = 0
        var dateSaves = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journalWrites += 1 }
        faults.commandDiagnostic = { if $0 == "dateSave" { dateSaves += 1 } }
        let editor = try object(await core.call("editorModel", argumentsJSON: json([id])))
        let raw = try XCTUnwrap(editor["scheduleBase"] as? [String: Any])
        XCTAssertEqual(Set(raw.keys), Set(["startTime", "dueDate", "reviewAt", "relativeStartOffset"]))
        XCTAssertEqual(raw["startTime"] as? String, "2036-10-01T14:30:00.000Z")
        XCTAssertEqual(raw["dueDate"] as? String, "2036-10-02")
        XCTAssertTrue(raw["reviewAt"] is NSNull)
        XCTAssertTrue(raw["relativeStartOffset"] is NSNull)
        let originalDraft = try XCTUnwrap(editor["draft"] as? [String: Any])
        // This floating value equals the ISO baseline's NY display. Explicit
        // date intent must still replace the different raw representation.
        let floating = try XCTUnwrap(originalDraft["startTime"] as? String)
        XCTAssertEqual(floating, "2036-10-01T10:30")
        let patch: [String: Any] = ["startTime": floating, "dueDate": "2036-10-03", "reviewAt": "2036-10-06"]
        let edited = try object(await core.call("editDraft", argumentsJSON: json([json([
            "id": id, "draft": originalDraft, "edit": ["type": "fields", "patch": patch],
        ])])))
        XCTAssertEqual(try json(XCTUnwrap(edited["scheduleBase"])), try json(raw))
        XCTAssertEqual(statements, 0)
        XCTAssertEqual(journalWrites, 0)
        _ = try await core.call("saveDraft", argumentsJSON: datePayload(id, editor: editor, patch: patch))
        let first = try storedTask(id)
        XCTAssertEqual(first["startTime"] as? String, floating)
        XCTAssertEqual(first["dueDate"] as? String, "2036-10-03")
        XCTAssertEqual(first["reviewAt"] as? String, "2036-10-06")
        XCTAssertEqual(first["pushCount"] as? Int, (before["pushCount"] as? Int ?? 0) + 1)
        XCTAssertEqual(try datePreservedFields(first), try datePreservedFields(before))
        let current = try object(await core.call("editorModel", argumentsJSON: json([id])))
        let timed = try object(await core.call("editDraft", argumentsJSON: json([json([
            "id": id, "draft": try XCTUnwrap(current["draft"]), "edit": ["type": "pickTime", "field": "dueDate", "time": "08:30"],
        ])])))
        let due = try XCTUnwrap((timed["draft"] as? [String: Any])?["dueDate"] as? String)
        XCTAssertEqual(due, "2036-10-03T12:30:00.000Z")
        _ = try await core.call("saveDraft", argumentsJSON: datePayload(id, editor: current, patch: ["dueDate": due]))
        let timedRow = try storedTask(id)
        XCTAssertEqual(timedRow["dueDate"] as? String, due)
        XCTAssertEqual(timedRow["startTime"] as? String, floating)
        XCTAssertEqual(timedRow["rev"] as? Int, (before["rev"] as? Int ?? 0) + 2)
        XCTAssertEqual(try datePreservedFields(timedRow), try datePreservedFields(before))
        XCTAssertEqual(dateSaves, 2)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        await core.close()
        setenv("TZ", "UTC", 1); tzset(); NSTimeZone.default = TimeZone(identifier: "UTC")!
        let reopened = host(bundleURL: try dateBundle(at: "2026-09-28T12:00:00.000Z"))
        _ = try await reopened.start()
        let restored = try object(await reopened.call("editorModel", argumentsJSON: json([id])))
        let restoredBase = try XCTUnwrap(restored["scheduleBase"] as? [String: Any])
        XCTAssertEqual(restoredBase["dueDate"] as? String, due)
        XCTAssertEqual(restoredBase["startTime"] as? String, floating)
        XCTAssertEqual(restoredBase["reviewAt"] as? String, "2036-10-06")
        _ = try await reopened.call("saveDraft", argumentsJSON: datePayload(id, editor: restored,
            patch: ["startTime": "", "dueDate": "", "reviewAt": "", "relativeStartOffset": NSNull()]))
        let cleared = try storedTask(id)
        for name in ["startTime", "dueDate", "reviewAt", "relativeStartOffset"] { XCTAssertTrue(cleared[name] is NSNull) }
        XCTAssertEqual(try datePreservedFields(cleared), try datePreservedFields(before))
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testPreparedDateReplayFreezesDSTDayAndWeekAcrossTimezoneAndLostAcknowledgment() async throws {
        let originalZone = NSTimeZone.default
        let originalTZ = getenv("TZ").map { String(cString: $0) }
        defer {
            if let originalTZ { setenv("TZ", originalTZ, 1) } else { unsetenv("TZ") }
            tzset(); NSTimeZone.default = originalZone
        }
        for unit in ["day", "week"] {
            for afterCommit in [false, true] {
                setenv("TZ", "America/New_York", 1); tzset(); NSTimeZone.default = TimeZone(identifier: "America/New_York")!
                let id = try await seedDestinationTask()
                let sqlite = try SQLiteBridge(url: database)
                _ = try sqlite.execute("UPDATE tasks SET startTime = NULL, dueDate = ?, relativeStartOffset = NULL, pushCount = 0 WHERE id = ?",
                                       parametersJSON: json(["2026-10-30T14:00:00.000Z", id]))
                sqlite.close()
                let faults = HostIOFaults()
                let core = host(faults, bundleURL: try dateBundle(at: "2026-09-26T12:00:00.000Z"))
                _ = try await core.start()
                let before = try storedTask(id)
                let editor = try object(await core.call("editorModel", argumentsJSON: json([id])))
                let offset: [String: Any] = ["amount": -1, "unit": unit]
                let payload = try datePayload(id, editor: editor, patch: ["dueDate": "2026-11-01T15:00:00.000Z", "relativeStartOffset": offset])
                if afterCommit {
                    var writes = 0
                    faults.journalWrite = {
                        writes += 1
                        if writes == 2 { throw HostFailure("Injected date terminal phase failure") }
                    }
                } else {
                    faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected date COMMIT failure") } }
                }
                await expectFailure { _ = try await core.call("saveDraft", argumentsJSON: payload) }
                let saved = try object(String(contentsOf: journal))
                XCTAssertEqual(saved["method"] as? String, "draftCommit")
                XCTAssertNil(saved["terminal"])
                let encoded = try XCTUnwrap(saved["argumentsJSON"] as? String)
                let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(encoded.utf8)) as? [String])
                let commit = try object(args[0])
                let prepared = try XCTUnwrap(commit["prepared"] as? [String: Any])
                let changes = try XCTUnwrap(prepared["changes"] as? [String: Any])
                let expectedStart = unit == "day" ? "2026-10-31T14:00:00.000Z" : "2026-10-25T14:00:00.000Z"
                XCTAssertEqual(changes["startTime"] as? String, expectedStart)
                XCTAssertEqual(changes["dueDate"] as? String, "2026-11-01T15:00:00.000Z")
                XCTAssertEqual(try json(XCTUnwrap(changes["relativeStartOffset"])), try json(offset))
                XCTAssertEqual(changes["pushCount"] as? Int, 1)
                await core.close()
                let writer = try SQLiteBridge(url: database)
                _ = try writer.execute("UPDATE tasks SET description = ?, priority = ?, rev = rev + 1 WHERE id = ?",
                                       parametersJSON: json(["Newer independent note", "urgent", id]))
                writer.close()
                let newer = try storedTask(id)
                setenv("TZ", "UTC", 1); tzset(); NSTimeZone.default = TimeZone(identifier: "UTC")!
                let reopenFaults = HostIOFaults()
                var taskWrites = 0
                var dateSaves = 0
                var journalResolved = false
                reopenFaults.beforeSQL = { sql in
                    if !journalResolved, sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+tasks\b"#, options: .regularExpression) != nil { taskWrites += 1 }
                }
                reopenFaults.commandDiagnostic = { if $0 == "dateSave" { dateSaves += 1 } }
                reopenFaults.journalRemove = { throw HostFailure("Injected date cleanup failure") }
                let reopened = host(reopenFaults, bundleURL: try dateBundle(at: "2026-09-28T12:00:00.000Z", rejectingPreparation: true))
                await expectFailure("cleanup") { _ = try await reopened.start() }
                XCTAssertEqual(taskWrites, afterCommit ? 0 : 1)
                XCTAssertEqual(dateSaves, 1)
                let terminal = try XCTUnwrap(try object(String(contentsOf: journal))["terminal"] as? [String: Any])
                let success = try XCTUnwrap(terminal["success"] as? [String: String])
                let response = try object(XCTUnwrap(success["_0"]))
                XCTAssertEqual(response["id"] as? String, id)
                XCTAssertEqual((response["draft"] as? [String: Any])?["description"] as? String, "Newer independent note")
                let beforeMaintenance = try storedTask(id)
                // Normal activation resumes after cleanup and may persist other fixture rows.
                // Count every recovery write, then independently prove this complete row stays exact.
                reopenFaults.journalRemove = { journalResolved = true }
                _ = try await reopened.start()
                let absent = try await reopened.retryPending()
                XCTAssertNil(absent)
                XCTAssertEqual(taskWrites, afterCommit ? 0 : 1)
                XCTAssertEqual(dateSaves, 1)
                let recovered = try storedTask(id)
                XCTAssertEqual(try json(recovered), try json(beforeMaintenance))
                XCTAssertEqual(recovered["startTime"] as? String, expectedStart)
                XCTAssertEqual(recovered["dueDate"] as? String, "2026-11-01T15:00:00.000Z")
                XCTAssertEqual(try json(JSONSerialization.jsonObject(with: Data(XCTUnwrap(recovered["relativeStartOffset"] as? String).utf8))), try json(offset))
                XCTAssertEqual(recovered["pushCount"] as? Int, 1)
                XCTAssertEqual(recovered["rev"] as? Int, (before["rev"] as? Int ?? 0) + 2)
                XCTAssertEqual(try datePreservedFields(recovered), try datePreservedFields(newer))
                XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
                await reopened.close()
            }
        }
    }

    func testPreparedDateTupleConflictRetainsUnknownIntentAndIndependentEdits() async throws {
        let id = try await seedDestinationTask()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let original = try object(await core.call("editorModel", argumentsJSON: json([id])))
        _ = try await core.call("saveDraft", argumentsJSON: datePayload(id, editor: original, patch: ["dueDate": "2036-10-03"]))
        let changed = try storedTask(id)
        var journalWrites = 0
        faults.journalWrite = { journalWrites += 1 }
        do {
            _ = try await core.call("saveDraft", argumentsJSON: datePayload(id, editor: original, patch: ["startTime": "2036-10-02"]))
            XCTFail("Opening raw schedule tuple must conflict even when only start changes")
        } catch {
            XCTAssertTrue(error is CoreHostRejection)
            XCTAssertTrue(error.localizedDescription.hasPrefix("STALE_REVISION:"))
        }
        XCTAssertEqual(journalWrites, 0)
        XCTAssertEqual(try json(storedTask(id)), try json(changed))
        let editor = try object(await core.call("editorModel", argumentsJSON: json([id])))
        let payload = try datePayload(id, editor: editor, patch: ["startTime": "2036-10-02", "dueDate": "2036-10-04"])
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected date COMMIT failure") } }
        await expectFailure("SAVE_FAILED") { _ = try await core.call("saveDraft", argumentsJSON: payload) }
        let pending = try object(String(contentsOf: journal))
        let exactArguments = try XCTUnwrap(pending["argumentsJSON"] as? String)
        await core.close()
        let sqlite = try SQLiteBridge(url: database)
        // A mixture of the frozen before/after schedule is neither snapshot.
        _ = try sqlite.execute("UPDATE tasks SET startTime = ?, priority = ?, rev = rev + 1 WHERE id = ?",
                               parametersJSON: json(["2036-10-02", "urgent", id]))
        sqlite.close()
        let newer = try storedTask(id)
        let reopenFaults = HostIOFaults()
        var taskWrites = 0
        reopenFaults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+tasks\b"#, options: .regularExpression) != nil { taskWrites += 1 }
        }
        let reopened = host(reopenFaults, bundleURL: try dateBundle(at: "2026-09-28T12:00:00.000Z", rejectingPreparation: true))
        do { _ = try await reopened.start(); XCTFail("Mixed schedule replay must stay blocked") }
        catch {
            XCTAssertFalse(error is CoreHostRejection)
            XCTAssertTrue(error.localizedDescription.hasPrefix("STALE_REVISION:"))
        }
        XCTAssertEqual(taskWrites, 0)
        XCTAssertEqual(try json(storedTask(id)), try json(newer))
        let retained = try object(String(contentsOf: journal))
        XCTAssertEqual(retained["method"] as? String, "draftCommit")
        XCTAssertEqual(retained["argumentsJSON"] as? String, exactArguments)
        XCTAssertNil(retained["terminal"])
    }

    func testPreparedDateTransportAndRawLegacyJournalsFailBeforeSQLite() async throws {
        let id = try await seedDestinationTask()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let before = try storedTask(id)
        let editor = try object(await core.call("editorModel", argumentsJSON: json([id])))
        let draft = try XCTUnwrap(editor["draft"] as? [String: Any])
        let raw = try XCTUnwrap(editor["scheduleBase"] as? [String: Any])
        let request: [String: Any] = ["id": id, "base": ["dueDate": try XCTUnwrap(draft["dueDate"])], "patch": ["dueDate": "2036-10-03"], "scheduleBase": raw]
        var statements = 0
        var journalWrites = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journalWrites += 1 }
        for method in ["draftPrepare", "draftCommit"] {
            await expectFailure("unavailable") { _ = try await core.call(method, argumentsJSON: json([json(request)])) }
        }
        var malformed: [[String: Any]] = [
            request.filter { $0.key != "scheduleBase" },
            ["id": id, "base": ["title": "Destination task"], "patch": ["title": "Not a date"], "scheduleBase": raw],
            ["id": id, "base": ["relativeStartOffset": NSNull()], "patch": ["relativeStartOffset": ["amount": true, "unit": "day"]], "scheduleBase": raw],
            ["id": id, "base": ["relativeStartOffset": NSNull()], "patch": ["relativeStartOffset": ["amount": 1.5, "unit": "day"]], "scheduleBase": raw],
            ["id": id, "base": ["dueDate": "2036-10-02"], "patch": ["dueDate": NSNull()], "scheduleBase": raw],
        ]
        var incomplete = request
        incomplete["scheduleBase"] = raw.filter { $0.key != "reviewAt" }
        malformed.append(incomplete)
        for input in malformed { await expectFailure("INVALID_INPUT") { _ = try await core.call("saveDraft", argumentsJSON: json([json(input)])) } }
        await expectFailure("INVALID_INPUT") { _ = try await core.call("saveDraft", argumentsJSON: datePayload(id, editor: editor, patch: ["dueDate": "not-a-date"])) }
        await expectFailure("INVALID_INPUT") {
            _ = try await core.call("saveDraft", argumentsJSON: datePayload(id, editor: editor,
                patch: ["dueDate": "2036-10-03", "projectId": "destination-project-deleted", "sectionId": "", "areaId": ""]))
        }
        let protectedID = id + "-protected"
        let protected = try storedTask(protectedID)
        let protectedEditor = try object(await core.call("editorModel", argumentsJSON: json([protectedID])))
        await expectFailure("INVALID_INPUT") { _ = try await core.call("saveDraft", argumentsJSON: datePayload(protectedID, editor: protectedEditor, patch: ["dueDate": "2036-10-03"])) }
        XCTAssertEqual(statements, 0)
        XCTAssertEqual(journalWrites, 0)
        XCTAssertEqual(try json(storedTask(id)), try json(before))
        XCTAssertEqual(try json(storedTask(protectedID)), try json(protected))
        await core.close()
        let rawArguments = try json([json(request)])
        var different = request
        different["id"] = "different-task"
        let commands: [[String: Any]] = try [
            ["version": 2, "method": "saveDraft", "argumentsJSON": rawArguments],
            ["version": 2, "method": "saveDraft", "argumentsJSON": json([json(request.filter { $0.key != "scheduleBase" })])],
            ["version": 2, "method": "draftCommit", "argumentsJSON": json([json(["request": request, "prepared": ["version": true, "request": request]])])],
            ["version": 2, "method": "draftCommit", "argumentsJSON": json([json(["request": request, "prepared": ["version": "1", "request": request]])])],
            ["version": 2, "method": "draftCommit", "argumentsJSON": json([json(["request": request, "prepared": ["version": 1, "request": different]])])],
        ]
        for command in commands {
            let saved = Data(try json(command).utf8)
            try saved.write(to: journal)
            let mainBefore = try Data(contentsOf: database)
            let wal = URL(fileURLWithPath: database.path + "-wal")
            let walBefore = try? Data(contentsOf: wal)
            await expectFailure { _ = try await host(faults).start() }
            XCTAssertEqual(statements, 0)
            XCTAssertEqual(journalWrites, 0)
            XCTAssertEqual(try Data(contentsOf: journal), saved)
            XCTAssertEqual(try Data(contentsOf: database), mainBefore)
            XCTAssertEqual(try? Data(contentsOf: wal), walBefore)
        }
    }

    func testPreparedDateDecoderRejectsTamperedChangesWithoutWriting() async throws {
        let id = try await seedDestinationTask()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let editor = try object(await core.call("editorModel", argumentsJSON: json([id])))
        let before = try storedTask(id)
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected date COMMIT failure") } }
        await expectFailure("SAVE_FAILED") { _ = try await core.call("saveDraft", argumentsJSON: datePayload(id, editor: editor, patch: ["dueDate": "2036-10-03"])) }
        let saved = try object(String(contentsOf: journal))
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(saved["argumentsJSON"] as? String).utf8)) as? [String])
        let commit = try object(args[0])
        let prepared = try XCTUnwrap(commit["prepared"] as? [String: Any])
        let request = try XCTUnwrap(commit["request"])
        await core.close()
        var invalid: [[String: Any]] = []
        for (field, value) in [("title", "Unrequested title" as Any), ("dueDate", NSNull() as Any), ("rev", 999 as Any)] {
            var candidate = prepared
            var changes = try XCTUnwrap(prepared["changes"] as? [String: Any])
            changes[field] = value
            candidate["changes"] = changes
            invalid.append(candidate)
        }
        var unknown = prepared
        unknown["unexpected"] = true
        invalid.append(unknown)
        for candidate in invalid {
            let exactArguments = try json([json(["request": request, "prepared": candidate])])
            try Data(json(["version": 2, "method": "draftCommit", "argumentsJSON": exactArguments]).utf8).write(to: journal)
            let replayFaults = HostIOFaults()
            var taskWrites = 0
            replayFaults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+tasks\b"#, options: .regularExpression) != nil { taskWrites += 1 }
            }
            let reopened = host(replayFaults, bundleURL: try dateBundle(at: "2026-09-28T12:00:00.000Z", rejectingPreparation: true))
            await expectFailure("INVALID_INPUT") { _ = try await reopened.start() }
            XCTAssertEqual(taskWrites, 0)
            XCTAssertEqual(try json(storedTask(id)), try json(before))
            XCTAssertEqual(try object(String(contentsOf: journal))["argumentsJSON"] as? String, exactArguments)
            await reopened.close()
        }
    }

    func testPreparedDateInitialCommitStaleRejectionHasTerminalCleanup() async throws {
        let id = try await seedDestinationTask()
        let faults = HostIOFaults()
        let source = try dateBundle(at: "2026-09-26T12:00:00.000Z", suffix: """
        (() => {
            const poll = MindwtrHost.poll;
            let rejected = false;
            MindwtrHost.draftCommit = function () { rejected = true; return '2147483647'; };
            MindwtrHost.poll = function (id) {
                if (id === '2147483647' && rejected) {
                    rejected = false;
                    return JSON.stringify({ok: false, error: 'STALE_REVISION: Injected initial prepared date conflict'});
                }
                return poll(id);
            };
        })();
        """)
        let core = host(faults, bundleURL: source)
        _ = try await core.start()
        let before = try storedTask(id)
        let editor = try object(await core.call("editorModel", argumentsJSON: json([id])))
        let payload = try datePayload(id, editor: editor, patch: ["dueDate": "2036-10-03"])
        do { _ = try await core.call("saveDraft", argumentsJSON: payload); XCTFail("Expected initial commit refusal") }
        catch {
            XCTAssertTrue(error is CoreHostRejection)
            XCTAssertTrue(error.localizedDescription.hasPrefix("STALE_REVISION:"))
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        faults.journalRemove = { throw HostFailure("Injected stale date cleanup failure") }
        await expectFailure("cleanup") { _ = try await core.call("saveDraft", argumentsJSON: payload) }
        let pending = try object(String(contentsOf: journal))
        XCTAssertNotNil((pending["terminal"] as? [String: Any])?["rejected"])
        await core.close()
        let reopenFaults = HostIOFaults()
        var taskWrites = 0
        var cleanupReached = false
        reopenFaults.journalRemove = {
            XCTAssertEqual(taskWrites, 0)
            XCTAssertEqual(try self.json(self.storedTask(id)), try self.json(before))
            cleanupReached = true
        }
        reopenFaults.beforeSQL = { sql in
            if !cleanupReached, sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+tasks\b"#, options: .regularExpression) != nil { taskWrites += 1 }
        }
        let reopened = host(reopenFaults, bundleURL: try dateBundle(at: "2026-09-28T12:00:00.000Z", rejectingPreparation: true))
        _ = try await reopened.start()
        let absent = try await reopened.retryPending()
        XCTAssertNil(absent)
        XCTAssertTrue(cleanupReached)
        XCTAssertEqual(taskWrites, 0)
        // Ordinary activation may canonicalize nested fixture JSON. Every
        // scalar, raw date, revision and nested value must still be unchanged.
        XCTAssertEqual(try datePreservedFields(storedTask(id), excluding: []), try datePreservedFields(before, excluding: []))
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testPreparedDateFailedJournalPromotionRetriesWithoutPreparingAgain() async throws {
        let id = try await seedDestinationTask()
        let source = try dateBundle(at: "2026-09-26T12:00:00.000Z", suffix: """
        (() => {
            const prepare = MindwtrHost.draftPrepare;
            let calls = 0;
            MindwtrHost.draftPrepare = function (input) {
                if (++calls > 1) throw new Error('Date intent was prepared twice');
                return prepare(input);
            };
        })();
        """)
        let faults = HostIOFaults()
        let core = host(faults, bundleURL: source)
        _ = try await core.start()
        let before = try storedTask(id)
        let editor = try object(await core.call("editorModel", argumentsJSON: json([id])))
        var taskWrites = 0
        faults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+tasks\b"#, options: .regularExpression) != nil { taskWrites += 1 }
        }
        faults.journalWrite = { throw HostFailure("Injected date journal promotion failure") }
        await expectFailure("journal promotion") { _ = try await core.call("saveDraft", argumentsJSON: datePayload(id, editor: editor, patch: ["reviewAt": "2036-10-06"])) }
        XCTAssertEqual(taskWrites, 0)
        XCTAssertEqual(try json(storedTask(id)), try json(before))
        await expectFailure("exact retry") { _ = try await core.call("editorModel", argumentsJSON: json([id])) }
        faults.journalWrite = nil
        let acknowledgment = try await core.retryPending()
        XCTAssertEqual(try object(XCTUnwrap(acknowledgment))["id"] as? String, id)
        XCTAssertEqual(taskWrites, 1)
        XCTAssertEqual(try storedTask(id)["reviewAt"] as? String, "2036-10-06")
        XCTAssertEqual(try storedTask(id)["rev"] as? Int, (before["rev"] as? Int ?? 0) + 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testTokenSuggestionsAndCanonicalSavePreserveOtherFields() async throws {
        let id = try await seedDestinationTask()
        let sqlite = try SQLiteBridge(url: database)
        let at = "2026-09-01T12:00:00.000Z"
        _ = try sqlite.execute("INSERT INTO tasks (id, title, status, contexts, tags, isFocusedToday, showFutureRecurrence, suppressMindwtrReminders, pushCount, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["token-pool", "Token pool", "reference",
                                                     json(["@desk", "@office", "@home", "@online", "@outdoors", "@oncall", "@other", "@seven"]),
                                                     json(["#keep", "#launch", "#later", "#language", "#label", "#last", "#lunar", "#seventh"]),
                                                     0, 0, 0, 0, at, at, 1]))
        sqlite.close()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let before = try storedTask(id)
        let editor = try object(await core.call("editorModel", argumentsJSON: json([id])))
        let draft = try XCTUnwrap(editor["draft"] as? [String: Any])
        var statements = 0
        var taskWrites = 0
        var journalWrites = 0
        faults.beforeSQL = { sql in
            statements += 1
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+tasks\b"#, options: .regularExpression) != nil { taskWrites += 1 }
        }
        faults.journalWrite = { journalWrites += 1 }
        func suggest(_ field: String, _ query: String) async throws -> [String: Any] {
            try object(await core.call("editorSuggestions", argumentsJSON: json([id, field, query, 4])))
        }
        let suggestions = try await suggest("contexts", "  desk, o")
        XCTAssertEqual(suggestions["draftValue"] as? String, "@desk, @o")
        let matches = try XCTUnwrap(suggestions["matches"] as? [[String: Any]])
        XCTAssertEqual(matches.count, 4)
        let match = try XCTUnwrap(matches.first)
        let value = try XCTUnwrap(match["value"] as? String)
        XCTAssertTrue(value.hasPrefix("@"))
        XCTAssertTrue(value.lowercased().contains("o"))
        XCTAssertEqual(match["text"] as? String, "  desk, \(value), ")
        let replaced = try await suggest("contexts", XCTUnwrap(match["text"] as? String))
        XCTAssertEqual(replaced["draftValue"] as? String, "@desk, \(value)")
        let quick = try XCTUnwrap(suggestions["quick"] as? [[String: Any]])
        XCTAssertEqual(quick.count, 6)
        let selected = try XCTUnwrap(quick.first { $0["value"] as? String == "@desk" })
        XCTAssertEqual(selected["selected"] as? Bool, true)
        XCTAssertEqual(selected["text"] as? String, "@o")
        let toggled = try await suggest("contexts", XCTUnwrap(selected["text"] as? String))
        let addBack = try XCTUnwrap((toggled["quick"] as? [[String: Any]])?.first { $0["value"] as? String == "@desk" })
        XCTAssertEqual(addBack["selected"] as? Bool, false)
        XCTAssertEqual(addBack["text"] as? String, "@o, @desk")
        let tagMatches = try await suggest("tags", "keep, la")
        XCTAssertEqual((tagMatches["matches"] as? [Any])?.count, 4)
        XCTAssertEqual((tagMatches["quick"] as? [Any])?.count, 6)
        let contexts = try await suggest("contexts", " desk , @desk , #home , ")
        let tags = try await suggest("tags", " keep , #keep , @launch , ")
        let patch = ["contexts": try XCTUnwrap(contexts["draftValue"] as? String), "tags": try XCTUnwrap(tags["draftValue"] as? String)]
        XCTAssertEqual(patch, ["contexts": "@desk, @home", "tags": "#keep, #launch"])
        let edited = try object(await core.call("editDraft", argumentsJSON: json([json([
            "id": id, "draft": draft, "edit": ["type": "fields", "patch": patch],
        ])])))
        let next = try XCTUnwrap(edited["draft"] as? [String: Any])
        for (field, value) in patch { XCTAssertEqual(next[field] as? String, value) }
        XCTAssertEqual(try json(next.filter { patch[$0.key] == nil }), try json(draft.filter { patch[$0.key] == nil }))
        XCTAssertEqual(statements, 0)
        XCTAssertEqual(journalWrites, 0)
        _ = try await core.call("saveDraft", argumentsJSON: json([json(["id": id,
            "base": ["contexts": "@desk", "tags": "#keep"], "patch": patch])]))
        XCTAssertEqual(taskWrites, 1)
        let persisted = try storedTask(id)
        XCTAssertEqual(try json(JSONSerialization.jsonObject(with: Data(XCTUnwrap(persisted["contexts"] as? String).utf8))), try json(["@desk", "@home"]))
        XCTAssertEqual(try json(JSONSerialization.jsonObject(with: Data(XCTUnwrap(persisted["tags"] as? String).utf8))), try json(["#keep", "#launch"]))
        XCTAssertEqual(try tokenPreservedFields(persisted), try tokenPreservedFields(before))
        XCTAssertEqual(persisted["rev"] as? Int, (before["rev"] as? Int ?? 0) + 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        await core.close()
        let reopened = host()
        _ = try await reopened.start()
        let restored = try object(await reopened.call("editorModel", argumentsJSON: json([id])))
        for (field, value) in patch { XCTAssertEqual((restored["draft"] as? [String: Any])?[field] as? String, value) }
        _ = try await reopened.call("saveDraft", argumentsJSON: json([json(["id": id, "base": patch, "patch": ["contexts": "", "tags": ""]])]))
        let cleared = try storedTask(id)
        XCTAssertEqual(cleared["contexts"] as? String, "[]")
        XCTAssertEqual(cleared["tags"] as? String, "[]")
        XCTAssertEqual(try tokenPreservedFields(cleared), try tokenPreservedFields(before))
        XCTAssertEqual(cleared["rev"] as? Int, (before["rev"] as? Int ?? 0) + 2)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testTokenExactReplayAfterFailedCommitAndLostAcknowledgmentUsesSavedNormalization() async throws {
        for afterCommit in [false, true] {
            let id = try await seedDestinationTask()
            let faults = HostIOFaults()
            var tokenReplays = 0
            faults.commandDiagnostic = { if $0 == "tokenReplay" { tokenReplays += 1 } }
            let core = host(faults)
            _ = try await core.start()
            let before = try storedTask(id)
            var patch: [String: String] = [:]
            for (field, query) in [("contexts", "@@office, @office"), ("tags", "##launch, #launch")] {
                let suggestions = try object(await core.call("editorSuggestions", argumentsJSON: json([id, field, query, 4])))
                patch[field] = try XCTUnwrap(suggestions["draftValue"] as? String)
            }
            let payload = try json([json(["id": id, "base": ["contexts": "@desk", "tags": "#keep"], "patch": patch])])
            if afterCommit {
                var writes = 0
                faults.journalWrite = {
                    writes += 1
                    if writes == 2 { throw HostFailure("Injected token terminal phase failure") }
                }
            } else {
                faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected token COMMIT failure") } }
            }
            await expectFailure { _ = try await core.call("saveDraft", argumentsJSON: payload) }
            XCTAssertEqual(tokenReplays, 0)
            let pending = try object(String(contentsOf: journal))
            XCTAssertEqual(pending["method"] as? String, "saveDraft")
            XCTAssertEqual(pending["argumentsJSON"] as? String, payload)
            XCTAssertNil(pending["terminal"])
            let attempted = try storedTask(id)
            XCTAssertEqual(attempted["contexts"] as? String, afterCommit ? "[\"@office\",\"@office\"]" : "[\"@desk\"]")
            XCTAssertEqual(attempted["tags"] as? String, afterCommit ? "[\"#launch\",\"#launch\"]" : "[\"#keep\"]")
            await expectFailure("exact retry") { _ = try await core.call("editorSuggestions", argumentsJSON: json([id, "tags", "", 4])) }
            await core.close()
            let sqlite = try SQLiteBridge(url: database)
            _ = try sqlite.execute("UPDATE tasks SET priority = ?, rev = rev + 1 WHERE id = ?", parametersJSON: json(["urgent", id]))
            sqlite.close()
            let newer = try storedTask(id)
            let reopenFaults = HostIOFaults()
            var taskWrites = 0
            reopenFaults.commandDiagnostic = { if $0 == "tokenReplay" { tokenReplays += 1 } }
            reopenFaults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+tasks\b"#, options: .regularExpression) != nil { taskWrites += 1 }
            }
            reopenFaults.journalRemove = { throw HostFailure("Injected token cleanup failure") }
            let reopened = host(reopenFaults)
            await expectFailure("cleanup") { _ = try await reopened.start() }
            XCTAssertEqual(taskWrites, afterCommit ? 0 : 1)
            XCTAssertEqual(tokenReplays, afterCommit ? 1 : 0)
            let terminal = try XCTUnwrap(try object(String(contentsOf: journal))["terminal"] as? [String: Any])
            let success = try XCTUnwrap(terminal["success"] as? [String: String])
            let acknowledgment = try XCTUnwrap(success["_0"])
            let response = try XCTUnwrap(try object(acknowledgment)["draft"] as? [String: Any])
            XCTAssertEqual(response["contexts"] as? String, "@office, @office")
            XCTAssertEqual(response["tags"] as? String, "#launch, #launch")
            XCTAssertEqual(response["priority"] as? String, "urgent")
            reopenFaults.journalRemove = nil
            _ = try await reopened.start()
            let retried = try await reopened.retryPending()
            XCTAssertNil(retried)
            XCTAssertEqual(taskWrites, afterCommit ? 0 : 1)
            XCTAssertEqual(tokenReplays, afterCommit ? 1 : 0)
            let recovered = try storedTask(id)
            XCTAssertEqual(recovered["contexts"] as? String, "[\"@office\",\"@office\"]")
            XCTAssertEqual(recovered["tags"] as? String, "[\"#launch\",\"#launch\"]")
            XCTAssertEqual(recovered["rev"] as? Int, (before["rev"] as? Int ?? 0) + 2)
            XCTAssertEqual(try tokenPreservedFields(recovered), try tokenPreservedFields(newer))
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            await reopened.close()
        }
    }

    func testTokenConflictsRefuseDirectAndUnknownReplayWithoutLosingNewerFields() async throws {
        let id = try await seedDestinationTask()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let original = ["contexts": "@desk", "tags": "#keep"]
        let first = ["contexts": "@first", "tags": "#first"]
        _ = try await core.call("saveDraft", argumentsJSON: json([json(["id": id, "base": original, "patch": first])]))
        let moved = try storedTask(id)
        do {
            _ = try await core.call("saveDraft", argumentsJSON: json([json(["id": id, "base": original, "patch": ["contexts": "@stale", "tags": "#stale"]])]))
            XCTFail("Expected initial token conflict")
        } catch {
            XCTAssertTrue(error is CoreHostRejection)
            XCTAssertTrue(error.localizedDescription.hasPrefix("STALE_REVISION:"))
        }
        XCTAssertEqual(try json(storedTask(id)), try json(moved))
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        let payload = try json([json(["id": id, "base": first, "patch": ["contexts": "@pending", "tags": "#pending"]])])
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected token COMMIT failure") } }
        await expectFailure("SAVE_FAILED") { _ = try await core.call("saveDraft", argumentsJSON: payload) }
        await core.close()
        let sqlite = try SQLiteBridge(url: database)
        _ = try sqlite.execute("UPDATE tasks SET contexts = ?, tags = ?, priority = ?, rev = rev + 1 WHERE id = ?",
                               parametersJSON: json([json(["@newer"]), json(["#newer"]), "urgent", id]))
        sqlite.close()
        let newer = try storedTask(id)
        let reopenFaults = HostIOFaults()
        var taskWrites = 0
        reopenFaults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+tasks\b"#, options: .regularExpression) != nil { taskWrites += 1 }
        }
        let reopened = host(reopenFaults)
        do { _ = try await reopened.start(); XCTFail("Unknown token replay conflict must block") }
        catch {
            XCTAssertFalse(error is CoreHostRejection)
            XCTAssertTrue(error.localizedDescription.hasPrefix("STALE_REVISION:"))
        }
        XCTAssertEqual(taskWrites, 0)
        XCTAssertEqual(try json(storedTask(id)), try json(newer))
        let pending = try object(String(contentsOf: journal))
        XCTAssertEqual(pending["method"] as? String, "saveDraft")
        XCTAssertEqual(pending["argumentsJSON"] as? String, payload)
        XCTAssertNil(pending["terminal"])
    }

    func testTokenValidationAndReadOnlyParentRejectWithoutTaskWrites() async throws {
        let id = try await seedDestinationTask()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let before = try storedTask(id)
        var statements = 0
        var journalWrites = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journalWrites += 1 }
        let invalid: [[Any]] = [
            [id, "contexts", "", true], [id, "tags", "", 4.5], [id, "tags", "", "4"],
            [id, "tags", "", 0], [id, "contexts", "", 101], [id, "title", "", 4],
            [id, "tags", 7, 4], [id, "contexts", String(repeating: "x", count: 2001), 4],
            [id, "tags", ""], [7, "tags", "", 4], [id, "tags", NSNull(), 4],
        ]
        for arguments in invalid {
            await expectFailure { _ = try await core.call("editorSuggestions", argumentsJSON: json(arguments)) }
        }
        await expectFailure("TASK_NOT_FOUND") { _ = try await core.call("editorSuggestions", argumentsJSON: json(["missing-token-task", "tags", "", 4])) }
        for patch in [["contexts": ["@invalid"]] as [String: Any], ["tags": NSNull()], ["assignedTo": "Outside slice"]] {
            let field = try XCTUnwrap(patch.keys.first)
            await expectFailure("matching supported draft fields") {
                _ = try await core.call("saveDraft", argumentsJSON: json([json(["id": id, "base": [field: ""], "patch": patch])]))
            }
        }
        XCTAssertEqual(statements, 0)
        XCTAssertEqual(journalWrites, 0)
        XCTAssertEqual(try json(storedTask(id)), try json(before))
        let protectedID = id + "-protected"
        let protected = try storedTask(protectedID)
        do {
            _ = try await core.call("saveDraft", argumentsJSON: json([json(["id": protectedID,
                "base": ["contexts": "", "tags": ""], "patch": ["contexts": "@blocked", "tags": "#blocked"]])]))
            XCTFail("Expected read-only token refusal")
        } catch {
            XCTAssertTrue(error is CoreHostRejection)
            XCTAssertTrue(error.localizedDescription.contains("read-only"))
        }
        XCTAssertEqual(statements, 0)
        XCTAssertEqual(try json(storedTask(protectedID)), try json(protected))
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testTextEditorExactRetryAfterCommitFailureAndLostAcknowledgment() async throws {
        for afterCommit in [false, true] {
            let faults = HostIOFaults()
            let core = host(faults)
            _ = try await core.start()
            let id = UUID().uuidString.lowercased()
            _ = try await core.call("captureSubmit", argumentsJSON: capture(core, title: "Before edit", id: id))
            let before = try storedTask(id)
            let rawTitle = "  Renamed ü 😀  "
            let rawNote = "\n  Exact raw note  \n"
            let metadata: [String: String] = ["priority": "urgent", "energyLevel": "high", "timeEstimate": "30min"]
            let payload = try json([json(["id": id,
                "base": ["title": "Before edit", "description": "", "priority": "", "energyLevel": "", "timeEstimate": ""],
                "patch": ["title": rawTitle, "description": rawNote, "priority": "urgent", "energyLevel": "high", "timeEstimate": "30min"]])])
            if afterCommit {
                // Leave an unknown journal even though SQLite committed, forcing
                // core replay after restart instead of terminal-result cleanup.
                var journalWrites = 0
                faults.journalWrite = {
                    journalWrites += 1
                    if journalWrites == 2 { throw HostFailure("Injected editor terminal phase failure") }
                }
            } else {
                faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected editor COMMIT failure") } }
            }
            await expectFailure { _ = try await core.call("saveDraft", argumentsJSON: payload) }
            let saved = try object(String(contentsOf: journal))
            XCTAssertEqual(saved["method"] as? String, "saveDraft")
            XCTAssertEqual(Data(try XCTUnwrap(saved["argumentsJSON"] as? String).utf8), Data(payload.utf8))
            XCTAssertNil(saved["terminal"])
            await expectFailure("exact retry") { _ = try await core.call("editorModel", argumentsJSON: json([id])) }
            let attempted = try storedTask(id)
            XCTAssertEqual(attempted["title"] as? String, afterCommit ? "Renamed ü 😀" : "Before edit")
            for (field, value) in metadata {
                if afterCommit { XCTAssertEqual(attempted[field] as? String, value) }
                else { XCTAssertTrue(attempted[field] is NSNull) }
            }
            await core.close()
            let reopenFaults = HostIOFaults()
            var taskWrites = 0
            reopenFaults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+tasks\b"#, options: .regularExpression) != nil { taskWrites += 1 }
            }
            // Hold the terminal response so startup replay's acknowledgment is
            // checked before cleanup and normal activation can finish.
            reopenFaults.journalRemove = { throw HostFailure("Injected editor cleanup failure") }
            let reopened = host(reopenFaults)
            await expectFailure("cleanup") { _ = try await reopened.start() }
            XCTAssertEqual(taskWrites, afterCommit ? 0 : 1)
            let terminal = try XCTUnwrap(try object(String(contentsOf: journal))["terminal"] as? [String: Any])
            let success = try XCTUnwrap(terminal["success"] as? [String: String])
            let response = try object(XCTUnwrap(success["_0"]))
            XCTAssertEqual((response["draft"] as? [String: Any])?["title"] as? String, "Renamed ü 😀")
            XCTAssertEqual((response["draft"] as? [String: Any])?["description"] as? String, rawNote)
            for (field, value) in metadata { XCTAssertEqual((response["draft"] as? [String: Any])?[field] as? String, value) }
            reopenFaults.journalRemove = nil
            _ = try await reopened.start()
            XCTAssertEqual(taskWrites, afterCommit ? 0 : 1)
            let recovered = try storedTask(id)
            XCTAssertEqual(recovered["title"] as? String, "Renamed ü 😀")
            XCTAssertEqual(recovered["description"] as? String, rawNote)
            for (field, value) in metadata { XCTAssertEqual(recovered[field] as? String, value) }
            XCTAssertEqual(recovered["rev"] as? Int, (before["rev"] as? Int ?? 0) + 1)
            let changed: Set<String> = ["title", "description", "priority", "energyLevel", "timeEstimate", "rev", "revBy", "updatedAt"]
            XCTAssertEqual(try json(before.filter { !changed.contains($0.key) }), try json(recovered.filter { !changed.contains($0.key) }))
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            await reopened.close()
        }
    }

    func testTextEditorInProcessRetryReturnsSavedDraft() async throws {
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let id = UUID().uuidString.lowercased()
        _ = try await core.call("captureSubmit", argumentsJSON: capture(core, title: "Before retry", id: id))
        let before = try storedTask(id)
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected editor COMMIT failure") } }
        await expectFailure("SAVE_FAILED") {
            _ = try await core.call("saveDraft", argumentsJSON: json([json(["id": id,
                "base": ["title": "Before retry", "description": ""],
                "patch": ["title": "After retry", "description": "Keep this note"]])]))
        }
        XCTAssertEqual(try storedTask(id)["title"] as? String, "Before retry")
        faults.beforeSQL = nil
        let retried = try await core.retryPending()
        let response = try object(XCTUnwrap(retried))
        XCTAssertEqual(response["id"] as? String, id)
        XCTAssertEqual((response["draft"] as? [String: Any])?["title"] as? String, "After retry")
        XCTAssertEqual((response["draft"] as? [String: Any])?["description"] as? String, "Keep this note")
        XCTAssertEqual(try storedTask(id)["rev"] as? Int, (before["rev"] as? Int ?? 0) + 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        let absent = try await core.retryPending()
        XCTAssertNil(absent)
    }

    func testTextEditorConflictsAreNoWriteInitiallyAndRemainBlockedDuringReplay() async throws {
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let id = UUID().uuidString.lowercased()
        _ = try await core.call("captureSubmit", argumentsJSON: capture(core, title: "Original", id: id))
        _ = try await core.call("saveDraft", argumentsJSON: json([json(["id": id, "base": ["title": "Original"], "patch": ["title": "First edit"]])]))
        let first = try storedTask(id)
        do {
            _ = try await core.call("saveDraft", argumentsJSON: json([json(["id": id, "base": ["title": "Original"], "patch": ["title": "Conflicting edit"]])]))
            XCTFail("Expected initial editor conflict")
        } catch {
            XCTAssertTrue(error is CoreHostRejection)
            XCTAssertTrue(error.localizedDescription.hasPrefix("STALE_REVISION:"))
        }
        XCTAssertEqual(try json(storedTask(id)), try json(first))
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected editor COMMIT failure") } }
        await expectFailure("SAVE_FAILED") {
            _ = try await core.call("saveDraft", argumentsJSON: json([json(["id": id, "base": ["title": "First edit"], "patch": ["title": "Pending edit"]])]))
        }
        await core.close()
        let sqlite = try SQLiteBridge(url: database)
        _ = try sqlite.execute("UPDATE tasks SET title = ?, rev = rev + 1 WHERE id = ?", parametersJSON: json(["Newer external edit", id]))
        sqlite.close()
        let newer = try storedTask(id)
        let reopened = host()
        do { _ = try await reopened.start(); XCTFail("Ambiguous replay conflict must block") }
        catch {
            XCTAssertFalse(error is CoreHostRejection)
            XCTAssertTrue(error.localizedDescription.hasPrefix("STALE_REVISION:"))
        }
        XCTAssertEqual(try json(storedTask(id)), try json(newer))
        XCTAssertTrue(FileManager.default.fileExists(atPath: journal.path))
        await expectFailure("not ready") { _ = try await reopened.call("editorModel", argumentsJSON: json([id])) }
    }

    func testEditorMetadataValidationAndConcurrentRecoveryConflict() async throws {
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let id = UUID().uuidString.lowercased()
        _ = try await core.call("captureSubmit", argumentsJSON: capture(core, title: "Metadata conflict", id: id))
        let original = try storedTask(id)
        let editor = try object(await core.call("editorModel", argumentsJSON: json([id])))
        let draft = try XCTUnwrap(editor["draft"] as? [String: Any])
        var statements = 0
        faults.beforeSQL = { _ in statements += 1 }
        for (field, invalid) in [("priority", "highest"), ("energyLevel", "urgent"), ("timeEstimate", "not-an-estimate")] {
            await expectFailure("INVALID_INPUT") {
                _ = try await core.call("editDraft", argumentsJSON: json([json([
                    "id": id, "draft": draft, "edit": ["type": "fields", "patch": [field: invalid]],
                ])]))
            }
            do {
                _ = try await core.call("saveDraft", argumentsJSON: json([json(["id": id, "base": [field: ""], "patch": [field: invalid]])]))
                XCTFail("Expected metadata validation refusal")
            } catch {
                XCTAssertTrue(error is CoreHostRejection)
                XCTAssertTrue(error.localizedDescription.hasPrefix("INVALID_INPUT:"))
            }
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            _ = try await core.call("editorModel", argumentsJSON: json([id]))
        }
        for malformed in ["[]", "null"] {
            // Foundation may reject a JSON fragment before the object-shape
            // guard. Both paths must reject without depending on parser wording.
            await expectFailure { _ = try await core.call("editDraft", argumentsJSON: json([malformed])) }
        }
        XCTAssertEqual(statements, 0)
        XCTAssertEqual(try json(storedTask(id)), try json(original))
        faults.beforeSQL = nil
        _ = try await core.call("saveDraft", argumentsJSON: json([json(["id": id,
            "base": ["priority": "", "energyLevel": "", "timeEstimate": ""],
            "patch": ["priority": "urgent", "energyLevel": "high", "timeEstimate": "30min"]])]))
        let saved = try storedTask(id)
        do {
            _ = try await core.call("saveDraft", argumentsJSON: json([json(["id": id,
                "base": ["priority": "", "description": ""], "patch": ["priority": "low", "description": "Must stay unsaved"]])]))
            XCTFail("Expected same-field metadata conflict")
        } catch {
            XCTAssertTrue(error is CoreHostRejection)
            XCTAssertTrue(error.localizedDescription.hasPrefix("STALE_REVISION:"))
        }
        XCTAssertEqual(try json(storedTask(id)), try json(saved))
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected metadata COMMIT failure") } }
        await expectFailure("SAVE_FAILED") {
            _ = try await core.call("saveDraft", argumentsJSON: json([json(["id": id,
                "base": ["priority": "urgent"], "patch": ["priority": "low"]])]))
        }
        await core.close()
        let sqlite = try SQLiteBridge(url: database)
        _ = try sqlite.execute("UPDATE tasks SET priority = ?, rev = rev + 1 WHERE id = ?", parametersJSON: json(["medium", id]))
        sqlite.close()
        let newer = try storedTask(id)
        let reopened = host()
        do { _ = try await reopened.start(); XCTFail("Unknown metadata replay conflict must block") }
        catch {
            XCTAssertFalse(error is CoreHostRejection)
            XCTAssertTrue(error.localizedDescription.hasPrefix("STALE_REVISION:"))
        }
        XCTAssertEqual(try json(storedTask(id)), try json(newer))
        XCTAssertTrue(FileManager.default.fileExists(atPath: journal.path))
    }

    func testReferenceMetadataRejectsHiddenWritesAndReplaysAllowedFieldsOnce() async throws {
        let writer = host()
        _ = try await writer.start()
        let id = UUID().uuidString.lowercased()
        _ = try await writer.call("captureSubmit", argumentsJSON: capture(writer, title: "Reference original", id: id))
        await writer.close()
        let sqlite = try SQLiteBridge(url: database)
        _ = try sqlite.execute("UPDATE tasks SET status = 'reference' WHERE id = ?", parametersJSON: json([id]))
        sqlite.close()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let before = try storedTask(id)
        var taskWrites = 0
        faults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+tasks\b"#, options: .regularExpression) != nil { taskWrites += 1 }
        }
        for (field, value) in [("priority", "urgent"), ("timeEstimate", "30min")] {
            do {
                _ = try await core.call("saveDraft", argumentsJSON: json([json(["id": id,
                    "base": [field: "", "description": ""],
                    "patch": [field: value, "description": "Must remain unsaved"]])]))
                XCTFail("Reference must reject nonempty hidden metadata")
            } catch {
                XCTAssertTrue(error is CoreHostRejection)
                XCTAssertTrue(error.localizedDescription.hasPrefix("INVALID_INPUT:"))
            }
            XCTAssertEqual(try json(storedTask(id)), try json(before))
            XCTAssertEqual(taskWrites, 0)
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        }
        let payload = try json([json(["id": id,
            "base": ["title": "Reference original", "description": "", "priority": "", "energyLevel": "", "timeEstimate": ""],
            "patch": ["title": "Reference edited", "description": "Saved reference note", "priority": "", "energyLevel": "high", "timeEstimate": ""]])])
        var journalWrites = 0
        faults.journalWrite = {
            journalWrites += 1
            if journalWrites == 2 { throw HostFailure("Injected Reference acknowledgment failure") }
        }
        await expectFailure("acknowledgment") { _ = try await core.call("saveDraft", argumentsJSON: payload) }
        XCTAssertEqual(taskWrites, 1)
        XCTAssertNil(try object(String(contentsOf: journal))["terminal"])
        let committed = try storedTask(id)
        XCTAssertEqual(committed["status"] as? String, "reference")
        XCTAssertEqual(committed["title"] as? String, "Reference edited")
        XCTAssertEqual(committed["description"] as? String, "Saved reference note")
        XCTAssertEqual(committed["energyLevel"] as? String, "high")
        XCTAssertTrue(committed["priority"] is NSNull)
        XCTAssertTrue(committed["timeEstimate"] is NSNull)
        XCTAssertEqual(committed["rev"] as? Int, (before["rev"] as? Int ?? 0) + 1)
        await core.close()
        let reopenFaults = HostIOFaults()
        var replayWrites = 0
        reopenFaults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+tasks\b"#, options: .regularExpression) != nil { replayWrites += 1 }
        }
        let reopened = host(reopenFaults)
        _ = try await reopened.start()
        XCTAssertEqual(replayWrites, 0)
        XCTAssertEqual(try json(storedTask(id)), try json(committed))
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testTextEditorRejectsUnsupportedTransportBeforeJournalAndOnReplay() async throws {
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let id = UUID().uuidString.lowercased()
        _ = try await core.call("captureSubmit", argumentsJSON: capture(core, id: id))
        let malformed: [[String: Any]] = [
            ["id": id, "base": [String: String](), "patch": [String: String]()],
            ["id": id, "base": ["title": "Before"], "patch": ["description": "After"]],
            ["id": id, "base": ["title": "Before"], "patch": ["title": "After", "description": "Note"]],
            ["id": id, "base": ["title": "Before"], "patch": ["title": 7]],
            ["id": id, "base": ["description": NSNull()], "patch": ["description": "After"]],
            ["id": id, "base": ["dueDate": "2036-01-01"], "patch": ["dueDate": "2036-01-02"]],
            ["id": id, "base": ["status": "inbox"], "patch": ["status": "done"]],
            ["id": id, "base": ["projectId": ""], "patch": ["projectId": 7]],
            ["id": id, "base": ["areaId": NSNull()], "patch": ["areaId": "area"]],
            ["id": id, "base": ["sectionId": ""], "patch": ["sectionId": false]],
            ["id": id, "base": ["priority": ""], "patch": ["priority": 7]],
            ["id": id, "base": ["energyLevel": NSNull()], "patch": ["energyLevel": "high"]],
            ["id": id, "base": ["timeEstimate": ""], "patch": ["energyLevel": "high"]],
            ["id": id, "base": ["contexts": ""], "patch": ["contexts": ["@invalid"]]],
            ["id": id, "base": ["tags": NSNull()], "patch": ["tags": "#invalid"]],
            ["id": id, "base": ["assignedTo": ""], "patch": ["assignedTo": "Outside slice"]],
            ["id": id, "base": ["unknown": "Before"], "patch": ["unknown": "After"]],
            ["id": id, "base": ["title": "Before"], "patch": ["title": "After"], "checklist": ["base": [], "value": []]],
            ["id": id, "base": ["title": "Before"], "patch": ["title": "After"], "extra": true],
            ["id": 7, "base": ["title": "Before"], "patch": ["title": "After"]],
        ]
        var journalWrites = 0
        var statements = 0
        faults.journalWrite = { journalWrites += 1 }
        faults.beforeSQL = { _ in statements += 1 }
        for input in malformed {
            await expectFailure("INVALID_INPUT") { _ = try await core.call("saveDraft", argumentsJSON: json([json(input)])) }
        }
        XCTAssertEqual(journalWrites, 0)
        XCTAssertEqual(statements, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        await core.close()
        for input in malformed {
            let command = try json(["version": 2, "method": "saveDraft", "argumentsJSON": json([json(input)])])
            try Data(command.utf8).write(to: journal)
            let reopened = host(faults)
            await expectFailure("INVALID_INPUT") { _ = try await reopened.start() }
            XCTAssertEqual(try String(contentsOf: journal), command)
            XCTAssertEqual(journalWrites, 0)
            XCTAssertEqual(statements, 0)
            await reopened.close()
        }
    }

    func testTaskViewReadsCoreMarkdownAndRejectsStaleSnapshotWithoutWrites() async throws {
        let faults = HostIOFaults()
        let writer = host()
        _ = try await writer.start()
        let id = UUID().uuidString.lowercased()
        let opened = try object(await writer.call("captureOpen"))
        var options = try XCTUnwrap(opened["options"] as? [String: Any])
        options["note"] = "**Bold note** with [a link](https://example.com)"
        _ = try await writer.call("captureSubmit", argumentsJSON: json([json([
            "text": "Read existing task", "options": options, "captureId": id, "openAfterSave": false])]))
        await writer.close()
        let sqlite = try SQLiteBridge(url: database)
        _ = try sqlite.execute("UPDATE tasks SET checklist = ? WHERE id = ?", parametersJSON: json([json([
            ["id": "step-one", "title": "**First** step", "isCompleted": false],
            ["id": "step-two", "title": "Second step", "isCompleted": true],
        ]), id]))
        sqlite.close()
        let core = host(faults)
        _ = try await core.start()
        var statements = 0
        faults.beforeSQL = { _ in statements += 1 }
        let view = try object(await core.call("taskView", argumentsJSON: json([json(["id": id, "offset": 0, "limit": 1])])))
        let rows = try XCTUnwrap(view["rows"] as? [[String: Any]])
        XCTAssertEqual(rows.first?["type"] as? String, "title")
        XCTAssertEqual(rows.first?["value"] as? String, "Read existing task")
        XCTAssertFalse(try XCTUnwrap(rows.first { $0["type"] as? String == "description" }?["blocks"] as? [Any]).isEmpty)
        let revision = try XCTUnwrap(view["revision"] as? String)
        let checklist = try XCTUnwrap(rows.first { $0["type"] as? String == "checklist" })
        XCTAssertEqual(checklist["total"] as? Int, 2)
        XCTAssertEqual((checklist["items"] as? [[String: Any]])?.first?["id"] as? String, "step-one")
        let next = try object(await core.call("taskView", argumentsJSON: json([json(["id": id, "offset": 1, "limit": 1, "revision": revision])])))
        let nextRows = try XCTUnwrap(next["rows"] as? [[String: Any]])
        let nextChecklist = try XCTUnwrap(nextRows.first { $0["type"] as? String == "checklist" })
        XCTAssertEqual((nextChecklist["items"] as? [[String: Any]])?.first?["id"] as? String, "step-two")
        await expectFailure("STALE_REVISION") {
            _ = try await core.call("taskView", argumentsJSON: json([json(["id": id, "offset": 1, "limit": 1, "revision": revision + "stale"])]))
        }
        await expectFailure("TASK_NOT_FOUND") { _ = try await core.call("taskView", argumentsJSON: json([json(["id": "missing"])])) }
        XCTAssertEqual(statements, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testProjectGroupsAndDetailPagingReadExistingSQLiteWithoutWrites() async throws {
        let initializer = host()
        _ = try await initializer.start()
        await initializer.close()
        let sqlite = try SQLiteBridge(url: database)
        let at = "2026-09-27T00:00:00.000Z"
        _ = try sqlite.execute("INSERT INTO areas (id, name, color, icon, orderNum, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["project-area", "Existing area", "#123456", "home", 0, at, at]))
        for (id, status, area) in [("project-live", "active", "project-area"), ("project-later", "someday", ""), ("project-archive", "archived", "project-area")] {
            _ = try sqlite.execute("INSERT INTO projects (id, title, status, color, areaId, orderNum, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json([id, id, status, "#123456", area.isEmpty ? NSNull() : area as Any, 0, at, at, 1]))
        }
        _ = try sqlite.execute("INSERT INTO sections (id, projectId, title, orderNum, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["project-section", "project-live", "Existing section", 0, at, at]))
        for (order, status) in ["next", "waiting"].enumerated() {
            _ = try sqlite.execute("INSERT INTO tasks (id, title, status, projectId, sectionId, orderNum, tags, contexts, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json(["project-task-\(order)", "Existing task \(order)", status, "project-live", "project-section", order, "[]", "[]", at, at, 1]))
        }
        sqlite.close()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        var statements = 0
        var journalWrites = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journalWrites += 1 }
        let projects = try object(await core.call("projects"))
        for (kind, expected) in [("active", "project-live"), ("deferred", "project-later"), ("archived", "project-archive")] {
            let groups = try XCTUnwrap(projects[kind] as? [[String: Any]])
            let rows = groups.flatMap { $0["projects"] as? [[String: Any]] ?? [] }
            XCTAssertEqual(rows.compactMap { $0["id"] as? String }, [expected])
        }
        let active = try XCTUnwrap((projects["active"] as? [[String: Any]])?.first)
        XCTAssertEqual(active["areaId"] as? String, "project-area")
        XCTAssertEqual(active["areaName"] as? String, "Existing area")
        XCTAssertEqual(active["areaColor"] as? String, "#123456")
        let full = try object(await core.call("projectDetail", argumentsJSON: json(["project-live", 0, 50, ""])))
        XCTAssertEqual(full["readOnly"] as? Bool, false)
        let items = try XCTUnwrap(full["items"] as? [[String: Any]])
        XCTAssertEqual(full["total"] as? Int, 3)
        XCTAssertEqual(items.filter { $0["type"] as? String == "section" }.first?["id"] as? String, "project-section")
        let taskIDs = items.compactMap { ($0["row"] as? [String: Any])?["id"] as? String }
        XCTAssertEqual(Set(taskIDs), Set(["project-task-0", "project-task-1"]))
        let first = try object(await core.call("projectDetail", argumentsJSON: json(["project-live", 0, 1, ""])))
        let revision = try XCTUnwrap(first["revision"] as? String)
        var pages = try XCTUnwrap(first["items"] as? [[String: Any]])
        for offset in 1..<items.count {
            let page = try object(await core.call("projectDetail", argumentsJSON: json(["project-live", offset, 1, revision])))
            pages += try XCTUnwrap(page["items"] as? [[String: Any]])
        }
        XCTAssertEqual(try json(pages), try json(items))
        let archived = try object(await core.call("projectDetail", argumentsJSON: json(["project-archive", 0, 50, ""])))
        XCTAssertEqual(archived["readOnly"] as? Bool, true)
        await expectFailure("STALE_REVISION") { _ = try await core.call("projectDetail", argumentsJSON: json(["project-live", 1, 1, revision + "-stale"])) }
        await expectFailure("TASK_NOT_FOUND") { _ = try await core.call("projectDetail", argumentsJSON: json(["missing", 0, 1, ""])) }
        for args in [["project-live", -1, 1, ""] as [Any], ["project-live", 0, 0, ""], ["project-live", 0, 10_001, ""], ["project-live", 1, 1, ""]] {
            await expectFailure("INVALID_INPUT") { _ = try await core.call("projectDetail", argumentsJSON: json(args)) }
        }
        for args in [["project-live", true, 1, ""] as [Any], ["project-live", 0, 1.5, ""], ["project-live", 0, "1", ""]] {
            await expectFailure("integers") { _ = try await core.call("projectDetail", argumentsJSON: json(args)) }
        }
        XCTAssertEqual(statements, 0)
        XCTAssertEqual(journalWrites, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testProjectDetailMetadataReadsCanonicalLabelsSectionsAndDatesWithoutWrites() async throws {
        let bootstrap = host()
        _ = try await bootstrap.start()
        await bootstrap.close()
        let at = "2026-09-27T12:00:00.000Z"
        let sqlite = try SQLiteBridge(url: database)
        _ = try sqlite.execute("INSERT INTO areas (id, name, color, orderNum, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["details-area", "Canonical Area", "#123456", 0, at, at, 1]))
        _ = try sqlite.execute("INSERT INTO areas (id, name, color, orderNum, createdAt, updatedAt, deletedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["details-removed-area", "Removed Area", "#123456", 1, at, at, at, 2]))
        for (id, status, areaID, areaTitle, cancelledAt) in [
            ("details-rich", "active", "details-area", "Stale cached name", NSNull() as Any),
            ("details-waiting", "waiting", "details-removed-area", "Removed Area", NSNull() as Any),
            ("details-someday", "someday", "", "", NSNull() as Any),
            ("details-archived", "archived", "", "", NSNull() as Any),
            ("details-cancelled", "archived", "", "", at as Any),
        ] {
            _ = try sqlite.execute("INSERT INTO projects (id, title, status, color, areaId, areaTitle, orderNum, tagIds, isSequential, sequentialScope, startDate, dueDate, reviewAt, cancelledAt, isFocused, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json([id, id, status, "#123456", areaID.isEmpty ? NSNull() as Any : areaID as Any,
                                                         areaTitle.isEmpty ? NSNull() as Any : areaTitle as Any, 0,
                                                         id == "details-rich" ? "[\"#one\",\"#two\"]" : "[]",
                                                         id == "details-rich" ? 1 : 0, id == "details-rich" ? "section" as Any : NSNull(),
                                                         id == "details-rich" ? "2036-01-02" as Any : NSNull(),
                                                         id == "details-rich" ? "2036-03-04T14:30:00.000Z" as Any : NSNull(),
                                                         id == "details-rich" ? "invalid-review-date" as Any : NSNull(),
                                                         cancelledAt, 0, at, at, 1]))
        }
        for (id, project, title, order, deletedAt, archivedAt, predeletedAt) in [
            ("details-section-a", "details-rich", "Plan", 0, NSNull() as Any, NSNull() as Any, NSNull() as Any),
            ("details-section-b", "details-rich", "Execute", 1, NSNull() as Any, NSNull() as Any, NSNull() as Any),
            ("details-archived-section", "details-archived", "Historical", 0, at as Any, at as Any, NSNull() as Any),
            ("details-predeleted-section", "details-archived", "Previously removed", 1, at as Any, at as Any, at as Any),
        ] {
            _ = try sqlite.execute("INSERT INTO sections (id, projectId, title, orderNum, createdAt, updatedAt, deletedAt, projectArchivedAt, deletedAtBeforeProjectArchive) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json([id, project, title, order, at, at, deletedAt, archivedAt, predeletedAt]))
        }
        for (id, section, order) in [("details-task-a", "details-section-a", 0), ("details-task-b", "details-section-b", 1)] {
            _ = try sqlite.execute("INSERT INTO tasks (id, title, status, projectId, sectionId, orderNum, tags, contexts, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json([id, id, "next", "details-rich", section, order, "[]", "[]", at, at, 1]))
        }
        sqlite.close()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        _ = try await core.call("language", argumentsJSON: json(["en", "en-US"]))
        let labelReply = try object(await core.call("strings", argumentsJSON: json([json([
            "status.active", "status.waiting", "status.someday", "status.archived", "projects.cancelled",
            "projects.sequential", "projects.parallel", "projects.sequentialWithinSections", "projects.noArea",
            "projects.sectionsLabel", "common.none", "common.notSet",
        ])])))
        let labels = try XCTUnwrap(labelReply["strings"] as? [String: Any])
        let beforeSQLite = try SQLiteBridge(url: database)
        let before = try nineTableSnapshot(beforeSQLite)
        beforeSQLite.close()
        var statements = 0, journalWrites = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journalWrites += 1 }
        let rich = try object(await core.call("projectDetail", argumentsJSON: json(["details-rich", 0, 50, ""])))
        let metadata = try XCTUnwrap(rich["metadata"] as? [String: Any])
        XCTAssertEqual(metadata["statusLabel"] as? String, labels["status.active"] as? String)
        XCTAssertEqual(metadata["typeLabel"] as? String, labels["projects.sequential"] as? String)
        XCTAssertEqual(metadata["sequentialScopeLabel"] as? String, labels["projects.sequentialWithinSections"] as? String)
        XCTAssertEqual(metadata["areaLabel"] as? String, "Canonical Area")
        XCTAssertEqual(metadata["tagsLabel"] as? String, "#one, #two")
        XCTAssertEqual(metadata["reviewDateLabel"] as? String, "invalid-review-date")
        XCTAssertFalse(try XCTUnwrap(metadata["startDateLabel"] as? String).isEmpty)
        XCTAssertFalse(try XCTUnwrap(metadata["dueDateLabel"] as? String).isEmpty)
        let sections = try XCTUnwrap(metadata["sections"] as? [[String: Any]])
        XCTAssertEqual(sections.compactMap { $0["id"] as? String }, ["details-section-a", "details-section-b"])
        XCTAssertEqual(sections.compactMap { $0["title"] as? String }, ["Plan", "Execute"])
        let summary = try XCTUnwrap(metadata["summary"] as? String)
        XCTAssertTrue(summary.contains("Canonical Area"))
        XCTAssertFalse(summary.contains("Stale cached name"))
        XCTAssertTrue(summary.contains("2 " + (labels["projects.sectionsLabel"] as? String ?? "")))
        let first = try object(await core.call("projectDetail", argumentsJSON: json(["details-rich", 0, 1, ""])))
        let revision = try XCTUnwrap(first["revision"] as? String)
        XCTAssertEqual(try json(XCTUnwrap(first["metadata"])), try json(metadata))
        let total = try XCTUnwrap(first["total"] as? Int)
        for offset in 1..<total {
            let page = try object(await core.call("projectDetail", argumentsJSON: json(["details-rich", offset, 1, revision])))
            XCTAssertEqual(try json(XCTUnwrap(page["metadata"])), try json(metadata))
        }
        let waiting = try object(await core.call("projectDetail", argumentsJSON: json(["details-waiting", 0, 1, ""])))
        let waitingMeta = try XCTUnwrap(waiting["metadata"] as? [String: Any])
        XCTAssertEqual(waitingMeta["statusLabel"] as? String, labels["status.waiting"] as? String)
        XCTAssertEqual(waitingMeta["areaLabel"] as? String, labels["projects.noArea"] as? String)
        XCTAssertEqual(waitingMeta["tagsLabel"] as? String, labels["common.none"] as? String)
        XCTAssertEqual(waitingMeta["startDateLabel"] as? String, labels["common.notSet"] as? String)
        XCTAssertTrue(waitingMeta["sequentialScopeLabel"] is NSNull)
        let someday = try object(await core.call("projectDetail", argumentsJSON: json(["details-someday", 0, 1, ""])))
        XCTAssertEqual((someday["metadata"] as? [String: Any])?["statusLabel"] as? String, labels["status.someday"] as? String)
        let archived = try object(await core.call("projectDetail", argumentsJSON: json(["details-archived", 0, 1, ""])))
        XCTAssertEqual(archived["readOnly"] as? Bool, true)
        let archivedMeta = try XCTUnwrap(archived["metadata"] as? [String: Any])
        XCTAssertEqual(archivedMeta["statusLabel"] as? String, labels["status.archived"] as? String)
        XCTAssertEqual((archivedMeta["sections"] as? [[String: Any]])?.compactMap { $0["id"] as? String }, ["details-archived-section"])
        let cancelled = try object(await core.call("projectDetail", argumentsJSON: json(["details-cancelled", 0, 1, ""])))
        XCTAssertEqual(cancelled["readOnly"] as? Bool, true)
        XCTAssertEqual((cancelled["metadata"] as? [String: Any])?["statusLabel"] as? String, labels["projects.cancelled"] as? String)
        _ = try await core.call("language", argumentsJSON: json(["de", "de-DE"]))
        await expectFailure("STALE_REVISION") {
            _ = try await core.call("projectDetail", argumentsJSON: json(["details-rich", 1, 1, revision]))
        }
        let translated = try object(await core.call("projectDetail", argumentsJSON: json(["details-rich", 0, 1, ""])))
        let translatedLabels = try object(await core.call("strings", argumentsJSON: json([json(["status.active"])])))
        XCTAssertEqual((translated["metadata"] as? [String: Any])?["statusLabel"] as? String,
                       (translatedLabels["strings"] as? [String: Any])?["status.active"] as? String)
        XCTAssertEqual(statements, 0); XCTAssertEqual(journalWrites, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        let afterSQLite = try SQLiteBridge(url: database)
        XCTAssertEqual(try nineTableSnapshot(afterSQLite), before)
        afterSQLite.close()
        await core.close()
    }

    func testWaitingPeopleDeferredProjectsAndBoundedPagesReadWithoutWrites() async throws {
        let initializer = host()
        _ = try await initializer.start()
        await initializer.close()
        let sqlite = try SQLiteBridge(url: database)
        let at = "2026-01-01T00:00:00.000Z"
        for (id, person, due, created, status) in [
            ("waiting-ada-later", "Ada", "2036-01-02", at, "waiting"),
            ("waiting-ada-first", "Ada", "2036-01-01", at, "waiting"),
            ("waiting-bob", "Bob", "", "2026-09-27T00:00:00.000Z", "waiting"),
            ("no-longer-waiting", "Gone", "", at, "next"),
        ] {
            _ = try sqlite.execute("INSERT INTO tasks (id, title, status, assignedTo, dueDate, tags, contexts, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json([id, id, status, person, due.isEmpty ? NSNull() : due as Any, "[]", "[]", created, created, 1]))
        }
        // Both auxiliary collections cross the first-window bound (100).
        for index in 0..<101 {
            let suffix = String(format: "%03d", index)
            _ = try sqlite.execute("INSERT INTO projects (id, title, status, color, orderNum, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json(["waiting-project-\(suffix)", "Deferred \(suffix)", "waiting", "#123456", index, at, at, 1]))
            if index < 100 {
                _ = try sqlite.execute("INSERT INTO tasks (id, title, status, assignedTo, tags, contexts, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                       parametersJSON: json(["waiting-extra-\(suffix)", "Extra \(suffix)", "waiting", "Person \(suffix)", "[]", "[]", at, at, 1]))
            }
        }
        sqlite.close()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        var statements = 0
        var journalWrites = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journalWrites += 1 }
        func read(_ name: String, _ input: [String: Any]) async throws -> [String: Any] {
            try object(await core.call("menuRead", argumentsJSON: json([name, json(input)])))
        }
        let all = try await read("waiting", ["person": "", "offset": 0, "limit": 2])
        let revision = try XCTUnwrap(all["revision"] as? String)
        XCTAssertEqual(all["total"] as? Int, 103)
        XCTAssertEqual(all["person"] as? String, "")
        XCTAssertEqual(all["showDetails"] as? Bool, true)
        XCTAssertEqual((all["all"] as? [String: Any])?["selected"] as? Bool, true)
        XCTAssertEqual((all["rows"] as? [[String: Any]])?.compactMap { $0["id"] as? String }, ["waiting-ada-first", "waiting-ada-later"])
        let next = try await read("waiting", ["person": "", "offset": 2, "limit": 1, "revision": revision])
        XCTAssertEqual((next["rows"] as? [[String: Any]])?.compactMap { $0["id"] as? String }, ["waiting-bob"])
        XCTAssertEqual(next["total"] as? Int, 103)
        XCTAssertEqual(next["revision"] as? String, revision)
        let selected = try await read("waiting", ["person": "ada", "offset": 0, "limit": 1])
        XCTAssertEqual(selected["person"] as? String, "ada")
        XCTAssertEqual(selected["total"] as? Int, 2)
        XCTAssertEqual((selected["rows"] as? [[String: Any]])?.first?["id"] as? String, "waiting-ada-first")
        let selectedPeople = try XCTUnwrap((selected["people"] as? [String: Any])?["items"] as? [[String: Any]])
        XCTAssertEqual(selectedPeople.first { $0["person"] as? String == "Ada" }?["selected"] as? Bool, true)
        let removed = try await read("waiting", ["person": "Gone", "offset": 0, "limit": 2])
        XCTAssertEqual(removed["person"] as? String, "")
        XCTAssertEqual(removed["revision"] as? String, revision)
        XCTAssertEqual(try json(XCTUnwrap(removed["rows"])), try json(XCTUnwrap(all["rows"])))
        let people = try XCTUnwrap(all["people"] as? [String: Any])
        XCTAssertEqual(people["total"] as? Int, 102)
        XCTAssertEqual((people["items"] as? [Any])?.count, 100)
        let deferred = try XCTUnwrap(all["deferred"] as? [String: Any])
        let deferredRows = try XCTUnwrap(deferred["rows"] as? [String: Any])
        XCTAssertEqual(deferredRows["total"] as? Int, 101)
        XCTAssertEqual((deferredRows["items"] as? [Any])?.count, 100)
        XCTAssertFalse(try XCTUnwrap(deferred["title"] as? String).isEmpty)
        XCTAssertEqual(((deferredRows["items"] as? [[String: Any]])?.first)?["color"] as? String, "#123456")
        for (collection, total) in [("people", 102), ("deferredProjects", 101)] {
            let input: [String: Any] = ["view": "waiting", "collection": collection, "params": ["person": ""], "offset": 100, "limit": 1, "revision": revision]
            let page = try await read("collection", input)
            XCTAssertEqual(page["view"] as? String, "waiting")
            XCTAssertEqual(page["collection"] as? String, collection)
            XCTAssertEqual(page["revision"] as? String, revision)
            XCTAssertEqual(page["total"] as? Int, total)
            XCTAssertEqual((page["items"] as? [Any])?.count, 1)
            let item = try XCTUnwrap((page["items"] as? [[String: Any]])?.first)
            XCTAssertEqual(item[collection == "people" ? "person" : "id"] as? String,
                           collection == "people" ? "Person 098" : "waiting-project-100")
            var stale = input
            stale["revision"] = revision + "-stale"
            await expectFailure("STALE_REVISION") { _ = try await read("collection", stale) }
            var tooLarge = input
            tooLarge["limit"] = 101
            await expectFailure("INVALID_INPUT") { _ = try await read("collection", tooLarge) }
            var invalidParams = input
            invalidParams["params"] = ["person": 7]
            await expectFailure("INVALID_INPUT") { _ = try await read("collection", invalidParams) }
        }
        await expectFailure("STALE_REVISION") { _ = try await read("waiting", ["person": "ada", "offset": 1, "limit": 1, "revision": revision]) }
        for input in [["person": "", "offset": 1, "limit": 1] as [String: Any], ["offset": 0, "limit": 101], ["offset": true, "limit": 1], ["person": 7, "offset": 0, "limit": 1]] {
            await expectFailure("INVALID_INPUT") { _ = try await read("waiting", input) }
        }
        for input in [["view": "more", "collection": "savedSearches"], ["view": "waiting", "collection": "tokens"], ["view": "someday", "collection": "people"], ["view": "archive", "collection": "tokens"], [:]] {
            await expectFailure("Unsupported native menu collection") { _ = try await read("collection", input) }
        }
        for name in ["waiting", "collection"] {
            for malformed in ["[]", "null", "broken JSON"] {
                await expectFailure { _ = try await core.call("menuRead", argumentsJSON: json([name, malformed])) }
            }
        }
        XCTAssertEqual(statements, 0)
        XCTAssertEqual(journalWrites, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testSomedayGroupsEffectiveFiltersAndAllCollectionPagesReadWithoutWrites() async throws {
        let initializer = host()
        _ = try await initializer.start()
        await initializer.close()
        let sqlite = try SQLiteBridge(url: database)
        let at = "2026-01-01T00:00:00.000Z"
        var sections: [[String: Any]] = []
        for index in 0..<101 {
            let suffix = String(format: "%03d", index)
            sections.append(["id": "someday-section-\(suffix)", "title": "Section \(suffix)", "order": index])
            // Deferred projects have their own collection; their tasks are not in the visible task list.
            for (prefix, status) in [("someday-project", "active"), ("someday-deferred", "someday")] {
                _ = try sqlite.execute("INSERT INTO projects (id, title, status, color, orderNum, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                                       parametersJSON: json(["\(prefix)-\(suffix)", "Project \(suffix)", status, "#123456", index, at, at, 1]))
            }
            _ = try sqlite.execute("INSERT INTO tasks (id, title, status, projectId, viewSectionIds, tags, contexts, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json(["someday-task-\(suffix)", String(format: "Idea %03d", 100 - index), "someday", "someday-project-\(suffix)",
                                                         json(["someday": "someday-section-\(suffix)"]), json(["#token\(suffix)"]), "[]", at, at, 1]))
        }
        let settingsRows = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(sqlite.execute("SELECT data FROM settings WHERE id = 1").utf8)) as? [[String: Any]])
        var settings = try object(XCTUnwrap(settingsRows.first?["data"] as? String))
        var gtd = settings["gtd"] as? [String: Any] ?? [:]
        gtd["viewSections"] = ["someday": sections]
        settings["gtd"] = gtd
        settings["features"] = ["priorities": false, "timeEstimates": false]
        _ = try sqlite.execute("UPDATE settings SET data = ? WHERE id = 1", parametersJSON: json([json(settings)]))
        sqlite.close()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        var statements = 0
        var journalWrites = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journalWrites += 1 }
        func read(_ name: String, _ input: [String: Any]) async throws -> [String: Any] {
            try object(await core.call("menuRead", argumentsJSON: json([name, json(input)])))
        }
        let grouped = try await read("someday", ["offset": 0, "limit": 50])
        let groupedRevision = try XCTUnwrap(grouped["revision"] as? String)
        XCTAssertEqual(grouped["total"] as? Int, 202)
        XCTAssertEqual(grouped["sortBy"] as? String, "default")
        XCTAssertEqual(grouped["groupBy"] as? String, "viewSection")
        XCTAssertEqual(grouped["showDetails"] as? Bool, false)
        XCTAssertEqual((grouped["stats"] as? [[String: Any]])?.compactMap { $0["value"] as? Int }, [101, 101])
        var items = try XCTUnwrap(grouped["items"] as? [[String: Any]])
        for offset in stride(from: 50, to: 202, by: 50) {
            let page = try await read("someday", ["offset": offset, "limit": 50, "revision": groupedRevision])
            XCTAssertEqual(page["revision"] as? String, groupedRevision)
            XCTAssertEqual(page["total"] as? Int, 202)
            items += try XCTUnwrap(page["items"] as? [[String: Any]])
        }
        XCTAssertEqual(items.count, 202)
        XCTAssertEqual(items.filter { $0["type"] as? String == "heading" }.compactMap { $0["id"] as? String },
                       (0..<101).map { String(format: "view-section:someday:someday-section-%03d", $0) })
        XCTAssertEqual(items.compactMap { ($0["row"] as? [String: Any])?["id"] as? String },
                       (0..<101).map { String(format: "someday-task-%03d", $0) })
        XCTAssertEqual(items.first?["title"] as? String, "Section 000")
        XCTAssertEqual((items.first?["addTask"] as? [String: Any])?["sectionId"] as? String, "someday-section-000")
        XCTAssertNotNil((items[1]["row"] as? [String: Any])?["meta"])

        // Unknown token selections stay active until explicitly cleared; unavailable Projects are pruned.
        let stale = try await read("someday", ["sortBy": "title", "groupBy": "none", "showDetails": true,
                                               "filters": ["tokens": ["#gone"], "projects": ["gone"]], "offset": 0, "limit": 2])
        let staleFilters = try XCTUnwrap(stale["filters"] as? [String: Any])
        let staleState = try XCTUnwrap(staleFilters["state"] as? [String: Any])
        XCTAssertEqual(staleState["tokens"] as? [String], ["#gone"])
        XCTAssertEqual(staleState["projects"] as? [String], [])
        XCTAssertEqual(stale["total"] as? Int, 0)
        XCTAssertEqual((stale["items"] as? [[String: Any]])?.count, 0)
        let sorted = try await read("someday", ["sortBy": "title", "groupBy": "none", "showDetails": true,
                                                "filters": staleState,
                                                "filterEdit": try XCTUnwrap(staleFilters["clearEdit"]),
                                                "offset": 0, "limit": 2])
        let revision = try XCTUnwrap(sorted["revision"] as? String)
        let filters = try XCTUnwrap(sorted["filters"] as? [String: Any])
        let state = try XCTUnwrap(filters["state"] as? [String: Any])
        XCTAssertEqual(state["tokens"] as? [String], [])
        XCTAssertEqual(state["projects"] as? [String], [])
        XCTAssertEqual(sorted["total"] as? Int, 101)
        XCTAssertEqual((sorted["items"] as? [[String: Any]])?.compactMap { ($0["row"] as? [String: Any])?["id"] as? String }, ["someday-task-100", "someday-task-099"])
        let menu = try XCTUnwrap(sorted["menu"] as? [String: Any])
        for (control, selected) in [("sort", "title"), ("group", "none")] {
            let options = try XCTUnwrap((menu[control] as? [String: Any])?["options"] as? [[String: Any]])
            XCTAssertEqual(options.filter { $0["selected"] as? Bool == true }.compactMap { $0["value"] as? String }, [selected])
            XCTAssertTrue(options.allSatisfy { ($0["label"] as? String)?.isEmpty == false })
            if control == "sort" { XCTAssertFalse(options.contains { $0["value"] as? String == "timeEstimate" }) }
        }
        XCTAssertEqual((menu["details"] as? [String: Any])?["selected"] as? Bool, true)
        XCTAssertEqual((filters["visibility"] as? [String: Any])?["priority"] as? Bool, false)
        XCTAssertEqual((filters["visibility"] as? [String: Any])?["timeEstimate"] as? Bool, false)
        var params: [String: Any] = ["sortBy": "title", "groupBy": "none", "showDetails": true, "filters": state]
        var nextInput = params
        nextInput.merge(["offset": 2, "limit": 1, "revision": revision]) { _, new in new }
        let next = try await read("someday", nextInput)
        XCTAssertEqual(next["revision"] as? String, revision)
        XCTAssertEqual(((next["items"] as? [[String: Any]])?.first?["row"] as? [String: Any])?["id"] as? String, "someday-task-098")

        let deferredRows = try XCTUnwrap((sorted["deferred"] as? [String: Any])?["rows"] as? [String: Any])
        for (collection, window, field, last) in [
            ("tokens", try XCTUnwrap(filters["tokens"] as? [String: Any]), "value", "#token100"),
            ("projects", try XCTUnwrap(filters["projects"] as? [String: Any]), "id", "someday-project-100"),
            ("sections", try XCTUnwrap(sorted["sections"] as? [String: Any]), "id", "someday-section-100"),
            ("deferredProjects", deferredRows, "id", "someday-deferred-100"),
        ] {
            XCTAssertEqual(window["total"] as? Int, 101)
            let firstItems = try XCTUnwrap(window["items"] as? [[String: Any]])
            XCTAssertEqual(firstItems.count, 100)
            var input: [String: Any] = ["view": "someday", "collection": collection, "params": params, "offset": 100, "limit": 50, "revision": revision]
            let page = try await read("collection", input)
            XCTAssertEqual(page["view"] as? String, "someday")
            XCTAssertEqual(page["collection"] as? String, collection)
            XCTAssertEqual(page["revision"] as? String, revision)
            XCTAssertEqual(page["total"] as? Int, 101)
            let remaining = try XCTUnwrap(page["items"] as? [[String: Any]])
            XCTAssertEqual(remaining.compactMap { $0[field] as? String }, [last])
            XCTAssertEqual(Set((firstItems + remaining).compactMap { $0[field] as? String }).count, 101)
            input["revision"] = groupedRevision
            await expectFailure("STALE_REVISION") { _ = try await read("collection", input) }
            input["revision"] = revision
            input["limit"] = 101
            await expectFailure("INVALID_INPUT") { _ = try await read("collection", input) }
        }
        for (collection, query, field, expected) in [("tokens", "TOKEN100", "value", "#token100"), ("projects", "PROJECT 100", "id", "someday-project-100")] {
            let page = try await read("collection", ["view": "someday", "collection": collection, "params": params, "query": query, "offset": 0, "limit": 50, "revision": revision])
            XCTAssertEqual(page["total"] as? Int, 1)
            XCTAssertEqual((page["items"] as? [[String: Any]])?.first?[field] as? String, expected)
        }

        let token = try XCTUnwrap(((filters["tokens"] as? [String: Any])?["items"] as? [[String: Any]])?.first)
        var filteredInput = params
        filteredInput.merge(["filterEdit": try XCTUnwrap(token["edit"]), "offset": 0, "limit": 50]) { _, new in new }
        let filtered = try await read("someday", filteredInput)
        XCTAssertEqual(filtered["total"] as? Int, 1)
        XCTAssertEqual(((filtered["items"] as? [[String: Any]])?.first?["row"] as? [String: Any])?["id"] as? String, "someday-task-000")
        let filteredFilters = try XCTUnwrap(filtered["filters"] as? [String: Any])
        XCTAssertEqual(filteredFilters["hasActive"] as? Bool, true)
        XCTAssertEqual((filteredFilters["state"] as? [String: Any])?["tokens"] as? [String], ["#token000"])
        let chipAction = try XCTUnwrap((filtered["chips"] as? [[String: Any]])?.first?["action"] as? [String: Any])
        filteredInput["filters"] = try XCTUnwrap(filteredFilters["state"])
        filteredInput["filterEdit"] = try XCTUnwrap(chipAction["filterEdit"])
        let removed = try await read("someday", filteredInput)
        XCTAssertEqual(removed["revision"] as? String, revision)
        XCTAssertEqual(removed["total"] as? Int, 101)
        filteredInput["filterEdit"] = try XCTUnwrap(filteredFilters["clearEdit"])
        let cleared = try await read("someday", filteredInput)
        XCTAssertEqual(cleared["revision"] as? String, revision)
        params["filters"] = ["searchQuery": "No matching idea"]
        params.merge(["offset": 0, "limit": 50]) { _, new in new }
        let empty = try await read("someday", params)
        XCTAssertEqual(empty["total"] as? Int, 0)
        XCTAssertEqual((empty["empty"] as? [String: Any])?["clear"] as? Bool, true)
        await expectFailure("STALE_REVISION") { _ = try await read("someday", ["offset": 50, "limit": 50, "revision": revision]) }
        for input in [["offset": 1, "limit": 1] as [String: Any], ["offset": true, "limit": 1], ["offset": 0, "limit": 101],
                      ["offset": 0, "limit": 1, "sortBy": "invented"], ["offset": 0, "limit": 1, "groupBy": "context"],
                      ["offset": 0, "limit": 1, "showDetails": "true"], ["offset": 0, "limit": 1, "filters": ["tokens": 7]],
                      ["offset": 0, "limit": 1, "filterEdit": ["type": "invented"]]] {
            await expectFailure("INVALID_INPUT") { _ = try await read("someday", input) }
        }
        for malformed in ["[]", "null", "broken JSON"] {
            await expectFailure { _ = try await core.call("menuRead", argumentsJSON: json(["someday", malformed])) }
        }
        await expectFailure("unavailable") { _ = try await core.call("menuCommand", argumentsJSON: json(["activateProject", "{}"])) }
        XCTAssertEqual(statements, 0)
        XCTAssertEqual(journalWrites, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testReferenceGroupingArchivedPreviewFiltersAndCollectionPagesReadWithoutWrites() async throws {
        let initializer = host()
        _ = try await initializer.start()
        await initializer.close()
        let sqlite = try SQLiteBridge(url: database)
        let at = "2026-01-01T00:00:00.000Z"
        for (index, id, name) in [(0, "reference-area", "Reference area"), (1, "archived-area", "Archived area")] {
            _ = try sqlite.execute("INSERT INTO areas (id, name, orderNum, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)",
                                   parametersJSON: json([id, name, index, at, at]))
        }
        for index in 0..<102 {
            let suffix = String(format: "%03d", index)
            let archived = index == 101
            let projectID = archived ? "reference-archived-project" : "reference-project-\(suffix)"
            let areaID = archived ? "archived-area" : "reference-area"
            _ = try sqlite.execute("INSERT INTO projects (id, title, status, color, areaId, orderNum, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json([projectID, archived ? "Archived project" : "Project \(suffix)", archived ? "archived" : "active", "#94a3b8", areaID, index, at, at, 1]))
            _ = try sqlite.execute("INSERT INTO tasks (id, title, status, projectId, areaId, tags, contexts, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json([archived ? "reference-archived" : "reference-task-\(suffix)",
                                                         archived ? "Archived reference" : String(format: "Reference %03d", 100 - index),
                                                         "reference", projectID, areaID, json([archived ? "#archive" : "#token\(suffix)"]), "[]", at, at, 1]))
        }
        let settingsRows = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(sqlite.execute("SELECT data FROM settings WHERE id = 1").utf8)) as? [[String: Any]])
        var settings = try object(XCTUnwrap(settingsRows.first?["data"] as? String))
        settings["taskSortBy"] = "title"
        _ = try sqlite.execute("UPDATE settings SET data = ? WHERE id = 1", parametersJSON: json([json(settings)]))
        sqlite.close()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        var statements = 0
        var journalWrites = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journalWrites += 1 }
        func read(_ name: String, _ input: [String: Any]) async throws -> [String: Any] {
            try object(await core.call("menuRead", argumentsJSON: json([name, json(input)])))
        }
        let view = try await read("reference", ["offset": 0, "limit": 50])
        let revision = try XCTUnwrap(view["revision"] as? String)
        XCTAssertEqual(view["kind"] as? String, "reference")
        XCTAssertEqual(view["groupBy"] as? String, "area")
        XCTAssertEqual(view["sortBy"] as? String, "title")
        XCTAssertEqual(view["count"] as? Int, 101)
        XCTAssertEqual(view["total"] as? Int, 102)
        XCTAssertEqual(view["includeArchivedProjects"] as? Bool, false)
        XCTAssertEqual((view["archivedProjectsToggle"] as? [String: Any])?["value"] as? Bool, false)
        var items = try XCTUnwrap(view["items"] as? [[String: Any]])
        for offset in [50, 100] {
            let page = try await read("reference", ["offset": offset, "limit": 50, "revision": revision])
            XCTAssertEqual(page["kind"] as? String, "reference")
            XCTAssertEqual(page["revision"] as? String, revision)
            XCTAssertEqual(page["total"] as? Int, 102)
            items += try XCTUnwrap(page["items"] as? [[String: Any]])
        }
        XCTAssertEqual(items.count, 102)
        let section = try XCTUnwrap(items.first)
        let sectionID = try XCTUnwrap(section["id"] as? String)
        XCTAssertEqual(sectionID, "reference-area")
        XCTAssertEqual(section["type"] as? String, "section")
        XCTAssertEqual(section["title"] as? String, "Reference area")
        XCTAssertEqual(section["count"] as? Int, 101)
        XCTAssertEqual(section["collapsible"] as? Bool, true)
        let rows = items.compactMap { $0["row"] as? [String: Any] }
        XCTAssertEqual(rows.compactMap { $0["id"] as? String }, (0..<101).reversed().map { String(format: "reference-task-%03d", $0) })
        XCTAssertTrue(rows.allSatisfy { $0["readOnly"] as? Bool == false })
        let collapsed = try await read("reference", ["collapsedGroupIds": [sectionID], "offset": 0, "limit": 50])
        XCTAssertEqual(collapsed["collapsedGroupIds"] as? [String], [sectionID])
        XCTAssertEqual(collapsed["total"] as? Int, 1)
        XCTAssertEqual(collapsed["count"] as? Int, 101)
        XCTAssertEqual((collapsed["items"] as? [[String: Any]])?.first?["collapsed"] as? Bool, true)

        let included = try await read("reference", ["groupBy": "none", "includeArchivedProjects": true, "offset": 0, "limit": 50])
        XCTAssertEqual(included["total"] as? Int, 102)
        let archivedRow = try XCTUnwrap(((included["items"] as? [[String: Any]])?.first)?["row"] as? [String: Any])
        XCTAssertEqual(archivedRow["id"] as? String, "reference-archived")
        XCTAssertEqual(archivedRow["readOnly"] as? Bool, true)
        let archivedEditor = try object(await core.call("editorModel", argumentsJSON: json(["reference-archived"])))
        XCTAssertEqual(archivedEditor["readOnly"] as? Bool, true)
        let archivedChip = try XCTUnwrap((included["chips"] as? [[String: Any]])?.first { ($0["action"] as? [String: Any])?["includeArchivedProjects"] as? Bool == false })
        XCTAssertEqual((archivedChip["action"] as? [String: Any])?["includeArchivedProjects"] as? Bool, false)

        let filters = try XCTUnwrap(view["filters"] as? [String: Any])
        let state = try XCTUnwrap(filters["state"] as? [String: Any])
        XCTAssertEqual(try json(XCTUnwrap(filters["visibility"])), try json(["energyLevel": false, "location": false, "priority": false, "timeEstimate": false]))
        let params: [String: Any] = ["groupBy": "area", "includeArchivedProjects": false, "collapsedGroupIds": [], "filters": state]
        for (collection, field, last, query) in [("tokens", "value", "#token100", "TOKEN100"), ("projects", "id", "reference-project-100", "PROJECT 100")] {
            let window = try XCTUnwrap(filters[collection] as? [String: Any])
            XCTAssertEqual(window["total"] as? Int, 101)
            let firstItems = try XCTUnwrap(window["items"] as? [[String: Any]])
            XCTAssertEqual(firstItems.count, 100)
            var input: [String: Any] = ["view": "reference", "collection": collection, "params": params, "offset": 100, "limit": 50, "revision": revision]
            let page = try await read("collection", input)
            XCTAssertEqual(page["view"] as? String, "reference")
            XCTAssertEqual(page["collection"] as? String, collection)
            XCTAssertEqual(page["revision"] as? String, revision)
            XCTAssertEqual(page["total"] as? Int, 101)
            let tail = try XCTUnwrap(page["items"] as? [[String: Any]])
            XCTAssertEqual(tail.compactMap { $0[field] as? String }, [last])
            XCTAssertEqual(Set((firstItems + tail).compactMap { $0[field] as? String }).count, 101)
            input["offset"] = 0
            input["query"] = query
            let found = try await read("collection", input)
            XCTAssertEqual(found["total"] as? Int, 1)
            XCTAssertEqual((found["items"] as? [[String: Any]])?.first?[field] as? String, last)
            input["revision"] = try XCTUnwrap(included["revision"])
            await expectFailure("STALE_REVISION") { _ = try await read("collection", input) }
            input["revision"] = revision
            input["limit"] = 101
            await expectFailure("INVALID_INPUT") { _ = try await read("collection", input) }
        }
        let token = try XCTUnwrap(((filters["tokens"] as? [String: Any])?["items"] as? [[String: Any]])?.first)
        var filteredInput = params
        filteredInput.merge(["filterEdit": try XCTUnwrap(token["edit"]), "offset": 0, "limit": 50]) { _, new in new }
        let filtered = try await read("reference", filteredInput)
        XCTAssertEqual(filtered["count"] as? Int, 1)
        XCTAssertEqual(filtered["total"] as? Int, 2)
        let filteredFilters = try XCTUnwrap(filtered["filters"] as? [String: Any])
        XCTAssertEqual((filteredFilters["state"] as? [String: Any])?["tokens"] as? [String], ["#token000"])
        let chip = try XCTUnwrap((filtered["chips"] as? [[String: Any]])?.first?["action"] as? [String: Any])
        filteredInput["filters"] = try XCTUnwrap(filteredFilters["state"])
        filteredInput["filterEdit"] = try XCTUnwrap(chip["filterEdit"])
        let removed = try await read("reference", filteredInput)
        XCTAssertEqual(removed["revision"] as? String, revision)
        filteredInput["includeArchivedProjects"] = true
        filteredInput["filterEdit"] = try XCTUnwrap(filteredFilters["clearEdit"])
        let cleared = try await read("reference", filteredInput)
        XCTAssertEqual(cleared["includeArchivedProjects"] as? Bool, false)
        XCTAssertEqual(cleared["revision"] as? String, revision)
        let pruned = try await read("reference", ["filters": ["projects": ["missing-project"]], "offset": 0, "limit": 50])
        XCTAssertEqual(((pruned["filters"] as? [String: Any])?["state"] as? [String: Any])?["projects"] as? [String], [])
        XCTAssertEqual(pruned["revision"] as? String, revision)
        await expectFailure("STALE_REVISION") { _ = try await read("reference", ["collapsedGroupIds": [sectionID], "offset": 1, "limit": 1, "revision": revision]) }
        for input in [["offset": 1, "limit": 1] as [String: Any], ["offset": true, "limit": 1], ["offset": 0, "limit": 101],
                      ["offset": 0, "limit": 1, "sortBy": "title"], ["offset": 0, "limit": 1, "includeArchivedProjects": "true"],
                      ["offset": 0, "limit": 1, "groupBy": "completedDate"], ["offset": 0, "limit": 1, "collapsedGroupIds": [7]],
                      ["offset": 0, "limit": 1, "filters": ["tokens": 7]]] {
            await expectFailure("INVALID_INPUT") { _ = try await read("reference", input) }
        }
        for collection in ["people", "sections", "deferredProjects", "savedSearches"] {
            await expectFailure("Unsupported native menu collection") { _ = try await read("collection", ["view": "reference", "collection": collection]) }
        }
        for malformed in ["[]", "null", "broken JSON"] {
            await expectFailure { _ = try await core.call("menuRead", argumentsJSON: json(["reference", malformed])) }
        }
        await expectFailure("unavailable") { _ = try await core.call("menuCommand", argumentsJSON: json(["setTaskListSort", "{\"sortBy\":\"default\"}"])) }
        XCTAssertEqual(statements, 0)
        XCTAssertEqual(journalWrites, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testReferenceArchivedParentCompletionRejectsWithoutSQL() async throws {
        let initializer = host()
        _ = try await initializer.start()
        await initializer.close()
        let sqlite = try SQLiteBridge(url: database)
        let at = "2026-01-01T00:00:00.000Z"
        _ = try sqlite.execute("INSERT INTO projects (id, title, status, color, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["archived-parent", "Protected parent", "archived", "#94a3b8", at, at, 1]))
        _ = try sqlite.execute("INSERT INTO tasks (id, title, status, projectId, tags, contexts, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["reference-archived", "Protected reference", "reference", "archived-parent", "[]", "[]", at, at, 1]))
        sqlite.close()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        var statements = 0
        var refusals = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.commandDiagnostic = { if $0 == "readOnlyCompletion" { refusals += 1 } }
        let before = try storedTask("reference-archived")
        do {
            _ = try await core.call("complete", argumentsJSON: json(["reference-archived"]))
            XCTFail("Read-only Reference completion must be rejected")
        } catch {
            XCTAssertTrue(error is CoreHostRejection)
            XCTAssertTrue(error.localizedDescription.hasPrefix("INVALID_INPUT:"))
            XCTAssertTrue(error.localizedDescription.contains("read-only"))
        }
        XCTAssertEqual(try json(storedTask("reference-archived")), try json(before))
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        _ = try await core.call("menuRead", argumentsJSON: json(["reference", json(["offset": 0, "limit": 50])]))
        // Rejected commands may create and clean their journals; they must never reach SQLite.
        XCTAssertEqual(statements, 0)
        XCTAssertEqual(refusals, 1)
    }

    func testReferenceDeletedParentPendingCompletionBlocksBeforeLoadRepair() async throws {
        let initializer = host()
        _ = try await initializer.start()
        await initializer.close()
        let sqlite = try SQLiteBridge(url: database)
        let at = "2026-01-01T00:00:00.000Z"
        _ = try sqlite.execute("INSERT INTO projects (id, title, status, color, deletedAt, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["deleted-parent", "Protected parent", "active", "#94a3b8", "2036-01-01T00:00:00.000Z", at, at, 1]))
        _ = try sqlite.execute("INSERT INTO tasks (id, title, status, projectId, tags, contexts, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["reference-deleted", "Protected reference", "reference", "deleted-parent", "[]", "[]", at, at, 1]))
        sqlite.close()
        let before = try storedTask("reference-deleted")
        let argumentsJSON = try json(["reference-deleted"])
        let intent: [String: Any] = ["version": 2, "method": "complete", "argumentsJSON": argumentsJSON]
        try Data(json(intent).utf8).write(to: journal, options: .atomic)
        let faults = HostIOFaults()
        var taskWrites = 0
        var refusals = 0
        faults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+tasks\b"#, options: .regularExpression) != nil { taskWrites += 1 }
        }
        faults.commandDiagnostic = { if $0 == "readOnlyCompletion" { refusals += 1 } }
        let core = host(faults)
        do { _ = try await core.start(); XCTFail("Unknown replay must block before task detachment") }
        catch {
            XCTAssertFalse(error is CoreHostRejection)
            XCTAssertTrue(error.localizedDescription.hasPrefix("INVALID_INPUT:"))
            XCTAssertTrue(error.localizedDescription.contains("read-only"))
        }
        // Ordinary activation repairs this dangling association. Pending recovery must
        // preserve it until the unknown completion resolves, so that guard cannot be bypassed.
        XCTAssertEqual(try json(storedTask("reference-deleted")), try json(before))
        XCTAssertEqual(try storedTask("reference-deleted")["projectId"] as? String, "deleted-parent")
        // Replay re-persists its decoded envelope with JSONEncoder, whose property
        // order can differ from the fixture's sorted JSONSerialization output.
        let retained = try object(String(contentsOf: journal, encoding: .utf8))
        XCTAssertEqual(try json(retained), try json(intent))
        XCTAssertEqual(Data(try XCTUnwrap(retained["argumentsJSON"] as? String).utf8), Data(argumentsJSON.utf8))
        XCTAssertEqual(taskWrites, 0)
        XCTAssertEqual(refusals, 1)
    }

    func testHistoryAndDoneGroupedPagesAreaAndTokenReadsWithoutWrites() async throws {
        let initializer = host()
        _ = try await initializer.start()
        await initializer.close()
        let sqlite = try SQLiteBridge(url: database)
        let at = "2026-01-01T12:00:00.000Z"
        for (index, id) in ["done-area", "hidden-area"].enumerated() {
            _ = try sqlite.execute("INSERT INTO areas (id, name, orderNum, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)",
                                   parametersJSON: json([id, id, index, at, at]))
        }
        for index in 0..<102 {
            let suffix = String(format: "%03d", index)
            _ = try sqlite.execute("INSERT INTO tasks (id, title, status, areaId, tags, contexts, completedAt, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json(["done-task-\(suffix)", String(format: "Done %03d", 100 - index), "done", index == 101 ? "hidden-area" : "done-area",
                                                         json([index == 101 ? "#hidden" : "#done\(suffix)"]), "[]", "2026-09-26T12:00:00.000Z", at, at, 1]))
        }
        let settingsRows = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(sqlite.execute("SELECT data FROM settings WHERE id = 1").utf8)) as? [[String: Any]])
        var settings = try object(XCTUnwrap(settingsRows.first?["data"] as? String))
        settings["filters"] = ["areaIds": ["done-area"], "excludedAreaIds": []]
        _ = try sqlite.execute("UPDATE settings SET data = ? WHERE id = 1", parametersJSON: json([json(settings)]))
        sqlite.close()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        var statements = 0
        var journalWrites = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journalWrites += 1 }
        func read(_ name: String, _ input: [String: Any]) async throws -> [String: Any] {
            try object(await core.call("menuRead", argumentsJSON: json([name, json(input)])))
        }
        for (input, expected) in [([:] as [String: Any], "done"), (["tab": "archived"], "archived"), (["tab": "unknown"], "done"), (["tab": NSNull()], "done")] {
            let history = try await read("history", input)
            XCTAssertEqual(history["tab"] as? String, expected)
            let tabs = try XCTUnwrap(history["tabs"] as? [[String: Any]])
            XCTAssertEqual(tabs.compactMap { $0["id"] as? String }, ["done", "archived"])
            XCTAssertEqual(tabs.filter { $0["selected"] as? Bool == true }.compactMap { $0["id"] as? String }, [expected])
            XCTAssertTrue(tabs.allSatisfy { ($0["label"] as? String)?.isEmpty == false })
        }
        let view = try await read("done", ["groupBy": "area", "sortBy": "title", "offset": 0, "limit": 50])
        let revision = try XCTUnwrap(view["revision"] as? String)
        XCTAssertEqual(view["kind"] as? String, "done")
        XCTAssertEqual(view["count"] as? Int, 101)
        XCTAssertEqual(view["total"] as? Int, 102)
        XCTAssertEqual(view["sortBy"] as? String, "title")
        XCTAssertEqual(view["groupBy"] as? String, "area")
        var items = try XCTUnwrap(view["items"] as? [[String: Any]])
        let sectionID = try XCTUnwrap(items.first?["id"] as? String)
        XCTAssertEqual(sectionID, "done-area")
        let filters = try XCTUnwrap(view["filters"] as? [String: Any])
        let state = try XCTUnwrap(filters["state"] as? [String: Any])
        let params: [String: Any] = ["groupBy": "area", "sortBy": "title", "collapsedGroupIds": [], "filters": state]
        for offset in [50, 100] {
            var input = params
            input.merge(["offset": offset, "limit": 50, "revision": revision]) { _, new in new }
            let page = try await read("done", input)
            XCTAssertEqual(page["revision"] as? String, revision)
            XCTAssertEqual(page["total"] as? Int, 102)
            items += try XCTUnwrap(page["items"] as? [[String: Any]])
        }
        XCTAssertEqual(items.count, 102)
        XCTAssertEqual(items.compactMap { ($0["row"] as? [String: Any])?["id"] as? String },
                       (0..<101).reversed().map { String(format: "done-task-%03d", $0) })
        let collapsed = try await read("done", ["groupBy": "area", "sortBy": "title", "collapsedGroupIds": [sectionID], "offset": 0, "limit": 50])
        XCTAssertEqual(collapsed["total"] as? Int, 1)
        XCTAssertEqual(collapsed["count"] as? Int, 101)
        XCTAssertEqual(collapsed["collapsedGroupIds"] as? [String], [sectionID])
        XCTAssertEqual((collapsed["items"] as? [[String: Any]])?.first?["collapsed"] as? Bool, true)
        let tokens = try XCTUnwrap(filters["tokens"] as? [String: Any])
        XCTAssertEqual(tokens["total"] as? Int, 101)
        XCTAssertEqual((tokens["items"] as? [Any])?.count, 100)
        let tail = try await read("collection", ["view": "done", "collection": "tokens", "params": params, "offset": 100, "limit": 50, "revision": revision])
        XCTAssertEqual(tail["revision"] as? String, revision)
        XCTAssertEqual(tail["total"] as? Int, 101)
        XCTAssertEqual((tail["items"] as? [[String: Any]])?.compactMap { $0["value"] as? String }, ["#done100"])
        let found = try await read("collection", ["view": "done", "collection": "tokens", "params": params, "query": "DONE100", "offset": 0, "limit": 50, "revision": revision])
        XCTAssertEqual(found["total"] as? Int, 1)
        let token = try XCTUnwrap((found["items"] as? [[String: Any]])?.first)
        var input = params
        input.merge(["filterEdit": try XCTUnwrap(token["edit"]), "offset": 0, "limit": 50]) { _, new in new }
        let filtered = try await read("done", input)
        XCTAssertEqual(filtered["count"] as? Int, 1)
        XCTAssertEqual((filtered["items"] as? [[String: Any]])?.compactMap { ($0["row"] as? [String: Any])?["id"] as? String }, ["done-task-100"])
        let filteredFilters = try XCTUnwrap(filtered["filters"] as? [String: Any])
        input["filters"] = try XCTUnwrap(filteredFilters["state"])
        input["filterEdit"] = try XCTUnwrap(filteredFilters["clearEdit"])
        let cleared = try await read("done", input)
        XCTAssertEqual(cleared["revision"] as? String, revision)
        await expectFailure("STALE_REVISION") { _ = try await read("done", ["groupBy": "none", "sortBy": "title", "offset": 50, "limit": 50, "revision": revision]) }
        await expectFailure("STALE_REVISION") { _ = try await read("collection", ["view": "done", "collection": "tokens", "params": params, "offset": 100, "limit": 50, "revision": revision + "-stale"]) }
        await expectFailure("INVALID_INPUT") { _ = try await read("history", ["tab": 7]) }
        for invalid in [["offset": 1, "limit": 1] as [String: Any], ["offset": 0, "limit": 101], ["offset": 0, "limit": 1, "includeArchivedProjects": true], ["offset": 0, "limit": 1, "sortBy": "invented"]] {
            await expectFailure("INVALID_INPUT") { _ = try await read("done", invalid) }
        }
        await expectFailure("Unsupported native menu collection") { _ = try await read("collection", ["view": "done", "collection": "projects"]) }
        for name in ["history", "done"] {
            for malformed in ["[]", "null", "broken JSON"] {
                await expectFailure { _ = try await core.call("menuRead", argumentsJSON: json([name, malformed])) }
            }
        }
        XCTAssertEqual(statements, 0)
        XCTAssertEqual(journalWrites, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testArchiveTaskProjectAndTokenWindowsReadWithoutWrites() async throws {
        let initializer = host()
        _ = try await initializer.start()
        await initializer.close()
        let sqlite = try SQLiteBridge(url: database)
        let at = "2026-01-01T12:00:00.000Z"
        let completed = "2026-01-02T12:00:00.000Z"
        let cancelled = "2026-01-03T12:00:00.000Z"
        _ = try sqlite.execute("INSERT INTO areas (id, name, color, orderNum, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["archive-area", "Archive area", "#abcdef", 0, at, at]))
        for isCancelled in [false, true] {
            _ = try sqlite.execute("INSERT INTO projects (id, title, status, color, areaId, cancelledAt, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json([isCancelled ? "cancelled-project" : "archived-project", isCancelled ? "Cancelled project" : "Completed project", "archived",
                                                         isCancelled ? "#94a3b8" : "#123456", "archive-area", isCancelled ? cancelled as Any : NSNull(), at, isCancelled ? cancelled : completed, 1]))
        }
        for index in 0..<102 {
            let suffix = String(format: "%03d", index)
            let isCancelled = index == 101
            let tags = index == 0 ? ["#archive000", "#shared"] : [isCancelled ? "#cancelled" : "#archive\(suffix)"]
            _ = try sqlite.execute("INSERT INTO tasks (id, title, status, areaId, tags, contexts, description, completedAt, cancelledAt, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json([isCancelled ? "archive-cancelled" : "archive-task-\(suffix)", isCancelled ? "Archive cancelled" : "Archive \(suffix)",
                                                         "archived", "archive-area", json(tags), "[]", "**Saved** reference note", isCancelled ? NSNull() : completed as Any,
                                                         isCancelled ? cancelled as Any : NSNull(), at, completed, 1]))
        }
        _ = try sqlite.execute("UPDATE tasks SET projectId = ? WHERE id = ?",
                               parametersJSON: json(["archived-project", "archive-task-001"]))
        sqlite.close()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        var statements = 0
        var journalWrites = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journalWrites += 1 }
        func read(_ name: String, _ input: [String: Any]) async throws -> [String: Any] {
            try object(await core.call("menuRead", argumentsJSON: json([name, json(input)])))
        }
        let closed = try await read("archive", ["offset": 0, "limit": 50])
        XCTAssertEqual(((closed["filters"] as? [String: Any])?["tokens"] as? [String: Any])?["total"] as? Int, 0)
        let view = try await read("archive", ["sortBy": "title", "filterSheetOpen": true, "offset": 0, "limit": 50])
        let revision = try XCTUnwrap(view["revision"] as? String)
        XCTAssertEqual(view["segment"] as? String, "tasks")
        XCTAssertEqual(view["total"] as? Int, 102)
        XCTAssertEqual(view["visibleTaskCount"] as? Int, 102)
        XCTAssertNotNil(view["search"] as? [String: Any])
        XCTAssertFalse(try XCTUnwrap(view["summary"] as? String).isEmpty)
        XCTAssertEqual((view["segments"] as? [[String: Any]])?.compactMap { $0["id"] as? String }, ["tasks", "projects"])
        let filters = try XCTUnwrap(view["filters"] as? [String: Any])
        let params: [String: Any] = ["sortBy": "title", "groupBy": "none", "segment": "tasks", "filterSheetOpen": true, "collapsedGroupIds": [], "filters": try XCTUnwrap(filters["state"])]
        var items = try XCTUnwrap(view["items"] as? [[String: Any]])
        for offset in [50, 100] {
            var input = params
            input.merge(["offset": offset, "limit": 50, "revision": revision]) { _, new in new }
            let page = try await read("archive", input)
            XCTAssertEqual(page["revision"] as? String, revision)
            XCTAssertEqual(page["total"] as? Int, 102)
            items += try XCTUnwrap(page["items"] as? [[String: Any]])
        }
        XCTAssertEqual(items.compactMap { ($0["row"] as? [String: Any])?["id"] as? String },
                       (0..<101).map { String(format: "archive-task-%03d", $0) } + ["archive-cancelled"])
        let labels = try XCTUnwrap(view["labels"] as? [String: Any])
        let finished = try XCTUnwrap(items.first)
        XCTAssertEqual(finished["cancelled"] as? Bool, false)
        XCTAssertEqual(finished["struck"] as? Bool, true)
        XCTAssertEqual(finished["completedAtValue"] as? String, completed)
        XCTAssertNotNil(finished["completedAtPicker"] as? [String: Any])
        XCTAssertEqual(finished["descriptionMarkdown"] as? String, "**Saved** reference note")
        XCTAssertTrue(try XCTUnwrap(finished["dateLabel"] as? String).hasPrefix(XCTUnwrap(labels["completed"] as? String) + ": "))
        let abandoned = try XCTUnwrap(items.last)
        XCTAssertEqual(abandoned["cancelled"] as? Bool, true)
        XCTAssertEqual(abandoned["struck"] as? Bool, false)
        XCTAssertTrue(abandoned["completedAtValue"] is NSNull)
        XCTAssertTrue(abandoned["completedAtPicker"] is NSNull)
        XCTAssertTrue(try XCTUnwrap(abandoned["dateLabel"] as? String).hasPrefix(XCTUnwrap(labels["taskCancelled"] as? String) + ": "))
        // The native editor passes the whole returned draft into its View tab,
        // including archived status for both completed and cancelled records.
        for (id, title, readOnly) in [("archive-task-000", "Archive 000", false),
                                       ("archive-cancelled", "Archive cancelled", false),
                                       ("archive-task-001", "Archive 001", true)] {
            let editor = try object(await core.call("editorModel", argumentsJSON: json([id])))
            XCTAssertEqual(editor["readOnly"] as? Bool, readOnly)
            let draft = try XCTUnwrap(editor["draft"] as? [String: Any])
            XCTAssertEqual(draft["status"] as? String, "archived")
            XCTAssertEqual(draft["title"] as? String, title)
            XCTAssertEqual(draft["description"] as? String, "**Saved** reference note")
            let preview = try object(await core.call("taskView", argumentsJSON: json([json(["id": id, "draft": draft, "offset": 0, "limit": 100])])))
            XCTAssertEqual(preview["id"] as? String, id)
            XCTAssertEqual(preview["readOnly"] as? Bool, readOnly)
            if readOnly { XCTAssertFalse(try XCTUnwrap(preview["readOnlyHint"] as? String).isEmpty) }
            let rows = try XCTUnwrap(preview["rows"] as? [[String: Any]])
            XCTAssertEqual(rows.first { $0["type"] as? String == "title" }?["value"] as? String, title)
            let blocks = try XCTUnwrap(rows.first { $0["type"] as? String == "description" }?["blocks"] as? [[String: Any]])
            XCTAssertEqual(blocks.count, 1)
            XCTAssertEqual(blocks.first?["type"] as? String, "paragraph")
            let inline = try XCTUnwrap(blocks.first?["inline"] as? [[String: Any]])
            XCTAssertEqual(inline.compactMap { $0["text"] as? String }.joined(), "Saved reference note")
            XCTAssertEqual(inline.first?["type"] as? String, "bold")
            XCTAssertEqual(inline.first?["text"] as? String, "Saved")
        }
        let tokens = try XCTUnwrap(filters["tokens"] as? [String: Any])
        XCTAssertEqual(tokens["total"] as? Int, 103)
        XCTAssertEqual((tokens["items"] as? [Any])?.count, 100)
        let tail = try await read("archiveTokens", ["params": params, "offset": 100, "limit": 50, "revision": revision])
        XCTAssertEqual(tail["revision"] as? String, revision)
        XCTAssertEqual(tail["total"] as? Int, 103)
        XCTAssertEqual((tail["items"] as? [[String: Any]])?.compactMap { $0["value"] as? String }, ["#archive100", "#cancelled", "#shared"])
        let found = try await read("archiveTokens", ["params": params, "query": "ARCHIVE100", "offset": 0, "limit": 50, "revision": revision])
        XCTAssertEqual(found["total"] as? Int, 1)
        let token = try XCTUnwrap((found["items"] as? [[String: Any]])?.first)
        XCTAssertEqual(token["value"] as? String, "#archive100")
        var input = params
        input.merge(["filterEdit": try XCTUnwrap(token["edit"]), "offset": 0, "limit": 50]) { _, new in new }
        let filtered = try await read("archive", input)
        XCTAssertEqual(filtered["total"] as? Int, 1)
        XCTAssertEqual(((filtered["items"] as? [[String: Any]])?.first?["row"] as? [String: Any])?["id"] as? String, "archive-task-100")
        let filteredFilters = try XCTUnwrap(filtered["filters"] as? [String: Any])
        input["filters"] = try XCTUnwrap(filteredFilters["state"])
        input["filterEdit"] = try XCTUnwrap(filteredFilters["clearEdit"])
        let cleared = try await read("archive", input)
        XCTAssertEqual(cleared["total"] as? Int, 102)
        XCTAssertEqual(try json(XCTUnwrap((cleared["filters"] as? [String: Any])?["state"])), try json(XCTUnwrap(filters["state"])))
        let grouped = try await read("archive", ["groupBy": "tag", "filters": ["searchQuery": "Archive 000"], "offset": 0, "limit": 50])
        XCTAssertEqual(grouped["total"] as? Int, 4)
        XCTAssertEqual(grouped["visibleTaskCount"] as? Int, 1)
        let duplicates = try XCTUnwrap(grouped["items"] as? [[String: Any]]).filter { $0["type"] as? String == "task" }
        XCTAssertEqual(duplicates.compactMap { ($0["row"] as? [String: Any])?["id"] as? String }, ["archive-task-000", "archive-task-000"])
        XCTAssertEqual(Set(duplicates.compactMap { $0["groupId"] as? String }).count, 2)
        let collapsed = try await read("archive", ["groupBy": "area", "collapsedGroupIds": ["archive-area"], "offset": 0, "limit": 50])
        XCTAssertEqual(collapsed["total"] as? Int, 1)
        XCTAssertEqual(collapsed["visibleTaskCount"] as? Int, 0)
        XCTAssertEqual((collapsed["items"] as? [[String: Any]])?.first?["collapsed"] as? Bool, true)
        let empty = try await read("archive", ["filters": ["searchQuery": "No matching record"], "offset": 0, "limit": 50])
        XCTAssertEqual(empty["total"] as? Int, 0)
        XCTAssertNotNil((empty["empty"] as? [String: Any])?["clearLabel"] as? String)
        let projects = try await read("archive", ["segment": "projects", "offset": 0, "limit": 1])
        XCTAssertEqual(projects["total"] as? Int, 2)
        XCTAssertTrue(projects["search"] is NSNull)
        let cancelledProject = try XCTUnwrap((projects["items"] as? [[String: Any]])?.first)
        XCTAssertEqual(cancelledProject["id"] as? String, "cancelled-project")
        XCTAssertEqual(cancelledProject["cancelled"] as? Bool, true)
        XCTAssertEqual(cancelledProject["struck"] as? Bool, false)
        XCTAssertEqual(cancelledProject["areaName"] as? String, "Archive area")
        XCTAssertEqual(cancelledProject["indicatorColor"] as? String, "#abcdef")
        let projectTail = try await read("archive", ["segment": "projects", "offset": 1, "limit": 1, "revision": revision])
        let completedProject = try XCTUnwrap((projectTail["items"] as? [[String: Any]])?.first)
        XCTAssertEqual(completedProject["id"] as? String, "archived-project")
        XCTAssertEqual(completedProject["struck"] as? Bool, true)
        XCTAssertEqual(completedProject["indicatorColor"] as? String, "#123456")
        for name in ["archive", "archiveTokens"] {
            await expectFailure("STALE_REVISION") { _ = try await read(name, ["params": params, "offset": 0, "limit": 50, "revision": revision + "-stale"]) }
            for malformed in ["[]", "null", "broken JSON"] {
                await expectFailure { _ = try await core.call("menuRead", argumentsJSON: json([name, malformed])) }
            }
        }
        for invalid in [["offset": 1, "limit": 1] as [String: Any], ["offset": 0, "limit": 101], ["offset": 0, "limit": 1, "segment": "done"], ["offset": 0, "limit": 1, "filterSheetOpen": 1]] {
            await expectFailure("INVALID_INPUT") { _ = try await read("archive", invalid) }
        }
        for invalid in [["params": params, "offset": 0, "limit": 1] as [String: Any], ["params": params, "query": String(repeating: "x", count: 501), "offset": 0, "limit": 1, "revision": revision],
                        ["params": ["filterEdit": ["type": "clear"]], "offset": 0, "limit": 1, "revision": revision]] {
            await expectFailure("INVALID_INPUT") { _ = try await read("archiveTokens", invalid) }
        }
        await expectFailure("unavailable") { _ = try await core.call("menuCommand", argumentsJSON: json(["archive", "{}"])) }
        XCTAssertEqual(statements, 0)
        XCTAssertEqual(journalWrites, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testTrashMixedTimelineAreaFilteringAndExactPagesReadWithoutWrites() async throws {
        let initializer = host()
        _ = try await initializer.start()
        await initializer.close()
        let sqlite = try SQLiteBridge(url: database)
        // Keep every deletion within retention regardless of when this test runs.
        let now = Date()
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let at = formatter.string(from: now.addingTimeInterval(-86_400))
        for (index, id) in ["trash-area", "hidden-area"].enumerated() {
            _ = try sqlite.execute("INSERT INTO areas (id, name, color, orderNum, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json([id, id, index == 0 ? "#abcdef" : "#fedcba", index, at, at]))
        }
        for index in 0..<52 {
            let suffix = String(format: "%03d", index)
            let area = index == 51 ? "hidden-area" : "trash-area"
            let taskDeleted = formatter.string(from: now.addingTimeInterval(-Double(index * 120)))
            let projectDeleted = formatter.string(from: now.addingTimeInterval(-Double(index * 120 + 60)))
            // IDs deliberately overlap across kinds; neither entity may displace the other.
            _ = try sqlite.execute("INSERT INTO tasks (id, title, status, areaId, tags, contexts, description, isFocusedToday, showFutureRecurrence, suppressMindwtrReminders, pushCount, createdAt, updatedAt, deletedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json(["trash-\(suffix)", "Deleted task \(index)", "next", area, "[]", "[]", "**Kept** note", 0, 0, 0, 0, at, at, taskDeleted, 1]))
            _ = try sqlite.execute("INSERT INTO projects (id, title, status, color, areaId, orderNum, isSequential, isFocused, createdAt, updatedAt, deletedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json(["trash-\(suffix)", "Deleted project \(index)", "active", index % 2 == 0 ? "#94a3b8" : "#123456", area, index, 0, 0, at, at, projectDeleted, 1]))
        }
        let settingsRows = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(sqlite.execute("SELECT data FROM settings WHERE id = 1").utf8)) as? [[String: Any]])
        var settings = try object(XCTUnwrap(settingsRows.first?["data"] as? String))
        settings["filters"] = ["areaIds": ["trash-area"], "excludedAreaIds": []]
        _ = try sqlite.execute("UPDATE settings SET data = ? WHERE id = 1", parametersJSON: json([json(settings)]))
        sqlite.close()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        var statements = 0
        var journalWrites = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journalWrites += 1 }
        func read(_ input: [String: Any]) async throws -> [String: Any] {
            try object(await core.call("menuRead", argumentsJSON: json(["trash", json(input)])))
        }
        let view = try await read(["offset": 0, "limit": 50])
        let revision = try XCTUnwrap(view["revision"] as? String)
        XCTAssertEqual(view["taskCount"] as? Int, 51)
        XCTAssertEqual(view["projectCount"] as? Int, 51)
        XCTAssertEqual(view["total"] as? Int, 102)
        XCTAssertEqual(view["summary"] as? String, "51 tasks · 51 projects")
        XCTAssertTrue(try XCTUnwrap(view["retentionHint"] as? String).contains("90"))
        XCTAssertTrue(view["empty"] is NSNull)
        XCTAssertEqual(try json(XCTUnwrap(view["selected"])), try json(["taskIds": [], "projectIds": []] as [String: [String]]))
        var items = try XCTUnwrap(view["items"] as? [[String: Any]])
        XCTAssertEqual(items.count, 50)
        for offset in [50, 100, 102] {
            let page = try await read(["offset": offset, "limit": 50, "revision": revision])
            XCTAssertEqual(page["revision"] as? String, revision)
            XCTAssertEqual(page["total"] as? Int, 102)
            XCTAssertEqual(page["taskCount"] as? Int, 51)
            XCTAssertEqual(page["projectCount"] as? Int, 51)
            let rows = try XCTUnwrap(page["items"] as? [[String: Any]])
            XCTAssertEqual(rows.count, min(50, 102 - offset))
            items += rows
        }
        let identities = try items.map { item -> String in
            let kind = try XCTUnwrap(item["type"] as? String)
            let id = try XCTUnwrap(kind == "task" ? (item["row"] as? [String: Any])?["id"] as? String : item["id"] as? String)
            return "\(kind):\(id)"
        }
        XCTAssertEqual(identities, (0..<51).flatMap { index in
            let id = String(format: "trash-%03d", index)
            return ["task:\(id)", "project:\(id)"]
        })
        XCTAssertEqual(Set(identities).count, 102)
        let labels = try XCTUnwrap(view["labels"] as? [String: Any])
        let deletedPrefix = try XCTUnwrap(labels["deleted"] as? String) + ": "
        for item in items {
            let kind = try XCTUnwrap(item["type"] as? String)
            XCTAssertEqual(item["typeLabel"] as? String, labels[kind == "task" ? "taskType" : "projectType"] as? String)
            let deletedLabel = try XCTUnwrap(item["deletedLabel"] as? String)
            XCTAssertTrue(deletedLabel.hasPrefix(deletedPrefix))
            XCTAssertGreaterThan(deletedLabel.count, deletedPrefix.count)
            if kind == "task" { XCTAssertEqual(item["descriptionMarkdown"] as? String, "**Kept** note") }
        }
        XCTAssertEqual(items[1]["indicatorColor"] as? String, "#abcdef")
        XCTAssertEqual(items[3]["indicatorColor"] as? String, "#123456")
        await expectFailure("STALE_REVISION") { _ = try await read(["offset": 50, "limit": 50, "revision": revision + "-stale"]) }
        for invalid in [["offset": 1, "limit": 1] as [String: Any], ["offset": 0, "limit": 101], ["offset": -1, "limit": 1], ["offset": true, "limit": 1],
                        ["offset": 0, "limit": 1, "selected": ["taskIds": [7], "projectIds": []]], ["offset": 0, "limit": 1, "selected": NSNull()]] {
            await expectFailure("INVALID_INPUT") { _ = try await read(invalid) }
        }
        for malformed in ["[]", "null", "broken JSON"] {
            await expectFailure { _ = try await core.call("menuRead", argumentsJSON: json(["trash", malformed])) }
        }
        await expectFailure("Unsupported native menu collection") { _ = try await core.call("menuRead", argumentsJSON: json(["collection", json(["view": "trash", "collection": "tokens"])])) }
        await expectFailure("unavailable") { _ = try await core.call("menuCommand", argumentsJSON: json(["trash", "{}"])) }
        XCTAssertEqual(statements, 0)
        XCTAssertEqual(journalWrites, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testContextsChipsMatchingSearchAndBoundedPagesReadWithoutWrites() async throws {
        let source = try dateBundle(at: "2026-09-27T12:00:00.000Z")
        let initializer = host(bundleURL: source)
        _ = try await initializer.start()
        await initializer.close()
        let sqlite = try SQLiteBridge(url: database)
        let at = "2026-09-26T12:00:00.000Z"
        for status in ["someday", "waiting", "archived"] {
            _ = try sqlite.execute("INSERT INTO projects (id, title, status, color, isSequential, isFocused, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json(["contexts-project-\(status)", status, status, "#94a3b8", 0, 0, at, at, 1]))
        }
        func insert(_ id: String, status: String = "next", contexts: [String] = [], tags: [String] = [], project: String? = nil, deleted: Bool = false) throws {
            _ = try sqlite.execute("INSERT INTO tasks (id, title, status, taskMode, projectId, contexts, tags, isFocusedToday, showFutureRecurrence, suppressMindwtrReminders, pushCount, createdAt, updatedAt, deletedAt, completedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json([id, id, status, "task", project as Any? ?? NSNull(), json(contexts), json(tags), 0, 0, 0, 0, at, at,
                                                         deleted ? at as Any : NSNull(), ["done", "archived"].contains(status) ? at as Any : NSNull(), 1]))
        }
        let bulkIds = (0..<101).map { String(format: "contexts-bulk-%03d", $0) }
        for (index, id) in bulkIds.enumerated() {
            try insert(id, contexts: [String(format: "@context-%03d", index)], tags: ["#batch"])
        }
        try insert("contexts-combo", contexts: ["@office/deep", "@secondary"], tags: ["#red", "#blue"])
        try insert("contexts-office", status: "waiting", contexts: ["@office"], tags: ["#red"])
        try insert("contexts-tag", status: "reference", tags: ["#blue"])
        try insert("contexts-none", status: "inbox")
        for status in ["done", "archived"] { try insert("hidden-\(status)", status: status, contexts: ["@hidden"]) }
        try insert("hidden-deleted", contexts: ["@hidden"], deleted: true)
        for status in ["someday", "waiting", "archived"] {
            // Reference remains Reference under an archived parent during normal load.
            try insert("hidden-project-\(status)", status: status == "archived" ? "reference" : "next", contexts: ["@hidden"], project: "contexts-project-\(status)")
        }
        let settingsRows = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(sqlite.execute("SELECT data FROM settings WHERE id = 1").utf8)) as? [[String: Any]])
        var settings = try object(XCTUnwrap(settingsRows.first?["data"] as? String))
        settings["taskSortBy"] = "title"
        _ = try sqlite.execute("UPDATE settings SET data = ? WHERE id = 1", parametersJSON: json([json(settings)]))
        sqlite.close()
        let faults = HostIOFaults()
        let core = host(faults, bundleURL: source)
        _ = try await core.start()
        func snapshot() throws -> [String: String] {
            let reader = try SQLiteBridge(url: database)
            defer { reader.close() }
            return try Dictionary(uniqueKeysWithValues: ["tasks", "projects", "settings"].map {
                ($0, try json(JSONSerialization.jsonObject(with: Data(reader.execute("SELECT * FROM \($0) ORDER BY id").utf8))))
            })
        }
        let before = try snapshot()
        var statements = 0
        var journalWrites = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journalWrites += 1 }
        func read(_ input: [String: Any]) async throws -> [String: Any] {
            try object(await core.call("menuRead", argumentsJSON: json(["contexts", json(input)])))
        }
        func ids(_ view: [String: Any]) throws -> [String] {
            try XCTUnwrap(view["rows"] as? [[String: Any]]).map { try XCTUnwrap($0["id"] as? String) }
        }
        func chip(_ view: [String: Any], _ id: String) throws -> [String: Any] {
            try XCTUnwrap((view["chips"] as? [[String: Any]])?.first { $0["id"] as? String == id })
        }
        func nextInput(_ chip: [String: Any]) throws -> [String: Any] {
            var input = try XCTUnwrap(chip["next"] as? [String: Any])
            input["offset"] = 0; input["limit"] = 50
            return input
        }
        let all = try await read(["matchMode": "any", "offset": 0, "limit": 50])
        let revision = try XCTUnwrap(all["revision"] as? String)
        let expectedIds = bulkIds + ["contexts-combo", "contexts-none", "contexts-office", "contexts-tag"]
        XCTAssertEqual(all["total"] as? Int, 105)
        XCTAssertEqual(try json(XCTUnwrap(all["selection"])), try json(["tokens": [], "matchMode": "all"] as [String: Any]))
        XCTAssertEqual(try ids(all), Array(expectedIds.prefix(50)))
        XCTAssertFalse(try XCTUnwrap(all["searchPlaceholder"] as? String).isEmpty)
        XCTAssertTrue(all["matchMode"] is NSNull)
        XCTAssertTrue(all["empty"] is NSNull)
        XCTAssertTrue(all["bulk"] is NSNull)
        XCTAssertEqual(all["selectedIds"] as? [String], [])
        XCTAssertEqual((all["chips"] as? [Any])?.count, 109)
        XCTAssertEqual(try chip(all, "all")["count"] as? Int, 105)
        XCTAssertEqual(try chip(all, "none")["count"] as? Int, 1)
        XCTAssertEqual(try chip(all, "@office")["count"] as? Int, 2)
        XCTAssertEqual(try chip(all, "#batch")["count"] as? Int, 101)
        XCTAssertEqual(try chip(all, "#blue")["count"] as? Int, 2)
        XCTAssertEqual(try chip(all, "@context-100")["count"] as? Int, 1)
        XCTAssertFalse((all["chips"] as? [[String: Any]])?.contains { $0["id"] as? String == "@hidden" } ?? true)
        var paged = try ids(all)
        for offset in [50, 100, 105] {
            let page = try await read(["offset": offset, "limit": 50, "revision": revision])
            XCTAssertEqual(page["total"] as? Int, 105)
            XCTAssertEqual(page["revision"] as? String, revision)
            XCTAssertEqual(try ids(page).count, min(50, 105 - offset))
            paged += try ids(page)
        }
        XCTAssertEqual(paged, expectedIds)
        XCTAssertEqual(Set(paged).count, 105)
        let none = try await read(nextInput(chip(all, "none")))
        XCTAssertEqual(try ids(none), ["contexts-none"])
        XCTAssertEqual(try chip(none, "none")["selected"] as? Bool, true)
        XCTAssertEqual((try chip(none, "none")["next"] as? [String: Any])?["tokens"] as? [String], [])
        let office = try await read(nextInput(chip(none, "@office")))
        XCTAssertEqual(try ids(office), ["contexts-combo", "contexts-office"])
        XCTAssertEqual((office["selection"] as? [String: Any])?["tokens"] as? [String], ["@office"])
        let andInput = try nextInput(chip(office, "#blue"))
        let both = try await read(andInput)
        XCTAssertEqual(try ids(both), ["contexts-combo"])
        let combo = try XCTUnwrap((both["rows"] as? [[String: Any]])?.first)
        let parts = try XCTUnwrap((combo["meta"] as? [String: Any])?["parts"] as? [[String: Any]])
        for (kind, token) in [("context", "@office/deep"), ("tag", "#red")] {
            let part = try XCTUnwrap(parts.first { $0["kind"] as? String == kind })
            XCTAssertEqual(part["text"] as? String, token)
            XCTAssertEqual(part["overflowCount"] as? Int, 1)
        }
        let modes = try XCTUnwrap((both["matchMode"] as? [String: Any])?["options"] as? [[String: Any]])
        XCTAssertEqual(modes.compactMap { $0["mode"] as? String }, ["all", "any"])
        XCTAssertEqual(modes.compactMap { $0["selected"] as? Bool }, [true, false])
        XCTAssertTrue(modes.allSatisfy { ($0["label"] as? String)?.isEmpty == false })
        var anyInput = andInput
        anyInput["matchMode"] = "any"
        let either = try await read(anyInput)
        XCTAssertEqual(try ids(either), ["contexts-combo", "contexts-office", "contexts-tag"])
        // RN's search field filters chips only, including case-insensitive token matching.
        let searched = try await read(["searchQuery": "  BLUE  ", "offset": 0, "limit": 50])
        XCTAssertEqual((searched["chips"] as? [[String: Any]])?.compactMap { $0["id"] as? String }, ["all", "none", "#blue"])
        XCTAssertEqual(searched["total"] as? Int, 105)
        XCTAssertEqual(try json(XCTUnwrap(searched["rows"])), try json(XCTUnwrap(all["rows"])))
        anyInput["searchQuery"] = "no matching chip or task title"
        let searchedSelection = try await read(anyInput)
        // RN keeps selected chips available even when the query matches neither.
        XCTAssertEqual((searchedSelection["chips"] as? [[String: Any]])?.compactMap { $0["id"] as? String },
                       ["all", "none", "@office", "#blue"])
        XCTAssertEqual(try chip(searchedSelection, "@office")["selected"] as? Bool, true)
        XCTAssertEqual(try chip(searchedSelection, "#blue")["selected"] as? Bool, true)
        XCTAssertEqual(try ids(searchedSelection), try ids(either))
        let empty = try await read(["tokens": ["@absent"], "offset": 0, "limit": 50])
        XCTAssertEqual(empty["total"] as? Int, 0)
        XCTAssertEqual(try ids(empty), [])
        XCTAssertEqual((empty["empty"] as? [String: Any])?["icon"] as? String, "check")
        await expectFailure("STALE_REVISION") { _ = try await read(["offset": 50, "limit": 50, "revision": revision + "-stale"]) }
        for invalid in [["offset": 1, "limit": 1] as [String: Any], ["offset": 0, "limit": 101], ["offset": -1, "limit": 1], ["offset": true, "limit": 1],
                        ["offset": 0, "limit": 0], ["offset": 0, "limit": 1, "tokens": [7]], ["offset": 0, "limit": 1, "tokens": "@office"],
                        ["offset": 0, "limit": 1, "tokens": Array(repeating: "@office", count: 501)], ["offset": 0, "limit": 1, "matchMode": "invalid"],
                        ["offset": 0, "limit": 1, "searchQuery": true], ["offset": 0, "limit": 1, "searchQuery": String(repeating: "x", count: 2001)]] {
            await expectFailure("INVALID_INPUT") { _ = try await read(invalid) }
        }
        for field in ["selectedIds", "action", "unknown"] {
            await expectFailure("Unsupported native Contexts browsing input") { _ = try await read(["offset": 0, "limit": 50, field: []]) }
        }
        for malformed in ["[]", "null", "broken JSON"] {
            await expectFailure { _ = try await core.call("menuRead", argumentsJSON: json(["contexts", malformed])) }
        }
        await expectFailure("unavailable") { _ = try await core.call("runContextsAction", argumentsJSON: json(["{}"])) }
        await expectFailure("unavailable") { _ = try await core.call("menuCommand", argumentsJSON: json(["contexts", "{}"])) }
        XCTAssertEqual(statements, 0)
        XCTAssertEqual(journalWrites, 0)
        XCTAssertEqual(try snapshot(), before)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testContextsAreaChangesImmediatelyRefreshRowsCountsAndRevision() async throws {
        let source = try dateBundle(at: "2026-09-27T12:00:00.000Z")
        let initializer = host(bundleURL: source)
        _ = try await initializer.start()
        await initializer.close()
        let sqlite = try SQLiteBridge(url: database)
        let at = "2026-09-26T12:00:00.000Z"
        for area in ["a", "b"] {
            _ = try sqlite.execute("INSERT INTO areas (id, name, color, orderNum, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json([area, area, "#94a3b8", area == "a" ? 0 : 1, at, at, 1]))
            _ = try sqlite.execute("INSERT INTO projects (id, title, status, color, areaId, isSequential, isFocused, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json(["project-\(area)", "Project \(area)", "active", "#94a3b8", area, 0, 0, at, at, 1]))
        }
        for (id, area, project, contexts, tags) in [
            ("a-direct", "a", "", ["@shared"], ["#alpha"]),
            ("a-project", "", "project-a", ["@shared"], ["#project"]),
            ("b-direct", "b", "", ["@beta"], ["#beta"]),
            ("b-project", "", "project-b", ["@shared"], ["#project"]),
            ("loose", "", "", [], []),
        ] {
            _ = try sqlite.execute("INSERT INTO tasks (id, title, status, taskMode, areaId, projectId, contexts, tags, isFocusedToday, showFutureRecurrence, suppressMindwtrReminders, pushCount, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json([id, id, "next", "task", area.isEmpty ? NSNull() : area as Any, project.isEmpty ? NSNull() : project as Any,
                                                         json(contexts), json(tags), 0, 0, 0, 0, at, at, 1]))
        }
        sqlite.close()
        let faults = HostIOFaults()
        let core = host(faults, bundleURL: source)
        _ = try await core.start()
        func taskSnapshot() throws -> String {
            let reader = try SQLiteBridge(url: database)
            defer { reader.close() }
            return try json(JSONSerialization.jsonObject(with: Data(reader.execute("SELECT * FROM tasks ORDER BY id").utf8)))
        }
        let before = try taskSnapshot()
        var statements = 0
        var journalWrites = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journalWrites += 1 }
        func read(_ input: [String: Any] = ["offset": 0, "limit": 50]) async throws -> [String: Any] {
            try object(await core.call("menuRead", argumentsJSON: json(["contexts", json(input)])))
        }
        func ids(_ view: [String: Any]) throws -> Set<String> {
            Set(try XCTUnwrap(view["rows"] as? [[String: Any]]).map { try XCTUnwrap($0["id"] as? String) })
        }
        func counts(_ view: [String: Any]) throws -> [String: Int] {
            try Dictionary(uniqueKeysWithValues: XCTUnwrap(view["chips"] as? [[String: Any]]).map {
                (try XCTUnwrap($0["id"] as? String), try XCTUnwrap($0["count"] as? Int))
            })
        }
        func select(_ id: String) async throws {
            let area = try object(await core.call("areaFilter"))
            let option = try XCTUnwrap((area["options"] as? [[String: Any]])?.first { $0["id"] as? String == id })
            XCTAssertEqual(statements, 0)
            XCTAssertEqual(journalWrites, 0)
            _ = try await core.call("setAreaFilter", argumentsJSON: json([json(XCTUnwrap(option["next"]))]))
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            // The existing area command intentionally persists settings. Count only subsequent reads.
            statements = 0; journalWrites = 0
        }
        let all = try await read()
        let revision = try XCTUnwrap(all["revision"] as? String)
        XCTAssertEqual(try ids(all), Set(["a-direct", "a-project", "b-direct", "b-project", "loose"]))
        XCTAssertEqual(try counts(all)["all"], 5)
        XCTAssertEqual(try counts(all)["none"], 1)
        XCTAssertEqual(try counts(all)["@shared"], 3)
        try await select("a")
        let areaA = try await read()
        let revisionA = try XCTUnwrap(areaA["revision"] as? String)
        XCTAssertNotEqual(revisionA, revision)
        XCTAssertEqual(try ids(areaA), Set(["a-direct", "a-project"]))
        XCTAssertEqual(try counts(areaA), ["all": 2, "none": 0, "@shared": 2, "#alpha": 1, "#project": 1])
        let sharedA = try await read(["tokens": ["@shared"], "offset": 0, "limit": 50])
        XCTAssertEqual(try ids(sharedA), try ids(areaA))
        await expectFailure("STALE_REVISION") { _ = try await read(["offset": 1, "limit": 1, "revision": revision]) }
        let areaView = try object(await core.call("areaFilter"))
        let options = try XCTUnwrap(areaView["options"] as? [[String: Any]])
        let allAreaId = try XCTUnwrap(options.first?["id"] as? String)
        let noAreaId = try XCTUnwrap(options.last?["id"] as? String)
        try await select(allAreaId)
        let restored = try await read()
        XCTAssertEqual(try ids(restored), try ids(all))
        XCTAssertEqual(try counts(restored), try counts(all))
        try await select("b")
        let areaB = try await read()
        XCTAssertEqual(try ids(areaB), Set(["b-direct", "b-project"]))
        XCTAssertEqual(try counts(areaB), ["all": 2, "none": 0, "@beta": 1, "@shared": 1, "#beta": 1, "#project": 1])
        await expectFailure("STALE_REVISION") { _ = try await read(["offset": 1, "limit": 1, "revision": revisionA]) }
        try await select(allAreaId)
        try await select(noAreaId)
        let loose = try await read()
        XCTAssertEqual(try ids(loose), Set(["loose"]))
        XCTAssertEqual(try counts(loose), ["all": 1, "none": 1])
        XCTAssertEqual(statements, 0)
        XCTAssertEqual(journalWrites, 0)
        XCTAssertEqual(try taskSnapshot(), before)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testMoreMenuReadRejectsOtherNamesAndMalformedInputWithoutWrites() async throws {
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        var statements = 0
        var journalWrites = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journalWrites += 1 }
        let more = try object(await core.call("menuRead", argumentsJSON: json(["more", "{}"])))
        XCTAssertNotNil(more["revision"] as? String)
        let utilities = try XCTUnwrap(more["utilities"] as? [[String: Any]])
        XCTAssertEqual(utilities.compactMap { $0["id"] as? String }, ["trash", "board", "history", "settings"])
        let primary = try XCTUnwrap(more["primary"] as? [[String: Any]])
        XCTAssertEqual(primary.first { $0["id"] as? String == "projects" }?["route"] as? String, "/projects-screen")
        XCTAssertTrue(primary.allSatisfy { ($0["label"] as? String)?.isEmpty == false && ($0["icon"] as? String)?.isEmpty == false })
        let searches = try XCTUnwrap(more["savedSearches"] as? [String: Any])
        XCTAssertEqual(searches["total"] as? Int, 0)
        for name in ["moveDialog", "contextsAction", "", "__proto__"] {
            await expectFailure("Unsupported native menu") { _ = try await core.call("menuRead", argumentsJSON: json([name, "{}"])) }
        }
        await expectFailure("Unsupported native Projects tag filter") {
            _ = try await core.call("menuRead", argumentsJSON: json(["projects", "{}"]))
        }
        for args in [["more", "[]"] as [Any], ["more", "null"], ["more", "broken JSON"], ["more", 7], ["more"], [7, "{}"]] {
            await expectFailure { _ = try await core.call("menuRead", argumentsJSON: json(args)) }
        }
        XCTAssertEqual(statements, 0)
        XCTAssertEqual(journalWrites, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testAreaSelectionRetriesFinalStateAcrossRestart() async throws {
        for afterCommit in [false, true] {
            let faults = HostIOFaults()
            let core = host(faults)
            _ = try await core.start()
            let view = try object(await core.call("areaFilter"))
            let options = try XCTUnwrap(view["options"] as? [[String: Any]])
            let noArea = try XCTUnwrap(options.last)
            let selection = try XCTUnwrap(noArea["next"] as? [String: Any])
            if afterCommit {
                faults.journalRemove = { throw HostFailure("Injected area acknowledgment failure") }
            } else {
                faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected area COMMIT failure") } }
            }
            await expectFailure { _ = try await core.call("setAreaFilter", argumentsJSON: json([json(selection)])) }
            await expectFailure("exact retry") { _ = try await core.call("focus", argumentsJSON: "[1]") }
            await core.close()
            let reopened = host()
            _ = try await reopened.start()
            let restored = try object(await reopened.call("areaFilter"))
            let restoredOptions = try XCTUnwrap(restored["options"] as? [[String: Any]])
            XCTAssertEqual(restoredOptions.last?["state"] as? String, afterCommit ? "excluded" : "included")
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            await reopened.close()
        }
    }

    func testFocusControlsFilterSortAndSavedApplyReadWithoutWrites() async throws {
        let source = try dateBundle(at: "2026-09-27T12:00:00.000Z")
        let initializer = host(bundleURL: source)
        _ = try await initializer.start()
        await initializer.close()
        let sqlite = try SQLiteBridge(url: database)
        let at = "2026-09-26T12:00:00.000Z"
        for id in ["focus-project-a", "focus-project-b"] {
            _ = try sqlite.execute("INSERT INTO projects (id, title, status, color, isSequential, isFocused, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json([id, id, "active", "#94a3b8", 0, 0, at, at, 1]))
        }
        let fixtures: [(String, [String], [String], String, String, String, String, String)] = [
            ("focus-a", ["@office"], ["#red"], "high", "high", "30min", "Office", "focus-project-a"),
            ("focus-b", ["@phone"], ["#blue"], "low", "low", "15min", "Home", "focus-project-b"),
            ("focus-c", ["@office", "@phone"], ["#red", "#blue"], "urgent", "low", "15min", "Office", "focus-project-a"),
            ("focus-d", [], [], "medium", "medium", "1hr", "Field", ""),
        ]
        for (index, row) in fixtures.enumerated() {
            _ = try sqlite.execute("INSERT INTO tasks (id, title, status, taskMode, projectId, contexts, tags, priority, energyLevel, timeEstimate, location, dueDate, orderNum, isFocusedToday, showFutureRecurrence, suppressMindwtrReminders, pushCount, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json([row.0, row.0, "next", "task", row.7.isEmpty ? NSNull() : row.7 as Any,
                                                         json(row.1), json(row.2), row.3, row.4, row.5, row.6, "2036-01-0\(4 - index)", index,
                                                         0, 0, 0, 0, at, at, 1]))
        }
        let criteria: [String: Any] = ["contexts": ["@phone"], "priority": ["urgent"], "dueDateRange": ["from": "2036-01-01", "to": "2036-01-04"]]
        _ = try sqlite.execute("INSERT INTO saved_filters (id, name, view, criteria, sortBy, groupBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["focus-saved", "Urgent phone", "focus", json(criteria), "title", "context", at, at]))
        sqlite.close()
        let faults = HostIOFaults()
        let core = host(faults, bundleURL: source)
        _ = try await core.start()
        func snapshot() throws -> String {
            let reader = try SQLiteBridge(url: database)
            defer { reader.close() }
            let rows = try Dictionary(uniqueKeysWithValues: ["tasks", "projects", "settings", "saved_filters"].map {
                ($0, try JSONSerialization.jsonObject(with: Data(reader.execute("SELECT * FROM \($0) ORDER BY id").utf8)))
            })
            return try json(rows)
        }
        let before = try snapshot()
        var statements = 0
        var journalWrites = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journalWrites += 1 }
        func read(_ input: [String: Any]) async throws -> [String: Any] {
            try object(await core.call("menuRead", argumentsJSON: json(["focus", json(input)])))
        }
        func controls(_ view: [String: Any]) throws -> [String: Any] { try XCTUnwrap(view["controls"] as? [String: Any]) }
        func sheet(_ view: [String: Any]) throws -> [String: Any] { try XCTUnwrap(controls(view)["filterSheet"] as? [String: Any]) }
        func next(_ view: [String: Any]) throws -> [String: Any] {
            try XCTUnwrap((view["sections"] as? [[String: Any]])?.first { $0["key"] as? String == "next" })
        }
        func ids(_ view: [String: Any]) throws -> [String] {
            try XCTUnwrap(next(view)["rows"] as? [[String: Any]]).map { try XCTUnwrap($0["id"] as? String) }
        }
        func apply(_ view: [String: Any], _ edit: Any) async throws -> [String: Any] {
            try await read(["limit": 50, "controls": XCTUnwrap(controls(view)["state"]), "controlEdit": edit])
        }
        func token(_ view: [String: Any], _ value: String) throws -> [String: Any] {
            try XCTUnwrap(((sheet(view)["tokens"] as? [String: Any])?["items"] as? [[String: Any]])?.first { $0["value"] as? String == value })
        }
        let base = try await read(["limit": 50, "controls": [:]])
        XCTAssertEqual(Set(try ids(base)), Set(["focus-a", "focus-b", "focus-c", "focus-d"]))
        let office = try await apply(base, XCTUnwrap(token(base, "@office")["edit"]))
        XCTAssertEqual(Set(try ids(office)), Set(["focus-a", "focus-c"]))
        XCTAssertEqual(try token(office, "@office")["state"] as? String, "included")
        let excluded = try await apply(office, XCTUnwrap(token(office, "@office")["edit"]))
        XCTAssertEqual(Set(try ids(excluded)), Set(["focus-b", "focus-d"]))
        XCTAssertEqual(try token(excluded, "@office")["state"] as? String, "excluded")
        let neutral = try await apply(excluded, XCTUnwrap(token(excluded, "@office")["edit"]))
        XCTAssertEqual(Set(try ids(neutral)), Set(try ids(base)))
        let both = try await apply(office, XCTUnwrap(token(office, "@phone")["edit"]))
        XCTAssertEqual(try ids(both), ["focus-c"])
        let contextMode = try XCTUnwrap((sheet(both)["matchModes"] as? [String: Any])?["context"] as? [String: Any])
        XCTAssertEqual(contextMode["visible"] as? Bool, true)
        let anyOption = try XCTUnwrap((contextMode["options"] as? [[String: Any]])?.first { $0["value"] as? String == "any" })
        let either = try await apply(both, XCTUnwrap(anyOption["edit"]))
        XCTAssertEqual(Set(try ids(either)), Set(["focus-a", "focus-b", "focus-c"]))
        let red = try await apply(base, XCTUnwrap(token(base, "#red")["edit"]))
        let redBlue = try await apply(red, XCTUnwrap(token(red, "#blue")["edit"]))
        XCTAssertEqual(try ids(redBlue), ["focus-c"])
        let tagMode = try XCTUnwrap((sheet(redBlue)["matchModes"] as? [String: Any])?["tag"] as? [String: Any])
        let anyTag = try XCTUnwrap((tagMode["options"] as? [[String: Any]])?.first { $0["value"] as? String == "any" })
        let eitherTag = try await apply(redBlue, XCTUnwrap(anyTag["edit"]))
        XCTAssertEqual(Set(try ids(eitherTag)), Set(["focus-a", "focus-b", "focus-c"]))
        for (field, value, expected) in [("priorities", "urgent", ["focus-c"]), ("energyLevels", "low", ["focus-b", "focus-c"]), ("timeEstimates", "15min", ["focus-b", "focus-c"])] {
            let option = try XCTUnwrap((sheet(base)[field] as? [[String: Any]])?.first { $0["value"] as? String == value })
            let filtered = try await apply(base, XCTUnwrap(option["edit"]))
            XCTAssertEqual(Set(try ids(filtered)), Set(expected))
        }
        let located = try await apply(base, ["type": "filter", "edit": ["type": "setLocation", "value": "Office"]])
        XCTAssertEqual(Set(try ids(located)), Set(["focus-a", "focus-c"]))
        let project = try XCTUnwrap(((sheet(base)["projects"] as? [String: Any])?["items"] as? [[String: Any]])?.first { $0["id"] as? String == "focus-project-a" })
        let inProject = try await apply(base, XCTUnwrap(project["edit"]))
        XCTAssertEqual(Set(try ids(inProject)), Set(["focus-a", "focus-c"]))
        let clear = try XCTUnwrap(sheet(inProject)["clear"] as? [String: Any])
        let cleared = try await apply(inProject, XCTUnwrap(clear["edit"]))
        XCTAssertEqual(Set(try ids(cleared)), Set(try ids(base)))
        let sort = try XCTUnwrap((controls(base)["view"] as? [String: Any])?["sort"] as? [String: Any])
        let due = try XCTUnwrap((sort["options"] as? [[String: Any]])?.first { $0["value"] as? String == "due" })
        let sorted = try await apply(base, XCTUnwrap(due["edit"]))
        XCTAssertEqual(try ids(sorted), ["focus-d", "focus-c", "focus-b", "focus-a"])
        XCTAssertEqual((try controls(sorted)["state"] as? [String: Any])?["sortBy"] as? String, "due")
        let saved = try XCTUnwrap(controls(base)["savedFilters"] as? [String: Any])
        let savedOption = try XCTUnwrap(((saved["chips"] as? [String: Any])?["items"] as? [[String: Any]])?.first)
        let applied = try await apply(base, XCTUnwrap(savedOption["edit"]))
        XCTAssertEqual((try controls(applied)["state"] as? [String: Any])?["savedFilterId"] as? String, "focus-saved")
        XCTAssertEqual(try next(applied)["total"] as? Int, 1)
        XCTAssertEqual(try next(applied)["rowTotal"] as? Int, 2)
        XCTAssertEqual(try ids(applied), ["focus-c", "focus-c"])
        XCTAssertEqual((try sheet(applied)["advancedChips"] as? [[String: Any]])?.count, 1)
        let appliedState = try XCTUnwrap(controls(applied)["state"] as? [String: Any])
        XCTAssertEqual(appliedState["sortBy"] as? String, "title")
        let titleRoundtrip = try await read(["limit": 50, "controls": appliedState])
        XCTAssertEqual(try json(titleRoundtrip), try json(applied))
        let titlePage = try object(await core.call("menuRead", argumentsJSON: json(["focusSection", json([
            "key": "next", "offset": 1, "limit": 1, "revision": XCTUnwrap(applied["revision"]), "controls": appliedState,
        ])])))
        XCTAssertEqual((titlePage["rows"] as? [[String: Any]])?.first?["id"] as? String, "focus-c")
        let titlePicker = try object(await core.call("menuRead", argumentsJSON: json(["focusControls", json([
            "list": "tokens", "offset": 0, "limit": 50, "revision": XCTUnwrap(applied["revision"]), "controls": appliedState, "query": "phone",
        ])])))
        XCTAssertEqual(titlePicker["total"] as? Int, 1)
        let detached = try await apply(applied, XCTUnwrap(token(applied, "@office")["edit"]))
        let detachedState = try XCTUnwrap(controls(detached)["state"] as? [String: Any])
        XCTAssertTrue(detachedState["savedFilterId"] is NSNull)
        XCTAssertEqual(detachedState["sortBy"] as? String, "title")
        let detachedRoundtrip = try await read(["limit": 50, "controls": detachedState])
        XCTAssertEqual(try json(detachedRoundtrip), try json(detached))
        let clearedTitle = try await apply(detached, XCTUnwrap((sheet(detached)["clear"] as? [String: Any])?["edit"]))
        XCTAssertEqual(try json(XCTUnwrap(controls(clearedTitle)["state"])), try json(XCTUnwrap(controls(base)["state"])))
        XCTAssertFalse((sort["options"] as? [[String: Any]])?.contains { $0["value"] as? String == "title" } ?? true)
        await expectFailure("INVALID_INPUT") { _ = try await apply(applied, ["type": "sort", "sortBy": "title"]) }
        let missing = try await read(["limit": 50, "controls": ["savedFilterId": "missing"]])
        XCTAssertTrue((try controls(missing)["state"] as? [String: Any])?["savedFilterId"] is NSNull)
        XCTAssertEqual(statements, 0)
        XCTAssertEqual(journalWrites, 0)
        XCTAssertEqual(try snapshot(), before)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        await core.close()
        let reopened = host(bundleURL: source)
        _ = try await reopened.start()
        let reset = try object(await reopened.call("menuRead", argumentsJSON: json(["focus", json(["limit": 50, "controls": [:]])])))
        XCTAssertEqual(try json(XCTUnwrap(controls(reset)["state"])), try json(XCTUnwrap(controls(base)["state"])))
    }

    func testFocusControlsGroupedOccurrencePagesKeepAbsoluteHeadingOffsetsAndLegacyFlatReads() async throws {
        let source = try dateBundle(at: "2026-09-27T12:00:00.000Z")
        let initializer = host(bundleURL: source)
        _ = try await initializer.start()
        await initializer.close()
        let sqlite = try SQLiteBridge(url: database)
        let at = "2026-09-26T12:00:00.000Z"
        let expected = (0..<51).map { String(format: "grouped-%03d", $0) }
        for (index, id) in expected.enumerated() {
            _ = try sqlite.execute("INSERT INTO tasks (id, title, status, taskMode, contexts, tags, orderNum, isFocusedToday, showFutureRecurrence, suppressMindwtrReminders, pushCount, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json([id, id, "next", "task", json(["@alpha", "@beta"]), "[]", index, 0, 0, 0, 0, at, at, 1]))
        }
        let settingsRows = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(sqlite.execute("SELECT data FROM settings WHERE id = 1").utf8)) as? [[String: Any]])
        var settings = try object(XCTUnwrap(settingsRows.first?["data"] as? String))
        var gtd = settings["gtd"] as? [String: Any] ?? [:]
        gtd["focusGroupBy"] = "context"; settings["gtd"] = gtd
        _ = try sqlite.execute("UPDATE settings SET data = ? WHERE id = 1", parametersJSON: json([json(settings)]))
        sqlite.close()
        let faults = HostIOFaults()
        let core = host(faults, bundleURL: source)
        _ = try await core.start()
        var statements = 0
        var journalWrites = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journalWrites += 1 }
        func read(_ name: String, _ input: [String: Any]) async throws -> [String: Any] {
            try object(await core.call("menuRead", argumentsJSON: json([name, json(input)])))
        }
        let first = try await read("focus", ["limit": 50, "controls": [:]])
        let controls = try XCTUnwrap((first["controls"] as? [String: Any])?["state"] as? [String: Any])
        let revision = try XCTUnwrap(first["revision"] as? String)
        let next = try XCTUnwrap((first["sections"] as? [[String: Any]])?.first { $0["key"] as? String == "next" })
        XCTAssertEqual(next["total"] as? Int, 51)
        XCTAssertEqual(next["rowTotal"] as? Int, 102)
        var ids = try XCTUnwrap(next["rows"] as? [[String: Any]]).compactMap { $0["id"] as? String }
        var groups = try XCTUnwrap(next["groups"] as? [[String: Any]])
        XCTAssertEqual(groups.compactMap { $0["start"] as? Int }, [0])
        for offset in [50, 100, 102] {
            let page = try await read("focusSection", ["key": "next", "offset": offset, "limit": 50, "revision": revision, "controls": controls])
            XCTAssertEqual(page["revision"] as? String, revision)
            XCTAssertEqual(page["total"] as? Int, 51)
            XCTAssertEqual(page["rowTotal"] as? Int, 102)
            let rows = try XCTUnwrap(page["rows"] as? [[String: Any]])
            XCTAssertEqual(rows.count, min(50, 102 - offset))
            ids += rows.compactMap { $0["id"] as? String }
            let headings = try XCTUnwrap(page["groups"] as? [[String: Any]])
            XCTAssertEqual(headings.compactMap { $0["start"] as? Int }, offset == 50 ? [51] : [])
            groups += headings
        }
        XCTAssertEqual(ids, expected + expected)
        XCTAssertEqual(Set(ids).count, 51)
        XCTAssertEqual(groups.compactMap { $0["id"] as? String }, ["context:@alpha", "context:@beta"])
        XCTAssertEqual(groups.compactMap { $0["count"] as? Int }, [51, 51])
        let legacy = try object(await core.call("focus", argumentsJSON: "[50]"))
        let legacyNext = try XCTUnwrap((legacy["sections"] as? [[String: Any]])?.first { $0["key"] as? String == "next" })
        XCTAssertNil(legacyNext["groups"])
        XCTAssertNil(legacyNext["rowTotal"])
        let legacyPage = try object(await core.call("focusWindow", argumentsJSON: json(["next", 50, 50, XCTUnwrap(legacy["revision"])])))
        let legacyFirst = try XCTUnwrap(legacyNext["rows"] as? [[String: Any]]).compactMap { $0["id"] as? String }
        let legacyLast = try XCTUnwrap(legacyPage["rows"] as? [[String: Any]]).compactMap { $0["id"] as? String }
        XCTAssertEqual(legacyFirst + legacyLast, expected)
        await expectFailure("STALE_REVISION") {
            _ = try await read("focusSection", ["key": "next", "offset": 50, "limit": 50, "revision": revision, "controls": ["sortBy": "due"]])
        }
        await expectFailure("STALE_REVISION") {
            _ = try await read("focusSection", ["key": "next", "offset": 50, "limit": 50, "revision": revision + "-stale", "controls": controls])
        }
        XCTAssertEqual(statements, 0)
        XCTAssertEqual(journalWrites, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testFocusControlsPickerQueriesReachPastFirstHundredAndRejectInvalidReads() async throws {
        let source = try dateBundle(at: "2026-09-27T12:00:00.000Z")
        let initializer = host(bundleURL: source)
        _ = try await initializer.start()
        await initializer.close()
        let sqlite = try SQLiteBridge(url: database)
        let at = "2026-09-26T12:00:00.000Z"
        for index in 0..<102 {
            let suffix = String(format: "%03d", index)
            _ = try sqlite.execute("INSERT INTO projects (id, title, status, color, orderNum, isSequential, isFocused, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json(["picker-\(suffix)", "Project \(suffix)", "active", "#94a3b8", index, 0, 0, at, at, 1]))
            _ = try sqlite.execute("INSERT INTO tasks (id, title, status, taskMode, projectId, contexts, tags, orderNum, isFocusedToday, showFutureRecurrence, suppressMindwtrReminders, pushCount, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json(["picker-task-\(suffix)", "Task \(suffix)", "next", "task", "picker-\(suffix)", json(["@token-\(suffix)"]), "[]", index, 0, 0, 0, 0, at, at, 1]))
        }
        _ = try sqlite.execute("INSERT INTO saved_filters (id, name, view, criteria, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["picker-saved", "Existing filter", "focus", json(["contexts": ["@token-101"]]), at, at]))
        sqlite.close()
        let faults = HostIOFaults()
        let core = host(faults, bundleURL: source)
        _ = try await core.start()
        func snapshot() throws -> String {
            let reader = try SQLiteBridge(url: database)
            defer { reader.close() }
            return try json(Dictionary(uniqueKeysWithValues: ["tasks", "projects", "settings", "saved_filters"].map {
                ($0, try JSONSerialization.jsonObject(with: Data(reader.execute("SELECT * FROM \($0) ORDER BY id").utf8)))
            }))
        }
        let before = try snapshot()
        var statements = 0
        var journalWrites = 0
        var diagnostics = 0
        var successfulPickerReads = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journalWrites += 1 }
        faults.commandDiagnostic = { if $0 == "focusControlsRead" { diagnostics += 1 } }
        func read(_ name: String, _ input: [String: Any]) async throws -> [String: Any] {
            let value = try object(await core.call("menuRead", argumentsJSON: json([name, json(input)])))
            if name == "focusControls" { successfulPickerReads += 1 }
            return value
        }
        let view = try await read("focus", ["limit": 50, "controls": [:]])
        let controlModel = try XCTUnwrap(view["controls"] as? [String: Any])
        let controls = try XCTUnwrap(controlModel["state"] as? [String: Any])
        let revision = try XCTUnwrap(view["revision"] as? String)
        let sheet = try XCTUnwrap(controlModel["filterSheet"] as? [String: Any])
        XCTAssertEqual(diagnostics, 0)
        for list in ["tokens", "projects"] {
            let initial = try XCTUnwrap(sheet[list] as? [String: Any])
            XCTAssertEqual(initial["total"] as? Int, 102)
            XCTAssertEqual((initial["items"] as? [Any])?.count, 100)
            let field = list == "tokens" ? "value" : "id"
            let prefix = list == "tokens" ? "@token-" : "picker-"
            var input: [String: Any] = ["list": list, "offset": 0, "limit": 100, "revision": revision, "controls": controls]
            let first = try await read("focusControls", input)
            XCTAssertEqual(try json(XCTUnwrap(first["items"])), try json(XCTUnwrap(initial["items"])))
            input["query"] = "  "
            let whitespace = try await read("focusControls", input)
            XCTAssertEqual(try json(whitespace), try json(first))
            input["offset"] = 100
            let tail = try await read("focusControls", input)
            XCTAssertEqual(tail["total"] as? Int, 102)
            XCTAssertEqual((tail["items"] as? [[String: Any]])?.compactMap { $0[field] as? String }, [prefix + "100", prefix + "101"])
            input["offset"] = 0; input["limit"] = 1; input["query"] = list == "tokens" ? "  TOKEN-10  " : "  PROJECT 10  "
            let matched = try await read("focusControls", input)
            XCTAssertEqual(matched["total"] as? Int, 2)
            XCTAssertEqual((matched["items"] as? [[String: Any]])?.first?[field] as? String, prefix + "100")
            input["offset"] = 1
            let matchedTail = try await read("focusControls", input)
            XCTAssertEqual(matchedTail["total"] as? Int, 2)
            XCTAssertEqual((matchedTail["items"] as? [[String: Any]])?.first?[field] as? String, prefix + "101")
            input["offset"] = 0; input["query"] = "  101  "
            let exact = try await read("focusControls", input)
            XCTAssertEqual(exact["total"] as? Int, 1)
            let option = try XCTUnwrap((exact["items"] as? [[String: Any]])?.first)
            XCTAssertEqual(option[field] as? String, prefix + "101")
            let applied = try await read("focus", ["limit": 50, "controls": controls, "controlEdit": XCTUnwrap(option["edit"])])
            let next = try XCTUnwrap((applied["sections"] as? [[String: Any]])?.first { $0["key"] as? String == "next" })
            XCTAssertEqual((next["rows"] as? [[String: Any]])?.compactMap { $0["id"] as? String }, ["picker-task-101"])
            var changedInput = input
            changedInput["controls"] = try XCTUnwrap((applied["controls"] as? [String: Any])?["state"])
            await expectFailure("STALE_REVISION") { _ = try await read("focusControls", changedInput) }
            input["query"] = "not-present"
            let empty = try await read("focusControls", input)
            XCTAssertEqual(empty["total"] as? Int, 0)
            XCTAssertEqual((empty["items"] as? [Any])?.count, 0)
        }
        let saved = try await read("focusControls", ["list": "savedFilters", "offset": 0, "limit": 50, "revision": revision, "controls": controls])
        XCTAssertEqual((saved["items"] as? [[String: Any]])?.first?["id"] as? String, "picker-saved")
        let validInputs: [String: [String: Any]] = [
            "focus": ["limit": 50, "controls": controls],
            "focusSection": ["key": "next", "offset": 0, "limit": 50, "revision": revision, "controls": controls],
            "focusControls": ["list": "tokens", "offset": 0, "limit": 50, "revision": revision, "controls": controls],
        ]
        for name in ["focus", "focusSection", "focusControls"] {
            let valid = try XCTUnwrap(validInputs[name])
            var missing = valid; missing.removeValue(forKey: "controls")
            await expectFailure("Unsupported native Focus read") { _ = try await read(name, missing) }
            for malformedControls in [NSNull(), [], "{}", true] as [Any] {
                var input = valid; input["controls"] = malformedControls
                await expectFailure("Unsupported native Focus read") { _ = try await read(name, input) }
            }
            for field in ["unknown", "requestId", "groupBy"] {
                var input = valid; input[field] = "unsupported"
                await expectFailure("Unsupported native Focus read") { _ = try await read(name, input) }
            }
            for invalidControls in [["unknown": true], ["sortBy": "unknown"], ["filters": ["searchQuery": "row search"]]] as [[String: Any]] {
                var input = valid; input["controls"] = invalidControls
                await expectFailure("INVALID_INPUT") { _ = try await read(name, input) }
            }
            for limit in [0, 101, true, 1.5, "1"] as [Any] {
                var input = valid; input["limit"] = limit
                await expectFailure("INVALID_INPUT") { _ = try await read(name, input) }
            }
            for malformed in ["[]", "null", "broken JSON"] {
                await expectFailure { _ = try await core.call("menuRead", argumentsJSON: json([name, malformed])) }
            }
        }
        for name in ["focusSection", "focusControls"] {
            var input = try XCTUnwrap(validInputs[name]); input["revision"] = revision + "-stale"
            await expectFailure("STALE_REVISION") { _ = try await read(name, input) }
            input["revision"] = revision; input["offset"] = -1
            await expectFailure("INVALID_INPUT") { _ = try await read(name, input) }
            input["offset"] = 0; input["controlEdit"] = ["type": "sort", "sortBy": "due"]
            await expectFailure("Unsupported native Focus read") { _ = try await read(name, input) }
        }
        for query in [NSNull(), true, 7, [], String(repeating: "x", count: 2001)] as [Any] {
            var input = try XCTUnwrap(validInputs["focusControls"]); input["query"] = query
            await expectFailure("INVALID_INPUT") { _ = try await read("focusControls", input) }
        }
        for query in ["", "filter"] {
            await expectFailure("INVALID_INPUT") { _ = try await read("focusControls", ["list": "savedFilters", "offset": 0, "limit": 50, "revision": revision, "controls": controls, "query": query]) }
        }
        await expectFailure("INVALID_INPUT") { _ = try await read("focusControls", ["list": "unknown", "offset": 0, "limit": 50, "revision": revision, "controls": controls]) }
        await expectFailure("INVALID_INPUT") { _ = try await read("focusSection", ["key": "unknown", "offset": 0, "limit": 50, "revision": revision, "controls": controls]) }
        for edit in [["type": "group", "groupBy": "context"], ["type": "filter", "edit": ["type": "setSearch", "value": "row search"]]] as [[String: Any]] {
            await expectFailure("INVALID_INPUT") { _ = try await read("focus", ["limit": 50, "controls": controls, "controlEdit": edit]) }
        }
        for method in ["setFocusGroupBy", "saveFocusFilter", "deleteFocusFilter", "removeFocusFilterCriterion", "reorderFocus"] {
            await expectFailure("unavailable") { _ = try await core.call(method, argumentsJSON: json(["{}"])) }
            await expectFailure("Unsupported native menu") { _ = try await core.call("menuRead", argumentsJSON: json([method, "{}"])) }
        }
        XCTAssertEqual(statements, 0)
        XCTAssertEqual(journalWrites, 0)
        XCTAssertEqual(diagnostics, successfulPickerReads)
        XCTAssertGreaterThan(diagnostics, 0)
        XCTAssertEqual(try snapshot(), before)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    private func seedReviewReadFixture(count: Int = 103) async throws -> URL {
        let source = try dateBundle(at: "2026-09-27T12:00:00.000Z")
        let initializer = host(bundleURL: source)
        _ = try await initializer.start()
        await initializer.close()
        let sqlite = try SQLiteBridge(url: database)
        defer { sqlite.close() }
        let old = "2026-08-01T12:00:00.000Z"
        for (index, area) in ["a", "b"].enumerated() {
            _ = try sqlite.execute("INSERT INTO areas (id, name, color, orderNum, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json(["review-area-\(area)", "Review area \(area)", "#94a3b8", index, old, old, 1]))
        }
        for index in 0..<count {
            let suffix = String(format: "%03d", index)
            _ = try sqlite.execute("INSERT INTO projects (id, title, status, color, areaId, orderNum, isSequential, isFocused, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json(["review-project-\(suffix)", "Review project \(suffix)", "active", "#94a3b8", "review-area-a", index, 0, 0, old, old, 1]))
            _ = try sqlite.execute("INSERT INTO tasks (id, title, status, taskMode, areaId, contexts, tags, dueDate, reviewAt, priority, orderNum, isFocusedToday, showFutureRecurrence, suppressMindwtrReminders, pushCount, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json(["review-task-\(suffix)", "Review task \(suffix)", "next", "task", index % 2 == 0 ? "review-area-a" : "review-area-b", json(["@review-bulk"]), json(["#review"]), "2026-09-27", index % 2 == 0 ? "2026-09-26" : "2036-01-01", "high", index, 0, 0, 0, 0, old, old, 1]))
        }
        for (id, status, project, reviewAt) in [
            ("review-inbox", "inbox", "", ""), ("review-waiting", "waiting", "", ""),
            ("review-someday", "someday", "", ""), ("review-project-task", "next", "review-project-000", "2026-09-26"),
        ] {
            _ = try sqlite.execute("INSERT INTO tasks (id, title, status, taskMode, projectId, reviewAt, contexts, tags, isFocusedToday, showFutureRecurrence, suppressMindwtrReminders, pushCount, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json([id, id, status, "task", project.isEmpty ? NSNull() : project as Any,
                                                         reviewAt.isEmpty ? NSNull() : reviewAt as Any, "[]", "[]", 0, 0, 0, 0, old, old, 1]))
        }
        let settingsRows = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(sqlite.execute("SELECT data FROM settings WHERE id = 1").utf8)) as? [[String: Any]])
        var settings = try object(XCTUnwrap(settingsRows.first?["data"] as? String))
        settings["taskSortBy"] = "title"
        settings["ai"] = ["enabled": true]
        settings["gtd"] = ["weeklyReview": ["includeContextStep": true], "dailyReview": ["includeFocusStep": true]]
        _ = try sqlite.execute("UPDATE settings SET data = ? WHERE id = 1", parametersJSON: json([json(settings)]))
        return source
    }

    private func reviewReadSnapshot() throws -> String {
        let reader = try SQLiteBridge(url: database)
        defer { reader.close() }
        return try json(Dictionary(uniqueKeysWithValues: ["tasks", "projects", "areas", "settings"].map {
            ($0, try JSONSerialization.jsonObject(with: Data(reader.execute("SELECT * FROM \($0) ORDER BY id").utf8)))
        }))
    }

    func testReviewOverviewScopeExpansionAreaAndRevisionReadWithoutWrites() async throws {
        let source = try await seedReviewReadFixture(count: 3)
        let faults = HostIOFaults()
        let core = host(faults, bundleURL: source)
        _ = try await core.start()
        _ = try await core.call("language", argumentsJSON: json(["en", "en-US"]))
        var before = try reviewReadSnapshot()
        var statements = 0, journalWrites = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journalWrites += 1 }
        func read(_ input: [String: Any]) async throws -> [String: Any] {
            try object(await core.call("menuRead", argumentsJSON: json(["reviewOverview", json(input)])))
        }
        func expanded(_ view: [String: Any], scope: String = "due") throws -> [String: Any] {
            ["scope": scope, "expandedAreaIds": try XCTUnwrap(view["expandedAreaIds"]),
             "expandedProjectIds": try XCTUnwrap(view["expandedProjectIds"]), "offset": 0, "limit": 50]
        }
        let due = try await read(["scope": "due", "offset": 0, "limit": 50])
        XCTAssertEqual((due["scope"] as? [String: Any])?["selected"] as? String, "due")
        let start = try XCTUnwrap(due["startReview"] as? [String: Any])
        XCTAssertEqual((start["options"] as? [[String: Any]])?.compactMap { $0["id"] as? String }, ["daily", "weekly"])
        let labels = try object(await core.call("strings", argumentsJSON: json([json(["review.startReview", "review.scopeDue"])])))
        let translated = try XCTUnwrap(labels["strings"] as? [String: Any])
        XCTAssertEqual(start["label"] as? String, translated["review.startReview"] as? String)
        XCTAssertFalse(try XCTUnwrap(start["label"] as? String).isEmpty)
        XCTAssertEqual(((due["scope"] as? [String: Any])?["options"] as? [[String: Any]])?.first?["label"] as? String, translated["review.scopeDue"] as? String)
        XCTAssertTrue(due["bulk"] is NSNull)
        let area = try XCTUnwrap((due["items"] as? [[String: Any]])?.first { $0["type"] as? String == "area" })
        XCTAssertEqual(area["title"] as? String, "Review area a")
        var input = try expanded(due)
        input["expansionEdit"] = ["type": "toggleArea", "id": try XCTUnwrap(area["id"])]
        let openedArea = try await read(input)
        let project = try XCTUnwrap((openedArea["items"] as? [[String: Any]])?.first { $0["projectId"] as? String == "review-project-000" })
        input = try expanded(openedArea)
        input["expansionEdit"] = ["type": "toggleProject", "id": try XCTUnwrap(project["id"])]
        let openedProject = try await read(input)
        let task = try XCTUnwrap((openedProject["items"] as? [[String: Any]])?.first { ($0["row"] as? [String: Any])?["id"] as? String == "review-project-task" })
        XCTAssertNotNil((task["row"] as? [String: Any])?["meta"])

        let firstCycle = try await read(["scope": "due", "expansionEdit": ["type": "cycle"], "offset": 0, "limit": 50])
        input = try expanded(firstCycle)
        input["expansionEdit"] = ["type": "cycle"]
        let allDue = try await read(input)
        let dueIDs = (allDue["items"] as? [[String: Any]])?.compactMap { ($0["row"] as? [String: Any])?["id"] as? String } ?? []
        XCTAssertEqual(Set(dueIDs), Set(["review-task-000", "review-task-002", "review-project-task"]))
        let revision = try XCTUnwrap(allDue["revision"] as? String)
        input = try expanded(allDue)
        input["offset"] = 2; input["limit"] = 2; input["revision"] = revision
        let page = try await read(input)
        XCTAssertEqual(try json(XCTUnwrap(page["items"])), try json(Array(try XCTUnwrap(allDue["items"] as? [[String: Any]]).dropFirst(2).prefix(2))))
        input.removeValue(forKey: "revision")
        await expectFailure("INVALID_INPUT") { _ = try await read(input) }
        input["revision"] = revision; input["scope"] = "all"
        await expectFailure("STALE_REVISION") { _ = try await read(input) }
        XCTAssertEqual(statements, 0); XCTAssertEqual(journalWrites, 0)
        XCTAssertEqual(try reviewReadSnapshot(), before)

        // Existing area selection intentionally writes settings; all following Review reads remain pure.
        let filter = try object(await core.call("areaFilter"))
        let option = try XCTUnwrap((filter["options"] as? [[String: Any]])?.first { $0["id"] as? String == "review-area-b" })
        _ = try await core.call("setAreaFilter", argumentsJSON: json([json(XCTUnwrap(option["next"]))]))
        before = try reviewReadSnapshot(); statements = 0; journalWrites = 0
        let scoped = try await read(["scope": "all", "offset": 0, "limit": 50])
        XCTAssertEqual((scoped["items"] as? [[String: Any]])?.compactMap { $0["areaId"] as? String }, ["review-area-b"])
        input = try expanded(allDue); input["revision"] = revision
        await expectFailure("STALE_REVISION") { _ = try await read(input) }
        XCTAssertEqual(statements, 0); XCTAssertEqual(journalWrites, 0)
        XCTAssertEqual(try reviewReadSnapshot(), before)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testReviewGuidedCheckpointsAndNestedPagesReadWithoutWrites() async throws {
        let source = try await seedReviewReadFixture()
        let faults = HostIOFaults()
        let core = host(faults, bundleURL: source)
        _ = try await core.start()
        let before = try reviewReadSnapshot()
        var statements = 0, journalWrites = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journalWrites += 1 }
        func read(_ name: String, _ input: [String: Any]) async throws -> [String: Any] {
            try object(await core.call("menuRead", argumentsJSON: json([name, json(input)])))
        }
        for name in ["dailyReview", "weeklyReview"] {
            let first = try await read(name, ["offset": 0, "limit": 50])
            let firstStep = try XCTUnwrap((first["step"] as? [String: Any])?["id"] as? String)
            XCTAssertEqual(first["resumed"] as? Bool, false)
            XCTAssertFalse(try XCTUnwrap(first["storageKey"] as? String).isEmpty)
            let next = try XCTUnwrap(first["next"] as? [String: Any])
            let checkpoint = try XCTUnwrap(next["checkpoint"] as? String)
            let second = try await read(name, ["checkpoint": checkpoint, "offset": 0, "limit": 50])
            XCTAssertEqual(second["resumed"] as? Bool, true)
            XCTAssertNotEqual((second["step"] as? [String: Any])?["id"] as? String, firstStep)
            XCTAssertEqual((second["back"] as? [String: Any])?["checkpoint"] as? String, first["checkpoint"] as? String)
            let resumed = try await read(name, ["checkpoint": try XCTUnwrap(second["checkpoint"]), "offset": 0, "limit": 50])
            XCTAssertEqual(try json(XCTUnwrap(resumed["step"])), try json(XCTUnwrap(second["step"])))
            let expired = try await read(name, ["checkpoint": json(["step": "completed", "startedAt": "2026-08-01T12:00:00.000Z"]), "offset": 0, "limit": 50])
            XCTAssertEqual(expired["resumed"] as? Bool, false)
            XCTAssertEqual((expired["step"] as? [String: Any])?["id"] as? String, firstStep)
            await expectFailure("INVALID_INPUT") { _ = try await read(name, ["offset": 50, "limit": 50]) }
            await expectFailure("STALE_REVISION") { _ = try await read(name, ["checkpoint": checkpoint, "offset": 0, "limit": 50, "revision": try XCTUnwrap(first["revision"])]) }
        }
        let daily = try await read("dailyReview", ["offset": 0, "limit": 50])
        XCTAssertEqual((daily["step"] as? [String: Any])?["id"] as? String, "today")
        XCTAssertEqual(daily["total"] as? Int, 103)
        var dailyIDs: [String] = []
        for offset in [0, 50, 100] {
            let page = try await read("dailyReview", ["checkpoint": try XCTUnwrap(daily["checkpoint"]), "offset": offset, "limit": 50, "revision": try XCTUnwrap(daily["revision"])])
            dailyIDs += try XCTUnwrap(page["items"] as? [[String: Any]]).compactMap { ($0["row"] as? [String: Any])?["id"] as? String }
        }
        XCTAssertEqual(dailyIDs, (0..<103).map { String(format: "review-task-%03d", $0) })

        func weeklyStep(_ wanted: String) async throws -> [String: Any] {
            var view = try await read("weeklyReview", ["offset": 0, "limit": 50])
            for _ in 0..<10 {
                if (view["step"] as? [String: Any])?["id"] as? String == wanted { return view }
                let next = try XCTUnwrap(view["next"] as? [String: Any])
                view = try await read("weeklyReview", ["checkpoint": try XCTUnwrap(next["checkpoint"]), "offset": 0, "limit": 50])
            }
            XCTFail("Review did not offer \(wanted)")
            return view
        }
        let contexts = try await weeklyStep("contexts")
        let group = try XCTUnwrap((contexts["items"] as? [[String: Any]])?.first { $0["context"] as? String == "@review-bulk" })
        let nested = try XCTUnwrap(group["tasks"] as? [String: Any])
        XCTAssertEqual(nested["total"] as? Int, 103)
        XCTAssertEqual((nested["items"] as? [Any])?.count, 100)
        let stale = try await weeklyStep("stale")
        let projects = try XCTUnwrap((stale["content"] as? [String: Any])?["projects"] as? [String: Any])
        XCTAssertEqual(projects["total"] as? Int, 103)
        XCTAssertEqual((projects["items"] as? [Any])?.count, 100)
        let ai = try XCTUnwrap(((stale["content"] as? [String: Any])?["ai"] as? [String: Any])?["items"] as? [String: Any])
        let aiTotal = try XCTUnwrap(ai["total"] as? Int)
        XCTAssertGreaterThan(aiTotal, 100)
        for (view, list, key, total) in [(contexts, "contextTasks", "@review-bulk", 103), (stale, "staleProjects", "", 103), (stale, "aiItems", "", aiTotal)] {
            var collected: [[String: Any]] = []
            for offset in stride(from: 0, to: total, by: 50) {
                var input: [String: Any] = ["checkpoint": try XCTUnwrap(view["checkpoint"]), "list": list, "offset": offset, "limit": 50, "revision": try XCTUnwrap(view["revision"])]
                if !key.isEmpty { input["key"] = key }
                let page = try await read("weeklyReviewList", input)
                XCTAssertEqual(page["total"] as? Int, total)
                collected += try XCTUnwrap(page["items"] as? [[String: Any]])
            }
            XCTAssertEqual(collected.count, total)
            XCTAssertEqual(Set(collected.compactMap { $0["id"] as? String }).count, total)
            let initial = list == "contextTasks" ? nested : list == "staleProjects" ? projects : ai
            XCTAssertEqual(try json(Array(collected.prefix(100))), try json(XCTUnwrap(initial["items"])))
            await expectFailure("STALE_REVISION") { _ = try await read("weeklyReviewList", ["checkpoint": try XCTUnwrap(view["checkpoint"]), "list": list, "key": key, "offset": 100, "limit": 50, "revision": "stale"]) }
        }
        let projectStep = try await weeklyStep("projects")
        let expanded = try await read("weeklyReview", ["checkpoint": try XCTUnwrap(projectStep["checkpoint"]), "expandedProjectId": "review-project-000", "offset": 0, "limit": 50])
        XCTAssertTrue((expanded["items"] as? [[String: Any]])?.contains { ($0["row"] as? [String: Any])?["id"] as? String == "review-project-task" } == true)
        XCTAssertEqual(statements, 0); XCTAssertEqual(journalWrites, 0)
        XCTAssertEqual(try reviewReadSnapshot(), before)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testReviewReadAliasesRejectUnsupportedAndMalformedInputsWithoutWrites() async throws {
        let source = try await seedReviewReadFixture(count: 1)
        let faults = HostIOFaults()
        let core = host(faults, bundleURL: source)
        _ = try await core.start()
        let before = try reviewReadSnapshot()
        var statements = 0, journalWrites = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journalWrites += 1 }
        func read(_ name: String, _ input: [String: Any]) async throws {
            _ = try await core.call("menuRead", argumentsJSON: json([name, json(input)]))
        }
        let weekly = try object(await core.call("menuRead", argumentsJSON: json(["weeklyReview", json(["offset": 0, "limit": 50])])))
        let checkpoint = try XCTUnwrap((weekly["next"] as? [String: Any])?["checkpoint"] as? String)
        let stale = try object(await core.call("menuRead", argumentsJSON: json(["weeklyReview", json(["checkpoint": checkpoint, "offset": 0, "limit": 50])])))
        for name in ["reviewOverview", "dailyReview", "weeklyReview", "weeklyReviewList"] {
            var valid: [String: Any] = ["offset": 0, "limit": 50]
            if name == "weeklyReviewList" {
                valid["checkpoint"] = checkpoint; valid["list"] = "staleProjects"; valid["revision"] = try XCTUnwrap(stale["revision"])
            }
            try await read(name, valid)
            for extra in ["selectedIds", "calendar", "action", "requestId", "unknown"] {
                var input = valid; input[extra] = NSNull()
                await expectFailure("Unsupported native Review browsing input") {
                    try await read(name, input)
                }
            }
            for malformed in [["offset": true], ["offset": -1], ["limit": 101], ["offset": 0.5], ["limit": "50"]] as [[String: Any]] {
                var input = valid; input.merge(malformed) { _, new in new }
                await expectFailure("INVALID_INPUT") { try await read(name, input) }
            }
            await expectFailure("JSON object") { _ = try await core.call("menuRead", argumentsJSON: json([name, "[]"])) }
        }
        for name in ["dailyReview", "weeklyReview"] {
            for checkpoint in [true, 5, ["step": "today"], String(repeating: "x", count: 1001)] as [Any] {
                await expectFailure("INVALID_INPUT") { try await read(name, ["checkpoint": checkpoint, "offset": 0, "limit": 50]) }
            }
        }
        await expectFailure("INVALID_INPUT") { try await read("reviewOverview", ["scope": "unknown", "offset": 0, "limit": 50]) }
        await expectFailure("INVALID_INPUT") { try await read("reviewOverview", ["expandedAreaIds": ["a", "a"], "offset": 0, "limit": 50]) }
        await expectFailure("INVALID_INPUT") { try await read("weeklyReview", ["expandedProjectId": 5, "offset": 0, "limit": 50]) }
        await expectFailure("INVALID_INPUT") { try await read("weeklyReviewList", ["list": "contextTasks", "offset": 0, "limit": 50]) }
        await expectFailure("INVALID_INPUT") { try await read("weeklyReviewList", ["list": "unknown", "revision": "x", "offset": 0, "limit": 50]) }
        await expectFailure("Unsupported native Review browsing input") { try await read("dailyReview", ["expandedProjectId": "x", "offset": 0, "limit": 50]) }
        await expectFailure("unavailable") { _ = try await core.call("menuCommand", argumentsJSON: json(["review", "{}"])) }
        await expectFailure("Unsupported native menu read") { try await read("runReviewAction", ["offset": 0, "limit": 50]) }
        XCTAssertEqual(statements, 0); XCTAssertEqual(journalWrites, 0)
        XCTAssertEqual(try reviewReadSnapshot(), before)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    private func calendarPreferenceSettings() throws -> [String: Any] {
        let sqlite = try SQLiteBridge(url: database)
        defer { sqlite.close() }
        let rows = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(sqlite.execute("SELECT data FROM settings WHERE id = 1").utf8)) as? [[String: Any]])
        return try object(XCTUnwrap(rows.first?["data"] as? String))
    }

    private func writeCalendarPreferenceSettings(_ settings: [String: Any]) throws {
        let sqlite = try SQLiteBridge(url: database)
        defer { sqlite.close() }
        _ = try sqlite.execute("UPDATE settings SET data = ? WHERE id = 1", parametersJSON: json([json(settings)]))
    }

    private func calendarPreferenceTasks() throws -> String {
        let sqlite = try SQLiteBridge(url: database)
        defer { sqlite.close() }
        return try json(JSONSerialization.jsonObject(with: Data(sqlite.execute("SELECT * FROM tasks ORDER BY id").utf8)))
    }

    private func seedCalendarPreferenceTask() async throws {
        let core = host()
        _ = try await core.start()
        _ = try await core.call("captureSubmit", argumentsJSON: capture(core, title: "Preserved preference task @office #keep"))
        await core.close()
        var settings = try calendarPreferenceSettings()
        settings.removeValue(forKey: "calendar")
        settings["timeFormat"] = "12h"
        try writeCalendarPreferenceSettings(settings)
    }

    private func calendarPreferences(_ core: CoreHost) async throws -> [String: Any] {
        let result = try object(await core.call("menuRead", argumentsJSON: json(["calendarPreferences", "{}"])))
        XCTAssertEqual(result["version"] as? Int, 1)
        return try XCTUnwrap(result["values"] as? [String: Any])
    }

    private func calendarPreferencePayload(_ field: String, before: Any, value: Any, id: String = UUID().uuidString) throws -> String {
        // Deliberate whitespace inside the serialized request pins exact transport replay.
        try json([" \n" + json(["requestId": id, "field": field, "before": before, "value": value]) + "\n "])
    }

    func testCalendarPreferencesDefaultsAndThreeFieldRoundTripPreserveTasksAndSettings() async throws {
        try await seedCalendarPreferenceTask()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let tasks = try calendarPreferenceTasks()
        var expected = try calendarPreferenceSettings()
        var statements = 0, journalWrites = 0
        var diagnostics: [String] = []
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journalWrites += 1 }
        faults.commandDiagnostic = { if $0.hasPrefix("calendarPreference:") { diagnostics.append($0) } }
        let defaults = try await calendarPreferences(core)
        XCTAssertEqual(try json(defaults), try json(["viewMode": "month", "showCompleted": false, "weekVisibleDays": 5]))
        XCTAssertNil(expected["calendar"])
        XCTAssertEqual(statements, 0); XCTAssertEqual(journalWrites, 0)
        XCTAssertTrue(diagnostics.isEmpty)
        let noOp = try object(await core.call("calendarPreference", argumentsJSON: calendarPreferencePayload("viewMode", before: "month", value: "month")))
        XCTAssertEqual(noOp["changed"] as? Bool, false)
        XCTAssertEqual(statements, 0)
        XCTAssertEqual(try json(calendarPreferenceSettings()), try json(expected))
        XCTAssertEqual(diagnostics, ["calendarPreference:replayed"])
        for (field, value) in [("viewMode", "week" as Any), ("showCompleted", true as Any), ("weekVisibleDays", 7 as Any)] {
            let before = try await calendarPreferences(core)
            let result = try object(await core.call("calendarPreference", argumentsJSON: calendarPreferencePayload(field, before: XCTUnwrap(before[field]), value: value)))
            XCTAssertEqual(result["changed"] as? Bool, true)
            var calendar = expected["calendar"] as? [String: Any] ?? [:]
            calendar[field] = value; expected["calendar"] = calendar
            XCTAssertEqual(try json(calendarPreferenceSettings()), try json(expected))
            var desired = before; desired[field] = value
            let actual = try await calendarPreferences(core)
            XCTAssertEqual(try json(actual), try json(desired))
            XCTAssertEqual(try calendarPreferenceTasks(), tasks)
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        }
        XCTAssertEqual(diagnostics, ["calendarPreference:replayed"] + Array(repeating: "calendarPreference:applied", count: 3))
        await core.close()
        let reopened = host()
        _ = try await reopened.start()
        let restored = try await calendarPreferences(reopened)
        XCTAssertEqual(try json(restored), try json(["viewMode": "week", "showCompleted": true, "weekVisibleDays": 7]))
        XCTAssertEqual(try calendarPreferenceTasks(), tasks)
        XCTAssertEqual(try json(calendarPreferenceSettings()), try json(expected))
    }

    func testCalendarPreferenceTransportAndForgedJournalsRejectBeforeSQLite() async throws {
        try await seedCalendarPreferenceTask()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        _ = try await calendarPreferences(core)
        let before = try reviewReadSnapshot()
        let valid: [String: Any] = ["requestId": UUID().uuidString, "field": "viewMode", "before": "month", "value": "week"]
        var malformed: [[String: Any]] = []
        for extra in ["settings", "action", "calendar", "state", "unknown"] {
            var input = valid; input[extra] = NSNull(); malformed.append(input)
        }
        for field in valid.keys { var input = valid; input.removeValue(forKey: field); malformed.append(input) }
        for patch in [["requestId": "not-a-uuid"], ["requestId": 1], ["field": "theme"], ["before": true], ["value": 1],
                      ["field": "showCompleted", "before": false, "value": 1],
                      ["field": "weekVisibleDays", "before": 5, "value": true],
                      ["field": "weekVisibleDays", "before": 5, "value": 2.5]] as [[String: Any]] {
            var input = valid; input.merge(patch) { _, new in new }; malformed.append(input)
        }
        var statements = 0, journalWrites = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journalWrites += 1 }
        for input in malformed {
            await expectFailure("INVALID_INPUT") { _ = try await core.call("calendarPreference", argumentsJSON: json([json(input)])) }
        }
        for raw in ["[]", "null", "broken JSON"] {
            await expectFailure { _ = try await core.call("calendarPreference", argumentsJSON: json([raw])) }
            await expectFailure { _ = try await core.call("menuRead", argumentsJSON: json(["calendarPreferences", raw])) }
        }
        await expectFailure { _ = try await core.call("calendarPreference", argumentsJSON: json([valid])) }
        for field in ["field", "revision", "calendar", "offset", "requestId"] {
            await expectFailure("Unsupported native Calendar browsing input") {
                _ = try await core.call("menuRead", argumentsJSON: json(["calendarPreferences", json([field: NSNull()])]))
            }
        }
        await expectFailure("unavailable") { _ = try await core.call("runCalendarAction", argumentsJSON: json(["{}"])) }
        await expectFailure("unavailable") { _ = try await core.call("updateSettings", argumentsJSON: json(["{}"])) }
        XCTAssertEqual(statements, 0); XCTAssertEqual(journalWrites, 0)
        XCTAssertEqual(try reviewReadSnapshot(), before)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        // Correct types but invalid options belong to core, after journaling.
        for (field, beforeValue, value) in [("viewMode", "month" as Any, "bad" as Any), ("weekVisibleDays", 5 as Any, 8 as Any)] {
            do {
                _ = try await core.call("calendarPreference", argumentsJSON: calendarPreferencePayload(field, before: beforeValue, value: value))
                XCTFail("Expected semantic refusal")
            } catch { XCTAssertTrue(error is CoreHostRejection); XCTAssertTrue(error.localizedDescription.hasPrefix("INVALID_INPUT:")) }
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        }
        XCTAssertGreaterThan(journalWrites, 0); XCTAssertEqual(statements, 0)
        XCTAssertEqual(try reviewReadSnapshot(), before)
        await core.close()
        for input in malformed {
            let envelope = try json(["version": 2, "method": "calendarPreference", "argumentsJSON": json([json(input)])])
            try Data(envelope.utf8).write(to: journal)
            let replayFaults = HostIOFaults()
            var replaySQL = 0
            replayFaults.beforeSQL = { _ in replaySQL += 1 }
            let replay = host(replayFaults)
            await expectFailure("INVALID_INPUT") { _ = try await replay.start() }
            XCTAssertEqual(replaySQL, 0)
            XCTAssertEqual(try Data(contentsOf: journal), Data(envelope.utf8))
            XCTAssertEqual(try reviewReadSnapshot(), before)
            await replay.close()
            try FileManager.default.removeItem(at: journal)
        }
    }

    func testCalendarPreferenceFailedCommitRetriesExactRequestAfterAcknowledgment() async throws {
        try await seedCalendarPreferenceTask()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let tasks = try calendarPreferenceTasks()
        let before = try calendarPreferenceSettings()
        let payload = try calendarPreferencePayload("showCompleted", before: false, value: true)
        var diagnostics: [String] = []
        faults.commandDiagnostic = { if $0.hasPrefix("calendarPreference:") { diagnostics.append($0) } }
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected preference COMMIT failure") } }
        await expectFailure("SAVE_FAILED") { _ = try await core.call("calendarPreference", argumentsJSON: payload) }
        let envelope = try object(String(contentsOf: journal))
        XCTAssertEqual(envelope["version"] as? Int, 2)
        XCTAssertEqual(envelope["method"] as? String, "calendarPreference")
        XCTAssertEqual(Data(try XCTUnwrap(envelope["argumentsJSON"] as? String).utf8), Data(payload.utf8))
        XCTAssertNil(envelope["terminal"])
        XCTAssertTrue(diagnostics.isEmpty)
        XCTAssertEqual(try json(calendarPreferenceSettings()), try json(before))
        await expectFailure("exact retry") { _ = try await calendarPreferences(core) }
        await expectFailure("SAVE_FAILED") { _ = try await core.retryPending() }
        faults.beforeSQL = nil
        let retried = try await core.retryPending()
        let result = try object(XCTUnwrap(retried))
        XCTAssertEqual(result["changed"] as? Bool, true)
        XCTAssertEqual(diagnostics, ["calendarPreference:applied"])
        let saved = try calendarPreferenceSettings()
        XCTAssertEqual((saved["calendar"] as? [String: Any])?["showCompleted"] as? Bool, true)
        var withoutCalendar = saved; withoutCalendar.removeValue(forKey: "calendar")
        XCTAssertEqual(try json(withoutCalendar), try json(before))
        XCTAssertEqual(try calendarPreferenceTasks(), tasks)
        var statements = 0
        faults.beforeSQL = { _ in statements += 1 }
        let absent = try await core.retryPending()
        XCTAssertNil(absent); XCTAssertEqual(statements, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testCalendarPreferenceRestartPreservesNewerSiblingsAndAvoidsDuplicateWrites() async throws {
        for afterCommit in [false, true] {
            try await seedCalendarPreferenceTask()
            let faults = HostIOFaults()
            let core = host(faults)
            _ = try await core.start()
            let tasks = try calendarPreferenceTasks()
            let payload = try calendarPreferencePayload("viewMode", before: "month", value: "week")
            if afterCommit {
                var writes = 0
                faults.journalWrite = { writes += 1; if writes == 2 { throw HostFailure("Injected preference lost acknowledgment") } }
            } else { faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected preference COMMIT failure") } } }
            await expectFailure { _ = try await core.call("calendarPreference", argumentsJSON: payload) }
            let frozen = try object(String(contentsOf: journal))
            XCTAssertNil(frozen["terminal"])
            XCTAssertEqual(Data(try XCTUnwrap(frozen["argumentsJSON"] as? String).utf8), Data(payload.utf8))
            await core.close()
            var expected = try calendarPreferenceSettings()
            var calendar = expected["calendar"] as? [String: Any] ?? [:]
            calendar["showCompleted"] = true; calendar["weekVisibleDays"] = 2
            expected["calendar"] = calendar; expected["timeFormat"] = "24h"
            try writeCalendarPreferenceSettings(expected)
            calendar["viewMode"] = "week"; expected["calendar"] = calendar
            let replayFaults = HostIOFaults()
            var writes = 0, diagnostics: [String] = []
            replayFaults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+settings\b"#, options: .regularExpression) != nil { writes += 1 }
            }
            replayFaults.commandDiagnostic = { if $0.hasPrefix("calendarPreference:") { diagnostics.append($0) } }
            replayFaults.journalRemove = { throw HostFailure("Injected preference cleanup") }
            let replay = host(replayFaults)
            await expectFailure("cleanup") { _ = try await replay.start() }
            XCTAssertEqual(writes, afterCommit ? 0 : 1)
            XCTAssertEqual(diagnostics, [afterCommit ? "calendarPreference:replayed" : "calendarPreference:applied"])
            XCTAssertEqual(try json(calendarPreferenceSettings()), try json(expected))
            XCTAssertEqual(try calendarPreferenceTasks(), tasks)
            replayFaults.journalRemove = nil
            _ = try await replay.start()
            let restored = try await calendarPreferences(replay)
            XCTAssertEqual(try json(restored), try json(["viewMode": "week", "showCompleted": true, "weekVisibleDays": 2]))
            XCTAssertEqual(try json(calendarPreferenceSettings()), try json(expected))
            XCTAssertEqual(try calendarPreferenceTasks(), tasks)
            XCTAssertEqual(diagnostics.count, 1)
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            await replay.close()
        }
    }

    func testCalendarPreferenceStaleInitialCleanupAndAmbiguousReplayRetainsJournal() async throws {
        try await seedCalendarPreferenceTask()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let before = try reviewReadSnapshot()
        let stale = try calendarPreferencePayload("viewMode", before: "day", value: "week")
        var statements = 0
        faults.beforeSQL = { _ in statements += 1 }
        do { _ = try await core.call("calendarPreference", argumentsJSON: stale); XCTFail("Expected stale baseline") }
        catch { XCTAssertTrue(error is CoreHostRejection); XCTAssertTrue(error.localizedDescription.hasPrefix("STALE_REVISION:")) }
        XCTAssertEqual(statements, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        faults.journalRemove = { throw HostFailure("Injected preference rejection cleanup") }
        await expectFailure("cleanup") { _ = try await core.call("calendarPreference", argumentsJSON: stale) }
        XCTAssertNotNil((try object(String(contentsOf: journal))["terminal"] as? [String: Any])?["rejected"])
        faults.journalRemove = nil
        do { _ = try await core.retryPending(); XCTFail("Expected retained rejection") }
        catch { XCTAssertTrue(error is CoreHostRejection); XCTAssertTrue(error.localizedDescription.hasPrefix("STALE_REVISION:")) }
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        XCTAssertEqual(try reviewReadSnapshot(), before)
        await core.close()
        for afterCommit in [false, true] {
            try await seedCalendarPreferenceTask()
            let pendingFaults = HostIOFaults()
            let pending = host(pendingFaults)
            _ = try await pending.start()
            let payload = try calendarPreferencePayload("viewMode", before: "month", value: "week")
            if afterCommit {
                var writes = 0
                pendingFaults.journalWrite = { writes += 1; if writes == 2 { throw HostFailure("Injected preference lost acknowledgment") } }
            } else { pendingFaults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected preference COMMIT failure") } } }
            await expectFailure { _ = try await pending.call("calendarPreference", argumentsJSON: payload) }
            let envelope = try object(String(contentsOf: journal))
            await pending.close()
            var settings = try calendarPreferenceSettings()
            var calendar = settings["calendar"] as? [String: Any] ?? [:]
            calendar["viewMode"] = "day"; settings["calendar"] = calendar
            try writeCalendarPreferenceSettings(settings)
            let newer = try reviewReadSnapshot()
            let replayFaults = HostIOFaults()
            var writes = 0
            replayFaults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:settings|tasks)\b"#, options: .regularExpression) != nil { writes += 1 }
            }
            let replay = host(replayFaults)
            for _ in 0..<2 {
                await expectFailure("STALE_REVISION") { _ = try await replay.start() }
                XCTAssertEqual(writes, 0)
                XCTAssertEqual(try reviewReadSnapshot(), newer)
                let retained = try object(String(contentsOf: journal))
                XCTAssertEqual(try json(retained), try json(envelope))
                XCTAssertEqual(Data(try XCTUnwrap(retained["argumentsJSON"] as? String).utf8), Data(payload.utf8))
                XCTAssertNil(retained["terminal"])
            }
            await replay.close()
            try FileManager.default.removeItem(at: journal)
        }
    }

    private func seedBoardReadFixture(count: Int = 103) async throws -> URL {
        let source = try await seedReviewReadFixture(count: count)
        let sqlite = try SQLiteBridge(url: database)
        defer { sqlite.close() }
        for index in 0..<count {
            let suffix = String(format: "%03d", index)
            let due: Any = index == 0 ? NSNull() : index == 1 ? "2026-09-26" : "2026-09-27"
            _ = try sqlite.execute("UPDATE tasks SET contexts = ?, tags = '[]', boardOrder = ?, dueDate = ?, description = ? WHERE id = ?",
                                   parametersJSON: json([json(["@board-" + suffix]), index, due, "Keep Board note", "review-task-" + suffix]))
        }
        _ = try sqlite.execute("UPDATE tasks SET status = 'waiting' WHERE id = 'review-project-task'")
        return source
    }

    func testBoardColumnsAndCompletePickerWindowsSurviveRestartWithoutWrites() async throws {
        let source = try await seedBoardReadFixture()
        let faults = HostIOFaults()
        let core = host(faults, bundleURL: source)
        _ = try await core.start()
        _ = try await core.call("language", argumentsJSON: json(["en", "en-US"]))
        let before = try reviewReadSnapshot()
        var statements = 0, journalWrites = 0, diagnostics = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journalWrites += 1 }
        faults.commandDiagnostic = { if $0 == "boardRead" { diagnostics += 1 } }
        func read(_ name: String, _ input: [String: Any]) async throws -> [String: Any] {
            try object(await core.call("menuRead", argumentsJSON: json([name, json(input)])))
        }
        let view = try await read("board", ["limit": 2])
        XCTAssertEqual(view["version"] as? Int, 1)
        let columns = try XCTUnwrap(view["columns"] as? [[String: Any]])
        XCTAssertEqual(columns.compactMap { $0["status"] as? String }, ["inbox", "next", "waiting", "someday", "done"])
        XCTAssertTrue(columns.allSatisfy { (($0["cards"] as? [Any])?.count ?? 3) <= 2 })
        XCTAssertTrue(columns.allSatisfy { !($0["label"] as? String ?? "").isEmpty && $0["tone"] is String })
        let next = try XCTUnwrap(columns.first { $0["status"] as? String == "next" })
        XCTAssertEqual(next["count"] as? Int, 103)
        let firstCards = try XCTUnwrap(next["cards"] as? [[String: Any]])
        XCTAssertEqual(firstCards.compactMap { $0["boardOrder"] as? Int }, [0, 1])
        XCTAssertNotNil((firstCards.first?["row"] as? [String: Any])?["meta"])
        XCTAssertEqual((firstCards.first?["card"] as? [String: Any])?["contexts"] as? [String], ["@board-000"])
        XCTAssertEqual((view["cardActions"] as? [String: Any])?["editorTab"] as? String, "view")
        let sheet = try XCTUnwrap(view["sheet"] as? [String: Any])
        let filters = try XCTUnwrap(view["filters"] as? [String: Any])
        let revision = try XCTUnwrap(view["revision"] as? String)
        let expectedIDs = (0..<103).map { String(format: "review-task-%03d", $0) }
        for (list, total) in [("cards", 103), ("tokens", 103), ("projects", 104)] {
            var all: [[String: Any]] = []
            for offset in stride(from: 0, to: total, by: 50) {
                var input: [String: Any] = ["filters": filters, "list": list, "offset": offset, "limit": 50, "revision": revision]
                if list == "cards" { input["status"] = "next" }
                let page = try await read("boardList", input)
                XCTAssertEqual(page["revision"] as? String, revision)
                XCTAssertEqual(page["total"] as? Int, total)
                let items = try XCTUnwrap(page["items"] as? [[String: Any]])
                XCTAssertEqual(items.count, min(50, total - offset))
                all += items
            }
            if list == "cards" {
                XCTAssertEqual(all.compactMap { ($0["row"] as? [String: Any])?["id"] as? String }, expectedIDs)
                XCTAssertEqual(try json(Array(all.prefix(2))), try json(firstCards))
            } else {
                let first = try XCTUnwrap(sheet[list] as? [String: Any])
                XCTAssertEqual(first["total"] as? Int, total)
                XCTAssertEqual(try json(Array(all.prefix(100))), try json(XCTUnwrap(first["items"])))
                let values = all.compactMap { $0[list == "tokens" ? "value" : "id"] as? String }
                XCTAssertEqual(Set(values).count, total)
                if list == "tokens" { XCTAssertEqual(values, (0..<103).map { String(format: "@board-%03d", $0) }) }
                else { XCTAssertTrue(Set((0..<103).map { String(format: "review-project-%03d", $0) }).isSubset(of: Set(values))) }
            }
        }
        let selectedTokens = (0..<100).map { String(format: "@board-%03d", $0) }
        let excludedTokens = (100..<103).map { String(format: "@board-%03d", $0) }
        let filtered = try await read("board", ["filters": ["tokens": selectedTokens, "excludedTokens": excludedTokens], "limit": 1])
        let chips = try XCTUnwrap((filtered["sheet"] as? [String: Any])?["chips"] as? [String: Any])
        XCTAssertEqual(chips["total"] as? Int, 103)
        XCTAssertEqual((chips["items"] as? [Any])?.count, 100)
        let tail = try await read("boardList", ["filters": try XCTUnwrap(filtered["filters"]), "list": "chips", "offset": 100, "limit": 50, "revision": try XCTUnwrap(filtered["revision"])])
        XCTAssertEqual((tail["items"] as? [[String: Any]])?.compactMap { $0["id"] as? String }, excludedTokens.map { "excluded-token:" + $0 })
        XCTAssertEqual(diagnostics, 1, "Only the first successful Board view logs per host")
        XCTAssertEqual(statements, 0); XCTAssertEqual(journalWrites, 0)
        XCTAssertEqual(try reviewReadSnapshot(), before)
        await core.close()
        let reopened = host(bundleURL: source)
        _ = try await reopened.start()
        _ = try await reopened.call("language", argumentsJSON: json(["en", "en-US"]))
        var restored = try object(await reopened.call("menuRead", argumentsJSON: json(["board", json(["limit": 2])])))
        var expected = view
        // Revisions include a host process ID; only the Board content survives restart.
        restored.removeValue(forKey: "revision"); expected.removeValue(forKey: "revision")
        XCTAssertEqual(try json(restored), try json(expected))
        XCTAssertEqual(try reviewReadSnapshot(), before)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testBoardPureFiltersAreaAndStaleRevisionAfterSupportedCompletion() async throws {
        let source = try await seedBoardReadFixture(count: 3)
        let faults = HostIOFaults()
        let core = host(faults, bundleURL: source)
        _ = try await core.start()
        var before = try reviewReadSnapshot()
        var statements = 0, journalWrites = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journalWrites += 1 }
        func read(_ input: [String: Any]) async throws -> [String: Any] {
            try object(await core.call("menuRead", argumentsJSON: json(["board", json(input)])))
        }
        func nextIDs(_ view: [String: Any]) -> [String] {
            ((view["columns"] as? [[String: Any]])?.first { $0["status"] as? String == "next" }?["cards"] as? [[String: Any]])?
                .compactMap { ($0["row"] as? [String: Any])?["id"] as? String } ?? []
        }
        let initial = try await read(["limit": 50])
        var toggled = initial
        for expected in [["review-task-001"], ["review-task-000", "review-task-002"], ["review-task-000", "review-task-001", "review-task-002"]] {
            toggled = try await read(["filters": try XCTUnwrap(toggled["filters"]), "filterEdit": ["type": "toggleToken", "value": "@board-001"], "limit": 50])
            XCTAssertEqual(nextIDs(toggled), expected)
        }
        let searched = try await read(["filterEdit": ["type": "setSearch", "value": "Review task 002"], "limit": 50])
        XCTAssertEqual(nextIDs(searched), ["review-task-002"])
        XCTAssertEqual((searched["bar"] as? [String: Any])?["searchActive"] as? Bool, true)
        for (preset, expected) in [("overdue", "review-task-001"), ("today", "review-task-002"), ("no_date", "review-task-000")] {
            let due = try await read(["filterEdit": ["type": "toggleDuePreset", "preset": preset], "limit": 50])
            XCTAssertEqual(nextIDs(due), [expected])
            let cleared = try await read(["filters": try XCTUnwrap(due["filters"]), "filterEdit": ["type": "clearDuePreset"], "limit": 50])
            XCTAssertEqual(nextIDs(cleared).count, 3)
        }
        let projected = try await read(["filterEdit": ["type": "toggleProject", "value": "review-project-000"], "limit": 50])
        XCTAssertEqual((projected["columns"] as? [[String: Any]])?.flatMap { $0["cards"] as? [[String: Any]] ?? [] }.compactMap { ($0["row"] as? [String: Any])?["id"] as? String }, ["review-project-task"])
        let allTokens = try await read(["filters": ["tokens": ["@board-000", "@board-001"]], "filterEdit": ["type": "setMatchMode", "kind": "context", "value": "all"], "limit": 50])
        XCTAssertTrue(nextIDs(allTokens).isEmpty)
        let cleared = try await read(["filters": try XCTUnwrap(searched["filters"]), "filterEdit": ["type": "clear"], "limit": 50])
        XCTAssertEqual(try json(cleared), try json(initial))
        XCTAssertEqual(statements, 0); XCTAssertEqual(journalWrites, 0)
        XCTAssertEqual(try reviewReadSnapshot(), before)

        _ = try await core.call("complete", argumentsJSON: json(["review-task-000"]))
        before = try reviewReadSnapshot(); statements = 0; journalWrites = 0
        await expectFailure("STALE_REVISION") {
            _ = try await core.call("menuRead", argumentsJSON: json(["boardList", json(["filters": try XCTUnwrap(initial["filters"]), "list": "cards", "status": "next", "offset": 0, "limit": 50, "revision": try XCTUnwrap(initial["revision"])])]))
        }
        let fresh = try await read(["limit": 50])
        XCTAssertEqual(nextIDs(fresh), ["review-task-001", "review-task-002"])
        XCTAssertEqual(statements, 0); XCTAssertEqual(journalWrites, 0)
        XCTAssertEqual(try reviewReadSnapshot(), before)

        let area = try object(await core.call("areaFilter"))
        let option = try XCTUnwrap((area["options"] as? [[String: Any]])?.first { $0["id"] as? String == "review-area-b" })
        _ = try await core.call("setAreaFilter", argumentsJSON: json([json(XCTUnwrap(option["next"]))]))
        before = try reviewReadSnapshot(); statements = 0; journalWrites = 0
        let scoped = try await read(["limit": 50])
        XCTAssertEqual(nextIDs(scoped), ["review-task-001"])
        XCTAssertEqual(((scoped["sheet"] as? [String: Any])?["tokens"] as? [String: Any])?["total"] as? Int, 1)
        XCTAssertEqual(statements, 0); XCTAssertEqual(journalWrites, 0)
        XCTAssertEqual(try reviewReadSnapshot(), before)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testBoardTransportAndRawMutationRoutesRefuseBeforeSQLite() async throws {
        let source = try await seedBoardReadFixture(count: 1)
        let faults = HostIOFaults()
        let core = host(faults, bundleURL: source)
        _ = try await core.start()
        let before = try reviewReadSnapshot()
        var statements = 0, journalWrites = 0, diagnostics = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journalWrites += 1 }
        faults.commandDiagnostic = { if $0 == "boardRead" { diagnostics += 1 } }
        let list: [String: Any] = ["list": "cards", "status": "next", "offset": 0, "limit": 50, "revision": "stale"]
        for (name, valid) in [("board", ["limit": 50] as [String: Any]), ("boardList", list)] {
            for field in ["action", "requestId", "tasks", "settings", "unknown"] {
                var input = valid; input[field] = NSNull()
                await expectFailure("Board") { _ = try await core.call("menuRead", argumentsJSON: json([name, json(input)])) }
            }
            for value in [true, NSNull(), "50", 0, -1, 1.5, 101] as [Any] {
                var input = valid; input["limit"] = value
                await expectFailure("Board") { _ = try await core.call("menuRead", argumentsJSON: json([name, json(input)])) }
            }
            var missing = valid; missing.removeValue(forKey: "limit")
            await expectFailure("Board") { _ = try await core.call("menuRead", argumentsJSON: json([name, json(missing)])) }
            for filters in [NSNull(), [], ["unknown": true], ["searchQuery": true], ["searchQuery": String(repeating: "x", count: 2001)], ["tokens": [1]], ["tokens": Array(repeating: "@a", count: 101)], ["projects": [String(repeating: "x", count: 501)]]] as [Any] {
                var input = valid; input["filters"] = filters
                await expectFailure("Board") { _ = try await core.call("menuRead", argumentsJSON: json([name, json(input)])) }
            }
            for raw in ["[]", "null", "1", "true", "{", "{" + String(repeating: " ", count: 1_048_576) + "\"limit\":50}"] {
                await expectFailure { _ = try await core.call("menuRead", argumentsJSON: json([name, raw])) }
            }
        }
        for field in ["list", "offset", "revision", "status"] {
            var input = list; input.removeValue(forKey: field)
            await expectFailure("Board") { _ = try await core.call("menuRead", argumentsJSON: json(["boardList", json(input)])) }
        }
        for value in [true, -1, 0.5, "0", 9_007_199_254_740_992] as [Any] {
            var input = list; input["offset"] = value
            await expectFailure("Board") { _ = try await core.call("menuRead", argumentsJSON: json(["boardList", json(input)])) }
        }
        for edit in [NSNull(), [], ["type": 1], ["type": "clear", "action": "trash"], ["type": "setSearch", "value": true]] as [Any] {
            await expectFailure("Board") { _ = try await core.call("menuRead", argumentsJSON: json(["board", json(["limit": 50, "filterEdit": edit])])) }
        }
        for input in [["limit": 50, "filters": ["duePreset": "invalid"]], ["limit": 50, "filterEdit": ["type": "setMatchMode", "kind": "context", "value": "invalid"]]] as [[String: Any]] {
            await expectFailure("INVALID_INPUT") { _ = try await core.call("menuRead", argumentsJSON: json(["board", json(input)])) }
        }
        for method in ["runBoardAction", "updateTask", "moveCard", "duplicateTask", "trashTask", "menuCommand"] {
            await expectFailure("unavailable") { _ = try await core.call(method, argumentsJSON: json(["{}"])) }
        }
        for name in ["runBoardAction", "boardAction", "boardMove", "boardDelete"] {
            await expectFailure("Unsupported native menu") { _ = try await core.call("menuRead", argumentsJSON: json([name, "{}"])) }
        }
        XCTAssertEqual(diagnostics, 0, "Refused reads never log a successful Board read")
        XCTAssertEqual(statements, 0); XCTAssertEqual(journalWrites, 0)
        XCTAssertEqual(try reviewReadSnapshot(), before)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    private func seedBoardActionFixture() async throws -> String {
        let id = try await seedDestinationTask()
        let sqlite = try SQLiteBridge(url: database)
        let at = "2026-01-01T12:00:00.000Z"
        _ = try sqlite.execute("UPDATE tasks SET boardOrder = ?, checklist = ?, attachments = ? WHERE id = ?", parametersJSON: json([
            1024, json([["id": "old-step", "title": "Retained step", "isCompleted": true]]),
            json([["id": "old-link", "kind": "link", "title": "Retained link", "uri": "https://example.invalid/retained", "createdAt": at, "updatedAt": at],
                  ["id": "old-file", "kind": "file", "title": "Retained file", "uri": "file:///retained", "createdAt": at, "updatedAt": at]]), id]))
        sqlite.close()
        // Establish core's existing row serialization before targeted-write assertions.
        let canonicalizer = host()
        _ = try await canonicalizer.start()
        _ = try await canonicalizer.call("captureSubmit", argumentsJSON: capture(canonicalizer, title: "Unrelated Board row", id: UUID().uuidString.lowercased()))
        await canonicalizer.close()
        return id
    }

    private func boardActionPayload(_ kind: String, taskID: String, requestID: String = UUID().uuidString.lowercased()) throws -> String {
        try json([json(["requestId": requestID, "action": ["type": kind, "taskId": taskID]])])
    }

    func testPreparedBoardDuplicateAndTrashPreserveOtherRowsAndAcknowledgeExactCopy() async throws {
        let id = try await seedBoardActionFixture()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let original = try storedTask(id), protected = try storedTask(id + "-protected")
        let settings = try calendarPreferenceSettings()
        let copyID = UUID().uuidString.lowercased()
        var taskWrites = 0, diagnostics = 0
        faults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+tasks\b"#, options: .regularExpression) != nil {
                taskWrites += 1
                XCTAssertTrue(FileManager.default.fileExists(atPath: self.journal.path), "Intent must be durable before task SQL")
            }
        }
        faults.commandDiagnostic = { if $0 == "boardAction" { diagnostics += 1 } }
        let response = try object(await core.call("boardAction", argumentsJSON: boardActionPayload("duplicateTask", taskID: id, requestID: copyID)))
        XCTAssertEqual(try json(response), try json(["changed": true, "open": ["taskId": copyID, "projectId": "destination-project-a", "tab": "task"]]))
        XCTAssertEqual(taskWrites, 1); XCTAssertEqual(diagnostics, 1)
        let copy = try storedTask(copyID)
        XCTAssertEqual(copy["title"] as? String, original["title"] as? String)
        XCTAssertEqual(copy["projectId"] as? String, original["projectId"] as? String)
        XCTAssertEqual(copy["sectionId"] as? String, original["sectionId"] as? String)
        XCTAssertEqual(copy["rev"] as? Int, 1)
        let checklist = try JSONSerialization.jsonObject(with: Data(XCTUnwrap(copy["checklist"] as? String).utf8)) as? [[String: Any]]
        let attachments = try JSONSerialization.jsonObject(with: Data(XCTUnwrap(copy["attachments"] as? String).utf8)) as? [[String: Any]]
        XCTAssertEqual(checklist?.count, 1); XCTAssertEqual(checklist?.first?["isCompleted"] as? Bool, false)
        XCTAssertNotEqual(checklist?.first?["id"] as? String, "old-step")
        XCTAssertEqual(attachments?.count, 1); XCTAssertEqual(attachments?.first?["kind"] as? String, "link")
        XCTAssertNotEqual(attachments?.first?["id"] as? String, "old-link")
        XCTAssertEqual(try json(storedTask(id)), try json(original))
        XCTAssertEqual(try json(storedTask(id + "-protected")), try json(protected))
        XCTAssertEqual(try json(calendarPreferenceSettings()), try json(settings))
        await expectFailure("INVALID_INPUT") { _ = try await core.call("boardAction", argumentsJSON: boardActionPayload("duplicateTask", taskID: id, requestID: copyID)) }
        let trash = try object(await core.call("boardAction", argumentsJSON: boardActionPayload("trashTask", taskID: copyID)))
        XCTAssertEqual(try json(trash), try json(["changed": true, "open": NSNull()]))
        XCTAssertEqual(taskWrites, 2); XCTAssertEqual(diagnostics, 1, "Only first durable Board success logs")
        XCTAssertEqual(try datePreservedFields(storedTask(copyID), excluding: ["deletedAt", "updatedAt", "rev", "revBy"]),
                       try datePreservedFields(copy, excluding: ["deletedAt", "updatedAt", "rev", "revBy"]))
        XCTAssertEqual(try storedTask(copyID)["rev"] as? Int, 2)
        let noop = try object(await core.call("boardAction", argumentsJSON: boardActionPayload("trashTask", taskID: copyID)))
        XCTAssertEqual(try json(noop), try json(["changed": false, "open": NSNull()]))
        XCTAssertEqual(taskWrites, 2)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testPreparedBoardDuplicateRestartReturnsExactRecoveryOnlyAfterCleanup() async throws {
        for afterCommit in [false, true] {
            let id = try await seedBoardActionFixture()
            let faults = HostIOFaults()
            let core = host(faults)
            _ = try await core.start()
            let copyID = UUID().uuidString.lowercased()
            let request = try boardActionPayload("duplicateTask", taskID: id, requestID: copyID)
            if afterCommit {
                var writes = 0
                faults.journalWrite = { writes += 1; if writes == 2 { throw HostFailure("Injected Board lost acknowledgment") } }
            } else { faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected Board COMMIT failure") } } }
            await expectFailure { _ = try await core.call("boardAction", argumentsJSON: request) }
            let journalBefore = try object(String(contentsOf: journal))
            XCTAssertEqual(journalBefore["method"] as? String, "boardCommit"); XCTAssertNil(journalBefore["terminal"])
            let arguments = try XCTUnwrap(journalBefore["argumentsJSON"] as? String)
            let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(arguments.utf8)) as? [String])
            let envelope = try object(XCTUnwrap(args.first))
            let prepared = try XCTUnwrap(envelope["prepared"] as? [String: Any])
            let expected = try XCTUnwrap(prepared["result"] as? [String: Any])
            await core.close()
            // A lost reply acknowledges the unchanged copy before mutable source checks.
            if afterCommit {
                let sqlite = try SQLiteBridge(url: database)
                _ = try sqlite.execute("UPDATE tasks SET title = ?, deletedAt = ?, rev = rev + 1 WHERE id = ?",
                                       parametersJSON: json(["Newer synthetic source", "2036-11-01T12:00:00.000Z", id]))
                sqlite.close()
            }
            let sourceBefore = try storedTask(id)
            let recoveryFaults = HostIOFaults()
            var writes = 0, diagnostics = 0, writesAtCleanup = -1
            recoveryFaults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+tasks\b"#, options: .regularExpression) != nil { writes += 1 }
            }
            recoveryFaults.commandDiagnostic = { if $0 == "boardAction" { diagnostics += 1 } }
            recoveryFaults.journalRemove = { throw HostFailure("Injected Board cleanup failure") }
            let replay = host(recoveryFaults)
            await expectFailure("cleanup") { _ = try await replay.start() }
            XCTAssertEqual(writes, afterCommit ? 0 : 1); XCTAssertEqual(diagnostics, 0)
            let landed = try storedTask(copyID)
            let terminalJournal = try object(String(contentsOf: journal))
            XCTAssertNotNil(terminalJournal["terminal"])
            XCTAssertEqual(terminalJournal["argumentsJSON"] as? String, arguments)
            recoveryFaults.journalRemove = { writesAtCleanup = writes }
            let startup = try object(await replay.start())
            let recovery = try XCTUnwrap(startup["recovery"] as? [String: Any])
            XCTAssertEqual(recovery["method"] as? String, "boardCommit")
            XCTAssertEqual(try json(XCTUnwrap(recovery["result"])), try json(expected))
            XCTAssertEqual(writesAtCleanup, afterCommit ? 0 : 1, "Terminal cleanup must not reexecute the write")
            XCTAssertEqual(diagnostics, 1)
            XCTAssertEqual(try datePreservedFields(storedTask(copyID), excluding: []), try datePreservedFields(landed, excluding: []))
            XCTAssertEqual(try datePreservedFields(storedTask(id), excluding: []), try datePreservedFields(sourceBefore, excluding: []))
            let nextStart = try object(await replay.start())
            XCTAssertNil(nextStart["recovery"])
            let absent = try await replay.retryPending(); XCTAssertNil(absent)
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            await replay.close()
        }
    }

    func testPreparedBoardFailedCommitRetryReturnsFrozenAcknowledgment() async throws {
        let id = try await seedBoardActionFixture()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let before = try storedTask(id)
        let copyID = UUID().uuidString.lowercased()
        var diagnostics = 0
        faults.commandDiagnostic = { if $0 == "boardAction" { diagnostics += 1 } }
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected Board COMMIT failure") } }
        let request = try boardActionPayload("duplicateTask", taskID: id, requestID: copyID)
        await expectFailure("SAVE_FAILED") { _ = try await core.call("boardAction", argumentsJSON: request) }
        let frozen = try object(String(contentsOf: journal))
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(frozen["argumentsJSON"] as? String).utf8)) as? [String])
        let envelope = try object(XCTUnwrap(args.first))
        let prepared = try XCTUnwrap(envelope["prepared"] as? [String: Any])
        XCTAssertEqual(diagnostics, 0)
        await expectFailure("exact retry") { _ = try await core.call("boardAction", argumentsJSON: boardActionPayload("trashTask", taskID: id)) }
        await expectFailure("SAVE_FAILED") { _ = try await core.retryPending() }
        faults.beforeSQL = nil
        let retry = try await core.retryPending()
        XCTAssertEqual(try json(object(XCTUnwrap(retry))), try json(XCTUnwrap(prepared["result"])))
        XCTAssertEqual(diagnostics, 1)
        XCTAssertEqual(try storedTask(copyID)["rev"] as? Int, 1)
        XCTAssertEqual(try json(storedTask(id)), try json(before))
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        let startup = try object(await core.start())
        XCTAssertNil(startup["recovery"], "Interactive acknowledgement is not routed again on startup")
    }

    func testPreparedBoardUnknownAcknowledgmentRetainsIntentAndCannotRouteWrongCopy() async throws {
        let id = try await seedBoardActionFixture()
        let source = try dateBundle(at: "2026-10-01T12:00:00.000Z", suffix: """
        (() => {
            const commit = MindwtrHost.boardCommit, poll = MindwtrHost.poll;
            const tickets = new Set();
            MindwtrHost.boardCommit = function (json) { const id = commit(json); tickets.add(id); return id; };
            MindwtrHost.poll = function (id) {
                const raw = poll(id);
                if (!raw || !tickets.has(id)) return raw;
                const result = JSON.parse(raw);
                if (result.ok) result.value = {changed: true, open: {taskId: 'wrong-copy', projectId: null, tab: 'task'}};
                return JSON.stringify(result);
            };
        })();
        """)
        let faults = HostIOFaults()
        let core = host(faults, bundleURL: source)
        _ = try await core.start()
        let copyID = UUID().uuidString.lowercased()
        var diagnostics = 0
        faults.commandDiagnostic = { if $0 == "boardAction" { diagnostics += 1 } }
        await expectFailure("acknowledgment") { _ = try await core.call("boardAction", argumentsJSON: boardActionPayload("duplicateTask", taskID: id, requestID: copyID)) }
        XCTAssertEqual(diagnostics, 0)
        let pending = try object(String(contentsOf: journal))
        XCTAssertNil(pending["terminal"])
        let committed = try storedTask(copyID)
        await core.close()
        let reopened = host()
        let startup = try object(await reopened.start())
        let recovery = try XCTUnwrap(startup["recovery"] as? [String: Any])
        let result = try XCTUnwrap(recovery["result"] as? [String: Any])
        XCTAssertEqual((result["open"] as? [String: Any])?["taskId"] as? String, copyID)
        XCTAssertEqual(try datePreservedFields(storedTask(copyID), excluding: []), try datePreservedFields(committed, excluding: []))
    }

    func testPreparedBoardTrashRestoredAfterLostReplyRefusesAndRetainsIntent() async throws {
        let id = try await seedBoardActionFixture()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        var writes = 0
        faults.journalWrite = { writes += 1; if writes == 2 { throw HostFailure("Injected Trash lost acknowledgment") } }
        await expectFailure { _ = try await core.call("boardAction", argumentsJSON: boardActionPayload("trashTask", taskID: id)) }
        let originalJournal = try object(String(contentsOf: journal))
        await core.close()
        let sqlite = try SQLiteBridge(url: database)
        _ = try sqlite.execute("UPDATE tasks SET deletedAt = NULL, rev = rev + 1 WHERE id = ?", parametersJSON: json([id]))
        sqlite.close()
        let restored = try storedTask(id)
        let recoveryFaults = HostIOFaults()
        var taskWrites = 0, diagnostics = 0
        recoveryFaults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+tasks\b"#, options: .regularExpression) != nil { taskWrites += 1 }
        }
        recoveryFaults.commandDiagnostic = { if $0 == "boardAction" { diagnostics += 1 } }
        let replay = host(recoveryFaults)
        await expectFailure("STALE_REVISION") { _ = try await replay.start() }
        XCTAssertEqual(taskWrites, 0); XCTAssertEqual(diagnostics, 0)
        XCTAssertEqual(try json(storedTask(id)), try json(restored))
        let retained = try object(String(contentsOf: journal))
        XCTAssertEqual(retained["argumentsJSON"] as? String, originalJournal["argumentsJSON"] as? String)
        XCTAssertNil(retained["terminal"])
        await expectFailure("not ready") { _ = try await replay.call("window", argumentsJSON: json([0, 50, ""])) }
    }

    func testPreparedBoardInitialStaleRejectionCleansWithoutStartupRecoveryRoute() async throws {
        let id = try await seedBoardActionFixture()
        let source = try dateBundle(at: "2026-10-01T12:00:00.000Z", suffix: """
        (() => {
            const poll = MindwtrHost.poll;
            MindwtrHost.boardCommit = function () { return '2147483647'; };
            MindwtrHost.poll = function (id) {
                return id === '2147483647'
                    ? JSON.stringify({ok: false, error: 'STALE_REVISION: Injected Board prewrite conflict'}) : poll(id);
            };
        })();
        """)
        let faults = HostIOFaults()
        let core = host(faults, bundleURL: source)
        _ = try await core.start()
        let before = try storedTask(id)
        do {
            _ = try await core.call("boardAction", argumentsJSON: boardActionPayload("trashTask", taskID: id))
            XCTFail("Expected initial no-write refusal")
        } catch { XCTAssertTrue(error is CoreHostRejection) }
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        faults.journalRemove = { throw HostFailure("Injected Board rejection cleanup") }
        await expectFailure("cleanup") { _ = try await core.call("boardAction", argumentsJSON: boardActionPayload("trashTask", taskID: id)) }
        let pending = try object(String(contentsOf: journal))
        XCTAssertNotNil((pending["terminal"] as? [String: Any])?["rejected"])
        await core.close()
        let replayFaults = HostIOFaults()
        var writesBeforeCleanup = 0, cleanup = false, diagnostics = 0
        replayFaults.beforeSQL = { sql in
            if !cleanup, sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+tasks\b"#, options: .regularExpression) != nil { writesBeforeCleanup += 1 }
        }
        replayFaults.journalRemove = { cleanup = true }
        replayFaults.commandDiagnostic = { if $0 == "boardAction" { diagnostics += 1 } }
        let replay = host(replayFaults)
        let startup = try object(await replay.start())
        XCTAssertTrue(cleanup); XCTAssertEqual(writesBeforeCleanup, 0); XCTAssertEqual(diagnostics, 0)
        XCTAssertNil(startup["recovery"])
        XCTAssertEqual(try datePreservedFields(storedTask(id), excluding: []), try datePreservedFields(before, excluding: []))
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testPreparedBoardMalformedTerminalEnvelopeRetainsJournalBeforeSQLOrRecoveryRoute() async throws {
        let id = try await seedBoardActionFixture()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected Board COMMIT failure") } }
        await expectFailure("SAVE_FAILED") { _ = try await core.call("boardAction", argumentsJSON: boardActionPayload("duplicateTask", taskID: id)) }
        let frozen = try object(String(contentsOf: journal))
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(frozen["argumentsJSON"] as? String).utf8)) as? [String])
        let command = try object(XCTUnwrap(args.first))
        let request = try XCTUnwrap(command["request"] as? [String: Any])
        let prepared = try XCTUnwrap(command["prepared"] as? [String: Any])
        let expected = try json(XCTUnwrap(prepared["result"]))
        await core.close()
        let before = try Data(contentsOf: database)
        var emptyRows = prepared; emptyRows["before"] = [:]; emptyRows["after"] = [:]
        var forgedEffect = prepared
        var after = try XCTUnwrap(prepared["after"] as? [String: Any]); after["title"] = "Forged terminal title"
        forgedEffect["after"] = after
        var invalidDevice = prepared; invalidDevice["deviceIdToInitialize"] = [:]
        let wrongReply = try json(["changed": true, "open": ["taskId": "wrong-copy", "projectId": NSNull(), "tab": "task"]])
        for (candidate, reply) in [(emptyRows, expected), (forgedEffect, expected), (invalidDevice, expected), (prepared, wrongReply)] {
            let encoded = try json([json(["request": request, "prepared": candidate])])
            let terminal: [String: Any] = ["version": 2, "method": "boardCommit", "argumentsJSON": encoded,
                                           "terminal": ["success": ["_0": reply]]]
            let bytes = try JSONSerialization.data(withJSONObject: terminal, options: [.sortedKeys])
            try bytes.write(to: journal)
            let replayFaults = HostIOFaults()
            var sql = 0, writes = 0, removals = 0, diagnostics = 0
            replayFaults.beforeSQL = { _ in sql += 1 }
            replayFaults.journalWrite = { writes += 1 }
            replayFaults.journalRemove = { removals += 1 }
            replayFaults.commandDiagnostic = { if $0 == "boardAction" { diagnostics += 1 } }
            let replay = host(replayFaults)
            await expectFailure { _ = try await replay.start() }
            await expectFailure("not ready") { _ = try await replay.call("window", argumentsJSON: json([0, 50, ""])) }
            XCTAssertEqual(sql, 0); XCTAssertEqual(writes, 0); XCTAssertEqual(removals, 0); XCTAssertEqual(diagnostics, 0)
            XCTAssertEqual(try Data(contentsOf: journal), bytes)
            XCTAssertEqual(try Data(contentsOf: database), before)
            await replay.close()
        }
    }

    func testPreparedBoardStrictTransportPrivateRoutesAndRawJournalsRejectBeforeSQL() async throws {
        let id = try await seedBoardActionFixture()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        var statements = 0, journalWrites = 0
        faults.beforeSQL = { _ in statements += 1 }; faults.journalWrite = { journalWrites += 1 }
        let valid: [String: Any] = ["requestId": UUID().uuidString, "action": ["type": "duplicateTask", "taskId": id]]
        for request in [[:], ["requestId": "bad", "action": valid["action"]!], ["requestId": valid["requestId"]!, "action": ["type": "moveCard", "taskId": id, "status": "done"]],
                        ["requestId": valid["requestId"]!, "action": ["type": "duplicateTask", "taskId": id, "title": "forged"]],
                        ["requestId": valid["requestId"]!, "action": valid["action"]!, "prepared": [:]]] as [[String: Any]] {
            await expectFailure("Board") { _ = try await core.call("boardAction", argumentsJSON: json([json(request)])) }
        }
        for name in ["boardPrepare", "boardValidate", "boardCommit", "runBoardAction", "commitPreparedBoardAction"] {
            await expectFailure("unavailable") { _ = try await core.call(name, argumentsJSON: json(["{}"])) }
        }
        XCTAssertEqual(statements, 0); XCTAssertEqual(journalWrites, 0)
        await core.close()
        let raw: [String: Any] = ["version": 2, "method": "boardAction", "argumentsJSON": try json([json(valid)])]
        var mismatched = valid; mismatched["requestId"] = UUID().uuidString
        let forged: [String: Any] = ["version": 1, "request": mismatched, "before": [:], "after": [:], "deviceIdToInitialize": NSNull(), "result": [:]]
        let bound: [String: Any] = ["version": 2, "method": "boardCommit", "argumentsJSON": try json([json(["request": valid, "prepared": forged])])]
        for invalid in [raw, bound] {
            let bytes = try JSONSerialization.data(withJSONObject: invalid, options: [.sortedKeys])
            try bytes.write(to: journal)
            let reopening = host(faults)
            await expectFailure("Malformed prepared") { _ = try await reopening.start() }
            XCTAssertEqual(statements, 0); XCTAssertEqual(journalWrites, 0)
            XCTAssertEqual(try Data(contentsOf: journal), bytes)
            await reopening.close()
        }
    }

    private func seedCalendarReadFixture(count: Int = 103, timedBulk: Bool = false) async throws -> URL {
        let source = try dateBundle(at: "2026-10-28T12:00:00.000Z")
        let initializer = host(bundleURL: source)
        _ = try await initializer.start()
        await initializer.close()
        let sqlite = try SQLiteBridge(url: database)
        defer { sqlite.close() }
        let at = "2026-10-01T12:00:00.000Z"
        func insert(_ id: String, start: String? = nil, due: String? = nil, recurrence: [String: Any]? = nil, done: Bool = false) throws {
            _ = try sqlite.execute("INSERT INTO tasks (id, title, status, taskMode, description, startTime, dueDate, recurrence, timeEstimate, contexts, tags, isFocusedToday, showFutureRecurrence, suppressMindwtrReminders, pushCount, createdAt, updatedAt, completedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json([id, id, done ? "done" : "next", "task", "Keep Calendar note", start as Any? ?? NSNull(), due as Any? ?? NSNull(),
                                                         try recurrence.map { try json($0) } as Any? ?? NSNull(), "30min", json(["@calendar"]), json(["#retained"]),
                                                         0, recurrence == nil ? 0 : 1, 0, 0, at, at, done ? "2026-11-01T16:00:00.000Z" as Any : NSNull(), 1]))
        }
        // RN's Week all-day lane intentionally previews only three items. Use
        // timed scheduled rows for the >100-entry paging fixture in every mode.
        for index in 0..<count {
            try insert(String(format: "calendar-bulk-%03d", index),
                       start: timedBulk ? "2026-11-01T15:00:00.000Z" : nil, due: "2026-11-01")
        }
        try insert("calendar-timed", start: "2026-11-01T14:00:00.000Z", due: "2026-11-01")
        try insert("calendar-date-only", start: "2026-11-01")
        try insert("calendar-recurring", due: "2026-10-28", recurrence: ["rule": "daily", "strategy": "strict"])
        try insert("calendar-done", done: true)
        try insert("calendar-unscheduled")
        let settingsRows = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(sqlite.execute("SELECT data FROM settings WHERE id = 1").utf8)) as? [[String: Any]])
        var settings = try object(XCTUnwrap(settingsRows.first?["data"] as? String))
        settings["calendar"] = ["viewMode": "week", "weekVisibleDays": 5, "showCompleted": true]
        settings["weekStart"] = "sunday"
        settings["timeFormat"] = "24h"
        _ = try sqlite.execute("UPDATE settings SET data = ? WHERE id = 1", parametersJSON: json([json(settings)]))
        return source
    }

    func testCalendarModesNavigationDSTAndProjectedSheetsReadWithoutWrites() async throws {
        let originalZone = NSTimeZone.default
        let originalTZ = getenv("TZ").map { String(cString: $0) }
        defer {
            if let originalTZ { setenv("TZ", originalTZ, 1) } else { unsetenv("TZ") }
            tzset(); NSTimeZone.default = originalZone
        }
        setenv("TZ", "America/New_York", 1); tzset(); NSTimeZone.default = TimeZone(identifier: "America/New_York")!
        let source = try await seedCalendarReadFixture(count: 3)
        let faults = HostIOFaults()
        let core = host(faults, bundleURL: source)
        _ = try await core.start()
        _ = try await core.call("language", argumentsJSON: json(["en", "en-US"]))
        let before = try reviewReadSnapshot()
        var statements = 0, journalWrites = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journalWrites += 1 }
        func read(_ input: [String: Any] = ["offset": 0, "limit": 50]) async throws -> [String: Any] {
            try object(await core.call("menuRead", argumentsJSON: json(["calendar", json(input)])))
        }
        func sheet(_ id: String, state: Any) async throws -> [String: Any] {
            try object(await core.call("menuRead", argumentsJSON: json(["calendarItem", json(["taskId": id, "state": state])])))
        }
        let first = try await read()
        XCTAssertEqual(try json(XCTUnwrap(first["state"])), try json(["viewMode": "week", "selectedDate": "2026-10-28", "visibleMonth": "2026-10-28"]))
        XCTAssertEqual((first["content"] as? [String: Any])?["visibleDays"] as? Int, 5)
        XCTAssertEqual((first["range"] as? [String: Any])?["start"] as? String, "2026-10-25T04:00:00.000Z")
        let modes = try XCTUnwrap(first["modes"] as? [[String: Any]])
        XCTAssertEqual(Set(modes.compactMap { $0["mode"] as? String }), Set(["month", "week", "day", "schedule"]))
        for mode in modes {
            let view = try await read(["state": try XCTUnwrap(mode["state"]), "offset": 0, "limit": 50])
            XCTAssertEqual((view["content"] as? [String: Any])?["mode"] as? String, mode["mode"] as? String)
            XCTAssertFalse(try XCTUnwrap((view["header"] as? [String: Any])?["title"] as? String).isEmpty)
            XCTAssertTrue((view["modes"] as? [[String: Any]])?.contains { $0["mode"] as? String == mode["mode"] as? String && $0["selected"] as? Bool == true } == true)
        }
        let projected = try XCTUnwrap((first["items"] as? [[String: Any]])?.compactMap { $0["item"] as? [String: Any] }.first { $0["projected"] as? Bool == true })
        XCTAssertEqual(projected["pressable"] as? Bool, false)
        let projectedSheet = try await sheet(XCTUnwrap(projected["taskId"] as? String), state: XCTUnwrap(first["state"]))
        XCTAssertEqual(projectedSheet["kind"] as? String, "projected")
        XCTAssertEqual((projectedSheet["buttons"] as? [[String: Any]])?.compactMap { $0["id"] as? String }, ["ok"])
        XCTAssertFalse(try XCTUnwrap(projectedSheet["message"] as? String).isEmpty)

        let nextState = try XCTUnwrap(((first["header"] as? [String: Any])?["next"] as? [String: Any])?["state"])
        let next = try await read(["state": nextState, "offset": 0, "limit": 50])
        XCTAssertEqual(try json(XCTUnwrap(next["range"])), try json(["start": "2026-11-01T04:00:00.000Z", "end": "2026-11-08T04:59:59.999Z"]))
        let sunday = try XCTUnwrap((next["items"] as? [[String: Any]])?.first { $0["type"] as? String == "day" && $0["key"] as? String == "2026-11-01" })
        let dayState = try XCTUnwrap(sunday["opens"])
        let day = try await read(["state": dayState, "offset": 0, "limit": 50])
        let entries = try XCTUnwrap(day["items"] as? [[String: Any]])
        let timed = try XCTUnwrap(entries.first { ($0["item"] as? [String: Any])?["taskId"] as? String == "calendar-timed" && $0["lane"] as? String == "timed" })
        let timing = try XCTUnwrap((timed["item"] as? [String: Any])?["timed"] as? [String: Any])
        XCTAssertEqual(timing["startMinutes"] as? Int, 540)
        XCTAssertEqual(timing["endMinutes"] as? Int, 570)
        XCTAssertEqual(timing["durationMinutes"] as? Int, 30)
        let dateOnly = try XCTUnwrap(entries.first { ($0["item"] as? [String: Any])?["taskId"] as? String == "calendar-date-only" })
        XCTAssertEqual(dateOnly["lane"] as? String, "allDay")
        XCTAssertTrue((dateOnly["item"] as? [String: Any])?["timed"] is NSNull)
        let completed = try XCTUnwrap(entries.first { ($0["item"] as? [String: Any])?["taskId"] as? String == "calendar-done" })
        XCTAssertEqual((completed["item"] as? [String: Any])?["pressable"] as? Bool, false)
        await expectFailure("TASK_NOT_FOUND") { _ = try await sheet("calendar-done", state: dayState) }
        let editable = try await sheet("calendar-timed", state: dayState)
        XCTAssertEqual(editable["kind"] as? String, "task")
        XCTAssertEqual((editable["buttons"] as? [[String: Any]])?.compactMap { $0["id"] as? String }, ["edit", "unschedule", "done", "delete", "cancel"])
        XCTAssertEqual(statements, 0); XCTAssertEqual(journalWrites, 0)
        XCTAssertEqual(try reviewReadSnapshot(), before)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testCalendarBoundedTaskWindowsSearchAndStaleRevisionsReadWithoutWrites() async throws {
        let source = try await seedCalendarReadFixture(timedBulk: true)
        let faults = HostIOFaults()
        let core = host(faults, bundleURL: source)
        _ = try await core.start()
        let before = try reviewReadSnapshot()
        var statements = 0, journalWrites = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journalWrites += 1 }
        func read(_ input: [String: Any]) async throws -> [String: Any] {
            try object(await core.call("menuRead", argumentsJSON: json(["calendar", json(input)])))
        }
        for mode in ["month", "week", "day", "schedule"] {
            let state = ["viewMode": mode, "selectedDate": "2026-11-01", "visibleMonth": "2026-11-01"]
            let first = try await read(["state": state, "offset": 0, "limit": 50])
            let total = try XCTUnwrap(first["total"] as? Int)
            XCTAssertGreaterThan(total, 100, mode)
            let revision = try XCTUnwrap(first["revision"] as? String)
            var all: [[String: Any]] = []
            for offset in stride(from: 0, to: total, by: 50) {
                let page = try await read(["state": state, "offset": offset, "limit": 50, "revision": revision])
                XCTAssertEqual(page["revision"] as? String, revision)
                let items = try XCTUnwrap(page["items"] as? [[String: Any]])
                XCTAssertEqual(items.count, min(50, total - offset))
                all += items
            }
            XCTAssertEqual(all.count, total)
            let combined = try await read(["state": state, "offset": 0, "limit": 100, "revision": revision])
            XCTAssertEqual(try json(Array(all.prefix(100))), try json(XCTUnwrap(combined["items"])))
            let bulk = all.compactMap { $0["item"] as? [String: Any] }.compactMap { $0["taskId"] as? String }.filter { $0.hasPrefix("calendar-bulk-") }
            XCTAssertEqual(bulk.count, 103, mode)
            XCTAssertEqual(Set(bulk), Set((0..<103).map { String(format: "calendar-bulk-%03d", $0) }), mode)
            await expectFailure("INVALID_INPUT") { _ = try await read(["state": state, "offset": 50, "limit": 50]) }
            await expectFailure("STALE_REVISION") { _ = try await read(["state": state, "scheduleQuery": "changed", "offset": 50, "limit": 50, "revision": revision]) }
            await expectFailure("STALE_REVISION") { _ = try await read(["state": state, "offset": 50, "limit": 50, "revision": "stale"]) }
        }
        let day = ["viewMode": "day", "selectedDate": "2026-11-01", "visibleMonth": "2026-11-01"]
        let searched = try await read(["state": day, "scheduleQuery": "calendar-unscheduled", "offset": 0, "limit": 50])
        let total = try XCTUnwrap(searched["total"] as? Int)
        let tail = try await read(["state": day, "scheduleQuery": "calendar-unscheduled", "offset": max(0, total - 50), "limit": 50, "revision": try XCTUnwrap(searched["revision"])])
        XCTAssertEqual((tail["items"] as? [[String: Any]])?.filter { $0["type"] as? String == "task" && $0["list"] as? String == "search" }.compactMap { $0["taskId"] as? String }, ["calendar-unscheduled"])
        XCTAssertEqual(statements, 0); XCTAssertEqual(journalWrites, 0)
        XCTAssertEqual(try reviewReadSnapshot(), before)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testCalendarReadAliasesRejectMalformedExternalAndMutableInputsWithoutWrites() async throws {
        let source = try await seedCalendarReadFixture(count: 1)
        let faults = HostIOFaults()
        let core = host(faults, bundleURL: source)
        _ = try await core.start()
        let before = try reviewReadSnapshot()
        var statements = 0, journalWrites = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journalWrites += 1 }
        func read(_ name: String, _ input: [String: Any]) async throws {
            _ = try await core.call("menuRead", argumentsJSON: json([name, json(input)]))
        }
        let state: [String: Any] = ["viewMode": "day", "selectedDate": "2026-11-01", "visibleMonth": "2026-11-01"]
        for (name, valid) in [("calendar", ["state": state, "offset": 0, "limit": 50] as [String: Any]), ("calendarItem", ["state": state, "taskId": "calendar-timed"] as [String: Any])] {
            try await read(name, valid)
            for field in ["calendar", "events", "feed", "event", "canOpen", "action", "requestId", "unknown"] {
                var input = valid; input[field] = NSNull()
                await expectFailure("Unsupported native Calendar browsing input") { try await read(name, input) }
            }
            for malformedState in [NSNull(), [], ["viewMode": "unknown"], ["viewMode": "day", "selectedDate": "2026-02-30", "visibleMonth": "2026-11-01"], ["viewMode": "day", "selectedDate": "2026-11-01", "visibleMonth": "2026-11-01T00:00:00Z"]] as [Any] {
                var input = valid; input["state"] = malformedState
                await expectFailure("INVALID_INPUT") { try await read(name, input) }
            }
            for malformed in ["[]", "null", "broken JSON"] {
                await expectFailure { _ = try await core.call("menuRead", argumentsJSON: json([name, malformed])) }
            }
        }
        for malformed in [["offset": true], ["offset": -1], ["offset": 0.5], ["limit": 101], ["limit": 0], ["limit": "50"], ["scheduleQuery": true], ["scheduleQuery": String(repeating: "x", count: 2001)], ["revision": 1]] as [[String: Any]] {
            var input: [String: Any] = ["state": state, "offset": 0, "limit": 50]
            input.merge(malformed) { _, new in new }
            await expectFailure("INVALID_INPUT") { try await read("calendar", input) }
        }
        await expectFailure("INVALID_INPUT") { try await read("calendarItem", ["state": state, "taskId": 1]) }
        await expectFailure("TASK_NOT_FOUND") { try await read("calendarItem", ["state": state, "taskId": "missing"]) }
        await expectFailure("Unsupported native Calendar browsing input") { try await read("calendarItem", ["taskId": "calendar-timed", "offset": 0]) }
        for method in ["runCalendarAction", "openCalendarComposer", "editCalendarComposer", "setCalendarViewMode"] {
            await expectFailure("Unsupported native menu read") { try await read(method, [:]) }
            await expectFailure("unavailable") { _ = try await core.call(method, argumentsJSON: json(["{}"])) }
        }
        XCTAssertEqual(statements, 0); XCTAssertEqual(journalWrites, 0)
        XCTAssertEqual(try reviewReadSnapshot(), before)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testFocusReadsPageAndRejectStaleOrMalformedWindows() async throws {
        let core = host()
        _ = try await core.start()
        for title in ["First next action /next", "Second next action /next"] {
            _ = try await core.call("captureSubmit", argumentsJSON: capture(core, title: title))
        }
        let focus = try object(await core.call("focus", argumentsJSON: "[1]"))
        let sections = try XCTUnwrap(focus["sections"] as? [[String: Any]])
        let next = try XCTUnwrap(sections.first { ($0["total"] as? Int) == 2 })
        let key = try XCTUnwrap(next["key"] as? String)
        let revision = try XCTUnwrap(focus["revision"] as? String)
        let first = try XCTUnwrap(next["rows"] as? [[String: Any]])
        XCTAssertEqual(first.count, 1)
        let page = try object(await core.call("focusWindow", argumentsJSON: json([key, 1, 1, revision])))
        let rows = try XCTUnwrap(page["rows"] as? [[String: Any]])
        XCTAssertEqual(rows.count, 1)
        XCTAssertNotEqual(first.first?["id"] as? String, rows.first?["id"] as? String)
        for invalid in ["[true]", "[1.5]", "[\"1\"]"] {
            await expectFailure { _ = try await core.call("focus", argumentsJSON: invalid) }
        }
        await expectFailure("integers") { _ = try await core.call("focusWindow", argumentsJSON: json([key, true, 1, revision])) }
        await expectFailure("INVALID_INPUT") { _ = try await core.call("focus", argumentsJSON: "[101]") }
        _ = try await core.call("complete", argumentsJSON: json([XCTUnwrap(first.first?["id"] as? String)]))
        await expectFailure("STALE_REVISION") { _ = try await core.call("focusWindow", argumentsJSON: json([key, 1, 1, revision])) }
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testRealIntlLanguageAndBoundedStaleInboxWindows() async throws {
        let core = host()
        _ = try await core.start()
        _ = try await core.call("language", argumentsJSON: "[\"\",\"de-DE\"]")
        let labels = try object(await core.call("strings", argumentsJSON: json([json(["nav.inbox"])])))
        XCTAssertFalse(labels.isEmpty)
        for title in ["Item 10", "Éclair", "Item 2"] {
            _ = try await core.call("captureSubmit", argumentsJSON: capture(core, title: title))
        }
        let first = try object(await core.call("window", argumentsJSON: "[0,1,\"\"]"))
        XCTAssertEqual((first["rows"] as? [Any])?.count, 1)
        XCTAssertEqual(first["total"] as? Int, 3)
        let revision = try XCTUnwrap(first["revision"] as? String)
        _ = try await core.call("captureSubmit", argumentsJSON: capture(core, title: "Revision change"))
        await expectFailure("STALE_REVISION") { _ = try await core.call("window", argumentsJSON: json([1, 1, revision])) }
        await expectFailure("INVALID_INPUT") { _ = try await core.call("window", argumentsJSON: "[0,10001,\"\"]") }
        let screen = try object(await core.call("inboxView", argumentsJSON: json([json(["offset": 0, "limit": 2])])))
        XCTAssertEqual((screen["items"] as? [Any])?.count, 2)
        XCTAssertNotNil(screen["toolbar"])

        // Evaluate the exact bundled preflight/polyfills on a separate off-main
        // JSC queue. No fake Intl can satisfy numeric plus accent equivalence.
        let source = try String(contentsOf: bundle)
        let collated: [String] = try await withCheckedThrowingContinuation { continuation in
            DispatchQueue(label: "test.intl").async {
                let context = JSContext()!
                // I/O services for module initialization only; Intl is JSC's own.
                context.evaluateScript("globalThis.__mindwtrNative = {nowMs: () => Date.now(), randomBytes: n => JSON.stringify(Array(n).fill(0)), log: () => {}}")
                context.evaluateScript(source)
                if let exception = context.exception { continuation.resume(throwing: HostFailure(exception.toString() ?? "JSC exception")); return }
                let result = context.evaluateScript("JSON.stringify([new Intl.Collator('en', {numeric:true}).compare('Item 2','Item 10') < 0, new Intl.Collator('fr', {sensitivity:'base'}).compare('éclair','eclair') === 0, __hostUse['Intl.Collator'] === undefined])")!.toString()!
                continuation.resume(returning: [result])
            }
        }
        XCTAssertEqual(collated, ["[true,true,true]"])
    }

    private func calendarScheduleInput(_ core: CoreHost, taskID: String, requestID: String = UUID().uuidString.lowercased()) async throws -> [String: Any] {
        let opened = try object(await core.call("calendarComposerOpen", argumentsJSON: json([json(["day": "2036-10-03", "scheduleTaskId": taskID])])))
        let view = try XCTUnwrap(opened["composer"] as? [String: Any])
        let composer = try XCTUnwrap(view["composer"] as? [String: Any])
        XCTAssertEqual(composer["mode"] as? String, "existing")
        return ["requestId": requestID, "composer": composer]
    }

    private func calendarCreateInput(_ core: CoreHost, title: String,
                                     requestID: String = UUID().uuidString.lowercased()) async throws -> [String: Any] {
        let opened = try object(await core.call("calendarComposerOpen", argumentsJSON: json([json([
            "day": "2036-10-03", "rawMinutes": 37, "mode": "new",
        ])])))
        let view = try XCTUnwrap(opened["composer"] as? [String: Any])
        let composer = try XCTUnwrap(view["composer"] as? [String: Any])
        let edited = try object(await core.call("calendarComposerEdit", argumentsJSON: json([json([
            "composer": composer, "edit": ["type": "title", "title": title],
        ])])))
        return ["requestId": requestID, "composer": try XCTUnwrap(edited["composer"] as? [String: Any])]
    }

    func testMindSweepGuideAndLiteralAddJournalBeforeOneTaskWrite() async throws {
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        for (scope, count) in [("all", 9), ("personal", 5), ("work", 4)] {
            let guide = try object(await core.call("mindSweepGuide", argumentsJSON: json([json(["scope": scope])])))
            let groups = try XCTUnwrap(guide["groups"] as? [[String: Any]])
            XCTAssertEqual(groups.count, count)
            XCTAssertTrue(groups.allSatisfy { ($0["prompts"] as? [String])?.count == 5 })
        }
        await expectFailure("INVALID_INPUT") { _ = try await core.call("mindSweepGuide", argumentsJSON: json([json(["scope": "unknown"])])) }
        let id = UUID().uuidString.lowercased()
        let title = "  Call +Studio /due:tomorrow\nthen note @home  "
        var taskWrites = 0, projectWrites = 0
        faults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+tasks\b"#, options: .regularExpression) != nil {
                taskWrites += 1
                XCTAssertTrue(FileManager.default.fileExists(atPath: self.journal.path))
            }
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+projects\b"#, options: .regularExpression) != nil {
                projectWrites += 1
            }
        }
        let saved = try object(await core.call("mindSweepAdd", argumentsJSON: json([json(["requestId": id, "title": title])])))
        XCTAssertEqual(saved["taskId"] as? String, id)
        XCTAssertEqual(saved["title"] as? String, "Call +Studio /due:tomorrow\nthen note @home")
        XCTAssertEqual(taskWrites, 1); XCTAssertEqual(projectWrites, 0)
        let row = try storedTask(id)
        XCTAssertEqual(row["title"] as? String, saved["title"] as? String)
        XCTAssertEqual(row["status"] as? String, "inbox")
        XCTAssertTrue(row["projectId"] is NSNull)
        XCTAssertTrue(row["dueDate"] is NSNull)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        for method in ["mindSweepPrepare", "mindSweepValidate", "mindSweepCommit"] {
            await expectFailure("unavailable") { _ = try await core.call(method, argumentsJSON: json([json(["requestId": id, "title": title])])) }
        }
        await expectFailure("INVALID_INPUT") { _ = try await core.call("mindSweepAdd", argumentsJSON: json([json(["requestId": id.uppercased(), "title": title])])) }
        XCTAssertEqual(taskWrites, 1)
    }

    func testMindSweepOversizedPreflightIsDefiniteNoWriteAndNextAddWorks() async throws {
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        var sql = 0
        faults.beforeSQL = { _ in sql += 1 }
        let oversized = String(repeating: "x", count: 2_000_001)
        let rejectedID = UUID().uuidString.lowercased()
        let oversizedRequest = try json([json(["requestId": rejectedID, "title": oversized])])
        do {
            _ = try await core.call("mindSweepAdd", argumentsJSON: oversizedRequest)
            XCTFail("Oversized Mind Sweep title must be refused before journaling")
        } catch {
            XCTAssertTrue(error is CoreHostRejection)
            XCTAssertTrue(error.localizedDescription.hasPrefix("INVALID_INPUT:"))
        }
        XCTAssertEqual(sql, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        let nextID = UUID().uuidString.lowercased()
        let saved = try object(await core.call("mindSweepAdd", argumentsJSON: json([json(["requestId": nextID, "title": "Editable next item"])])))
        XCTAssertEqual(saved["taskId"] as? String, nextID)
        XCTAssertEqual(try storedTask(nextID)["title"] as? String, "Editable next item")
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testMindSweepLostReplyRestartsWithOneExactAcknowledgment() async throws {
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let id = UUID().uuidString.lowercased()
        let request = try json(["requestId": id, "title": "  One owed item  "])
        var journalWrites = 0
        faults.journalWrite = { journalWrites += 1; if journalWrites == 2 { throw HostFailure("Injected Mind Sweep lost reply") } }
        await expectFailure("lost reply") { _ = try await core.call("mindSweepAdd", argumentsJSON: json([request])) }
        XCTAssertEqual(try object(String(contentsOf: journal))["method"] as? String, "mindSweepCommit")
        let owedBytes = try Data(contentsOf: journal)
        do {
            _ = try await core.call("mindSweepAdd", argumentsJSON: "[42]")
            XCTFail("A pending command must block a new malformed request")
        } catch { XCTAssertFalse(error is CoreHostRejection) }
        XCTAssertEqual(try Data(contentsOf: journal), owedBytes)
        let written = try storedTask(id)
        await core.close()
        let replayFaults = HostIOFaults()
        var taskWrites = 0
        replayFaults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+tasks\b"#, options: .regularExpression) != nil { taskWrites += 1 }
        }
        let reopened = host(replayFaults)
        let window = try object(await reopened.start())
        let recovery = try XCTUnwrap(window["recovery"] as? [String: Any])
        XCTAssertEqual(recovery["method"] as? String, "mindSweepCommit")
        let result = try XCTUnwrap(recovery["result"] as? [String: Any])
        XCTAssertEqual(result["taskId"] as? String, id)
        XCTAssertEqual(result["title"] as? String, "One owed item")
        XCTAssertEqual(taskWrites, 0)
        XCTAssertEqual(try json(storedTask(id)), try json(written))
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        let pendingAfterRecovery = try await reopened.retryPending()
        XCTAssertNil(pendingAfterRecovery)
    }

    func testMindSweepFailedCommitRetriesOneTaskAndMalformedTerminalBlocksBeforeSQLite() async throws {
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let id = UUID().uuidString.lowercased()
        let request = try json(["requestId": id, "title": "One atomic item"])
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected Mind Sweep COMMIT failure") } }
        await expectFailure("SAVE_FAILED") { _ = try await core.call("mindSweepAdd", argumentsJSON: json([request])) }
        let pending = try object(String(contentsOf: journal))
        XCTAssertEqual(pending["method"] as? String, "mindSweepCommit")
        let sqlite = try SQLiteBridge(url: database)
        let absent = try JSONSerialization.jsonObject(with: Data(sqlite.execute("SELECT id FROM tasks WHERE id = ?", parametersJSON: json([id])).utf8)) as? [[String: Any]]
        sqlite.close()
        XCTAssertEqual(absent?.count, 0)
        await core.close()
        let replayFaults = HostIOFaults()
        var taskWrites = 0
        replayFaults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+tasks\b"#, options: .regularExpression) != nil { taskWrites += 1 }
        }
        let reopened = host(replayFaults)
        let restarted = try object(await reopened.start())
        let recovery = try XCTUnwrap(restarted["recovery"] as? [String: Any])
        XCTAssertEqual(recovery["method"] as? String, "mindSweepCommit")
        XCTAssertEqual((recovery["result"] as? [String: Any])?["taskId"] as? String, id)
        XCTAssertEqual(taskWrites, 1)
        XCTAssertEqual(try storedTask(id)["title"] as? String, "One atomic item")
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))

        // A second failed publication leaves a terminal envelope that must be
        // rejected by the pure decoder before opening SQLite or removing intent.
        let second = UUID().uuidString.lowercased()
        let secondFaults = HostIOFaults()
        let writer = host(secondFaults)
        await reopened.close()
        _ = try await writer.start()
        secondFaults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected Mind Sweep COMMIT failure") } }
        await expectFailure("SAVE_FAILED") { _ = try await writer.call("mindSweepAdd", argumentsJSON: json([json(["requestId": second, "title": "Untouched"])])) }
        let secondPending = try object(String(contentsOf: journal))
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(secondPending["argumentsJSON"] as? String).utf8)) as? [String])
        var envelope = try object(XCTUnwrap(args.first))
        var prepared = try XCTUnwrap(envelope["prepared"] as? [String: Any])
        var task = try XCTUnwrap(prepared["task"] as? [String: Any])
        task["projectId"] = "forged-project"
        prepared["task"] = task
        envelope["prepared"] = prepared
        let terminal = try json(["version": 2, "method": "mindSweepCommit",
                                 "argumentsJSON": json([json(envelope)]),
                                 "terminal": ["success": ["_0": json(XCTUnwrap(prepared["result"]))]]])
        await writer.close()
        try Data(terminal.utf8).write(to: journal)
        let beforeDB = try Data(contentsOf: database)
        let blockedFaults = HostIOFaults()
        var sql = 0, removals = 0
        blockedFaults.beforeSQL = { _ in sql += 1 }
        blockedFaults.journalRemove = { removals += 1 }
        let blocked = host(blockedFaults)
        await expectFailure { _ = try await blocked.start() }
        XCTAssertEqual(sql, 0); XCTAssertEqual(removals, 0)
        XCTAssertEqual(try Data(contentsOf: journal), Data(terminal.utf8))
        XCTAssertEqual(try Data(contentsOf: database), beforeDB)
    }

    func testMindSweepSameHostRetryAfterTransientInsertFailure() async throws {
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let id = UUID().uuidString.lowercased()
        let title = "iOS sweep retry 20260927-29"
        let request = try json([json(["requestId": id, "title": title])])
        let originalCount = try taskCount()
        let taskInsert = #"(?i)^\s*INSERT(?: OR \w+)? INTO\s+tasks\b"#
        var blockedInserts = 0
        faults.beforeSQL = { sql in
            if sql.range(of: taskInsert, options: .regularExpression) != nil {
                blockedInserts += 1
                XCTAssertTrue(FileManager.default.fileExists(atPath: self.journal.path))
                throw HostFailure("Injected transient Mind Sweep INSERT failure")
            }
        }
        await expectFailure("SAVE_FAILED") { _ = try await core.call("mindSweepAdd", argumentsJSON: request) }
        XCTAssertGreaterThan(blockedInserts, 0)
        XCTAssertEqual(try taskCount(), originalCount)
        XCTAssertEqual(try object(String(contentsOf: journal))["method"] as? String, "mindSweepCommit")

        var retriedInserts = 0
        faults.beforeSQL = { sql in
            if sql.range(of: taskInsert, options: .regularExpression) != nil {
                retriedInserts += 1
                XCTAssertTrue(FileManager.default.fileExists(atPath: self.journal.path))
            }
        }
        let retried = try await core.retryPending()
        let acknowledgment = try XCTUnwrap(retried)
        let result = try object(acknowledgment)
        XCTAssertEqual(result["taskId"] as? String, id)
        XCTAssertEqual(result["title"] as? String, title)
        XCTAssertEqual(retriedInserts, 1)
        XCTAssertEqual(try taskCount(), originalCount + 1)
        XCTAssertEqual(try storedTask(id)["title"] as? String, title)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        let noPending = try await core.retryPending()
        XCTAssertNil(noPending)
    }

    func testMindSweepSameHostRetryKeepsIntentAfterExternalSQLiteCommit() async throws {
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let id = UUID().uuidString.lowercased()
        let request = try json([json(["requestId": id, "title": "Guarded sweep retry"])])
        let originalCount = try taskCount()
        let taskInsert = #"(?i)^\s*INSERT(?: OR \w+)? INTO\s+tasks\b"#
        faults.beforeSQL = { sql in
            if sql.range(of: taskInsert, options: .regularExpression) != nil {
                throw HostFailure("Injected transient Mind Sweep INSERT failure")
            }
        }
        await expectFailure("SAVE_FAILED") { _ = try await core.call("mindSweepAdd", argumentsJSON: request) }
        let originalJournal = try Data(contentsOf: journal)
        XCTAssertEqual(try taskCount(), originalCount)

        // The simulator trigger-drop diagnosis made an external schema commit
        // after the failure. The live adapter must refuse its stale snapshot.
        let external = try SQLiteBridge(url: database)
        _ = try external.execute("CREATE TABLE native_mind_sweep_external_probe (id INTEGER PRIMARY KEY)")
        external.close()
        var taskWrites = 0
        faults.beforeSQL = { sql in
            if sql.range(of: taskInsert, options: .regularExpression) != nil { taskWrites += 1 }
        }
        await expectFailure("SAVE_FAILED") { _ = try await core.retryPending() }
        XCTAssertEqual(taskWrites, 0)
        XCTAssertEqual(try taskCount(), originalCount)
        // JSONEncoder does not promise object-key order across re-encoding.
        // Compare the complete envelope, including the exact frozen arguments
        // string, so a formatting change cannot mask or imitate intent changes.
        XCTAssertEqual(try json(object(String(contentsOf: journal))),
                       try json(object(String(decoding: originalJournal, as: UTF8.self))))
    }

    func testProcessInboxSkipAcknowledgesBeforeAdvancingAndPreservesEdits() async throws {
        let faults = HostIOFaults()
        let source = try dateBundle(at: "2026-09-27T12:00:00.000Z", suffix: """
        (() => {
            const after = MindwtrHost.inboxAfterCommit, poll = MindwtrHost.poll;
            const tickets = new Set();
            let failOnce = true;
            MindwtrHost.inboxAfterCommit = function (json) {
                const id = after(json); tickets.add(id); return id;
            };
            MindwtrHost.poll = function (id) {
                const reply = poll(id);
                if (failOnce && tickets.has(id) && reply) {
                    const parsed = JSON.parse(reply);
                    if (parsed.ok) {
                        failOnce = false;
                        return JSON.stringify({ok: false, error: 'Injected Process Inbox next view reply'});
                    }
                }
                return reply;
            };
        })();
        """)
        let core = host(faults, bundleURL: source)
        _ = try await core.start()
        for title in ["First clarification", "Second clarification"] {
            _ = try await core.call("mindSweepAdd", argumentsJSON: json([json([
                "requestId": UUID().uuidString.lowercased(), "title": title,
            ])]))
        }
        let opened = try object(await core.call("inboxStart", argumentsJSON: json(["guided"])))
        let session = try XCTUnwrap(opened["sessionId"] as? String)
        let view = try XCTUnwrap(opened["view"] as? [String: Any])
        let id = try XCTUnwrap(view["taskId"] as? String)
        let step = try XCTUnwrap(view["step"] as? String)
        let before = try storedTask(id)
        let edit = try json([json(["sessionId": session, "taskId": id, "step": step,
                                  "edit": ["type": "set", "field": "description", "value": "Clarified before skipping"]])])
        _ = try await core.call("inboxStep", argumentsJSON: edit)
        let requestID = UUID().uuidString.lowercased()
        var writes = 0, diagnostics = 0
        faults.beforeSQL = { sql in
            if sql.uppercased().hasPrefix("INSERT INTO TASKS") { writes += 1 }
        }
        faults.commandDiagnostic = { if $0 == "processInboxWrite" { diagnostics += 1 } }
        let acknowledged = try object(await core.call("inboxSkip", argumentsJSON: json([json([
            "sessionId": session, "taskId": id, "requestId": requestID,
        ])])))
        XCTAssertEqual(acknowledged["kind"] as? String, "saved")
        XCTAssertNil(acknowledged["view"])
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        let saved = try storedTask(id)
        XCTAssertEqual(saved["description"] as? String, "Clarified before skipping")
        XCTAssertEqual(saved["status"] as? String, "inbox")
        XCTAssertEqual(saved["rev"] as? Int, (before["rev"] as? Int ?? 0) + 1)
        XCTAssertEqual(diagnostics, 1)
        let writesAfterSave = writes
        await expectFailure("ACTION_FAILED") { _ = try await core.call("inboxStep", argumentsJSON: edit) }
        await expectFailure("ACTION_FAILED") { _ = try await core.call("inboxSkip", argumentsJSON: json([json([
            "sessionId": session, "taskId": id, "requestId": UUID().uuidString.lowercased(),
        ])])) }
        let afterInput = try json([json(["sessionId": session, "requestId": requestID])])
        await expectFailure("Injected Process Inbox next view reply") {
            _ = try await core.call("inboxAfterCommit", argumentsJSON: afterInput)
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        XCTAssertEqual(writes, writesAfterSave)
        let next = try object(await core.call("inboxAfterCommit", argumentsJSON: afterInput))
        let nextView = try XCTUnwrap(next["view"] as? [String: Any])
        XCTAssertNotEqual(nextView["taskId"] as? String, id)
        XCTAssertEqual((nextView["progress"] as? [String: Any])?["processed"] as? Int, 1)
        let repeated = try object(await core.call("inboxAfterCommit", argumentsJSON: afterInput))
        XCTAssertEqual((repeated["view"] as? [String: Any])?["taskId"] as? String, nextView["taskId"] as? String)
        XCTAssertEqual(writes, writesAfterSave)
        XCTAssertEqual(try json(storedTask(id)), try json(saved))
    }

    func testProcessInboxLostReplyRecoversWithoutRestoringSessionOrWritingTwice() async throws {
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let id = UUID().uuidString.lowercased()
        _ = try await core.call("mindSweepAdd", argumentsJSON: json([json(["requestId": id, "title": "Keep through restart"])]))
        let opened = try object(await core.call("inboxStart", argumentsJSON: json(["quick"])))
        let session = try XCTUnwrap(opened["sessionId"] as? String)
        let view = try XCTUnwrap(opened["view"] as? [String: Any])
        let step = try XCTUnwrap(view["step"] as? String)
        _ = try await core.call("inboxStep", argumentsJSON: json([json([
            "sessionId": session, "taskId": id, "step": step,
            "edit": ["type": "set", "field": "description", "value": "Frozen clarification"],
        ])]))
        var journalWrites = 0
        faults.journalWrite = {
            journalWrites += 1
            if journalWrites == 2 { throw HostFailure("Injected Process Inbox lost reply") }
        }
        let requestID = UUID().uuidString.lowercased()
        await expectFailure("lost reply") { _ = try await core.call("inboxSkip", argumentsJSON: json([json([
            "sessionId": session, "taskId": id, "requestId": requestID,
        ])])) }
        let pending = try object(String(contentsOf: journal))
        XCTAssertEqual(pending["method"] as? String, "inboxPreparedCommit")
        let saved = try storedTask(id)
        XCTAssertEqual(saved["description"] as? String, "Frozen clarification")
        await core.close()
        let recoveringFaults = HostIOFaults()
        var writes = 0
        recoveringFaults.beforeSQL = { sql in
            if sql.uppercased().hasPrefix("INSERT INTO TASKS") { writes += 1 }
        }
        let restarted = host(recoveringFaults)
        let window = try object(await restarted.start())
        let recovery = try XCTUnwrap(window["recovery"] as? [String: Any])
        XCTAssertEqual(recovery["method"] as? String, "inboxPreparedCommit")
        let result = try XCTUnwrap(recovery["result"] as? [String: Any])
        XCTAssertNil(result["view"])
        XCTAssertNil(result["progress"])
        XCTAssertNil(result["toast"])
        XCTAssertEqual(try json(storedTask(id)), try json(saved))
        XCTAssertEqual(writes, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        await expectFailure("STALE_REVISION") { _ = try await restarted.call("inboxAfterCommit", argumentsJSON: json([json([
            "sessionId": session, "requestId": requestID,
        ])])) }
        let secondStart = try object(await restarted.start())
        XCTAssertNil(secondStart["recovery"])
        let fresh = try object(await restarted.call("inboxStart", argumentsJSON: json(["quick"])))
        XCTAssertEqual(((fresh["view"] as? [String: Any])?["progress"] as? [String: Any])?["processed"] as? Int, 0)
    }

    func testProcessInboxSameHostFailedCommitAndForgedTerminalStaySafe() async throws {
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let id = UUID().uuidString.lowercased()
        _ = try await core.call("mindSweepAdd", argumentsJSON: json([json(["requestId": id, "title": "Atomic clarification"])]))
        let opened = try object(await core.call("inboxStart", argumentsJSON: json(["quick"])))
        let session = try XCTUnwrap(opened["sessionId"] as? String)
        let view = try XCTUnwrap(opened["view"] as? [String: Any])
        let step = try XCTUnwrap(view["step"] as? String)
        _ = try await core.call("inboxStep", argumentsJSON: json([json([
            "sessionId": session, "taskId": id, "step": step,
            "edit": ["type": "set", "field": "description", "value": "Durable only after retry"],
        ])]))
        let before = try json(storedTask(id))
        let requestID = UUID().uuidString.lowercased()
        faults.beforeSQL = { sql in
            if sql == "COMMIT" {
                XCTAssertTrue(FileManager.default.fileExists(atPath: self.journal.path))
                throw HostFailure("Injected Process Inbox COMMIT failure")
            }
        }
        await expectFailure("SAVE_FAILED") { _ = try await core.call("inboxSkip", argumentsJSON: json([json([
            "sessionId": session, "taskId": id, "requestId": requestID,
        ])])) }
        XCTAssertEqual(try json(storedTask(id)), before)
        let pending = try object(String(contentsOf: journal))
        let arguments = try XCTUnwrap(pending["argumentsJSON"] as? String)
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(arguments.utf8)) as? [String])
        let envelope = try object(XCTUnwrap(args.first))
        let prepared = try XCTUnwrap(envelope["prepared"] as? [String: Any])
        let expectedResult = try XCTUnwrap(prepared["result"] as? [String: Any])
        await expectFailure("SAVE_FAILED") { _ = try await core.call("inboxAfterCommit", argumentsJSON: json([json([
            "sessionId": session, "requestId": requestID,
        ])])) }
        faults.beforeSQL = nil
        let retried = try await core.retryPending()
        let reply = try object(XCTUnwrap(retried))
        XCTAssertEqual(reply["kind"] as? String, "saved")
        XCTAssertEqual(try json(XCTUnwrap(reply["result"])), try json(expectedResult))
        XCTAssertEqual(try storedTask(id)["description"] as? String, "Durable only after retry")
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        _ = try await core.call("inboxAfterCommit", argumentsJSON: json([json([
            "sessionId": session, "requestId": requestID,
        ])]))
        await core.close()

        // Terminal success cannot bypass immutable validation or substitute an
        // acknowledgment. Every corruption must stop before opening SQLite.
        let beforeDB = try Data(contentsOf: database)
        for corruption in ["envelope", "acknowledgment", "unrequestedDue", "pushCount"] {
            var forgedEnvelope = envelope
            var forgedPrepared = prepared
            var terminalResult = expectedResult
            if corruption == "envelope" {
                forgedPrepared["unexpected"] = true
            } else if corruption == "acknowledgment" {
                terminalResult["unexpected"] = true
            } else {
                // Keep the affected row coherent with the forged decision. The
                // validator must bind intent, not just compare two forged copies.
                var witness = try XCTUnwrap(forgedPrepared["witness"] as? [String: Any])
                var decision = try XCTUnwrap(witness["preparedDecision"] as? [String: Any])
                var updates = try XCTUnwrap(decision["taskUpdates"] as? [String: Any])
                let field = corruption == "unrequestedDue" ? "dueDate" : "pushCount"
                let value: Any = corruption == "unrequestedDue" ? "2030-01-01" : 999
                updates[field] = value
                decision["taskUpdates"] = updates
                if corruption == "unrequestedDue" {
                    var event = try XCTUnwrap(decision["event"] as? [String: Any])
                    var fields = try XCTUnwrap(event["fields"] as? [String: Any])
                    fields[field] = value
                    event["fields"] = fields
                    decision["event"] = event
                }
                witness["preparedDecision"] = decision
                forgedPrepared["witness"] = witness
                var effect = try XCTUnwrap(forgedPrepared["effect"] as? [String: Any])
                var rows = try XCTUnwrap(effect["tasks"] as? [[String: Any]])
                var after = try XCTUnwrap(rows[0]["after"] as? [String: Any])
                after[field] = value
                rows[0]["after"] = after
                effect["tasks"] = rows
                forgedPrepared["effect"] = effect
            }
            forgedEnvelope["prepared"] = forgedPrepared
            let forged = try json(["version": 2, "method": "inboxPreparedCommit",
                                   "argumentsJSON": json([json(forgedEnvelope)]),
                                   "terminal": ["success": ["_0": json(terminalResult)]]])
            try Data(forged.utf8).write(to: journal)
            let blockedFaults = HostIOFaults()
            var sql = 0, removals = 0
            blockedFaults.beforeSQL = { _ in sql += 1 }
            blockedFaults.journalRemove = { removals += 1 }
            let blocked = host(blockedFaults)
            await expectFailure { _ = try await blocked.start() }
            XCTAssertEqual(sql, 0)
            XCTAssertEqual(removals, 0)
            XCTAssertEqual(try Data(contentsOf: database), beforeDB)
            XCTAssertEqual(try Data(contentsOf: journal), Data(forged.utf8))
            await blocked.close()
        }
    }

    func testProcessInboxConversionRollsBackAllRowsThenRecoversExactlyOnce() async throws {
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let id = UUID().uuidString.lowercased()
        let unrelated = UUID().uuidString.lowercased()
        for (taskID, title) in [(id, "Plan studio opening"), (unrelated, "Unrelated Inbox capture")] {
            _ = try await core.call("mindSweepAdd", argumentsJSON: json([json(["requestId": taskID, "title": title])]))
        }
        let opened = try object(await core.call("inboxStart", argumentsJSON: json(["quick"])))
        let session = try XCTUnwrap(opened["sessionId"] as? String)
        var view = try XCTUnwrap(opened["view"] as? [String: Any])
        XCTAssertEqual(view["taskId"] as? String, id)
        for _ in 0..<2 {
            let flow = try object(await core.call("inboxCommit", argumentsJSON: json([json([
                "sessionId": session, "taskId": id, "step": try XCTUnwrap(view["step"] as? String),
                "decision": ["choice": "project"], "requestId": UUID().uuidString.lowercased(),
            ])])))
            XCTAssertEqual(flow["kind"] as? String, "flow")
            view = try XCTUnwrap((flow["result"] as? [String: Any])?["view"] as? [String: Any])
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        }
        XCTAssertEqual(view["step"] as? String, "file")
        let edits: [[String: Any]] = [["type": "set", "field": "nextAction", "value": "Call the building manager"],
                                      ["type": "setExtraActions", "value": ["Measure the room", "Order supplies"]]]
        for edit in edits {
            view = try object(await core.call("inboxStep", argumentsJSON: json([json([
                "sessionId": session, "taskId": id, "step": "file", "edit": edit,
            ])])))
        }
        let before = try json(storedTask(id))
        let unrelatedBefore = try json(storedTask(unrelated))
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected conversion COMMIT failure") } }
        await expectFailure("SAVE_FAILED") { _ = try await core.call("inboxCommit", argumentsJSON: json([json([
            "sessionId": session, "taskId": id, "step": "file", "decision": ["choice": "createProject"],
            "requestId": UUID().uuidString.lowercased(),
        ])])) }
        XCTAssertEqual(try taskCount(), 2)
        XCTAssertEqual(try json(storedTask(id)), before)
        let probe = try SQLiteBridge(url: database)
        let projectsBefore = try JSONSerialization.jsonObject(with: Data(probe.execute("SELECT id FROM projects").utf8)) as? [[String: Any]]
        probe.close()
        XCTAssertTrue(try XCTUnwrap(projectsBefore).isEmpty)
        await core.close()
        let restarted = host()
        let recovered = try object(await restarted.start())
        XCTAssertEqual((recovered["recovery"] as? [String: Any])?["method"] as? String, "inboxPreparedCommit")
        let original = try storedTask(id)
        let projectID = try XCTUnwrap(original["projectId"] as? String)
        XCTAssertEqual(original["title"] as? String, "Call the building manager")
        XCTAssertEqual(original["status"] as? String, "next")
        XCTAssertEqual(try taskCount(), 4)
        XCTAssertEqual(try json(storedTask(unrelated)), unrelatedBefore)
        let sqlite = try SQLiteBridge(url: database)
        let projectRows = try JSONSerialization.jsonObject(with: Data(sqlite.execute("SELECT * FROM projects WHERE id = ?", parametersJSON: json([projectID])).utf8)) as? [[String: Any]]
        let extraRows = try JSONSerialization.jsonObject(with: Data(sqlite.execute("SELECT * FROM tasks WHERE projectId = ? AND id != ? ORDER BY title", parametersJSON: json([projectID, id])).utf8)) as? [[String: Any]]
        sqlite.close()
        XCTAssertEqual(projectRows?.count, 1)
        XCTAssertEqual(projectRows?.first?["title"] as? String, "Plan studio opening")
        let extras = try XCTUnwrap(extraRows)
        XCTAssertEqual(extras.compactMap { $0["title"] as? String }, ["Measure the room", "Order supplies"])
        XCTAssertTrue(extras.allSatisfy { $0["status"] as? String == "inbox" })
        let settledRows = try json([original] + extras)
        await restarted.close()
        let secondRestart = host()
        let secondWindow = try object(await secondRestart.start())
        XCTAssertNil(secondWindow["recovery"])
        XCTAssertEqual(try taskCount(), 4)
        let settled = try [id] + extras.map { try XCTUnwrap($0["id"] as? String) }
        XCTAssertEqual(try json(settled.map { try storedTask($0) }), settledRows)
    }

    func testProcessInboxRecurringCompletionKeepsOneFollowUpAfterCleanupFailure() async throws {
        let seed = host()
        _ = try await seed.start()
        let id = UUID().uuidString.lowercased()
        _ = try await seed.call("mindSweepAdd", argumentsJSON: json([json(["requestId": id, "title": "Recurring Inbox item"])]))
        await seed.close()
        let fixture = try SQLiteBridge(url: database)
        let stamp = "2026-01-01T12:00:00.000Z"
        _ = try fixture.execute("UPDATE tasks SET recurrence = ?, dueDate = ?, checklist = ?, attachments = ? WHERE id = ?",
                                parametersJSON: json([json(["rule": "daily", "strategy": "strict", "count": 3, "seriesId": id]), "2036-10-02",
                                                      json([["id": "original-check", "title": "Reset this", "isCompleted": true]]),
                                                      json([["id": "original-file", "kind": "file", "title": "Keep file", "uri": "file:///process-inbox-kept.txt", "cloudKey": "test-shared-attachment", "createdAt": stamp, "updatedAt": stamp]]), id]))
        fixture.close()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let opened = try object(await core.call("inboxStart", argumentsJSON: json(["quick"])))
        let session = try XCTUnwrap(opened["sessionId"] as? String)
        let view = try XCTUnwrap(opened["view"] as? [String: Any])
        XCTAssertEqual(view["taskId"] as? String, id)
        faults.journalRemove = { throw HostFailure("Injected Process Inbox cleanup failure") }
        await expectFailure("cleanup failure") { _ = try await core.call("inboxCommit", argumentsJSON: json([json([
            "sessionId": session, "taskId": id, "step": try XCTUnwrap(view["step"] as? String),
            "decision": ["choice": "done"], "requestId": UUID().uuidString.lowercased(),
        ])])) }
        XCTAssertEqual(try taskCount(), 2)
        XCTAssertEqual(try storedTask(id)["status"] as? String, "done")
        let snapshot = { () throws -> String in
            let db = try SQLiteBridge(url: self.database)
            defer { db.close() }
            return try self.json(JSONSerialization.jsonObject(with: Data(db.execute("SELECT * FROM tasks ORDER BY id").utf8)))
        }
        let committed = try snapshot()
        let rows = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(committed.utf8)) as? [[String: Any]])
        let followUp = try XCTUnwrap(rows.first { $0["id"] as? String != id })
        XCTAssertEqual(followUp["dueDate"] as? String, "2036-10-03")
        XCTAssertEqual(followUp["status"] as? String, "inbox") // RN preserves the source actionable status.
        let checks = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(followUp["checklist"] as? String).utf8)) as? [[String: Any]])
        let attachments = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(followUp["attachments"] as? String).utf8)) as? [[String: Any]])
        XCTAssertNotEqual(checks.first?["id"] as? String, "original-check")
        XCTAssertEqual(checks.first?["isCompleted"] as? Bool, false)
        XCTAssertNotEqual(attachments.first?["id"] as? String, "original-file")
        XCTAssertEqual(attachments.first?["cloudKey"] as? String, "test-shared-attachment")
        await core.close()
        let retryFaults = HostIOFaults()
        var writes = 0
        retryFaults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+tasks\b"#, options: .regularExpression) != nil { writes += 1 }
        }
        let restarted = host(retryFaults)
        let restartedWindow = try object(await restarted.start())
        XCTAssertEqual((restartedWindow["recovery"] as? [String: Any])?["method"] as? String, "inboxPreparedCommit")
        XCTAssertEqual(try snapshot(), committed)
        XCTAssertEqual(writes, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testProcessInboxOversizedRequestRefusesBeforeJournal() async throws {
        let core = host()
        _ = try await core.start()
        let input = try json([json(["sessionId": "session", "taskId": "task", "step": "actionable",
                                  "requestId": UUID().uuidString.lowercased(), "decision": ["choice": String(repeating: "x", count: 20_000)]])])
        do {
            _ = try await core.call("inboxCommit", argumentsJSON: input)
            XCTFail("Expected definite no-write rejection")
        } catch is CoreHostRejection { }
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testProcessInboxReadFlowRetainsDraftAndNeverPersistsIt() async throws {
        let writer = host()
        _ = try await writer.start()
        let inboxID = UUID().uuidString.lowercased()
        let somedayID = UUID().uuidString.lowercased()
        for (id, title) in [(inboxID, "Clarify Inbox item"), (somedayID, "Review Someday item")] {
            let input = try json([json(["requestId": id, "title": title])])
            _ = try await writer.call("mindSweepAdd", argumentsJSON: input)
        }
        await writer.close()
        let fixture = try SQLiteBridge(url: database)
        _ = try fixture.execute("UPDATE tasks SET status = 'someday', reviewAt = ? WHERE id = ?",
                                parametersJSON: json(["2000-01-01", somedayID]))
        fixture.close()

        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let persisted = { () throws -> [String: String] in
            let sqlite = try SQLiteBridge(url: self.database)
            defer { sqlite.close() }
            var result: [String: String] = [:]
            for (table, query) in [
                ("tasks", "SELECT * FROM tasks ORDER BY id"),
                ("projects", "SELECT * FROM projects ORDER BY id"),
                ("settings", "SELECT * FROM settings ORDER BY id"),
            ] {
                let rows = try JSONSerialization.jsonObject(with: Data(sqlite.execute(query).utf8))
                result[table] = try self.json(rows)
            }
            return result
        }
        let before = try persisted()
        var writes = 0, readDiagnostics = 0
        faults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT|UPDATE|DELETE|REPLACE|BEGIN|COMMIT)\b"#, options: .regularExpression) != nil {
                writes += 1
            }
        }
        faults.commandDiagnostic = { if $0 == "processInboxRead" { readDiagnostics += 1 } }

        let opened = try object(await core.call("inboxStart", argumentsJSON: json(["guided"])))
        let session = try XCTUnwrap(opened["sessionId"] as? String)
        let queue = try XCTUnwrap(opened["queue"] as? [String: Any])
        XCTAssertEqual(queue["total"] as? Int, 2)
        XCTAssertEqual(Set(try XCTUnwrap(queue["taskIds"] as? [String])), Set([inboxID, somedayID]))
        let first = try XCTUnwrap(opened["view"] as? [String: Any])
        XCTAssertEqual(first["taskId"] as? String, inboxID)
        XCTAssertEqual(first["sessionId"] as? String, session)
        XCTAssertEqual(first["mode"] as? String, "guided")
        XCTAssertEqual((first["progress"] as? [String: Any])?["processed"] as? Int, 0)
        XCTAssertEqual((first["progress"] as? [String: Any])?["total"] as? Int, 2)
        let initialDraft = try XCTUnwrap(first["draft"] as? [String: Any])
        let step = try XCTUnwrap(first["step"] as? String)
        let edited = try object(await core.call("inboxStep", argumentsJSON: json([json([
            "sessionId": session, "taskId": inboxID, "step": step,
            "edit": ["type": "set", "field": "description", "value": "Unsaved clarification"],
        ])])))
        XCTAssertEqual((edited["draft"] as? [String: Any])?["description"] as? String, "Unsaved clarification")
        let quick = try object(await core.call("inboxStep", argumentsJSON: json([json([
            "sessionId": session, "taskId": inboxID, "step": step, "mode": "quick",
        ])])))
        XCTAssertEqual(quick["mode"] as? String, "quick")
        XCTAssertEqual(quick["taskId"] as? String, inboxID)
        XCTAssertEqual((quick["draft"] as? [String: Any])?["description"] as? String, "Unsaved clarification")
        let quickStep = try XCTUnwrap(quick["step"] as? String)
        let guided = try object(await core.call("inboxStep", argumentsJSON: json([json([
            "sessionId": session, "taskId": inboxID, "step": quickStep, "mode": "guided",
        ])])))
        XCTAssertEqual(guided["mode"] as? String, "guided")
        XCTAssertEqual((guided["draft"] as? [String: Any])?["description"] as? String, "Unsaved clarification")

        let ended = try object(await core.call("inboxEnd", argumentsJSON: json([session])))
        XCTAssertTrue(ended.isEmpty)
        await expectFailure("STALE_REVISION") { _ = try await core.call("inboxStep", argumentsJSON: json([json([
            "sessionId": session, "taskId": inboxID, "step": try XCTUnwrap(guided["step"] as? String),
        ])])) }
        let reopened = try object(await core.call("inboxStart", argumentsJSON: json(["guided"])))
        let fresh = try XCTUnwrap(reopened["view"] as? [String: Any])
        let freshSession = try XCTUnwrap(reopened["sessionId"] as? String)
        let freshStep = try XCTUnwrap(fresh["step"] as? String)
        XCTAssertEqual(fresh["taskId"] as? String, inboxID)
        XCTAssertEqual((fresh["draft"] as? [String: Any])?["description"] as? String,
                       initialDraft["description"] as? String)
        XCTAssertEqual(try storedTask(somedayID)["status"] as? String, "someday")
        XCTAssertEqual(readDiagnostics, 2)

        await expectFailure("INVALID_INPUT") { _ = try await core.call("inboxStart", argumentsJSON: json(["invalid"])) }
        await expectFailure("INVALID_INPUT") { _ = try await core.call("inboxStep", argumentsJSON: json([json([
            "sessionId": session, "taskId": inboxID, "step": step, "unexpected": true,
        ])])) }
        await expectFailure("INVALID_INPUT") { _ = try await core.call("inboxStep", argumentsJSON: json([json([
            "sessionId": session, "taskId": inboxID, "step": step,
            "edit": ["type": "set", "field": "description", "value": String(repeating: "x", count: 2_000_001)],
        ])])) }
        await expectFailure("INVALID_INPUT") { _ = try await core.call("inboxEnd", argumentsJSON: json([""])) }
        await expectFailure("INVALID_INPUT") { _ = try await core.call("inboxEnd", argumentsJSON: json([String(repeating: "x", count: 501)])) }
        await expectFailure("INVALID_INPUT") { _ = try await core.call("inboxStep", argumentsJSON: json([json([
            "sessionId": freshSession, "taskId": inboxID, "step": freshStep, "mode": "invalid",
        ])])) }
        for method in ["inboxCommit", "inboxSkip", "inboxAfterCommit"] {
            await expectFailure("INVALID_INPUT") { _ = try await core.call(method, argumentsJSON: json(["{} "])) }
        }
        for method in ["inboxCommitPrepare", "inboxSkipPrepare", "inboxPreparedCommit", "inboxPreparedValidate"] {
            await expectFailure("unavailable") { _ = try await core.call(method, argumentsJSON: json(["{} "])) }
        }
        XCTAssertEqual(writes, 0)
        XCTAssertEqual(try persisted(), before)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testProcessInboxReadFlowStopsBehindAnOwedJournal() async throws {
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let firstID = UUID().uuidString.lowercased()
        _ = try await core.call("mindSweepAdd", argumentsJSON: json([json([
            "requestId": firstID, "title": "Inbox session before pending save",
        ])]))
        let opened = try object(await core.call("inboxStart", argumentsJSON: json(["guided"])))
        let session = try XCTUnwrap(opened["sessionId"] as? String)
        let step = try XCTUnwrap((opened["view"] as? [String: Any])?["step"] as? String)
        var journalWrites = 0
        faults.journalWrite = {
            journalWrites += 1
            if journalWrites == 2 { throw HostFailure("Injected lost Mind Sweep reply") }
        }
        let secondID = UUID().uuidString.lowercased()
        await expectFailure("lost Mind Sweep reply") { _ = try await core.call("mindSweepAdd", argumentsJSON: json([json([
            "requestId": secondID, "title": "Still owed",
        ])])) }
        let owed = try Data(contentsOf: journal)
        await expectFailure("SAVE_FAILED") { _ = try await core.call("inboxStart", argumentsJSON: json(["quick"])) }
        await expectFailure("SAVE_FAILED") { _ = try await core.call("inboxStep", argumentsJSON: json([json([
            "sessionId": session, "taskId": firstID, "step": step,
        ])])) }
        await expectFailure("SAVE_FAILED") { _ = try await core.call("inboxEnd", argumentsJSON: json([session])) }
        XCTAssertEqual(try Data(contentsOf: journal), owed)
        let acknowledged = try await core.retryPending()
        XCTAssertEqual(try object(XCTUnwrap(acknowledged))["taskId"] as? String, secondID)
        let resumed = try object(await core.call("inboxStep", argumentsJSON: json([json([
            "sessionId": session, "taskId": firstID, "step": step,
        ])])))
        XCTAssertEqual(resumed["taskId"] as? String, firstID)
    }

    func testPreparedCalendarCreatePublishesProjectAndTaskAtomicallyAfterJournal() async throws {
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let request = try await calendarCreateInput(core, title: "Paint +Studio /due:2036-10-04")
        let id = try XCTUnwrap(request["requestId"] as? String)
        var taskWrites = 0, projectWrites = 0
        faults.beforeSQL = { sql in
            let taskWrite = sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+tasks\b"#, options: .regularExpression) != nil
            let projectWrite = sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+projects\b"#, options: .regularExpression) != nil
            if taskWrite || projectWrite {
                XCTAssertTrue(FileManager.default.fileExists(atPath: self.journal.path))
                if taskWrite { taskWrites += 1 }
                if projectWrite { projectWrites += 1 }
            }
        }
        let saved = try object(await core.call("calendarComposerSave", argumentsJSON: json([json(request)])))
        XCTAssertEqual(saved["changed"] as? Bool, true)
        XCTAssertEqual(saved["taskId"] as? String, id)
        XCTAssertEqual(taskWrites, 1); XCTAssertEqual(projectWrites, 1)
        let task = try storedTask(id)
        XCTAssertEqual(task["title"] as? String, "Paint")
        XCTAssertEqual(task["dueDate"] as? String, "2036-10-04")
        let projectID = try XCTUnwrap(task["projectId"] as? String)
        let sqlite = try SQLiteBridge(url: database)
        let projects = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(sqlite.execute("SELECT * FROM projects WHERE id = ?", parametersJSON: json([projectID])).utf8)) as? [[String: Any]])
        sqlite.close()
        XCTAssertEqual(projects.first?["title"] as? String, "Studio")
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        for name in ["calendarComposerCreatePrepare", "calendarComposerCreateValidate", "calendarComposerCreateCommit"] {
            await expectFailure("unavailable") { _ = try await core.call(name, argumentsJSON: json(["{} "])) }
        }
    }

    func testPreparedCalendarCreateLostReplyRecoversExactTaskOnce() async throws {
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let request = try await calendarCreateInput(core, title: "Review +Launch")
        let id = try XCTUnwrap(request["requestId"] as? String)
        var journalWrites = 0
        faults.journalWrite = { journalWrites += 1; if journalWrites == 2 { throw HostFailure("Injected Calendar create lost reply") } }
        await expectFailure("lost reply") { _ = try await core.call("calendarComposerSave", argumentsJSON: json([json(request)])) }
        let pending = try object(String(contentsOf: journal))
        XCTAssertEqual(pending["method"] as? String, "calendarComposerCreateCommit")
        XCTAssertNil(pending["terminal"])
        let written = try storedTask(id)
        await core.close()
        let replayFaults = HostIOFaults()
        var writes = 0
        replayFaults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:tasks|projects)\b"#, options: .regularExpression) != nil { writes += 1 }
        }
        let reopened = host(replayFaults)
        let window = try object(await reopened.start())
        let recovery = try XCTUnwrap(window["recovery"] as? [String: Any])
        XCTAssertEqual(recovery["method"] as? String, "calendarComposerCreateCommit")
        let result = try XCTUnwrap(recovery["result"] as? [String: Any])
        XCTAssertEqual(result["taskId"] as? String, id)
        XCTAssertEqual((result["next"] as? [String: Any])?["selectedDate"] as? String, "2036-10-03")
        XCTAssertEqual(writes, 0)
        XCTAssertEqual(try json(storedTask(id)), try json(written))
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testPreparedCalendarCreateFailedAtomicCommitRetriesOneTaskAndProject() async throws {
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let request = try await calendarCreateInput(core, title: "Call +Fresh Project")
        let id = try XCTUnwrap(request["requestId"] as? String)
        let beforeTasks = try taskCount()
        let readProjects = { () throws -> Int in
            let sqlite = try SQLiteBridge(url: self.database)
            defer { sqlite.close() }
            let rows = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(sqlite.execute("SELECT COUNT(*) AS count FROM projects", parametersJSON: "[]").utf8)) as? [[String: Any]])
            return try XCTUnwrap(rows.first?["count"] as? Int)
        }
        let beforeProjects = try readProjects()
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected Calendar create COMMIT failure") } }
        await expectFailure("SAVE_FAILED") { _ = try await core.call("calendarComposerSave", argumentsJSON: json([json(request)])) }
        XCTAssertEqual(try taskCount(), beforeTasks)
        XCTAssertEqual(try readProjects(), beforeProjects)
        XCTAssertEqual(try object(String(contentsOf: journal))["method"] as? String, "calendarComposerCreateCommit")
        faults.beforeSQL = nil
        let retried = try await core.retryPending()
        let reply = try XCTUnwrap(retried)
        XCTAssertEqual(try object(reply)["taskId"] as? String, id)
        XCTAssertEqual(try taskCount(), beforeTasks + 1)
        XCTAssertEqual(try readProjects(), beforeProjects + 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testPreparedCalendarCreateMalformedTerminalRetainsJournalBeforeSQLite() async throws {
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let request = try await calendarCreateInput(core, title: "Draft +Journal")
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected Calendar create COMMIT failure") } }
        await expectFailure("SAVE_FAILED") { _ = try await core.call("calendarComposerSave", argumentsJSON: json([json(request)])) }
        let pending = try object(String(contentsOf: journal))
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(pending["argumentsJSON"] as? String).utf8)) as? [String])
        var envelope = try object(XCTUnwrap(args.first))
        var prepared = try XCTUnwrap(envelope["prepared"] as? [String: Any])
        var intent = try XCTUnwrap(prepared["intent"] as? [String: Any])
        var props = try XCTUnwrap(intent["props"] as? [String: Any])
        var task = try XCTUnwrap(prepared["task"] as? [String: Any])
        props["dueDate"] = "not-a-date"
        props["reviewAt"] = "2026-02-30"
        intent["props"] = props
        prepared["intent"] = intent
        task["dueDate"] = props["dueDate"]
        task["reviewAt"] = props["reviewAt"]
        prepared["task"] = task
        envelope["prepared"] = prepared
        let terminal = try json(["version": 2, "method": "calendarComposerCreateCommit",
                                 "argumentsJSON": json([json(envelope)]),
                                 "terminal": ["success": ["_0": json(XCTUnwrap(prepared["result"]))]]])
        await core.close()
        try Data(terminal.utf8).write(to: journal)
        let beforeDB = try Data(contentsOf: database)
        let replayFaults = HostIOFaults()
        var sql = 0, removals = 0
        replayFaults.beforeSQL = { _ in sql += 1 }
        replayFaults.journalRemove = { removals += 1 }
        let reopened = host(replayFaults)
        await expectFailure { _ = try await reopened.start() }
        XCTAssertEqual(sql, 0); XCTAssertEqual(removals, 0)
        XCTAssertEqual(try Data(contentsOf: journal), Data(terminal.utf8))
        XCTAssertEqual(try Data(contentsOf: database), beforeDB)
    }

    func testPreparedCalendarExistingTaskJournalsBeforeSQLAndPreservesOtherRows() async throws {
        let id = try await seedBoardActionFixture()
        let coreFaults = HostIOFaults()
        let core = host(coreFaults)
        _ = try await core.start()
        let request = try await calendarScheduleInput(core, taskID: id)
        let before = try storedTask(id)
        let protected = try storedTask(id + "-protected")
        let settings = try calendarPreferenceSettings()
        var writes = 0
        coreFaults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+tasks\b"#, options: .regularExpression) != nil {
                writes += 1
                XCTAssertTrue(FileManager.default.fileExists(atPath: self.journal.path))
            }
        }
        let result = try object(await core.call("calendarComposerSave", argumentsJSON: json([json(request)])))
        XCTAssertEqual(result["changed"] as? Bool, true)
        XCTAssertEqual(result["taskId"] as? String, id)
        XCTAssertEqual((result["next"] as? [String: Any])?["viewMode"] as? String, "day")
        XCTAssertEqual(writes, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        let after = try storedTask(id)
        XCTAssertNotEqual(after["startTime"] as? String, before["startTime"] as? String)
        XCTAssertEqual(after["rev"] as? Int, (before["rev"] as? Int ?? 0) + 1)
        XCTAssertEqual(try datePreservedFields(after, excluding: ["startTime", "timeEstimate", "updatedAt", "rev", "revBy"]),
                       try datePreservedFields(before, excluding: ["startTime", "timeEstimate", "updatedAt", "rev", "revBy"]))
        XCTAssertEqual(try json(storedTask(id + "-protected")), try json(protected))
        XCTAssertEqual(try json(calendarPreferenceSettings()), try json(settings))
        for name in ["calendarComposerPrepare", "calendarComposerValidate", "calendarComposerCommit", "runCalendarAction"] {
            await expectFailure("unavailable") { _ = try await core.call(name, argumentsJSON: json(["{}"])) }
        }
        var invalid = request; invalid["mode"] = "new"
        await expectFailure("INVALID_INPUT") { _ = try await core.call("calendarComposerSave", argumentsJSON: json([json(invalid)])) }
        XCTAssertEqual(writes, 1)
    }

    func testPreparedCalendarLostReplyRestartsWithExactDayResultAndNoSecondTaskWrite() async throws {
        let id = try await seedBoardActionFixture()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let request = try await calendarScheduleInput(core, taskID: id)
        var journalWrites = 0
        faults.journalWrite = { journalWrites += 1; if journalWrites == 2 { throw HostFailure("Injected Calendar lost reply") } }
        await expectFailure("lost reply") { _ = try await core.call("calendarComposerSave", argumentsJSON: json([json(request)])) }
        let pending = try object(String(contentsOf: journal))
        XCTAssertEqual(pending["method"] as? String, "calendarComposerCommit")
        XCTAssertNil(pending["terminal"])
        let written = try storedTask(id)
        await core.close()
        let replayFaults = HostIOFaults()
        var writes = 0
        replayFaults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+tasks\b"#, options: .regularExpression) != nil { writes += 1 }
        }
        let reopened = host(replayFaults)
        let window = try object(await reopened.start())
        let recovery = try XCTUnwrap(window["recovery"] as? [String: Any])
        XCTAssertEqual(recovery["method"] as? String, "calendarComposerCommit")
        let result = try XCTUnwrap(recovery["result"] as? [String: Any])
        XCTAssertEqual(result["taskId"] as? String, id)
        XCTAssertEqual((result["next"] as? [String: Any])?["selectedDate"] as? String, "2036-10-03")
        XCTAssertEqual(writes, 0)
        XCTAssertEqual(try json(storedTask(id)), try json(written))
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testPreparedCalendarMalformedTerminalEnvelopeBlocksBeforeSQLite() async throws {
        let id = try await seedBoardActionFixture()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let request = try await calendarScheduleInput(core, taskID: id)
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected Calendar COMMIT failure") } }
        await expectFailure("SAVE_FAILED") { _ = try await core.call("calendarComposerSave", argumentsJSON: json([json(request)])) }
        let pending = try object(String(contentsOf: journal))
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(pending["argumentsJSON"] as? String).utf8)) as? [String])
        var envelope = try object(XCTUnwrap(args.first))
        var prepared = try XCTUnwrap(envelope["prepared"] as? [String: Any])
        var after = try XCTUnwrap(prepared["after"] as? [String: Any])
        after["description"] = "Forged Calendar journal"
        prepared["after"] = after
        envelope["prepared"] = prepared
        let terminal = try json(["version": 2, "method": "calendarComposerCommit",
                                 "argumentsJSON": json([json(envelope)]),
                                 "terminal": ["success": ["_0": json(XCTUnwrap(prepared["result"]))]]])
        await core.close()
        try Data(terminal.utf8).write(to: journal)
        let beforeDB = try Data(contentsOf: database)
        let replayFaults = HostIOFaults()
        var sql = 0, removals = 0
        replayFaults.beforeSQL = { _ in sql += 1 }
        replayFaults.journalRemove = { removals += 1 }
        let reopened = host(replayFaults)
        await expectFailure { _ = try await reopened.start() }
        XCTAssertEqual(sql, 0); XCTAssertEqual(removals, 0)
        XCTAssertEqual(try Data(contentsOf: journal), Data(terminal.utf8))
        XCTAssertEqual(try Data(contentsOf: database), beforeDB)
    }

    private func checklistItems(_ id: String) throws -> [[String: Any]] {
        let encoded = try XCTUnwrap(storedTask(id)["checklist"] as? String)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(encoded.utf8)) as? [[String: Any]])
    }

    private func checklistSaveRequest(_ id: String, opening: [String: Any], checklist: [[String: Any]], patch: [String: Any]) throws -> [String: Any] {
        let draft = try XCTUnwrap(opening["draft"] as? [String: Any])
        let base = Dictionary(uniqueKeysWithValues: patch.keys.map { ($0, draft[$0] ?? NSNull()) })
        return ["id": id, "requestId": UUID().uuidString.lowercased(), "base": base, "patch": patch,
                "scheduleBase": try XCTUnwrap(opening["scheduleBase"]),
                "checklist": ["base": try checklistItems(id), "value": checklist]]
    }

    func testChecklistCombinedSaveRecurrenceLostAcknowledgmentReplaysOneEffect() async throws {
        let id = try await seedDestinationTask()
        let fixture = try SQLiteBridge(url: database)
        _ = try fixture.execute("UPDATE tasks SET taskMode = 'list', createdAt = '2026-09-01T12:00:00.000Z', updatedAt = '2026-09-01T12:00:00.000Z', recurrence = ? WHERE id = ?",
                                parametersJSON: json([json(["rule": "daily", "strategy": "strict", "count": 3, "seriesId": id]), id]))
        fixture.close()
        let faults = HostIOFaults()
        let core = host(faults, bundleURL: try dateBundle(at: "2026-09-27T12:00:00.000Z"))
        _ = try await core.start()
        let opening = try object(await core.call("editorModel", argumentsJSON: json([id])))
        let edited = try object(await core.call("checklistEdit", argumentsJSON: json([json([
            "id": id, "draft": try XCTUnwrap(opening["draft"]), "checklist": try checklistItems(id),
            "edit": ["kind": "toggle", "index": 0],
        ])])))
        XCTAssertEqual((edited["draft"] as? [String: Any])?["status"] as? String, "done")
        let checklist = try XCTUnwrap(edited["checklist"] as? [[String: Any]])
        let request = try checklistSaveRequest(id, opening: opening, checklist: checklist,
                                               patch: ["status": "done", "description": "Checklist and date saved together", "dueDate": "2036-10-03"])
        let before = try storedTask(id)
        let count = try taskCount()
        var writes = 0
        faults.journalWrite = {
            writes += 1
            if writes == 2 { throw HostFailure("Injected checklist lost acknowledgment") }
        }
        await expectFailure("lost acknowledgment") { _ = try await core.call("checklistSave", argumentsJSON: json([json(request)])) }
        XCTAssertEqual(try taskCount(), count + 1)
        let completed = try storedTask(id)
        XCTAssertEqual(completed["status"] as? String, "done")
        XCTAssertEqual(completed["dueDate"] as? String, "2036-10-03")
        XCTAssertEqual(completed["description"] as? String, "Checklist and date saved together")
        XCTAssertEqual(try checklistItems(id).first?["isCompleted"] as? Bool, true)
        XCTAssertEqual(completed["rev"] as? Int, (before["rev"] as? Int ?? 0) + 1)
        let saved = try object(String(contentsOf: journal))
        XCTAssertEqual(saved["method"] as? String, "checklistPreparedCommit")
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(saved["argumentsJSON"] as? String).utf8)) as? [String])
        let envelope = try object(XCTUnwrap(args.first))
        XCTAssertEqual((envelope["prepared"] as? [String: Any])?["kind"] as? String, "save")
        XCTAssertEqual(try json(XCTUnwrap(envelope["request"])), try json(request))
        func snapshot() throws -> [String] {
            let rows = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(calendarPreferenceTasks().utf8)) as? [[String: Any]])
            // SQLite JSON columns may reorder object keys during activation;
            // every value, array position, scalar date, ID and stamp stays exact.
            return try rows.map { try datePreservedFields(object(recurrenceComparableRow($0)), excluding: []) }
        }
        let savedTasks = try snapshot()
        await core.close()
        let restartBundle = try dateBundle(at: "2026-09-29T12:00:00.000Z", suffix: """
        MindwtrHost.checklistSavePrepare = function () { throw new Error('Replay must not prepare checklist'); };
        """)
        let restartFaults = HostIOFaults()
        restartFaults.journalRemove = { throw HostFailure("Injected checklist cleanup loss") }
        let restarted = host(restartFaults, bundleURL: restartBundle)
        await expectFailure("cleanup loss") { _ = try await restarted.start() }
        XCTAssertEqual(try taskCount(), count + 1)
        XCTAssertEqual(try snapshot(), savedTasks)
        restartFaults.journalRemove = nil
        let window = try object(await restarted.start())
        let recovery = try XCTUnwrap(window["recovery"] as? [String: Any])
        XCTAssertEqual(recovery["method"] as? String, "checklistPreparedCommit")
        XCTAssertEqual((recovery["result"] as? [String: Any])?["id"] as? String, id)
        XCTAssertEqual(try taskCount(), count + 1)
        XCTAssertEqual(try snapshot(), savedTasks)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        let subsequentWindow = try object(await restarted.start())
        XCTAssertNil(subsequentWindow["recovery"])
    }

    func testChecklistResetNonemptySavedListRetriesFailedCommitAndEmptyListSkipsJournal() async throws {
        let id = try await seedDestinationTask()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let before = try storedTask(id)
        let base = try checklistItems(id)
        let request: [String: Any] = ["id": id, "requestId": UUID().uuidString.lowercased(), "checklistBase": base]
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected checklist COMMIT failure") } }
        await expectFailure("SAVE_FAILED") { _ = try await core.call("checklistReset", argumentsJSON: json([json(request)])) }
        XCTAssertEqual(try json(storedTask(id)), try json(before))
        XCTAssertEqual(try object(String(contentsOf: journal))["method"] as? String, "checklistPreparedCommit")
        faults.beforeSQL = nil
        let retried = try await core.retryPending()
        let response = try object(XCTUnwrap(retried))
        XCTAssertEqual(response["id"] as? String, id)
        XCTAssertEqual(try json(XCTUnwrap(response["checklistBase"])), try json(base))
        XCTAssertEqual(try storedTask(id)["rev"] as? Int, (before["rev"] as? Int ?? 0) + 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        await core.close()
        let sqlite = try SQLiteBridge(url: database)
        _ = try sqlite.execute("UPDATE tasks SET checklist = '[]', rev = rev + 1 WHERE id = ?", parametersJSON: json([id]))
        sqlite.close()
        let empty = try storedTask(id)
        let reopened = host()
        _ = try await reopened.start()
        let noWrite = try object(await reopened.call("checklistReset", argumentsJSON: json([json([
            "id": id, "requestId": UUID().uuidString.lowercased(), "checklistBase": [[String: Any]](),
        ])])))
        XCTAssertEqual(noWrite["id"] as? String, id)
        XCTAssertEqual(try json(XCTUnwrap(noWrite["checklistBase"])), "[]")
        XCTAssertEqual(try json(storedTask(id)), try json(empty))
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testChecklistForgedTerminalAndOversizedJournalRefuseBeforeSQLite() async throws {
        let id = try await seedDestinationTask()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let request: [String: Any] = ["id": id, "requestId": UUID().uuidString.lowercased(), "checklistBase": try checklistItems(id)]
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected checklist COMMIT failure") } }
        await expectFailure("SAVE_FAILED") { _ = try await core.call("checklistReset", argumentsJSON: json([json(request)])) }
        let pending = try object(String(contentsOf: journal))
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(pending["argumentsJSON"] as? String).utf8)) as? [String])
        var envelope = try object(XCTUnwrap(args.first))
        var prepared = try XCTUnwrap(envelope["prepared"] as? [String: Any])
        let result = try XCTUnwrap(prepared["result"] as? [String: Any])
        await core.close()
        let mainBefore = try Data(contentsOf: database)
        for corruption in ["prepared", "terminal", "oversized", "raw"] {
            let forged: String
            switch corruption {
            case "prepared":
                prepared["unexpected"] = true
                envelope["prepared"] = prepared
                forged = try json(["version": 2, "method": "checklistPreparedCommit", "argumentsJSON": json([json(envelope)]),
                                   "terminal": ["success": ["_0": json(result)]]])
            case "terminal":
                var wrong = result; wrong["unexpected"] = true
                forged = try json(["version": 2, "method": "checklistPreparedCommit", "argumentsJSON": try XCTUnwrap(pending["argumentsJSON"] as? String),
                                   "terminal": ["success": ["_0": json(wrong)]]])
            case "oversized":
                forged = try json(["version": 2, "method": "checklistPreparedCommit", "argumentsJSON": json([String(repeating: "x", count: 2_000_001)])])
            default:
                forged = try json(["version": 2, "method": "checklistReset", "argumentsJSON": json([json(request)])])
            }
            try Data(forged.utf8).write(to: journal)
            let blockedFaults = HostIOFaults()
            var statements = 0, removals = 0
            blockedFaults.beforeSQL = { _ in statements += 1 }
            blockedFaults.journalRemove = { removals += 1 }
            let blocked = host(blockedFaults)
            await expectFailure { _ = try await blocked.start() }
            XCTAssertEqual(statements, 0); XCTAssertEqual(removals, 0)
            XCTAssertEqual(try Data(contentsOf: database), mainBefore)
            XCTAssertEqual(try Data(contentsOf: journal), Data(forged.utf8))
            await blocked.close()
        }
    }

    private func projectRows(_ id: String? = nil) throws -> [[String: Any]] {
        let sqlite = try SQLiteBridge(url: database)
        defer { sqlite.close() }
        let query = id == nil ? "SELECT * FROM projects" : "SELECT * FROM projects WHERE id = ?"
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(sqlite.execute(query, parametersJSON: json(id.map { [$0] } ?? [])).utf8)) as? [[String: Any]])
    }

    private func projectSectionRows(_ id: String? = nil) throws -> [[String: Any]] {
        let sqlite = try SQLiteBridge(url: database)
        defer { sqlite.close() }
        let query = id == nil ? "SELECT * FROM sections" : "SELECT * FROM sections WHERE id = ?"
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(sqlite.execute(query, parametersJSON: json(id.map { [$0] } ?? [])).utf8)) as? [[String: Any]])
    }

    private func areaRows(_ id: String? = nil) throws -> [[String: Any]] {
        let sqlite = try SQLiteBridge(url: database)
        defer { sqlite.close() }
        let query = id == nil ? "SELECT * FROM areas" : "SELECT * FROM areas WHERE id = ?"
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(sqlite.execute(query, parametersJSON: json(id.map { [$0] } ?? [])).utf8)) as? [[String: Any]])
    }

    private func areaCreateRequest(_ requestID: String = UUID().uuidString.lowercased(), name: String,
                                   color: String = "#3b82f6", expectedID: String? = nil) -> [String: Any] {
        ["requestId": requestID, "name": name, "color": color, "expectedAreaId": expectedID ?? requestID]
    }

    private func projectAddAreaCreateRequest(_ core: CoreHost, name: String,
                                             color: String = "#3b82f6") async throws -> [String: Any] {
        let requestID = UUID().uuidString.lowercased()
        let resolution = try object(await core.call("areaCreateResolve",
                                                   argumentsJSON: json([json(["requestId": requestID, "name": name])])))
        XCTAssertEqual(resolution["taken"] as? Bool, false)
        let expectedID = try XCTUnwrap(resolution["expectedAreaId"] as? String)
        XCTAssertEqual(expectedID, requestID)
        return areaCreateRequest(requestID, name: name, color: color, expectedID: expectedID)
    }

    private func seedAreaColorRows() async throws {
        let bootstrap = host()
        _ = try await bootstrap.start()
        await bootstrap.close()
        let at = recentAreaTestTime()
        let sqlite = try SQLiteBridge(url: database)
        _ = try sqlite.execute("INSERT INTO areas (id, name, color, orderNum, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["color-area", "Work", "#22c55e", 0, at, at, 2]))
        _ = try sqlite.execute("INSERT INTO areas (id, name, orderNum, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["other-area", "Other", 1, at, at, 1]))
        for (id, area, color, title, deleted) in [
            ("color-live", "color-area", "#22c55e", "Work", false),
            ("color-deleted", "color-area", "#ef4444", "Legacy title", true),
            ("color-other", "other-area", "#22c55e", "Other", false),
        ] {
            _ = try sqlite.execute("INSERT INTO projects (id, title, status, color, areaId, areaTitle, orderNum, isSequential, isFocused, createdAt, updatedAt, deletedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json([id, id, "active", color, area, title, 0, 0, 0, at, at, deleted ? at as Any : NSNull(), 3]))
        }
        sqlite.close()
    }

    private func areaColorRequest(_ core: CoreHost, color: Any,
                                  requestID: String = UUID().uuidString.lowercased()) async throws -> [String: Any] {
        let options = try object(await core.call("areaColorOptions"))
        let rows = try XCTUnwrap(options["areas"] as? [[String: Any]])
        let row = try XCTUnwrap(rows.first { $0["id"] as? String == "color-area" })
        return ["requestId": requestID, "areaId": "color-area", "color": color,
                "expected": row.filter { $0.key != "id" }]
    }

    private func areaColorTableSnapshot(_ sqlite: SQLiteBridge) throws -> [String] {
        try ["areas", "projects", "sections", "tasks", "settings"].map { table in
            let raw = try sqlite.execute("SELECT * FROM \(table) ORDER BY id")
            return try json(JSONSerialization.jsonObject(with: Data(raw.utf8)))
        }
    }

    private func seedAreaRenameRows() async throws {
        let bootstrap = host()
        _ = try await bootstrap.start()
        await bootstrap.close()
        let at = recentAreaTestTime()
        let sourceName = "Source \u{FEFF}e\u{301}"
        let destinationName = "m\u{FEFF}erge e\u{301}"
        let sqlite = try SQLiteBridge(url: database)
        for (id, name, color, icon, order, rev) in [
            ("rename-source", sourceName, "#22c55e", "briefcase", 0, 4),
            ("rename-destination", destinationName, "#ef4444", "target", 1, 7),
            ("rename-other", "Other", "#22c55e", "circle", 2, 3),
        ] {
            _ = try sqlite.execute("INSERT INTO areas (id, name, color, icon, orderNum, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json([id, name, color, icon, order, at, at, rev]))
        }
        for (id, areaID, areaTitle, color, deleted, rev) in [
            ("rename-source-live", "rename-source", sourceName, "#22c55e", false, 11),
            ("rename-source-deleted", "rename-source", sourceName, "#22c55e", true, 12),
            ("rename-destination-live", "rename-destination", destinationName, "#ef4444", false, 13),
            ("rename-destination-deleted", "rename-destination", destinationName, "#ef4444", true, 14),
            ("rename-destination-current", "rename-destination", destinationName, "#ef4444", false, 15),
            ("rename-unrelated", "rename-other", "Other", "#22c55e", false, 16),
        ] {
            let attachments = try json([[
                "id": "\(id)-file", "kind": "file", "title": "Keep project attachment",
                "uri": "file:///\(id).txt", "mimeType": "text/plain", "size": 17,
                "createdAt": at, "updatedAt": at, "cloudKey": "attachments/\(id).txt",
                "fileHash": String(repeating: "a", count: 64), "contentRev": 2,
                "contentMtimeMs": 1_700_000_000_000, "contentSize": 17,
            ] as [String: Any]])
            _ = try sqlite.execute("INSERT INTO projects (id, title, status, color, orderNum, tagIds, isSequential, sequentialScope, taskSortBy, isFocused, supportNotes, attachments, dueDate, reviewAt, areaId, areaTitle, createdAt, updatedAt, deletedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json([id, "Project \(id)", "active", color, 9, "[\"keep-tag\"]", 1, "project", "title", 1, "Keep **notes**", attachments, "2036-10-02", "2036-10-03T12:00:00.000Z", areaID, areaTitle, at, at, deleted ? at as Any : NSNull(), rev]))
        }
        _ = try sqlite.execute("INSERT INTO sections (id, projectId, title, orderNum, isCollapsed, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["rename-section", "rename-source-live", "Keep section", 4, 1, at, at, 21]))
        let checklist = #"[{"id":"rename-step","title":"Keep checklist","isCompleted":false}]"#
        for (id, areaID, projectID, sectionID, deleted, rev) in [
            ("rename-direct", "rename-source" as Any, NSNull() as Any, NSNull() as Any, false, 22),
            ("rename-direct-deleted", "rename-source" as Any, NSNull() as Any, NSNull() as Any, true, 23),
            ("rename-dual", NSNull() as Any, "rename-source-live" as Any, "rename-section" as Any, false, 24),
            ("rename-nested", NSNull() as Any, "rename-source-live" as Any, "rename-section" as Any, false, 25),
            ("rename-unrelated-task", "rename-other" as Any, NSNull() as Any, NSNull() as Any, false, 26),
        ] {
            let attachments = try json([[
                "id": "\(id)-file", "kind": "file", "title": "Keep task attachment",
                "uri": "file:///\(id).txt", "mimeType": "text/plain", "size": 19,
                "createdAt": at, "updatedAt": at, "cloudKey": "attachments/\(id).txt",
                "fileHash": String(repeating: "b", count: 64), "contentRev": 3,
                "contentMtimeMs": 1_700_000_000_000, "contentSize": 19,
            ] as [String: Any]])
            _ = try sqlite.execute("INSERT INTO tasks (id, title, status, priority, energyLevel, startTime, dueDate, tags, contexts, checklist, description, attachments, projectId, sectionId, areaId, orderNum, boardOrder, focusOrder, isFocusedToday, timeEstimate, timeSpentMinutes, showFutureRecurrence, suppressMindwtrReminders, pushCount, createdAt, updatedAt, deletedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json([id, "Task \(id)", "next", "high", "low", at, "2036-10-02", "[\"#keep\"]", "[\"@desk\"]", checklist, "Keep task details", attachments, projectID, sectionID, areaID, 8, 7, 6, 1, "15min", 5, 0, 0, 2, at, at, deleted ? at as Any : NSNull(), rev]))
        }
        sqlite.close()
        // Persist through the real reader/writer once so recoveryLoad sees the same
        // canonical SQL rows that the ordinary host used to freeze its prepared scope.
        // Recoloring the unrelated Area gives this fixture a real write without using
        // Area rename itself, and leaves its Area/Project relationship canonical.
        let canonicalizer = host()
        _ = try await canonicalizer.start()
        let colorOptions = try object(await canonicalizer.call("areaColorOptions"))
        let colorRows = try XCTUnwrap(colorOptions["areas"] as? [[String: Any]])
        let other = try XCTUnwrap(colorRows.first { $0["id"] as? String == "rename-other" })
        let colorRequest: [String: Any] = [
            "requestId": UUID().uuidString.lowercased(), "areaId": "rename-other", "color": "#3b82f6",
            "expected": other.filter { $0.key != "id" },
        ]
        _ = try await canonicalizer.call("areaColor", argumentsJSON: json([json(colorRequest)]))
        await canonicalizer.close()
    }

    private func areaRenameRequest(_ core: CoreHost, areaID: String = "rename-source", name: String,
                                   requestID: String = UUID().uuidString.lowercased()) async throws -> [String: Any] {
        let options = try object(await core.call("areaOrderOptions"))
        let rows = try XCTUnwrap(options["areas"] as? [[String: Any]])
        let expected = try XCTUnwrap(rows.first { $0["id"] as? String == areaID })
        return ["requestId": requestID, "areaId": areaID, "name": name, "expected": expected]
    }

    private func nineTableSnapshot(_ sqlite: SQLiteBridge) throws -> [String] {
        try ["tasks", "projects", "areas", "people", "sections", "settings", "saved_filters", "schema_migrations", "calendar_sync"].map { table in
            let raw = try sqlite.execute("SELECT * FROM \(table) ORDER BY rowid")
            return try json(JSONSerialization.jsonObject(with: Data(raw.utf8)))
        }
    }

    private func seedAreaOrderRows() async throws {
        let bootstrap = host()
        _ = try await bootstrap.start()
        await bootstrap.close()
        let at = recentAreaTestTime()
        let sqlite = try SQLiteBridge(url: database)
        for (id, name, color, order, rev, deleted) in [
            ("order-a", "Zulu", "#ef4444", 2, 3, false),
            ("order-b", "Alpha", "#22c55e", 0, 4, false),
            ("order-c", "Beta", "#3b82f6", 1, 5, false),
            ("order-deleted", "Old", "#111111", 3, 6, true),
        ] {
            _ = try sqlite.execute("INSERT INTO areas (id, name, color, orderNum, createdAt, updatedAt, deletedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json([id, name, color, order, at, at, deleted ? at as Any : NSNull(), rev]))
        }
        sqlite.close()
        let projectWriter = host()
        _ = try await projectWriter.start()
        let project = projectCreateRequest(title: "Keep", areaId: "order-b")
        _ = try await projectWriter.call("projectCreate", argumentsJSON: json([json(project)]))
        await projectWriter.close()
    }

    private func areaOrderRequest(_ core: CoreHost, intent: [String: Any]) async throws -> [String: Any] {
        let options = try object(await core.call("areaOrderOptions"))
        return ["requestId": UUID().uuidString.lowercased(), "intent": intent,
                "expectedAreas": try XCTUnwrap(options["areas"] as? [[String: Any]])]
    }

    private func seedAreaDeleteRows() async throws {
        let bootstrap = host()
        _ = try await bootstrap.start()
        await bootstrap.close()
        let at = recentAreaTestTime()
        let sqlite = try SQLiteBridge(url: database)
        _ = try sqlite.execute("INSERT INTO areas (id, name, color, orderNum, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["delete-area", "Work", "#22c55e", 0, at, at, 2]))
        _ = try sqlite.execute("INSERT INTO areas (id, name, color, orderNum, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["delete-other", "Other", "#3b82f6", 1, at, at, 3]))
        _ = try sqlite.execute("INSERT INTO projects (id, title, status, color, areaId, areaTitle, orderNum, isSequential, isFocused, createdAt, updatedAt, deletedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["delete-old-project", "Removed", "archived", "#22c55e", "delete-area", "Work", 0, 0, 0, at, at, at, 7]))
        _ = try sqlite.execute("INSERT INTO projects (id, title, status, color, areaId, areaTitle, orderNum, isSequential, isFocused, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["delete-other-project", "Keep", "active", "#3b82f6", "delete-other", "Other", 0, 0, 0, at, at, 8]))
        _ = try sqlite.execute("INSERT INTO sections (id, projectId, title, orderNum, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["delete-section", "delete-other-project", "Plan", 0, at, at, 9]))
        let checklist = #"[{"id":"delete-step","title":"Keep checklist","isCompleted":false}]"#
        let attachments = """
        [{"id":"delete-file","kind":"file","title":"Keep attachment","uri":"file:///retained.txt","createdAt":"\(at)","updatedAt":"\(at)"}]
        """
        for (id, area, project, section, deleted, rev) in [
            ("delete-direct", "delete-area", NSNull() as Any, NSNull() as Any, false, 4),
            ("delete-trashed", "delete-area", NSNull() as Any, NSNull() as Any, true, 5),
            ("delete-unrelated", "delete-other", NSNull() as Any, NSNull() as Any, false, 6),
            ("delete-nested", NSNull() as Any, "delete-other-project" as Any, "delete-section" as Any, false, 10),
        ] {
            _ = try sqlite.execute("INSERT INTO tasks (id, title, status, areaId, projectId, sectionId, description, dueDate, checklist, attachments, tags, contexts, priority, orderNum, isFocusedToday, showFutureRecurrence, suppressMindwtrReminders, pushCount, createdAt, updatedAt, deletedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json([id, id, "next", area, project, section, "Keep **details**", "2036-10-02", checklist, attachments, "[\"#keep\"]", "[\"@desk\"]", "high", 3, 0, 0, 0, 0, at, at, deleted ? at as Any : NSNull(), rev]))
        }
        sqlite.close()
        // Establish the adapter's canonical SQL TEXT before testing a later Area-only mutation.
        let normalizer = host()
        _ = try await normalizer.start()
        let order = try await areaOrderRequest(normalizer, intent: ["kind": "sortName"])
        _ = try await normalizer.call("areaOrder", argumentsJSON: json([json(order)]))
        await normalizer.close()
    }

    private func areaDeleteRequest(_ core: CoreHost, areaID: String = "delete-area") async throws -> [String: Any] {
        let options = try object(await core.call("areaDeleteOptions"))
        let rows = try XCTUnwrap(options["areas"] as? [[String: Any]])
        let row = try XCTUnwrap(rows.first { $0["id"] as? String == areaID })
        return ["requestId": UUID().uuidString.lowercased(), "areaId": areaID,
                "expected": row.filter { !["id", "projectCount", "canDelete"].contains($0.key) }]
    }

    private func seedProjectFocusRows(focusedOthers: Int = 1, targetStatus: String = "active",
                                      targetFocused: Bool = false, targetDeleted: Bool = false) async throws {
        let bootstrap = host()
        _ = try await bootstrap.start()
        await bootstrap.close()
        let at = recentAreaTestTime()
        let attachments = """
        [{"id":"focus-file","kind":"file","title":"Keep attachment","uri":"file:///retained.txt","createdAt":"\(at)","updatedAt":"\(at)"}]
        """
        let sqlite = try SQLiteBridge(url: database)
        var rows: [(String, String, Bool, Bool)] = [
            ("focus-target", targetStatus, targetFocused, targetDeleted),
            ("focus-deleted", "active", true, true),
        ]
        for index in 0..<focusedOthers {
            rows.append(("focus-other-\(index)", ["active", "someday", "waiting"][index % 3], true, false))
        }
        for index in 0..<4 { rows.append(("focus-spare-\(index)", "active", false, false)) }
        for (id, status, focused, deleted) in rows {
            let target = id == "focus-target"
            _ = try sqlite.execute("INSERT INTO projects (id, title, status, color, orderNum, tagIds, isSequential, isFocused, supportNotes, attachments, dueDate, createdAt, updatedAt, deletedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json([id, target ? "Target" : id, status, "#3b82f6", 3,
                                                         target ? "[\"#keep\"]" : "[]", 0, focused ? 1 : 0,
                                                         target ? "Keep **notes**" as Any : NSNull(),
                                                         target ? attachments as Any : NSNull(),
                                                         target ? "2036-10-02" as Any : NSNull(), at, at,
                                                         deleted ? at as Any : NSNull(), target ? 3 : 1]))
        }
        sqlite.close()
        // Canonicalize the seeded SQL rows before a later prepared write or cold replay.
        let normalizer = host()
        _ = try await normalizer.start()
        _ = try await normalizer.call("projectCreate", argumentsJSON: json([json(projectCreateRequest(title: "Canonical sibling"))]))
        await normalizer.close()
    }

    private func seedProjectRenameRows(targetStatus: String = "active", targetDeleted: Bool = false,
                                       storedTitle: String = "Target") async throws {
        try await seedProjectFocusRows(targetStatus: targetStatus, targetDeleted: targetDeleted)
        let at = recentAreaTestTime()
        let sqlite = try SQLiteBridge(url: database)
        _ = try sqlite.execute("UPDATE projects SET title = ? WHERE id = 'focus-target'", parametersJSON: json([storedTitle]))
        _ = try sqlite.execute("INSERT INTO areas (id, name, color, orderNum, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["rename-area", "Keep Area", "#22c55e", 0, at, at, 2]))
        _ = try sqlite.execute("INSERT INTO sections (id, projectId, title, orderNum, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["rename-section", "focus-target", "Keep Section", 0, at, at, 2]))
        let checklist = #"[{"id":"rename-step","title":"Keep checklist","isCompleted":false}]"#
        let attachments = """
        [{"id":"rename-file","kind":"file","title":"Keep attachment","uri":"file:///retained.txt","createdAt":"\(at)","updatedAt":"\(at)"}]
        """
        for (id, project, section) in [
            ("rename-task", "focus-target", "rename-section"),
            ("rename-unrelated-task", "focus-other-0", ""),
        ] {
            _ = try sqlite.execute("INSERT INTO tasks (id, title, status, projectId, sectionId, description, dueDate, checklist, attachments, tags, contexts, priority, orderNum, isFocusedToday, showFutureRecurrence, suppressMindwtrReminders, pushCount, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json([id, id, "next", project, section.isEmpty ? NSNull() as Any : section as Any,
                                                         "Keep **details**", "2036-10-02", checklist, attachments,
                                                         "[\"#keep\"]", "[\"@desk\"]", "high", 3, 0, 0, 0, 0, at, at, 3]))
        }
        sqlite.close()
        // Persist the adapter's canonical rich SQL TEXT before testing a title-only write.
        let normalizer = host()
        _ = try await normalizer.start()
        _ = try await normalizer.call("projectCreate", argumentsJSON: json([json(projectCreateRequest(title: "Rename sibling"))]))
        await normalizer.close()
    }

    private func projectRenameRequest(_ core: CoreHost, title: String,
                                      projectID: String = "focus-target") async throws -> [String: Any] {
        let options = try object(await core.call("projectRenameOptions", argumentsJSON: json([json(["projectId": projectID])])))
        let project = try XCTUnwrap(options["project"] as? [String: Any])
        return ["requestId": UUID().uuidString.lowercased(), "projectId": projectID, "title": title,
                "expected": project.filter { $0.key != "id" }]
    }

    private func seedProjectFlowRows(status: String = "active", sequential: Any = 0,
                                     scope: Any = NSNull()) async throws {
        try await seedProjectRenameRows(targetStatus: status)
        let sqlite = try SQLiteBridge(url: database)
        _ = try sqlite.execute("UPDATE projects SET isSequential = ?, sequentialScope = ?, updatedAt = ?, rev = rev + 1 WHERE id = 'focus-target'",
                               parametersJSON: json([sequential, scope, recentAreaTestTime(daysAgo: 0)]))
        sqlite.close()
    }

    private func projectFlowRequest(_ core: CoreHost, action: [String: Any],
                                    projectID: String = "focus-target") async throws -> [String: Any] {
        let options = try object(await core.call("projectFlowOptions", argumentsJSON: json([json(["projectId": projectID])])))
        let project = try XCTUnwrap(options["project"] as? [String: Any])
        return ["requestId": UUID().uuidString.lowercased(), "projectId": projectID, "action": action,
                "expected": project.filter { $0.key != "id" }]
    }

    private func projectTaskSortRequest(_ core: CoreHost, sortBy: String,
                                        projectID: String = "focus-target") async throws -> [String: Any] {
        let options = try object(await core.call("projectTaskSortOptions", argumentsJSON: json([json(["projectId": projectID])])))
        let project = try XCTUnwrap(options["project"] as? [String: Any])
        return ["requestId": UUID().uuidString.lowercased(), "projectId": projectID, "sortBy": sortBy,
                "expected": project.filter { $0.key != "id" }]
    }

    private func projectNotesWriteRequest(_ core: CoreHost, text: String,
                                          projectID: String = "focus-target") async throws -> [String: Any] {
        let options = try object(await core.call("projectNotesEditOptions", argumentsJSON: json([json(["projectId": projectID])])))
        let project = try XCTUnwrap(options["project"] as? [String: Any])
        return ["requestId": UUID().uuidString.lowercased(), "projectId": projectID, "text": text,
                "expected": project.filter { $0.key != "id" }]
    }

    private func projectTagsRequest(_ core: CoreHost, intent: [String: Any],
                                    projectID: String = "focus-target") async throws -> [String: Any] {
        let options = try object(await core.call("projectTagsEditOptions", argumentsJSON: json([projectID])))
        let project = try XCTUnwrap(options["project"] as? [String: Any])
        return ["requestId": UUID().uuidString.lowercased(), "projectId": projectID, "intent": intent,
                "expected": project.filter { $0.key != "id" }]
    }

    private func projectStatusRequest(_ core: CoreHost, status: String,
                                      projectID: String = "focus-target") async throws -> [String: Any] {
        let options = try object(await core.call("projectStatusOptions", argumentsJSON: json([json(["projectId": projectID])])))
        let project = try XCTUnwrap(options["project"] as? [String: Any])
        return ["requestId": UUID().uuidString.lowercased(), "projectId": projectID, "status": status,
                "expected": project.filter { $0.key != "id" }]
    }

    private func projectDateRequest(_ core: CoreHost, field: String, value: Any,
                                    projectID: String = "focus-target") async throws -> [String: Any] {
        let options = try object(await core.call("projectDateOptions",
                                                 argumentsJSON: json([json(["projectId": projectID, "field": field])])))
        let project = try XCTUnwrap(options["project"] as? [String: Any])
        return ["requestId": UUID().uuidString.lowercased(), "projectId": projectID, "field": field, "value": value,
                "expected": project.filter { $0.key != "id" }]
    }

    private func projectAreaRequest(_ core: CoreHost, areaID: String?,
                                    projectID: String = "focus-target") async throws -> [String: Any] {
        let options = try object(await core.call("projectAreaOptions",
                                                 argumentsJSON: json([projectID])))
        let project = try XCTUnwrap(options["project"] as? [String: Any])
        let rows = try XCTUnwrap(options["areas"] as? [[String: Any]])
        let selected = try areaID.map { id -> [String: Any] in
            let row = try XCTUnwrap(rows.first { $0["id"] as? String == id })
            return ["id": id, "name": try XCTUnwrap(row["label"] as? String)]
        }
        return ["requestId": UUID().uuidString.lowercased(), "projectId": projectID,
                "areaId": areaID as Any? ?? NSNull(), "selectedArea": selected as Any? ?? NSNull(),
                "expected": project.filter { $0.key != "id" }]
    }

    private func projectSectionCreateRequest(_ title: String, projectID: String = "focus-target",
                                              id: String = UUID().uuidString.lowercased()) -> [String: Any] {
        ["requestId": id, "projectId": projectID, "title": title]
    }

    private func projectSectionRenameRequest(_ core: CoreHost, title: String,
                                             projectID: String = "focus-target",
                                             sectionID: String = "rename-section") async throws -> [String: Any] {
        let options = try object(await core.call("projectSectionRenameOptions",
                                                 argumentsJSON: json([json(["projectId": projectID, "sectionId": sectionID])])))
        let token = try XCTUnwrap(options["token"] as? [String: Any])
        return ["requestId": UUID().uuidString.lowercased(), "projectId": projectID,
                "sectionId": sectionID, "title": title, "expected": token]
    }

    private func seedProjectSectionDeleteRows() async throws {
        try await seedProjectRenameRows()
        let at = recentAreaTestTime()
        let sqlite = try SQLiteBridge(url: database)
        _ = try sqlite.execute("INSERT INTO tasks (id, title, status, projectId, sectionId, description, dueDate, checklist, attachments, tags, contexts, priority, orderNum, isFocusedToday, showFutureRecurrence, suppressMindwtrReminders, pushCount, createdAt, updatedAt, deletedAt, rev) SELECT ?, ?, status, projectId, sectionId, description, dueDate, checklist, attachments, tags, contexts, priority, orderNum, isFocusedToday, showFutureRecurrence, suppressMindwtrReminders, pushCount, createdAt, ?, ?, rev FROM tasks WHERE id = 'rename-task'",
                               parametersJSON: json(["delete-tombstone-task", "Deleted linked task", at, at]))
        _ = try sqlite.execute("INSERT INTO sections (id, projectId, title, orderNum, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["delete-sibling-section", "focus-target", "Keep sibling", 1, at, at, 2]))
        sqlite.close()
    }

    private func projectSectionDeleteRequest(_ core: CoreHost, projectID: String = "focus-target",
                                             sectionID: String = "rename-section") async throws -> [String: Any] {
        let options = try object(await core.call("projectSectionDeleteOptions",
                                                 argumentsJSON: json([json(["projectId": projectID, "sectionId": sectionID])])))
        let token = try XCTUnwrap(options["token"] as? [String: Any])
        return ["requestId": UUID().uuidString.lowercased(), "projectId": projectID,
                "sectionId": sectionID, "expected": token]
    }

    private func seedProjectSectionOrderRows() async throws {
        try await seedProjectSectionDeleteRows()
        let at = recentAreaTestTime()
        let sqlite = try SQLiteBridge(url: database)
        // Match a persisted core Section: a NULL isCollapsed would be canonicalized to 0 by the next full save.
        _ = try sqlite.execute("UPDATE sections SET orderNum = 100, isCollapsed = 0 WHERE id = 'delete-sibling-section'", parametersJSON: "[]")
        _ = try sqlite.execute("INSERT INTO sections (id, projectId, title, orderNum, isCollapsed, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["order-third", "focus-target", "Keep sibling", 200, 0, at, at, 2]))
        _ = try sqlite.execute("INSERT INTO sections (id, projectId, title, orderNum, isCollapsed, createdAt, updatedAt, deletedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["order-tombstone", "focus-target", "Deleted section", 50, 0, at, at, at, 2]))
        _ = try sqlite.execute("INSERT INTO sections (id, projectId, title, orderNum, isCollapsed, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["order-foreign", "focus-other-0", "Other Project", 50, 0, at, at, 2]))
        sqlite.close()
    }

    private func projectSectionOrderRequest(_ core: CoreHost, sectionID: String = "order-third",
                                            direction: String = "up", projectID: String = "focus-target") async throws -> [String: Any] {
        let options = try object(await core.call("projectSectionOrderOptions",
                                                 argumentsJSON: json([json(["projectId": projectID])])))
        return ["requestId": UUID().uuidString.lowercased(), "projectId": projectID,
                "sectionId": sectionID, "direction": direction,
                "expectedSections": try XCTUnwrap(options["token"] as? [[String: Any]])]
    }

    private func projectSectionOrderEnvelope() throws -> [String: Any] {
        let saved = try object(String(contentsOf: journal))
        XCTAssertEqual(saved["method"] as? String, "projectSectionOrderCommit")
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(saved["argumentsJSON"] as? String).utf8)) as? [String])
        return try object(XCTUnwrap(args.first))
    }

    private func projectFocusRequest(_ core: CoreHost, focused: Bool,
                                     projectID: String = "focus-target") async throws -> [String: Any] {
        let options = try object(await core.call("projectFocusOptions", argumentsJSON: json([json(["projectId": projectID])])))
        let project = try XCTUnwrap(options["project"] as? [String: Any])
        return ["requestId": UUID().uuidString.lowercased(), "projectId": projectID, "focused": focused,
                "expected": project.filter { $0.key != "id" }]
    }

    private func recentAreaTestTime(daysAgo: Int = 1) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: Date().addingTimeInterval(-Double(daysAgo) * 86_400))
    }

    private func projectCreateRequest(_ id: String = UUID().uuidString.lowercased(), title: String,
                                      areaId: Any = NSNull()) -> [String: Any] {
        ["requestId": id, "title": title, "areaId": areaId]
    }

    func testProjectSectionCreateFailedCommitExactRetryDuplicateTitlesAndRichRowPreservation() async throws {
        try await seedProjectRenameRows()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let options = try object(await core.call("projectSectionOptions",
                                                 argumentsJSON: json([json(["projectId": "focus-target"])])))
        XCTAssertEqual(options["canCreate"] as? Bool, true)
        XCTAssertTrue((options["sections"] as? [[String: Any]])?.contains(where: { $0["id"] as? String == "rename-section" }) == true)
        let request = projectSectionCreateRequest("  Keep Section  ")
        let beforeSQLite = try SQLiteBridge(url: database)
        let before = try nineTableSnapshot(beforeSQLite)
        beforeSQLite.close()
        let oldSection = try json(XCTUnwrap(projectSectionRows("rename-section").first))
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected Project Section COMMIT failure") } }
        await expectFailure("SAVE_FAILED") {
            _ = try await core.call("projectSectionCreate", argumentsJSON: json([json(request)]))
        }
        XCTAssertEqual(try object(String(contentsOf: journal))["method"] as? String, "projectSectionCreateCommit")
        let rolledBack = try SQLiteBridge(url: database)
        XCTAssertEqual(try nineTableSnapshot(rolledBack), before)
        rolledBack.close()
        await expectFailure("SAVE_FAILED") {
            _ = try await core.call("projectSectionCreate", argumentsJSON: json([json(projectSectionCreateRequest("Other"))]))
        }
        await expectFailure("SAVE_FAILED") {
            _ = try await core.call("projectCreate", argumentsJSON: json([json(projectCreateRequest(title: "Wrong method"))]))
        }
        faults.beforeSQL = nil
        let retryValue = try await core.retryPending()
        let result = try object(XCTUnwrap(retryValue))
        XCTAssertEqual(result["id"] as? String, request["requestId"] as? String)
        XCTAssertEqual(result["projectId"] as? String, "focus-target")
        let created = try XCTUnwrap(projectSectionRows(request["requestId"] as? String).first)
        XCTAssertEqual(created["title"] as? String, "Keep Section")
        XCTAssertEqual(created["projectId"] as? String, "focus-target")
        XCTAssertEqual(created["orderNum"] as? Int, 1)
        let afterSQLite = try SQLiteBridge(url: database)
        let after = try nineTableSnapshot(afterSQLite)
        afterSQLite.close()
        for index in [0, 1, 2, 3, 5, 6, 7, 8] { XCTAssertEqual(after[index], before[index]) }
        XCTAssertEqual(try json(XCTUnwrap(projectSectionRows("rename-section").first)), oldSection)
        XCTAssertEqual(try storedTask("rename-task")["sectionId"] as? String, "rename-section")
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))

        let duplicate = projectSectionCreateRequest("Keep Section")
        let second = try object(await core.call("projectSectionCreate", argumentsJSON: json([json(duplicate)])))
        XCTAssertEqual(second["id"] as? String, duplicate["requestId"] as? String)
        XCTAssertNotEqual(second["id"] as? String, result["id"] as? String)
        XCTAssertEqual(try projectSectionRows().filter { $0["projectId"] as? String == "focus-target" && $0["title"] as? String == "Keep Section" }.count, 3)
        var writes = 0, journals = 0
        faults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:projects|tasks|sections|areas|people|settings|saved_filters|calendar_sync)\b"#, options: .regularExpression) != nil { writes += 1 }
        }
        faults.journalWrite = { journals += 1 }
        let same = try object(await core.call("projectSectionCreateRetryOutcome", argumentsJSON: json([json(duplicate)])))
        XCTAssertEqual(same["id"] as? String, duplicate["requestId"] as? String)
        let missing = projectSectionCreateRequest("Keep Section")
        await expectFailure("STALE_REVISION") {
            _ = try await core.call("projectSectionCreateRetryOutcome", argumentsJSON: json([json(missing)]))
        }
        XCTAssertEqual(writes, 0); XCTAssertEqual(journals, 0)
        await core.close()
    }

    func testProjectSectionCreateInvalidArchivedAndNilPendingWriteNothing() async throws {
        let parent = directory!
        for kind in ["active", "archived"] {
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await seedProjectRenameRows(targetStatus: kind)
            let faults = HostIOFaults()
            let core = host(faults)
            _ = try await core.start()
            let beforeSQLite = try SQLiteBridge(url: database)
            let before = try nineTableSnapshot(beforeSQLite)
            beforeSQLite.close()
            let options = try object(await core.call("projectSectionOptions",
                                                     argumentsJSON: json([json(["projectId": "focus-target"])])))
            XCTAssertEqual(options["canCreate"] as? Bool, kind == "active")
            let request = projectSectionCreateRequest("New section")
            for method in ["projectSectionCreatePrepare", "projectSectionCreateValidate", "projectSectionCreateCommit"] {
                await expectFailure("unavailable") { _ = try await core.call(method, argumentsJSON: json([json(request)])) }
            }
            var writes = 0, journals = 0
            faults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:projects|tasks|sections|areas|people|settings|saved_filters|calendar_sync)\b"#, options: .regularExpression) != nil { writes += 1 }
            }
            faults.journalWrite = { journals += 1 }
            let pending = try await core.retryPending()
            XCTAssertNil(pending)
            await expectFailure("STALE_REVISION") {
                _ = try await core.call("projectSectionCreateRetryOutcome", argumentsJSON: json([json(request)]))
            }
            let malformedRequests: [[String: Any]] = [
                ["requestId": "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", "projectId": "focus-target", "title": "New"],
                ["requestId": UUID().uuidString.lowercased(), "projectId": "focus-target", "title": " \n "],
                ["requestId": UUID().uuidString.lowercased(), "projectId": "focus-target", "title": String(repeating: "x", count: 100_001)],
                ["requestId": UUID().uuidString.lowercased(), "projectId": "focus-target", "title": "New", "extra": true],
            ]
            for malformed in malformedRequests {
                await expectFailure("INVALID_INPUT") {
                    _ = try await core.call("projectSectionCreate", argumentsJSON: json([json(malformed)]))
                }
            }
            await expectFailure("STALE_REVISION") {
                _ = try await core.call("projectSectionOptions", argumentsJSON: json([json(["projectId": "missing"])]))
            }
            await expectFailure("STALE_REVISION") {
                _ = try await core.call("projectSectionCreate", argumentsJSON: json([json(projectSectionCreateRequest("New", projectID: "missing"))]))
            }
            if kind == "archived" {
                await expectFailure("STALE_REVISION") {
                    _ = try await core.call("projectSectionCreate", argumentsJSON: json([json(request)]))
                }
            }
            XCTAssertEqual(writes, 0); XCTAssertEqual(journals, 0)
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            let check = try SQLiteBridge(url: database)
            XCTAssertEqual(try nineTableSnapshot(check), before)
            check.close()
            await core.close()
            directory = parent
        }
    }

    func testProjectSectionCreateColdFirstApplyAndFullReceiptAfterParentChange() async throws {
        let parent = directory!
        for kind in ["first", "receipt"] {
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await seedProjectRenameRows()
            let faults = HostIOFaults()
            let writer = host(faults)
            _ = try await writer.start()
            let request = projectSectionCreateRequest("Cold section")
            if kind == "first" {
                faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected Section pending COMMIT") } }
                await expectFailure("SAVE_FAILED") {
                    _ = try await writer.call("projectSectionCreate", argumentsJSON: json([json(request)]))
                }
            } else {
                var journalWrites = 0
                faults.journalWrite = { journalWrites += 1; if journalWrites == 2 { throw HostFailure("Injected Section lost reply") } }
                await expectFailure("lost reply") {
                    _ = try await writer.call("projectSectionCreate", argumentsJSON: json([json(request)]))
                }
            }
            XCTAssertEqual(try object(String(contentsOf: journal))["method"] as? String, "projectSectionCreateCommit")
            await writer.close()
            if kind == "receipt" {
                let edit = try SQLiteBridge(url: database)
                _ = try edit.execute("UPDATE projects SET title = 'Later parent rename', rev = rev + 1, updatedAt = ? WHERE id = 'focus-target'",
                                     parametersJSON: json([recentAreaTestTime(daysAgo: 0)]))
                edit.close()
            }
            let beforeSQLite = try SQLiteBridge(url: database)
            let before = try nineTableSnapshot(beforeSQLite)
            beforeSQLite.close()
            let replayFaults = HostIOFaults()
            var writes = 0
            replayFaults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:projects|tasks|sections|areas|people|settings|saved_filters|calendar_sync)\b"#, options: .regularExpression) != nil { writes += 1 }
            }
            let reopened = host(replayFaults)
            let startup = try object(await reopened.start())
            let recovery = try XCTUnwrap(startup["recovery"] as? [String: Any])
            XCTAssertEqual(recovery["method"] as? String, "projectSectionCreateCommit")
            XCTAssertEqual((recovery["result"] as? [String: Any])?["id"] as? String, request["requestId"] as? String)
            if kind == "receipt" {
                XCTAssertEqual(writes, 0)
                let check = try SQLiteBridge(url: database)
                XCTAssertEqual(try nineTableSnapshot(check), before)
                check.close()
                XCTAssertEqual(try projectRows("focus-target").first?["title"] as? String, "Later parent rename")
            } else { XCTAssertGreaterThan(writes, 0) }
            XCTAssertEqual(try projectSectionRows(request["requestId"] as? String).count, 1)
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            await reopened.close()
            directory = parent
        }
    }

    func testProjectSectionCreateTerminalCleanupFailureRecoversReceiptAfterParentChange() async throws {
        try await seedProjectRenameRows()
        let faults = HostIOFaults()
        let writer = host(faults)
        _ = try await writer.start()
        let request = projectSectionCreateRequest("Terminal Section")
        let id = try XCTUnwrap(request["requestId"] as? String)
        faults.journalRemove = { throw HostFailure("Injected Section cleanup failure") }
        await expectFailure("cleanup failure") {
            _ = try await writer.call("projectSectionCreate", argumentsJSON: json([json(request)]))
        }
        let retained = try object(String(contentsOf: journal))
        XCTAssertEqual(retained["method"] as? String, "projectSectionCreateCommit")
        let terminal = try XCTUnwrap((retained["terminal"] as? [String: Any])?["success"] as? [String: String])
        let terminalResult = try object(XCTUnwrap(terminal["_0"]))
        XCTAssertEqual(Set(terminalResult.keys), Set(["id", "projectId"]))
        XCTAssertEqual(terminalResult["id"] as? String, id)
        XCTAssertEqual(terminalResult["projectId"] as? String, "focus-target")
        XCTAssertEqual(try projectSectionRows(id).count, 1)
        await writer.close()

        let edit = try SQLiteBridge(url: database)
        _ = try edit.execute("UPDATE projects SET title = 'Later parent rename', rev = rev + 1, updatedAt = ? WHERE id = 'focus-target'",
                             parametersJSON: json([recentAreaTestTime(daysAgo: 0)]))
        let before = try nineTableSnapshot(edit)
        edit.close()
        let replayFaults = HostIOFaults()
        var rowWrites = 0
        replayFaults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:tasks|projects|areas|people|sections|settings|saved_filters|calendar_sync)\b"#,
                            options: .regularExpression) != nil { rowWrites += 1 }
        }
        let reopened = host(replayFaults)
        let startup = try object(await reopened.start())
        let recovery = try XCTUnwrap(startup["recovery"] as? [String: Any])
        XCTAssertEqual(recovery["method"] as? String, "projectSectionCreateCommit")
        let result = try XCTUnwrap(recovery["result"] as? [String: Any])
        XCTAssertEqual(try json(result), try json(terminalResult))
        let noPending = try await reopened.retryPending()
        XCTAssertNil(noPending)
        XCTAssertEqual(rowWrites, 0)
        let check = try SQLiteBridge(url: database)
        XCTAssertEqual(try nineTableSnapshot(check), before)
        check.close()
        XCTAssertEqual(try projectSectionRows(id).count, 1)
        XCTAssertEqual(try projectRows("focus-target").first?["title"] as? String, "Later parent rename")
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        await reopened.close()
    }

    func testProjectSectionCreateChangedParentOrderAndPartialReceiptRefuseWithoutOverwrite() async throws {
        let parent = directory!
        for kind in ["before", "order", "partial-after"] {
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await seedProjectRenameRows()
            let faults = HostIOFaults()
            let writer = host(faults)
            _ = try await writer.start()
            let request = projectSectionCreateRequest("Conflict section")
            if kind != "partial-after" {
                faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected Section pending COMMIT") } }
                await expectFailure("SAVE_FAILED") {
                    _ = try await writer.call("projectSectionCreate", argumentsJSON: json([json(request)]))
                }
            } else {
                var journalWrites = 0
                faults.journalWrite = { journalWrites += 1; if journalWrites == 2 { throw HostFailure("Injected Section lost reply") } }
                await expectFailure("lost reply") {
                    _ = try await writer.call("projectSectionCreate", argumentsJSON: json([json(request)]))
                }
            }
            await writer.close()
            let edit = try SQLiteBridge(url: database)
            if kind == "before" {
                _ = try edit.execute("UPDATE projects SET title = 'Changed parent', rev = rev + 1 WHERE id = 'focus-target'")
            } else if kind == "order" {
                _ = try edit.execute("UPDATE sections SET orderNum = 5 WHERE id = 'rename-section'")
            } else {
                _ = try edit.execute("UPDATE sections SET title = 'Changed Section', rev = rev + 1 WHERE id = ?",
                                     parametersJSON: json([request["requestId"]!]))
            }
            let before = try nineTableSnapshot(edit)
            edit.close()
            let replayFaults = HostIOFaults()
            var writes = 0
            replayFaults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:projects|tasks|sections|areas|people|settings|saved_filters|calendar_sync)\b"#, options: .regularExpression) != nil { writes += 1 }
            }
            let replay = host(replayFaults)
            await expectFailure("STALE_REVISION") { _ = try await replay.start() }
            XCTAssertEqual(writes, 0)
            XCTAssertEqual(try object(String(contentsOf: journal))["method"] as? String, "projectSectionCreateCommit")
            let check = try SQLiteBridge(url: database)
            XCTAssertEqual(try nineTableSnapshot(check), before)
            check.close()
            await replay.close()
            directory = parent
        }
    }

    func testProjectSectionCreateForgedPendingTerminalAndMalformedJournalRefuseBeforeSQLite() async throws {
        try await seedProjectRenameRows()
        let faults = HostIOFaults()
        let writer = host(faults)
        _ = try await writer.start()
        let request = projectSectionCreateRequest("Journal Section")
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected Section pending COMMIT") } }
        await expectFailure("SAVE_FAILED") {
            _ = try await writer.call("projectSectionCreate", argumentsJSON: json([json(request)]))
        }
        let pending = try object(String(contentsOf: journal))
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(pending["argumentsJSON"] as? String).utf8)) as? [String])
        let original = try object(XCTUnwrap(args.first))
        let prepared = try XCTUnwrap(original["prepared"] as? [String: Any])
        await writer.close()
        for corruption in ["request-id", "parent-id", "order", "row", "result", "terminal", "malformed"] {
            var envelope = original
            var argumentsJSON = try XCTUnwrap(pending["argumentsJSON"] as? String)
            var terminal: [String: Any]? = nil
            switch corruption {
            case "request-id":
                var changed = try XCTUnwrap(envelope["request"] as? [String: Any])
                changed["requestId"] = UUID().uuidString.lowercased()
                envelope["request"] = changed
                argumentsJSON = try json([json(envelope)])
            case "parent-id":
                var forged = prepared
                var scope = try XCTUnwrap(forged["scope"] as? [String: Any])
                var project = try XCTUnwrap(scope["project"] as? [String: Any])
                project["id"] = "different-parent"
                scope["project"] = project; forged["scope"] = scope; envelope["prepared"] = forged
                argumentsJSON = try json([json(envelope)])
            case "order":
                var forged = prepared
                var scope = try XCTUnwrap(forged["scope"] as? [String: Any])
                scope["orderMax"] = (scope["orderMax"] as? Int ?? 0) + 1
                forged["scope"] = scope; envelope["prepared"] = forged
                argumentsJSON = try json([json(envelope)])
            case "row":
                var forged = prepared
                var section = try XCTUnwrap(forged["section"] as? [String: Any])
                section["title"] = "Forged Section"
                forged["section"] = section; envelope["prepared"] = forged
                argumentsJSON = try json([json(envelope)])
            case "result":
                var forged = prepared
                var result = try XCTUnwrap(forged["result"] as? [String: Any])
                result["id"] = UUID().uuidString.lowercased()
                forged["result"] = result; envelope["prepared"] = forged
                argumentsJSON = try json([json(envelope)])
            case "terminal":
                terminal = ["success": ["_0": try json(["id": UUID().uuidString.lowercased(), "projectId": "focus-target"])]]
            default: argumentsJSON = try json([["malformed": true]])
            }
            var forged: [String: Any] = ["version": 2, "method": "projectSectionCreateCommit", "argumentsJSON": argumentsJSON]
            if let terminal { forged["terminal"] = terminal }
            let bytes = Data(try json(forged).utf8)
            try bytes.write(to: journal)
            let blockedFaults = HostIOFaults()
            var sql = 0, cleanup = 0
            blockedFaults.beforeSQL = { _ in sql += 1 }
            blockedFaults.journalRemove = { cleanup += 1 }
            let blocked = host(blockedFaults)
            await expectFailure { _ = try await blocked.start() }
            XCTAssertEqual(sql, 0); XCTAssertEqual(cleanup, 0)
            XCTAssertEqual(try Data(contentsOf: journal), bytes)
            await blocked.close()
        }

        let parent = directory!
        directory = parent.appendingPathComponent("no-database")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let malformed = Data(#"{"version":2,"method":"projectSectionCreateCommit","argumentsJSON":"[]"}"#.utf8)
        try malformed.write(to: journal)
        XCTAssertFalse(FileManager.default.fileExists(atPath: database.path))
        let blocked = host()
        await expectFailure { _ = try await blocked.start() }
        XCTAssertFalse(FileManager.default.fileExists(atPath: database.path))
        XCTAssertEqual(try Data(contentsOf: journal), malformed)
        await blocked.close()
        directory = parent
    }

    func testProjectSectionRenameFailedCommitExactRetryPreservesAllOtherRows() async throws {
        try await seedProjectRenameRows()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let request = try await projectSectionRenameRequest(core, title: "  Renamed Section  ")
        let oldSection = try XCTUnwrap(projectSectionRows("rename-section").first)
        let sql = try SQLiteBridge(url: database)
        let before = try nineTableSnapshot(sql)
        sql.close()
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected Section rename COMMIT failure") } }
        await expectFailure("SAVE_FAILED") {
            _ = try await core.call("projectSectionRename", argumentsJSON: json([json(request)]))
        }
        XCTAssertEqual(try object(String(contentsOf: journal))["method"] as? String, "projectSectionRenameCommit")
        let rolledBack = try SQLiteBridge(url: database)
        XCTAssertEqual(try nineTableSnapshot(rolledBack), before)
        rolledBack.close()
        faults.beforeSQL = nil
        let retryValue = try await core.retryPending()
        let retry = try object(XCTUnwrap(retryValue))
        XCTAssertEqual(Set(retry.keys), Set(["id", "projectId"]))
        XCTAssertEqual(retry["id"] as? String, "rename-section")
        XCTAssertEqual(retry["projectId"] as? String, "focus-target")
        let savedSection = try XCTUnwrap(projectSectionRows("rename-section").first)
        XCTAssertEqual(savedSection["title"] as? String, "Renamed Section")
        XCTAssertEqual(savedSection["rev"] as? Int, (oldSection["rev"] as? Int ?? 0) + 1)
        for (field, value) in oldSection where !["title", "rev", "revBy", "updatedAt"].contains(field) {
            XCTAssertEqual(try json([savedSection[field] ?? NSNull()]), try json([value]), field)
        }
        let saved = try SQLiteBridge(url: database)
        let after = try nineTableSnapshot(saved)
        saved.close()
        for index in before.indices where index != 4 { XCTAssertEqual(after[index], before[index]) }
        XCTAssertEqual(try projectSectionRows("rename-section").count, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        var replayWrites = 0, replayJournals = 0
        faults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:tasks|projects|areas|people|sections|settings|saved_filters|calendar_sync)\b"#,
                            options: .regularExpression) != nil { replayWrites += 1 }
        }
        faults.journalWrite = { replayJournals += 1 }
        await expectFailure("STALE_REVISION") {
            _ = try await core.call("projectSectionRename", argumentsJSON: json([json(request)]))
        }
        XCTAssertEqual(replayWrites, 0); XCTAssertEqual(replayJournals, 0)
        await core.close()
    }

    func testProjectSectionRenameNoopDuplicateTitleAndReadOnlyRefusalsWriteNothing() async throws {
        try await seedProjectRenameRows()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let options = try object(await core.call("projectSectionRenameOptions",
                                                 argumentsJSON: json([json(["projectId": "focus-target", "sectionId": "rename-section"])])))
        XCTAssertEqual(options["canRename"] as? Bool, true)
        XCTAssertEqual((options["section"] as? [String: Any])?["title"] as? String, "Keep Section")
        let beforeSQLite = try SQLiteBridge(url: database)
        let before = try nineTableSnapshot(beforeSQLite)
        beforeSQLite.close()
        var writes = 0, journals = 0
        faults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:tasks|projects|areas|people|sections|settings|saved_filters|calendar_sync)\b"#,
                            options: .regularExpression) != nil { writes += 1 }
        }
        faults.journalWrite = { journals += 1 }
        let same = try await projectSectionRenameRequest(core, title: " Keep Section ")
        let noop = try object(await core.call("projectSectionRename", argumentsJSON: json([json(same)])))
        XCTAssertEqual(Set(noop.keys), Set(["id", "projectId"]))
        XCTAssertEqual(noop["id"] as? String, "rename-section")
        XCTAssertEqual(writes, 0); XCTAssertEqual(journals, 0)
        await expectFailure("STALE_REVISION") {
            _ = try await core.call("projectSectionRenameRetryOutcome", argumentsJSON: json([json(same)]))
        }
        for malformed in ["blank", "token", "extra", "uuid", "oversized"] {
            var input = same
            if malformed == "blank" { input["title"] = "   " }
            if malformed == "token" { var token = try XCTUnwrap(input["expected"] as? [String: Any]); token.removeValue(forKey: "id"); input["expected"] = token }
            if malformed == "extra" { input["extra"] = true }
            if malformed == "uuid" { input["requestId"] = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" }
            if malformed == "oversized" { input["title"] = String(repeating: "漢", count: 800_000) }
            await expectFailure("INVALID_INPUT") {
                _ = try await core.call("projectSectionRename", argumentsJSON: json([json(input)]))
            }
        }
        for input in [["projectId": "focus-target", "sectionId": "missing-section"],
                      ["projectId": "focus-other-0", "sectionId": "rename-section"]] {
            await expectFailure("STALE_REVISION") {
                _ = try await core.call("projectSectionRenameOptions", argumentsJSON: json([json(input)]))
            }
        }
        XCTAssertEqual(writes, 0); XCTAssertEqual(journals, 0)
        let unchanged = try SQLiteBridge(url: database)
        XCTAssertEqual(try nineTableSnapshot(unchanged), before)
        unchanged.close()
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        faults.beforeSQL = nil; faults.journalWrite = nil

        let sibling = projectSectionCreateRequest("Shared Section")
        _ = try await core.call("projectSectionCreate", argumentsJSON: json([json(sibling)]))
        let duplicate = try await projectSectionRenameRequest(core, title: " Shared Section ")
        let result = try object(await core.call("projectSectionRename", argumentsJSON: json([json(duplicate)])))
        XCTAssertEqual(result["id"] as? String, "rename-section")
        XCTAssertEqual(try projectSectionRows("rename-section").first?["title"] as? String, "Shared Section")
        XCTAssertEqual(try projectSectionRows(sibling["requestId"] as? String).first?["title"] as? String, "Shared Section")
        XCTAssertEqual(try projectSectionRows().filter { $0["title"] as? String == "Shared Section" }.count, 2)
        await core.close()

        let parent = directory!
        for kind in ["archived", "deleted", "deleted-section"] {
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await seedProjectRenameRows(targetStatus: kind == "archived" ? "archived" : "active",
                                            targetDeleted: kind == "deleted")
            if kind == "deleted-section" {
                let edit = try SQLiteBridge(url: database)
                _ = try edit.execute("UPDATE sections SET deletedAt = ? WHERE id = 'rename-section'",
                                     parametersJSON: json([recentAreaTestTime(daysAgo: 0)]))
                edit.close()
            }
            let policyFaults = HostIOFaults()
            let reader = host(policyFaults)
            _ = try await reader.start()
            var policyWrites = 0, policyJournals = 0
            policyFaults.beforeSQL = { _ in policyWrites += 1 }
            policyFaults.journalWrite = { policyJournals += 1 }
            if kind == "archived" {
                let archived = try object(await reader.call("projectSectionRenameOptions",
                                                            argumentsJSON: json([json(["projectId": "focus-target", "sectionId": "rename-section"])])))
                XCTAssertEqual(archived["canRename"] as? Bool, false)
                let request = try await projectSectionRenameRequest(reader, title: "Cannot rename")
                await expectFailure("STALE_REVISION") {
                    _ = try await reader.call("projectSectionRename", argumentsJSON: json([json(request)]))
                }
            } else {
                await expectFailure("STALE_REVISION") {
                    _ = try await reader.call("projectSectionRenameOptions",
                                              argumentsJSON: json([json(["projectId": "focus-target", "sectionId": "rename-section"])]))
                }
            }
            XCTAssertEqual(policyWrites, 0); XCTAssertEqual(policyJournals, 0)
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            await reader.close()
            directory = parent
        }
    }

    func testProjectSectionRenameColdFirstApplyAndCompleteReceiptAfterParentChange() async throws {
        let parent = directory!
        for kind in ["first", "receipt"] {
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await seedProjectRenameRows()
            let faults = HostIOFaults()
            let writer = host(faults)
            _ = try await writer.start()
            let request = try await projectSectionRenameRequest(writer, title: "Cold Section")
            if kind == "first" {
                faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Section rename") } }
                await expectFailure("SAVE_FAILED") {
                    _ = try await writer.call("projectSectionRename", argumentsJSON: json([json(request)]))
                }
            } else {
                var journalWrites = 0
                faults.journalWrite = { journalWrites += 1; if journalWrites == 2 { throw HostFailure("Injected Section rename lost reply") } }
                await expectFailure("lost reply") {
                    _ = try await writer.call("projectSectionRename", argumentsJSON: json([json(request)]))
                }
            }
            XCTAssertEqual(try object(String(contentsOf: journal))["method"] as? String, "projectSectionRenameCommit")
            await writer.close()
            if kind == "receipt" {
                let edit = try SQLiteBridge(url: database)
                _ = try edit.execute("UPDATE projects SET title = 'Later parent rename', rev = rev + 1, updatedAt = ? WHERE id = 'focus-target'",
                                     parametersJSON: json([recentAreaTestTime(daysAgo: 0)]))
                edit.close()
            }
            let beforeSQLite = try SQLiteBridge(url: database)
            let before = try nineTableSnapshot(beforeSQLite)
            beforeSQLite.close()
            let replayFaults = HostIOFaults()
            var rowWrites = 0
            replayFaults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:tasks|projects|areas|people|sections|settings|saved_filters|calendar_sync)\b"#,
                                options: .regularExpression) != nil { rowWrites += 1 }
            }
            let reopened = host(replayFaults)
            let startup = try object(await reopened.start())
            let recovery = try XCTUnwrap(startup["recovery"] as? [String: Any])
            XCTAssertEqual(recovery["method"] as? String, "projectSectionRenameCommit")
            let result = try XCTUnwrap(recovery["result"] as? [String: Any])
            XCTAssertEqual(Set(result.keys), Set(["id", "projectId"]))
            XCTAssertEqual(result["id"] as? String, "rename-section")
            XCTAssertEqual(result["projectId"] as? String, "focus-target")
            if kind == "receipt" {
                XCTAssertEqual(rowWrites, 0)
                let checked = try SQLiteBridge(url: database)
                XCTAssertEqual(try nineTableSnapshot(checked), before)
                checked.close()
                XCTAssertEqual(try projectRows("focus-target").first?["title"] as? String, "Later parent rename")
            } else { XCTAssertGreaterThan(rowWrites, 0) }
            XCTAssertEqual(try projectSectionRows("rename-section").first?["title"] as? String, "Cold Section")
            XCTAssertEqual(try projectSectionRows("rename-section").count, 1)
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            await reopened.close()
            directory = parent
        }
    }

    func testProjectSectionRenameTerminalCleanupFailureRecoversExactReceiptAfterParentChange() async throws {
        try await seedProjectRenameRows()
        let faults = HostIOFaults()
        let writer = host(faults)
        _ = try await writer.start()
        let request = try await projectSectionRenameRequest(writer, title: "Terminal Section")
        faults.journalRemove = { throw HostFailure("Injected Section rename cleanup failure") }
        await expectFailure("cleanup failure") {
            _ = try await writer.call("projectSectionRename", argumentsJSON: json([json(request)]))
        }
        let retained = try object(String(contentsOf: journal))
        XCTAssertEqual(retained["method"] as? String, "projectSectionRenameCommit")
        let terminal = try XCTUnwrap((retained["terminal"] as? [String: Any])?["success"] as? [String: String])
        let terminalResult = try object(XCTUnwrap(terminal["_0"]))
        XCTAssertEqual(terminalResult["id"] as? String, "rename-section")
        XCTAssertEqual(terminalResult["projectId"] as? String, "focus-target")
        await writer.close()
        let edit = try SQLiteBridge(url: database)
        _ = try edit.execute("UPDATE projects SET title = 'Later parent rename', rev = rev + 1, updatedAt = ? WHERE id = 'focus-target'",
                             parametersJSON: json([recentAreaTestTime(daysAgo: 0)]))
        let before = try nineTableSnapshot(edit)
        edit.close()
        let replayFaults = HostIOFaults()
        var rowWrites = 0
        replayFaults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:tasks|projects|areas|people|sections|settings|saved_filters|calendar_sync)\b"#,
                            options: .regularExpression) != nil { rowWrites += 1 }
        }
        let reopened = host(replayFaults)
        let startup = try object(await reopened.start())
        let recovery = try XCTUnwrap(startup["recovery"] as? [String: Any])
        XCTAssertEqual(recovery["method"] as? String, "projectSectionRenameCommit")
        XCTAssertEqual(try json(XCTUnwrap(recovery["result"] as? [String: Any])), try json(terminalResult))
        let noPending = try await reopened.retryPending()
        XCTAssertNil(noPending)
        XCTAssertEqual(rowWrites, 0)
        let check = try SQLiteBridge(url: database)
        XCTAssertEqual(try nineTableSnapshot(check), before)
        check.close()
        XCTAssertEqual(try projectSectionRows("rename-section").count, 1)
        XCTAssertEqual(try projectSectionRows("rename-section").first?["title"] as? String, "Terminal Section")
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        await reopened.close()
    }

    func testProjectSectionRenameChangedParentSectionAndPartialReceiptRefuseWithoutOverwrite() async throws {
        let parent = directory!
        for kind in ["parent-before", "section-before", "partial-after"] {
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await seedProjectRenameRows()
            let faults = HostIOFaults()
            let writer = host(faults)
            _ = try await writer.start()
            let request = try await projectSectionRenameRequest(writer, title: "New Section")
            if kind == "partial-after" {
                var journalWrites = 0
                faults.journalWrite = { journalWrites += 1; if journalWrites == 2 { throw HostFailure("Injected Section rename lost reply") } }
                await expectFailure("lost reply") {
                    _ = try await writer.call("projectSectionRename", argumentsJSON: json([json(request)]))
                }
            } else {
                faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Section rename") } }
                await expectFailure("SAVE_FAILED") {
                    _ = try await writer.call("projectSectionRename", argumentsJSON: json([json(request)]))
                }
            }
            await writer.close()
            let edit = try SQLiteBridge(url: database)
            let at = recentAreaTestTime(daysAgo: 0)
            if kind == "parent-before" {
                _ = try edit.execute("UPDATE projects SET title = 'Newer parent', rev = rev + 1, updatedAt = ? WHERE id = 'focus-target'",
                                     parametersJSON: json([at]))
            } else if kind == "section-before" {
                _ = try edit.execute("UPDATE sections SET title = 'Newer Section', rev = rev + 1, updatedAt = ? WHERE id = 'rename-section'",
                                     parametersJSON: json([at]))
            } else {
                _ = try edit.execute("UPDATE sections SET description = 'Newer description', rev = rev + 1, updatedAt = ? WHERE id = 'rename-section'",
                                     parametersJSON: json([at]))
            }
            let before = try nineTableSnapshot(edit)
            edit.close()
            let replayFaults = HostIOFaults()
            var rowWrites = 0
            replayFaults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:tasks|projects|areas|people|sections|settings|saved_filters|calendar_sync)\b"#,
                                options: .regularExpression) != nil { rowWrites += 1 }
            }
            let reopened = host(replayFaults)
            await expectFailure("STALE_REVISION") { _ = try await reopened.start() }
            XCTAssertEqual(rowWrites, 0)
            XCTAssertTrue(FileManager.default.fileExists(atPath: journal.path))
            let check = try SQLiteBridge(url: database)
            XCTAssertEqual(try nineTableSnapshot(check), before)
            check.close()
            await reopened.close()
            directory = parent
        }
    }

    func testProjectSectionRenameForgedAndMalformedJournalsRefuseBeforeSQLite() async throws {
        try await seedProjectRenameRows()
        let faults = HostIOFaults()
        let writer = host(faults)
        _ = try await writer.start()
        let request = try await projectSectionRenameRequest(writer, title: "New Section")
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Section rename") } }
        await expectFailure("SAVE_FAILED") {
            _ = try await writer.call("projectSectionRename", argumentsJSON: json([json(request)]))
        }
        let pending = try object(String(contentsOf: journal))
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(pending["argumentsJSON"] as? String).utf8)) as? [String])
        let original = try object(XCTUnwrap(args.first))
        let prepared = try XCTUnwrap(original["prepared"] as? [String: Any])
        await writer.close()
        for corruption in ["request-id", "section-id", "parent", "title", "timestamp", "order", "result", "terminal", "malformed"] {
            var envelope = original
            var argumentsJSON = try XCTUnwrap(pending["argumentsJSON"] as? String)
            var terminal: [String: Any]? = nil
            switch corruption {
            case "request-id", "section-id":
                var changed = try XCTUnwrap(envelope["request"] as? [String: Any])
                changed[corruption == "request-id" ? "requestId" : "sectionId"] = UUID().uuidString.lowercased()
                envelope["request"] = changed
                argumentsJSON = try json([json(envelope)])
            case "parent":
                var forged = prepared
                var scope = try XCTUnwrap(forged["scope"] as? [String: Any])
                var project = try XCTUnwrap(scope["project"] as? [String: Any])
                project["id"] = "different-parent"
                scope["project"] = project; forged["scope"] = scope; envelope["prepared"] = forged
                argumentsJSON = try json([json(envelope)])
            case "title", "timestamp", "order":
                var forged = prepared
                var effect = try XCTUnwrap(forged["effect"] as? [String: Any])
                var pair = try XCTUnwrap(effect["section"] as? [String: Any])
                var after = try XCTUnwrap(pair["after"] as? [String: Any])
                if corruption == "title" { after["title"] = "Forged Section" }
                if corruption == "timestamp" { after["updatedAt"] = recentAreaTestTime(daysAgo: 2) }
                if corruption == "order" { after["order"] = 99 }
                pair["after"] = after; effect["section"] = pair; forged["effect"] = effect
                envelope["prepared"] = forged
                argumentsJSON = try json([json(envelope)])
            case "result":
                var forged = prepared
                var result = try XCTUnwrap(forged["result"] as? [String: Any])
                result["id"] = UUID().uuidString.lowercased()
                forged["result"] = result; envelope["prepared"] = forged
                argumentsJSON = try json([json(envelope)])
            case "terminal":
                terminal = ["success": ["_0": try json(["id": UUID().uuidString.lowercased(), "projectId": "focus-target"])]]
            default: argumentsJSON = try json([["malformed": true]])
            }
            var forged: [String: Any] = ["version": 2, "method": "projectSectionRenameCommit", "argumentsJSON": argumentsJSON]
            if let terminal { forged["terminal"] = terminal }
            let bytes = Data(try json(forged).utf8)
            try bytes.write(to: journal)
            let blockedFaults = HostIOFaults()
            var sql = 0, cleanup = 0
            blockedFaults.beforeSQL = { _ in sql += 1 }
            blockedFaults.journalRemove = { cleanup += 1 }
            let blocked = host(blockedFaults)
            await expectFailure { _ = try await blocked.start() }
            XCTAssertEqual(sql, 0); XCTAssertEqual(cleanup, 0)
            XCTAssertEqual(try Data(contentsOf: journal), bytes)
            await blocked.close()
        }
        let parent = directory!
        directory = parent.appendingPathComponent("no-database")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let malformed = Data(#"{"version":2,"method":"projectSectionRenameCommit","argumentsJSON":"[]"}"#.utf8)
        try malformed.write(to: journal)
        XCTAssertFalse(FileManager.default.fileExists(atPath: database.path))
        let blocked = host()
        await expectFailure { _ = try await blocked.start() }
        XCTAssertFalse(FileManager.default.fileExists(atPath: database.path))
        XCTAssertEqual(try Data(contentsOf: journal), malformed)
        await blocked.close()
        directory = parent
    }

    func testProjectSectionDeleteFailedCommitExactRetryDetachesLiveAndDeletedTasks() async throws {
        try await seedProjectSectionDeleteRows()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let request = try await projectSectionDeleteRequest(core)
        let sectionBefore = try XCTUnwrap(projectSectionRows("rename-section").first)
        let liveBefore = try storedTask("rename-task")
        let deletedBefore = try storedTask("delete-tombstone-task")
        let sql = try SQLiteBridge(url: database)
        let before = try nineTableSnapshot(sql)
        sql.close()
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected Section delete COMMIT failure") } }
        await expectFailure("SAVE_FAILED") {
            _ = try await core.call("projectSectionDelete", argumentsJSON: json([json(request)]))
        }
        XCTAssertEqual(try object(String(contentsOf: journal))["method"] as? String, "projectSectionDeleteCommit")
        let rolledBack = try SQLiteBridge(url: database)
        XCTAssertEqual(try nineTableSnapshot(rolledBack), before)
        rolledBack.close()
        faults.beforeSQL = nil
        let retryValue = try await core.retryPending()
        let result = try object(XCTUnwrap(retryValue))
        XCTAssertEqual(Set(result.keys), Set(["id", "projectId"]))
        XCTAssertEqual(result["id"] as? String, "rename-section")
        XCTAssertEqual(result["projectId"] as? String, "focus-target")
        let sectionAfter = try XCTUnwrap(projectSectionRows("rename-section").first)
        XCTAssertTrue(sectionAfter["deletedAt"] is String)
        XCTAssertEqual(sectionAfter["rev"] as? Int, (sectionBefore["rev"] as? Int ?? 0) + 1)
        for (field, value) in sectionBefore where !["deletedAt", "updatedAt", "rev", "revBy"].contains(field) {
            XCTAssertEqual(try json([sectionAfter[field] ?? NSNull()]), try json([value]), field)
        }
        for (id, old) in [("rename-task", liveBefore), ("delete-tombstone-task", deletedBefore)] {
            let current = try storedTask(id)
            XCTAssertTrue(current["sectionId"] is NSNull)
            XCTAssertEqual(current["rev"] as? Int, (old["rev"] as? Int ?? 0) + 1)
            for (field, value) in old where !["sectionId", "updatedAt", "rev", "revBy"].contains(field) {
                XCTAssertEqual(try json([current[field] ?? NSNull()]), try json([value]), "\(id).\(field)")
            }
        }
        let saved = try SQLiteBridge(url: database)
        let after = try nineTableSnapshot(saved)
        saved.close()
        for index in before.indices where ![0, 4].contains(index) { XCTAssertEqual(after[index], before[index]) }
        XCTAssertEqual(try projectSectionRows("delete-sibling-section").first?["title"] as? String, "Keep sibling")
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        var replayWrites = 0, replayJournals = 0
        faults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:tasks|projects|areas|people|sections|settings|saved_filters|calendar_sync)\b"#,
                            options: .regularExpression) != nil { replayWrites += 1 }
        }
        faults.journalWrite = { replayJournals += 1 }
        await expectFailure("STALE_REVISION") {
            _ = try await core.call("projectSectionDelete", argumentsJSON: json([json(request)]))
        }
        XCTAssertEqual(replayWrites, 0); XCTAssertEqual(replayJournals, 0)
        await core.close()
    }

    func testProjectSectionDeleteOptionsPolicyAndNilPendingProbeWriteNothing() async throws {
        try await seedProjectSectionDeleteRows()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let options = try object(await core.call("projectSectionDeleteOptions",
                                                 argumentsJSON: json([json(["projectId": "focus-target", "sectionId": "rename-section"])])))
        XCTAssertEqual(options["canDelete"] as? Bool, true)
        let request = try await projectSectionDeleteRequest(core)
        let sql = try SQLiteBridge(url: database)
        let before = try nineTableSnapshot(sql)
        sql.close()
        var writes = 0, journals = 0
        faults.beforeSQL = { statement in
            if statement.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:tasks|projects|areas|people|sections|settings|saved_filters|calendar_sync)\b"#,
                               options: .regularExpression) != nil { writes += 1 }
        }
        faults.journalWrite = { journals += 1 }
        let noPending = try await core.retryPending()
        XCTAssertNil(noPending)
        await expectFailure("STALE_REVISION") {
            _ = try await core.call("projectSectionDeleteRetryOutcome", argumentsJSON: json([json(request)]))
        }
        for kind in ["missing-token", "extra", "uuid", "oversized", "options-extra"] {
            if kind == "options-extra" {
                await expectFailure("INVALID_INPUT") {
                    _ = try await core.call("projectSectionDeleteOptions",
                                            argumentsJSON: json([json(["projectId": "focus-target", "sectionId": "rename-section", "extra": true])]))
                }
                continue
            }
            var changed = request
            if kind == "missing-token" {
                var expected = try XCTUnwrap(changed["expected"] as? [String: Any])
                expected.removeValue(forKey: "id"); changed["expected"] = expected
            }
            if kind == "extra" { changed["extra"] = true }
            if kind == "uuid" { changed["requestId"] = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" }
            if kind == "oversized" { changed["expected"] = ["id": "rename-section", "projectId": "focus-target", "title": String(repeating: "漢", count: 800_000)] }
            await expectFailure("INVALID_INPUT") {
                _ = try await core.call("projectSectionDelete", argumentsJSON: json([json(changed)]))
            }
        }
        for input in [["projectId": "focus-target", "sectionId": "missing-section"],
                      ["projectId": "focus-other-0", "sectionId": "rename-section"]] {
            await expectFailure("STALE_REVISION") {
                _ = try await core.call("projectSectionDeleteOptions", argumentsJSON: json([json(input)]))
            }
        }
        XCTAssertEqual(writes, 0); XCTAssertEqual(journals, 0)
        let checked = try SQLiteBridge(url: database)
        XCTAssertEqual(try nineTableSnapshot(checked), before)
        checked.close()
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        await core.close()

        let parent = directory!
        for kind in ["archived", "deleted-project", "deleted-section"] {
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await seedProjectRenameRows(targetStatus: kind == "archived" ? "archived" : "active",
                                            targetDeleted: kind == "deleted-project")
            if kind == "deleted-section" {
                let edit = try SQLiteBridge(url: database)
                _ = try edit.execute("UPDATE sections SET deletedAt = ? WHERE id = 'rename-section'",
                                     parametersJSON: json([recentAreaTestTime(daysAgo: 0)]))
                edit.close()
            }
            let policyFaults = HostIOFaults()
            let reader = host(policyFaults)
            _ = try await reader.start()
            var policyWrites = 0, policyJournals = 0
            policyFaults.beforeSQL = { statement in
                if statement.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:tasks|projects|areas|people|sections|settings|saved_filters|calendar_sync)\b"#,
                                   options: .regularExpression) != nil { policyWrites += 1 }
            }
            policyFaults.journalWrite = { policyJournals += 1 }
            if kind == "archived" {
                let archived = try object(await reader.call("projectSectionDeleteOptions",
                                                            argumentsJSON: json([json(["projectId": "focus-target", "sectionId": "rename-section"])])))
                XCTAssertEqual(archived["canDelete"] as? Bool, false)
                let blocked = try await projectSectionDeleteRequest(reader)
                await expectFailure("STALE_REVISION") {
                    _ = try await reader.call("projectSectionDelete", argumentsJSON: json([json(blocked)]))
                }
            } else {
                await expectFailure("STALE_REVISION") {
                    _ = try await reader.call("projectSectionDeleteOptions",
                                              argumentsJSON: json([json(["projectId": "focus-target", "sectionId": "rename-section"])]))
                }
            }
            XCTAssertEqual(policyWrites, 0); XCTAssertEqual(policyJournals, 0)
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            await reader.close()
            directory = parent
        }
    }

    func testProjectSectionDeleteColdFirstApplyAndFullReceiptAfterParentChangeAndNewDeletedTask() async throws {
        let parent = directory!
        for kind in ["first", "receipt"] {
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await seedProjectSectionDeleteRows()
            let faults = HostIOFaults()
            let writer = host(faults)
            _ = try await writer.start()
            let request = try await projectSectionDeleteRequest(writer)
            if kind == "first" {
                faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Section delete") } }
                await expectFailure("SAVE_FAILED") {
                    _ = try await writer.call("projectSectionDelete", argumentsJSON: json([json(request)]))
                }
            } else {
                var journalWrites = 0
                faults.journalWrite = { journalWrites += 1; if journalWrites == 2 { throw HostFailure("Injected Section delete lost reply") } }
                await expectFailure("lost reply") {
                    _ = try await writer.call("projectSectionDelete", argumentsJSON: json([json(request)]))
                }
            }
            XCTAssertEqual(try object(String(contentsOf: journal))["method"] as? String, "projectSectionDeleteCommit")
            await writer.close()
            if kind == "receipt" {
                let edit = try SQLiteBridge(url: database)
                let at = recentAreaTestTime(daysAgo: 0)
                _ = try edit.execute("UPDATE projects SET title = 'Later parent rename', rev = rev + 1, updatedAt = ? WHERE id = 'focus-target'",
                                     parametersJSON: json([at]))
                // A later deleted Task remains in the frozen scope but is not repaired by normal startup maintenance.
                _ = try edit.execute("INSERT INTO tasks (id, title, status, projectId, sectionId, createdAt, updatedAt, deletedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                     parametersJSON: json(["delete-late-task", "Later deleted linked task", "next", "focus-target", "rename-section", at, at, at, 1]))
                edit.close()
            }
            let beforeSQLite = try SQLiteBridge(url: database)
            let before = try nineTableSnapshot(beforeSQLite)
            beforeSQLite.close()
            let replayFaults = HostIOFaults()
            var rowWrites = 0
            replayFaults.beforeSQL = { statement in
                if statement.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:tasks|projects|areas|people|sections|settings|saved_filters|calendar_sync)\b"#,
                                   options: .regularExpression) != nil { rowWrites += 1 }
            }
            let reopened = host(replayFaults)
            let startup = try object(await reopened.start())
            let recovery = try XCTUnwrap(startup["recovery"] as? [String: Any])
            XCTAssertEqual(recovery["method"] as? String, "projectSectionDeleteCommit")
            let result = try XCTUnwrap(recovery["result"] as? [String: Any])
            XCTAssertEqual(Set(result.keys), Set(["id", "projectId"]))
            XCTAssertEqual(result["id"] as? String, "rename-section")
            XCTAssertEqual(result["projectId"] as? String, "focus-target")
            if kind == "receipt" {
                XCTAssertEqual(rowWrites, 0)
                let checked = try SQLiteBridge(url: database)
                XCTAssertEqual(try nineTableSnapshot(checked), before)
                checked.close()
                XCTAssertEqual(try storedTask("delete-late-task")["sectionId"] as? String, "rename-section")
                XCTAssertEqual(try projectRows("focus-target").first?["title"] as? String, "Later parent rename")
            } else { XCTAssertGreaterThan(rowWrites, 0) }
            XCTAssertTrue(try projectSectionRows("rename-section").first?["deletedAt"] is String)
            XCTAssertTrue(try storedTask("rename-task")["sectionId"] is NSNull)
            XCTAssertTrue(try storedTask("delete-tombstone-task")["sectionId"] is NSNull)
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            await reopened.close()
            directory = parent
        }
    }

    func testProjectSectionDeleteTerminalCleanupFailureColdReceiptAfterParentChange() async throws {
        try await seedProjectSectionDeleteRows()
        let faults = HostIOFaults()
        let writer = host(faults)
        _ = try await writer.start()
        let request = try await projectSectionDeleteRequest(writer)
        faults.journalRemove = { throw HostFailure("Injected Section delete cleanup failure") }
        await expectFailure("cleanup failure") {
            _ = try await writer.call("projectSectionDelete", argumentsJSON: json([json(request)]))
        }
        let retained = try object(String(contentsOf: journal))
        XCTAssertEqual(retained["method"] as? String, "projectSectionDeleteCommit")
        let terminal = try XCTUnwrap((retained["terminal"] as? [String: Any])?["success"] as? [String: String])
        let terminalResult = try object(XCTUnwrap(terminal["_0"]))
        XCTAssertEqual(terminalResult["id"] as? String, "rename-section")
        XCTAssertEqual(terminalResult["projectId"] as? String, "focus-target")
        await writer.close()
        let edit = try SQLiteBridge(url: database)
        _ = try edit.execute("UPDATE projects SET title = 'Later parent rename', rev = rev + 1, updatedAt = ? WHERE id = 'focus-target'",
                             parametersJSON: json([recentAreaTestTime(daysAgo: 0)]))
        let before = try nineTableSnapshot(edit)
        edit.close()
        let replayFaults = HostIOFaults()
        var rowWrites = 0
        replayFaults.beforeSQL = { statement in
            if statement.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:tasks|projects|areas|people|sections|settings|saved_filters|calendar_sync)\b"#,
                               options: .regularExpression) != nil { rowWrites += 1 }
        }
        let reopened = host(replayFaults)
        let startup = try object(await reopened.start())
        let recovery = try XCTUnwrap(startup["recovery"] as? [String: Any])
        XCTAssertEqual(recovery["method"] as? String, "projectSectionDeleteCommit")
        XCTAssertEqual(try json(XCTUnwrap(recovery["result"] as? [String: Any])), try json(terminalResult))
        let noPending = try await reopened.retryPending()
        XCTAssertNil(noPending)
        XCTAssertEqual(rowWrites, 0)
        let check = try SQLiteBridge(url: database)
        XCTAssertEqual(try nineTableSnapshot(check), before)
        check.close()
        XCTAssertTrue(try storedTask("rename-task")["sectionId"] is NSNull)
        XCTAssertTrue(try storedTask("delete-tombstone-task")["sectionId"] is NSNull)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        await reopened.close()
    }

    func testProjectSectionDeleteChangedParentTaskScopeAndPartialReceiptRefuseWithoutOverwrite() async throws {
        let parent = directory!
        for kind in ["parent", "task", "new-task", "partial-after"] {
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await seedProjectSectionDeleteRows()
            let faults = HostIOFaults()
            let writer = host(faults)
            _ = try await writer.start()
            let request = try await projectSectionDeleteRequest(writer)
            if kind == "partial-after" {
                var journalWrites = 0
                faults.journalWrite = { journalWrites += 1; if journalWrites == 2 { throw HostFailure("Injected Section delete lost reply") } }
                await expectFailure("lost reply") {
                    _ = try await writer.call("projectSectionDelete", argumentsJSON: json([json(request)]))
                }
            } else {
                faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Section delete") } }
                await expectFailure("SAVE_FAILED") {
                    _ = try await writer.call("projectSectionDelete", argumentsJSON: json([json(request)]))
                }
            }
            await writer.close()
            let edit = try SQLiteBridge(url: database)
            let at = recentAreaTestTime(daysAgo: 0)
            if kind == "parent" {
                _ = try edit.execute("UPDATE projects SET title = 'Newer parent', rev = rev + 1, updatedAt = ? WHERE id = 'focus-target'",
                                     parametersJSON: json([at]))
            } else if kind == "new-task" {
                _ = try edit.execute("INSERT INTO tasks (id, title, status, projectId, sectionId, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                                     parametersJSON: json(["delete-new-task", "New matching Task", "next", "focus-target", "rename-section", at, at, 1]))
            } else {
                _ = try edit.execute("UPDATE tasks SET description = 'Later description', rev = rev + 1, updatedAt = ? WHERE id = 'rename-task'",
                                     parametersJSON: json([at]))
            }
            let before = try nineTableSnapshot(edit)
            edit.close()
            let replayFaults = HostIOFaults()
            var rowWrites = 0
            replayFaults.beforeSQL = { statement in
                if statement.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:tasks|projects|areas|people|sections|settings|saved_filters|calendar_sync)\b"#,
                                   options: .regularExpression) != nil { rowWrites += 1 }
            }
            let blocked = host(replayFaults)
            await expectFailure("STALE_REVISION") { _ = try await blocked.start() }
            XCTAssertEqual(rowWrites, 0)
            XCTAssertTrue(FileManager.default.fileExists(atPath: journal.path))
            let checked = try SQLiteBridge(url: database)
            XCTAssertEqual(try nineTableSnapshot(checked), before)
            checked.close()
            await blocked.close()
            directory = parent
        }
    }

    func testProjectSectionDeleteForgedPendingTerminalAndMalformedJournalRefuseBeforeSQLite() async throws {
        try await seedProjectSectionDeleteRows()
        let faults = HostIOFaults()
        let writer = host(faults)
        _ = try await writer.start()
        let request = try await projectSectionDeleteRequest(writer)
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Section delete") } }
        await expectFailure("SAVE_FAILED") {
            _ = try await writer.call("projectSectionDelete", argumentsJSON: json([json(request)]))
        }
        let pending = try object(String(contentsOf: journal))
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(pending["argumentsJSON"] as? String).utf8)) as? [String])
        let original = try object(XCTUnwrap(args.first))
        let prepared = try XCTUnwrap(original["prepared"] as? [String: Any])
        await writer.close()
        for corruption in ["request", "parent", "dropped-task", "extra-task", "other-field", "timestamp", "result", "terminal", "malformed"] {
            var envelope = original
            var argumentsJSON = try XCTUnwrap(pending["argumentsJSON"] as? String)
            var terminal: [String: Any]? = nil
            switch corruption {
            case "request":
                var changed = try XCTUnwrap(envelope["request"] as? [String: Any])
                changed["sectionId"] = "delete-sibling-section"
                envelope["request"] = changed
                argumentsJSON = try json([json(envelope)])
            case "parent":
                var forged = prepared
                var scope = try XCTUnwrap(forged["scope"] as? [String: Any])
                var project = try XCTUnwrap(scope["project"] as? [String: Any])
                project["id"] = "different-parent"
                scope["project"] = project; forged["scope"] = scope; envelope["prepared"] = forged
                argumentsJSON = try json([json(envelope)])
            case "dropped-task", "extra-task", "other-field":
                var forged = prepared
                var effect = try XCTUnwrap(forged["effect"] as? [String: Any])
                var tasks = try XCTUnwrap(effect["tasks"] as? [[String: Any]])
                if corruption == "dropped-task" { tasks.removeLast() }
                if corruption == "extra-task" { tasks.append(try XCTUnwrap(tasks.first)) }
                if corruption == "other-field" {
                    var pair = try XCTUnwrap(tasks.first)
                    var after = try XCTUnwrap(pair["after"] as? [String: Any])
                    after["title"] = "Forged Task title"
                    pair["after"] = after; tasks[0] = pair
                }
                effect["tasks"] = tasks; forged["effect"] = effect; envelope["prepared"] = forged
                argumentsJSON = try json([json(envelope)])
            case "timestamp":
                var forged = prepared
                forged["preparedAt"] = recentAreaTestTime(daysAgo: 2)
                envelope["prepared"] = forged
                argumentsJSON = try json([json(envelope)])
            case "result":
                var forged = prepared
                var result = try XCTUnwrap(forged["result"] as? [String: Any])
                result["id"] = "delete-sibling-section"
                forged["result"] = result; envelope["prepared"] = forged
                argumentsJSON = try json([json(envelope)])
            case "terminal":
                terminal = ["success": ["_0": try json(["id": "delete-sibling-section", "projectId": "focus-target"])]]
            default: argumentsJSON = try json([["malformed": true]])
            }
            var forged: [String: Any] = ["version": 2, "method": "projectSectionDeleteCommit", "argumentsJSON": argumentsJSON]
            if let terminal { forged["terminal"] = terminal }
            let bytes = Data(try json(forged).utf8)
            try bytes.write(to: journal)
            let blockedFaults = HostIOFaults()
            var sql = 0, cleanup = 0
            blockedFaults.beforeSQL = { _ in sql += 1 }
            blockedFaults.journalRemove = { cleanup += 1 }
            let blocked = host(blockedFaults)
            await expectFailure { _ = try await blocked.start() }
            XCTAssertEqual(sql, 0); XCTAssertEqual(cleanup, 0)
            XCTAssertEqual(try Data(contentsOf: journal), bytes)
            await blocked.close()
        }
        let parent = directory!
        directory = parent.appendingPathComponent("no-database")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let malformed = Data(#"{"version":2,"method":"projectSectionDeleteCommit","argumentsJSON":"[]"}"#.utf8)
        try malformed.write(to: journal)
        XCTAssertFalse(FileManager.default.fileExists(atPath: database.path))
        let blocked = host()
        await expectFailure { _ = try await blocked.start() }
        XCTAssertFalse(FileManager.default.fileExists(atPath: database.path))
        XCTAssertEqual(try Data(contentsOf: journal), malformed)
        await blocked.close()
        directory = parent
    }

    func testProjectSectionOrderFailedCommitExactRetryPreservesUnrelatedRows() async throws {
        try await seedProjectSectionOrderRows()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let options = try object(await core.call("projectSectionOrderOptions",
                                                 argumentsJSON: json([json(["projectId": "focus-target"])])))
        XCTAssertEqual(options["canReorder"] as? Bool, true)
        let sections = try XCTUnwrap(options["sections"] as? [[String: Any]])
        XCTAssertEqual(sections.compactMap { $0["id"] as? String }, ["rename-section", "delete-sibling-section", "order-third"])
        XCTAssertEqual(sections.first?["canMoveUp"] as? Bool, false)
        XCTAssertEqual(sections.last?["canMoveDown"] as? Bool, false)
        let request = try await projectSectionOrderRequest(core)
        let before = try projectSectionRows()
        let beforeProjects = try json(projectRows())
        let beforeTask = try json(storedTask("rename-task"))
        var diagnostics: [String] = []
        faults.commandDiagnostic = { diagnostics.append($0) }
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected Section order COMMIT failure") } }
        await expectFailure("SAVE_FAILED") { _ = try await core.call("projectSectionOrder", argumentsJSON: json([json(request)])) }
        XCTAssertTrue(diagnostics.isEmpty)
        let frozen = try projectSectionOrderEnvelope()
        let effect = try XCTUnwrap((frozen["prepared"] as? [String: Any])?["effect"] as? [String: Any])
        let changes = try XCTUnwrap(effect["sections"] as? [[String: Any]])
        XCTAssertEqual(changes.count, 1)
        XCTAssertEqual(try json(projectSectionRows()), try json(before))
        faults.beforeSQL = nil
        let retry = try await core.retryPending()
        let result = try object(XCTUnwrap(retry))
        XCTAssertEqual(diagnostics, ["projectSectionOrderApplied"])
        XCTAssertEqual(result["projectId"] as? String, "focus-target")
        XCTAssertEqual(result["orderedIds"] as? [String], ["rename-section", "order-third", "delete-sibling-section"])
        let after = try projectSectionRows()
        let changedID = try XCTUnwrap((changes[0]["after"] as? [String: Any])?["id"] as? String)
        for old in before {
            let id = try XCTUnwrap(old["id"] as? String)
            let row = try XCTUnwrap(after.first { $0["id"] as? String == id })
            if id == changedID {
                XCTAssertEqual(row["rev"] as? Int, (old["rev"] as? Int ?? 0) + 1)
                for (field, value) in old where !["orderNum", "rev", "revBy", "updatedAt"].contains(field) {
                    XCTAssertEqual(try json([row[field] ?? NSNull()]), try json([value]), "\(id).\(field)")
                }
            } else { XCTAssertEqual(try json(row), try json(old), id) }
        }
        XCTAssertEqual(try json(projectRows()), beforeProjects)
        XCTAssertEqual(try json(storedTask("rename-task")), beforeTask)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        await expectFailure("STALE_REVISION") { _ = try await core.call("projectSectionOrder", argumentsJSON: json([json(request)])) }
        for method in ["projectSectionOrderPrepare", "projectSectionOrderValidate", "projectSectionOrderCommit"] {
            await expectFailure("unavailable") { _ = try await core.call(method, argumentsJSON: json([json(request)])) }
        }
        await core.close()
    }

    func testProjectSectionOrderColdFirstApplyReceiptAndTerminalCleanupAfterParentChange() async throws {
        for kind in ["first", "receipt", "terminal"] {
            let parent = directory!
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await seedProjectSectionOrderRows()
            let faults = HostIOFaults()
            let writer = host(faults)
            _ = try await writer.start()
            let request = try await projectSectionOrderRequest(writer)
            if kind == "first" {
                faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected cold Section order failure") } }
                await expectFailure("SAVE_FAILED") { _ = try await writer.call("projectSectionOrder", argumentsJSON: json([json(request)])) }
            } else if kind == "receipt" {
                var journalWrites = 0
                faults.journalWrite = { journalWrites += 1; if journalWrites == 2 { throw HostFailure("Injected Section order lost reply") } }
                await expectFailure("lost reply") { _ = try await writer.call("projectSectionOrder", argumentsJSON: json([json(request)])) }
            } else {
                faults.journalRemove = { throw HostFailure("Injected Section order terminal cleanup failure") }
                await expectFailure("terminal cleanup") { _ = try await writer.call("projectSectionOrder", argumentsJSON: json([json(request)])) }
            }
            let frozen = try projectSectionOrderEnvelope()
            XCTAssertEqual(((frozen["prepared"] as? [String: Any])?["result"] as? [String: Any])?["orderedIds"] as? [String],
                           ["rename-section", "order-third", "delete-sibling-section"])
            await writer.close()
            if kind != "first" {
                let edit = try SQLiteBridge(url: database)
                let at = recentAreaTestTime()
                _ = try edit.execute("UPDATE projects SET title = 'Later parent edit', status = 'waiting', rev = rev + 1 WHERE id = 'focus-target'", parametersJSON: "[]")
                _ = try edit.execute("INSERT INTO sections (id, projectId, title, orderNum, isCollapsed, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                                     parametersJSON: json(["order-later", "focus-target", "Later section", 300, 0, at, at, 1]))
                edit.close()
            }
            let before = try json(projectSectionRows())
            let replayFaults = HostIOFaults()
            var writes = 0
            replayFaults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:sections|projects|tasks)\b"#,
                             options: .regularExpression) != nil { writes += 1 }
            }
            let reopened = host(replayFaults)
            let startup = try object(await reopened.start())
            let recovery = try XCTUnwrap(startup["recovery"] as? [String: Any])
            XCTAssertEqual(recovery["method"] as? String, "projectSectionOrderCommit")
            XCTAssertEqual((recovery["result"] as? [String: Any])?["orderedIds"] as? [String],
                           ["rename-section", "order-third", "delete-sibling-section"])
            if kind != "first" {
                XCTAssertEqual(writes, 0)
                XCTAssertEqual(try json(projectSectionRows()), before)
                XCTAssertEqual(try projectRows("focus-target").first?["status"] as? String, "waiting")
                XCTAssertEqual(try projectRows("focus-target").first?["title"] as? String, "Later parent edit")
                XCTAssertEqual(try projectSectionRows("order-later").first?["orderNum"] as? Int, 300)
            } else {
                XCTAssertEqual(try projectSectionRows("order-third").first?["orderNum"] as? Int, 50)
            }
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            await reopened.close()
            directory = parent
        }
    }

    func testProjectSectionOrderEdgesArchivedAndNilPendingProbeWriteNothing() async throws {
        try await seedProjectSectionOrderRows()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        var writes = 0, journals = 0
        faults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+"#,
                         options: .regularExpression) != nil { writes += 1 }
        }
        faults.journalWrite = { journals += 1 }
        let top = try await projectSectionOrderRequest(core, sectionID: "rename-section", direction: "up")
        await expectFailure("STALE_REVISION") { _ = try await core.call("projectSectionOrder", argumentsJSON: json([json(top)])) }
        let bottom = try await projectSectionOrderRequest(core, sectionID: "order-third", direction: "down")
        await expectFailure("STALE_REVISION") { _ = try await core.call("projectSectionOrder", argumentsJSON: json([json(bottom)])) }
        await expectFailure("STALE_REVISION") { _ = try await core.call("projectSectionOrderRetryOutcome", argumentsJSON: json([json(top)])) }
        var invalid = top
        invalid["requestId"] = UUID().uuidString.uppercased()
        await expectFailure("INVALID_INPUT") { _ = try await core.call("projectSectionOrder", argumentsJSON: json([json(invalid)])) }
        XCTAssertEqual(writes, 0); XCTAssertEqual(journals, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        await core.close()
        let edit = try SQLiteBridge(url: database)
        _ = try edit.execute("UPDATE projects SET status = 'archived' WHERE id = 'focus-target'", parametersJSON: "[]")
        edit.close()
        let archived = host()
        _ = try await archived.start()
        let options = try object(await archived.call("projectSectionOrderOptions",
                                                   argumentsJSON: json([json(["projectId": "focus-target"])])))
        XCTAssertEqual(options["canReorder"] as? Bool, false)
        let archivedSections = try XCTUnwrap(options["sections"] as? [[String: Any]])
        XCTAssertEqual(archivedSections.count, 3)
        XCTAssertTrue(archivedSections.allSatisfy { $0["canMoveUp"] as? Bool == false && $0["canMoveDown"] as? Bool == false })
        await expectFailure("STALE_REVISION") { _ = try await archived.call("projectSectionOrder", argumentsJSON: json([json(top)])) }
        await archived.close()
    }

    func testProjectSectionOrderStaleFullScopeAndPartialReceiptRefuseWithoutOverwrite() async throws {
        for kind in ["new-section", "partial-receipt"] {
            let parent = directory!
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await seedProjectSectionOrderRows()
            if kind == "partial-receipt" {
                // No integer fits between 0 and 1, so the shared sparse planner rebalances two rows.
                let dense = try SQLiteBridge(url: database)
                _ = try dense.execute("UPDATE sections SET orderNum = 1 WHERE id = 'delete-sibling-section'", parametersJSON: "[]")
                _ = try dense.execute("UPDATE sections SET orderNum = 2 WHERE id = 'order-third'", parametersJSON: "[]")
                dense.close()
            }
            let faults = HostIOFaults()
            let writer = host(faults)
            _ = try await writer.start()
            let request = try await projectSectionOrderRequest(writer)
            if kind == "new-section" {
                faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Section order") } }
                await expectFailure("SAVE_FAILED") { _ = try await writer.call("projectSectionOrder", argumentsJSON: json([json(request)])) }
            } else {
                var journalWrites = 0
                faults.journalWrite = { journalWrites += 1; if journalWrites == 2 { throw HostFailure("Injected Section order lost reply") } }
                await expectFailure("lost reply") { _ = try await writer.call("projectSectionOrder", argumentsJSON: json([json(request)])) }
            }
            let frozen = try projectSectionOrderEnvelope()
            let effect = try XCTUnwrap((frozen["prepared"] as? [String: Any])?["effect"] as? [String: Any])
            let changes = try XCTUnwrap(effect["sections"] as? [[String: Any]])
            if kind == "partial-receipt" { XCTAssertGreaterThanOrEqual(changes.count, 2) }
            await writer.close()
            let edit = try SQLiteBridge(url: database)
            if kind == "new-section" {
                let at = recentAreaTestTime()
                _ = try edit.execute("INSERT INTO sections (id, projectId, title, orderNum, isCollapsed, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                                     parametersJSON: json(["order-later", "focus-target", "Later", 300, 0, at, at, 1]))
            } else {
                let original = try XCTUnwrap(changes.first?["before"] as? [String: Any])
                let id = try XCTUnwrap(original["id"] as? String)
                _ = try edit.execute("UPDATE sections SET orderNum = ?, rev = ?, revBy = ?, updatedAt = ? WHERE id = ?",
                                     parametersJSON: json([original["order"] ?? NSNull(), original["rev"] ?? NSNull(),
                                                           original["revBy"] ?? NSNull(), original["updatedAt"] ?? NSNull(), id]))
            }
            edit.close()
            let before = try json(projectSectionRows())
            let replayFaults = HostIOFaults()
            var writes = 0
            replayFaults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:sections|projects|tasks)\b"#,
                             options: .regularExpression) != nil { writes += 1 }
            }
            let replay = host(replayFaults)
            await expectFailure("STALE_REVISION") { _ = try await replay.start() }
            XCTAssertEqual(writes, 0)
            XCTAssertEqual(try json(projectSectionRows()), before)
            XCTAssertTrue(FileManager.default.fileExists(atPath: journal.path))
            await replay.close()
            directory = parent
        }
    }

    func testProjectSectionOrderForgedPendingAndTerminalJournalsRefuseBeforeSQLite() async throws {
        try await seedProjectSectionOrderRows()
        let faults = HostIOFaults()
        let writer = host(faults)
        _ = try await writer.start()
        let request = try await projectSectionOrderRequest(writer)
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Section order") } }
        await expectFailure("SAVE_FAILED") { _ = try await writer.call("projectSectionOrder", argumentsJSON: json([json(request)])) }
        let saved = try object(String(contentsOf: journal))
        let original = try projectSectionOrderEnvelope()
        await writer.close()
        let databaseBytes = try Data(contentsOf: database)
        for corruption in ["request", "effect", "result", "terminal", "malformed"] {
            var envelope = original
            var forged = saved
            if corruption == "request" {
                var changed = try XCTUnwrap(envelope["request"] as? [String: Any])
                changed["direction"] = "down"
                envelope["request"] = changed
            } else if corruption == "effect" {
                var prepared = try XCTUnwrap(envelope["prepared"] as? [String: Any])
                var effect = try XCTUnwrap(prepared["effect"] as? [String: Any])
                effect["sections"] = []
                prepared["effect"] = effect
                envelope["prepared"] = prepared
            } else if corruption == "result" {
                var prepared = try XCTUnwrap(envelope["prepared"] as? [String: Any])
                prepared["result"] = ["projectId": "focus-target", "orderedIds": ["rename-section", "delete-sibling-section", "order-third"]]
                envelope["prepared"] = prepared
            } else if corruption == "terminal" {
                forged["terminal"] = ["success": ["_0": try json(["projectId": "focus-target", "orderedIds": ["order-third"]])]]
            }
            forged["argumentsJSON"] = corruption == "malformed" ? "[]" : try json([json(envelope)])
            let bytes = Data(try json(forged).utf8)
            try bytes.write(to: journal)
            let blockedFaults = HostIOFaults()
            var statements = 0, removals = 0
            blockedFaults.beforeSQL = { _ in statements += 1 }
            blockedFaults.journalRemove = { removals += 1 }
            let blocked = host(blockedFaults)
            await expectFailure { _ = try await blocked.start() }
            XCTAssertEqual(statements, 0, corruption)
            XCTAssertEqual(removals, 0, corruption)
            XCTAssertEqual(try Data(contentsOf: database), databaseBytes, corruption)
            XCTAssertEqual(try Data(contentsOf: journal), bytes, corruption)
            await blocked.close()
        }
    }

    func testProjectCreateOptionsAllAreasDefaultAndDuplicateDoesNotWrite() async throws {
        let bootstrap = host()
        _ = try await bootstrap.start()
        await bootstrap.close()
        let sqlite = try SQLiteBridge(url: database)
        let at = "2026-09-27T12:00:00.000Z"
        for index in 0..<130 {
            _ = try sqlite.execute("INSERT INTO areas (id, name, orderNum, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?)",
                                   parametersJSON: json(["project-area-\(index)", "Area \(index)", index, at, at, 1]))
        }
        sqlite.close()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let options = try object(await core.call("projectCreateOptions"))
        XCTAssertEqual((options["areas"] as? [[String: Any]])?.count, 130)
        XCTAssertTrue(options["defaultAreaId"] is NSNull)
        XCTAssertNotNil(options["areaFilterValue"] as? String)
        let areaView = try object(await core.call("areaFilter"))
        let areaOption = try XCTUnwrap((areaView["options"] as? [[String: Any]])?.first { $0["id"] as? String == "project-area-129" })
        _ = try await core.call("setAreaFilter", argumentsJSON: json([json(XCTUnwrap(areaOption["next"]))]))
        let selected = try object(await core.call("projectCreateOptions"))
        XCTAssertEqual(selected["defaultAreaId"] as? String, "project-area-129")
        XCTAssertEqual((selected["areas"] as? [[String: Any]])?.count, 130)
        let id = UUID().uuidString.lowercased()
        let request = projectCreateRequest(id, title: "  New project  ", areaId: "project-area-129")
        var writes = 0, journalWrites = 0
        faults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+projects\b"#, options: .regularExpression) != nil {
                writes += 1
                XCTAssertTrue(FileManager.default.fileExists(atPath: self.journal.path))
            }
        }
        faults.journalWrite = { journalWrites += 1 }
        let result = try object(await core.call("projectCreate", argumentsJSON: json([json(request)])))
        XCTAssertEqual(result["id"] as? String, id)
        XCTAssertEqual(result["created"] as? Bool, true)
        XCTAssertEqual(writes, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        let first = try XCTUnwrap(projectRows(id).first)
        XCTAssertEqual(first["areaId"] as? String, "project-area-129")
        let afterCreateOptions = try object(await core.call("projectCreateOptions"))
        XCTAssertEqual(afterCreateOptions["defaultAreaId"] as? String, "project-area-129")
        XCTAssertEqual(afterCreateOptions["areaFilterValue"] as? String, selected["areaFilterValue"] as? String)
        let priorJournalWrites = journalWrites
        let duplicate = try object(await core.call("projectCreate", argumentsJSON: json([json(projectCreateRequest(title: "New project", areaId: "project-area-129"))])))
        XCTAssertEqual(duplicate["id"] as? String, id)
        XCTAssertEqual(duplicate["created"] as? Bool, false)
        XCTAssertEqual(writes, 1); XCTAssertEqual(journalWrites, priorJournalWrites)
        XCTAssertEqual(try projectRows(id).count, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        for method in ["projectCreatePrepare", "projectCreateValidate", "projectCreateCommit"] {
            await expectFailure("unavailable") { _ = try await core.call(method, argumentsJSON: json([json(request)])) }
        }
    }

    func testProjectCreateFailedCommitExactRetryAndPreservesUnrelatedRows() async throws {
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let oldID = UUID().uuidString.lowercased()
        _ = try await core.call("projectCreate", argumentsJSON: json([json(projectCreateRequest(oldID, title: "Existing sibling"))]))
        let preserved = try json(XCTUnwrap(projectRows(oldID).first))
        let id = UUID().uuidString.lowercased()
        let request = projectCreateRequest(id, title: "Atomic project")
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected project COMMIT failure") } }
        await expectFailure("SAVE_FAILED") { _ = try await core.call("projectCreate", argumentsJSON: json([json(request)])) }
        XCTAssertEqual(try object(String(contentsOf: journal))["method"] as? String, "projectCreateCommit")
        XCTAssertEqual(try projectRows(id).count, 0)
        faults.beforeSQL = nil
        let retryValue = try await core.retryPending()
        let retry = try object(XCTUnwrap(retryValue))
        XCTAssertEqual(retry["id"] as? String, id)
        XCTAssertEqual(retry["created"] as? Bool, true)
        XCTAssertEqual(try projectRows(id).count, 1)
        XCTAssertEqual(try json(XCTUnwrap(projectRows(oldID).first)), preserved)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testProjectCreateLostPublicResponseProbesExactUUIDWithoutSecondInsert() async throws {
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let id = UUID().uuidString.lowercased()
        let request = projectCreateRequest(id, title: "Response already cleaned")
        var writes = 0
        faults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+projects\b"#, options: .regularExpression) != nil { writes += 1 }
        }
        let saved = try object(await core.call("projectCreate", argumentsJSON: json([json(request)])))
        XCTAssertEqual(saved["id"] as? String, id)
        XCTAssertEqual(saved["created"] as? Bool, true)
        let settled = try await core.retryPending()
        XCTAssertNil(settled)
        let before = try json(XCTUnwrap(projectRows(id).first))
        let repeated = try object(await core.call("projectCreateRetryOutcome", argumentsJSON: json([json(request)])))
        XCTAssertEqual(repeated["id"] as? String, id)
        XCTAssertEqual(repeated["created"] as? Bool, false)
        XCTAssertEqual(writes, 1)
        XCTAssertEqual(try json(XCTUnwrap(projectRows(id).first)), before)
        await core.close()

        let sqlite = try SQLiteBridge(url: database)
        _ = try sqlite.execute("UPDATE projects SET title = 'Later renamed project', rev = rev + 1 WHERE id = ?", parametersJSON: json([id]))
        sqlite.close()
        let changed = try json(XCTUnwrap(projectRows(id).first))
        let reopenedFaults = HostIOFaults()
        let reopened = host(reopenedFaults)
        _ = try await reopened.start()
        var retryWrites = 0
        reopenedFaults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+projects\b"#, options: .regularExpression) != nil { retryWrites += 1 }
        }
        await expectFailure("STALE_REVISION") { _ = try await reopened.call("projectCreateRetryOutcome", argumentsJSON: json([json(request)])) }
        XCTAssertEqual(retryWrites, 0)
        XCTAssertEqual(try projectRows(id).count, 1)
        XCTAssertEqual(try json(XCTUnwrap(projectRows(id).first)), changed)
    }

    func testProjectCreateRetryProbeRefusesChangedOrRemovedTargetsWithoutWrites() async throws {
        let writer = host()
        _ = try await writer.start()
        let cases = ["Deleted", "Purged", "Renamed", "Moved", "Different duplicate", "Missing"]
        var requests: [String: [String: Any]] = [:]
        for name in cases {
            let request = projectCreateRequest(title: "Retry \(name)")
            requests[name] = request
            _ = try await writer.call("projectCreate", argumentsJSON: json([json(request)]))
        }
        await writer.close()

        let sqlite = try SQLiteBridge(url: database)
        let at = ISO8601DateFormatter().string(from: Date())
        let id = { (name: String) in requests[name]!["requestId"] as! String }
        _ = try sqlite.execute("INSERT INTO areas (id, name, orderNum, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["retry-area", "Moved area", 0, at, at, 1]))
        _ = try sqlite.execute("UPDATE projects SET deletedAt = ?, rev = rev + 1 WHERE id = ?",
                               parametersJSON: json([at, id("Deleted")]))
        _ = try sqlite.execute("UPDATE projects SET deletedAt = ?, purgedAt = ?, title = '(deleted)', rev = rev + 1 WHERE id = ?",
                               parametersJSON: json([at, at, id("Purged")]))
        _ = try sqlite.execute("UPDATE projects SET title = 'Later name', rev = rev + 1 WHERE id = ?",
                               parametersJSON: json([id("Renamed")]))
        _ = try sqlite.execute("UPDATE projects SET areaId = 'retry-area', rev = rev + 1 WHERE id = ?",
                               parametersJSON: json([id("Moved")]))
        _ = try sqlite.execute("UPDATE projects SET title = 'Later different name', rev = rev + 1 WHERE id = ?",
                               parametersJSON: json([id("Different duplicate")]))
        _ = try sqlite.execute("INSERT INTO projects (id, title, status, color, orderNum, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json([UUID().uuidString.lowercased(), "Retry Different duplicate", "active", "#94a3b8", 100, at, at, 1]))
        _ = try sqlite.execute("DELETE FROM projects WHERE id = ?", parametersJSON: json([id("Missing")]))
        sqlite.close()

        let faults = HostIOFaults()
        let reader = host(faults)
        _ = try await reader.start()
        let before = try json(projectRows())
        var writes = 0
        faults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+projects\b"#, options: .regularExpression) != nil { writes += 1 }
        }
        for name in cases {
            let request = try XCTUnwrap(requests[name])
            await expectFailure("STALE_REVISION") {
                _ = try await reader.call("projectCreateRetryOutcome", argumentsJSON: json([json(request)]))
            }
        }
        XCTAssertEqual(writes, 0)
        XCTAssertEqual(try json(projectRows()), before)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testProjectCreateLostReplyColdRecoveryAndChangedTargetRefusal() async throws {
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let id = UUID().uuidString.lowercased()
        var journalWrites = 0
        faults.journalWrite = { journalWrites += 1; if journalWrites == 2 { throw HostFailure("Injected project lost reply") } }
        await expectFailure("lost reply") { _ = try await core.call("projectCreate", argumentsJSON: json([json(projectCreateRequest(id, title: "Recovered project"))])) }
        XCTAssertEqual(try projectRows(id).count, 1)
        let saved = try json(XCTUnwrap(projectRows(id).first))
        await core.close()
        // The first-apply order guard is stale, but the created row remains an
        // exact receipt. Recovery must acknowledge it before inspecting order.
        let siblingID = UUID().uuidString.lowercased()
        let siblingSQLite = try SQLiteBridge(url: database)
        let at = "2026-09-27T12:00:00.000Z"
        _ = try siblingSQLite.execute("INSERT INTO projects (id, title, status, color, areaId, orderNum, isSequential, isFocused, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json([siblingID, "Independent higher-order project", "active", "#94a3b8", NSNull(), 999, 0, 0, at, at, 1]))
        siblingSQLite.close()
        let sibling = try json(XCTUnwrap(projectRows(siblingID).first))
        let replayFaults = HostIOFaults()
        var writes = 0
        replayFaults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+projects\b"#, options: .regularExpression) != nil { writes += 1 }
        }
        let reopened = host(replayFaults)
        let startup = try object(await reopened.start())
        let recovery = try XCTUnwrap(startup["recovery"] as? [String: Any])
        XCTAssertEqual(recovery["method"] as? String, "projectCreateCommit")
        let recovered = try XCTUnwrap(recovery["result"] as? [String: Any])
        XCTAssertEqual(recovered["id"] as? String, id)
        XCTAssertEqual(recovered["created"] as? Bool, true)
        let projects = try object(await reopened.call("projects"))
        let active = try XCTUnwrap(projects["active"] as? [[String: Any]])
        let visibleIDs = active.flatMap { $0["projects"] as? [[String: Any]] ?? [] }.compactMap { $0["id"] as? String }
        XCTAssertTrue(visibleIDs.contains(id))
        XCTAssertEqual(writes, 0)
        XCTAssertEqual(try json(XCTUnwrap(projectRows(id).first)), saved)
        XCTAssertEqual(try json(XCTUnwrap(projectRows(siblingID).first)), sibling)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        await reopened.close()

        let changedFaults = HostIOFaults()
        let writer = host(changedFaults)
        _ = try await writer.start()
        let changedID = UUID().uuidString.lowercased()
        var changedWrites = 0
        changedFaults.journalWrite = { changedWrites += 1; if changedWrites == 2 { throw HostFailure("Injected project lost reply") } }
        await expectFailure("lost reply") { _ = try await writer.call("projectCreate", argumentsJSON: json([json(projectCreateRequest(changedID, title: "Change me"))])) }
        await writer.close()
        let changedSQLite = try SQLiteBridge(url: database)
        _ = try changedSQLite.execute("UPDATE projects SET title = 'Later edit', rev = rev + 1 WHERE id = ?", parametersJSON: json([changedID]))
        changedSQLite.close()
        let before = try json(XCTUnwrap(projectRows(changedID).first))
        let blocked = host()
        await expectFailure { _ = try await blocked.start() }
        XCTAssertEqual(try json(XCTUnwrap(projectRows(changedID).first)), before)
        XCTAssertTrue(FileManager.default.fileExists(atPath: journal.path))
    }

    func testProjectCreateTerminalCleanupFailureReopensWithoutSecondWrite() async throws {
        let faults = HostIOFaults()
        let writer = host(faults)
        _ = try await writer.start()
        let id = UUID().uuidString.lowercased()
        faults.journalRemove = { throw HostFailure("Injected project cleanup failure") }
        await expectFailure("cleanup failure") { _ = try await writer.call("projectCreate", argumentsJSON: json([json(projectCreateRequest(id, title: "Cleanup project"))])) }
        XCTAssertEqual(try projectRows(id).count, 1)
        let terminal = try object(String(contentsOf: journal))
        XCTAssertEqual(terminal["method"] as? String, "projectCreateCommit")
        XCTAssertNotNil(terminal["terminal"])
        await writer.close()
        let replayFaults = HostIOFaults()
        var writes = 0
        replayFaults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+projects\b"#, options: .regularExpression) != nil { writes += 1 }
        }
        let reopened = host(replayFaults)
        let startup = try object(await reopened.start())
        let recovery = try XCTUnwrap(startup["recovery"] as? [String: Any])
        XCTAssertEqual(recovery["method"] as? String, "projectCreateCommit")
        XCTAssertEqual((recovery["result"] as? [String: Any])?["id"] as? String, id)
        XCTAssertEqual(writes, 0)
        XCTAssertEqual(try projectRows(id).count, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testProjectCreateForgedJournalsRefuseBeforeSQLiteAndCleanup() async throws {
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let request = projectCreateRequest(title: "Journal authority")
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected project COMMIT failure") } }
        await expectFailure("SAVE_FAILED") { _ = try await core.call("projectCreate", argumentsJSON: json([json(request)])) }
        let pending = try object(String(contentsOf: journal))
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(pending["argumentsJSON"] as? String).utf8)) as? [String])
        let original = try object(XCTUnwrap(args.first))
        let prepared = try XCTUnwrap(original["prepared"] as? [String: Any])
        let expected = try XCTUnwrap(prepared["result"] as? [String: Any])
        await core.close()
        for corruption in ["request", "prepared", "terminal", "oversized", "raw"] {
            var envelope = original
            var method = "projectCreateCommit"
            var argumentsJSON = try XCTUnwrap(pending["argumentsJSON"] as? String)
            var terminal: [String: Any]? = nil
            switch corruption {
            case "request":
                var request = try XCTUnwrap(envelope["request"] as? [String: Any])
                request["requestId"] = UUID().uuidString.lowercased()
                envelope["request"] = request
                argumentsJSON = try json([json(envelope)])
            case "prepared":
                var forged = prepared
                var row = try XCTUnwrap(forged["project"] as? [String: Any])
                row["title"] = "Forged"
                forged["project"] = row
                envelope["prepared"] = forged
                argumentsJSON = try json([json(envelope)])
            case "terminal":
                var wrong = expected; wrong["id"] = UUID().uuidString.lowercased()
                terminal = ["success": ["_0": try json(wrong)]]
            case "oversized": argumentsJSON = try json([String(repeating: "x", count: 2_000_001)])
            default: method = "projectCreate"; argumentsJSON = try json([json(request)])
            }
            var forged: [String: Any] = ["version": 2, "method": method, "argumentsJSON": argumentsJSON]
            if let terminal { forged["terminal"] = terminal }
            let bytes = Data(try json(forged).utf8)
            try bytes.write(to: journal)
            let blockedFaults = HostIOFaults()
            var sql = 0, cleanup = 0
            blockedFaults.beforeSQL = { _ in sql += 1 }
            blockedFaults.journalRemove = { cleanup += 1 }
            let blocked = host(blockedFaults)
            await expectFailure { _ = try await blocked.start() }
            XCTAssertEqual(sql, 0); XCTAssertEqual(cleanup, 0)
            XCTAssertEqual(try Data(contentsOf: journal), bytes)
            await blocked.close()
        }
    }

    func testAreaCreateOptionsResolutionFreshWriteDuplicateAndReadOnlyProbe() async throws {
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let options = try object(await core.call("areaCreateOptions"))
        XCTAssertEqual(options["defaultColor"] as? String, "#3b82f6")
        XCTAssertEqual((options["colors"] as? [String])?.count, 12)
        let id = UUID().uuidString.lowercased()
        let resolution = try object(await core.call("areaCreateResolve", argumentsJSON: json([json(["requestId": id, "name": " Work "])])))
        XCTAssertEqual(resolution["expectedAreaId"] as? String, id)
        XCTAssertEqual(resolution["taken"] as? Bool, false)
        let request = areaCreateRequest(id, name: " Work ")
        var areaWrites = 0, journalWrites = 0
        faults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+areas\b"#, options: .regularExpression) != nil {
                areaWrites += 1
                XCTAssertTrue(FileManager.default.fileExists(atPath: self.journal.path))
            }
        }
        faults.journalWrite = { journalWrites += 1 }
        let created = try object(await core.call("areaCreate", argumentsJSON: json([json(request)])))
        XCTAssertEqual(created["id"] as? String, id)
        XCTAssertEqual(created["created"] as? Bool, true)
        XCTAssertEqual(areaWrites, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        let saved = try XCTUnwrap(areaRows(id).first)
        XCTAssertEqual(saved["name"] as? String, "Work")
        XCTAssertEqual(saved["color"] as? String, "#3b82f6")
        XCTAssertEqual(saved["rev"] as? Int, 1)
        let taken = try object(await core.call("areaCreateResolve", argumentsJSON: json([json(["requestId": UUID().uuidString.lowercased(), "name": " work "])])))
        XCTAssertEqual(taken["expectedAreaId"] as? String, id)
        XCTAssertEqual(taken["taken"] as? Bool, true)
        let noPending = try await core.retryPending()
        XCTAssertNil(noPending)
        let before = areaWrites, beforeJournal = journalWrites
        let duplicateRequest = areaCreateRequest(name: " work ", color: "#ef4444", expectedID: id)
        let duplicate = try object(await core.call("areaCreate", argumentsJSON: json([json(duplicateRequest)])))
        XCTAssertEqual(duplicate["id"] as? String, id)
        XCTAssertEqual(duplicate["created"] as? Bool, false)
        let probe = try object(await core.call("areaCreateRetryOutcome", argumentsJSON: json([json(request)])))
        XCTAssertEqual(probe["id"] as? String, id)
        XCTAssertEqual(probe["created"] as? Bool, false)
        XCTAssertEqual(areaWrites, before)
        XCTAssertEqual(journalWrites, beforeJournal)
        XCTAssertEqual(try json(XCTUnwrap(areaRows(id).first)), try json(saved))
        for method in ["areaCreatePrepare", "areaCreateValidate", "areaCreateCommit"] {
            await expectFailure("unavailable") { _ = try await core.call(method, argumentsJSON: json([json(request)])) }
        }
    }

    func testAreaCreateLegacyRestoreFailedCommitIsAtomicAndExactRetryRestoresAllRows() async throws {
        let bootstrap = host()
        _ = try await bootstrap.start()
        await bootstrap.close()
        let deletedAt = recentAreaTestTime()
        let otherDeletedAt = recentAreaTestTime(daysAgo: 2)
        let areaID = "legacy-area"
        let sqlite = try SQLiteBridge(url: database)
        _ = try sqlite.execute("INSERT INTO areas (id, name, color, orderNum, createdAt, updatedAt, deletedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json([areaID, "Work", "#22c55e", 1.5, deletedAt, deletedAt, deletedAt, 2]))
        _ = try sqlite.execute("INSERT INTO projects (id, title, status, color, areaId, orderNum, isSequential, isFocused, createdAt, updatedAt, deletedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["legacy-project", "Linked", "active", "#22c55e", areaID, 0, 0, 0, deletedAt, deletedAt, deletedAt, 3]))
        _ = try sqlite.execute("INSERT INTO projects (id, title, status, color, areaId, orderNum, isSequential, isFocused, createdAt, updatedAt, deletedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["other-deleted-project", "Other deletion", "active", "#22c55e", areaID, 1, 0, 0, deletedAt, otherDeletedAt, otherDeletedAt, 7]))
        _ = try sqlite.execute("INSERT INTO sections (id, projectId, title, orderNum, createdAt, updatedAt, deletedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["legacy-section", "legacy-project", "Planning", 0, deletedAt, deletedAt, deletedAt, 4]))
        _ = try sqlite.execute("INSERT INTO tasks (id, title, status, areaId, tags, contexts, isFocusedToday, showFutureRecurrence, suppressMindwtrReminders, pushCount, createdAt, updatedAt, deletedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["legacy-direct-task", "Direct", "next", areaID, "[]", "[]", 0, 0, 0, 0, deletedAt, deletedAt, deletedAt, 5]))
        _ = try sqlite.execute("INSERT INTO tasks (id, title, status, projectId, sectionId, tags, contexts, isFocusedToday, showFutureRecurrence, suppressMindwtrReminders, pushCount, createdAt, updatedAt, deletedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["legacy-project-task", "Project child", "next", "legacy-project", "legacy-section", "[]", "[]", 0, 0, 0, 0, deletedAt, deletedAt, deletedAt, 6]))
        sqlite.close()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let id = UUID().uuidString.lowercased()
        let resolution = try object(await core.call("areaCreateResolve", argumentsJSON: json([json(["requestId": id, "name": " work "])])))
        XCTAssertEqual(resolution["expectedAreaId"] as? String, areaID)
        let request = areaCreateRequest(id, name: " work ", color: "#ef4444", expectedID: areaID)
        let beforeSQLite = try SQLiteBridge(url: database)
        let before = try ["areas", "projects", "sections", "tasks", "settings"].map { table in
            try beforeSQLite.execute("SELECT * FROM \(table) ORDER BY id")
        }
        beforeSQLite.close()
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected Area COMMIT failure") } }
        await expectFailure("SAVE_FAILED") { _ = try await core.call("areaCreate", argumentsJSON: json([json(request)])) }
        XCTAssertEqual(try object(String(contentsOf: journal))["method"] as? String, "areaCreateCommit")
        let failedSQLite = try SQLiteBridge(url: database)
        let failed = try ["areas", "projects", "sections", "tasks", "settings"].map { table in
            try failedSQLite.execute("SELECT * FROM \(table) ORDER BY id")
        }
        failedSQLite.close()
        XCTAssertEqual(
            try failed.map { try json(JSONSerialization.jsonObject(with: Data($0.utf8))) },
            try before.map { try json(JSONSerialization.jsonObject(with: Data($0.utf8))) }
        )
        faults.beforeSQL = nil
        let retryValue = try await core.retryPending()
        let retry = try object(XCTUnwrap(retryValue))
        XCTAssertEqual(retry["id"] as? String, areaID)
        XCTAssertEqual(retry["created"] as? Bool, true)
        let restored = try XCTUnwrap(areaRows(areaID).first)
        XCTAssertEqual(restored["name"] as? String, "work")
        XCTAssertEqual(restored["color"] as? String, "#ef4444")
        XCTAssertEqual(restored["rev"] as? Int, 4)
        XCTAssertTrue(restored["deletedAt"] is NSNull)
        let project = try XCTUnwrap(projectRows("legacy-project").first)
        XCTAssertEqual(project["color"] as? String, "#ef4444")
        XCTAssertEqual(project["areaTitle"] as? String, "work")
        XCTAssertEqual(project["rev"] as? Int, 5)
        XCTAssertTrue(project["deletedAt"] is NSNull)
        let independent = try XCTUnwrap(projectRows("other-deleted-project").first)
        XCTAssertEqual(independent["color"] as? String, "#ef4444")
        XCTAssertEqual(independent["rev"] as? Int, 8)
        XCTAssertEqual(independent["deletedAt"] as? String, otherDeletedAt)
        let check = try SQLiteBridge(url: database)
        let sections = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(check.execute("SELECT * FROM sections WHERE id = 'legacy-section'").utf8)) as? [[String: Any]])
        let tasks = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(check.execute("SELECT * FROM tasks WHERE id LIKE 'legacy-%' ORDER BY id").utf8)) as? [[String: Any]])
        check.close()
        XCTAssertEqual(sections.first?["rev"] as? Int, 5)
        XCTAssertTrue(sections.first?["deletedAt"] is NSNull)
        XCTAssertEqual(tasks.count, 2)
        XCTAssertTrue(tasks.allSatisfy { $0["deletedAt"] is NSNull })
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testAreaCreateNilPendingProbePreservesLaterEditsAndNeverWrites() async throws {
        let writer = host()
        _ = try await writer.start()
        let cases = ["Color", "Deleted", "Purged", "Renamed", "Displaced"]
        var requests: [String: [String: Any]] = [:]
        for name in cases {
            let request = areaCreateRequest(name: "Retry \(name)")
            requests[name] = request
            _ = try await writer.call("areaCreate", argumentsJSON: json([json(request)]))
        }
        let pendingAfterWrites = try await writer.retryPending()
        XCTAssertNil(pendingAfterWrites)
        await writer.close()
        let sqlite = try SQLiteBridge(url: database)
        let at = recentAreaTestTime()
        let id = { (name: String) in requests[name]!["requestId"] as! String }
        _ = try sqlite.execute("UPDATE areas SET color = '#ef4444', rev = rev + 1 WHERE id = ?", parametersJSON: json([id("Color")]))
        _ = try sqlite.execute("UPDATE areas SET deletedAt = ?, rev = rev + 1 WHERE id = ?", parametersJSON: json([at, id("Deleted")]))
        _ = try sqlite.execute("DELETE FROM areas WHERE id = ?", parametersJSON: json([id("Purged")]))
        _ = try sqlite.execute("UPDATE areas SET name = 'Later name', rev = rev + 1 WHERE id = ?", parametersJSON: json([id("Renamed")]))
        _ = try sqlite.execute("UPDATE areas SET name = 'Later displaced name', rev = rev + 1 WHERE id = ?", parametersJSON: json([id("Displaced")]))
        _ = try sqlite.execute("INSERT INTO areas (id, name, orderNum, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?)",
                               parametersJSON: json([UUID().uuidString.lowercased(), "Retry Displaced", 100, at, at, 1]))
        sqlite.close()
        let faults = HostIOFaults()
        let reader = host(faults)
        _ = try await reader.start()
        let before = try json(areaRows())
        var writes = 0, journals = 0
        faults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+"#, options: .regularExpression) != nil { writes += 1 }
        }
        faults.journalWrite = { journals += 1 }
        let color = try object(await reader.call("areaCreateRetryOutcome", argumentsJSON: json([json(XCTUnwrap(requests["Color"]))])))
        XCTAssertEqual(color["id"] as? String, id("Color"))
        XCTAssertEqual(color["created"] as? Bool, false)
        for name in cases where name != "Color" {
            let request = try XCTUnwrap(requests[name])
            await expectFailure("STALE_REVISION") {
                _ = try await reader.call("areaCreateRetryOutcome", argumentsJSON: json([json(request)]))
            }
        }
        XCTAssertEqual(writes, 0)
        XCTAssertEqual(journals, 0)
        XCTAssertEqual(try json(areaRows()), before)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testAreaCreateColdFirstApplyRestoresCanonicalSQLiteRows() async throws {
        let bootstrap = host()
        _ = try await bootstrap.start()
        await bootstrap.close()
        let at = recentAreaTestTime()
        let sqlite = try SQLiteBridge(url: database)
        _ = try sqlite.execute("INSERT INTO areas (id, name, color, orderNum, createdAt, updatedAt, deletedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["cold-area", "Work", "#22c55e", 0, at, at, at, 2]))
        _ = try sqlite.execute("INSERT INTO projects (id, title, status, color, areaId, orderNum, isSequential, isFocused, createdAt, updatedAt, deletedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["cold-project", "Linked", "active", "#22c55e", "cold-area", 0, 0, 0, at, at, at, 3]))
        sqlite.close()
        let faults = HostIOFaults()
        let writer = host(faults)
        _ = try await writer.start()
        let request = areaCreateRequest(name: " work ", color: "#ef4444", expectedID: "cold-area")
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pre-commit Area failure") } }
        await expectFailure("SAVE_FAILED") { _ = try await writer.call("areaCreate", argumentsJSON: json([json(request)])) }
        XCTAssertEqual(try areaRows("cold-area").first?["rev"] as? Int, 2)
        XCTAssertEqual(try projectRows("cold-project").first?["rev"] as? Int, 3)
        await writer.close()
        let reopened = host()
        let startup = try object(await reopened.start())
        let recovery = try XCTUnwrap(startup["recovery"] as? [String: Any])
        XCTAssertEqual(recovery["method"] as? String, "areaCreateCommit")
        XCTAssertEqual((recovery["result"] as? [String: Any])?["id"] as? String, "cold-area")
        XCTAssertEqual(try areaRows("cold-area").first?["rev"] as? Int, 4)
        XCTAssertEqual(try projectRows("cold-project").first?["rev"] as? Int, 5)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testAreaCreateColdFullAfterReceiptPrecedesOrderGuardAndWritesNothing() async throws {
        let bootstrap = host()
        _ = try await bootstrap.start()
        await bootstrap.close()
        let at = recentAreaTestTime()
        let sqlite = try SQLiteBridge(url: database)
        _ = try sqlite.execute("INSERT INTO areas (id, name, color, orderNum, createdAt, updatedAt, deletedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["receipt-area", "Work", "#22c55e", 0, at, at, at, 2]))
        _ = try sqlite.execute("INSERT INTO projects (id, title, status, color, areaId, orderNum, isSequential, isFocused, createdAt, updatedAt, deletedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["receipt-project", "Linked", "active", "#22c55e", "receipt-area", 0, 0, 0, at, at, at, 3]))
        _ = try sqlite.execute("INSERT INTO sections (id, projectId, title, orderNum, createdAt, updatedAt, deletedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["receipt-section", "receipt-project", "Plan", 0, at, at, at, 4]))
        _ = try sqlite.execute("INSERT INTO tasks (id, title, status, projectId, sectionId, tags, contexts, isFocusedToday, showFutureRecurrence, suppressMindwtrReminders, pushCount, createdAt, updatedAt, deletedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["receipt-task", "Linked task", "next", "receipt-project", "receipt-section", "[]", "[]", 0, 0, 0, 0, at, at, at, 5]))
        sqlite.close()
        let faults = HostIOFaults()
        let writer = host(faults)
        _ = try await writer.start()
        let request = areaCreateRequest(name: "Work", color: "#ef4444", expectedID: "receipt-area")
        var journalWrites = 0
        faults.journalWrite = { journalWrites += 1; if journalWrites == 2 { throw HostFailure("Injected Area lost reply") } }
        await expectFailure("lost reply") { _ = try await writer.call("areaCreate", argumentsJSON: json([json(request)])) }
        XCTAssertEqual(try areaRows("receipt-area").first?["rev"] as? Int, 4)
        XCTAssertEqual(try projectRows("receipt-project").first?["rev"] as? Int, 5)
        await writer.close()
        let later = try SQLiteBridge(url: database)
        _ = try later.execute("INSERT INTO areas (id, name, orderNum, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?)",
                              parametersJSON: json(["higher-order", "Other", 99, at, at, 1]))
        let snapshot = try ["areas", "projects", "sections", "tasks", "settings"].map { table in
            try later.execute("SELECT * FROM \(table) ORDER BY id")
        }
        later.close()
        let replayFaults = HostIOFaults()
        var writes = 0
        replayFaults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:areas|projects|sections|tasks)\b"#, options: .regularExpression) != nil { writes += 1 }
        }
        let reopened = host(replayFaults)
        let startup = try object(await reopened.start())
        let recovery = try XCTUnwrap(startup["recovery"] as? [String: Any])
        XCTAssertEqual(recovery["method"] as? String, "areaCreateCommit")
        XCTAssertEqual((recovery["result"] as? [String: Any])?["id"] as? String, "receipt-area")
        XCTAssertEqual(writes, 0)
        let check = try SQLiteBridge(url: database)
        let after = try ["areas", "projects", "sections", "tasks", "settings"].map { table in
            try check.execute("SELECT * FROM \(table) ORDER BY id")
        }
        check.close()
        XCTAssertEqual(
            try after.map { try json(JSONSerialization.jsonObject(with: Data($0.utf8))) },
            try snapshot.map { try json(JSONSerialization.jsonObject(with: Data($0.utf8))) }
        )
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testAreaCreateColdPartialDescendantReceiptRefusesWithoutOverwrite() async throws {
        let bootstrap = host()
        _ = try await bootstrap.start()
        await bootstrap.close()
        let at = recentAreaTestTime()
        let sqlite = try SQLiteBridge(url: database)
        _ = try sqlite.execute("INSERT INTO areas (id, name, color, orderNum, createdAt, updatedAt, deletedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["partial-area", "Work", "#22c55e", 0, at, at, at, 2]))
        _ = try sqlite.execute("INSERT INTO projects (id, title, status, color, areaId, orderNum, isSequential, isFocused, createdAt, updatedAt, deletedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                               parametersJSON: json(["partial-project", "Linked", "active", "#22c55e", "partial-area", 0, 0, 0, at, at, at, 3]))
        sqlite.close()
        let faults = HostIOFaults()
        let writer = host(faults)
        _ = try await writer.start()
        let request = areaCreateRequest(name: "Work", color: "#ef4444", expectedID: "partial-area")
        var journalWrites = 0
        faults.journalWrite = { journalWrites += 1; if journalWrites == 2 { throw HostFailure("Injected Area lost reply") } }
        await expectFailure("lost reply") { _ = try await writer.call("areaCreate", argumentsJSON: json([json(request)])) }
        await writer.close()
        let edit = try SQLiteBridge(url: database)
        _ = try edit.execute("UPDATE projects SET color = '#123456', rev = rev + 1 WHERE id = 'partial-project'")
        edit.close()
        let beforeArea = try json(XCTUnwrap(areaRows("partial-area").first))
        let beforeProject = try json(XCTUnwrap(projectRows("partial-project").first))
        let replayFaults = HostIOFaults()
        var writes = 0
        replayFaults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:areas|projects)\b"#, options: .regularExpression) != nil { writes += 1 }
        }
        let reopened = host(replayFaults)
        await expectFailure("STALE_REVISION") { _ = try await reopened.start() }
        XCTAssertEqual(writes, 0)
        XCTAssertEqual(try json(XCTUnwrap(areaRows("partial-area").first)), beforeArea)
        XCTAssertEqual(try json(XCTUnwrap(projectRows("partial-project").first)), beforeProject)
        XCTAssertTrue(FileManager.default.fileExists(atPath: journal.path))
    }

    func testAreaCreateForgedPendingAndTerminalJournalsRefuseBeforeSQLite() async throws {
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let request = areaCreateRequest(name: "Journal authority")
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected Area COMMIT failure") } }
        await expectFailure("SAVE_FAILED") { _ = try await core.call("areaCreate", argumentsJSON: json([json(request)])) }
        let pending = try object(String(contentsOf: journal))
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(pending["argumentsJSON"] as? String).utf8)) as? [String])
        let original = try object(XCTUnwrap(args.first))
        let prepared = try XCTUnwrap(original["prepared"] as? [String: Any])
        let expected = try XCTUnwrap(prepared["result"] as? [String: Any])
        await core.close()
        for corruption in ["request", "effect", "terminal", "oversized", "raw"] {
            var envelope = original
            var method = "areaCreateCommit"
            var argumentsJSON = try XCTUnwrap(pending["argumentsJSON"] as? String)
            var terminal: [String: Any]? = nil
            switch corruption {
            case "request":
                var changed = try XCTUnwrap(envelope["request"] as? [String: Any])
                changed["requestId"] = UUID().uuidString.lowercased()
                envelope["request"] = changed
                argumentsJSON = try json([json(envelope)])
            case "effect":
                var forged = prepared
                var effect = try XCTUnwrap(forged["effect"] as? [String: Any])
                var areaEffect = try XCTUnwrap(effect["area"] as? [String: Any])
                var after = try XCTUnwrap(areaEffect["after"] as? [String: Any])
                after["color"] = "#000000"
                areaEffect["after"] = after
                effect["area"] = areaEffect
                forged["effect"] = effect
                envelope["prepared"] = forged
                argumentsJSON = try json([json(envelope)])
            case "terminal":
                var wrong = expected; wrong["id"] = UUID().uuidString.lowercased()
                terminal = ["success": ["_0": try json(wrong)]]
            case "oversized": argumentsJSON = try json([String(repeating: "x", count: 2_000_001)])
            default: method = "areaCreate"; argumentsJSON = try json([json(request)])
            }
            var forged: [String: Any] = ["version": 2, "method": method, "argumentsJSON": argumentsJSON]
            if let terminal { forged["terminal"] = terminal }
            let bytes = Data(try json(forged).utf8)
            try bytes.write(to: journal)
            let blockedFaults = HostIOFaults()
            var sql = 0, cleanup = 0
            blockedFaults.beforeSQL = { _ in sql += 1 }
            blockedFaults.journalRemove = { cleanup += 1 }
            let blocked = host(blockedFaults)
            await expectFailure { _ = try await blocked.start() }
            XCTAssertEqual(sql, 0); XCTAssertEqual(cleanup, 0)
            XCTAssertEqual(try Data(contentsOf: journal), bytes)
            await blocked.close()
        }
    }

    func testAreaRenameMergeFailedSQLiteCommitIsAtomicAndExactRetryPreservesRichRows() async throws {
        try await seedAreaRenameRows()
        let faults = HostIOFaults()
        var diagnostics: [String] = []
        faults.commandDiagnostic = { diagnostics.append($0) }
        let core = host(faults)
        _ = try await core.start()
        let rawName = "  M\u{FEFF}ERGE e\u{301}  "
        let finalName = "M\u{FEFF}ERGE e\u{301}"
        let request = try await areaRenameRequest(core, name: rawName)
        XCTAssertEqual(Array((request["name"] as? String ?? "").utf8), Array(rawName.utf8))
        let sourceBefore = try XCTUnwrap(areaRows("rename-source").first)
        let destinationBefore = try XCTUnwrap(areaRows("rename-destination").first)
        let sourceProjectsBefore = try Dictionary(uniqueKeysWithValues: ["rename-source-live", "rename-source-deleted"].map {
            ($0, try XCTUnwrap(projectRows($0).first))
        })
        let destinationProjectsBefore = try Dictionary(uniqueKeysWithValues: ["rename-destination-live", "rename-destination-deleted", "rename-destination-current"].map {
            ($0, try XCTUnwrap(projectRows($0).first))
        })
        let tasksBefore = try Dictionary(uniqueKeysWithValues: ["rename-direct", "rename-direct-deleted", "rename-dual", "rename-nested", "rename-unrelated-task"].map {
            ($0, try storedTask($0))
        })
        let sectionBefore = try XCTUnwrap(projectSectionRows("rename-section").first)
        let unrelatedProjectBefore = try XCTUnwrap(projectRows("rename-unrelated").first)
        let beforeSQLite = try SQLiteBridge(url: database)
        let before = try nineTableSnapshot(beforeSQLite)
        beforeSQLite.close()

        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected Area rename COMMIT failure") } }
        await expectFailure("SAVE_FAILED") {
            _ = try await core.call("areaRename", argumentsJSON: json([json(request)]))
        }
        let pending = try object(String(contentsOf: journal))
        XCTAssertEqual(pending["method"] as? String, "areaRenameCommit")
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(pending["argumentsJSON"] as? String).utf8)) as? [String])
        let frozen = try object(XCTUnwrap(args.first))
        let frozenRequest = try XCTUnwrap(frozen["request"] as? [String: Any])
        XCTAssertEqual(Array((frozenRequest["name"] as? String ?? "").utf8), Array(rawName.utf8))
        let prepared = try XCTUnwrap(frozen["prepared"] as? [String: Any])
        let scope = try XCTUnwrap(prepared["scope"] as? [String: Any])
        XCTAssertEqual((scope["areas"] as? [[String: Any]])?.count, 3)
        XCTAssertEqual((scope["projects"] as? [[String: Any]])?.count, 5)
        XCTAssertEqual((scope["tasks"] as? [[String: Any]])?.count, 2)
        let rolledBack = try SQLiteBridge(url: database)
        XCTAssertEqual(try nineTableSnapshot(rolledBack), before)
        rolledBack.close()
        XCTAssertFalse(diagnostics.contains("areaRenameApplied"))

        faults.beforeSQL = nil
        let pendingRetry = try await core.retryPending()
        let retry = try object(XCTUnwrap(pendingRetry))
        XCTAssertEqual(Set(retry.keys), Set(["id", "areaId", "name"]))
        XCTAssertEqual(retry["id"] as? String, "rename-source")
        XCTAssertEqual(retry["areaId"] as? String, "rename-destination")
        XCTAssertEqual(retry["name"] as? String, finalName)
        let sourceAfter = try XCTUnwrap(areaRows("rename-source").first)
        let destinationAfter = try XCTUnwrap(areaRows("rename-destination").first)
        XCTAssertNotNil(sourceAfter["deletedAt"] as? String)
        XCTAssertEqual(sourceAfter["rev"] as? Int, (sourceBefore["rev"] as? Int ?? 0) + 1)
        XCTAssertEqual(try json(sourceAfter.filter { !["deletedAt", "rev", "revBy", "updatedAt"].contains($0.key) }),
                       try json(sourceBefore.filter { !["deletedAt", "rev", "revBy", "updatedAt"].contains($0.key) }))
        XCTAssertEqual(destinationAfter["name"] as? String, finalName)
        XCTAssertEqual(destinationAfter["color"] as? String, destinationBefore["color"] as? String)
        XCTAssertEqual(destinationAfter["icon"] as? String, destinationBefore["icon"] as? String)
        XCTAssertEqual(destinationAfter["orderNum"] as? Int, destinationBefore["orderNum"] as? Int)
        XCTAssertEqual(destinationAfter["rev"] as? Int, (destinationBefore["rev"] as? Int ?? 0) + 1)
        for id in ["rename-source-live", "rename-source-deleted"] {
            let prior = try XCTUnwrap(sourceProjectsBefore[id])
            let saved = try XCTUnwrap(projectRows(id).first)
            XCTAssertEqual(saved["areaId"] as? String, "rename-destination")
            XCTAssertEqual(saved["areaTitle"] as? String, finalName)
            XCTAssertEqual(saved["color"] as? String, destinationBefore["color"] as? String)
            XCTAssertEqual(saved["rev"] as? Int, (prior["rev"] as? Int ?? 0) + 1)
            XCTAssertEqual(saved["deletedAt"] as? String, prior["deletedAt"] as? String)
            XCTAssertEqual(try json(saved.filter { !["areaId", "areaTitle", "color", "rev", "revBy", "updatedAt"].contains($0.key) }),
                           try json(prior.filter { !["areaId", "areaTitle", "color", "rev", "revBy", "updatedAt"].contains($0.key) }))
        }
        for id in ["rename-destination-live", "rename-destination-deleted", "rename-destination-current"] {
            let prior = try XCTUnwrap(destinationProjectsBefore[id])
            let saved = try XCTUnwrap(projectRows(id).first)
            XCTAssertEqual(saved["areaTitle"] as? String, finalName)
            XCTAssertEqual(saved["color"] as? String, prior["color"] as? String)
            XCTAssertEqual(saved["rev"] as? Int, (prior["rev"] as? Int ?? 0) + 1)
            XCTAssertEqual(saved["deletedAt"] as? String, prior["deletedAt"] as? String)
            XCTAssertEqual(try json(saved.filter { !["areaTitle", "rev", "revBy", "updatedAt"].contains($0.key) }),
                           try json(prior.filter { !["areaTitle", "rev", "revBy", "updatedAt"].contains($0.key) }))
        }
        for id in ["rename-direct", "rename-direct-deleted"] {
            let prior = try XCTUnwrap(tasksBefore[id])
            let saved = try storedTask(id)
            XCTAssertEqual(saved["areaId"] as? String, "rename-destination")
            XCTAssertEqual(saved["rev"] as? Int, (prior["rev"] as? Int ?? 0) + 1)
            XCTAssertEqual(saved["deletedAt"] as? String, prior["deletedAt"] as? String)
            XCTAssertEqual(try json(saved.filter { !["areaId", "rev", "revBy", "updatedAt"].contains($0.key) }),
                           try json(prior.filter { !["areaId", "rev", "revBy", "updatedAt"].contains($0.key) }))
        }
        XCTAssertEqual(try json(try storedTask("rename-dual")), try json(XCTUnwrap(tasksBefore["rename-dual"])))
        XCTAssertEqual(try json(try storedTask("rename-nested")), try json(XCTUnwrap(tasksBefore["rename-nested"])))
        XCTAssertEqual(try json(try storedTask("rename-unrelated-task")), try json(XCTUnwrap(tasksBefore["rename-unrelated-task"])))
        XCTAssertEqual(try json(XCTUnwrap(projectRows("rename-unrelated").first)), try json(unrelatedProjectBefore))
        XCTAssertEqual(try json(XCTUnwrap(projectSectionRows("rename-section").first)), try json(sectionBefore))
        XCTAssertEqual(diagnostics.filter { $0 == "areaRenameApplied" }, ["areaRenameApplied"])
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))

        for noOpName in ["", "  \(finalName)  "] {
            let noOpRequest = try await areaRenameRequest(core, areaID: "rename-destination", name: noOpName)
            let beforeNoOp = try json(XCTUnwrap(areaRows("rename-destination").first))
            let noOp = try object(await core.call("areaRename", argumentsJSON: json([json(noOpRequest)])))
            XCTAssertEqual(noOp["id"] as? String, "rename-destination")
            XCTAssertEqual(noOp["areaId"] as? String, "rename-destination")
            XCTAssertEqual(noOp["name"] as? String, finalName)
            XCTAssertEqual(try json(XCTUnwrap(areaRows("rename-destination").first)), beforeNoOp)
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        }
        for method in ["areaRenamePrepare", "areaRenameValidate", "areaRenameCommit"] {
            await expectFailure("unavailable") { _ = try await core.call(method, argumentsJSON: json([json(request)])) }
        }
    }

    func testAreaRenameColdFirstApplyAndReceiptPrecedeMutableInventory() async throws {
        for kind in ["first", "receipt"] {
            let parent = directory!
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await seedAreaRenameRows()
            let faults = HostIOFaults()
            let writer = host(faults)
            _ = try await writer.start()
            let rawName = "  M\u{FEFF}ERGE e\u{301}  "
            let request = try await areaRenameRequest(writer, name: rawName)
            if kind == "first" {
                faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected cold Area rename failure") } }
                await expectFailure("SAVE_FAILED") {
                    _ = try await writer.call("areaRename", argumentsJSON: json([json(request)]))
                }
            } else {
                var journalWrites = 0
                faults.journalWrite = {
                    journalWrites += 1
                    if journalWrites == 2 { throw HostFailure("Injected Area rename lost reply") }
                }
                await expectFailure("lost reply") {
                    _ = try await writer.call("areaRename", argumentsJSON: json([json(request)]))
                }
            }
            XCTAssertEqual(try object(String(contentsOf: journal))["method"] as? String, "areaRenameCommit")
            await writer.close()
            if kind == "receipt" {
                let edit = try SQLiteBridge(url: database)
                let at = recentAreaTestTime(daysAgo: 0)
                _ = try edit.execute("INSERT INTO areas (id, name, color, icon, orderNum, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                                     parametersJSON: json(["rename-late-inventory", "Late inventory", "#111111", "late", 99, at, at, 1]))
                edit.close()
            }
            let beforeSQLite = try SQLiteBridge(url: database)
            let before = try nineTableSnapshot(beforeSQLite)
            beforeSQLite.close()
            let replayFaults = HostIOFaults()
            var mutations = 0
            replayFaults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:areas|projects|sections|tasks|settings)\b"#, options: .regularExpression) != nil {
                    mutations += 1
                }
            }
            let reopened = host(replayFaults)
            let startup = try object(await reopened.start())
            let recovery = try XCTUnwrap(startup["recovery"] as? [String: Any])
            XCTAssertEqual(recovery["method"] as? String, "areaRenameCommit")
            let result = try XCTUnwrap(recovery["result"] as? [String: Any])
            XCTAssertEqual(result["id"] as? String, "rename-source")
            XCTAssertEqual(result["areaId"] as? String, "rename-destination")
            XCTAssertEqual(result["name"] as? String, "M\u{FEFF}ERGE e\u{301}")
            XCTAssertNotNil(try areaRows("rename-source").first?["deletedAt"] as? String)
            XCTAssertEqual(try areaRows("rename-destination").first?["name"] as? String, "M\u{FEFF}ERGE e\u{301}")
            if kind == "receipt" {
                XCTAssertEqual(mutations, 0)
                let check = try SQLiteBridge(url: database)
                XCTAssertEqual(try nineTableSnapshot(check), before)
                check.close()
                XCTAssertEqual(try areaRows("rename-late-inventory").first?["name"] as? String, "Late inventory")
            }
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            await reopened.close()
            directory = parent
        }
    }

    func testAreaRenameUnknownProbeStaleInventoryAndPartialReceiptNeverWrite() async throws {
        let parent = directory!
        directory = parent.appendingPathComponent("unknown")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try await seedAreaRenameRows()
        let probeFaults = HostIOFaults()
        var probeMutations = 0, probeJournals = 0
        probeFaults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+"#, options: .regularExpression) != nil { probeMutations += 1 }
        }
        probeFaults.journalWrite = { probeJournals += 1 }
        let probe = host(probeFaults)
        _ = try await probe.start()
        probeMutations = 0
        let unknownRequest = try await areaRenameRequest(probe, name: "Unknown result")
        let probeSQLite = try SQLiteBridge(url: database)
        let beforeProbe = try nineTableSnapshot(probeSQLite)
        probeSQLite.close()
        await expectFailure("STALE_REVISION") {
            _ = try await probe.call("areaRenameRetryOutcome", argumentsJSON: json([json(unknownRequest)]))
        }
        XCTAssertEqual(probeMutations, 0)
        XCTAssertEqual(probeJournals, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        let afterProbe = try SQLiteBridge(url: database)
        XCTAssertEqual(try nineTableSnapshot(afterProbe), beforeProbe)
        afterProbe.close()
        await probe.close()
        directory = parent

        for kind in ["stale-inventory", "partial-after"] {
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await seedAreaRenameRows()
            let faults = HostIOFaults()
            let writer = host(faults)
            _ = try await writer.start()
            let request = try await areaRenameRequest(writer, name: "  M\u{FEFF}ERGE e\u{301}  ")
            if kind == "stale-inventory" {
                faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Area rename") } }
                await expectFailure("SAVE_FAILED") {
                    _ = try await writer.call("areaRename", argumentsJSON: json([json(request)]))
                }
            } else {
                var journalWrites = 0
                faults.journalWrite = {
                    journalWrites += 1
                    if journalWrites == 2 { throw HostFailure("Injected partial Area rename receipt") }
                }
                await expectFailure("partial Area rename receipt") {
                    _ = try await writer.call("areaRename", argumentsJSON: json([json(request)]))
                }
            }
            await writer.close()
            let edit = try SQLiteBridge(url: database)
            if kind == "stale-inventory" {
                let at = recentAreaTestTime(daysAgo: 0)
                _ = try edit.execute("INSERT INTO areas (id, name, color, orderNum, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?)",
                                     parametersJSON: json(["rename-new-collision", "m\u{FEFF}erge e\u{301}", "#111111", 99, at, at, 1]))
            } else {
                _ = try edit.execute("UPDATE projects SET areaTitle = 'Partial after-state', rev = rev + 1 WHERE id = 'rename-destination-live'")
            }
            let before = try nineTableSnapshot(edit)
            edit.close()
            let replayFaults = HostIOFaults()
            var writes = 0
            replayFaults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:areas|projects|sections|tasks|settings)\b"#, options: .regularExpression) != nil { writes += 1 }
            }
            let reopened = host(replayFaults)
            await expectFailure("STALE_REVISION") { _ = try await reopened.start() }
            XCTAssertEqual(writes, 0)
            XCTAssertTrue(FileManager.default.fileExists(atPath: journal.path))
            let check = try SQLiteBridge(url: database)
            XCTAssertEqual(try nineTableSnapshot(check), before)
            check.close()
            await reopened.close()
            directory = parent
        }
    }

    func testAreaRenameForgedTerminalPreparedAndOversizedJournalsRefuseBeforeSQLite() async throws {
        try await seedAreaRenameRows()
        let faults = HostIOFaults()
        let writer = host(faults)
        _ = try await writer.start()
        let request = try await areaRenameRequest(writer, name: "  M\u{FEFF}ERGE e\u{301}  ")
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Area rename") } }
        await expectFailure("SAVE_FAILED") {
            _ = try await writer.call("areaRename", argumentsJSON: json([json(request)]))
        }
        let pending = try object(String(contentsOf: journal))
        let originalArguments = try XCTUnwrap(pending["argumentsJSON"] as? String)
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(originalArguments.utf8)) as? [String])
        let originalEnvelope = try object(XCTUnwrap(args.first))
        await writer.close()
        let baseline = try SQLiteBridge(url: database)
        let before = try nineTableSnapshot(baseline)
        baseline.close()

        for corruption in ["prepared-result", "terminal", "oversized", "raw"] {
            var method = "areaRenameCommit"
            var argumentsJSON = originalArguments
            var terminal: [String: Any]? = nil
            switch corruption {
            case "prepared-result":
                var envelope = originalEnvelope
                var prepared = try XCTUnwrap(envelope["prepared"] as? [String: Any])
                var result = try XCTUnwrap(prepared["result"] as? [String: Any])
                result["name"] = "Forged"
                prepared["result"] = result
                envelope["prepared"] = prepared
                argumentsJSON = try json([json(envelope)])
            case "terminal":
                terminal = ["success": ["_0": try json([
                    "id": "rename-source", "areaId": "rename-destination", "name": "Forged",
                ])]]
            case "oversized":
                argumentsJSON = try json([String(repeating: "x", count: 2_000_001)])
            default:
                method = "areaRename"
                argumentsJSON = try json([json(request)])
            }
            var forged: [String: Any] = ["version": 2, "method": method, "argumentsJSON": argumentsJSON]
            if let terminal { forged["terminal"] = terminal }
            let bytes = Data(try json(forged).utf8)
            try bytes.write(to: journal)
            let blockedFaults = HostIOFaults()
            var sql = 0, cleanup = 0
            blockedFaults.beforeSQL = { _ in sql += 1 }
            blockedFaults.journalRemove = { cleanup += 1 }
            let blocked = host(blockedFaults)
            await expectFailure { _ = try await blocked.start() }
            XCTAssertEqual(sql, 0)
            XCTAssertEqual(cleanup, 0)
            XCTAssertEqual(try Data(contentsOf: journal), bytes)
            let check = try SQLiteBridge(url: database)
            XCTAssertEqual(try nineTableSnapshot(check), before)
            check.close()
            await blocked.close()
        }
    }

    func testAreaColorFailedSQLiteCommitIsAtomicAndExactRetryRepaintsLinkedRows() async throws {
        try await seedAreaColorRows()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let request = try await areaColorRequest(core, color: "#ef4444")
        let beforeSQLite = try SQLiteBridge(url: database)
        let before = try areaColorTableSnapshot(beforeSQLite)
        beforeSQLite.close()
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected Area color COMMIT failure") } }
        await expectFailure("SAVE_FAILED") { _ = try await core.call("areaColor", argumentsJSON: json([json(request)])) }
        XCTAssertEqual(try object(String(contentsOf: journal))["method"] as? String, "areaColorCommit")
        let failedSQLite = try SQLiteBridge(url: database)
        let failed = try areaColorTableSnapshot(failedSQLite)
        failedSQLite.close()
        XCTAssertEqual(failed, before)
        faults.beforeSQL = nil
        let retryValue = try await core.retryPending()
        let retry = try object(XCTUnwrap(retryValue))
        XCTAssertEqual(retry["id"] as? String, "color-area")
        XCTAssertEqual(retry["color"] as? String, "#ef4444")
        let area = try XCTUnwrap(areaRows("color-area").first)
        XCTAssertEqual(area["color"] as? String, "#ef4444")
        XCTAssertEqual(area["rev"] as? Int, 3)
        for id in ["color-live", "color-deleted"] {
            let row = try XCTUnwrap(projectRows(id).first)
            XCTAssertEqual(row["color"] as? String, "#ef4444")
            XCTAssertEqual(row["areaTitle"] as? String, "Work")
            XCTAssertEqual(row["rev"] as? Int, 4)
        }
        XCTAssertNotNil(try projectRows("color-deleted").first?["deletedAt"] as? String)
        XCTAssertEqual(try projectRows("color-other").first?["rev"] as? Int, 3)
        XCTAssertEqual(try projectRows("color-other").first?["color"] as? String, "#22c55e")
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        for method in ["areaColorPrepare", "areaColorValidate", "areaColorCommit"] {
            await expectFailure("unavailable") { _ = try await core.call(method, argumentsJSON: json([json(request)])) }
        }
    }

    func testAreaColorColdFirstApplyAndReadOnlyNilPendingProbe() async throws {
        try await seedAreaColorRows()
        let faults = HostIOFaults()
        let writer = host(faults)
        _ = try await writer.start()
        let request = try await areaColorRequest(writer, color: NSNull())
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected cold Area color failure") } }
        await expectFailure("SAVE_FAILED") { _ = try await writer.call("areaColor", argumentsJSON: json([json(request)])) }
        let pending = try object(String(contentsOf: journal))
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(pending["argumentsJSON"] as? String).utf8)) as? [String])
        let frozen = try object(XCTUnwrap(args.first))
        let prepared = try XCTUnwrap(frozen["prepared"] as? [String: Any])
        let scope = try XCTUnwrap(prepared["scope"] as? [String: Any])
        let projects = try XCTUnwrap(scope["projects"] as? [[String: Any]])
        XCTAssertEqual(projects.count, 2)
        XCTAssertTrue(projects.allSatisfy { $0["tagIds"] is [String] && $0["order"] is NSNumber })
        await writer.close()
        let reopened = host()
        let startup = try object(await reopened.start())
        let recovery = try XCTUnwrap(startup["recovery"] as? [String: Any])
        XCTAssertEqual(recovery["method"] as? String, "areaColorCommit")
        let result = try XCTUnwrap(recovery["result"] as? [String: Any])
        XCTAssertEqual(result["id"] as? String, "color-area")
        XCTAssertTrue(result["color"] is NSNull)
        let area = try XCTUnwrap(areaRows("color-area").first)
        XCTAssertTrue(area["color"] is NSNull)
        let live = try XCTUnwrap(projectRows("color-live").first)
        XCTAssertEqual(live["color"] as? String, "#94a3b8")
        XCTAssertEqual(live["tagIds"] as? String, "[]")
        XCTAssertEqual(live["orderNum"] as? Int, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        await reopened.close()
        let edit = try SQLiteBridge(url: database)
        _ = try edit.execute("UPDATE areas SET color = '#3b82f6', rev = rev + 1 WHERE id = 'color-area'")
        edit.close()
        let afterArea = try json(areaRows())
        let afterProjects = try json(projectRows())
        let probeFaults = HostIOFaults()
        var writes = 0, journalWrites = 0
        probeFaults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+"#, options: .regularExpression) != nil { writes += 1 }
        }
        probeFaults.journalWrite = { journalWrites += 1 }
        let reader = host(probeFaults)
        _ = try await reader.start()
        writes = 0; journalWrites = 0
        let noPending = try await reader.retryPending()
        XCTAssertNil(noPending)
        await expectFailure("STALE_REVISION") {
            _ = try await reader.call("areaColorRetryOutcome", argumentsJSON: json([json(request)]))
        }
        XCTAssertEqual(writes, 0)
        XCTAssertEqual(journalWrites, 0)
        XCTAssertEqual(try json(areaRows()), afterArea)
        XCTAssertEqual(try json(projectRows()), afterProjects)
    }

    func testAreaColorColdFullAfterReceiptPrecedesChangedScopeAndDeviceGuard() async throws {
        try await seedAreaColorRows()
        let faults = HostIOFaults()
        let writer = host(faults)
        _ = try await writer.start()
        let request = try await areaColorRequest(writer, color: "#ef4444")
        var journalWrites = 0
        faults.journalWrite = { journalWrites += 1; if journalWrites == 2 { throw HostFailure("Injected Area color lost reply") } }
        await expectFailure("lost reply") { _ = try await writer.call("areaColor", argumentsJSON: json([json(request)])) }
        let pending = try object(String(contentsOf: journal))
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(pending["argumentsJSON"] as? String).utf8)) as? [String])
        let frozen = try object(XCTUnwrap(args.first))
        let prepared = try XCTUnwrap(frozen["prepared"] as? [String: Any])
        let settingsAfter = try calendarPreferenceSettings()
        let initializedID = try XCTUnwrap(settingsAfter["deviceId"] as? String)
        XCTAssertEqual(prepared["deviceIdBefore"] as? String, initializedID)
        XCTAssertTrue(prepared["deviceIdToInitialize"] is NSNull)
        await writer.close()
        var changedSettings = settingsAfter
        changedSettings["deviceId"] = UUID().uuidString.lowercased()
        try writeCalendarPreferenceSettings(changedSettings)
        let at = recentAreaTestTime()
        let later = try SQLiteBridge(url: database)
        _ = try later.execute("INSERT INTO projects (id, title, status, color, areaId, areaTitle, orderNum, isSequential, isFocused, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                              parametersJSON: json(["color-later", "Later", "active", "#111111", "color-area", "Work", 2, 0, 0, at, at, 1]))
        let snapshot = try areaColorTableSnapshot(later)
        later.close()
        let replayFaults = HostIOFaults()
        var writes = 0
        replayFaults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:areas|projects|settings)\b"#, options: .regularExpression) != nil { writes += 1 }
        }
        let reopened = host(replayFaults)
        let startup = try object(await reopened.start())
        let recovery = try XCTUnwrap(startup["recovery"] as? [String: Any])
        XCTAssertEqual(recovery["method"] as? String, "areaColorCommit")
        XCTAssertEqual(writes, 0)
        XCTAssertEqual(try calendarPreferenceSettings()["deviceId"] as? String, changedSettings["deviceId"] as? String)
        let check = try SQLiteBridge(url: database)
        let after = try areaColorTableSnapshot(check)
        check.close()
        XCTAssertEqual(after, snapshot)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }

    func testAreaColorTerminalColdRecoveryReportsColorMethodWithoutRepainting() async throws {
        try await seedAreaColorRows()
        let faults = HostIOFaults()
        let writer = host(faults)
        _ = try await writer.start()
        let request = try await areaColorRequest(writer, color: "#ef4444")
        var journalWrites = 0
        faults.journalWrite = { journalWrites += 1; if journalWrites == 2 { throw HostFailure("Injected Area color lost reply") } }
        await expectFailure("lost reply") { _ = try await writer.call("areaColor", argumentsJSON: json([json(request)])) }
        XCTAssertEqual(try object(String(contentsOf: journal))["method"] as? String, "areaColorCommit")
        await writer.close()
        let persisted = try SQLiteBridge(url: database)
        let before = try areaColorTableSnapshot(persisted)
        persisted.close()

        let replayFaults = HostIOFaults()
        var rowWrites = 0
        replayFaults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:areas|projects|settings)\b"#,
                         options: .regularExpression) != nil { rowWrites += 1 }
        }
        let reader = host(replayFaults)
        let startup = try object(await reader.start())
        let recovery = try XCTUnwrap(startup["recovery"] as? [String: Any])
        XCTAssertEqual(recovery["method"] as? String, "areaColorCommit")
        let result = try XCTUnwrap(recovery["result"] as? [String: Any])
        XCTAssertEqual(result.count, 2)
        XCTAssertEqual(result["id"] as? String, "color-area")
        XCTAssertEqual(result["color"] as? String, "#ef4444")
        let noPending = try await reader.retryPending()
        XCTAssertNil(noPending)
        XCTAssertEqual(rowWrites, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        let verified = try SQLiteBridge(url: database)
        XCTAssertEqual(try areaColorTableSnapshot(verified), before)
        verified.close()
        await reader.close()
    }

    func testAreaColorColdPartialAfterAndNewLinkedProjectRefuseWithoutOverwrite() async throws {
        for kind in ["partial", "new-linked"] {
            let caseDirectory = directory.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: caseDirectory, withIntermediateDirectories: true)
            directory = caseDirectory
            try await seedAreaColorRows()
            let faults = HostIOFaults()
            let writer = host(faults)
            _ = try await writer.start()
            let request = try await areaColorRequest(writer, color: "#ef4444")
            if kind == "partial" {
                var journalWrites = 0
                faults.journalWrite = { journalWrites += 1; if journalWrites == 2 { throw HostFailure("Injected Area color lost reply") } }
                await expectFailure("lost reply") { _ = try await writer.call("areaColor", argumentsJSON: json([json(request)])) }
            } else {
                faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Area color") } }
                await expectFailure("SAVE_FAILED") { _ = try await writer.call("areaColor", argumentsJSON: json([json(request)])) }
            }
            await writer.close()
            let edit = try SQLiteBridge(url: database)
            if kind == "partial" {
                _ = try edit.execute("UPDATE projects SET color = '#123456', rev = rev + 1 WHERE id = 'color-live'")
            } else {
                let at = recentAreaTestTime()
                _ = try edit.execute("INSERT INTO projects (id, title, status, color, areaId, areaTitle, orderNum, isSequential, isFocused, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                     parametersJSON: json(["color-later", "Later", "active", "#22c55e", "color-area", "Work", 2, 0, 0, at, at, 1]))
            }
            let before = try areaColorTableSnapshot(edit)
            edit.close()
            let replayFaults = HostIOFaults()
            var writes = 0
            replayFaults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:areas|projects|settings)\b"#, options: .regularExpression) != nil { writes += 1 }
            }
            let reopened = host(replayFaults)
            await expectFailure("STALE_REVISION") { _ = try await reopened.start() }
            XCTAssertEqual(writes, 0)
            let check = try SQLiteBridge(url: database)
            let after = try areaColorTableSnapshot(check)
            check.close()
            XCTAssertEqual(after, before)
            XCTAssertTrue(FileManager.default.fileExists(atPath: journal.path))
            await reopened.close()
            directory = caseDirectory.deletingLastPathComponent()
        }
    }

    func testAreaColorStaleSelectionAndForgedJournalsRefuseBeforeWrites() async throws {
        try await seedAreaColorRows()
        let faults = HostIOFaults()
        let writer = host(faults)
        _ = try await writer.start()
        let request = try await areaColorRequest(writer, color: "#ef4444")
        await writer.close()
        let edit = try SQLiteBridge(url: database)
        _ = try edit.execute("UPDATE areas SET rev = rev + 1 WHERE id = 'color-area'")
        edit.close()
        let staleFaults = HostIOFaults()
        let stale = host(staleFaults)
        _ = try await stale.start()
        var staleWrites = 0
        staleFaults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+"#, options: .regularExpression) != nil { staleWrites += 1 }
        }
        await expectFailure("STALE_REVISION") { _ = try await stale.call("areaColor", argumentsJSON: json([json(request)])) }
        XCTAssertEqual(staleWrites, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        let fresh = try await areaColorRequest(stale, color: "#ef4444")
        let pendingFaults = HostIOFaults()
        await stale.close()
        let pendingWriter = host(pendingFaults)
        _ = try await pendingWriter.start()
        pendingFaults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected Area color pending") } }
        await expectFailure("SAVE_FAILED") { _ = try await pendingWriter.call("areaColor", argumentsJSON: json([json(fresh)])) }
        let pending = try object(String(contentsOf: journal))
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(pending["argumentsJSON"] as? String).utf8)) as? [String])
        let original = try object(XCTUnwrap(args.first))
        let prepared = try XCTUnwrap(original["prepared"] as? [String: Any])
        let expected = try XCTUnwrap(prepared["result"] as? [String: Any])
        await pendingWriter.close()
        for corruption in ["request", "effect", "missing-tagIds", "missing-order", "terminal", "oversized", "raw"] {
            var envelope = original
            var method = "areaColorCommit"
            var argumentsJSON = try XCTUnwrap(pending["argumentsJSON"] as? String)
            var terminal: [String: Any]? = nil
            switch corruption {
            case "request":
                var changed = try XCTUnwrap(envelope["request"] as? [String: Any])
                changed["requestId"] = UUID().uuidString.lowercased()
                envelope["request"] = changed
                argumentsJSON = try json([json(envelope)])
            case "effect":
                var forged = prepared
                var effect = try XCTUnwrap(forged["effect"] as? [String: Any])
                var areaEffect = try XCTUnwrap(effect["area"] as? [String: Any])
                var after = try XCTUnwrap(areaEffect["after"] as? [String: Any])
                after["color"] = "#000000"
                areaEffect["after"] = after
                effect["area"] = areaEffect
                forged["effect"] = effect
                envelope["prepared"] = forged
                argumentsJSON = try json([json(envelope)])
            case "missing-tagIds", "missing-order":
                let field = corruption == "missing-tagIds" ? "tagIds" : "order"
                var forged = prepared
                var scope = try XCTUnwrap(forged["scope"] as? [String: Any])
                let scopeProjects = try XCTUnwrap(scope["projects"] as? [[String: Any]])
                XCTAssertTrue(scopeProjects.allSatisfy { $0[field] != nil })
                scope["projects"] = scopeProjects.map { row in
                    var changed = row; changed.removeValue(forKey: field); return changed
                }
                forged["scope"] = scope
                var effect = try XCTUnwrap(forged["effect"] as? [String: Any])
                let pairs = try XCTUnwrap(effect["projects"] as? [[String: Any]])
                effect["projects"] = pairs.map { pair in
                    var changed = pair
                    for side in ["before", "after"] {
                        if var row = changed[side] as? [String: Any] {
                            row.removeValue(forKey: field)
                            changed[side] = row
                        }
                    }
                    return changed
                }
                forged["effect"] = effect
                envelope["prepared"] = forged
                argumentsJSON = try json([json(envelope)])
            case "terminal":
                var wrong = expected; wrong["id"] = "other-area"
                terminal = ["success": ["_0": try json(wrong)]]
            case "oversized": argumentsJSON = try json([String(repeating: "x", count: 2_000_001)])
            default: method = "areaColor"; argumentsJSON = try json([json(fresh)])
            }
            var forged: [String: Any] = ["version": 2, "method": method, "argumentsJSON": argumentsJSON]
            if let terminal { forged["terminal"] = terminal }
            let bytes = Data(try json(forged).utf8)
            try bytes.write(to: journal)
            let blockedFaults = HostIOFaults()
            var sql = 0, cleanup = 0
            blockedFaults.beforeSQL = { _ in sql += 1 }
            blockedFaults.journalRemove = { cleanup += 1 }
            let blocked = host(blockedFaults)
            await expectFailure { _ = try await blocked.start() }
            XCTAssertEqual(sql, 0); XCTAssertEqual(cleanup, 0)
            XCTAssertEqual(try Data(contentsOf: journal), bytes)
            await blocked.close()
        }
    }

    func testAreaOrderFailedSQLiteCommitIsAtomicAndExactRetryRevisesEveryLiveArea() async throws {
        try await seedAreaOrderRows()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let request = try await areaOrderRequest(core, intent: ["kind": "moveUp", "areaId": "order-c"])
        let beforeSQLite = try SQLiteBridge(url: database)
        let before = try areaColorTableSnapshot(beforeSQLite)
        beforeSQLite.close()
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected Area order COMMIT failure") } }
        await expectFailure("SAVE_FAILED") { _ = try await core.call("areaOrder", argumentsJSON: json([json(request)])) }
        XCTAssertEqual(try object(String(contentsOf: journal))["method"] as? String, "areaOrderCommit")
        let failedSQLite = try SQLiteBridge(url: database)
        let failed = try areaColorTableSnapshot(failedSQLite)
        failedSQLite.close()
        XCTAssertEqual(failed, before)
        faults.beforeSQL = nil
        let retryValue = try await core.retryPending()
        let retry = try object(XCTUnwrap(retryValue))
        XCTAssertEqual(retry["orderedIds"] as? [String], ["order-c", "order-b", "order-a"])
        let rows = try areaRows()
        for (id, order, rev) in [("order-c", 0, 6), ("order-b", 1, 5), ("order-a", 2, 4)] {
            let row = try XCTUnwrap(rows.first { $0["id"] as? String == id })
            XCTAssertEqual(row["orderNum"] as? Int, order)
            XCTAssertEqual(row["rev"] as? Int, rev)
        }
        XCTAssertEqual(try XCTUnwrap(rows.first { $0["id"] as? String == "order-deleted" })["rev"] as? Int, 6)
        let afterSQLite = try SQLiteBridge(url: database)
        let after = try areaColorTableSnapshot(afterSQLite)
        afterSQLite.close()
        XCTAssertEqual(Array(after.dropFirst()), Array(before.dropFirst()))
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        for method in ["areaOrderPrepare", "areaOrderValidate", "areaOrderCommit"] {
            await expectFailure("unavailable") { _ = try await core.call(method, argumentsJSON: json([json(request)])) }
        }
    }

    func testAreaOrderEmptySortTopRefusalSameOrderStampsAndNilPendingProbe() async throws {
        let rootDirectory = directory!
        let empty = host()
        _ = try await empty.start()
        let emptyRequest = try await areaOrderRequest(empty, intent: ["kind": "sortName"])
        let emptyFaults = HostIOFaults()
        await empty.close()
        let emptyReader = host(emptyFaults)
        _ = try await emptyReader.start()
        var emptyWrites = 0, emptyJournals = 0
        emptyFaults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+"#, options: .regularExpression) != nil { emptyWrites += 1 }
        }
        emptyFaults.journalWrite = { emptyJournals += 1 }
        let noop = try object(await emptyReader.call("areaOrder", argumentsJSON: json([json(emptyRequest)])))
        XCTAssertEqual(noop["orderedIds"] as? [String], [])
        XCTAssertEqual(emptyWrites, 0); XCTAssertEqual(emptyJournals, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        await emptyReader.close()

        directory = directory.appendingPathComponent("nonempty")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try await seedAreaOrderRows()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let top = try await areaOrderRequest(core, intent: ["kind": "moveUp", "areaId": "order-b"])
        var writes = 0, journalWrites = 0
        faults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+"#, options: .regularExpression) != nil { writes += 1 }
        }
        faults.journalWrite = { journalWrites += 1 }
        await expectFailure("STALE_REVISION") { _ = try await core.call("areaOrder", argumentsJSON: json([json(top)])) }
        XCTAssertEqual(writes, 0); XCTAssertEqual(journalWrites, 0)
        let request = try await areaOrderRequest(core, intent: ["kind": "sortName"])
        let result = try object(await core.call("areaOrder", argumentsJSON: json([json(request)])))
        XCTAssertEqual(result["orderedIds"] as? [String], ["order-b", "order-c", "order-a"])
        let rows = try areaRows()
        for (id, order, rev) in [("order-b", 0, 5), ("order-c", 1, 6), ("order-a", 2, 4)] {
            let row = try XCTUnwrap(rows.first { $0["id"] as? String == id })
            XCTAssertEqual(row["orderNum"] as? Int, order)
            XCTAssertEqual(row["rev"] as? Int, rev)
        }
        XCTAssertEqual(Set(rows.filter { $0["deletedAt"] is NSNull }.compactMap { $0["updatedAt"] as? String }).count, 1)
        await core.close()
        let readerFaults = HostIOFaults()
        let reader = host(readerFaults)
        _ = try await reader.start()
        let snapshot = try json(areaRows())
        var probeWrites = 0, probeJournals = 0
        readerFaults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+"#, options: .regularExpression) != nil { probeWrites += 1 }
        }
        readerFaults.journalWrite = { probeJournals += 1 }
        let noPending = try await reader.retryPending()
        XCTAssertNil(noPending)
        await expectFailure("STALE_REVISION") { _ = try await reader.call("areaOrderRetryOutcome", argumentsJSON: json([json(request)])) }
        XCTAssertEqual(probeWrites, 0); XCTAssertEqual(probeJournals, 0)
        XCTAssertEqual(try json(areaRows()), snapshot)
        await reader.close()
        directory = rootDirectory
    }

    func testAreaOrderColdFirstApplyAndCompleteAfterReceiptBeforeMutableGuards() async throws {
        for kind in ["first", "receipt"] {
            let parent = directory!
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await seedAreaOrderRows()
            let faults = HostIOFaults()
            let writer = host(faults)
            _ = try await writer.start()
            let request = try await areaOrderRequest(writer, intent: ["kind": "moveUp", "areaId": "order-c"])
            if kind == "first" {
                faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected cold Area order failure") } }
                await expectFailure("SAVE_FAILED") { _ = try await writer.call("areaOrder", argumentsJSON: json([json(request)])) }
            } else {
                var journalWrites = 0
                faults.journalWrite = { journalWrites += 1; if journalWrites == 2 { throw HostFailure("Injected Area order lost reply") } }
                await expectFailure("lost reply") { _ = try await writer.call("areaOrder", argumentsJSON: json([json(request)])) }
            }
            let pending = try object(String(contentsOf: journal))
            let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(pending["argumentsJSON"] as? String).utf8)) as? [String])
            let envelope = try object(XCTUnwrap(args.first))
            let prepared = try XCTUnwrap(envelope["prepared"] as? [String: Any])
            XCTAssertEqual((prepared["result"] as? [String: Any])?["orderedIds"] as? [String], ["order-c", "order-b", "order-a"])
            await writer.close()
            if kind == "receipt" {
                var settings = try calendarPreferenceSettings()
                let beforeDevice = try XCTUnwrap(settings["deviceId"] as? String)
                XCTAssertEqual(prepared["deviceIdBefore"] as? String, beforeDevice)
                XCTAssertTrue(prepared["deviceIdToInitialize"] is NSNull)
                settings["deviceId"] = UUID().uuidString.lowercased()
                try writeCalendarPreferenceSettings(settings)
                let edit = try SQLiteBridge(url: database)
                let at = recentAreaTestTime()
                _ = try edit.execute("INSERT INTO areas (id, name, color, orderNum, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?)",
                                     parametersJSON: json(["order-later", "Later", "#111111", 99, at, at, 1]))
                edit.close()
            }
            let beforeSQLite = try SQLiteBridge(url: database)
            let before = try areaColorTableSnapshot(beforeSQLite)
            beforeSQLite.close()
            let replayFaults = HostIOFaults()
            var writes = 0
            replayFaults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:areas|projects|settings)\b"#, options: .regularExpression) != nil { writes += 1 }
            }
            let reopened = host(replayFaults)
            let startup = try object(await reopened.start())
            let recovery = try XCTUnwrap(startup["recovery"] as? [String: Any])
            XCTAssertEqual(recovery["method"] as? String, "areaOrderCommit")
            XCTAssertEqual((recovery["result"] as? [String: Any])?["orderedIds"] as? [String], ["order-c", "order-b", "order-a"])
            if kind == "receipt" {
                XCTAssertEqual(writes, 0)
                let afterSQLite = try SQLiteBridge(url: database)
                XCTAssertEqual(try areaColorTableSnapshot(afterSQLite), before)
                afterSQLite.close()
                XCTAssertEqual(try areaRows("order-later").first?["orderNum"] as? Int, 99)
            } else {
                XCTAssertEqual(try areaRows("order-c").first?["orderNum"] as? Int, 0)
                XCTAssertEqual(try areaRows("order-b").first?["orderNum"] as? Int, 1)
            }
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            await reopened.close()
            directory = parent
        }
    }

    func testAreaOrderStaleSelectionNewActiveBeforeApplyAndPartialAfterRefuseWithoutOverwrite() async throws {
        for kind in ["stale-token", "new-active", "partial-after"] {
            let parent = directory!
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await seedAreaOrderRows()
            let faults = HostIOFaults()
            let writer = host(faults)
            _ = try await writer.start()
            let request = try await areaOrderRequest(writer, intent: ["kind": "moveUp", "areaId": "order-c"])
            if kind == "new-active" {
                faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Area order") } }
                await expectFailure("SAVE_FAILED") { _ = try await writer.call("areaOrder", argumentsJSON: json([json(request)])) }
            } else if kind == "partial-after" {
                var journalWrites = 0
                faults.journalWrite = { journalWrites += 1; if journalWrites == 2 { throw HostFailure("Injected Area order lost reply") } }
                await expectFailure("lost reply") { _ = try await writer.call("areaOrder", argumentsJSON: json([json(request)])) }
            }
            await writer.close()
            let edit = try SQLiteBridge(url: database)
            if kind == "new-active" {
                let at = recentAreaTestTime()
                _ = try edit.execute("INSERT INTO areas (id, name, orderNum, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?)",
                                     parametersJSON: json(["order-later", "Later", 99, at, at, 1]))
            } else {
                _ = try edit.execute("UPDATE areas SET name = 'Later edit', rev = rev + 1 WHERE id = 'order-a'")
            }
            let before = try areaColorTableSnapshot(edit)
            edit.close()
            let replayFaults = HostIOFaults()
            var writes = 0
            replayFaults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:areas|projects|settings)\b"#, options: .regularExpression) != nil { writes += 1 }
            }
            let replay = host(replayFaults)
            if kind == "stale-token" {
                _ = try await replay.start()
                writes = 0
                await expectFailure("STALE_REVISION") { _ = try await replay.call("areaOrder", argumentsJSON: json([json(request)])) }
                XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            } else {
                await expectFailure("STALE_REVISION") { _ = try await replay.start() }
                XCTAssertTrue(FileManager.default.fileExists(atPath: journal.path))
            }
            XCTAssertEqual(writes, 0)
            let check = try SQLiteBridge(url: database)
            XCTAssertEqual(try areaColorTableSnapshot(check), before)
            check.close()
            await replay.close()
            directory = parent
        }
    }

    func testAreaOrderForgedPendingAndTerminalJournalsRefuseBeforeSQL() async throws {
        try await seedAreaOrderRows()
        let faults = HostIOFaults()
        let writer = host(faults)
        _ = try await writer.start()
        let request = try await areaOrderRequest(writer, intent: ["kind": "moveUp", "areaId": "order-c"])
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Area order") } }
        await expectFailure("SAVE_FAILED") { _ = try await writer.call("areaOrder", argumentsJSON: json([json(request)])) }
        let pending = try object(String(contentsOf: journal))
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(pending["argumentsJSON"] as? String).utf8)) as? [String])
        let original = try object(XCTUnwrap(args.first))
        let prepared = try XCTUnwrap(original["prepared"] as? [String: Any])
        await writer.close()
        for corruption in ["request", "effect", "terminal", "malformed", "oversized", "raw", "capped-indistinct"] {
            var envelope = original
            var method = "areaOrderCommit"
            var argumentsJSON = try XCTUnwrap(pending["argumentsJSON"] as? String)
            var terminal: [String: Any]? = nil
            switch corruption {
            case "request":
                var changed = try XCTUnwrap(envelope["request"] as? [String: Any])
                changed["intent"] = ["kind": "sortColor"]
                envelope["request"] = changed
                argumentsJSON = try json([json(envelope)])
            case "effect":
                var forged = prepared
                var effect = try XCTUnwrap(forged["effect"] as? [String: Any])
                var pairs = try XCTUnwrap(effect["areas"] as? [[String: Any]])
                var first = try XCTUnwrap(pairs.first)
                var after = try XCTUnwrap(first["after"] as? [String: Any])
                after["order"] = 999
                first["after"] = after; pairs[0] = first; effect["areas"] = pairs; forged["effect"] = effect
                envelope["prepared"] = forged
                argumentsJSON = try json([json(envelope)])
            case "terminal":
                terminal = ["success": ["_0": try json(["orderedIds": ["order-a"]])]]
            case "malformed": argumentsJSON = try json([["malformed": true]])
            case "oversized": argumentsJSON = try json([String(repeating: "x", count: 2_000_001)])
            case "capped-indistinct":
                var forged = prepared
                var scope = try XCTUnwrap(forged["scope"] as? [String: Any])
                var areas = try XCTUnwrap(scope["areas"] as? [[String: Any]])
                var effect = try XCTUnwrap(forged["effect"] as? [String: Any])
                var pairs = try XCTUnwrap(effect["areas"] as? [[String: Any]])
                let writerID = try XCTUnwrap(forged["deviceIdBefore"] as? String)
                let updateAt = try XCTUnwrap(forged["updateAt"] as? String)
                for index in areas.indices {
                    areas[index]["rev"] = 2_147_483_647
                    areas[index]["revBy"] = writerID
                    areas[index]["updatedAt"] = updateAt
                    pairs[index] = ["before": areas[index], "after": areas[index]]
                }
                scope["areas"] = areas; effect["areas"] = pairs
                forged["scope"] = scope; forged["effect"] = effect
                var frozenRequest = try XCTUnwrap(forged["request"] as? [String: Any])
                var tokens = try XCTUnwrap(frozenRequest["expectedAreas"] as? [[String: Any]])
                for index in tokens.indices {
                    tokens[index]["rev"] = 2_147_483_647
                    tokens[index]["revBy"] = writerID
                    tokens[index]["updatedAt"] = updateAt
                }
                frozenRequest["intent"] = ["kind": "sortName"]
                frozenRequest["expectedAreas"] = tokens; forged["request"] = frozenRequest
                forged["result"] = ["orderedIds": ["order-b", "order-c", "order-a"]]
                envelope["request"] = frozenRequest; envelope["prepared"] = forged
                argumentsJSON = try json([json(envelope)])
            default: method = "areaOrder"; argumentsJSON = try json([json(request)])
            }
            var forgedJournal: [String: Any] = ["version": 2, "method": method, "argumentsJSON": argumentsJSON]
            if let terminal { forgedJournal["terminal"] = terminal }
            let bytes = Data(try json(forgedJournal).utf8)
            try bytes.write(to: journal)
            let blockedFaults = HostIOFaults()
            var sql = 0, cleanup = 0
            blockedFaults.beforeSQL = { _ in sql += 1 }
            blockedFaults.journalRemove = { cleanup += 1 }
            let blocked = host(blockedFaults)
            await expectFailure { _ = try await blocked.start() }
            XCTAssertEqual(sql, 0); XCTAssertEqual(cleanup, 0)
            XCTAssertEqual(try Data(contentsOf: journal), bytes)
            await blocked.close()
        }
    }

    func testAreaDeleteFailedSQLiteCommitIsAtomicAndExactRetryDetachesLiveAndTrashedTasks() async throws {
        try await seedAreaDeleteRows()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let options = try object(await core.call("areaDeleteOptions"))
        let choices = try XCTUnwrap(options["areas"] as? [[String: Any]])
        let target = try XCTUnwrap(choices.first { $0["id"] as? String == "delete-area" })
        XCTAssertEqual(target["projectCount"] as? Int, 0)
        XCTAssertEqual(target["canDelete"] as? Bool, true)
        let inUse = try XCTUnwrap(choices.first { $0["id"] as? String == "delete-other" })
        XCTAssertEqual(inUse["projectCount"] as? Int, 1)
        XCTAssertEqual(inUse["canDelete"] as? Bool, false)
        let request = try await areaDeleteRequest(core)
        let directBefore = try storedTask("delete-direct")
        let trashedBefore = try storedTask("delete-trashed")
        let otherBefore = try json(XCTUnwrap(areaRows("delete-other").first))
        let beforeSQLite = try SQLiteBridge(url: database)
        let before = try areaColorTableSnapshot(beforeSQLite)
        beforeSQLite.close()
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected Area deletion COMMIT failure") } }
        await expectFailure("SAVE_FAILED") { _ = try await core.call("areaDelete", argumentsJSON: json([json(request)])) }
        XCTAssertEqual(try object(String(contentsOf: journal))["method"] as? String, "areaDeleteCommit")
        let failedSQLite = try SQLiteBridge(url: database)
        XCTAssertEqual(try areaColorTableSnapshot(failedSQLite), before)
        failedSQLite.close()
        faults.beforeSQL = nil
        let retryValue = try await core.retryPending()
        let retry = try object(XCTUnwrap(retryValue))
        XCTAssertEqual(retry["areaId"] as? String, "delete-area")
        let area = try XCTUnwrap(areaRows("delete-area").first)
        XCTAssertNotNil(area["deletedAt"] as? String)
        XCTAssertEqual(area["rev"] as? Int, (target["rev"] as? Int ?? 0) + 1)
        let changed: Set<String> = ["areaId", "rev", "revBy", "updatedAt"]
        for (id, prior) in [("delete-direct", directBefore), ("delete-trashed", trashedBefore)] {
            let saved = try storedTask(id)
            XCTAssertTrue(saved["areaId"] is NSNull)
            XCTAssertEqual(saved["rev"] as? Int, (prior["rev"] as? Int ?? 0) + 1)
            XCTAssertEqual(try json(saved.filter { !changed.contains($0.key) }),
                           try json(prior.filter { !changed.contains($0.key) }))
        }
        XCTAssertNotNil(try storedTask("delete-trashed")["deletedAt"] as? String)
        XCTAssertEqual(try json(XCTUnwrap(areaRows("delete-other").first)), otherBefore)
        let afterSQLite = try SQLiteBridge(url: database)
        let after = try areaColorTableSnapshot(afterSQLite)
        afterSQLite.close()
        XCTAssertEqual(after[1], before[1]); XCTAssertEqual(after[2], before[2]); XCTAssertEqual(after[4], before[4])
        for id in ["delete-unrelated", "delete-nested"] {
            let beforeRows = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(before[3].utf8)) as? [[String: Any]])
            let prior = try XCTUnwrap(beforeRows.first { $0["id"] as? String == id })
            XCTAssertEqual(try json(storedTask(id)), try json(prior))
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        for method in ["areaDeletePrepare", "areaDeleteValidate", "areaDeleteCommit"] {
            await expectFailure("unavailable") { _ = try await core.call(method, argumentsJSON: json([json(request)])) }
        }
        let edit = try SQLiteBridge(url: database)
        _ = try edit.execute("UPDATE tasks SET title = 'Later edit', rev = rev + 1 WHERE id = 'delete-direct'")
        let beforeProbe = try areaColorTableSnapshot(edit)
        edit.close()
        var probeWrites = 0, probeJournals = 0
        faults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+"#, options: .regularExpression) != nil { probeWrites += 1 }
        }
        faults.journalWrite = { probeJournals += 1 }
        let noPending = try await core.retryPending()
        XCTAssertNil(noPending)
        await expectFailure("STALE_REVISION") { _ = try await core.call("areaDeleteRetryOutcome", argumentsJSON: json([json(request)])) }
        XCTAssertEqual(probeWrites, 0); XCTAssertEqual(probeJournals, 0)
        let check = try SQLiteBridge(url: database)
        XCTAssertEqual(try areaColorTableSnapshot(check), beforeProbe)
        check.close()
    }

    func testAreaDeleteLiveProjectsOfEveryStatusRefuseBeforeJournalAndNilPendingProbeIsReadOnly() async throws {
        for status in ["active", "someday", "archived"] {
            let parent = directory!
            directory = parent.appendingPathComponent(status)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await seedAreaDeleteRows()
            let edit = try SQLiteBridge(url: database)
            _ = try edit.execute("UPDATE projects SET deletedAt = NULL, status = ? WHERE id = 'delete-old-project'",
                                 parametersJSON: json([status]))
            edit.close()
            let faults = HostIOFaults()
            let core = host(faults)
            _ = try await core.start()
            let request = try await areaDeleteRequest(core)
            let options = try object(await core.call("areaDeleteOptions"))
            let rows = try XCTUnwrap(options["areas"] as? [[String: Any]])
            let row = try XCTUnwrap(rows.first { $0["id"] as? String == "delete-area" })
            XCTAssertEqual(row["projectCount"] as? Int, 1)
            XCTAssertEqual(row["canDelete"] as? Bool, false)
            let beforeSQLite = try SQLiteBridge(url: database)
            let before = try areaColorTableSnapshot(beforeSQLite)
            beforeSQLite.close()
            var writes = 0, journals = 0
            faults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+"#, options: .regularExpression) != nil { writes += 1 }
            }
            faults.journalWrite = { journals += 1 }
            await expectFailure { _ = try await core.call("areaDelete", argumentsJSON: json([json(request)])) }
            let noPending = try await core.retryPending()
            XCTAssertNil(noPending)
            await expectFailure("STALE_REVISION") { _ = try await core.call("areaDeleteRetryOutcome", argumentsJSON: json([json(request)])) }
            XCTAssertEqual(writes, 0); XCTAssertEqual(journals, 0)
            let afterSQLite = try SQLiteBridge(url: database)
            XCTAssertEqual(try areaColorTableSnapshot(afterSQLite), before)
            afterSQLite.close()
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            await core.close()
            directory = parent
        }
    }

    func testAreaDeleteColdFirstApplyAndFullAfterReceiptBeforeUnrelatedEditsAndDeviceGuard() async throws {
        for kind in ["first", "receipt"] {
            let parent = directory!
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await seedAreaDeleteRows()
            let faults = HostIOFaults()
            let writer = host(faults)
            _ = try await writer.start()
            let request = try await areaDeleteRequest(writer)
            if kind == "first" {
                faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected cold Area deletion failure") } }
                await expectFailure("SAVE_FAILED") { _ = try await writer.call("areaDelete", argumentsJSON: json([json(request)])) }
            } else {
                var journalWrites = 0
                faults.journalWrite = { journalWrites += 1; if journalWrites == 2 { throw HostFailure("Injected Area deletion lost reply") } }
                await expectFailure("lost reply") { _ = try await writer.call("areaDelete", argumentsJSON: json([json(request)])) }
            }
            let pending = try object(String(contentsOf: journal))
            let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(pending["argumentsJSON"] as? String).utf8)) as? [String])
            let frozen = try object(XCTUnwrap(args.first))
            let prepared = try XCTUnwrap(frozen["prepared"] as? [String: Any])
            let scope = try XCTUnwrap(prepared["scope"] as? [String: Any])
            XCTAssertEqual((scope["tasks"] as? [[String: Any]])?.count, 2)
            XCTAssertEqual((scope["liveProjects"] as? [[String: Any]])?.count, 0)
            await writer.close()
            if kind == "receipt" {
                var settings = try calendarPreferenceSettings()
                XCTAssertEqual(prepared["deviceIdBefore"] as? String, settings["deviceId"] as? String)
                XCTAssertTrue(prepared["deviceIdToInitialize"] is NSNull)
                settings["deviceId"] = UUID().uuidString.lowercased()
                try writeCalendarPreferenceSettings(settings)
                let edit = try SQLiteBridge(url: database)
                // Edit unrelated rows under a live Area. Linking a row to the
                // tombstoned Area would trigger legitimate load repair writes.
                let at = recentAreaTestTime(daysAgo: 0)
                _ = try edit.execute("UPDATE tasks SET title = ?, updatedAt = ?, rev = rev + 1 WHERE id = 'delete-unrelated'",
                                     parametersJSON: json(["Later unrelated task", at]))
                _ = try edit.execute("UPDATE projects SET title = ?, updatedAt = ?, rev = rev + 1 WHERE id = 'delete-other-project'",
                                     parametersJSON: json(["Later unrelated project", at]))
                edit.close()
            }
            let beforeSQLite = try SQLiteBridge(url: database)
            let before = try areaColorTableSnapshot(beforeSQLite)
            beforeSQLite.close()
            let replayFaults = HostIOFaults()
            var writes = 0
            replayFaults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:areas|projects|tasks|settings)\b"#, options: .regularExpression) != nil { writes += 1 }
            }
            let reopened = host(replayFaults)
            let startup = try object(await reopened.start())
            let recovery = try XCTUnwrap(startup["recovery"] as? [String: Any])
            XCTAssertEqual(recovery["method"] as? String, "areaDeleteCommit")
            XCTAssertEqual((recovery["result"] as? [String: Any])?["areaId"] as? String, "delete-area")
            if kind == "receipt" {
                XCTAssertEqual(writes, 0)
                let check = try SQLiteBridge(url: database)
                XCTAssertEqual(try areaColorTableSnapshot(check), before)
                check.close()
                XCTAssertEqual(try storedTask("delete-unrelated")["title"] as? String, "Later unrelated task")
                XCTAssertEqual(try storedTask("delete-unrelated")["areaId"] as? String, "delete-other")
                XCTAssertEqual(try projectRows("delete-other-project").first?["title"] as? String, "Later unrelated project")
                XCTAssertEqual(try projectRows("delete-other-project").first?["areaId"] as? String, "delete-other")
            } else {
                XCTAssertNotNil(try areaRows("delete-area").first?["deletedAt"] as? String)
                XCTAssertTrue(try storedTask("delete-direct")["areaId"] is NSNull)
                XCTAssertTrue(try storedTask("delete-trashed")["areaId"] is NSNull)
            }
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            await reopened.close()
            directory = parent
        }
    }

    func testAreaDeleteStaleSelectionNewLinkedRowsAndPartialAfterRefuseWithoutOverwrite() async throws {
        for kind in ["stale-token", "new-task", "new-project", "partial-after"] {
            let parent = directory!
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await seedAreaDeleteRows()
            let faults = HostIOFaults()
            let writer = host(faults)
            _ = try await writer.start()
            let request = try await areaDeleteRequest(writer)
            if kind == "new-task" || kind == "new-project" {
                faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Area deletion") } }
                await expectFailure("SAVE_FAILED") { _ = try await writer.call("areaDelete", argumentsJSON: json([json(request)])) }
            } else if kind == "partial-after" {
                var journalWrites = 0
                faults.journalWrite = { journalWrites += 1; if journalWrites == 2 { throw HostFailure("Injected Area deletion lost reply") } }
                await expectFailure("lost reply") { _ = try await writer.call("areaDelete", argumentsJSON: json([json(request)])) }
            }
            await writer.close()
            let edit = try SQLiteBridge(url: database)
            switch kind {
            case "stale-token":
                _ = try edit.execute("UPDATE areas SET name = 'Later name', rev = rev + 1 WHERE id = 'delete-area'")
            case "new-task":
                _ = try edit.execute("UPDATE tasks SET areaId = 'delete-area' WHERE id = 'delete-unrelated'")
            case "new-project":
                _ = try edit.execute("UPDATE projects SET areaId = 'delete-area', areaTitle = 'Work' WHERE id = 'delete-other-project'")
            default:
                _ = try edit.execute("UPDATE tasks SET title = 'Later edit', rev = rev + 1 WHERE id = 'delete-direct'")
            }
            let before = try areaColorTableSnapshot(edit)
            edit.close()
            let replayFaults = HostIOFaults()
            var writes = 0
            replayFaults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:areas|projects|tasks|settings)\b"#, options: .regularExpression) != nil { writes += 1 }
            }
            let replay = host(replayFaults)
            if kind == "stale-token" {
                _ = try await replay.start()
                writes = 0
                await expectFailure("STALE_REVISION") { _ = try await replay.call("areaDelete", argumentsJSON: json([json(request)])) }
                XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            } else {
                await expectFailure("STALE_REVISION") { _ = try await replay.start() }
                XCTAssertTrue(FileManager.default.fileExists(atPath: journal.path))
            }
            XCTAssertEqual(writes, 0)
            let check = try SQLiteBridge(url: database)
            XCTAssertEqual(try areaColorTableSnapshot(check), before)
            check.close()
            await replay.close()
            directory = parent
        }
    }

    func testAreaDeleteForgedPendingAndTerminalJournalsRefuseBeforeSQL() async throws {
        try await seedAreaDeleteRows()
        let faults = HostIOFaults()
        let writer = host(faults)
        _ = try await writer.start()
        let request = try await areaDeleteRequest(writer)
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Area deletion") } }
        await expectFailure("SAVE_FAILED") { _ = try await writer.call("areaDelete", argumentsJSON: json([json(request)])) }
        let pending = try object(String(contentsOf: journal))
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(pending["argumentsJSON"] as? String).utf8)) as? [String])
        let original = try object(XCTUnwrap(args.first))
        let prepared = try XCTUnwrap(original["prepared"] as? [String: Any])
        await writer.close()
        for corruption in ["request", "effect", "missing-task-field", "terminal", "malformed", "oversized", "raw"] {
            var envelope = original
            var method = "areaDeleteCommit"
            var argumentsJSON = try XCTUnwrap(pending["argumentsJSON"] as? String)
            var terminal: [String: Any]? = nil
            switch corruption {
            case "request":
                var changed = try XCTUnwrap(envelope["request"] as? [String: Any])
                changed["areaId"] = "delete-other"
                envelope["request"] = changed
                argumentsJSON = try json([json(envelope)])
            case "effect":
                var forged = prepared
                var effect = try XCTUnwrap(forged["effect"] as? [String: Any])
                var pairs = try XCTUnwrap(effect["tasks"] as? [[String: Any]])
                var pair = try XCTUnwrap(pairs.first)
                var after = try XCTUnwrap(pair["after"] as? [String: Any])
                after["areaId"] = "delete-other"
                pair["after"] = after; pairs[0] = pair; effect["tasks"] = pairs; forged["effect"] = effect
                envelope["prepared"] = forged
                argumentsJSON = try json([json(envelope)])
            case "missing-task-field":
                var forged = prepared
                var scope = try XCTUnwrap(forged["scope"] as? [String: Any])
                var tasks = try XCTUnwrap(scope["tasks"] as? [[String: Any]])
                tasks[0].removeValue(forKey: "title")
                scope["tasks"] = tasks; forged["scope"] = scope
                var effect = try XCTUnwrap(forged["effect"] as? [String: Any])
                var pairs = try XCTUnwrap(effect["tasks"] as? [[String: Any]])
                for side in ["before", "after"] {
                    var row = try XCTUnwrap(pairs[0][side] as? [String: Any])
                    row.removeValue(forKey: "title")
                    pairs[0][side] = row
                }
                effect["tasks"] = pairs; forged["effect"] = effect; envelope["prepared"] = forged
                argumentsJSON = try json([json(envelope)])
            case "terminal": terminal = ["success": ["_0": try json(["areaId": "delete-other"])]]
            case "malformed": argumentsJSON = try json([["malformed": true]])
            case "oversized": argumentsJSON = try json([String(repeating: "x", count: 2_000_001)])
            default: method = "areaDelete"; argumentsJSON = try json([json(request)])
            }
            var forgedJournal: [String: Any] = ["version": 2, "method": method, "argumentsJSON": argumentsJSON]
            if let terminal { forgedJournal["terminal"] = terminal }
            let bytes = Data(try json(forgedJournal).utf8)
            try bytes.write(to: journal)
            let blockedFaults = HostIOFaults()
            var sql = 0, cleanup = 0
            blockedFaults.beforeSQL = { _ in sql += 1 }
            blockedFaults.journalRemove = { cleanup += 1 }
            let blocked = host(blockedFaults)
            await expectFailure { _ = try await blocked.start() }
            XCTAssertEqual(sql, 0); XCTAssertEqual(cleanup, 0)
            XCTAssertEqual(try Data(contentsOf: journal), bytes)
            await blocked.close()
        }
    }

    func testProjectFocusFailedSQLiteCommitIsAtomicAndExactRetryPreservesRichProject() async throws {
        try await seedProjectFocusRows()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let options = try object(await core.call("projectFocusOptions", argumentsJSON: json([json(["projectId": "focus-target"])])))
        XCTAssertEqual(options["focusedProjectCount"] as? Int, 1)
        XCTAssertEqual(options["limit"] as? Int, 5)
        let request = try await projectFocusRequest(core, focused: true)
        let targetBefore = try XCTUnwrap(projectRows("focus-target").first)
        let beforeSQLite = try SQLiteBridge(url: database)
        let before = try areaColorTableSnapshot(beforeSQLite)
        beforeSQLite.close()
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected Project Focus COMMIT failure") } }
        await expectFailure("SAVE_FAILED") {
            _ = try await core.call("projectFocusWrite", argumentsJSON: json([json(request)]))
        }
        XCTAssertEqual(try object(String(contentsOf: journal))["method"] as? String, "projectFocusCommit")
        let failedSQLite = try SQLiteBridge(url: database)
        XCTAssertEqual(try areaColorTableSnapshot(failedSQLite), before)
        failedSQLite.close()
        faults.beforeSQL = nil
        let retryValue = try await core.retryPending()
        let result = try object(XCTUnwrap(retryValue))
        XCTAssertEqual(result["id"] as? String, "focus-target")
        XCTAssertEqual(result["focused"] as? Bool, true)
        let targetAfter = try XCTUnwrap(projectRows("focus-target").first)
        XCTAssertEqual(targetAfter["isFocused"] as? Int, 1)
        XCTAssertEqual(targetAfter["rev"] as? Int, (targetBefore["rev"] as? Int ?? 0) + 1)
        XCTAssertEqual(targetAfter["attachments"] as? String, targetBefore["attachments"] as? String)
        let changed: Set<String> = ["isFocused", "rev", "revBy", "updatedAt"]
        XCTAssertEqual(try json(targetAfter.filter { !changed.contains($0.key) }),
                       try json(targetBefore.filter { !changed.contains($0.key) }))
        let afterSQLite = try SQLiteBridge(url: database)
        let after = try areaColorTableSnapshot(afterSQLite)
        afterSQLite.close()
        for index in [0, 2, 3, 4] { XCTAssertEqual(after[index], before[index]) }
        let beforeProjects = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(before[1].utf8)) as? [[String: Any]])
        let afterProjects = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(after[1].utf8)) as? [[String: Any]])
        XCTAssertEqual(try json(beforeProjects.filter { $0["id"] as? String != "focus-target" }),
                       try json(afterProjects.filter { $0["id"] as? String != "focus-target" }))
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        for method in ["projectFocusPrepare", "projectFocusValidate", "projectFocusCommit", "projectFocus"] {
            await expectFailure("unavailable") { _ = try await core.call(method, argumentsJSON: json([json(request)])) }
        }
        let edit = try SQLiteBridge(url: database)
        _ = try edit.execute("UPDATE projects SET supportNotes = 'Later independent edit', rev = rev + 1 WHERE id = 'focus-target'")
        let beforeProbe = try areaColorTableSnapshot(edit)
        edit.close()
        var writes = 0, journals = 0
        faults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+"#, options: .regularExpression) != nil { writes += 1 }
        }
        faults.journalWrite = { journals += 1 }
        let noPending = try await core.retryPending()
        XCTAssertNil(noPending)
        await expectFailure("STALE_REVISION") {
            _ = try await core.call("projectFocusRetryOutcome", argumentsJSON: json([json(request)]))
        }
        XCTAssertEqual(writes, 0); XCTAssertEqual(journals, 0)
        let checked = try SQLiteBridge(url: database)
        XCTAssertEqual(try areaColorTableSnapshot(checked), beforeProbe)
        checked.close()
    }

    func testProjectFocusNoopCapacityAndInactivePolicyWriteNoJournal() async throws {
        let parent = directory!
        for kind in ["noop", "full", "inactive", "inactive-disable", "deleted"] {
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await seedProjectFocusRows(focusedOthers: kind == "full" ? 5 : kind == "inactive-disable" ? 4 : 1,
                                           targetStatus: kind == "inactive" ? "archived"
                                             : kind == "inactive-disable" ? "someday" : "active",
                                           targetFocused: kind == "inactive" || kind == "inactive-disable",
                                           targetDeleted: kind == "deleted")
            let faults = HostIOFaults()
            let core = host(faults)
            _ = try await core.start()
            var writes = 0, journals = 0
            faults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+"#, options: .regularExpression) != nil { writes += 1 }
            }
            faults.journalWrite = { journals += 1 }
            if kind == "deleted" {
                await expectFailure("STALE_REVISION") {
                    _ = try await core.call("projectFocusOptions", argumentsJSON: json([json(["projectId": "focus-target"])]))
                }
                let row = try XCTUnwrap(projectRows("focus-target").first)
                let request: [String: Any] = ["requestId": UUID().uuidString.lowercased(),
                    "projectId": "focus-target", "focused": true,
                    "expected": ["title": "Target", "status": "active", "isFocused": false,
                                 "rev": row["rev"] ?? NSNull(), "revBy": row["revBy"] ?? NSNull(),
                                 "updatedAt": row["updatedAt"] ?? ""]]
                await expectFailure("STALE_REVISION") {
                    _ = try await core.call("projectFocusWrite", argumentsJSON: json([json(request)]))
                }
            } else {
                let options = try object(await core.call("projectFocusOptions", argumentsJSON: json([json(["projectId": "focus-target"])])))
                if kind == "inactive" {
                    // A legacy archived star is cleared by the normal load before Focus policy runs.
                    XCTAssertEqual((options["project"] as? [String: Any])?["isFocused"] as? Bool, false)
                    XCTAssertEqual(try projectRows("focus-target").first?["isFocused"] as? Int, 0)
                }
                if kind == "full" || kind == "inactive-disable" {
                    XCTAssertEqual(options["focusedProjectCount"] as? Int, 5)
                }
                let request = try await projectFocusRequest(core, focused: kind == "full" || kind == "inactive")
                let result = try object(await core.call("projectFocusWrite", argumentsJSON: json([json(request)])))
                if kind == "inactive-disable" {
                    XCTAssertEqual(result["id"] as? String, "focus-target")
                    XCTAssertEqual(result["focused"] as? Bool, false)
                    XCTAssertEqual(try projectRows("focus-target").first?["isFocused"] as? Int, 0)
                    XCTAssertGreaterThan(writes, 0)
                    XCTAssertGreaterThan(journals, 0)
                } else if kind == "noop" {
                    XCTAssertEqual(result["id"] as? String, "focus-target")
                    XCTAssertEqual(result["focused"] as? Bool, false)
                } else {
                    XCTAssertEqual(result["blocked"] as? String, "")
                }
            }
            if kind != "inactive-disable" { XCTAssertEqual(writes, 0); XCTAssertEqual(journals, 0) }
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            await core.close()
            directory = parent
        }
    }

    func testProjectFocusColdFirstApplyAndFullAfterReceiptBeforeCapacityAndDeviceGuards() async throws {
        let parent = directory!
        for kind in ["first", "receipt"] {
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await seedProjectFocusRows()
            let faults = HostIOFaults()
            let writer = host(faults)
            _ = try await writer.start()
            let request = try await projectFocusRequest(writer, focused: true)
            if kind == "first" {
                faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected cold Project Focus failure") } }
                await expectFailure("SAVE_FAILED") {
                    _ = try await writer.call("projectFocusWrite", argumentsJSON: json([json(request)]))
                }
            } else {
                var journalWrites = 0
                faults.journalWrite = { journalWrites += 1; if journalWrites == 2 { throw HostFailure("Injected Project Focus lost reply") } }
                await expectFailure("lost reply") {
                    _ = try await writer.call("projectFocusWrite", argumentsJSON: json([json(request)]))
                }
            }
            let pending = try object(String(contentsOf: journal))
            let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(pending["argumentsJSON"] as? String).utf8)) as? [String])
            let envelope = try object(XCTUnwrap(args.first))
            let prepared = try XCTUnwrap(envelope["prepared"] as? [String: Any])
            let scope = try XCTUnwrap(prepared["scope"] as? [String: Any])
            XCTAssertEqual(scope["focusedProjectCount"] as? Int, 1)
            await writer.close()
            if kind == "receipt" {
                var settings = try calendarPreferenceSettings()
                XCTAssertEqual(prepared["deviceIdBefore"] as? String, settings["deviceId"] as? String)
                XCTAssertTrue(prepared["deviceIdToInitialize"] is NSNull)
                settings["deviceId"] = UUID().uuidString.lowercased()
                try writeCalendarPreferenceSettings(settings)
                let edit = try SQLiteBridge(url: database)
                let at = recentAreaTestTime(daysAgo: 0)
                _ = try edit.execute("UPDATE projects SET isFocused = 1, updatedAt = ?, rev = rev + 1 WHERE id IN ('focus-spare-0', 'focus-spare-1', 'focus-spare-2')",
                                     parametersJSON: json([at]))
                _ = try edit.execute("UPDATE projects SET title = 'Later unrelated edit', updatedAt = ?, rev = rev + 1 WHERE id = 'focus-spare-3'",
                                     parametersJSON: json([at]))
                edit.close()
            }
            let beforeSQLite = try SQLiteBridge(url: database)
            let before = try areaColorTableSnapshot(beforeSQLite)
            beforeSQLite.close()
            let replayFaults = HostIOFaults()
            var writes = 0
            replayFaults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:projects|settings)\b"#, options: .regularExpression) != nil { writes += 1 }
            }
            let reopened = host(replayFaults)
            let startup = try object(await reopened.start())
            let recovery = try XCTUnwrap(startup["recovery"] as? [String: Any])
            XCTAssertEqual(recovery["method"] as? String, "projectFocusCommit")
            XCTAssertEqual((recovery["result"] as? [String: Any])?["id"] as? String, "focus-target")
            XCTAssertEqual((recovery["result"] as? [String: Any])?["focused"] as? Bool, true)
            if kind == "receipt" {
                XCTAssertEqual(writes, 0)
                let check = try SQLiteBridge(url: database)
                XCTAssertEqual(try areaColorTableSnapshot(check), before)
                check.close()
                let options = try object(await reopened.call("projectFocusOptions", argumentsJSON: json([json(["projectId": "focus-target"])])))
                XCTAssertEqual(options["focusedProjectCount"] as? Int, 5)
                XCTAssertEqual(try projectRows("focus-spare-3").first?["title"] as? String, "Later unrelated edit")
            } else {
                XCTAssertEqual(try projectRows("focus-target").first?["isFocused"] as? Int, 1)
                XCTAssertGreaterThan(writes, 0)
            }
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            await reopened.close()
            directory = parent
        }
    }

    func testProjectFocusStaleTargetCapacityFillAndPartialAfterRefuseWithoutOverwrite() async throws {
        let parent = directory!
        for kind in ["stale-token", "cap-filled", "partial-after"] {
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await seedProjectFocusRows()
            let faults = HostIOFaults()
            let writer = host(faults)
            _ = try await writer.start()
            let request = try await projectFocusRequest(writer, focused: true)
            if kind == "cap-filled" {
                faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Project Focus") } }
                await expectFailure("SAVE_FAILED") {
                    _ = try await writer.call("projectFocusWrite", argumentsJSON: json([json(request)]))
                }
            } else if kind == "partial-after" {
                var journalWrites = 0
                faults.journalWrite = { journalWrites += 1; if journalWrites == 2 { throw HostFailure("Injected Project Focus lost reply") } }
                await expectFailure("lost reply") {
                    _ = try await writer.call("projectFocusWrite", argumentsJSON: json([json(request)]))
                }
            }
            await writer.close()
            let edit = try SQLiteBridge(url: database)
            let at = recentAreaTestTime(daysAgo: 0)
            switch kind {
            case "stale-token":
                _ = try edit.execute("UPDATE projects SET title = 'Later target title', updatedAt = ?, rev = rev + 1 WHERE id = 'focus-target'",
                                     parametersJSON: json([at]))
            case "cap-filled":
                _ = try edit.execute("UPDATE projects SET isFocused = 1, updatedAt = ?, rev = rev + 1 WHERE id IN ('focus-spare-0', 'focus-spare-1', 'focus-spare-2', 'focus-spare-3')",
                                     parametersJSON: json([at]))
            default:
                _ = try edit.execute("UPDATE projects SET supportNotes = 'Later target edit', updatedAt = ?, rev = rev + 1 WHERE id = 'focus-target'",
                                     parametersJSON: json([at]))
            }
            let before = try areaColorTableSnapshot(edit)
            edit.close()
            let replayFaults = HostIOFaults()
            var writes = 0
            var writeStatements: [String] = []
            replayFaults.beforeSQL = { sql in
                let isDML = sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+"#, options: .regularExpression) != nil
                // Cold boot may rebuild FTS bookkeeping before a pending command is replayed.
                let isFTSBootstrap = sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:schema_migrations|fts_lock|tasks_fts)\b"#, options: .regularExpression) != nil
                if isDML && !isFTSBootstrap {
                    writes += 1
                    writeStatements.append(sql)
                }
            }
            let replay = host(replayFaults)
            if kind == "stale-token" {
                _ = try await replay.start()
                writes = 0
                writeStatements.removeAll()
                await expectFailure("STALE_REVISION") {
                    _ = try await replay.call("projectFocusWrite", argumentsJSON: json([json(request)]))
                }
                XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            } else {
                await expectFailure("STALE_REVISION") { _ = try await replay.start() }
                XCTAssertTrue(FileManager.default.fileExists(atPath: journal.path))
            }
            XCTAssertEqual(writes, 0, "\(kind): \(writeStatements)")
            let check = try SQLiteBridge(url: database)
            XCTAssertEqual(try areaColorTableSnapshot(check), before)
            check.close()
            await replay.close()
            directory = parent
        }
    }

    func testProjectFocusForgedPendingAndTerminalJournalsRefuseBeforeSQL() async throws {
        try await seedProjectFocusRows()
        let faults = HostIOFaults()
        let writer = host(faults)
        _ = try await writer.start()
        let request = try await projectFocusRequest(writer, focused: true)
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Project Focus") } }
        await expectFailure("SAVE_FAILED") {
            _ = try await writer.call("projectFocusWrite", argumentsJSON: json([json(request)]))
        }
        let pending = try object(String(contentsOf: journal))
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(pending["argumentsJSON"] as? String).utf8)) as? [String])
        let original = try object(XCTUnwrap(args.first))
        let prepared = try XCTUnwrap(original["prepared"] as? [String: Any])
        await writer.close()
        for corruption in ["request", "effect", "missing-project-field", "terminal", "malformed", "oversized", "raw"] {
            var envelope = original
            var method = "projectFocusCommit"
            var argumentsJSON = try XCTUnwrap(pending["argumentsJSON"] as? String)
            var terminal: [String: Any]? = nil
            switch corruption {
            case "request":
                var changed = try XCTUnwrap(envelope["request"] as? [String: Any])
                changed["projectId"] = "focus-spare-0"
                envelope["request"] = changed
                argumentsJSON = try json([json(envelope)])
            case "effect":
                var forged = prepared
                var effect = try XCTUnwrap(forged["effect"] as? [String: Any])
                var pair = try XCTUnwrap(effect["project"] as? [String: Any])
                var after = try XCTUnwrap(pair["after"] as? [String: Any])
                after["isFocused"] = false
                pair["after"] = after; effect["project"] = pair; forged["effect"] = effect
                envelope["prepared"] = forged
                argumentsJSON = try json([json(envelope)])
            case "missing-project-field":
                var forged = prepared
                var scope = try XCTUnwrap(forged["scope"] as? [String: Any])
                var project = try XCTUnwrap(scope["project"] as? [String: Any])
                project.removeValue(forKey: "title")
                scope["project"] = project; forged["scope"] = scope
                var effect = try XCTUnwrap(forged["effect"] as? [String: Any])
                var pair = try XCTUnwrap(effect["project"] as? [String: Any])
                for side in ["before", "after"] {
                    var row = try XCTUnwrap(pair[side] as? [String: Any])
                    row.removeValue(forKey: "title")
                    pair[side] = row
                }
                effect["project"] = pair; forged["effect"] = effect; envelope["prepared"] = forged
                argumentsJSON = try json([json(envelope)])
            case "terminal": terminal = ["success": ["_0": try json(["id": "focus-target", "focused": false])]]
            case "malformed": argumentsJSON = try json([["malformed": true]])
            case "oversized": argumentsJSON = try json([String(repeating: "x", count: 2_000_001)])
            default: method = "projectFocusWrite"; argumentsJSON = try json([json(request)])
            }
            var forgedJournal: [String: Any] = ["version": 2, "method": method, "argumentsJSON": argumentsJSON]
            if let terminal { forgedJournal["terminal"] = terminal }
            let bytes = Data(try json(forgedJournal).utf8)
            try bytes.write(to: journal)
            let blockedFaults = HostIOFaults()
            var sql = 0, cleanup = 0
            blockedFaults.beforeSQL = { _ in sql += 1 }
            blockedFaults.journalRemove = { cleanup += 1 }
            let blocked = host(blockedFaults)
            await expectFailure { _ = try await blocked.start() }
            XCTAssertEqual(sql, 0); XCTAssertEqual(cleanup, 0)
            XCTAssertEqual(try Data(contentsOf: journal), bytes)
            await blocked.close()
        }
    }

    func testProjectFocusMalformedPublicRequestsRefuseBeforeJournalOrSQL() async throws {
        try await seedProjectFocusRows()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let request = try await projectFocusRequest(core, focused: true)
        let beforeSQLite = try SQLiteBridge(url: database)
        let before = try areaColorTableSnapshot(beforeSQLite)
        beforeSQLite.close()
        var writes = 0, journals = 0
        faults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+"#, options: .regularExpression) != nil { writes += 1 }
        }
        faults.journalWrite = { journals += 1 }
        for variant in ["wrong-bool", "missing-token", "oversized", "options-extra"] {
            if variant == "options-extra" {
                await expectFailure("INVALID_INPUT") {
                    _ = try await core.call("projectFocusOptions", argumentsJSON: json([json(["projectId": "focus-target", "extra": true])]))
                }
                continue
            }
            var changed = request
            if variant == "wrong-bool" { changed["focused"] = 1 }
            if variant == "missing-token" {
                var expected = try XCTUnwrap(changed["expected"] as? [String: Any])
                expected.removeValue(forKey: "title")
                changed["expected"] = expected
            }
            if variant == "oversized" { changed["projectId"] = String(repeating: "x", count: 2_000_001) }
            await expectFailure("INVALID_INPUT") {
                _ = try await core.call("projectFocusWrite", argumentsJSON: json([json(changed)]))
            }
        }
        XCTAssertEqual(writes, 0); XCTAssertEqual(journals, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        let check = try SQLiteBridge(url: database)
        XCTAssertEqual(try areaColorTableSnapshot(check), before)
        check.close()
    }

    func testProjectRenameFailedSQLiteCommitAtomicExactRetryAndRichRows() async throws {
        try await seedProjectRenameRows()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let request = try await projectRenameRequest(core, title: "  Renamed Project  ")
        let targetBefore = try XCTUnwrap(projectRows("focus-target").first)
        let sql = try SQLiteBridge(url: database)
        let before = try areaColorTableSnapshot(sql)
        sql.close()
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected Project rename COMMIT failure") } }
        await expectFailure("SAVE_FAILED") {
            _ = try await core.call("projectRenameWrite", argumentsJSON: json([json(request)]))
        }
        XCTAssertEqual(try object(String(contentsOf: journal))["method"] as? String, "projectRenameCommit")
        let rolledBack = try SQLiteBridge(url: database)
        XCTAssertEqual(try areaColorTableSnapshot(rolledBack), before)
        rolledBack.close()
        faults.beforeSQL = nil
        let retryValue = try await core.retryPending()
        let retry = try object(XCTUnwrap(retryValue))
        XCTAssertEqual(retry["id"] as? String, "focus-target")
        XCTAssertEqual(retry["title"] as? String, "Renamed Project")
        let targetAfter = try XCTUnwrap(projectRows("focus-target").first)
        XCTAssertEqual(targetAfter["title"] as? String, "Renamed Project")
        XCTAssertEqual(targetAfter["rev"] as? Int, (targetBefore["rev"] as? Int ?? 0) + 1)
        for (field, value) in targetBefore where !["title", "rev", "revBy", "updatedAt"].contains(field) {
            XCTAssertEqual(try json([targetAfter[field] ?? NSNull()]), try json([value]), field)
        }
        let saved = try SQLiteBridge(url: database)
        let after = try areaColorTableSnapshot(saved)
        saved.close()
        for index in [0, 2, 3, 4] { XCTAssertEqual(after[index], before[index]) }
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        var writes = 0, journals = 0
        faults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:projects|tasks|sections|areas|settings)\b"#, options: .regularExpression) != nil { writes += 1 }
        }
        faults.journalWrite = { journals += 1 }
        await expectFailure("STALE_REVISION") {
            _ = try await core.call("projectRenameWrite", argumentsJSON: json([json(request)]))
        }
        XCTAssertEqual(writes, 0); XCTAssertEqual(journals, 0)
        XCTAssertEqual(try projectRows("focus-target").first?["rev"] as? Int, targetAfter["rev"] as? Int)
        await core.close()
    }

    func testProjectRenameNoopDuplicateInactiveArchivedAndDeletedPolicy() async throws {
        let parent = directory!
        for kind in ["blank", "same", "duplicate", "waiting", "someday", "archived", "deleted", "legacy-spaces"] {
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            if kind == "deleted" {
                try await seedProjectFocusRows(targetDeleted: true)
            } else {
                try await seedProjectRenameRows(targetStatus: kind == "archived" ? "archived"
                    : kind == "waiting" ? "waiting" : kind == "someday" ? "someday" : "active",
                    storedTitle: kind == "legacy-spaces" ? "  Target  " : "Target")
            }
            let faults = HostIOFaults()
            let core = host(faults)
            _ = try await core.start()
            var writes = 0, journals = 0
            faults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:projects|tasks|sections|areas|settings)\b"#, options: .regularExpression) != nil { writes += 1 }
            }
            faults.journalWrite = { journals += 1 }
            if kind == "deleted" {
                await expectFailure("STALE_REVISION") {
                    _ = try await core.call("projectRenameOptions", argumentsJSON: json([json(["projectId": "focus-target"])]))
                }
                let row = try XCTUnwrap(projectRows("focus-target").first)
                let stale: [String: Any] = ["requestId": UUID().uuidString.lowercased(), "projectId": "focus-target",
                    "title": "New title", "expected": ["title": "Target", "status": "active",
                    "rev": row["rev"] ?? NSNull(), "revBy": row["revBy"] ?? NSNull(), "updatedAt": row["updatedAt"] ?? ""]]
                await expectFailure("STALE_REVISION") {
                    _ = try await core.call("projectRenameWrite", argumentsJSON: json([json(stale)]))
                }
            } else {
                let options = try object(await core.call("projectRenameOptions", argumentsJSON: json([json(["projectId": "focus-target"])])))
                XCTAssertEqual(options["canRename"] as? Bool, kind != "archived")
                let title = kind == "blank" ? "   " : kind == "same" ? " Target "
                    : kind == "duplicate" ? "focus-other-0" : kind == "legacy-spaces" ? "Target" : "New title"
                let request = try await projectRenameRequest(core, title: title)
                let result = try object(await core.call("projectRenameWrite", argumentsJSON: json([json(request)])))
                if kind == "archived" {
                    XCTAssertEqual(result["blocked"] as? String, "")
                } else {
                    XCTAssertEqual(result["id"] as? String, "focus-target")
                    XCTAssertEqual(result["title"] as? String, kind == "blank" || kind == "same" ? "Target" : title)
                }
            }
            if ["blank", "same", "archived", "deleted"].contains(kind) {
                XCTAssertEqual(writes, 0); XCTAssertEqual(journals, 0)
            } else {
                XCTAssertGreaterThan(writes, 0); XCTAssertGreaterThan(journals, 0)
            }
            if kind == "legacy-spaces" { XCTAssertEqual(try projectRows("focus-target").first?["title"] as? String, "Target") }
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            await core.close()
            directory = parent
        }
    }

    func testProjectRenameColdFirstApplyAndFullAfterReceiptIgnoresLaterDeviceChange() async throws {
        let parent = directory!
        for kind in ["first", "receipt"] {
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await seedProjectRenameRows()
            let faults = HostIOFaults()
            let writer = host(faults)
            _ = try await writer.start()
            let request = try await projectRenameRequest(writer, title: "  Renamed Project  ")
            if kind == "first" {
                faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Project rename") } }
                await expectFailure("SAVE_FAILED") {
                    _ = try await writer.call("projectRenameWrite", argumentsJSON: json([json(request)]))
                }
            } else {
                var journalWrites = 0
                faults.journalWrite = { journalWrites += 1; if journalWrites == 2 { throw HostFailure("Injected Project rename lost reply") } }
                await expectFailure("lost reply") {
                    _ = try await writer.call("projectRenameWrite", argumentsJSON: json([json(request)]))
                }
            }
            let pending = try object(String(contentsOf: journal))
            let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(pending["argumentsJSON"] as? String).utf8)) as? [String])
            let envelope = try object(XCTUnwrap(args.first))
            let prepared = try XCTUnwrap(envelope["prepared"] as? [String: Any])
            XCTAssertEqual((prepared["result"] as? [String: Any])?["title"] as? String, "Renamed Project")
            await writer.close()
            if kind == "receipt" {
                var settings = try calendarPreferenceSettings()
                XCTAssertEqual(prepared["deviceIdBefore"] as? String, settings["deviceId"] as? String)
                XCTAssertTrue(prepared["deviceIdToInitialize"] is NSNull)
                settings["deviceId"] = UUID().uuidString.lowercased()
                try writeCalendarPreferenceSettings(settings)
                let edit = try SQLiteBridge(url: database)
                let at = recentAreaTestTime(daysAgo: 0)
                _ = try edit.execute("UPDATE projects SET title = 'Later unrelated edit', updatedAt = ?, rev = rev + 1 WHERE id = 'focus-other-0'",
                                     parametersJSON: json([at]))
                edit.close()
            }
            let beforeSQLite = try SQLiteBridge(url: database)
            let before = try areaColorTableSnapshot(beforeSQLite)
            beforeSQLite.close()
            let replayFaults = HostIOFaults()
            var writes = 0
            replayFaults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:projects|tasks|sections|areas|settings)\b"#, options: .regularExpression) != nil { writes += 1 }
            }
            let reopened = host(replayFaults)
            let startup = try object(await reopened.start())
            let recovery = try XCTUnwrap(startup["recovery"] as? [String: Any])
            XCTAssertEqual(recovery["method"] as? String, "projectRenameCommit")
            XCTAssertEqual((recovery["result"] as? [String: Any])?["id"] as? String, "focus-target")
            XCTAssertEqual((recovery["result"] as? [String: Any])?["title"] as? String, "Renamed Project")
            if kind == "receipt" {
                XCTAssertEqual(writes, 0)
                let check = try SQLiteBridge(url: database)
                XCTAssertEqual(try areaColorTableSnapshot(check), before)
                check.close()
                XCTAssertEqual(try projectRows("focus-other-0").first?["title"] as? String, "Later unrelated edit")
            } else {
                XCTAssertGreaterThan(writes, 0)
            }
            XCTAssertEqual(try projectRows("focus-target").first?["title"] as? String, "Renamed Project")
            XCTAssertEqual(try storedTask("rename-task")["projectId"] as? String, "focus-target")
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            await reopened.close()
            directory = parent
        }
    }

    func testProjectRenameChangedTargetAndPartialAfterRefuseWithoutOverwrite() async throws {
        let parent = directory!
        for kind in ["before", "partial-after"] {
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await seedProjectRenameRows()
            let faults = HostIOFaults()
            let writer = host(faults)
            _ = try await writer.start()
            let request = try await projectRenameRequest(writer, title: "Renamed Project")
            if kind == "before" {
                faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Project rename") } }
                await expectFailure("SAVE_FAILED") {
                    _ = try await writer.call("projectRenameWrite", argumentsJSON: json([json(request)]))
                }
            } else {
                var journalWrites = 0
                faults.journalWrite = { journalWrites += 1; if journalWrites == 2 { throw HostFailure("Injected Project rename lost reply") } }
                await expectFailure("lost reply") {
                    _ = try await writer.call("projectRenameWrite", argumentsJSON: json([json(request)]))
                }
            }
            await writer.close()
            let edit = try SQLiteBridge(url: database)
            let at = recentAreaTestTime(daysAgo: 0)
            if kind == "before" {
                _ = try edit.execute("UPDATE projects SET title = 'Newer title', updatedAt = ?, rev = rev + 1 WHERE id = 'focus-target'",
                                     parametersJSON: json([at]))
            } else {
                _ = try edit.execute("UPDATE projects SET supportNotes = 'Newer notes', updatedAt = ?, rev = rev + 1 WHERE id = 'focus-target'",
                                     parametersJSON: json([at]))
            }
            let before = try areaColorTableSnapshot(edit)
            edit.close()
            let replayFaults = HostIOFaults()
            var writes = 0
            replayFaults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:projects|tasks|sections|areas|settings)\b"#, options: .regularExpression) != nil { writes += 1 }
            }
            let replay = host(replayFaults)
            await expectFailure("STALE_REVISION") { _ = try await replay.start() }
            XCTAssertEqual(writes, 0)
            XCTAssertTrue(FileManager.default.fileExists(atPath: journal.path))
            let check = try SQLiteBridge(url: database)
            XCTAssertEqual(try areaColorTableSnapshot(check), before)
            check.close()
            await replay.close()
            directory = parent
        }
    }

    func testProjectRenameNilPendingStaleAndMalformedPublicRequestsWriteNothing() async throws {
        try await seedProjectRenameRows()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let request = try await projectRenameRequest(core, title: "New title")
        var writes = 0, journals = 0
        faults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:projects|tasks|sections|areas|settings)\b"#, options: .regularExpression) != nil { writes += 1 }
        }
        faults.journalWrite = { journals += 1 }
        let noPending = try await core.retryPending()
        XCTAssertNil(noPending)
        await expectFailure("STALE_REVISION") {
            _ = try await core.call("projectRenameRetryOutcome", argumentsJSON: json([json(request)]))
        }
        for variant in ["missing-token", "wrong-title", "oversized", "options-extra"] {
            if variant == "options-extra" {
                await expectFailure("INVALID_INPUT") {
                    _ = try await core.call("projectRenameOptions", argumentsJSON: json([json(["projectId": "focus-target", "extra": true])]))
                }
                continue
            }
            var changed = request
            if variant == "missing-token" {
                var expected = try XCTUnwrap(changed["expected"] as? [String: Any])
                expected.removeValue(forKey: "title")
                changed["expected"] = expected
            }
            if variant == "wrong-title" { changed["title"] = true }
            if variant == "oversized" { changed["title"] = String(repeating: "漢", count: 800_000) }
            await expectFailure("INVALID_INPUT") {
                _ = try await core.call("projectRenameWrite", argumentsJSON: json([json(changed)]))
            }
        }
        XCTAssertEqual(writes, 0); XCTAssertEqual(journals, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        faults.beforeSQL = nil
        faults.journalWrite = nil
        _ = try await core.call("projectRenameWrite", argumentsJSON: json([json(request)]))
        writes = 0; journals = 0
        faults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:projects|tasks|sections|areas|settings)\b"#, options: .regularExpression) != nil { writes += 1 }
        }
        faults.journalWrite = { journals += 1 }
        await expectFailure("STALE_REVISION") {
            _ = try await core.call("projectRenameWrite", argumentsJSON: json([json(request)]))
        }
        XCTAssertEqual(writes, 0); XCTAssertEqual(journals, 0)
        XCTAssertEqual(try projectRows("focus-target").first?["title"] as? String, "New title")
        await core.close()
    }

    func testProjectRenameForgedPendingAndTerminalJournalsRefuseBeforeSQL() async throws {
        try await seedProjectRenameRows()
        let faults = HostIOFaults()
        let writer = host(faults)
        _ = try await writer.start()
        let request = try await projectRenameRequest(writer, title: "Renamed Project")
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Project rename") } }
        await expectFailure("SAVE_FAILED") {
            _ = try await writer.call("projectRenameWrite", argumentsJSON: json([json(request)]))
        }
        let pending = try object(String(contentsOf: journal))
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(pending["argumentsJSON"] as? String).utf8)) as? [String])
        let original = try object(XCTUnwrap(args.first))
        let prepared = try XCTUnwrap(original["prepared"] as? [String: Any])
        await writer.close()
        for corruption in ["request", "effect", "missing-project-field", "terminal", "malformed", "oversized", "raw"] {
            var envelope = original
            var method = "projectRenameCommit"
            var argumentsJSON = try XCTUnwrap(pending["argumentsJSON"] as? String)
            var terminal: [String: Any]? = nil
            switch corruption {
            case "request":
                var changed = try XCTUnwrap(envelope["request"] as? [String: Any])
                changed["projectId"] = "focus-other-0"
                envelope["request"] = changed
                argumentsJSON = try json([json(envelope)])
            case "effect":
                var forged = prepared
                var effect = try XCTUnwrap(forged["effect"] as? [String: Any])
                var pair = try XCTUnwrap(effect["project"] as? [String: Any])
                var after = try XCTUnwrap(pair["after"] as? [String: Any])
                after["title"] = "Forged title"
                pair["after"] = after; effect["project"] = pair; forged["effect"] = effect
                envelope["prepared"] = forged
                argumentsJSON = try json([json(envelope)])
            case "missing-project-field":
                var forged = prepared
                var scope = try XCTUnwrap(forged["scope"] as? [String: Any])
                var project = try XCTUnwrap(scope["project"] as? [String: Any])
                project.removeValue(forKey: "tagIds")
                scope["project"] = project; forged["scope"] = scope
                var effect = try XCTUnwrap(forged["effect"] as? [String: Any])
                var pair = try XCTUnwrap(effect["project"] as? [String: Any])
                for side in ["before", "after"] {
                    var row = try XCTUnwrap(pair[side] as? [String: Any])
                    row.removeValue(forKey: "tagIds")
                    pair[side] = row
                }
                effect["project"] = pair; forged["effect"] = effect; envelope["prepared"] = forged
                argumentsJSON = try json([json(envelope)])
            case "terminal": terminal = ["success": ["_0": try json(["id": "focus-target", "title": "Forged title"])]]
            case "malformed": argumentsJSON = try json([["malformed": true]])
            case "oversized": argumentsJSON = try json([String(repeating: "x", count: 2_000_001)])
            default: method = "projectRenameWrite"; argumentsJSON = try json([json(request)])
            }
            var forgedJournal: [String: Any] = ["version": 2, "method": method, "argumentsJSON": argumentsJSON]
            if let terminal { forgedJournal["terminal"] = terminal }
            let bytes = Data(try json(forgedJournal).utf8)
            try bytes.write(to: journal)
            let blockedFaults = HostIOFaults()
            var sql = 0, cleanup = 0
            blockedFaults.beforeSQL = { _ in sql += 1 }
            blockedFaults.journalRemove = { cleanup += 1 }
            let blocked = host(blockedFaults)
            await expectFailure { _ = try await blocked.start() }
            XCTAssertEqual(sql, 0); XCTAssertEqual(cleanup, 0)
            XCTAssertEqual(try Data(contentsOf: journal), bytes)
            await blocked.close()
        }
    }

    func testProjectFlowFailedSQLiteCommitAtomicExactRetryPreservesRichRows() async throws {
        try await seedProjectFlowRows()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let request = try await projectFlowRequest(core, action: ["kind": "toggleType"])
        let targetBefore = try XCTUnwrap(projectRows("focus-target").first)
        let beforeSQLite = try SQLiteBridge(url: database)
        let before = try nineTableSnapshot(beforeSQLite)
        beforeSQLite.close()
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected Project flow COMMIT failure") } }
        await expectFailure("SAVE_FAILED") {
            _ = try await core.call("projectFlowWrite", argumentsJSON: json([json(request)]))
        }
        XCTAssertEqual(try object(String(contentsOf: journal))["method"] as? String, "projectFlowCommit")
        let rolledBack = try SQLiteBridge(url: database)
        XCTAssertEqual(try nineTableSnapshot(rolledBack), before)
        rolledBack.close()
        faults.beforeSQL = nil
        let retryValue = try await core.retryPending()
        let result = try object(XCTUnwrap(retryValue))
        XCTAssertEqual(result["id"] as? String, "focus-target")
        XCTAssertEqual(result["isSequential"] as? Bool, true)
        XCTAssertTrue(result["sequentialScope"] is NSNull)
        let targetAfter = try XCTUnwrap(projectRows("focus-target").first)
        XCTAssertEqual(targetAfter["isSequential"] as? Int, 1)
        XCTAssertEqual(targetAfter["rev"] as? Int, (targetBefore["rev"] as? Int ?? 0) + 1)
        for (field, value) in targetBefore where !["isSequential", "rev", "revBy", "updatedAt"].contains(field) {
            XCTAssertEqual(try json([targetAfter[field] ?? NSNull()]), try json([value]), field)
        }
        let saved = try SQLiteBridge(url: database)
        let after = try nineTableSnapshot(saved)
        saved.close()
        for index in [0, 2, 3, 4, 5, 6, 7, 8] { XCTAssertEqual(after[index], before[index]) }
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        var writes = 0, journals = 0
        faults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:projects|tasks|sections|areas|people|settings|saved_filters|schema_migrations|calendar_sync)\b"#, options: .regularExpression) != nil { writes += 1 }
        }
        faults.journalWrite = { journals += 1 }
        await expectFailure("STALE_REVISION") {
            _ = try await core.call("projectFlowWrite", argumentsJSON: json([json(request)]))
        }
        XCTAssertEqual(writes, 0); XCTAssertEqual(journals, 0)
        XCTAssertEqual(try projectRows("focus-target").first?["rev"] as? Int, targetAfter["rev"] as? Int)
        await core.close()
    }

    func testProjectFlowToggleScopeAndPolicyNoWriteCases() async throws {
        let parent = directory!
        for kind in ["toggle-on", "toggle-off", "scope-missing", "scope-same", "scope-parallel", "archived", "waiting", "someday", "deleted"] {
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            if kind == "deleted" {
                try await seedProjectFocusRows(targetDeleted: true)
            } else {
                let initialSequential: Any = ["toggle-off", "scope-missing", "scope-same", "archived"].contains(kind) ? 1 : 0
                let initialScope: Any
                if ["toggle-off", "archived"].contains(kind) {
                    initialScope = "section"
                } else if kind == "scope-same" {
                    initialScope = "project"
                } else {
                    initialScope = NSNull()
                }
                try await seedProjectFlowRows(status: kind == "archived" ? "archived"
                    : kind == "waiting" ? "waiting" : kind == "someday" ? "someday" : "active",
                    sequential: initialSequential, scope: initialScope)
            }
            let faults = HostIOFaults()
            let core = host(faults)
            _ = try await core.start()
            var writes = 0, journals = 0
            faults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:projects|tasks|sections|areas|people|settings|saved_filters|schema_migrations|calendar_sync)\b"#, options: .regularExpression) != nil { writes += 1 }
            }
            faults.journalWrite = { journals += 1 }
            if kind == "deleted" {
                await expectFailure("STALE_REVISION") {
                    _ = try await core.call("projectFlowOptions", argumentsJSON: json([json(["projectId": "focus-target"])]))
                }
                let row = try XCTUnwrap(projectRows("focus-target").first)
                let stale: [String: Any] = ["requestId": UUID().uuidString.lowercased(), "projectId": "focus-target",
                    "action": ["kind": "toggleType"], "expected": ["title": "Target", "status": "active",
                    "isSequential": false, "sequentialScope": NSNull(), "rev": row["rev"] ?? NSNull(),
                    "revBy": row["revBy"] ?? NSNull(), "updatedAt": row["updatedAt"] ?? ""]]
                await expectFailure("STALE_REVISION") {
                    _ = try await core.call("projectFlowWrite", argumentsJSON: json([json(stale)]))
                }
            } else {
                let options = try object(await core.call("projectFlowOptions", argumentsJSON: json([json(["projectId": "focus-target"])])))
                XCTAssertEqual(options["canChange"] as? Bool, kind != "archived")
                let action: [String: Any] = kind.hasPrefix("scope-") ? ["kind": "setScope", "scope": "project"]
                    : ["kind": "toggleType"]
                let request = try await projectFlowRequest(core, action: action)
                let result = try object(await core.call("projectFlowWrite", argumentsJSON: json([json(request)])))
                if ["scope-parallel", "archived"].contains(kind) {
                    XCTAssertEqual(result["blocked"] as? String, "")
                } else {
                    XCTAssertEqual(result["id"] as? String, "focus-target")
                    XCTAssertEqual(result["isSequential"] as? Bool, kind == "toggle-off" ? false : true)
                    if kind == "toggle-off" { XCTAssertEqual(result["sequentialScope"] as? String, "section") }
                    if kind == "scope-missing" || kind == "scope-same" { XCTAssertEqual(result["sequentialScope"] as? String, "project") }
                    if ["toggle-on", "waiting", "someday"].contains(kind) { XCTAssertTrue(result["sequentialScope"] is NSNull) }
                }
                if kind == "scope-missing" {
                    XCTAssertTrue((request["expected"] as? [String: Any])?["sequentialScope"] is NSNull)
                    XCTAssertEqual(try projectRows("focus-target").first?["sequentialScope"] as? String, "project")
                }
            }
            if ["scope-same", "scope-parallel", "archived", "deleted"].contains(kind) {
                XCTAssertEqual(writes, 0); XCTAssertEqual(journals, 0)
            } else {
                XCTAssertGreaterThan(writes, 0); XCTAssertGreaterThan(journals, 0)
            }
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            await core.close()
            directory = parent
        }
    }

    func testProjectFlowColdFirstApplyAndFullAfterReceiptNeverRetoggles() async throws {
        let parent = directory!
        for kind in ["first", "receipt"] {
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await seedProjectFlowRows()
            let faults = HostIOFaults()
            let writer = host(faults)
            _ = try await writer.start()
            let request = try await projectFlowRequest(writer, action: ["kind": "toggleType"])
            let targetBefore = try XCTUnwrap(projectRows("focus-target").first)
            if kind == "first" {
                faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Project flow") } }
                await expectFailure("SAVE_FAILED") {
                    _ = try await writer.call("projectFlowWrite", argumentsJSON: json([json(request)]))
                }
            } else {
                var journalWrites = 0
                faults.journalWrite = { journalWrites += 1; if journalWrites == 2 { throw HostFailure("Injected Project flow lost reply") } }
                await expectFailure("lost reply") {
                    _ = try await writer.call("projectFlowWrite", argumentsJSON: json([json(request)]))
                }
            }
            let pending = try object(String(contentsOf: journal))
            let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(pending["argumentsJSON"] as? String).utf8)) as? [String])
            let envelope = try object(XCTUnwrap(args.first))
            let prepared = try XCTUnwrap(envelope["prepared"] as? [String: Any])
            XCTAssertEqual((prepared["result"] as? [String: Any])?["isSequential"] as? Bool, true)
            await writer.close()
            if kind == "receipt" {
                var settings = try calendarPreferenceSettings()
                XCTAssertEqual(prepared["deviceIdBefore"] as? String, settings["deviceId"] as? String)
                XCTAssertTrue(prepared["deviceIdToInitialize"] is NSNull)
                settings["deviceId"] = UUID().uuidString.lowercased()
                try writeCalendarPreferenceSettings(settings)
                let edit = try SQLiteBridge(url: database)
                let at = recentAreaTestTime(daysAgo: 0)
                _ = try edit.execute("UPDATE projects SET title = 'Later unrelated edit', updatedAt = ?, rev = rev + 1 WHERE id = 'focus-other-0'",
                                     parametersJSON: json([at]))
                edit.close()
            }
            let beforeSQLite = try SQLiteBridge(url: database)
            let before = try nineTableSnapshot(beforeSQLite)
            beforeSQLite.close()
            let replayFaults = HostIOFaults()
            var writes = 0
            replayFaults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:projects|tasks|sections|areas|people|settings|saved_filters|calendar_sync)\b"#, options: .regularExpression) != nil { writes += 1 }
            }
            let reopened = host(replayFaults)
            let startup = try object(await reopened.start())
            let recovery = try XCTUnwrap(startup["recovery"] as? [String: Any])
            XCTAssertEqual(recovery["method"] as? String, "projectFlowCommit")
            XCTAssertEqual((recovery["result"] as? [String: Any])?["id"] as? String, "focus-target")
            XCTAssertEqual((recovery["result"] as? [String: Any])?["isSequential"] as? Bool, true)
            if kind == "receipt" {
                XCTAssertEqual(writes, 0)
                let check = try SQLiteBridge(url: database)
                XCTAssertEqual(try nineTableSnapshot(check), before)
                check.close()
                XCTAssertEqual(try projectRows("focus-other-0").first?["title"] as? String, "Later unrelated edit")
            } else {
                XCTAssertGreaterThan(writes, 0)
            }
            XCTAssertEqual(try projectRows("focus-target").first?["isSequential"] as? Int, 1)
            XCTAssertEqual(try projectRows("focus-target").first?["rev"] as? Int, (targetBefore["rev"] as? Int ?? 0) + 1)
            XCTAssertEqual(try storedTask("rename-task")["projectId"] as? String, "focus-target")
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            await reopened.close()
            directory = parent
        }
    }

    func testProjectFlowChangedTargetAndPartialAfterRefuseWithoutOverwrite() async throws {
        let parent = directory!
        for kind in ["before", "partial-after"] {
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await seedProjectFlowRows()
            let faults = HostIOFaults()
            let writer = host(faults)
            _ = try await writer.start()
            let request = try await projectFlowRequest(writer, action: ["kind": "toggleType"])
            if kind == "before" {
                faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Project flow") } }
                await expectFailure("SAVE_FAILED") {
                    _ = try await writer.call("projectFlowWrite", argumentsJSON: json([json(request)]))
                }
            } else {
                var journalWrites = 0
                faults.journalWrite = { journalWrites += 1; if journalWrites == 2 { throw HostFailure("Injected Project flow lost reply") } }
                await expectFailure("lost reply") {
                    _ = try await writer.call("projectFlowWrite", argumentsJSON: json([json(request)]))
                }
            }
            await writer.close()
            let edit = try SQLiteBridge(url: database)
            let at = recentAreaTestTime(daysAgo: 0)
            if kind == "before" {
                _ = try edit.execute("UPDATE projects SET title = 'Newer title', updatedAt = ?, rev = rev + 1 WHERE id = 'focus-target'",
                                     parametersJSON: json([at]))
            } else {
                _ = try edit.execute("UPDATE projects SET supportNotes = 'Newer notes', updatedAt = ?, rev = rev + 1 WHERE id = 'focus-target'",
                                     parametersJSON: json([at]))
            }
            let before = try nineTableSnapshot(edit)
            edit.close()
            let replayFaults = HostIOFaults()
            var writes = 0
            replayFaults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:projects|tasks|sections|areas|people|settings|saved_filters|calendar_sync)\b"#, options: .regularExpression) != nil { writes += 1 }
            }
            let replay = host(replayFaults)
            await expectFailure("STALE_REVISION") { _ = try await replay.start() }
            XCTAssertEqual(writes, 0)
            XCTAssertTrue(FileManager.default.fileExists(atPath: journal.path))
            let check = try SQLiteBridge(url: database)
            XCTAssertEqual(try nineTableSnapshot(check), before)
            check.close()
            await replay.close()
            directory = parent
        }
    }

    func testProjectFlowNilPendingStaleAndMalformedPublicRequestsWriteNothing() async throws {
        try await seedProjectFlowRows(sequential: 1, scope: "section")
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let request = try await projectFlowRequest(core, action: ["kind": "setScope", "scope": "project"])
        var writes = 0, journals = 0
        faults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:projects|tasks|sections|areas|people|settings|saved_filters|calendar_sync)\b"#, options: .regularExpression) != nil { writes += 1 }
        }
        faults.journalWrite = { journals += 1 }
        let noPending = try await core.retryPending()
        XCTAssertNil(noPending)
        await expectFailure("STALE_REVISION") {
            _ = try await core.call("projectFlowRetryOutcome", argumentsJSON: json([json(request)]))
        }
        for variant in ["wrong-action", "missing-token", "oversized", "options-extra"] {
            if variant == "options-extra" {
                await expectFailure("INVALID_INPUT") {
                    _ = try await core.call("projectFlowOptions", argumentsJSON: json([json(["projectId": "focus-target", "extra": true])]))
                }
                continue
            }
            var changed = request
            if variant == "wrong-action" { changed["action"] = ["kind": "setScope", "scope": "other"] }
            if variant == "missing-token" {
                var expected = try XCTUnwrap(changed["expected"] as? [String: Any])
                expected.removeValue(forKey: "isSequential")
                changed["expected"] = expected
            }
            if variant == "oversized" { changed["projectId"] = String(repeating: "x", count: 2_000_001) }
            await expectFailure("INVALID_INPUT") {
                _ = try await core.call("projectFlowWrite", argumentsJSON: json([json(changed)]))
            }
        }
        XCTAssertEqual(writes, 0); XCTAssertEqual(journals, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        faults.beforeSQL = nil
        faults.journalWrite = nil
        _ = try await core.call("projectFlowWrite", argumentsJSON: json([json(request)]))
        writes = 0; journals = 0
        faults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:projects|tasks|sections|areas|people|settings|saved_filters|calendar_sync)\b"#, options: .regularExpression) != nil { writes += 1 }
        }
        faults.journalWrite = { journals += 1 }
        await expectFailure("STALE_REVISION") {
            _ = try await core.call("projectFlowWrite", argumentsJSON: json([json(request)]))
        }
        XCTAssertEqual(writes, 0); XCTAssertEqual(journals, 0)
        XCTAssertEqual(try projectRows("focus-target").first?["sequentialScope"] as? String, "project")
        await core.close()
    }

    func testProjectFlowForgedPendingAndTerminalJournalsRefuseBeforeSQL() async throws {
        try await seedProjectFlowRows()
        let faults = HostIOFaults()
        let writer = host(faults)
        _ = try await writer.start()
        let request = try await projectFlowRequest(writer, action: ["kind": "toggleType"])
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Project flow") } }
        await expectFailure("SAVE_FAILED") {
            _ = try await writer.call("projectFlowWrite", argumentsJSON: json([json(request)]))
        }
        let pending = try object(String(contentsOf: journal))
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(pending["argumentsJSON"] as? String).utf8)) as? [String])
        let original = try object(XCTUnwrap(args.first))
        let prepared = try XCTUnwrap(original["prepared"] as? [String: Any])
        await writer.close()
        for corruption in ["request", "effect", "missing-project-field", "terminal", "malformed", "oversized", "raw"] {
            var envelope = original
            var method = "projectFlowCommit"
            var argumentsJSON = try XCTUnwrap(pending["argumentsJSON"] as? String)
            var terminal: [String: Any]? = nil
            switch corruption {
            case "request":
                var changed = try XCTUnwrap(envelope["request"] as? [String: Any])
                changed["action"] = ["kind": "setScope", "scope": "project"]
                envelope["request"] = changed
                argumentsJSON = try json([json(envelope)])
            case "effect":
                var forged = prepared
                var effect = try XCTUnwrap(forged["effect"] as? [String: Any])
                var pair = try XCTUnwrap(effect["project"] as? [String: Any])
                var after = try XCTUnwrap(pair["after"] as? [String: Any])
                after["isSequential"] = false
                pair["after"] = after; effect["project"] = pair; forged["effect"] = effect
                envelope["prepared"] = forged
                argumentsJSON = try json([json(envelope)])
            case "missing-project-field":
                var forged = prepared
                var scope = try XCTUnwrap(forged["scope"] as? [String: Any])
                var project = try XCTUnwrap(scope["project"] as? [String: Any])
                project.removeValue(forKey: "tagIds")
                scope["project"] = project; forged["scope"] = scope
                var effect = try XCTUnwrap(forged["effect"] as? [String: Any])
                var pair = try XCTUnwrap(effect["project"] as? [String: Any])
                for side in ["before", "after"] {
                    var row = try XCTUnwrap(pair[side] as? [String: Any])
                    row.removeValue(forKey: "tagIds")
                    pair[side] = row
                }
                effect["project"] = pair; forged["effect"] = effect; envelope["prepared"] = forged
                argumentsJSON = try json([json(envelope)])
            case "terminal": terminal = ["success": ["_0": try json(["id": "focus-target", "isSequential": false, "sequentialScope": NSNull()])]]
            case "malformed": argumentsJSON = try json([["malformed": true]])
            case "oversized": argumentsJSON = try json([String(repeating: "x", count: 2_000_001)])
            default: method = "projectFlowWrite"; argumentsJSON = try json([json(request)])
            }
            var forgedJournal: [String: Any] = ["version": 2, "method": method, "argumentsJSON": argumentsJSON]
            if let terminal { forgedJournal["terminal"] = terminal }
            let bytes = Data(try json(forgedJournal).utf8)
            try bytes.write(to: journal)
            let blockedFaults = HostIOFaults()
            var sql = 0, cleanup = 0
            blockedFaults.beforeSQL = { _ in sql += 1 }
            blockedFaults.journalRemove = { cleanup += 1 }
            let blocked = host(blockedFaults)
            await expectFailure { _ = try await blocked.start() }
            XCTAssertEqual(sql, 0); XCTAssertEqual(cleanup, 0)
            XCTAssertEqual(try Data(contentsOf: journal), bytes)
            await blocked.close()
        }
    }

    func testProjectStatusFailedCommitExactRetryClearsFocusAndPreservesRichRows() async throws {
        try await seedProjectRenameRows()
        let edit = try SQLiteBridge(url: database)
        _ = try edit.execute("UPDATE projects SET isFocused = 1 WHERE id = 'focus-target'")
        edit.close()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let request = try await projectStatusRequest(core, status: "waiting")
        let targetBefore = try XCTUnwrap(projectRows("focus-target").first)
        let beforeSQLite = try SQLiteBridge(url: database)
        let before = try nineTableSnapshot(beforeSQLite)
        beforeSQLite.close()
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected Project status COMMIT failure") } }
        await expectFailure("SAVE_FAILED") {
            _ = try await core.call("projectStatusWrite", argumentsJSON: json([json(request)]))
        }
        XCTAssertEqual(try object(String(contentsOf: journal))["method"] as? String, "projectStatusCommit")
        let rolledBack = try SQLiteBridge(url: database)
        XCTAssertEqual(try nineTableSnapshot(rolledBack), before)
        rolledBack.close()
        faults.beforeSQL = nil
        let retryValue = try await core.retryPending()
        let result = try object(XCTUnwrap(retryValue))
        XCTAssertEqual(result["id"] as? String, "focus-target")
        XCTAssertEqual(result["status"] as? String, "waiting")
        XCTAssertEqual(result["isFocused"] as? Bool, false)
        let targetAfter = try XCTUnwrap(projectRows("focus-target").first)
        XCTAssertEqual(targetAfter["status"] as? String, "waiting")
        XCTAssertEqual(targetAfter["isFocused"] as? Int, 0)
        XCTAssertEqual(targetAfter["rev"] as? Int, (targetBefore["rev"] as? Int ?? 0) + 1)
        for (field, value) in targetBefore where !["status", "isFocused", "rev", "revBy", "updatedAt"].contains(field) {
            XCTAssertEqual(try json([targetAfter[field] ?? NSNull()]), try json([value]), field)
        }
        let saved = try SQLiteBridge(url: database)
        let after = try nineTableSnapshot(saved)
        saved.close()
        for index in [0, 2, 3, 4, 5, 6, 7, 8] { XCTAssertEqual(after[index], before[index]) }
        XCTAssertEqual(try storedTask("rename-task")["projectId"] as? String, "focus-target")
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        var writes = 0, journals = 0
        faults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:projects|tasks|sections|areas|people|settings|saved_filters|calendar_sync)\b"#, options: .regularExpression) != nil { writes += 1 }
        }
        faults.journalWrite = { journals += 1 }
        await expectFailure("STALE_REVISION") {
            _ = try await core.call("projectStatusWrite", argumentsJSON: json([json(request)]))
        }
        XCTAssertEqual(writes, 0); XCTAssertEqual(journals, 0)
        await core.close()
    }

    func testProjectStatusNoopArchivedNilPendingAndMalformedWriteNothing() async throws {
        let parent = directory!
        for kind in ["same", "same-null", "archived"] {
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await seedProjectRenameRows(targetStatus: kind == "archived" ? "archived" : "active")
            if kind == "same-null" {
                let edit = try SQLiteBridge(url: database)
                _ = try edit.execute("UPDATE projects SET isFocused = NULL WHERE id = 'focus-target'")
                edit.close()
            }
            let faults = HostIOFaults()
            let core = host(faults)
            _ = try await core.start()
            let options = try object(await core.call("projectStatusOptions", argumentsJSON: json([json(["projectId": "focus-target"])])))
            XCTAssertEqual(options["canChange"] as? Bool, kind != "archived")
            let request = try await projectStatusRequest(core, status: "active")
            var writes = 0, journals = 0
            faults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:projects|tasks|sections|areas|people|settings|saved_filters|calendar_sync)\b"#, options: .regularExpression) != nil { writes += 1 }
            }
            faults.journalWrite = { journals += 1 }
            let noPending = try await core.retryPending()
            XCTAssertNil(noPending)
            await expectFailure("STALE_REVISION") {
                _ = try await core.call("projectStatusRetryOutcome", argumentsJSON: json([json(request)]))
            }
            let result = try object(await core.call("projectStatusWrite", argumentsJSON: json([json(request)])))
            if kind == "archived" { XCTAssertEqual(result["blocked"] as? String, "") }
            else {
                XCTAssertEqual(result["status"] as? String, "active")
                XCTAssertEqual(result["isFocused"] as? Bool, false)
                if kind == "same-null" {
                    let stored = try XCTUnwrap(try projectRows("focus-target").first)
                    XCTAssertTrue(stored["isFocused"] is NSNull)
                }
            }
            var invalid = request
            invalid["status"] = "archived"
            await expectFailure("INVALID_INPUT") {
                _ = try await core.call("projectStatusWrite", argumentsJSON: json([json(invalid)]))
            }
            var stale = request
            var expected = try XCTUnwrap(stale["expected"] as? [String: Any])
            expected["title"] = "stale title"
            stale["expected"] = expected
            await expectFailure("STALE_REVISION") {
                _ = try await core.call("projectStatusWrite", argumentsJSON: json([json(stale)]))
            }
            XCTAssertEqual(writes, 0); XCTAssertEqual(journals, 0)
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            await core.close()
            directory = parent
        }
    }

    func testProjectStatusColdFirstApplyAndFullAfterReceiptNeverReapplies() async throws {
        let parent = directory!
        for kind in ["first", "receipt"] {
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await seedProjectRenameRows()
            let faults = HostIOFaults()
            let writer = host(faults)
            _ = try await writer.start()
            let request = try await projectStatusRequest(writer, status: "someday")
            let targetBefore = try XCTUnwrap(projectRows("focus-target").first)
            if kind == "first" {
                faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Project status") } }
                await expectFailure("SAVE_FAILED") {
                    _ = try await writer.call("projectStatusWrite", argumentsJSON: json([json(request)]))
                }
            } else {
                var journalWrites = 0
                faults.journalWrite = { journalWrites += 1; if journalWrites == 2 { throw HostFailure("Injected Project status lost reply") } }
                await expectFailure("lost reply") {
                    _ = try await writer.call("projectStatusWrite", argumentsJSON: json([json(request)]))
                }
            }
            let pending = try object(String(contentsOf: journal))
            let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(pending["argumentsJSON"] as? String).utf8)) as? [String])
            let envelope = try object(XCTUnwrap(args.first))
            let prepared = try XCTUnwrap(envelope["prepared"] as? [String: Any])
            XCTAssertEqual((prepared["result"] as? [String: Any])?["status"] as? String, "someday")
            await writer.close()
            if kind == "receipt" {
                var settings = try calendarPreferenceSettings()
                settings["deviceId"] = UUID().uuidString.lowercased()
                try writeCalendarPreferenceSettings(settings)
                let edit = try SQLiteBridge(url: database)
                _ = try edit.execute("UPDATE projects SET title = 'Later unrelated edit', updatedAt = ?, rev = rev + 1 WHERE id = 'focus-other-0'",
                                     parametersJSON: json([recentAreaTestTime(daysAgo: 0)]))
                edit.close()
            }
            let beforeSQLite = try SQLiteBridge(url: database)
            let before = try nineTableSnapshot(beforeSQLite)
            beforeSQLite.close()
            let replayFaults = HostIOFaults()
            var writes = 0
            replayFaults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:projects|tasks|sections|areas|people|settings|saved_filters|calendar_sync)\b"#, options: .regularExpression) != nil { writes += 1 }
            }
            let reopened = host(replayFaults)
            let startup = try object(await reopened.start())
            let recovery = try XCTUnwrap(startup["recovery"] as? [String: Any])
            XCTAssertEqual(recovery["method"] as? String, "projectStatusCommit")
            XCTAssertEqual((recovery["result"] as? [String: Any])?["status"] as? String, "someday")
            if kind == "receipt" {
                XCTAssertEqual(writes, 0)
                let check = try SQLiteBridge(url: database)
                XCTAssertEqual(try nineTableSnapshot(check), before)
                check.close()
            } else { XCTAssertGreaterThan(writes, 0) }
            XCTAssertEqual(try projectRows("focus-target").first?["status"] as? String, "someday")
            XCTAssertEqual(try projectRows("focus-target").first?["rev"] as? Int, (targetBefore["rev"] as? Int ?? 0) + 1)
            XCTAssertEqual(try storedTask("rename-task")["projectId"] as? String, "focus-target")
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            await reopened.close()
            directory = parent
        }
    }

    func testProjectStatusForgedPendingAndTerminalJournalsRefuseBeforeSQL() async throws {
        try await seedProjectRenameRows()
        let faults = HostIOFaults()
        let writer = host(faults)
        _ = try await writer.start()
        let request = try await projectStatusRequest(writer, status: "waiting")
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Project status") } }
        await expectFailure("SAVE_FAILED") {
            _ = try await writer.call("projectStatusWrite", argumentsJSON: json([json(request)]))
        }
        let pending = try object(String(contentsOf: journal))
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(pending["argumentsJSON"] as? String).utf8)) as? [String])
        let original = try object(XCTUnwrap(args.first))
        let prepared = try XCTUnwrap(original["prepared"] as? [String: Any])
        await writer.close()
        for corruption in ["request", "effect", "missing-project-field", "terminal", "malformed"] {
            var envelope = original
            var argumentsJSON = try XCTUnwrap(pending["argumentsJSON"] as? String)
            var terminal: [String: Any]? = nil
            switch corruption {
            case "request":
                var changed = try XCTUnwrap(envelope["request"] as? [String: Any])
                changed["status"] = "someday"
                envelope["request"] = changed
                argumentsJSON = try json([json(envelope)])
            case "effect":
                var forged = prepared
                var effect = try XCTUnwrap(forged["effect"] as? [String: Any])
                var pair = try XCTUnwrap(effect["project"] as? [String: Any])
                var after = try XCTUnwrap(pair["after"] as? [String: Any])
                after["isFocused"] = true
                pair["after"] = after; effect["project"] = pair; forged["effect"] = effect
                envelope["prepared"] = forged
                argumentsJSON = try json([json(envelope)])
            case "missing-project-field":
                var forged = prepared
                var scope = try XCTUnwrap(forged["scope"] as? [String: Any])
                var project = try XCTUnwrap(scope["project"] as? [String: Any])
                project.removeValue(forKey: "tagIds")
                scope["project"] = project; forged["scope"] = scope
                envelope["prepared"] = forged
                argumentsJSON = try json([json(envelope)])
            case "terminal": terminal = ["success": ["_0": try json(["id": "focus-target", "status": "someday", "isFocused": false])]]
            default: argumentsJSON = try json([["malformed": true]])
            }
            var forgedJournal: [String: Any] = ["version": 2, "method": "projectStatusCommit", "argumentsJSON": argumentsJSON]
            if let terminal { forgedJournal["terminal"] = terminal }
            let bytes = Data(try json(forgedJournal).utf8)
            try bytes.write(to: journal)
            let blockedFaults = HostIOFaults()
            var sql = 0, cleanup = 0
            blockedFaults.beforeSQL = { _ in sql += 1 }
            blockedFaults.journalRemove = { cleanup += 1 }
            let blocked = host(blockedFaults)
            await expectFailure { _ = try await blocked.start() }
            XCTAssertEqual(sql, 0); XCTAssertEqual(cleanup, 0)
            XCTAssertEqual(try Data(contentsOf: journal), bytes)
            await blocked.close()
        }
    }

    func testProjectStatusChangedBeforeAndPartialAfterRefuseWithoutOverwrite() async throws {
        let parent = directory!
        for kind in ["before", "partial-after"] {
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await seedProjectRenameRows()
            let faults = HostIOFaults()
            let writer = host(faults)
            _ = try await writer.start()
            let request = try await projectStatusRequest(writer, status: "waiting")
            if kind == "before" {
                faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Project status") } }
                await expectFailure("SAVE_FAILED") {
                    _ = try await writer.call("projectStatusWrite", argumentsJSON: json([json(request)]))
                }
            } else {
                var journalWrites = 0
                faults.journalWrite = { journalWrites += 1; if journalWrites == 2 { throw HostFailure("Injected Project status lost reply") } }
                await expectFailure("lost reply") {
                    _ = try await writer.call("projectStatusWrite", argumentsJSON: json([json(request)]))
                }
            }
            await writer.close()
            let edit = try SQLiteBridge(url: database)
            _ = try edit.execute("UPDATE projects SET title = 'Newer title', updatedAt = ?, rev = rev + 1 WHERE id = 'focus-target'",
                                 parametersJSON: json([recentAreaTestTime(daysAgo: 0)]))
            let before = try nineTableSnapshot(edit)
            edit.close()
            let replayFaults = HostIOFaults()
            var writes = 0
            replayFaults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:projects|tasks|sections|areas|people|settings|saved_filters|calendar_sync)\b"#, options: .regularExpression) != nil { writes += 1 }
            }
            let replay = host(replayFaults)
            await expectFailure("STALE_REVISION") { _ = try await replay.start() }
            XCTAssertEqual(writes, 0)
            XCTAssertTrue(FileManager.default.fileExists(atPath: journal.path))
            let check = try SQLiteBridge(url: database)
            XCTAssertEqual(try nineTableSnapshot(check), before)
            check.close()
            await replay.close()
            directory = parent
        }
    }

    func testProjectDateFailedCommitExactRetryPreservesRichRowsAndOtherDates() async throws {
        try await seedProjectRenameRows()
        let edit = try SQLiteBridge(url: database)
        _ = try edit.execute("UPDATE projects SET startDate = ?, dueDate = ?, reviewAt = ? WHERE id = 'focus-target'",
                             parametersJSON: json(["2036-03-08T10:30:00.000Z", "2036-11-02", "2036-05-01T12:00:00.000Z"]))
        edit.close()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let options = try object(await core.call("projectDateOptions",
                                                argumentsJSON: json([json(["projectId": "focus-target", "field": "startDate"])])))
        XCTAssertEqual(options["canEdit"] as? Bool, true)
        XCTAssertEqual((options["picker"] as? [String: Any])?["time"] as? String, "12:00")
        let oldPicker = try XCTUnwrap(options["picker"] as? [String: Any])
        let oldProject = try XCTUnwrap(options["project"] as? [String: Any])
        XCTAssertEqual(Set(oldPicker.keys), Set(["date", "time"]))
        XCTAssertEqual(Set(oldProject.keys), Set(["id", "title", "status", "startDate", "dueDate", "rev", "revBy", "updatedAt"]))
        let request = try await projectDateRequest(core, field: "startDate", value: "2036-03-09")
        let targetBefore = try XCTUnwrap(projectRows("focus-target").first)
        let beforeSQLite = try SQLiteBridge(url: database)
        let before = try nineTableSnapshot(beforeSQLite)
        beforeSQLite.close()
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected Project date COMMIT failure") } }
        await expectFailure("SAVE_FAILED") {
            _ = try await core.call("projectDateWrite", argumentsJSON: json([json(request)]))
        }
        XCTAssertEqual(try object(String(contentsOf: journal))["method"] as? String, "projectDateCommit")
        let rolledBack = try SQLiteBridge(url: database)
        XCTAssertEqual(try nineTableSnapshot(rolledBack), before)
        rolledBack.close()
        faults.beforeSQL = nil
        let retryValue = try await core.retryPending()
        let result = try object(XCTUnwrap(retryValue))
        XCTAssertEqual(result["id"] as? String, "focus-target")
        XCTAssertEqual(result["field"] as? String, "startDate")
        XCTAssertEqual(result["value"] as? String, "2036-03-09")
        let targetAfter = try XCTUnwrap(projectRows("focus-target").first)
        XCTAssertEqual(targetAfter["startDate"] as? String, "2036-03-09")
        XCTAssertEqual(targetAfter["dueDate"] as? String, "2036-11-02")
        XCTAssertEqual(targetAfter["reviewAt"] as? String, "2036-05-01T12:00:00.000Z")
        XCTAssertEqual(targetAfter["rev"] as? Int, (targetBefore["rev"] as? Int ?? 0) + 1)
        for (field, value) in targetBefore where !["startDate", "rev", "revBy", "updatedAt"].contains(field) {
            XCTAssertEqual(try json([targetAfter[field] ?? NSNull()]), try json([value]), field)
        }
        let saved = try SQLiteBridge(url: database)
        let after = try nineTableSnapshot(saved)
        saved.close()
        for index in [0, 2, 3, 4, 5, 6, 7, 8] { XCTAssertEqual(after[index], before[index]) }
        XCTAssertEqual(try storedTask("rename-task")["dueDate"] as? String, "2036-10-02")
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        let clear = try await projectDateRequest(core, field: "dueDate", value: NSNull())
        let cleared = try object(await core.call("projectDateWrite", argumentsJSON: json([json(clear)])))
        XCTAssertEqual(cleared["field"] as? String, "dueDate")
        XCTAssertTrue(cleared["value"] is NSNull)
        let stored = try XCTUnwrap(projectRows("focus-target").first)
        XCTAssertTrue(stored["dueDate"] is NSNull)
        XCTAssertEqual(stored["startDate"] as? String, "2036-03-09")
        let noop = try await projectDateRequest(core, field: "dueDate", value: NSNull())
        var writes = 0, journals = 0
        faults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:projects|tasks|sections|areas|people|settings|saved_filters|calendar_sync)\b"#, options: .regularExpression) != nil { writes += 1 }
        }
        faults.journalWrite = { journals += 1 }
        let noWrite = try object(await core.call("projectDateWrite", argumentsJSON: json([json(noop)])))
        XCTAssertTrue(noWrite["value"] is NSNull)
        XCTAssertEqual(writes, 0); XCTAssertEqual(journals, 0)
        await core.close()
    }

    func testProjectDateEmptyClearArchivedAndMalformedRequestsWriteNothing() async throws {
        let parent = directory!
        for kind in ["empty", "archived"] {
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await seedProjectRenameRows(targetStatus: kind == "archived" ? "archived" : "active")
            if kind == "empty" {
                let edit = try SQLiteBridge(url: database)
                _ = try edit.execute("UPDATE projects SET startDate = '' WHERE id = 'focus-target'")
                edit.close()
            }
            let faults = HostIOFaults()
            let core = host(faults)
            _ = try await core.start()
            let options = try object(await core.call("projectDateOptions",
                                                    argumentsJSON: json([json(["projectId": "focus-target", "field": "startDate"])])))
            XCTAssertEqual(options["canEdit"] as? Bool, kind != "archived")
            let request = try await projectDateRequest(core, field: "startDate", value: NSNull())
            var writes = 0, journals = 0
            faults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:projects|tasks|sections|areas|people|settings|saved_filters|calendar_sync)\b"#, options: .regularExpression) != nil { writes += 1 }
            }
            faults.journalWrite = { journals += 1 }
            let noPending = try await core.retryPending()
            XCTAssertNil(noPending)
            await expectFailure("STALE_REVISION") {
                _ = try await core.call("projectDateRetryOutcome", argumentsJSON: json([json(request)]))
            }
            let result = try object(await core.call("projectDateWrite", argumentsJSON: json([json(request)])))
            if kind == "archived" { XCTAssertEqual(result["blocked"] as? String, "") }
            else {
                XCTAssertEqual(result["field"] as? String, "startDate")
                XCTAssertTrue(result["value"] is NSNull)
                XCTAssertEqual(try projectRows("focus-target").first?["startDate"] as? String, "")
            }
            var stale = request
            var expected = try XCTUnwrap(stale["expected"] as? [String: Any])
            expected["title"] = "stale title"; stale["expected"] = expected
            await expectFailure("STALE_REVISION") {
                _ = try await core.call("projectDateWrite", argumentsJSON: json([json(stale)]))
            }
            for invalid in ["2035-02-29", "2036-03-08T12:00:00Z", "2036-13-01"] {
                var malformed = request; malformed["value"] = invalid
                await expectFailure("INVALID_INPUT") {
                    _ = try await core.call("projectDateWrite", argumentsJSON: json([json(malformed)]))
                }
            }
            var review = request; review["field"] = "reviewAt"
            await expectFailure("INVALID_INPUT") {
                _ = try await core.call("projectDateWrite", argumentsJSON: json([json(review)]))
            }
            expected = try XCTUnwrap(request["expected"] as? [String: Any])
            expected["startDate"] = String(repeating: "x", count: 101)
            var overlong = request; overlong["expected"] = expected
            await expectFailure("INVALID_INPUT") {
                _ = try await core.call("projectDateWrite", argumentsJSON: json([json(overlong)]))
            }
            var oversized = request
            expected["title"] = String(repeating: "漢", count: 700_000)
            oversized["expected"] = expected
            await expectFailure("INVALID_INPUT") {
                _ = try await core.call("projectDateWrite", argumentsJSON: json([json(oversized)]))
            }
            let reviewOptions = try object(await core.call("projectDateOptions",
                                                           argumentsJSON: json([json(["projectId": "focus-target", "field": "reviewAt"])])))
            XCTAssertEqual(reviewOptions["canEdit"] as? Bool, kind != "archived")
            let reviewProject = try XCTUnwrap(reviewOptions["project"] as? [String: Any])
            XCTAssertEqual(Set(reviewProject.keys), Set(["id", "title", "status", "startDate", "dueDate", "reviewAt", "rev", "revBy", "updatedAt"]))
            let reviewPicker = try XCTUnwrap(reviewOptions["picker"] as? [String: Any])
            XCTAssertEqual(Set(reviewPicker.keys), Set(["date", "time", "instant", "preserveUnchanged"]))
            await expectFailure("STALE_REVISION") {
                _ = try await core.call("projectDateOptions", argumentsJSON: json([json(["projectId": "missing-project", "field": "startDate"])]))
            }
            XCTAssertEqual(writes, 0); XCTAssertEqual(journals, 0)
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            await core.close()
            directory = parent
        }
    }

    func testProjectDateColdFirstApplyAndFullAfterReceiptNeverReapplies() async throws {
        let parent = directory!
        for kind in ["first", "receipt"] {
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await seedProjectRenameRows()
            let faults = HostIOFaults()
            let writer = host(faults)
            _ = try await writer.start()
            let request = try await projectDateRequest(writer, field: "dueDate", value: "2036-02-29")
            let targetBefore = try XCTUnwrap(projectRows("focus-target").first)
            if kind == "first" {
                faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Project date") } }
                await expectFailure("SAVE_FAILED") {
                    _ = try await writer.call("projectDateWrite", argumentsJSON: json([json(request)]))
                }
            } else {
                var journalWrites = 0
                faults.journalWrite = { journalWrites += 1; if journalWrites == 2 { throw HostFailure("Injected Project date lost reply") } }
                await expectFailure("lost reply") {
                    _ = try await writer.call("projectDateWrite", argumentsJSON: json([json(request)]))
                }
            }
            let pending = try object(String(contentsOf: journal))
            XCTAssertEqual(pending["method"] as? String, "projectDateCommit")
            let frozenArgs = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(pending["argumentsJSON"] as? String).utf8)) as? [String])
            let frozen = try object(XCTUnwrap(frozenArgs.first))
            let oldRequest = try XCTUnwrap(frozen["request"] as? [String: Any])
            let oldExpected = try XCTUnwrap(oldRequest["expected"] as? [String: Any])
            XCTAssertEqual(Set(oldExpected.keys), Set(["title", "status", "startDate", "dueDate", "rev", "revBy", "updatedAt"]))
            XCTAssertEqual((frozen["prepared"] as? [String: Any])?["version"] as? Int, 1)
            await writer.close()
            if kind == "receipt" {
                var settings = try calendarPreferenceSettings()
                settings["deviceId"] = UUID().uuidString.lowercased()
                try writeCalendarPreferenceSettings(settings)
                let edit = try SQLiteBridge(url: database)
                _ = try edit.execute("UPDATE projects SET title = 'Later unrelated edit', updatedAt = ?, rev = rev + 1 WHERE id = 'focus-other-0'",
                                     parametersJSON: json([recentAreaTestTime(daysAgo: 0)]))
                edit.close()
            }
            let beforeSQLite = try SQLiteBridge(url: database)
            let before = try nineTableSnapshot(beforeSQLite)
            beforeSQLite.close()
            let replayFaults = HostIOFaults()
            var writes = 0
            replayFaults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:projects|tasks|sections|areas|people|settings|saved_filters|calendar_sync)\b"#, options: .regularExpression) != nil { writes += 1 }
            }
            let reopened = host(replayFaults)
            let startup = try object(await reopened.start())
            let recovery = try XCTUnwrap(startup["recovery"] as? [String: Any])
            XCTAssertEqual(recovery["method"] as? String, "projectDateCommit")
            let result = try XCTUnwrap(recovery["result"] as? [String: Any])
            XCTAssertEqual(result["field"] as? String, "dueDate")
            XCTAssertEqual(result["value"] as? String, "2036-02-29")
            if kind == "receipt" {
                XCTAssertEqual(writes, 0)
                let check = try SQLiteBridge(url: database)
                XCTAssertEqual(try nineTableSnapshot(check), before)
                check.close()
            } else { XCTAssertGreaterThan(writes, 0) }
            XCTAssertEqual(try projectRows("focus-target").first?["dueDate"] as? String, "2036-02-29")
            XCTAssertEqual(try projectRows("focus-target").first?["rev"] as? Int, (targetBefore["rev"] as? Int ?? 0) + 1)
            XCTAssertEqual(try storedTask("rename-task")["projectId"] as? String, "focus-target")
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            await reopened.close()
            directory = parent
        }
    }

    func testProjectDateForgedPendingAndTerminalJournalsRefuseBeforeSQL() async throws {
        try await seedProjectRenameRows()
        let faults = HostIOFaults()
        let writer = host(faults)
        _ = try await writer.start()
        let request = try await projectDateRequest(writer, field: "startDate", value: "2036-03-09")
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Project date") } }
        await expectFailure("SAVE_FAILED") {
            _ = try await writer.call("projectDateWrite", argumentsJSON: json([json(request)]))
        }
        let pending = try object(String(contentsOf: journal))
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(pending["argumentsJSON"] as? String).utf8)) as? [String])
        let original = try object(XCTUnwrap(args.first))
        let prepared = try XCTUnwrap(original["prepared"] as? [String: Any])
        await writer.close()
        for corruption in ["request", "effect", "missing-project-field", "result", "terminal", "malformed"] {
            var envelope = original
            var argumentsJSON = try XCTUnwrap(pending["argumentsJSON"] as? String)
            var terminal: [String: Any]? = nil
            switch corruption {
            case "request":
                var changed = try XCTUnwrap(envelope["request"] as? [String: Any])
                changed["field"] = "dueDate"
                envelope["request"] = changed
                argumentsJSON = try json([json(envelope)])
            case "effect":
                var forged = prepared
                var effect = try XCTUnwrap(forged["effect"] as? [String: Any])
                var pair = try XCTUnwrap(effect["project"] as? [String: Any])
                var after = try XCTUnwrap(pair["after"] as? [String: Any])
                after["startDate"] = "2036-03-10"
                pair["after"] = after; effect["project"] = pair; forged["effect"] = effect
                envelope["prepared"] = forged
                argumentsJSON = try json([json(envelope)])
            case "missing-project-field":
                var forged = prepared
                var scope = try XCTUnwrap(forged["scope"] as? [String: Any])
                var project = try XCTUnwrap(scope["project"] as? [String: Any])
                project.removeValue(forKey: "tagIds")
                scope["project"] = project; forged["scope"] = scope
                envelope["prepared"] = forged
                argumentsJSON = try json([json(envelope)])
            case "result":
                var forged = prepared
                var result = try XCTUnwrap(forged["result"] as? [String: Any])
                result["value"] = "2036-03-10"
                forged["result"] = result; envelope["prepared"] = forged
                argumentsJSON = try json([json(envelope)])
            case "terminal": terminal = ["success": ["_0": try json(["id": "focus-target", "field": "startDate", "value": "2036-03-10"])]]
            default: argumentsJSON = try json([["malformed": true]])
            }
            var forgedJournal: [String: Any] = ["version": 2, "method": "projectDateCommit", "argumentsJSON": argumentsJSON]
            if let terminal { forgedJournal["terminal"] = terminal }
            let bytes = Data(try json(forgedJournal).utf8)
            try bytes.write(to: journal)
            let blockedFaults = HostIOFaults()
            var sql = 0, cleanup = 0
            blockedFaults.beforeSQL = { _ in sql += 1 }
            blockedFaults.journalRemove = { cleanup += 1 }
            let blocked = host(blockedFaults)
            await expectFailure { _ = try await blocked.start() }
            XCTAssertEqual(sql, 0); XCTAssertEqual(cleanup, 0)
            XCTAssertEqual(try Data(contentsOf: journal), bytes)
            await blocked.close()
        }
    }

    func testProjectDateChangedBeforeAndPartialAfterRefuseWithoutOverwrite() async throws {
        let parent = directory!
        for kind in ["before", "partial-after"] {
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await seedProjectRenameRows()
            let faults = HostIOFaults()
            let writer = host(faults)
            _ = try await writer.start()
            let request = try await projectDateRequest(writer, field: "dueDate", value: "2036-02-29")
            if kind == "before" {
                faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Project date") } }
                await expectFailure("SAVE_FAILED") {
                    _ = try await writer.call("projectDateWrite", argumentsJSON: json([json(request)]))
                }
            } else {
                var journalWrites = 0
                faults.journalWrite = { journalWrites += 1; if journalWrites == 2 { throw HostFailure("Injected Project date lost reply") } }
                await expectFailure("lost reply") {
                    _ = try await writer.call("projectDateWrite", argumentsJSON: json([json(request)]))
                }
            }
            await writer.close()
            let edit = try SQLiteBridge(url: database)
            _ = try edit.execute("UPDATE projects SET title = 'Newer title', updatedAt = ?, rev = rev + 1 WHERE id = 'focus-target'",
                                 parametersJSON: json([recentAreaTestTime(daysAgo: 0)]))
            let before = try nineTableSnapshot(edit)
            edit.close()
            let replayFaults = HostIOFaults()
            var writes = 0
            replayFaults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:projects|tasks|sections|areas|people|settings|saved_filters|calendar_sync)\b"#, options: .regularExpression) != nil { writes += 1 }
            }
            let replay = host(replayFaults)
            await expectFailure("STALE_REVISION") { _ = try await replay.start() }
            XCTAssertEqual(writes, 0)
            XCTAssertTrue(FileManager.default.fileExists(atPath: journal.path))
            let check = try SQLiteBridge(url: database)
            XCTAssertEqual(try nineTableSnapshot(check), before)
            check.close()
            await replay.close()
            directory = parent
        }
    }

    func testProjectReviewDateFailedCommitExactRetryAndClearPreserveRichRows() async throws {
        try await seedProjectRenameRows()
        let edit = try SQLiteBridge(url: database)
        _ = try edit.execute("UPDATE projects SET startDate = ?, dueDate = ?, reviewAt = ? WHERE id = 'focus-target'",
                             parametersJSON: json(["2036-03-08", "2036-11-02T09:45:00.000Z", "2036-03-07"]))
        edit.close()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let options = try object(await core.call("projectDateOptions",
                                                argumentsJSON: json([json(["projectId": "focus-target", "field": "reviewAt"])])))
        let picker = try XCTUnwrap(options["picker"] as? [String: Any])
        XCTAssertEqual(Set(picker.keys), Set(["date", "time", "instant", "preserveUnchanged"]))
        XCTAssertEqual(picker["preserveUnchanged"] as? Bool, true)
        XCTAssertNotNil(picker["instant"] as? String)
        let request = try await projectDateRequest(core, field: "reviewAt", value: "2036-03-09T16:30:00.000Z")
        let token = try XCTUnwrap(request["expected"] as? [String: Any])
        XCTAssertEqual(Set(token.keys), Set(["title", "status", "startDate", "dueDate", "reviewAt", "rev", "revBy", "updatedAt"]))
        XCTAssertEqual(token["reviewAt"] as? String, "2036-03-07")
        let targetBefore = try XCTUnwrap(projectRows("focus-target").first)
        let beforeSQLite = try SQLiteBridge(url: database)
        let before = try nineTableSnapshot(beforeSQLite)
        beforeSQLite.close()
        var diagnostics: [String] = []
        faults.commandDiagnostic = { diagnostics.append($0) }
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected Review Date COMMIT failure") } }
        await expectFailure("SAVE_FAILED") { _ = try await core.call("projectDateWrite", argumentsJSON: json([json(request)])) }
        XCTAssertTrue(diagnostics.isEmpty)
        let pending = try object(String(contentsOf: journal))
        XCTAssertEqual(pending["method"] as? String, "projectDateCommit")
        let rolledBack = try SQLiteBridge(url: database)
        XCTAssertEqual(try nineTableSnapshot(rolledBack), before)
        rolledBack.close()
        faults.beforeSQL = nil
        let retry = try await core.retryPending()
        let result = try object(XCTUnwrap(retry))
        XCTAssertEqual(result["id"] as? String, "focus-target")
        XCTAssertEqual(result["field"] as? String, "reviewAt")
        XCTAssertEqual(result["value"] as? String, "2036-03-09T16:30:00.000Z")
        XCTAssertEqual(diagnostics, ["projectReviewDateApplied"])
        let targetAfter = try XCTUnwrap(projectRows("focus-target").first)
        XCTAssertEqual(targetAfter["reviewAt"] as? String, "2036-03-09T16:30:00.000Z")
        XCTAssertEqual(targetAfter["startDate"] as? String, "2036-03-08")
        XCTAssertEqual(targetAfter["dueDate"] as? String, "2036-11-02T09:45:00.000Z")
        XCTAssertEqual(targetAfter["rev"] as? Int, (targetBefore["rev"] as? Int ?? 0) + 1)
        for (field, value) in targetBefore where !["reviewAt", "rev", "revBy", "updatedAt"].contains(field) {
            XCTAssertEqual(try json([targetAfter[field] ?? NSNull()]), try json([value]), field)
        }
        let saved = try SQLiteBridge(url: database)
        let after = try nineTableSnapshot(saved)
        saved.close()
        for index in [0, 2, 3, 4, 5, 6, 7, 8] { XCTAssertEqual(after[index], before[index]) }
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        let clear = try await projectDateRequest(core, field: "reviewAt", value: NSNull())
        let cleared = try object(await core.call("projectDateWrite", argumentsJSON: json([json(clear)])))
        XCTAssertEqual(cleared["field"] as? String, "reviewAt")
        XCTAssertTrue(cleared["value"] is NSNull)
        XCTAssertTrue(try XCTUnwrap(projectRows("focus-target").first)["reviewAt"] is NSNull)
        XCTAssertEqual(diagnostics, ["projectReviewDateApplied", "projectReviewDateApplied"])
        let emptyClear = try await projectDateRequest(core, field: "reviewAt", value: NSNull())
        var writes = 0, journals = 0
        faults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:projects|tasks|sections|areas|people|settings|saved_filters|calendar_sync)\b"#,
                         options: .regularExpression) != nil { writes += 1 }
        }
        faults.journalWrite = { journals += 1 }
        let noWrite = try object(await core.call("projectDateWrite", argumentsJSON: json([json(emptyClear)])))
        XCTAssertTrue(noWrite["value"] is NSNull)
        XCTAssertEqual(writes, 0); XCTAssertEqual(journals, 0)
        await expectFailure("STALE_REVISION") {
            _ = try await core.call("projectDateRetryOutcome", argumentsJSON: json([json(request)]))
        }
        await core.close()
    }

    func testProjectReviewDateLegacyOptionsAndMalformedRequestsWriteNothing() async throws {
        for kind in ["offset", "invalid", "archived"] {
            let parent = directory!
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await seedProjectRenameRows(targetStatus: kind == "archived" ? "archived" : "active")
            let raw = kind == "offset" ? "2036-03-07T13:30:00+02:00" : kind == "invalid" ? "legacy-invalid" : "2036-03-07"
            let edit = try SQLiteBridge(url: database)
            _ = try edit.execute("UPDATE projects SET reviewAt = ? WHERE id = 'focus-target'", parametersJSON: json([raw]))
            edit.close()
            let faults = HostIOFaults()
            let core = host(faults)
            _ = try await core.start()
            var writes = 0, journals = 0
            faults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+"#,
                             options: .regularExpression) != nil { writes += 1 }
            }
            faults.journalWrite = { journals += 1 }
            let options = try object(await core.call("projectDateOptions",
                                                     argumentsJSON: json([json(["projectId": "focus-target", "field": "reviewAt"])])))
            XCTAssertEqual(options["canEdit"] as? Bool, kind != "archived")
            XCTAssertEqual((options["project"] as? [String: Any])?["reviewAt"] as? String, raw)
            let picker = try XCTUnwrap(options["picker"] as? [String: Any])
            XCTAssertEqual(Set(picker.keys), Set(["date", "time", "instant", "preserveUnchanged"]))
            XCTAssertEqual(picker["preserveUnchanged"] as? Bool, kind != "invalid")
            let request = try await projectDateRequest(core, field: "reviewAt", value: "2036-03-09T16:30:00.000Z")
            await expectFailure("STALE_REVISION") {
                _ = try await core.call("projectDateRetryOutcome", argumentsJSON: json([json(request)]))
            }
            var stale = request
            var expected = try XCTUnwrap(request["expected"] as? [String: Any])
            expected["title"] = "Stale title"; stale["expected"] = expected
            await expectFailure("STALE_REVISION") { _ = try await core.call("projectDateWrite", argumentsJSON: json([json(stale)])) }
            for invalid in ["2036-03-09", "2036-03-09T16:30:00Z", "2036-03-09T16:30:00.000+00:00",
                            "2036-03-09T16:30:00.0000Z", "2036-02-30T16:30:00.000Z"] {
                var malformed = request; malformed["value"] = invalid
                await expectFailure("INVALID_INPUT") { _ = try await core.call("projectDateWrite", argumentsJSON: json([json(malformed)])) }
            }
            var wrongToken = request
            expected = try XCTUnwrap(request["expected"] as? [String: Any])
            expected.removeValue(forKey: "reviewAt"); wrongToken["expected"] = expected
            await expectFailure("INVALID_INPUT") { _ = try await core.call("projectDateWrite", argumentsJSON: json([json(wrongToken)])) }
            if kind == "archived" {
                let blocked = try object(await core.call("projectDateWrite", argumentsJSON: json([json(request)])))
                XCTAssertEqual(blocked["blocked"] as? String, "")
            }
            XCTAssertEqual(writes, 0); XCTAssertEqual(journals, 0)
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            await core.close()
            directory = parent
        }
    }

    func testProjectReviewDateColdFirstReceiptAndTerminalCleanup() async throws {
        for kind in ["first", "receipt", "terminal"] {
            let parent = directory!
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await seedProjectRenameRows()
            let faults = HostIOFaults()
            let writer = host(faults)
            _ = try await writer.start()
            let request = try await projectDateRequest(writer, field: "reviewAt", value: "2036-03-09T16:30:00.000Z")
            let targetBefore = try XCTUnwrap(projectRows("focus-target").first)
            if kind == "first" {
                faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Review Date") } }
                await expectFailure("SAVE_FAILED") { _ = try await writer.call("projectDateWrite", argumentsJSON: json([json(request)])) }
            } else if kind == "receipt" {
                var journalWrites = 0
                faults.journalWrite = { journalWrites += 1; if journalWrites == 2 { throw HostFailure("Injected Review Date lost reply") } }
                await expectFailure("lost reply") { _ = try await writer.call("projectDateWrite", argumentsJSON: json([json(request)])) }
            } else {
                faults.journalRemove = { throw HostFailure("Injected Review Date terminal cleanup") }
                await expectFailure("terminal cleanup") { _ = try await writer.call("projectDateWrite", argumentsJSON: json([json(request)])) }
            }
            let pending = try object(String(contentsOf: journal))
            XCTAssertEqual(pending["method"] as? String, "projectDateCommit")
            let frozenArgs = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(pending["argumentsJSON"] as? String).utf8)) as? [String])
            let frozen = try object(XCTUnwrap(frozenArgs.first))
            let prepared = try XCTUnwrap(frozen["prepared"] as? [String: Any])
            XCTAssertEqual(prepared["version"] as? Int, 1)
            XCTAssertEqual((prepared["result"] as? [String: Any])?["value"] as? String, "2036-03-09T16:30:00.000Z")
            await writer.close()
            if kind != "first" {
                var settings = try calendarPreferenceSettings()
                settings["deviceId"] = UUID().uuidString.lowercased()
                try writeCalendarPreferenceSettings(settings)
                let edit = try SQLiteBridge(url: database)
                _ = try edit.execute("UPDATE projects SET title = 'Later unrelated edit', updatedAt = ?, rev = rev + 1 WHERE id = 'focus-other-0'",
                                     parametersJSON: json([recentAreaTestTime(daysAgo: 0)]))
                edit.close()
            }
            let beforeSQLite = try SQLiteBridge(url: database)
            let before = try nineTableSnapshot(beforeSQLite)
            beforeSQLite.close()
            let replayFaults = HostIOFaults()
            var writes = 0
            var diagnostics: [String] = []
            replayFaults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:projects|tasks|sections|areas|people|settings|saved_filters|calendar_sync)\b"#,
                             options: .regularExpression) != nil { writes += 1 }
            }
            replayFaults.commandDiagnostic = { diagnostics.append($0) }
            let reopened = host(replayFaults)
            let startup = try object(await reopened.start())
            let recovery = try XCTUnwrap(startup["recovery"] as? [String: Any])
            XCTAssertEqual(recovery["method"] as? String, "projectDateCommit")
            XCTAssertEqual((recovery["result"] as? [String: Any])?["field"] as? String, "reviewAt")
            XCTAssertEqual((recovery["result"] as? [String: Any])?["value"] as? String, "2036-03-09T16:30:00.000Z")
            XCTAssertEqual(diagnostics, ["projectReviewDateApplied"])
            if kind == "first" { XCTAssertGreaterThan(writes, 0) }
            else {
                XCTAssertEqual(writes, 0)
                let check = try SQLiteBridge(url: database)
                XCTAssertEqual(try nineTableSnapshot(check), before)
                check.close()
            }
            XCTAssertEqual(try projectRows("focus-target").first?["reviewAt"] as? String, "2036-03-09T16:30:00.000Z")
            XCTAssertEqual(try projectRows("focus-target").first?["rev"] as? Int, (targetBefore["rev"] as? Int ?? 0) + 1)
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            await reopened.close()
            directory = parent
        }
    }

    func testProjectReviewDateForgedJournalsRefuseBeforeSQLite() async throws {
        try await seedProjectRenameRows()
        let faults = HostIOFaults()
        let writer = host(faults)
        _ = try await writer.start()
        let request = try await projectDateRequest(writer, field: "reviewAt", value: "2036-03-09T16:30:00.000Z")
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Review Date") } }
        await expectFailure("SAVE_FAILED") { _ = try await writer.call("projectDateWrite", argumentsJSON: json([json(request)])) }
        let pending = try object(String(contentsOf: journal))
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(pending["argumentsJSON"] as? String).utf8)) as? [String])
        let original = try object(XCTUnwrap(args.first))
        await writer.close()
        let databaseBytes = try Data(contentsOf: database)
        for corruption in ["request-value", "expected", "scope", "effect", "result", "terminal", "malformed"] {
            var envelope = original
            var forged = pending
            if corruption == "request-value" {
                var changed = try XCTUnwrap(envelope["request"] as? [String: Any])
                changed["value"] = "2036-03-09"
                envelope["request"] = changed
            } else if corruption == "expected" {
                var changed = try XCTUnwrap(envelope["request"] as? [String: Any])
                var expected = try XCTUnwrap(changed["expected"] as? [String: Any])
                expected.removeValue(forKey: "reviewAt"); changed["expected"] = expected
                envelope["request"] = changed
            } else if ["scope", "effect", "result"].contains(corruption) {
                var prepared = try XCTUnwrap(envelope["prepared"] as? [String: Any])
                if corruption == "scope" {
                    var scope = try XCTUnwrap(prepared["scope"] as? [String: Any])
                    var project = try XCTUnwrap(scope["project"] as? [String: Any])
                    project["reviewAt"] = "2036-03-08"; scope["project"] = project; prepared["scope"] = scope
                } else if corruption == "effect" {
                    var effect = try XCTUnwrap(prepared["effect"] as? [String: Any])
                    var pair = try XCTUnwrap(effect["project"] as? [String: Any])
                    var after = try XCTUnwrap(pair["after"] as? [String: Any])
                    after["reviewAt"] = "2036-03-10T16:30:00.000Z"
                    pair["after"] = after; effect["project"] = pair; prepared["effect"] = effect
                } else {
                    prepared["result"] = ["id": "focus-target", "field": "reviewAt", "value": "2036-03-10T16:30:00.000Z"]
                }
                envelope["prepared"] = prepared
            } else if corruption == "terminal" {
                forged["terminal"] = ["success": ["_0": try json(["id": "focus-target", "field": "reviewAt", "value": "2036-03-10T16:30:00.000Z"])]]
            }
            forged["argumentsJSON"] = corruption == "malformed" ? "[]" : try json([json(envelope)])
            let bytes = Data(try json(forged).utf8)
            try bytes.write(to: journal)
            let blockedFaults = HostIOFaults()
            var sql = 0, cleanup = 0
            blockedFaults.beforeSQL = { _ in sql += 1 }
            blockedFaults.journalRemove = { cleanup += 1 }
            let blocked = host(blockedFaults)
            await expectFailure { _ = try await blocked.start() }
            XCTAssertEqual(sql, 0, corruption); XCTAssertEqual(cleanup, 0, corruption)
            XCTAssertEqual(try Data(contentsOf: database), databaseBytes, corruption)
            XCTAssertEqual(try Data(contentsOf: journal), bytes, corruption)
            await blocked.close()
        }
    }

    func testProjectNotesWriteFailedCommitExactRetryPreservesRawTextAndRichRows() async throws {
        try await seedProjectRenameRows()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let raw = "  \n# Café 👩🏽‍💻\n\n  Keep trailing space  \n"
        let request = try await projectNotesWriteRequest(core, text: raw)
        let targetBefore = try XCTUnwrap(projectRows("focus-target").first)
        let beforeSQLite = try SQLiteBridge(url: database)
        let before = try nineTableSnapshot(beforeSQLite)
        beforeSQLite.close()
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected Project Notes COMMIT failure") } }
        await expectFailure("SAVE_FAILED") {
            _ = try await core.call("projectNotesWrite", argumentsJSON: json([json(request)]))
        }
        XCTAssertEqual(try object(String(contentsOf: journal))["method"] as? String, "projectNotesWriteCommit")
        let rolledBack = try SQLiteBridge(url: database)
        XCTAssertEqual(try nineTableSnapshot(rolledBack), before)
        rolledBack.close()
        faults.beforeSQL = nil
        let retryValue = try await core.retryPending()
        let result = try object(XCTUnwrap(retryValue))
        XCTAssertEqual(result["id"] as? String, "focus-target")
        XCTAssertEqual(result["supportNotes"] as? String, raw)
        let targetAfter = try XCTUnwrap(projectRows("focus-target").first)
        XCTAssertEqual(targetAfter["supportNotes"] as? String, raw)
        XCTAssertEqual(targetAfter["rev"] as? Int, (targetBefore["rev"] as? Int ?? 0) + 1)
        for (field, value) in targetBefore where !["supportNotes", "rev", "revBy", "updatedAt"].contains(field) {
            XCTAssertEqual(try json([targetAfter[field] ?? NSNull()]), try json([value]), field)
        }
        let saved = try SQLiteBridge(url: database)
        let after = try nineTableSnapshot(saved)
        saved.close()
        for index in [0, 2, 3, 4, 5, 6, 7, 8] { XCTAssertEqual(after[index], before[index]) }
        XCTAssertEqual(try storedTask("rename-task")["projectId"] as? String, "focus-target")
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        var writes = 0, journals = 0
        faults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:projects|tasks|sections|areas|people|settings|saved_filters|calendar_sync)\b"#, options: .regularExpression) != nil { writes += 1 }
        }
        faults.journalWrite = { journals += 1 }
        await expectFailure("STALE_REVISION") {
            _ = try await core.call("projectNotesWrite", argumentsJSON: json([json(request)]))
        }
        XCTAssertEqual(writes, 0); XCTAssertEqual(journals, 0)
        await core.close()
    }

    func testProjectNotesWriteColdFirstApplyAndFullAfterReceiptPreserveExactText() async throws {
        let parent = directory!
        for kind in ["first", "receipt"] {
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await seedProjectRenameRows()
            let faults = HostIOFaults()
            let writer = host(faults)
            _ = try await writer.start()
            let raw = "\n  verbatim 🌿  \n"
            let request = try await projectNotesWriteRequest(writer, text: raw)
            let targetBefore = try XCTUnwrap(projectRows("focus-target").first)
            if kind == "first" {
                faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Project Notes") } }
                await expectFailure("SAVE_FAILED") {
                    _ = try await writer.call("projectNotesWrite", argumentsJSON: json([json(request)]))
                }
            } else {
                var journalWrites = 0
                faults.journalWrite = { journalWrites += 1; if journalWrites == 2 { throw HostFailure("Injected Project Notes lost reply") } }
                await expectFailure("lost reply") {
                    _ = try await writer.call("projectNotesWrite", argumentsJSON: json([json(request)]))
                }
            }
            let pending = try object(String(contentsOf: journal))
            let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(pending["argumentsJSON"] as? String).utf8)) as? [String])
            let envelope = try object(XCTUnwrap(args.first))
            let prepared = try XCTUnwrap(envelope["prepared"] as? [String: Any])
            XCTAssertEqual((prepared["result"] as? [String: Any])?["supportNotes"] as? String, raw)
            await writer.close()
            if kind == "receipt" {
                var settings = try calendarPreferenceSettings()
                settings["deviceId"] = UUID().uuidString.lowercased()
                try writeCalendarPreferenceSettings(settings)
                let edit = try SQLiteBridge(url: database)
                _ = try edit.execute("UPDATE projects SET title = 'Later unrelated edit', updatedAt = ?, rev = rev + 1 WHERE id = 'focus-other-0'",
                                     parametersJSON: json([recentAreaTestTime(daysAgo: 0)]))
                edit.close()
            }
            let beforeSQLite = try SQLiteBridge(url: database)
            let before = try nineTableSnapshot(beforeSQLite)
            beforeSQLite.close()
            let replayFaults = HostIOFaults()
            var writes = 0
            replayFaults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:projects|tasks|sections|areas|people|settings|saved_filters|calendar_sync)\b"#, options: .regularExpression) != nil { writes += 1 }
            }
            let reopened = host(replayFaults)
            let startup = try object(await reopened.start())
            let recovery = try XCTUnwrap(startup["recovery"] as? [String: Any])
            XCTAssertEqual(recovery["method"] as? String, "projectNotesWriteCommit")
            XCTAssertEqual((recovery["result"] as? [String: Any])?["supportNotes"] as? String, raw)
            if kind == "receipt" {
                XCTAssertEqual(writes, 0)
                let check = try SQLiteBridge(url: database)
                XCTAssertEqual(try nineTableSnapshot(check), before)
                check.close()
            } else { XCTAssertGreaterThan(writes, 0) }
            XCTAssertEqual(try projectRows("focus-target").first?["supportNotes"] as? String, raw)
            XCTAssertEqual(try projectRows("focus-target").first?["rev"] as? Int, (targetBefore["rev"] as? Int ?? 0) + 1)
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            await reopened.close()
            directory = parent
        }
    }

    func testProjectNotesWriteNoopArchivedNilPendingAndMalformedWriteNothing() async throws {
        let parent = directory!
        for kind in ["empty-null", "archived"] {
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await seedProjectRenameRows(targetStatus: kind == "archived" ? "archived" : "active")
            if kind == "empty-null" {
                let edit = try SQLiteBridge(url: database)
                _ = try edit.execute("UPDATE projects SET supportNotes = NULL WHERE id = 'focus-target'")
                edit.close()
            }
            let faults = HostIOFaults()
            let core = host(faults)
            _ = try await core.start()
            let options = try object(await core.call("projectNotesEditOptions", argumentsJSON: json([json(["projectId": "focus-target"])])))
            XCTAssertEqual(options["canEdit"] as? Bool, kind != "archived")
            let request = try await projectNotesWriteRequest(core, text: "")
            var writes = 0, journals = 0
            faults.beforeSQL = { sql in
                if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:projects|tasks|sections|areas|people|settings|saved_filters|calendar_sync)\b"#, options: .regularExpression) != nil { writes += 1 }
            }
            faults.journalWrite = { journals += 1 }
            let noPending = try await core.retryPending()
            XCTAssertNil(noPending)
            await expectFailure("STALE_REVISION") {
                _ = try await core.call("projectNotesWriteRetryOutcome", argumentsJSON: json([json(request)]))
            }
            let result = try object(await core.call("projectNotesWrite", argumentsJSON: json([json(request)])))
            if kind == "archived" { XCTAssertEqual(result["blocked"] as? String, "") }
            else {
                XCTAssertEqual(result["id"] as? String, "focus-target")
                XCTAssertTrue(result["supportNotes"] is NSNull)
            }
            var missing = request
            var expected = try XCTUnwrap(request["expected"] as? [String: Any])
            expected["title"] = "stale title"
            var stale = request
            stale["expected"] = expected
            await expectFailure("STALE_REVISION") {
                _ = try await core.call("projectNotesWrite", argumentsJSON: json([json(stale)]))
            }
            expected.removeValue(forKey: "supportNotes")
            missing["expected"] = expected
            await expectFailure("INVALID_INPUT") {
                _ = try await core.call("projectNotesWrite", argumentsJSON: json([json(missing)]))
            }
            var oversized = request
            oversized["text"] = String(repeating: "x", count: 2_000_001)
            await expectFailure("INVALID_INPUT") {
                _ = try await core.call("projectNotesWrite", argumentsJSON: json([json(oversized)]))
            }
            XCTAssertEqual(writes, 0); XCTAssertEqual(journals, 0)
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            await core.close()
            directory = parent
        }
    }

    func testProjectNotesWriteEmptyClearStoresEmptyStringThenExactNoop() async throws {
        try await seedProjectRenameRows()
        let edit = try SQLiteBridge(url: database)
        _ = try edit.execute("UPDATE projects SET supportNotes = ? WHERE id = 'focus-target'", parametersJSON: json(["  old note  "]))
        edit.close()
        let core = host()
        _ = try await core.start()
        let request = try await projectNotesWriteRequest(core, text: "")
        let result = try object(await core.call("projectNotesWrite", argumentsJSON: json([json(request)])))
        XCTAssertEqual(result["supportNotes"] as? String, "")
        XCTAssertEqual(try projectRows("focus-target").first?["supportNotes"] as? String, "")
        let noop = try await projectNotesWriteRequest(core, text: "")
        let noWrite = try object(await core.call("projectNotesWrite", argumentsJSON: json([json(noop)])))
        XCTAssertEqual(noWrite["supportNotes"] as? String, "")
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        await core.close()
    }

    func testProjectNotesWriteForgedPreparedAndTerminalRefuseBeforeSQL() async throws {
        try await seedProjectRenameRows()
        let faults = HostIOFaults()
        let writer = host(faults)
        _ = try await writer.start()
        let request = try await projectNotesWriteRequest(writer, text: "  retained raw  ")
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Project Notes") } }
        await expectFailure("SAVE_FAILED") {
            _ = try await writer.call("projectNotesWrite", argumentsJSON: json([json(request)]))
        }
        let pending = try object(String(contentsOf: journal))
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(pending["argumentsJSON"] as? String).utf8)) as? [String])
        let original = try object(XCTUnwrap(args.first))
        let prepared = try XCTUnwrap(original["prepared"] as? [String: Any])
        await writer.close()
        for corruption in ["effect", "missing-project-field", "terminal", "malformed"] {
            var envelope = original
            var argumentsJSON = try XCTUnwrap(pending["argumentsJSON"] as? String)
            var terminal: [String: Any]? = nil
            switch corruption {
            case "effect":
                var forged = prepared
                var effect = try XCTUnwrap(forged["effect"] as? [String: Any])
                var pair = try XCTUnwrap(effect["project"] as? [String: Any])
                var after = try XCTUnwrap(pair["after"] as? [String: Any])
                after["title"] = "Forged title"
                pair["after"] = after; effect["project"] = pair; forged["effect"] = effect
                envelope["prepared"] = forged
                argumentsJSON = try json([json(envelope)])
            case "missing-project-field":
                var forged = prepared
                var scope = try XCTUnwrap(forged["scope"] as? [String: Any])
                var project = try XCTUnwrap(scope["project"] as? [String: Any])
                project.removeValue(forKey: "tagIds")
                scope["project"] = project; forged["scope"] = scope
                envelope["prepared"] = forged
                argumentsJSON = try json([json(envelope)])
            case "terminal": terminal = ["success": ["_0": try json(["id": "focus-target", "supportNotes": "forged"])]]
            default: argumentsJSON = try json([["malformed": true]])
            }
            var forgedJournal: [String: Any] = ["version": 2, "method": "projectNotesWriteCommit", "argumentsJSON": argumentsJSON]
            if let terminal { forgedJournal["terminal"] = terminal }
            let bytes = Data(try json(forgedJournal).utf8)
            try bytes.write(to: journal)
            let blockedFaults = HostIOFaults()
            var sql = 0, cleanup = 0
            blockedFaults.beforeSQL = { _ in sql += 1 }
            blockedFaults.journalRemove = { cleanup += 1 }
            let blocked = host(blockedFaults)
            await expectFailure { _ = try await blocked.start() }
            XCTAssertEqual(sql, 0); XCTAssertEqual(cleanup, 0)
            XCTAssertEqual(try Data(contentsOf: journal), bytes)
            await blocked.close()
        }
    }

    func testProjectNotesWritePartialAfterRefusesWithoutOverwritingLaterEdit() async throws {
        try await seedProjectRenameRows()
        let faults = HostIOFaults()
        let writer = host(faults)
        _ = try await writer.start()
        let request = try await projectNotesWriteRequest(writer, text: "New raw notes")
        var journalWrites = 0
        faults.journalWrite = { journalWrites += 1; if journalWrites == 2 { throw HostFailure("Injected Project Notes lost reply") } }
        await expectFailure("lost reply") {
            _ = try await writer.call("projectNotesWrite", argumentsJSON: json([json(request)]))
        }
        await writer.close()
        let edit = try SQLiteBridge(url: database)
        _ = try edit.execute("UPDATE projects SET title = 'Newer title', updatedAt = ?, rev = rev + 1 WHERE id = 'focus-target'",
                             parametersJSON: json([recentAreaTestTime(daysAgo: 0)]))
        let before = try nineTableSnapshot(edit)
        edit.close()
        let replayFaults = HostIOFaults()
        var writes = 0
        replayFaults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:projects|tasks|sections|areas|people|settings|saved_filters|calendar_sync)\b"#, options: .regularExpression) != nil { writes += 1 }
        }
        let replay = host(replayFaults)
        await expectFailure("STALE_REVISION") { _ = try await replay.start() }
        XCTAssertEqual(writes, 0)
        XCTAssertTrue(FileManager.default.fileExists(atPath: journal.path))
        let check = try SQLiteBridge(url: database)
        XCTAssertEqual(try nineTableSnapshot(check), before)
        check.close()
        await replay.close()
    }

    func testProjectNotesRichPagedRTLArchivedAndEmptyReadsPreserveAllRows() async throws {
        try await seedProjectFocusRows()
        let raw = "\n# Heading\n\nIntro **bold** and [web](https://example.com)\n\n- [x] Done\n- [ ] Next\n\n```txt\ncode\n```\n"
        let sqlite = try SQLiteBridge(url: database)
        _ = try sqlite.execute("UPDATE projects SET title = ?, supportNotes = ? WHERE id = 'focus-target'",
                               parametersJSON: json(["Rich Notes", raw]))
        _ = try sqlite.execute("UPDATE projects SET title = ?, supportNotes = ? WHERE id = 'focus-other-0'",
                               parametersJSON: json(["ملاحظات", "مرحبا بالعالم\n\nفقرة ثانية"]))
        _ = try sqlite.execute("UPDATE projects SET status = 'archived', cancelledAt = ?, supportNotes = ? WHERE id = 'focus-spare-0'",
                               parametersJSON: json([recentAreaTestTime(), "Archived **note**"]))
        _ = try sqlite.execute("UPDATE projects SET supportNotes = NULL WHERE id = 'focus-spare-1'")
        _ = try sqlite.execute("UPDATE projects SET supportNotes = ? WHERE id = 'focus-spare-2'",
                               parametersJSON: json([" \n "]))
        let staged = try nineTableSnapshot(sqlite)
        sqlite.close()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let afterStart = try SQLiteBridge(url: database)
        XCTAssertEqual(try nineTableSnapshot(afterStart), staged)
        afterStart.close()
        _ = try await core.call("language", argumentsJSON: json(["en", "en-US"]))
        var statements = 0, journalWrites = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journalWrites += 1 }
        let full = try object(await core.call("projectNotes", argumentsJSON: json(["focus-target", 0, 100, ""])))
        let detail = try object(await core.call("projectDetail", argumentsJSON: json(["focus-target", 0, 1, ""])))
        XCTAssertEqual(full["projectId"] as? String, "focus-target")
        XCTAssertEqual(full["revision"] as? String, detail["mutationRevision"] as? String)
        XCTAssertEqual(full["readOnly"] as? Bool, false)
        XCTAssertEqual(full["direction"] as? String, "ltr")
        let blocks = try XCTUnwrap(full["blocks"] as? [[String: Any]])
        let total = try XCTUnwrap(full["total"] as? Int)
        XCTAssertEqual(blocks.count, total)
        XCTAssertGreaterThan(total, 5)
        XCTAssertEqual(blocks.first?["type"] as? String, "blank")
        XCTAssertTrue(blocks.contains { $0["type"] as? String == "heading" })
        XCTAssertTrue(blocks.contains { $0["type"] as? String == "code" })
        let checklist = try XCTUnwrap(blocks.first { $0["type"] as? String == "taskList" })
        XCTAssertEqual((checklist["items"] as? [[String: Any]])?.compactMap { $0["checked"] as? Bool }, [true, false])
        let labels = try XCTUnwrap(full["markdownLabels"] as? [String: Any])
        for key in ["deletedTask", "deletedProject", "copyCode"] {
            XCTAssertFalse(try XCTUnwrap(labels[key] as? String).isEmpty)
        }
        let first = try object(await core.call("projectNotes", argumentsJSON: json(["focus-target", 0, 1, ""])))
        let revision = try XCTUnwrap(first["revision"] as? String)
        XCTAssertEqual(first["total"] as? Int, total)
        var pages = try XCTUnwrap(first["blocks"] as? [[String: Any]])
        for offset in 1..<total {
            let page = try object(await core.call("projectNotes", argumentsJSON: json(["focus-target", offset, 1, revision])))
            XCTAssertEqual(page["readOnly"] as? Bool, false)
            XCTAssertEqual(page["direction"] as? String, "ltr")
            XCTAssertEqual(try json(XCTUnwrap(page["markdownLabels"])), try json(labels))
            pages += try XCTUnwrap(page["blocks"] as? [[String: Any]])
        }
        XCTAssertEqual(try json(pages), try json(blocks))
        let rtl = try object(await core.call("projectNotes", argumentsJSON: json(["focus-other-0", 0, 100, ""])))
        XCTAssertEqual(rtl["direction"] as? String, "rtl")
        XCTAssertGreaterThan(try XCTUnwrap(rtl["total"] as? Int), 0)
        let archived = try object(await core.call("projectNotes", argumentsJSON: json(["focus-spare-0", 0, 100, ""])))
        XCTAssertEqual(archived["readOnly"] as? Bool, true)
        XCTAssertGreaterThan(try XCTUnwrap(archived["total"] as? Int), 0)
        let empty = try object(await core.call("projectNotes", argumentsJSON: json(["focus-spare-1", 0, 100, ""])))
        XCTAssertEqual(empty["total"] as? Int, 0)
        XCTAssertTrue(try XCTUnwrap(empty["blocks"] as? [[String: Any]]).isEmpty)
        let spaces = try object(await core.call("projectNotes", argumentsJSON: json(["focus-spare-2", 0, 100, ""])))
        XCTAssertEqual(spaces["total"] as? Int, 0)
        XCTAssertTrue(try XCTUnwrap(spaces["blocks"] as? [[String: Any]]).isEmpty)
        await expectFailure("STALE_REVISION") {
            _ = try await core.call("projectNotes", argumentsJSON: json(["focus-target", 1, 1, revision + "-stale"]))
        }
        _ = try await core.call("language", argumentsJSON: json(["de", "de-DE"]))
        await expectFailure("STALE_REVISION") {
            _ = try await core.call("projectNotes", argumentsJSON: json(["focus-target", 1, 1, revision]))
        }
        XCTAssertEqual(statements, 0); XCTAssertEqual(journalWrites, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        XCTAssertEqual(try projectRows("focus-target").first?["supportNotes"] as? String, raw)
        XCTAssertEqual(try projectRows("focus-spare-2").first?["supportNotes"] as? String, " \n ")
        let after = try SQLiteBridge(url: database)
        XCTAssertEqual(try nineTableSnapshot(after), staged)
        after.close()
        await core.close()
    }

    func testProjectNotesDraftDirectionUsesRawDraftAndNeverWrites() async throws {
        try await seedProjectFocusRows()
        let stage = try SQLiteBridge(url: database)
        _ = try stage.execute("UPDATE projects SET title = ?, supportNotes = ? WHERE id = 'focus-target'",
                              parametersJSON: json(["English", "سلام محفوظ"]))
        _ = try stage.execute("UPDATE projects SET title = ?, supportNotes = ? WHERE id = 'focus-other-0'",
                              parametersJSON: json(["مرحبا", "Stored English"]))
        _ = try stage.execute("UPDATE projects SET purgedAt = ? WHERE id = 'focus-spare-3'",
                              parametersJSON: json([recentAreaTestTime()]))
        stage.close()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let baseline = try SQLiteBridge(url: database)
        let before = try nineTableSnapshot(baseline)
        baseline.close()
        var statements = 0, journalWrites = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journalWrites += 1 }
        func direction(_ projectID: String, _ text: String) async throws -> String? {
            let result = try object(await core.call("projectNotesDraftDirection",
                                                    argumentsJSON: json([json(["projectId": projectID, "text": text])])))
            return result["direction"] as? String
        }
        _ = try await core.call("language", argumentsJSON: json(["en", "en-US"]))
        let english = try await direction("focus-target", "English replacement")
        let arabicDraft = try await direction("focus-target", "  سلام جديد  ")
        let arabicTitle = try await direction("focus-other-0", "English replacement")
        XCTAssertEqual(english, "ltr")
        XCTAssertEqual(arabicDraft, "rtl")
        XCTAssertEqual(arabicTitle, "rtl")
        for locale in ["ar", "fa"] {
            _ = try await core.call("language", argumentsJSON: json([locale, "en-US"]))
            let localized = try await direction("focus-target", "English replacement")
            XCTAssertEqual(localized, "rtl")
        }
        for input in [["projectId": "", "text": "draft"],
                      ["projectId": String(repeating: "x", count: 501), "text": "draft"],
                      ["projectId": "focus-target", "text": "draft", "extra": "field"],
                      ["projectId": "focus-target", "text": String(repeating: "漢", count: 700_000)]] {
            await expectFailure("INVALID_INPUT") {
                _ = try await core.call("projectNotesDraftDirection", argumentsJSON: json([json(input)]))
            }
        }
        for input in [["projectId": "focus-target"], ["projectId": "focus-target", "text": NSNull()]] as [[String: Any]] {
            await expectFailure("INVALID_INPUT") {
                _ = try await core.call("projectNotesDraftDirection", argumentsJSON: json([json(input)]))
            }
        }
        for projectID in ["missing", "focus-deleted", "focus-spare-3"] {
            await expectFailure("STALE_REVISION") {
                _ = try await core.call("projectNotesDraftDirection",
                                        argumentsJSON: json([json(["projectId": projectID, "text": "draft"])]))
            }
        }
        XCTAssertEqual(statements, 0); XCTAssertEqual(journalWrites, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        XCTAssertEqual(try projectRows("focus-target").first?["supportNotes"] as? String, "سلام محفوظ")
        let check = try SQLiteBridge(url: database)
        XCTAssertEqual(try nineTableSnapshot(check), before)
        check.close()
        await core.close()
    }

    func testProjectNotesMalformedUnavailableAndOversizeReadsNeverWrite() async throws {
        try await seedProjectFocusRows()
        let stage = try SQLiteBridge(url: database)
        _ = try stage.execute("UPDATE projects SET purgedAt = ? WHERE id = 'focus-spare-3'",
                              parametersJSON: json([recentAreaTestTime()]))
        stage.close()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let baseline = try SQLiteBridge(url: database)
        let before = try nineTableSnapshot(baseline)
        baseline.close()
        var statements = 0, journalWrites = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journalWrites += 1 }
        for args in [["focus-target", -1, 1, ""] as [Any], ["focus-target", 0, 0, ""],
                     ["focus-target", 0, 101, ""], ["focus-target", 1, 1, ""],
                     [" ", 0, 1, ""], [String(repeating: "x", count: 2_000_001), 0, 1, ""]] {
            await expectFailure("INVALID_INPUT") { _ = try await core.call("projectNotes", argumentsJSON: json(args)) }
        }
        for args in [["focus-target", true, 1, ""] as [Any], ["focus-target", 0, 1.5, ""],
                     ["focus-target", 0, "1", ""]] {
            await expectFailure("integers") { _ = try await core.call("projectNotes", argumentsJSON: json(args)) }
        }
        await expectFailure("TASK_NOT_FOUND") {
            _ = try await core.call("projectNotes", argumentsJSON: json(["missing", 0, 1, ""]))
        }
        await expectFailure("TASK_NOT_FOUND") {
            _ = try await core.call("projectNotes", argumentsJSON: json(["focus-deleted", 0, 1, ""]))
        }
        await expectFailure("TASK_NOT_FOUND") {
            _ = try await core.call("projectNotes", argumentsJSON: json(["focus-spare-3", 0, 1, ""]))
        }
        XCTAssertEqual(statements, 0); XCTAssertEqual(journalWrites, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        let check = try SQLiteBridge(url: database)
        XCTAssertEqual(try nineTableSnapshot(check), before)
        check.close()
        await core.close()
    }

    func testProjectNotesOversizeStoredSourceFailsWithoutTruncationOrWrite() async throws {
        try await seedProjectFocusRows()
        let raw = String(repeating: "N", count: 2_000_001)
        let stage = try SQLiteBridge(url: database)
        _ = try stage.execute("UPDATE projects SET supportNotes = ? WHERE id = 'focus-target'", parametersJSON: json([raw]))
        let before = try nineTableSnapshot(stage)
        stage.close()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let afterStart = try SQLiteBridge(url: database)
        XCTAssertEqual(try nineTableSnapshot(afterStart), before)
        afterStart.close()
        var statements = 0, journalWrites = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journalWrites += 1 }
        await expectFailure("INVALID_INPUT") {
            _ = try await core.call("projectNotes", argumentsJSON: json(["focus-target", 0, 1, ""]))
        }
        XCTAssertEqual(statements, 0); XCTAssertEqual(journalWrites, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        XCTAssertEqual(try projectRows("focus-target").first?["supportNotes"] as? String, raw)
        let check = try SQLiteBridge(url: database)
        XCTAssertEqual(try nineTableSnapshot(check), before)
        check.close()
        await core.close()
    }

    func testProjectAreaFailedCommitExactRetryChangesOnlyTargetProject() async throws {
        try await seedProjectRenameRows()
        let rawAreaName = "\u{FEFF}Keep Area\u{FEFF}"
        let fixture = try SQLiteBridge(url: database)
        _ = try fixture.execute("UPDATE areas SET name = ? WHERE id = 'rename-area'", parametersJSON: json([rawAreaName]))
        fixture.close()
        let faults = HostIOFaults()
        var diagnostics: [String] = []
        faults.commandDiagnostic = { diagnostics.append($0) }
        let core = host(faults)
        _ = try await core.start()
        let options = try object(await core.call("projectAreaOptions",
                                                 argumentsJSON: json(["focus-target"])))
        XCTAssertEqual(Set(options.keys), Set(["revision", "project", "canEdit", "noAreaLabel", "areas"]))
        XCTAssertEqual(options["canEdit"] as? Bool, true)
        XCTAssertEqual(Set(try XCTUnwrap(options["project"] as? [String: Any]).keys),
                       Set(["id", "title", "status", "areaId", "areaTitle", "order", "rev", "revBy", "updatedAt"]))
        let areaOptions = try XCTUnwrap(options["areas"] as? [[String: Any]])
        let chosen = try XCTUnwrap(areaOptions.first { $0["id"] as? String == "rename-area" })
        XCTAssertEqual(chosen["label"] as? String, rawAreaName)
        let request = try await projectAreaRequest(core, areaID: "rename-area")
        let targetBefore = try XCTUnwrap(projectRows("focus-target").first)
        let beforeDB = try SQLiteBridge(url: database)
        let before = try nineTableSnapshot(beforeDB)
        beforeDB.close()
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected Project Area COMMIT failure") } }
        await expectFailure("SAVE_FAILED") {
            _ = try await core.call("projectAreaWrite", argumentsJSON: json([json(request)]))
        }
        XCTAssertEqual(try object(String(contentsOf: journal))["method"] as? String, "projectAreaCommit")
        let rolledBack = try SQLiteBridge(url: database)
        XCTAssertEqual(try nineTableSnapshot(rolledBack), before)
        rolledBack.close()
        XCTAssertFalse(diagnostics.contains("projectAreaApplied"))
        faults.beforeSQL = nil
        let retryValue = try await core.retryPending()
        let result = try object(XCTUnwrap(retryValue))
        XCTAssertEqual(Set(result.keys), Set(["id", "areaId", "areaTitle", "order"]))
        XCTAssertEqual(result["id"] as? String, "focus-target")
        XCTAssertEqual(result["areaId"] as? String, "rename-area")
        XCTAssertEqual(result["areaTitle"] as? String, "Keep Area")
        XCTAssertEqual(result["order"] as? Int, 0)
        let targetAfter = try XCTUnwrap(projectRows("focus-target").first)
        XCTAssertEqual(targetAfter["areaId"] as? String, "rename-area")
        XCTAssertEqual(targetAfter["areaTitle"] as? String, "Keep Area")
        XCTAssertEqual(targetAfter["rev"] as? Int, (targetBefore["rev"] as? Int ?? 0) + 1)
        XCTAssertEqual(try json(targetAfter.filter { !["areaId", "areaTitle", "orderNum", "rev", "revBy", "updatedAt"].contains($0.key) }),
                       try json(targetBefore.filter { !["areaId", "areaTitle", "orderNum", "rev", "revBy", "updatedAt"].contains($0.key) }))
        let afterDB = try SQLiteBridge(url: database)
        let after = try nineTableSnapshot(afterDB)
        afterDB.close()
        for index in before.indices where index != 1 { XCTAssertEqual(after[index], before[index]) }
        XCTAssertEqual(diagnostics.filter { $0 == "projectAreaApplied" }, ["projectAreaApplied"])
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        let same = try await projectAreaRequest(core, areaID: "rename-area")
        let noWrite = try object(await core.call("projectAreaWrite", argumentsJSON: json([json(same)])))
        XCTAssertEqual(noWrite["areaId"] as? String, "rename-area")
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        XCTAssertEqual(try projectRows("focus-target").first?["rev"] as? Int, targetAfter["rev"] as? Int)
        let clear = try await projectAreaRequest(core, areaID: nil)
        let cleared = try object(await core.call("projectAreaWrite", argumentsJSON: json([json(clear)])))
        XCTAssertTrue(cleared["areaId"] is NSNull)
        XCTAssertTrue(cleared["areaTitle"] is NSNull)
        XCTAssertTrue(try XCTUnwrap(projectRows("focus-target").first)["areaTitle"] is NSNull)
        await core.close()
    }

    func testProjectAreaColdReceiptSurvivesAreaRenameAndNoJournalProbeIsReadOnly() async throws {
        try await seedProjectRenameRows()
        let faults = HostIOFaults()
        let writer = host(faults)
        _ = try await writer.start()
        let request = try await projectAreaRequest(writer, areaID: "rename-area")
        var writes = 0
        faults.journalWrite = { writes += 1; if writes == 2 { throw HostFailure("Injected Project Area lost reply") } }
        await expectFailure("lost reply") {
            _ = try await writer.call("projectAreaWrite", argumentsJSON: json([json(request)]))
        }
        XCTAssertEqual(try object(String(contentsOf: journal))["method"] as? String, "projectAreaCommit")
        let committed = try XCTUnwrap(projectRows("focus-target").first)
        await writer.close()
        let edit = try SQLiteBridge(url: database)
        _ = try edit.execute("UPDATE areas SET name = 'Later Area', orderNum = 42, rev = rev + 1 WHERE id = 'rename-area'")
        let before = try nineTableSnapshot(edit)
        edit.close()
        let replayFaults = HostIOFaults()
        var mutations = 0
        replayFaults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:projects|tasks|sections|areas|people|settings|saved_filters|calendar_sync)\b"#, options: .regularExpression) != nil { mutations += 1 }
        }
        let reopened = host(replayFaults)
        let window = try object(await reopened.start())
        let recovery = try XCTUnwrap(window["recovery"] as? [String: Any])
        XCTAssertEqual(recovery["method"] as? String, "projectAreaCommit")
        XCTAssertEqual((recovery["result"] as? [String: Any])?["areaTitle"] as? String, "Keep Area")
        XCTAssertEqual(mutations, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        let now = try XCTUnwrap(projectRows("focus-target").first)
        XCTAssertEqual(now["rev"] as? Int, committed["rev"] as? Int)
        XCTAssertEqual(now["areaTitle"] as? String, "Keep Area")
        let check = try SQLiteBridge(url: database)
        XCTAssertEqual(try nineTableSnapshot(check), before)
        check.close()
        await expectFailure("STALE_REVISION") {
            _ = try await reopened.call("projectAreaRetryOutcome", argumentsJSON: json([json(request)]))
        }
        XCTAssertEqual(mutations, 0)
        await reopened.close()
    }

    func testProjectAreaForgedPendingJournalRefusesBeforeSQL() async throws {
        try await seedProjectRenameRows()
        let faults = HostIOFaults()
        let writer = host(faults)
        _ = try await writer.start()
        let request = try await projectAreaRequest(writer, areaID: "rename-area")
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Project Area") } }
        await expectFailure("SAVE_FAILED") {
            _ = try await writer.call("projectAreaWrite", argumentsJSON: json([json(request)]))
        }
        let pending = try object(String(contentsOf: journal))
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(pending["argumentsJSON"] as? String).utf8)) as? [String])
        let original = try object(XCTUnwrap(args.first))
        await writer.close()
        for corruption in ["effect", "scope", "terminal", "malformed"] {
            var envelope = original
            var argumentsJSON = try XCTUnwrap(pending["argumentsJSON"] as? String)
            var terminal: [String: Any]? = nil
            switch corruption {
            case "effect":
                var prepared = try XCTUnwrap(envelope["prepared"] as? [String: Any])
                var effect = try XCTUnwrap(prepared["effect"] as? [String: Any])
                var pair = try XCTUnwrap(effect["project"] as? [String: Any])
                var after = try XCTUnwrap(pair["after"] as? [String: Any])
                after["areaTitle"] = "Forged Area"
                pair["after"] = after; effect["project"] = pair; prepared["effect"] = effect
                envelope["prepared"] = prepared; argumentsJSON = try json([json(envelope)])
            case "scope":
                var prepared = try XCTUnwrap(envelope["prepared"] as? [String: Any])
                var scope = try XCTUnwrap(prepared["scope"] as? [String: Any])
                scope["orderMax"] = 900
                prepared["scope"] = scope; envelope["prepared"] = prepared
                argumentsJSON = try json([json(envelope)])
            case "terminal":
                terminal = ["success": ["_0": try json(["id": "focus-target", "areaId": "rename-area", "areaTitle": "Forged Area", "order": 0])]]
            default: argumentsJSON = try json([["malformed": true]])
            }
            var forged: [String: Any] = ["version": 2, "method": "projectAreaCommit", "argumentsJSON": argumentsJSON]
            if let terminal { forged["terminal"] = terminal }
            let bytes = Data(try json(forged).utf8)
            try bytes.write(to: journal)
            let baseline = try SQLiteBridge(url: database)
            let before = try nineTableSnapshot(baseline)
            baseline.close()
            let blockedFaults = HostIOFaults()
            var statements = 0, cleanup = 0
            blockedFaults.beforeSQL = { _ in statements += 1 }
            blockedFaults.journalRemove = { cleanup += 1 }
            let blocked = host(blockedFaults)
            await expectFailure { _ = try await blocked.start() }
            XCTAssertEqual(statements, 0); XCTAssertEqual(cleanup, 0)
            XCTAssertEqual(try Data(contentsOf: journal), bytes)
            let check = try SQLiteBridge(url: database)
            XCTAssertEqual(try nineTableSnapshot(check), before)
            check.close()
            await blocked.close()
        }
    }

    func testProjectAreaChangedDestinationOrderRefusesColdReplayWithoutWrite() async throws {
        try await seedProjectRenameRows()
        let faults = HostIOFaults()
        let writer = host(faults)
        _ = try await writer.start()
        let request = try await projectAreaRequest(writer, areaID: "rename-area")
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Project Area") } }
        await expectFailure("SAVE_FAILED") {
            _ = try await writer.call("projectAreaWrite", argumentsJSON: json([json(request)]))
        }
        await writer.close()
        let edit = try SQLiteBridge(url: database)
        _ = try edit.execute("UPDATE projects SET areaId = 'rename-area', areaTitle = 'Keep Area', orderNum = 17, rev = rev + 1 WHERE id = 'focus-spare-0'")
        let before = try nineTableSnapshot(edit)
        edit.close()
        let replayFaults = HostIOFaults()
        var writes = 0
        replayFaults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:projects|tasks|sections|areas|people|settings|saved_filters|calendar_sync)\b"#, options: .regularExpression) != nil { writes += 1 }
        }
        let replay = host(replayFaults)
        await expectFailure("STALE_REVISION") { _ = try await replay.start() }
        XCTAssertEqual(writes, 0)
        XCTAssertTrue(FileManager.default.fileExists(atPath: journal.path))
        let check = try SQLiteBridge(url: database)
        XCTAssertEqual(try nineTableSnapshot(check), before)
        check.close()
        await replay.close()
    }

    func testProjectAreaArchivedAndMalformedRequestsNeverJournal() async throws {
        try await seedProjectRenameRows(targetStatus: "archived")
        let faults = HostIOFaults()
        var journalWrites = 0
        faults.journalWrite = { journalWrites += 1 }
        let core = host(faults)
        _ = try await core.start()
        let options = try object(await core.call("projectAreaOptions", argumentsJSON: json(["focus-target"])))
        XCTAssertEqual(options["canEdit"] as? Bool, false)
        let request = try await projectAreaRequest(core, areaID: "rename-area")
        let blocked = try object(await core.call("projectAreaWrite", argumentsJSON: json([json(request)])))
        XCTAssertEqual(blocked["blocked"] as? String, "")
        var forged = request
        var expected = try XCTUnwrap(forged["expected"] as? [String: Any])
        expected.removeValue(forKey: "order")
        forged["expected"] = expected
        await expectFailure("INVALID_INPUT") {
            _ = try await core.call("projectAreaWrite", argumentsJSON: json([json(forged)]))
        }
        XCTAssertEqual(journalWrites, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        await core.close()
    }

    func testProjectAreaStaleSelectedNameRefusesWithoutJournal() async throws {
        try await seedProjectRenameRows()
        let faults = HostIOFaults()
        var journalWrites = 0
        faults.journalWrite = { journalWrites += 1 }
        let core = host(faults)
        _ = try await core.start()
        var request = try await projectAreaRequest(core, areaID: "rename-area")
        request["selectedArea"] = ["id": "rename-area", "name": "Stale Area"]
        await expectFailure("STALE_REVISION") {
            _ = try await core.call("projectAreaWrite", argumentsJSON: json([json(request)]))
        }
        XCTAssertEqual(journalWrites, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        await core.close()
    }

    func testSQLiteTextCodecPreservesBOMAndNULButRejectsInvalidUTF8() throws {
        let sqlite = try SQLiteBridge(url: database)
        defer { sqlite.close() }
        struct TextRow: Decodable { let raw: String }
        let raw = "\u{FEFF}A\u{0000}B\u{FEFF}"
        let rawHex = "EFBBBF410042EFBBBF"
        let selected = try sqlite.execute("SELECT CAST(X'\(rawHex)' AS TEXT) AS raw")
        let selectedRows = try JSONDecoder().decode([TextRow].self, from: Data(selected.utf8))
        let selectedText = try XCTUnwrap(selectedRows.first).raw
        XCTAssertEqual(selectedText, raw)
        XCTAssertEqual(Array(selectedText.utf8), Array(raw.utf8))

        let rebound = try sqlite.execute("SELECT hex(?) AS rawHex", parametersJSON: json([selectedText]))
        let reboundRows = try XCTUnwrap(NativeJSON.jsonObject(with: Data(rebound.utf8)) as? [[String: Any]])
        XCTAssertEqual(reboundRows.first?["rawHex"] as? String, rawHex)

        XCTAssertThrowsError(try sqlite.execute("SELECT CAST(X'80' AS TEXT) AS raw")) { error in
            XCTAssertEqual((error as? HostFailure)?.message, "Invalid SQLite text")
        }
    }

    func testProjectAddAreaFreshCreateThenAssignPreservesRichRows() async throws {
        try await seedProjectRenameRows()
        let core = host()
        _ = try await core.start()
        let targetBefore = try XCTUnwrap(projectRows("focus-target").first)
        let peersBefore = try json(projectRows().filter { $0["id"] as? String != "focus-target" })
        let baseline = try SQLiteBridge(url: database)
        let before = try nineTableSnapshot(baseline)
        baseline.close()

        let create = try await projectAddAreaCreateRequest(core, name: "  Details Area  ", color: "#ef4444")
        let areaID = try XCTUnwrap(create["requestId"] as? String)
        let created = try object(await core.call("areaCreate", argumentsJSON: json([json(create)])))
        XCTAssertEqual(created["id"] as? String, areaID)
        XCTAssertEqual(created["created"] as? Bool, true)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        XCTAssertEqual(try json(XCTUnwrap(projectRows("focus-target").first)), try json(targetBefore))
        let area = try XCTUnwrap(areaRows(areaID).first)
        XCTAssertEqual(area["name"] as? String, "Details Area")
        XCTAssertEqual(area["color"] as? String, "#ef4444")

        let assign = try await projectAreaRequest(core, areaID: areaID)
        let witness = try XCTUnwrap(assign["selectedArea"] as? [String: Any])
        XCTAssertEqual(witness["id"] as? String, areaID)
        XCTAssertEqual(witness["name"] as? String, "Details Area")
        let assigned = try object(await core.call("projectAreaWrite", argumentsJSON: json([json(assign)])))
        XCTAssertEqual(assigned["areaId"] as? String, areaID)
        XCTAssertEqual(assigned["areaTitle"] as? String, "Details Area")
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        let targetAfter = try XCTUnwrap(projectRows("focus-target").first)
        XCTAssertEqual(targetAfter["areaId"] as? String, areaID)
        XCTAssertEqual(targetAfter["areaTitle"] as? String, "Details Area")
        XCTAssertEqual(targetAfter["rev"] as? Int, (targetBefore["rev"] as? Int ?? 0) + 1)
        for (field, value) in targetBefore where !["areaId", "areaTitle", "orderNum", "rev", "revBy", "updatedAt"].contains(field) {
            XCTAssertEqual(try json([targetAfter[field] ?? NSNull()]), try json([value]), field)
        }
        XCTAssertEqual(try json(projectRows().filter { $0["id"] as? String != "focus-target" }), peersBefore)
        let saved = try SQLiteBridge(url: database)
        let after = try nineTableSnapshot(saved)
        saved.close()
        for index in before.indices where index != 1 && index != 2 { XCTAssertEqual(after[index], before[index]) }
        await core.close()

        let reopened = host()
        _ = try await reopened.start()
        XCTAssertEqual(try projectRows("focus-target").first?["areaId"] as? String, areaID)
        XCTAssertEqual(try areaRows(areaID).count, 1)
        await reopened.close()
    }

    func testProjectAddAreaFailedCreateColdRecoveryLeavesOneUnassignedArea() async throws {
        try await seedProjectRenameRows()
        let faults = HostIOFaults()
        let writer = host(faults)
        _ = try await writer.start()
        let targetBefore = try json(XCTUnwrap(projectRows("focus-target").first))
        let create = try await projectAddAreaCreateRequest(writer, name: "Cold Details Area")
        let areaID = try XCTUnwrap(create["requestId"] as? String)
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected composed Area create failure") } }
        await expectFailure("SAVE_FAILED") {
            _ = try await writer.call("areaCreate", argumentsJSON: json([json(create)]))
        }
        XCTAssertEqual(try object(String(contentsOf: journal))["method"] as? String, "areaCreateCommit")
        XCTAssertTrue(try areaRows(areaID).isEmpty)
        XCTAssertEqual(try json(XCTUnwrap(projectRows("focus-target").first)), targetBefore)
        await writer.close()

        let reopened = host()
        let startup = try object(await reopened.start())
        let recovery = try XCTUnwrap(startup["recovery"] as? [String: Any])
        XCTAssertEqual(recovery["method"] as? String, "areaCreateCommit")
        XCTAssertEqual((recovery["result"] as? [String: Any])?["id"] as? String, areaID)
        XCTAssertEqual(try areaRows(areaID).count, 1)
        XCTAssertEqual(try json(XCTUnwrap(projectRows("focus-target").first)), targetBefore)
        XCTAssertTrue(try XCTUnwrap(projectRows("focus-target").first)["areaId"] is NSNull)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        let options = try object(await reopened.call("projectAreaOptions", argumentsJSON: json(["focus-target"])))
        XCTAssertTrue(try XCTUnwrap(options["areas"] as? [[String: Any]]).contains { $0["id"] as? String == areaID })
        await reopened.close()
    }

    func testProjectAddAreaFailedAssignmentColdRecoveryAppliesOnce() async throws {
        try await seedProjectRenameRows()
        let faults = HostIOFaults()
        let writer = host(faults)
        _ = try await writer.start()
        let create = try await projectAddAreaCreateRequest(writer, name: "Retry Details Area")
        let areaID = try XCTUnwrap(create["requestId"] as? String)
        let created = try object(await writer.call("areaCreate", argumentsJSON: json([json(create)])))
        XCTAssertEqual(created["created"] as? Bool, true)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        let assign = try await projectAreaRequest(writer, areaID: areaID)
        let targetBefore = try XCTUnwrap(projectRows("focus-target").first)
        let baseline = try SQLiteBridge(url: database)
        let afterCreate = try nineTableSnapshot(baseline)
        baseline.close()
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected composed Project Area failure") } }
        await expectFailure("SAVE_FAILED") {
            _ = try await writer.call("projectAreaWrite", argumentsJSON: json([json(assign)]))
        }
        XCTAssertEqual(try object(String(contentsOf: journal))["method"] as? String, "projectAreaCommit")
        let rolledBack = try SQLiteBridge(url: database)
        XCTAssertEqual(try nineTableSnapshot(rolledBack), afterCreate)
        rolledBack.close()
        await writer.close()

        let reopened = host()
        let startup = try object(await reopened.start())
        let recovery = try XCTUnwrap(startup["recovery"] as? [String: Any])
        XCTAssertEqual(recovery["method"] as? String, "projectAreaCommit")
        XCTAssertEqual((recovery["result"] as? [String: Any])?["areaId"] as? String, areaID)
        XCTAssertEqual(try areaRows(areaID).count, 1)
        let targetAfter = try XCTUnwrap(projectRows("focus-target").first)
        XCTAssertEqual(targetAfter["areaId"] as? String, areaID)
        XCTAssertEqual(targetAfter["rev"] as? Int, (targetBefore["rev"] as? Int ?? 0) + 1)
        let saved = try SQLiteBridge(url: database)
        let after = try nineTableSnapshot(saved)
        saved.close()
        for index in afterCreate.indices where index != 1 { XCTAssertEqual(after[index], afterCreate[index]) }
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        await reopened.close()
    }

    func testProjectAddAreaProjectAssociationChangeKeepsCreatedAreaWithoutOverwrite() async throws {
        try await seedProjectRenameRows()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let opening = try object(await core.call("projectAreaOptions", argumentsJSON: json(["focus-target"])))
        let openingProject = try XCTUnwrap(opening["project"] as? [String: Any])
        let create = try await projectAddAreaCreateRequest(core, name: "Retained Details Area")
        let areaID = try XCTUnwrap(create["requestId"] as? String)
        let created = try object(await core.call("areaCreate", argumentsJSON: json([json(create)])))
        XCTAssertEqual(created["created"] as? Bool, true)
        let competing = try await projectAreaRequest(core, areaID: "rename-area")
        let competingResult = try object(await core.call("projectAreaWrite", argumentsJSON: json([json(competing)])))
        XCTAssertEqual(competingResult["areaId"] as? String, "rename-area")
        var stale = try await projectAreaRequest(core, areaID: areaID)
        stale["expected"] = openingProject.filter { $0.key != "id" }
        let baseline = try SQLiteBridge(url: database)
        let before = try nineTableSnapshot(baseline)
        baseline.close()
        var journalWrites = 0
        faults.journalWrite = { journalWrites += 1 }
        await expectFailure("STALE_REVISION") {
            _ = try await core.call("projectAreaWrite", argumentsJSON: json([json(stale)]))
        }
        XCTAssertEqual(journalWrites, 0)
        let check = try SQLiteBridge(url: database)
        XCTAssertEqual(try nineTableSnapshot(check), before)
        check.close()
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        XCTAssertEqual(try areaRows(areaID).count, 1)
        XCTAssertEqual(try projectRows("focus-target").first?["areaId"] as? String, "rename-area")
        await core.close()
    }

    func testProjectTagsAddToggleClearAndWhitespaceNoopKeepRawLegacySpelling() async throws {
        try await seedProjectRenameRows()
        let raw = ["raw", "#keep", "#keep", "é", "e\u{301}", "\u{FEFF}odd", "nul\u{0000}"]
        let seed = try SQLiteBridge(url: database)
        _ = try seed.execute("UPDATE projects SET tagIds = ? WHERE id = 'focus-target'", parametersJSON: json([json(raw)]))
        seed.close()
        let faults = HostIOFaults()
        var writes = 0, journals = 0
        let core = host(faults)
        _ = try await core.start()
        let options = try object(await core.call("projectTagsEditOptions", argumentsJSON: json(["focus-target"])))
        XCTAssertEqual(Set(options.keys), Set(["revision", "project", "canEdit", "suggestions"]))
        XCTAssertEqual(options["canEdit"] as? Bool, true)
        let openedTags = try XCTUnwrap((options["project"] as? [String: Any])?["tagIds"] as? [String])
        XCTAssertEqual(openedTags.map { Array($0.utf8) }, raw.map { Array($0.utf8) })
        let suggestions = try XCTUnwrap(options["suggestions"] as? [String])
        XCTAssertTrue(suggestions.contains { Array($0.utf8) == Array("#keep".utf8) })

        faults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:projects|tasks|sections|areas|people|settings|saved_filters|calendar_sync)\b"#, options: .regularExpression) != nil { writes += 1 }
        }
        faults.journalWrite = { journals += 1 }

        let blank = try await projectTagsRequest(core, intent: ["kind": "add", "input": " \u{FEFF}\t "])
        let blankResult = try object(await core.call("projectTagsWrite", argumentsJSON: json([json(blank)])))
        XCTAssertEqual((blankResult["tagIds"] as? [String])?.map { Array($0.utf8) }, raw.map { Array($0.utf8) })
        XCTAssertEqual(writes, 0); XCTAssertEqual(journals, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))

        let add = try await projectTagsRequest(core, intent: ["kind": "add", "input": " new "])
        let added = try object(await core.call("projectTagsWrite", argumentsJSON: json([json(add)])))
        let afterAdd = ["raw", "#keep", "é", "e\u{301}", "\u{FEFF}odd", "nul\u{0000}", "#new"]
        XCTAssertEqual((added["tagIds"] as? [String])?.map { Array($0.utf8) }, afterAdd.map { Array($0.utf8) })
        let storedAdd = try XCTUnwrap(projectRows("focus-target").first?["tagIds"] as? String)
        let storedAddTags = try XCTUnwrap(NativeJSON.jsonObject(with: Data(storedAdd.utf8)) as? [String])
        XCTAssertEqual(storedAddTags.map { Array($0.utf8) }, afterAdd.map { Array($0.utf8) })

        let toggleRaw = try await projectTagsRequest(core, intent: ["kind": "toggle", "input": "raw"])
        let toggledRaw = try object(await core.call("projectTagsWrite", argumentsJSON: json([json(toggleRaw)])))
        XCTAssertEqual((toggledRaw["tagIds"] as? [String])?.map { Array($0.utf8) },
                       (afterAdd + ["#raw"]).map { Array($0.utf8) })
        let toggleKeep = try await projectTagsRequest(core, intent: ["kind": "toggle", "input": "#keep"])
        let toggledKeep = try object(await core.call("projectTagsWrite", argumentsJSON: json([json(toggleKeep)])))
        XCTAssertFalse((toggledKeep["tagIds"] as? [String] ?? []).contains { Array($0.utf8) == Array("#keep".utf8) })
        let clear = try await projectTagsRequest(core, intent: ["kind": "clear"])
        let cleared = try object(await core.call("projectTagsWrite", argumentsJSON: json([json(clear)])))
        XCTAssertEqual(cleared["tagIds"] as? [String], [])
        XCTAssertGreaterThanOrEqual(writes, 4)
        XCTAssertGreaterThan(journals, 0)
        await core.close()
    }

    func testProjectTagsFailedCommitExactRetryAndStaleRequestPreserveRichRows() async throws {
        try await seedProjectRenameRows()
        let faults = HostIOFaults()
        var diagnostics: [String] = []
        faults.commandDiagnostic = { diagnostics.append($0) }
        let core = host(faults)
        _ = try await core.start()
        let request = try await projectTagsRequest(core, intent: ["kind": "add", "input": "#new"])
        let targetBefore = try XCTUnwrap(projectRows("focus-target").first)
        let baseline = try SQLiteBridge(url: database)
        let before = try nineTableSnapshot(baseline)
        baseline.close()
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected Project Tags COMMIT failure") } }
        await expectFailure("SAVE_FAILED") {
            _ = try await core.call("projectTagsWrite", argumentsJSON: json([json(request)]))
        }
        XCTAssertEqual(try object(String(contentsOf: journal))["method"] as? String, "projectTagsWriteCommit")
        let rolledBack = try SQLiteBridge(url: database)
        XCTAssertEqual(try nineTableSnapshot(rolledBack), before)
        rolledBack.close()
        XCTAssertTrue(diagnostics.isEmpty)
        faults.beforeSQL = nil
        let retry = try await core.retryPending()
        let result = try object(XCTUnwrap(retry))
        XCTAssertEqual((result["tagIds"] as? [String])?.map { Array($0.utf8) }, ["#keep", "#new"].map { Array($0.utf8) })
        let targetAfter = try XCTUnwrap(projectRows("focus-target").first)
        XCTAssertEqual(targetAfter["rev"] as? Int, (targetBefore["rev"] as? Int ?? 0) + 1)
        for (field, value) in targetBefore where !["tagIds", "rev", "revBy", "updatedAt"].contains(field) {
            XCTAssertEqual(Data(try json([targetAfter[field] ?? NSNull()]).utf8), Data(try json([value]).utf8), field)
        }
        let saved = try SQLiteBridge(url: database)
        let after = try nineTableSnapshot(saved)
        saved.close()
        for index in before.indices where index != 1 { XCTAssertEqual(after[index], before[index]) }
        XCTAssertEqual(diagnostics, ["projectTagsWriteApplied"])
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        var writes = 0, journals = 0
        faults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:projects|tasks|sections|areas|people|settings|saved_filters|calendar_sync)\b"#, options: .regularExpression) != nil { writes += 1 }
        }
        faults.journalWrite = { journals += 1 }
        await expectFailure("STALE_REVISION") {
            _ = try await core.call("projectTagsWrite", argumentsJSON: json([json(request)]))
        }
        XCTAssertEqual(writes, 0); XCTAssertEqual(journals, 0)
        await core.close()
    }

    func testProjectTagsLostReplyColdReceiptDoesNotToggleTwiceAndNilProbeIsReadOnly() async throws {
        try await seedProjectRenameRows()
        let faults = HostIOFaults()
        let writer = host(faults)
        _ = try await writer.start()
        let request = try await projectTagsRequest(writer, intent: ["kind": "toggle", "input": "#keep"])
        let before = try XCTUnwrap(projectRows("focus-target").first)
        var journalWrites = 0
        faults.journalWrite = { journalWrites += 1; if journalWrites == 2 { throw HostFailure("Injected Project Tags lost reply") } }
        await expectFailure("lost reply") {
            _ = try await writer.call("projectTagsWrite", argumentsJSON: json([json(request)]))
        }
        let committed = try XCTUnwrap(projectRows("focus-target").first)
        XCTAssertEqual(committed["tagIds"] as? String, "[]")
        await writer.close()
        let baseline = try SQLiteBridge(url: database)
        let persisted = try nineTableSnapshot(baseline)
        baseline.close()
        let replayFaults = HostIOFaults()
        var writes = 0
        replayFaults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(?:projects|tasks|sections|areas|people|settings|saved_filters|calendar_sync)\b"#, options: .regularExpression) != nil { writes += 1 }
        }
        let reopened = host(replayFaults)
        let startup = try object(await reopened.start())
        let recovery = try XCTUnwrap(startup["recovery"] as? [String: Any])
        XCTAssertEqual(recovery["method"] as? String, "projectTagsWriteCommit")
        XCTAssertEqual((recovery["result"] as? [String: Any])?["tagIds"] as? [String], [])
        XCTAssertEqual(writes, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        XCTAssertEqual(try projectRows("focus-target").first?["rev"] as? Int, (before["rev"] as? Int ?? 0) + 1)
        let check = try SQLiteBridge(url: database)
        XCTAssertEqual(try nineTableSnapshot(check), persisted)
        check.close()
        let noPending = try await reopened.retryPending()
        XCTAssertNil(noPending)
        await expectFailure("STALE_REVISION") {
            _ = try await reopened.call("projectTagsWriteRetryOutcome", argumentsJSON: json([json(request)]))
        }
        XCTAssertEqual(writes, 0)
        await reopened.close()
    }

    func testProjectTagsForgedJournalAndRawTagConflictRefuseWithoutWrite() async throws {
        try await seedProjectRenameRows()
        let faults = HostIOFaults()
        let writer = host(faults)
        _ = try await writer.start()
        let request = try await projectTagsRequest(writer, intent: ["kind": "toggle", "input": "#keep"])
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Project Tags") } }
        await expectFailure("SAVE_FAILED") {
            _ = try await writer.call("projectTagsWrite", argumentsJSON: json([json(request)]))
        }
        let pending = try object(String(contentsOf: journal))
        let args = try XCTUnwrap(NativeJSON.jsonObject(with: Data(XCTUnwrap(pending["argumentsJSON"] as? String).utf8)) as? [String])
        let original = try object(XCTUnwrap(args.first))
        await writer.close()
        for corruption in ["effect", "scope", "result", "terminal", "malformed"] {
            var envelope = original
            var argumentsJSON = try XCTUnwrap(pending["argumentsJSON"] as? String)
            var terminal: [String: Any]? = nil
            switch corruption {
            case "effect":
                var prepared = try XCTUnwrap(envelope["prepared"] as? [String: Any])
                var effect = try XCTUnwrap(prepared["effect"] as? [String: Any])
                var pair = try XCTUnwrap(effect["project"] as? [String: Any])
                var after = try XCTUnwrap(pair["after"] as? [String: Any])
                after["tagIds"] = ["#forged"]
                pair["after"] = after; effect["project"] = pair; prepared["effect"] = effect
                envelope["prepared"] = prepared; argumentsJSON = try json([json(envelope)])
            case "scope":
                var prepared = try XCTUnwrap(envelope["prepared"] as? [String: Any])
                var scope = try XCTUnwrap(prepared["scope"] as? [String: Any])
                var project = try XCTUnwrap(scope["project"] as? [String: Any])
                project.removeValue(forKey: "tagIds")
                scope["project"] = project; prepared["scope"] = scope
                envelope["prepared"] = prepared; argumentsJSON = try json([json(envelope)])
            case "result":
                var prepared = try XCTUnwrap(envelope["prepared"] as? [String: Any])
                prepared["result"] = ["id": "focus-target", "tagIds": ["#forged"]]
                envelope["prepared"] = prepared; argumentsJSON = try json([json(envelope)])
            case "terminal": terminal = ["success": ["_0": try json(["id": "focus-target", "tagIds": ["#forged"]])]]
            default: argumentsJSON = try json([["malformed": true]])
            }
            var forged: [String: Any] = ["version": 2, "method": "projectTagsWriteCommit", "argumentsJSON": argumentsJSON]
            if let terminal { forged["terminal"] = terminal }
            let bytes = Data(try json(forged).utf8)
            try bytes.write(to: journal)
            let baseline = try SQLiteBridge(url: database)
            let before = try nineTableSnapshot(baseline)
            baseline.close()
            let blockedFaults = HostIOFaults()
            var statements = 0, cleanup = 0
            blockedFaults.beforeSQL = { _ in statements += 1 }
            blockedFaults.journalRemove = { cleanup += 1 }
            let blocked = host(blockedFaults)
            await expectFailure { _ = try await blocked.start() }
            XCTAssertEqual(statements, 0); XCTAssertEqual(cleanup, 0)
            XCTAssertEqual(try Data(contentsOf: journal), bytes)
            let check = try SQLiteBridge(url: database)
            XCTAssertEqual(try nineTableSnapshot(check), before)
            check.close()
            await blocked.close()
        }
        try FileManager.default.removeItem(at: journal)
        let edit = try SQLiteBridge(url: database)
        _ = try edit.execute("UPDATE projects SET tagIds = ? WHERE id = 'focus-target'", parametersJSON: json([json(["#changed"])]))
        edit.close()
        let reopened = host()
        _ = try await reopened.start()
        await expectFailure("STALE_REVISION") {
            _ = try await reopened.call("projectTagsWrite", argumentsJSON: json([json(request)]))
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        XCTAssertEqual(try projectRows("focus-target").first?["tagIds"] as? String, "[\"#changed\"]")
        await reopened.close()
    }

    func testProjectCompletedViewGroupsPagesAndRetainsLegacyShapeWithoutWrites() async throws {
        let bootstrap = host()
        _ = try await bootstrap.start()
        await bootstrap.close()
        let db = try SQLiteBridge(url: database)
        let at = "2026-09-28T12:00:00.000Z"
        for (id, status, sequential) in [("parallel", "active", 0), ("sequential", "active", 1), ("archived", "archived", 0)] {
            _ = try db.execute("INSERT INTO projects (id, title, status, color, isSequential, orderNum, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                parametersJSON: json([id, id, status, "#94a3b8", sequential, 0, at, at, 1]))
            for (order, state) in ["next", "done", "archived", "reference"].enumerated() {
                _ = try db.execute("INSERT INTO tasks (id, title, status, projectId, orderNum, tags, contexts, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    parametersJSON: json([id + "-" + state, state, state, id, order, "[]", "[]", at, at, 1]))
            }
        }
        db.close()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let check = try SQLiteBridge(url: database)
        defer { check.close() }
        let before = try nineTableSnapshot(check)
        var statements = 0
        var journals = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journals += 1 }
        func read(_ id: String, show: Bool, collapsed: Bool, offset: Int = 0, limit: Int = 100,
                  revision: String? = nil) async throws -> [String: Any] {
            var input: [String: Any] = ["projectId": id, "showCompleted": show, "completedCollapsed": collapsed,
                                       "offset": offset, "limit": limit]
            if let revision { input["revision"] = revision }
            return try object(await core.call("menuRead", argumentsJSON: json(["projectDetailView", json(input)])))
        }
        func items(_ page: [String: Any]) throws -> [[String: Any]] { try XCTUnwrap(page["items"] as? [[String: Any]]) }
        func ids(_ page: [String: Any]) throws -> Set<String> {
            Set(try items(page).compactMap { ($0["row"] as? [String: Any])?["id"] as? String })
        }
        let hidden = try await read("parallel", show: false, collapsed: true)
        XCTAssertEqual(try ids(hidden), ["parallel-next", "parallel-reference"])
        let collapsed = try await read("parallel", show: true, collapsed: true)
        XCTAssertEqual(try ids(collapsed), try ids(hidden))
        let completed = try XCTUnwrap(try items(collapsed).first { $0["collapsible"] as? Bool == true })
        XCTAssertEqual(completed["count"] as? Int, 2)
        XCTAssertEqual(completed["collapsed"] as? Bool, true)
        let expanded = try await read("parallel", show: true, collapsed: false)
        XCTAssertEqual(try ids(expanded), ["parallel-next", "parallel-reference", "parallel-done", "parallel-archived"])
        let controls = try XCTUnwrap(expanded["controls"] as? [String: Any])
        XCTAssertEqual(controls["groupCompletedTasksLast"] as? Bool, true)
        XCTAssertEqual(controls["canToggleCompleted"] as? Bool, true)
        XCTAssertFalse(try XCTUnwrap(controls["label"] as? String).isEmpty)
        let first = try await read("parallel", show: true, collapsed: false, limit: 1)
        let revision = try XCTUnwrap(first["revision"] as? String)
        var paged = try items(first)
        for offset in 1..<(try XCTUnwrap(first["total"] as? Int)) {
            paged += try items(await read("parallel", show: true, collapsed: false, offset: offset, limit: 1, revision: revision))
        }
        XCTAssertEqual(try json(paged), try json(items(expanded)))
        for (id, show, collapse) in [("parallel", false, false), ("parallel", true, true), ("sequential", true, false)] {
            await expectFailure("STALE_REVISION") { _ = try await read(id, show: show, collapsed: collapse, offset: 1, limit: 1, revision: revision) }
        }
        let sequential = try await read("sequential", show: true, collapsed: true)
        XCTAssertEqual(try ids(sequential), ["sequential-next", "sequential-reference", "sequential-done", "sequential-archived"])
        XCTAssertFalse(try items(sequential).contains { $0["collapsible"] as? Bool == true })
        let archived = try await read("archived", show: false, collapsed: true)
        XCTAssertEqual(archived["readOnly"] as? Bool, true)
        XCTAssertEqual((archived["controls"] as? [String: Any])?["canToggleCompleted"] as? Bool, false)
        XCTAssertEqual(try ids(archived), ["archived-next", "archived-reference", "archived-done", "archived-archived"])
        let legacy = try object(await core.call("projectDetail", argumentsJSON: json(["parallel", 0, 100, ""])))
        XCTAssertNil(legacy["controls"])
        XCTAssertEqual(try ids(legacy), try ids(hidden))
        for item in try items(legacy) where item["type"] as? String == "section" {
            XCTAssertEqual(Set(item.keys), Set(["type", "id", "title", "count", "muted"]))
        }
        XCTAssertEqual(statements, 0)
        XCTAssertEqual(journals, 0)
        XCTAssertEqual(try nineTableSnapshot(check), before)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        await core.close()
    }

    func testProjectTaskFiltersReadOnlyTokensPagingAndClear() async throws {
        try await seedProjectRenameRows()
        let seed = try SQLiteBridge(url: database)
        let tokens = (0..<150).map { String(format: "@token-%03d", $0) }
        _ = try seed.execute("UPDATE tasks SET contexts = ?, tags = ? WHERE id = 'rename-task'",
                             parametersJSON: json([json(tokens), json(["#caf\u{00e9}", "#cafe\u{0301}"])]))
        seed.close()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let check = try SQLiteBridge(url: database)
        defer { check.close() }
        let before = try nineTableSnapshot(check)
        var statements = 0
        var journals = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journals += 1 }
        let base: [String: Any] = ["projectId": "focus-target", "offset": 0, "limit": 100,
                                  "showCompleted": false, "completedCollapsed": false]
        func read(_ state: [String: Any] = [:], edit: [String: Any]? = nil,
                  offset: Int = 0, revision: String? = nil) async throws -> [String: Any] {
            var input = base; input["filters"] = state; input["filterSheetOpen"] = true; input["offset"] = offset
            if let edit { input["filterEdit"] = edit }
            if let revision { input["revision"] = revision }
            return try object(await core.call("menuRead", argumentsJSON: json(["projectDetailFilterView", json(input)])))
        }
        func state(_ view: [String: Any]) throws -> [String: Any] {
            try XCTUnwrap((view["filters"] as? [String: Any])?["state"] as? [String: Any])
        }
        func ids(_ view: [String: Any]) -> [String] {
            (view["items"] as? [[String: Any]] ?? []).compactMap { ($0["row"] as? [String: Any])?["id"] as? String }
        }
        let initial = try await read()
        XCTAssertEqual(ids(initial), ["rename-task"])
        let controls = try XCTUnwrap(initial["filters"] as? [String: Any])
        XCTAssertTrue(controls["projects"] is NSNull)
        XCTAssertEqual((controls["timeEstimates"] as? [Any])?.count, 0)
        XCTAssertEqual((controls["visibility"] as? [String: Any])?["timeEstimate"] as? Bool, false)
        let edit: [String: Any] = ["type": "toggleToken", "value": "@token-000"]
        let included = try await read(edit: edit)
        XCTAssertEqual(try state(included)["tokens"] as? [String], ["@token-000"])
        XCTAssertEqual(ids(included), ["rename-task"])
        let excluded = try await read(state(included), edit: edit)
        XCTAssertEqual(try state(excluded)["excludedTokens"] as? [String], ["@token-000"])
        XCTAssertEqual(ids(excluded), [])
        let neutral = try await read(state(excluded), edit: edit)
        XCTAssertEqual(try state(neutral)["excludedTokens"] as? [String], [])
        XCTAssertEqual(ids(neutral), ["rename-task"])
        let absent = try await read(["tokens": ["@missing"]])
        XCTAssertEqual(ids(absent), [])
        let empty = try XCTUnwrap(absent["empty"] as? [String: Any])
        let clear = try XCTUnwrap((empty["action"] as? [String: Any])?["filterEdit"] as? [String: Any])
        XCTAssertEqual(clear["type"] as? String, "clear")
        let cleared = try await read(state(absent), edit: clear)
        XCTAssertEqual(ids(cleared), ["rename-task"])
        let search = try await read(["searchQuery": "id:rename-task"])
        XCTAssertEqual(ids(search), ["rename-task"])
        func picker(_ query: String = "", offset: Int = 0, revision: String? = nil) async throws -> [String: Any] {
            var input = base; input["filters"] = [String: Any](); input["picker"] = "tokens"
            input["query"] = query; input["offset"] = offset
            if let revision { input["revision"] = revision }
            return try object(await core.call("menuRead", argumentsJSON: json(["projectDetailFilterOptions", json(input)])))
        }
        let first = try await picker()
        XCTAssertEqual(first["viewRevision"] as? String, initial["revision"] as? String)
        XCTAssertEqual(first["total"] as? Int, 152)
        let revision = try XCTUnwrap(first["revision"] as? String)
        let second = try await picker(offset: 100, revision: revision)
        let firstItems = try XCTUnwrap(first["items"] as? [[String: Any]])
        let secondItems = try XCTUnwrap(second["items"] as? [[String: Any]])
        XCTAssertEqual(firstItems.count, 100); XCTAssertEqual(secondItems.count, 52)
        let values = Set((firstItems + secondItems).compactMap { ($0["value"] as? String).map { Data($0.utf8) } })
        XCTAssertEqual(values.count, 152)
        XCTAssertTrue(values.contains(Data("#caf\u{00e9}".utf8)))
        XCTAssertTrue(values.contains(Data("#cafe\u{0301}".utf8)))
        let query = try await picker("TOKEN-149")
        XCTAssertEqual(query["total"] as? Int, 1)
        await expectFailure("STALE_REVISION") { _ = try await picker("TOKEN-149", offset: 100, revision: revision) }
        await expectFailure("STALE_REVISION") {
            _ = try await read(["tokens": ["@missing"]], offset: 1, revision: try XCTUnwrap(initial["revision"] as? String))
        }
        let legacy = try object(await core.call("menuRead", argumentsJSON: json(["projectDetailView", json(base)])))
        XCTAssertNil(legacy["filters"])
        XCTAssertEqual(ids(legacy), ["rename-task"])
        XCTAssertEqual(statements, 0); XCTAssertEqual(journals, 0)
        XCTAssertEqual(try nineTableSnapshot(check), before)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        await core.close()
    }

    func testProjectTaskFiltersRejectMalformedControlsBeforeSQLite() async throws {
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        var statements = 0
        var journals = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journals += 1 }
        let base: [String: Any] = ["projectId": "project", "offset": 0, "limit": 50,
                                  "showCompleted": false, "completedCollapsed": true, "filters": [String: Any]()]
        for kind in ["projectDetailFilterView", "projectDetailFilterOptions"] {
            var valid = base
            if kind == "projectDetailFilterOptions" { valid["picker"] = "tokens"; valid["query"] = "" }
            var invalid: [[String: Any]] = [[:], valid.filter { $0.key != "filters" }]
            let cases: [(String, Any)] = [
                ("extra", true), ("showCompleted", 1), ("completedCollapsed", "true"),
                ("offset", true), ("offset", -1), ("offset", 1.5), ("offset", 1),
                ("limit", 101), ("limit", false), ("revision", NSNull()), ("projectId", " "),
                ("projectId", String(repeating: "x", count: 501)), ("filters", NSNull()),
                ("filters", ["bogus": true]), ("filters", ["projects": ["project"]]),
                ("filters", ["timeEstimates": ["15min"]]),
                ("filters", ["tokens": [String(repeating: "x", count: 501)]]),
                ("filters", ["searchQuery": String(repeating: "x", count: 2001)])]
            for (field, value) in cases { var input = valid; input[field] = value; invalid.append(input) }
            if kind == "projectDetailFilterView" {
                for edit: [String: Any] in [["type": "toggleProject", "value": "project"],
                                           ["type": "toggleTimeEstimate", "value": "15min"], ["type": "bogus"]] {
                    var input = valid; input["filterEdit"] = edit; invalid.append(input)
                }
                for (field, value) in [("filterSheetOpen", 1 as Any), ("filterEdit", NSNull()), ("query", "")] {
                    var input = valid; input[field] = value; invalid.append(input)
                }
            } else {
                for (field, value) in [("picker", "projects" as Any), ("query", NSNull()),
                                       ("query", String(repeating: "x", count: 501)), ("filterSheetOpen", true),
                                       ("filterEdit", ["type": "clear"])] {
                    var input = valid; input[field] = value; invalid.append(input)
                }
            }
            for input in invalid {
                await expectFailure { _ = try await core.call("menuRead", argumentsJSON: json([kind, json(input)])) }
            }
        }
        XCTAssertEqual(statements, 0); XCTAssertEqual(journals, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        await core.close()
    }

    func testProjectCompletedViewRejectsMalformedControlsBeforeSQLite() async throws {
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        var statements = 0
        var journals = 0
        faults.beforeSQL = { _ in statements += 1 }
        faults.journalWrite = { journals += 1 }
        let valid: [String: Any] = ["projectId": "project", "offset": 0, "limit": 50,
                                    "showCompleted": false, "completedCollapsed": true]
        var invalid: [[String: Any]] = [[:], valid.filter { $0.key != "completedCollapsed" }]
        for (field, value) in [("extra", true as Any), ("showCompleted", 1), ("completedCollapsed", "true"),
                               ("offset", true), ("offset", -1), ("offset", 1.5), ("offset", 1),
                               ("limit", 101), ("revision", NSNull()), ("projectId", " "),
                               ("projectId", String(repeating: "x", count: 501))] {
            var input = valid; input[field] = value; invalid.append(input)
        }
        for input in invalid {
            await expectFailure { _ = try await core.call("menuRead", argumentsJSON: json(["projectDetailView", json(input)])) }
        }
        XCTAssertEqual(statements, 0)
        XCTAssertEqual(journals, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        await core.close()
    }

    func testFilteredProjectsUsesRNTagIdentityGroupingAndAreaIntersectionWithoutWrites() async throws {
        _ = try await seedDestinationTask()
        let seed = try SQLiteBridge(url: database)
        for (id, tags) in [
            ("destination-project-a", ["#work", "#caf\u{00e9}"]),
            ("destination-project-b", ["#home", "#cafe\u{0301}"]),
            ("destination-project-archived", ["#work"]),
            ("destination-project-deleted", ["#gone"]),
        ] {
            _ = try seed.execute("UPDATE projects SET tagIds = ? WHERE id = ?", parametersJSON: json([json(tags), id]))
        }
        _ = try seed.execute("UPDATE projects SET isFocused = 1, orderNum = 9 WHERE id = 'destination-project-a'")
        let at = recentAreaTestTime()
        for (id, status, tags) in [("filter-ordinary", "active", ["#work"]),
                                    ("filter-waiting", "waiting", ["#work"]),
                                    ("filter-empty", "active", [""]),
                                    ("filter-untagged", "active", [String]())] {
            _ = try seed.execute("INSERT INTO projects (id, title, status, color, areaId, orderNum, tagIds, isSequential, isFocused, createdAt, updatedAt, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                parametersJSON: json([id, id, status, "#94a3b8", "destination-area-a", 0, json(tags), 0, 0, at, at, 1]))
        }
        seed.close()
        let faults = HostIOFaults()
        var writes = 0
        faults.beforeSQL = { sql in
            if sql.range(of: #"(?i)^\s*(?:INSERT|UPDATE|DELETE)\b"#, options: .regularExpression) != nil { writes += 1 }
        }
        let core = host(faults)
        _ = try await core.start()
        let check = try SQLiteBridge(url: database)
        defer { check.close() }
        let before = try nineTableSnapshot(check)
        writes = 0
        func read(_ filter: String) async throws -> [String: Any] {
            let value = try object(await core.call("menuRead", argumentsJSON: json(["projects", json(["tagFilter": filter])])))
            XCTAssertEqual(Data((try XCTUnwrap(value["tagFilter"] as? String)).utf8), Data(filter.utf8))
            return value
        }
        func ids(_ value: [String: Any], _ section: String = "active") -> [String] {
            (value[section] as? [[String: Any]] ?? []).flatMap { group in
                (group["projects"] as? [[String: Any]] ?? []).compactMap { $0["id"] as? String }
            }
        }
        let all = try await read("__all__")
        let work = try await read("#work")
        XCTAssertEqual(ids(work), ["destination-project-a", "filter-ordinary"])
        XCTAssertEqual(ids(work, "deferred"), ["filter-waiting"])
        XCTAssertEqual(ids(work, "archived"), ["destination-project-archived"])
        let composed = try await read("#caf\u{00e9}")
        let decomposed = try await read("#cafe\u{0301}")
        XCTAssertEqual(ids(composed), ["destination-project-a"])
        XCTAssertEqual(ids(decomposed), ["destination-project-b"])
        let untagged = try await read("__none__")
        XCTAssertEqual(ids(untagged), ["filter-untagged"])
        let empty = try await read("")
        XCTAssertEqual(ids(empty), ["filter-empty"])
        let unknown = try await read("#unknown")
        XCTAssertEqual(ids(unknown), [])
        let inventory = try XCTUnwrap(all["tagInventory"] as? [String: Any])
        let values = try XCTUnwrap(inventory["values"] as? [String])
        XCTAssertEqual(values.map { Data($0.utf8) }, ["", "#cafe\u{0301}", "#caf\u{00e9}", "#home", "#work"].map { Data($0.utf8) })
        XCTAssertEqual(inventory["hasUntagged"] as? Bool, true)
        let legacy = try object(await core.call("projects"))
        XCTAssertEqual(Set(legacy.keys), Set(["version", "revision", "active", "deferred", "archived"]))
        XCTAssertEqual(ids(legacy), ids(all))
        XCTAssertEqual(writes, 0)
        XCTAssertEqual(try nineTableSnapshot(check), before)

        // The Area choice is an intentional settings write; subsequent tag reads remain pure.
        let area = try object(await core.call("areaFilter"))
        let option = try XCTUnwrap((area["options"] as? [[String: Any]])?.first { $0["id"] as? String == "destination-area-a" })
        _ = try await core.call("setAreaFilter", argumentsJSON: json([json(XCTUnwrap(option["next"]))]))
        let afterArea = try nineTableSnapshot(check)
        writes = 0
        let home = try await read("#home")
        XCTAssertTrue(ids(home).isEmpty)
        XCTAssertEqual(try json(XCTUnwrap(home["tagInventory"])), try json(inventory))
        XCTAssertEqual(writes, 0)
        XCTAssertEqual(try nineTableSnapshot(check), afterArea)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        await core.close()
    }

    func testFilteredProjectsRejectsMalformedAndOversizedInputsWithoutWrites() async throws {
        let core = host()
        _ = try await core.start()
        let check = try SQLiteBridge(url: database)
        defer { check.close() }
        let before = try nineTableSnapshot(check)
        let invalid: [Any] = [NSNull(), [], "#work", [:], ["tagFilter": NSNull()], ["tagFilter": 1],
                           ["tagFilter": "#work", "extra": true], ["tagFilter": String(repeating: "x", count: 100_001)],
                           ["tagFilter": String(repeating: "😀", count: 50_001)]]
        for input in invalid {
            let encoded = String(decoding: try JSONSerialization.data(withJSONObject: input, options: [.fragmentsAllowed]), as: UTF8.self)
            await expectFailure { _ = try await core.call("menuRead", argumentsJSON: json(["projects", encoded])) }
        }
        for filter in ["", String(repeating: "x", count: 100_000)] {
            let value = try object(await core.call("menuRead", argumentsJSON: json(["projects", json(["tagFilter": filter])])))
            XCTAssertEqual(Data((try XCTUnwrap(value["tagFilter"] as? String)).utf8), Data(filter.utf8))
        }
        XCTAssertEqual(try nineTableSnapshot(check), before)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        await core.close()
    }


    func testProjectTaskSortTitleDefaultNoopAndArchivedPreserveRows() async throws {
        try await seedProjectRenameRows()
        let faults = HostIOFaults()
        var applied = 0
        faults.commandDiagnostic = { if $0 == "projectTaskSortApplied" { applied += 1 } }
        let core = host(faults)
        _ = try await core.start()
        let options = try object(await core.call("projectTaskSortOptions", argumentsJSON: json([json(["projectId": "focus-target"])])))
        XCTAssertEqual(options["effectiveSortBy"] as? String, "default")
        XCTAssertEqual(options["canEdit"] as? Bool, true)
        XCTAssertEqual((options["choices"] as? [[String: Any]])?.first?["id"] as? String, "default")
        let beforeRow = try XCTUnwrap(projectRows("focus-target").first)
        let sqlite = try SQLiteBridge(url: database)
        let before = try nineTableSnapshot(sqlite)
        sqlite.close()
        let title = try await projectTaskSortRequest(core, sortBy: "title")
        let titleResult = try object(await core.call("projectTaskSortWrite", argumentsJSON: json([json(title)])))
        XCTAssertEqual(titleResult["taskSortBy"] as? String, "title")
        let titleRow = try XCTUnwrap(projectRows("focus-target").first)
        XCTAssertEqual(titleRow["taskSortBy"] as? String, "title")
        XCTAssertEqual(titleRow["rev"] as? Int, (beforeRow["rev"] as? Int ?? 0) + 1)
        for (field, value) in beforeRow where !["taskSortBy", "rev", "revBy", "updatedAt"].contains(field) {
            XCTAssertEqual(try json([titleRow[field] ?? NSNull()]), try json([value]), field)
        }
        let afterSQLite = try SQLiteBridge(url: database)
        let after = try nineTableSnapshot(afterSQLite)
        afterSQLite.close()
        for index in [0, 2, 3, 4, 5, 6, 7, 8] { XCTAssertEqual(after[index], before[index]) }
        let defaultRequest = try await projectTaskSortRequest(core, sortBy: "default")
        let cleared = try object(await core.call("projectTaskSortWrite", argumentsJSON: json([json(defaultRequest)])))
        XCTAssertTrue(cleared["taskSortBy"] is NSNull)
        XCTAssertTrue(try projectRows("focus-target").first?["taskSortBy"] is NSNull)
        XCTAssertEqual(applied, 2)
        let unchanged = try await projectTaskSortRequest(core, sortBy: "default")
        let unchangedRow = try XCTUnwrap(projectRows("focus-target").first)
        var writes = 0, journals = 0
        faults.beforeSQL = { if $0.hasPrefix("UPDATE") || $0.hasPrefix("INSERT") { writes += 1 } }
        faults.journalWrite = { journals += 1 }
        let noOp = try object(await core.call("projectTaskSortWrite", argumentsJSON: json([json(unchanged)])))
        XCTAssertTrue(noOp["taskSortBy"] is NSNull)
        XCTAssertEqual(try json(XCTUnwrap(projectRows("focus-target").first)), try json(unchangedRow))
        XCTAssertEqual(writes, 0); XCTAssertEqual(journals, 0); XCTAssertEqual(applied, 2)
        await core.close()
        let edit = try SQLiteBridge(url: database)
        _ = try edit.execute("UPDATE projects SET status = 'archived', rev = rev + 1 WHERE id = 'focus-target'")
        edit.close()
        let archived = host()
        _ = try await archived.start()
        let archivedOptions = try object(await archived.call("projectTaskSortOptions", argumentsJSON: json([json(["projectId": "focus-target"])])))
        XCTAssertEqual(archivedOptions["canEdit"] as? Bool, false)
        let blockedRequest = try await projectTaskSortRequest(archived, sortBy: "title")
        let blocked = try object(await archived.call("projectTaskSortWrite", argumentsJSON: json([json(blockedRequest)])))
        XCTAssertEqual(blocked["blocked"] as? String, "")
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        await archived.close()
    }

    func testProjectTaskSortExactPendingRetryAndStaleRequestNeverRewrite() async throws {
        try await seedProjectRenameRows()
        let faults = HostIOFaults()
        let core = host(faults)
        _ = try await core.start()
        let request = try await projectTaskSortRequest(core, sortBy: "created-desc")
        let beforeRow = try XCTUnwrap(projectRows("focus-target").first)
        let sqlite = try SQLiteBridge(url: database)
        let before = try nineTableSnapshot(sqlite)
        sqlite.close()
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected Project task sort COMMIT failure") } }
        await expectFailure("SAVE_FAILED") {
            _ = try await core.call("projectTaskSortWrite", argumentsJSON: json([json(request)]))
        }
        let check = try SQLiteBridge(url: database)
        XCTAssertEqual(try nineTableSnapshot(check), before)
        check.close()
        XCTAssertEqual(try object(String(contentsOf: journal))["method"] as? String, "projectTaskSortCommit")
        faults.beforeSQL = nil
        let retryValue = try await core.retryPending()
        let retry = try object(XCTUnwrap(retryValue))
        XCTAssertEqual(retry["id"] as? String, "focus-target")
        XCTAssertEqual(retry["taskSortBy"] as? String, "created-desc")
        let savedRow = try XCTUnwrap(projectRows("focus-target").first)
        XCTAssertEqual(savedRow["rev"] as? Int, (beforeRow["rev"] as? Int ?? 0) + 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        var writes = 0, journals = 0
        faults.beforeSQL = { if $0.hasPrefix("UPDATE") || $0.hasPrefix("INSERT") { writes += 1 } }
        faults.journalWrite = { journals += 1 }
        await expectFailure("STALE_REVISION") {
            _ = try await core.call("projectTaskSortWrite", argumentsJSON: json([json(request)]))
        }
        await expectFailure("STALE_REVISION") {
            _ = try await core.call("projectTaskSortRetryOutcome", argumentsJSON: json([json(request)]))
        }
        XCTAssertEqual(writes, 0); XCTAssertEqual(journals, 0)
        XCTAssertEqual(try json(XCTUnwrap(projectRows("focus-target").first)), try json(savedRow))
        await core.close()
    }

    func testProjectTaskSortFailedCommitAndColdReplayPreserveNestedAttachment() async throws {
        try await seedProjectRenameRows()
        let nested = #"[{"updatedAt":"2026-09-01T12:00:00.000Z","uri":"file:///second.txt","title":"Second","kind":"file","id":"second","createdAt":"2026-09-01T12:00:00.000Z","cloudKey":"attachments/second.txt","contentRev":2},{"uri":"file:///first.txt","title":"First","kind":"file","id":"first","createdAt":"2026-09-01T12:00:00.000Z","updatedAt":"2026-09-01T12:00:00.000Z","size":17}]"#
        let edit = try SQLiteBridge(url: database)
        _ = try edit.execute("UPDATE projects SET attachments = ? WHERE id = 'focus-target'", parametersJSON: json([nested]))
        edit.close()
        let faults = HostIOFaults()
        let writer = host(faults)
        _ = try await writer.start()
        let request = try await projectTaskSortRequest(writer, sortBy: "title")
        let sqlite = try SQLiteBridge(url: database)
        let before = try nineTableSnapshot(sqlite)
        sqlite.close()
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected Project task sort COMMIT failure") } }
        await expectFailure("SAVE_FAILED") {
            _ = try await writer.call("projectTaskSortWrite", argumentsJSON: json([json(request)]))
        }
        let pending = try object(String(contentsOf: journal))
        XCTAssertEqual(pending["method"] as? String, "projectTaskSortCommit")
        let rolledBack = try SQLiteBridge(url: database)
        XCTAssertEqual(try nineTableSnapshot(rolledBack), before)
        rolledBack.close()
        await writer.close()
        let replay = host()
        let startup = try object(await replay.start())
        let recovery = try XCTUnwrap(startup["recovery"] as? [String: Any])
        XCTAssertEqual(recovery["method"] as? String, "projectTaskSortCommit")
        XCTAssertEqual((recovery["result"] as? [String: Any])?["taskSortBy"] as? String, "title")
        let afterRow = try XCTUnwrap(projectRows("focus-target").first)
        XCTAssertEqual(afterRow["taskSortBy"] as? String, "title")
        let savedAttachment = try XCTUnwrap(afterRow["attachments"] as? String)
        XCTAssertEqual(try json(JSONSerialization.jsonObject(with: Data(savedAttachment.utf8))),
                       try json(JSONSerialization.jsonObject(with: Data(nested.utf8))))
        let attachmentRows = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(savedAttachment.utf8)) as? [[String: Any]])
        XCTAssertEqual(attachmentRows.compactMap { $0["id"] as? String }, ["second", "first"])
        let saved = try SQLiteBridge(url: database)
        let after = try nineTableSnapshot(saved)
        saved.close()
        for index in [0, 2, 3, 4, 5, 6, 7, 8] { XCTAssertEqual(after[index], before[index]) }
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        await replay.close()
    }

    func testProjectTaskSortPendingBeforeRowConflictRefusesWithoutWrites() async throws {
        try await seedProjectRenameRows()
        let faults = HostIOFaults()
        let writer = host(faults)
        _ = try await writer.start()
        let request = try await projectTaskSortRequest(writer, sortBy: "title")
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected pending Project task sort") } }
        await expectFailure("SAVE_FAILED") {
            _ = try await writer.call("projectTaskSortWrite", argumentsJSON: json([json(request)]))
        }
        await writer.close()
        let edit = try SQLiteBridge(url: database)
        _ = try edit.execute("UPDATE projects SET title = 'Newer name', rev = rev + 1 WHERE id = 'focus-target'")
        let before = try nineTableSnapshot(edit)
        edit.close()
        let replay = host()
        await expectFailure("STALE_REVISION") { _ = try await replay.start() }
        let check = try SQLiteBridge(url: database)
        XCTAssertEqual(try nineTableSnapshot(check), before)
        check.close()
        XCTAssertTrue(FileManager.default.fileExists(atPath: journal.path))
        await replay.close()
    }

    func testProjectTaskSortTerminalCleanupAfterRenameOrDeleteUsesReceipt() async throws {
        let parent = directory!
        for kind in ["rename", "delete"] {
            directory = parent.appendingPathComponent(kind)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try await seedProjectRenameRows()
            let faults = HostIOFaults()
            let writer = host(faults)
            _ = try await writer.start()
            let request = try await projectTaskSortRequest(writer, sortBy: "title")
            faults.journalRemove = { throw HostFailure("Injected Project task sort cleanup failure") }
            await expectFailure("cleanup failure") {
                _ = try await writer.call("projectTaskSortWrite", argumentsJSON: json([json(request)]))
            }
            let pending = try object(String(contentsOf: journal))
            XCTAssertEqual(pending["method"] as? String, "projectTaskSortCommit")
            XCTAssertNotNil(pending["terminal"])
            await writer.close()
            let edit = try SQLiteBridge(url: database)
            if kind == "rename" {
                _ = try edit.execute("UPDATE projects SET title = 'Later name', rev = rev + 1 WHERE id = 'focus-target'")
            } else {
                _ = try edit.execute("UPDATE projects SET deletedAt = ?, rev = rev + 1 WHERE id = 'focus-target'",
                                     parametersJSON: json([recentAreaTestTime(daysAgo: 0)]))
            }
            let before = try nineTableSnapshot(edit)
            edit.close()
            let beforeTarget = try XCTUnwrap(projectRows("focus-target").first)
            let beforeTask = try storedTask("rename-task")
            let beforeSection = try XCTUnwrap(projectSectionRows("rename-section").first)
            let beforeUnrelated = try storedTask("rename-unrelated-task")
            let replay = host()
            let startup = try object(await replay.start())
            let recovery = try XCTUnwrap(startup["recovery"] as? [String: Any])
            XCTAssertEqual(recovery["method"] as? String, "projectTaskSortCommit")
            XCTAssertEqual((recovery["result"] as? [String: Any])?["taskSortBy"] as? String, "title")
            let check = try SQLiteBridge(url: database)
            let after = try nineTableSnapshot(check)
            check.close()
            XCTAssertEqual(try json(XCTUnwrap(projectRows("focus-target").first)), try json(beforeTarget))
            XCTAssertEqual(try json(storedTask("rename-unrelated-task")), try json(beforeUnrelated))
            if kind == "rename" {
                XCTAssertEqual(after, before)
            } else {
                for index in [1, 2, 3, 5, 6, 7, 8] { XCTAssertEqual(after[index], before[index]) }
                let detached = try storedTask("rename-task")
                XCTAssertTrue(detached["projectId"] is NSNull)
                XCTAssertTrue(detached["sectionId"] is NSNull)
                XCTAssertEqual(detached["rev"] as? Int, (beforeTask["rev"] as? Int ?? 0) + 1)
                for (field, value) in beforeTask where !["projectId", "sectionId", "rev", "revBy", "updatedAt"].contains(field) {
                    XCTAssertEqual(try json([detached[field] ?? NSNull()]), try json([value]), field)
                }
                let removedSection = try XCTUnwrap(projectSectionRows("rename-section").first)
                XCTAssertNotNil(removedSection["deletedAt"] as? String)
                XCTAssertEqual(removedSection["rev"] as? Int, (beforeSection["rev"] as? Int ?? 0) + 1)
                for (field, value) in beforeSection where !["deletedAt", "rev", "revBy", "updatedAt"].contains(field) {
                    XCTAssertEqual(try json([removedSection[field] ?? NSNull()]), try json([value]), field)
                }
            }
            XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
            await replay.close()
            directory = parent
        }
    }

    func testProjectTaskSortMalformedPublicAndForgedJournalsRefuseBeforeSQLite() async throws {
        try await seedProjectRenameRows()
        let faults = HostIOFaults()
        let writer = host(faults)
        _ = try await writer.start()
        let request = try await projectTaskSortRequest(writer, sortBy: "title")
        var sql = 0, journals = 0
        faults.beforeSQL = { _ in sql += 1 }
        faults.journalWrite = { journals += 1 }
        for bad in [
            ["requestId": UUID().uuidString.lowercased(), "projectId": "focus-target", "sortBy": "unknown", "expected": request["expected"]!],
            ["requestId": UUID().uuidString.lowercased(), "projectId": "focus-target", "sortBy": "title", "expected": [:]],
            ["requestId": UUID().uuidString.lowercased(), "projectId": "focus-target", "sortBy": "title", "expected": request["expected"]!, "extra": true],
        ] as [[String: Any]] {
            await expectFailure("INVALID_INPUT") { _ = try await writer.call("projectTaskSortWrite", argumentsJSON: json([json(bad)])) }
        }
        var oversized = request
        oversized["projectId"] = String(repeating: "x", count: 2_000_001)
        await expectFailure("INVALID_INPUT") {
            _ = try await writer.call("projectTaskSortWrite", argumentsJSON: json([json(oversized)]))
        }
        await expectFailure { _ = try await writer.call("projectTaskSortPrepare", argumentsJSON: json([json(request)])) }
        await expectFailure { _ = try await writer.call("projectTaskSortValidate", argumentsJSON: json([json(request)])) }
        await expectFailure { _ = try await writer.call("projectTaskSortCommit", argumentsJSON: json([json(request)])) }
        XCTAssertEqual(sql, 0); XCTAssertEqual(journals, 0)
        faults.beforeSQL = { if $0 == "COMMIT" { throw HostFailure("Injected Project task sort pending write") } }
        faults.journalWrite = nil
        await expectFailure("SAVE_FAILED") {
            _ = try await writer.call("projectTaskSortWrite", argumentsJSON: json([json(request)]))
        }
        let pending = try object(String(contentsOf: journal))
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(pending["argumentsJSON"] as? String).utf8)) as? [String])
        let original = try object(XCTUnwrap(args.first))
        await writer.close()
        for kind in ["scope", "effect", "terminal", "raw"] {
            var envelope = original
            var method = "projectTaskSortCommit"
            var terminal: [String: Any]? = nil
            if kind == "scope" {
                var prepared = try XCTUnwrap(envelope["prepared"] as? [String: Any])
                var scope = try XCTUnwrap(prepared["scope"] as? [String: Any])
                var project = try XCTUnwrap(scope["project"] as? [String: Any])
                project.removeValue(forKey: "tagIds")
                scope["project"] = project; prepared["scope"] = scope; envelope["prepared"] = prepared
            } else if kind == "effect" {
                var prepared = try XCTUnwrap(envelope["prepared"] as? [String: Any])
                var effect = try XCTUnwrap(prepared["effect"] as? [String: Any])
                var pair = try XCTUnwrap(effect["project"] as? [String: Any])
                var after = try XCTUnwrap(pair["after"] as? [String: Any])
                after["title"] = "Forged"
                pair["after"] = after; effect["project"] = pair; prepared["effect"] = effect; envelope["prepared"] = prepared
            } else if kind == "terminal" {
                terminal = ["success": ["_0": try json(["id": "focus-target", "taskSortBy": NSNull()])]]
            } else { method = "projectTaskSortWrite" }
            var forged: [String: Any] = ["version": 2, "method": method,
                "argumentsJSON": kind == "raw" ? try json([json(request)]) : try json([json(envelope)])]
            if let terminal { forged["terminal"] = terminal }
            let bytes = Data(try json(forged).utf8)
            try bytes.write(to: journal)
            let blockedFaults = HostIOFaults()
            var statements = 0, removals = 0
            blockedFaults.beforeSQL = { _ in statements += 1 }
            blockedFaults.journalRemove = { removals += 1 }
            let blocked = host(blockedFaults)
            await expectFailure { _ = try await blocked.start() }
            XCTAssertEqual(statements, 0); XCTAssertEqual(removals, 0)
            XCTAssertEqual(try Data(contentsOf: journal), bytes)
            await blocked.close()
        }
    }
}
