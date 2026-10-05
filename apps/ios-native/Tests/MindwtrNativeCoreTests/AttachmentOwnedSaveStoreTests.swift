import XCTest
import Foundation
import Darwin
@testable import MindwtrNativeCore

final class AttachmentOwnedSaveStoreTests: XCTestCase {
    private typealias Store = NativeAttachmentDraftStore
    private var root: URL!
    private var database: URL!
    private var editor: EditorDraftStore!
    private var sidecar: Store!
    private let session = "550e8400-e29b-41d4-a716-446655440000"
    private let attemptID = "550e8400-e29b-41d4-a716-446655440001"
    private let operationID = "550e8400-e29b-41d4-a716-446655440002"

    override func setUpWithError() throws {
        let checkout = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let fixture = checkout.appendingPathComponent(".build/task238-fixtures/\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: fixture, withIntermediateDirectories: true)
        guard let physical = Darwin.realpath(fixture.path, nil) else { throw StoreError.corrupt }
        defer { Darwin.free(physical) }
        root = URL(fileURLWithPath: String(cString: physical), isDirectory: true)
        database = root.appendingPathComponent("library.sqlite")
        editor = EditorDraftStore(databaseURL: database)
        sidecar = Store(databaseURL: database)
    }
    private typealias StoreError = NativeAttachmentDraftStoreError
    override func tearDownWithError() throws {
        if let root { _ = Darwin.chmod(root.path, mode_t(0o700)); try FileManager.default.removeItem(at: root) }
    }
    private func snapshot(_ generation: Int = 2, payload: String = "{\"raw\":\"unchanged\"}",
                          task: String = "task") -> EditorDraftSnapshot {
        EditorDraftSnapshot(sessionID: session, taskID: task, generation: generation, payloadJSON: payload)
    }
    private func arguments(_ object: String = "{\"id\":\"task\",\"patch\":{}}") throws -> String {
        String(decoding: try JSONSerialization.data(withJSONObject: [object]), as: UTF8.self)
    }
    private func attempt(_ expected: EditorDraftSnapshot? = nil, id: String? = nil,
                         method: String = "attachmentDraftSave", args: String? = nil) throws -> EditorDraftAttempt {
        let expected = expected ?? snapshot()
        return EditorDraftAttempt(id: id ?? attemptID, sessionID: expected.sessionID, taskID: expected.taskID,
            generation: expected.generation, method: method, argumentsJSON: try args ?? arguments())
    }
    private func record() -> Store.Record {
        let sha = String(repeating: "a", count: 64)
        let before = snapshot(1), after = snapshot()
        let op = Store.Operation(requestId: operationID, requestJSON: "{\"request\":1}", phase: .checkpointed,
            before: before, after: after, preparedJSON: "{\"prepared\":1}", targetURI: "file:///owned/attachments/target",
            source: Store.Source(sourceURI: "file:///owned/cache/input", sha256: sha, size: 12,
                identity: "1:11", cacheRootIdentity: "1:12", parentIdentity: "1:13"),
            stage: Store.Stage(uri: "file:///owned/attachments/private/stage", identity: "1:21",
                directoryIdentity: "1:22", privateDirectoryIdentity: "1:23"),
            filled: Store.Filled(sha256: sha, size: 12, identity: "1:21"),
            published: Store.Published(sha256: sha, size: 12, identity: "1:21", directoryIdentity: "1:22"),
            replyJSON: "{\"reply\":1}")
        return Store.Record(version: 2, session: Store.Session(sessionID: session, taskID: "task",
            state: .active, checkpoint: after), operations: [op])
    }
    private func object(_ value: Store.Record) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as? [String: Any])
    }
    private func record(_ raw: [String: Any]) throws -> Store.Record {
        try JSONDecoder().decode(Store.Record.self, from: JSONSerialization.data(withJSONObject: raw))
    }
    private func setting(_ value: Any, path: ArraySlice<String>, to replacement: Any) throws -> Any {
        guard let first = path.first else { return replacement }
        if var array = value as? [Any], let index = Int(first) {
            array[index] = try setting(array[index], path: path.dropFirst(), to: replacement); return array
        }
        var object = try XCTUnwrap(value as? [String: Any])
        object[first] = try setting(XCTUnwrap(object[first]), path: path.dropFirst(), to: replacement)
        return object
    }
    private func changed(_ base: Store.Record, _ changes: [([String], Any)]) throws -> Store.Record {
        var value: Any = try object(base)
        for (path, replacement) in changes { value = try setting(value, path: path[...], to: replacement) }
        return try record(XCTUnwrap(value as? [String: Any]))
    }
    private func identity(_ url: URL) throws -> String {
        var info = stat()
        guard Darwin.lstat(url.path, &info) == 0 else { throw StoreError.io }
        return "\(UInt64(info.st_dev)):\(UInt64(info.st_ino))"
    }
    private func assertEditorRetained(_ body: () throws -> Void,
                                     file: StaticString = #filePath, line: UInt = #line) throws {
        let data = try Data(contentsOf: editor.url), inode = try identity(editor.url)
        XCTAssertThrowsError(try body(), file: file, line: line)
        XCTAssertEqual(try Data(contentsOf: editor.url), data, file: file, line: line)
        XCTAssertEqual(try identity(editor.url), inode, file: file, line: line)
    }
    private func assertSidecarRetained(_ body: () throws -> Void,
                                      file: StaticString = #filePath, line: UInt = #line) throws {
        let data = try Data(contentsOf: sidecar.url), inode = try identity(sidecar.url)
        XCTAssertThrowsError(try body(), file: file, line: line)
        XCTAssertEqual(try Data(contentsOf: sidecar.url), data, file: file, line: line)
        XCTAssertEqual(try identity(sidecar.url), inode, file: file, line: line)
    }
    private func writeEditorRaw(_ expected: EditorDraftSnapshot, _ pending: EditorDraftAttempt) throws {
        let snapshot = try JSONSerialization.jsonObject(with: JSONEncoder().encode(expected))
        let attempt = try JSONSerialization.jsonObject(with: JSONEncoder().encode(pending))
        try JSONSerialization.data(withJSONObject: ["snapshot": snapshot, "attempt": attempt]).write(to: editor.url)
    }

    func testPurePreflightCreatesNoFilesAndDoesNotRewriteExistingEditor() throws {
        let expected = snapshot(), pending = try attempt()
        try editor.preflightOwnedSave(expected: expected, attempt: pending)
        XCTAssertFalse(FileManager.default.fileExists(atPath: editor.url.path))
        try editor.checkpoint(expected)
        let data = try Data(contentsOf: editor.url), inode = try identity(editor.url)
        try editor.preflightOwnedSave(expected: expected, attempt: pending)
        XCTAssertEqual(try Data(contentsOf: editor.url), data)
        XCTAssertEqual(try identity(editor.url), inode)
    }

    func testFreezeAndColdSameAttemptReplayDurablyRewriteExactRecord() throws {
        let expected = snapshot(), pending = try attempt()
        try editor.checkpoint(expected)
        try editor.freezeOwnedSaveMatching(expected: expected, attempt: pending)
        let inode = try identity(editor.url)
        let cold = EditorDraftStore(databaseURL: database)
        try cold.freezeOwnedSaveMatching(expected: expected, attempt: pending)
        XCTAssertNotEqual(try identity(editor.url), inode)
        XCTAssertEqual(try cold.read()?.snapshot.payloadJSON.utf8.map { $0 }, Array(expected.payloadJSON.utf8))
        XCTAssertEqual(try cold.read()?.attempt?.argumentsJSON.utf8.map { $0 }, Array(pending.argumentsJSON.utf8))
    }

    func testThawAndAlreadyThawedColdRetryDurablyRewriteWithoutLosingRawDraft() throws {
        let expected = snapshot(payload: "{ \"raw\" : \" @Opening \" }"), pending = try attempt()
        try editor.checkpoint(expected)
        try editor.freezeOwnedSaveMatching(expected: expected, attempt: pending)
        try editor.thawOwnedSaveMatching(expected: expected, attempt: pending)
        let inode = try identity(editor.url)
        try EditorDraftStore(databaseURL: database).thawOwnedSaveMatching(expected: expected, attempt: pending)
        XCTAssertNotEqual(try identity(editor.url), inode)
        let read = try XCTUnwrap(editor.read())
        XCTAssertNil(read.attempt)
        XCTAssertEqual(Array(read.snapshot.payloadJSON.utf8), Array(expected.payloadJSON.utf8))
    }

    func testExactDetachAndColdMissingRetryRemoveOnlyEditor() throws {
        let expected = snapshot(), pending = try attempt()
        try editor.checkpoint(expected)
        try editor.freezeOwnedSaveMatching(expected: expected, attempt: pending)
        try editor.removeOwnedSaveMatching(expected: expected, attempt: pending)
        try EditorDraftStore(databaseURL: database).removeOwnedSaveMatching(expected: expected, attempt: pending)
        XCTAssertNil(try editor.read())
    }

    func testAbsentDetachAndReleaseStillRequireParentDurability() throws {
        let absentDatabase = root.appendingPathComponent("missing-parent/library.sqlite")
        XCTAssertThrowsError(try EditorDraftStore(databaseURL: absentDatabase)
            .removeOwnedSaveMatching(expected: snapshot(), attempt: attempt()))
        XCTAssertThrowsError(try Store(databaseURL: absentDatabase)
            .releaseSavedAddsMatching(fingerprint: Store.ownedSaveFingerprint(record())))
    }

    func testMissingEditorCannotFreezeOrThaw() throws {
        let pending = try attempt()
        XCTAssertThrowsError(try editor.freezeOwnedSaveMatching(expected: snapshot(), attempt: pending))
        XCTAssertThrowsError(try editor.thawOwnedSaveMatching(expected: snapshot(), attempt: pending))
        XCTAssertFalse(FileManager.default.fileExists(atPath: editor.url.path))
    }

    func testPreflightRefusesWrongIdentityMethodUnsafeGenerationAndArgumentShape() throws {
        let expected = snapshot(), pending = try attempt()
        let invalid = [
            EditorDraftAttempt(id: "invalid", sessionID: session, taskID: "task", generation: 2,
                               method: pending.method, argumentsJSON: pending.argumentsJSON),
            EditorDraftAttempt(id: attemptID, sessionID: attemptID, taskID: "task", generation: 2,
                               method: pending.method, argumentsJSON: pending.argumentsJSON),
            EditorDraftAttempt(id: attemptID, sessionID: session, taskID: "other", generation: 2,
                               method: pending.method, argumentsJSON: pending.argumentsJSON),
            EditorDraftAttempt(id: attemptID, sessionID: session, taskID: "task", generation: 3,
                               method: pending.method, argumentsJSON: pending.argumentsJSON),
            try attempt(method: "saveDraft"), try attempt(method: "unknown"),
            try attempt(args: "[]"), try attempt(args: "[\"[]\"]"), try attempt(args: "[{},{}]")
        ]
        for value in invalid { XCTAssertThrowsError(try editor.preflightOwnedSave(expected: expected, attempt: value)) }
        for generation in [0, -1, 9_007_199_254_740_992, Int.max] {
            let value = snapshot(generation)
            XCTAssertThrowsError(try editor.preflightOwnedSave(expected: value, attempt: attempt(value)))
        }
        let maximum = snapshot(9_007_199_254_740_991)
        try editor.preflightOwnedSave(expected: maximum, attempt: attempt(maximum))
        XCTAssertFalse(FileManager.default.fileExists(atPath: editor.url.path))
    }

    func testOtherAttemptRefusesFreezeThawAndDetachPreservingFrozenEditor() throws {
        let expected = snapshot(), pending = try attempt()
        try editor.checkpoint(expected); try editor.freezeOwnedSaveMatching(expected: expected, attempt: pending)
        let other = try attempt(id: operationID)
        try assertEditorRetained { try editor.freezeOwnedSaveMatching(expected: expected, attempt: other) }
        try assertEditorRetained { try editor.thawOwnedSaveMatching(expected: expected, attempt: other) }
        try assertEditorRetained { try editor.removeOwnedSaveMatching(expected: expected, attempt: other) }
    }

    func testDifferentFullSnapshotIdentitiesRefuseWithoutReplacingEditor() throws {
        let expected = snapshot(), pending = try attempt()
        try editor.checkpoint(expected); try editor.freezeOwnedSaveMatching(expected: expected, attempt: pending)
        let otherSession = EditorDraftSnapshot(sessionID: operationID, taskID: "task", generation: 2,
            payloadJSON: expected.payloadJSON)
        for different in [otherSession, snapshot(task: "other-task"), snapshot(3),
                          snapshot(payload: "{ \"raw\" : \"unchanged\" }")] {
            let changedAttempt = try attempt(different)
            try assertEditorRetained { try editor.freezeOwnedSaveMatching(expected: different, attempt: changedAttempt) }
            try assertEditorRetained { try editor.thawOwnedSaveMatching(expected: different, attempt: changedAttempt) }
            try assertEditorRetained { try editor.removeOwnedSaveMatching(expected: different, attempt: changedAttempt) }
        }
    }

    func testArgumentsJSONSpellingCannotBeReplannedBySameAttemptIdentity() throws {
        let expected = snapshot(), pending = try attempt()
        let changedAttempt = try attempt(args: arguments("{ \"id\" : \"task\", \"patch\" : {} }"))
        try editor.checkpoint(expected); try editor.freezeOwnedSaveMatching(expected: expected, attempt: pending)
        try assertEditorRetained { try editor.freezeOwnedSaveMatching(expected: expected, attempt: changedAttempt) }
        try assertEditorRetained { try editor.thawOwnedSaveMatching(expected: expected, attempt: changedAttempt) }
        try assertEditorRetained { try editor.removeOwnedSaveMatching(expected: expected, attempt: changedAttempt) }
    }

    func testCopiedAttemptCannotAuthorizeChangedPayloadOrGeneration() throws {
        let expected = snapshot(), pending = try attempt()
        for changed in [snapshot(payload: "{\"raw\":\"new ordinary edit\"}"), snapshot(3)] {
            try writeEditorRaw(changed, pending)
            try assertEditorRetained { try editor.freezeOwnedSaveMatching(expected: expected, attempt: pending) }
            try assertEditorRetained { try editor.thawOwnedSaveMatching(expected: expected, attempt: pending) }
            try assertEditorRetained { try editor.removeOwnedSaveMatching(expected: expected, attempt: pending) }
        }
    }

    func testUnicodeEquivalentPayloadDoesNotAuthorizeAnyOwnedTransition() throws {
        let nfc = snapshot(payload: "{\"raw\":\"é\"}"), nfd = snapshot(payload: "{\"raw\":\"e\u{301}\"}")
        XCTAssertEqual(nfc.payloadJSON, nfd.payloadJSON)
        let pending = try attempt()
        try editor.checkpoint(nfc); try editor.freezeOwnedSaveMatching(expected: nfc, attempt: pending)
        try assertEditorRetained { try editor.freezeOwnedSaveMatching(expected: nfd, attempt: pending) }
        try assertEditorRetained { try editor.thawOwnedSaveMatching(expected: nfd, attempt: pending) }
        try assertEditorRetained { try editor.removeOwnedSaveMatching(expected: nfd, attempt: pending) }
    }

    func testUnicodeEquivalentArgumentsDoNotMatchFrozenAttempt() throws {
        let expected = snapshot()
        let nfc = try attempt(args: arguments("{\"id\":\"task\",\"raw\":\"é\"}"))
        let nfd = try attempt(args: arguments("{\"id\":\"task\",\"raw\":\"e\u{301}\"}"))
        XCTAssertEqual(nfc.argumentsJSON, nfd.argumentsJSON)
        try editor.checkpoint(expected); try editor.freezeOwnedSaveMatching(expected: expected, attempt: nfc)
        try assertEditorRetained { try editor.freezeOwnedSaveMatching(expected: expected, attempt: nfd) }
        try assertEditorRetained { try editor.thawOwnedSaveMatching(expected: expected, attempt: nfd) }
        try assertEditorRetained { try editor.removeOwnedSaveMatching(expected: expected, attempt: nfd) }
    }

    func testUnicodeEquivalentTaskIDsRefusePreflightAndRawRead() throws {
        let nfc = snapshot(task: "café"), nfd = snapshot(task: "cafe\u{301}")
        let pending = try attempt(nfc)
        XCTAssertThrowsError(try editor.preflightOwnedSave(expected: nfd, attempt: pending))
        try writeEditorRaw(nfd, pending)
        try assertEditorRetained { _ = try editor.read() }
        try editor.preflightOwnedSave(expected: nfc, attempt: pending)
    }

    func testPresentThawedEditorCannotBeDetached() throws {
        try editor.checkpoint(snapshot())
        try assertEditorRetained { try editor.removeOwnedSaveMatching(expected: snapshot(), attempt: attempt()) }
    }

    func testEscapedEditorFileCapacityRefusesBeforeWrite() throws {
        let payload = "{\"raw\":\"" + String(repeating: "\\\\", count: 300_000) + "\"}"
        let request = "{\"raw\":\"" + String(repeating: "\\\\", count: 250_000) + "\"}"
        let expected = snapshot(payload: payload), pending = try attempt(args: arguments(request))
        XCTAssertLessThan(expected.payloadJSON.utf8.count, 1_000_000)
        XCTAssertLessThan(pending.argumentsJSON.utf8.count, 2_000_000)
        try editor.checkpoint(snapshot())
        try assertEditorRetained { try editor.preflightOwnedSave(expected: expected, attempt: pending) }
        try assertEditorRetained { try editor.freezeOwnedSaveMatching(expected: expected, attempt: pending) }
    }

    func testLegacyAttemptMethodsAndVersionRemainUnchanged() throws {
        for method in ["saveDraft", "checklistSave", "boardAction", "taskDelete", "taskPromote"] {
            let local = EditorDraftStore(databaseURL: root.appendingPathComponent("\(method).sqlite"))
            try local.checkpoint(snapshot())
            let pending = try local.freeze(sessionID: session, generation: 2, method: method, argumentsJSON: arguments())
            XCTAssertEqual(try local.read()?.attempt?.method, method)
            try local.thaw(pending)
            XCTAssertNil(try local.read()?.attempt)
        }
        try writeEditorRaw(snapshot(), attempt(method: "unknown"))
        try assertEditorRetained { _ = try editor.read() }
        var raw = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: editor.url)) as? [String: Any])
        var saved = try XCTUnwrap(raw["snapshot"] as? [String: Any]); saved["version"] = 2; raw["snapshot"] = saved
        try JSONSerialization.data(withJSONObject: raw).write(to: editor.url)
        try assertEditorRetained { _ = try editor.read() }
    }

    func testFingerprintIsPureCanonicalAndStableAfterColdDecodeAndKeyReordering() throws {
        let value = record(), fingerprint = try Store.ownedSaveFingerprint(record())
        XCTAssertEqual(fingerprint.count, 64)
        XCTAssertTrue(fingerprint.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) })
        XCTAssertEqual(try Store.ownedSaveFingerprint(value), fingerprint)
        XCTAssertFalse(FileManager.default.fileExists(atPath: sidecar.url.path))
        let pretty = try JSONSerialization.data(withJSONObject: object(value), options: [.prettyPrinted])
        try pretty.write(to: sidecar.url)
        let inode = try identity(sidecar.url)
        XCTAssertEqual(try Store.ownedSaveFingerprint(XCTUnwrap(Store(databaseURL: database).read())), fingerprint)
        XCTAssertEqual(try Data(contentsOf: sidecar.url), pretty)
        XCTAssertEqual(try identity(sidecar.url), inode)
        try sidecar.releaseSavedAddsMatching(fingerprint: fingerprint)
        XCTAssertNil(try sidecar.read())
    }

    func testEveryNativeProofAndOpaqueOperationFieldParticipatesInFingerprint() throws {
        let base = record(), fingerprint = try Store.ownedSaveFingerprint(base)
        let op = ["operations", "0"]
        let mutations: [[([String], Any)]] = [
            [(op + ["requestId"], attemptID)], [(op + ["requestJSON"], "{\"request\":2}")],
            [(op + ["preparedJSON"], "{\"prepared\":2}")], [(op + ["replyJSON"], "{\"reply\":2}")],
            [(op + ["targetURI"], "file:///owned/attachments/other")],
            [(op + ["before", "payloadJSON"], "{\"raw\":\"opening\"}")],
            [(op + ["after", "payloadJSON"], "{\"raw\":\"later\"}"), (["session", "checkpoint", "payloadJSON"], "{\"raw\":\"later\"}")],
            [(op + ["source", "sourceURI"], "file:///owned/cache/other")],
            [(op + ["source", "identity"], "2:11")], [(op + ["source", "cacheRootIdentity"], "2:12")],
            [(op + ["source", "parentIdentity"], "2:13")],
            [(op + ["stage", "uri"], "file:///owned/attachments/other/stage")],
            [(op + ["stage", "privateDirectoryIdentity"], "2:23")],
            [(op + ["stage", "directoryIdentity"], "2:22"), (op + ["published", "directoryIdentity"], "2:22")],
            [(op + ["stage", "identity"], "2:21"), (op + ["filled", "identity"], "2:21"), (op + ["published", "identity"], "2:21")],
            [(op + ["source", "sha256"], String(repeating: "b", count: 64)), (op + ["filled", "sha256"], String(repeating: "b", count: 64)), (op + ["published", "sha256"], String(repeating: "b", count: 64))],
            [(op + ["source", "size"], 13), (op + ["filled", "size"], 13), (op + ["published", "size"], 13)]
        ]
        for edits in mutations { XCTAssertNotEqual(try Store.ownedSaveFingerprint(changed(base, edits)), fingerprint) }
        for field in ["taskID", "sessionID"] {
            let replacement = field == "taskID" ? "other-task" : attemptID
            let edits: [([String], Any)] = [(["session", field], replacement), (["session", "checkpoint", field], replacement),
                (op + ["before", field], replacement), (op + ["after", field], replacement)]
            XCTAssertNotEqual(try Store.ownedSaveFingerprint(changed(base, edits)), fingerprint)
        }
        XCTAssertNotEqual(try Store.ownedSaveFingerprint(changed(base, [(["session", "checkpoint", "generation"], 3)])), fingerprint)
    }

    func testFingerprintPreservesOpaqueJSONWhitespaceAndUnicodeBytes() throws {
        let base = record(), op = ["operations", "0"]
        for field in ["requestJSON", "preparedJSON", "replyJSON"] {
            let nfc = try changed(base, [(op + [field], "{\"raw\":\"é\"}")])
            let nfd = try changed(base, [(op + [field], "{\"raw\":\"e\u{301}\"}")])
            XCTAssertNotEqual(try Store.ownedSaveFingerprint(nfc), try Store.ownedSaveFingerprint(nfd))
            let whitespace = try changed(base, [(op + [field], "{ \"raw\" : \"é\" }")])
            XCTAssertNotEqual(try Store.ownedSaveFingerprint(nfc), try Store.ownedSaveFingerprint(whitespace))
        }
    }

    func testFingerprintIncludesExactCheckpointAndTaskUnicodeBytes() throws {
        let base = record(), op = ["operations", "0"]
        let payloadPaths = [["session", "checkpoint", "payloadJSON"], op + ["after", "payloadJSON"]]
        let nfc = try changed(base, payloadPaths.map { ($0, "{\"raw\":\"é\"}" as Any) })
        let nfd = try changed(base, payloadPaths.map { ($0, "{\"raw\":\"e\u{301}\"}" as Any) })
        XCTAssertNotEqual(try Store.ownedSaveFingerprint(nfc), try Store.ownedSaveFingerprint(nfd))
        let taskPaths = [["session", "taskID"], ["session", "checkpoint", "taskID"],
                         op + ["before", "taskID"], op + ["after", "taskID"]]
        let composed = try changed(base, taskPaths.map { ($0, "café" as Any) })
        let decomposed = try changed(base, taskPaths.map { ($0, "cafe\u{301}" as Any) })
        XCTAssertNotEqual(try Store.ownedSaveFingerprint(composed), try Store.ownedSaveFingerprint(decomposed))
    }

    func testLaterExactSnapshotOrAnotherRetainedOperationChangesFingerprint() throws {
        let base = record(), original = try Store.ownedSaveFingerprint(base)
        let later = Store.Record(version: 2, session: Store.Session(sessionID: session, taskID: "task", state: .active,
            checkpoint: snapshot(3, payload: "{\"raw\":\"ordinary edit\"}")), operations: base.operations)
        XCTAssertNotEqual(try Store.ownedSaveFingerprint(later), original)
        let second = try changed(base, [(["operations", "0", "requestId"], attemptID),
            (["operations", "0", "before", "generation"], 2), (["operations", "0", "after", "generation"], 3),
            (["session", "checkpoint", "generation"], 3)])
        let appended = Store.Record(version: 2, session: second.session, operations: base.operations + second.operations)
        XCTAssertNotEqual(try Store.ownedSaveFingerprint(appended), original)
    }

    func testFalseMalformedAndUnicodeChangedFingerprintsRetainSidecar() throws {
        let value = try changed(record(), [(["operations", "0", "preparedJSON"], "{\"raw\":\"é\"}")])
        try sidecar.write(value)
        let other = try changed(value, [(["operations", "0", "preparedJSON"], "{\"raw\":\"e\u{301}\"}")])
        for fingerprint in ["", String(repeating: "A", count: 64), String(repeating: "f", count: 63),
                            String(repeating: "0", count: 64), try Store.ownedSaveFingerprint(other)] {
            try assertSidecarRetained { try sidecar.releaseSavedAddsMatching(fingerprint: fingerprint) }
        }
    }

    func testReleaseAndColdAbsentRetryRemoveOnlyExactSidecar() throws {
        try sidecar.write(record())
        let fingerprint = try Store.ownedSaveFingerprint(record())
        try sidecar.releaseSavedAddsMatching(fingerprint: fingerprint)
        try Store(databaseURL: database).releaseSavedAddsMatching(fingerprint: fingerprint)
        XCTAssertNil(try sidecar.read())
        XCTAssertThrowsError(try sidecar.releaseSavedAddsMatching(fingerprint: "invalid"))
    }

    func testDisallowedRecordVersionsEmptyPendingAdvanceAndDiscardAreRetained() throws {
        let base = record(), op = ["operations", "0"]
        var v1 = try object(base); v1["version"] = 1; v1.removeValue(forKey: "checkpointAdvance")
        let empty = Store.Record(version: 2, session: base.session, operations: [])
        let advance = Store.Record(version: 2, session: base.session, operations: base.operations,
            checkpointAdvance: Store.CheckpointAdvance(before: snapshot(), after: snapshot(3)))
        let discard = Store.Record(version: 2, session: Store.Session(sessionID: session, taskID: "task",
            state: .cleanupPending, checkpoint: snapshot()), operations: base.operations,
            discard: Store.Discard(requestId: attemptID, requestJSON: "{}", expected: snapshot(), phase: .decided))
        let published = try changed(base, [(op + ["phase"], "published"), (op + ["replyJSON"], NSNull()),
            (["session", "checkpoint"], try JSONSerialization.jsonObject(with: JSONEncoder().encode(snapshot(1))))])
        for value in [try record(v1), empty, advance, discard, published] {
            let local = Store(databaseURL: root.appendingPathComponent("\(UUID().uuidString).sqlite"))
            try local.write(value)
            let data = try Data(contentsOf: local.url)
            XCTAssertThrowsError(try Store.ownedSaveFingerprint(value))
            XCTAssertThrowsError(try local.releaseSavedAddsMatching(fingerprint: Store.ownedSaveFingerprint(base)))
            XCTAssertEqual(try Data(contentsOf: local.url), data)
        }
    }

    func testCorruptSidecarAndUnknownKeysAreNeverReleased() throws {
        let fingerprint = try Store.ownedSaveFingerprint(record())
        for data in [Data("corrupt evidence".utf8), try JSONSerialization.data(withJSONObject: object(record()).merging(["unknown": 1]) { _, b in b })] {
            try data.write(to: sidecar.url)
            try assertSidecarRetained { try sidecar.releaseSavedAddsMatching(fingerprint: fingerprint) }
        }
    }

    func testFIFOAndSymlinkSidecarsRefuseWithoutTouchingEntryOrDestination() throws {
        let fingerprint = try Store.ownedSaveFingerprint(record())
        XCTAssertEqual(Darwin.mkfifo(sidecar.url.path, mode_t(0o600)), 0)
        let inode = try identity(sidecar.url), start = ProcessInfo.processInfo.systemUptime
        XCTAssertThrowsError(try sidecar.releaseSavedAddsMatching(fingerprint: fingerprint))
        XCTAssertLessThan(ProcessInfo.processInfo.systemUptime - start, 2)
        XCTAssertEqual(try identity(sidecar.url), inode)
        try FileManager.default.removeItem(at: sidecar.url)
        let target = root.appendingPathComponent("outside")
        let data = try JSONEncoder().encode(record()); try data.write(to: target)
        try FileManager.default.createSymbolicLink(at: sidecar.url, withDestinationURL: target)
        XCTAssertThrowsError(try sidecar.releaseSavedAddsMatching(fingerprint: fingerprint))
        XCTAssertEqual(try Data(contentsOf: target), data)
        XCTAssertEqual(try FileManager.default.destinationOfSymbolicLink(atPath: sidecar.url.path), target.path)
    }

    func testFingerprintRejectsActualEncodedOverflowEvenWhenRawFieldsFit() throws {
        let base = record(), prepared = "{\"raw\":\"" + String(repeating: "\\\\", count: 600_000) + "\"}"
        var operations: [Store.Operation] = []
        for index in 1...4 {
            let op = try changed(base, [(["operations", "0", "requestId"], String(format: "550e8400-e29b-41d4-a716-%012d", index)),
                (["operations", "0", "preparedJSON"], prepared), (["operations", "0", "before", "generation"], index),
                (["operations", "0", "after", "generation"], index + 1), (["session", "checkpoint", "generation"], index + 1)])
            operations.append(op.operations[0])
        }
        let overflow = Store.Record(version: 2, session: Store.Session(sessionID: session, taskID: "task",
            state: .active, checkpoint: snapshot(5)), operations: operations)
        XCTAssertGreaterThan(try JSONEncoder().encode(overflow).count, Store.maximumBytes)
        XCTAssertThrowsError(try Store.ownedSaveFingerprint(overflow))
        XCTAssertFalse(FileManager.default.fileExists(atPath: sidecar.url.path))
    }

    func testOwnedOperationsNeverModifyBorrowedSourcePublishedTargetOrDatabase() throws {
        let urls = [try XCTUnwrap(database), root.appendingPathComponent("source-cache"), root.appendingPathComponent("published-target")]
        for url in urls { try Data("sentinel \(url.lastPathComponent)".utf8).write(to: url) }
        let evidence = try urls.map { try Data(contentsOf: $0) }, identities = try urls.map { try identity($0) }
        let expected = snapshot(), pending = try attempt()
        try sidecar.write(record()); try editor.checkpoint(expected)
        try editor.freezeOwnedSaveMatching(expected: expected, attempt: pending)
        try editor.thawOwnedSaveMatching(expected: expected, attempt: pending)
        try editor.freezeOwnedSaveMatching(expected: expected, attempt: pending)
        try editor.removeOwnedSaveMatching(expected: expected, attempt: pending)
        try sidecar.releaseSavedAddsMatching(fingerprint: Store.ownedSaveFingerprint(record()))
        for index in urls.indices {
            XCTAssertEqual(try Data(contentsOf: urls[index]), evidence[index])
            XCTAssertEqual(try identity(urls[index]), identities[index])
        }
    }

    func testPermissionFailureRetainsFrozenEvidenceThenColdRetrySucceeds() throws {
        if Darwin.geteuid() == 0 { throw XCTSkip("Actual permission refusal requires an unprivileged process") }
        let expected = snapshot(), pending = try attempt()
        try editor.checkpoint(expected); try editor.freezeOwnedSaveMatching(expected: expected, attempt: pending)
        try sidecar.write(record())
        let fingerprint = try Store.ownedSaveFingerprint(record())
        XCTAssertEqual(Darwin.chmod(root.path, mode_t(0o500)), 0)
        defer { _ = Darwin.chmod(root.path, mode_t(0o700)) }
        try assertEditorRetained { try editor.thawOwnedSaveMatching(expected: expected, attempt: pending) }
        try assertEditorRetained { try editor.removeOwnedSaveMatching(expected: expected, attempt: pending) }
        try assertSidecarRetained { try sidecar.releaseSavedAddsMatching(fingerprint: fingerprint) }
        XCTAssertEqual(Darwin.chmod(root.path, mode_t(0o700)), 0)
        try EditorDraftStore(databaseURL: database).removeOwnedSaveMatching(expected: expected, attempt: pending)
        try Store(databaseURL: database).releaseSavedAddsMatching(fingerprint: fingerprint)
        XCTAssertNil(try editor.read()); XCTAssertNil(try sidecar.read())
    }
}
