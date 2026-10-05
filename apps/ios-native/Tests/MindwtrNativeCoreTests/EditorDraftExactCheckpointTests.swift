import XCTest
import Foundation
import Darwin
@testable import MindwtrNativeCore

final class EditorDraftExactCheckpointTests: XCTestCase {
    private var root: URL!
    private var database: URL!
    private var store: EditorDraftStore!
    private let session = "550e8400-e29b-41d4-a716-446655440000"
    private let otherSession = "550e8400-e29b-41d4-a716-446655440001"

    override func setUpWithError() throws {
        let checkout = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let fixture = checkout.appendingPathComponent(".build/task222-fixtures/\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: fixture, withIntermediateDirectories: true)
        guard let physical = Darwin.realpath(fixture.path, nil) else { throw EditorDraftStoreError.corrupt }
        defer { Darwin.free(physical) }
        root = URL(fileURLWithPath: String(cString: physical), isDirectory: true)
        database = root.appendingPathComponent("mindwtr.sqlite")
        store = EditorDraftStore(databaseURL: database)
    }

    override func tearDownWithError() throws {
        store = nil
        if let root { try FileManager.default.removeItem(at: root) }
    }

    private func snapshot(_ generation: Int, payload: String = "{\"opaque\":\"before\"}",
                          sessionID: String? = nil, taskID: String = "task-exact") -> EditorDraftSnapshot {
        EditorDraftSnapshot(sessionID: sessionID ?? session, taskID: taskID, generation: generation, payloadJSON: payload)
    }
    private func cold() -> EditorDraftStore { EditorDraftStore(databaseURL: database) }
    private func fileBytes() throws -> Data { try Data(contentsOf: store.url) }
    private func fileIdentity() throws -> String {
        var value = stat()
        guard Darwin.lstat(store.url.path, &value) == 0 else { throw EditorDraftStoreError.corrupt }
        return "\(UInt64(value.st_dev)):\(UInt64(value.st_ino))"
    }
    private func refused(_ body: () throws -> Void, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertThrowsError(try body(), file: file, line: line) { error in
            XCTAssertTrue(error is HostFailure || error is EditorDraftStoreError, file: file, line: line)
        }
    }
    private func assertUnchanged(_ bytes: Data, _ identity: String,
                                 file: StaticString = #filePath, line: UInt = #line) throws {
        XCTAssertEqual(try fileBytes(), bytes, file: file, line: line)
        XCTAssertEqual(try fileIdentity(), identity, file: file, line: line)
    }

    func testExactCheckpointColdReplayIsIdempotentWithoutRewriting() throws {
        let before = snapshot(1), after = snapshot(2, payload: "{\"opaque\":\"after + 世界\"}")
        try store.checkpoint(before)
        try store.checkpointMatching(before: before, after: after)
        let read = try XCTUnwrap(cold().read())
        XCTAssertEqual(read.snapshot, after)
        XCTAssertNil(read.attempt)
        let bytes = try fileBytes(), identity = try fileIdentity()
        try cold().checkpointMatching(before: before, after: after)
        try assertUnchanged(bytes, identity)
        XCTAssertEqual(try cold().read()?.snapshot, after)
    }

    func testSameGenerationDifferentBeforePayloadRefusesAndKeepsCheckpoint() throws {
        let stored = snapshot(1)
        try store.checkpoint(stored)
        let bytes = try fileBytes(), identity = try fileIdentity()
        let stale = snapshot(1, payload: "{\"opaque\":\"different\"}")
        refused { try self.cold().checkpointMatching(before: stale, after: self.snapshot(2)) }
        try assertUnchanged(bytes, identity)
        XCTAssertEqual(try cold().read()?.snapshot, stored)
    }

    func testSameGenerationDifferentAfterPayloadCannotClaimReplay() throws {
        let before = snapshot(1), after = snapshot(2, payload: "{\"opaque\":\"actual result\"}")
        try store.checkpoint(before)
        try store.checkpointMatching(before: before, after: after)
        let bytes = try fileBytes(), identity = try fileIdentity()
        refused { try self.cold().checkpointMatching(before: before, after: self.snapshot(2, payload: "{\"opaque\":\"other result\"}")) }
        try assertUnchanged(bytes, identity)
    }

    func testOpaqueJSONSerializationAndUnicodeDifferencesAreExact() throws {
        let variants = [("{\"text\":\"é\"}", "{\"text\":\"e\u{301}\"}"),
                        ("{\"a\":1,\"b\":2}", "{\"b\":2,\"a\":1}"),
                        ("{\"a\":1}", "{ \"a\": 1 }")]
        for (index, values) in variants.enumerated() {
            let local = EditorDraftStore(databaseURL: root.appendingPathComponent("opaque-\(index).sqlite"))
            let actual = snapshot(1, payload: values.0), stale = snapshot(1, payload: values.1)
            try local.checkpoint(actual)
            let bytes = try Data(contentsOf: local.url)
            refused { try local.checkpointMatching(before: stale, after: self.snapshot(2)) }
            refused { try local.discardMatching(expected: stale) }
            XCTAssertEqual(try Data(contentsOf: local.url), bytes)
            XCTAssertTrue(try XCTUnwrap(local.read()).snapshot.payloadJSON.utf8.elementsEqual(actual.payloadJSON.utf8))
        }
    }

    func testNewerCheckpointSurvivesOldCASReplayAndDiscard() throws {
        let before = snapshot(1), after = snapshot(2), newest = snapshot(3, payload: "{\"edit\":\"newer\"}")
        try store.checkpoint(before)
        try store.checkpointMatching(before: before, after: after)
        try cold().checkpoint(newest)
        let bytes = try fileBytes(), identity = try fileIdentity()
        refused { try self.cold().checkpointMatching(before: before, after: after) }
        refused { try self.cold().discardMatching(expected: after) }
        try assertUnchanged(bytes, identity)
        XCTAssertEqual(try cold().read()?.snapshot, newest)
    }

    func testWrongSessionAndTaskRefuseWithoutWritingOrDiscarding() throws {
        let before = snapshot(1), after = snapshot(2)
        try store.checkpoint(before)
        let bytes = try fileBytes(), identity = try fileIdentity()
        for (wrongBefore, wrongAfter) in [(snapshot(1, sessionID: otherSession), snapshot(2, sessionID: otherSession)),
                                         (snapshot(1, taskID: "other-task"), snapshot(2, taskID: "other-task"))] {
            refused { try self.cold().checkpointMatching(before: wrongBefore, after: wrongAfter) }
            refused { try self.cold().discardMatching(expected: wrongBefore) }
            try assertUnchanged(bytes, identity)
        }
        refused { try self.cold().checkpointMatching(before: before, after: self.snapshot(2, sessionID: self.otherSession)) }
        refused { try self.cold().checkpointMatching(before: before, after: self.snapshot(2, taskID: "other-task")) }
        try assertUnchanged(bytes, identity)
        try cold().checkpointMatching(before: before, after: after)
        XCTAssertEqual(try cold().read()?.snapshot, after)
    }

    func testTaskIdentityUnicodeDifferencesCannotMatchOrTransition() throws {
        let before = snapshot(1, taskID: "task-é")
        try store.checkpoint(before)
        let bytes = try fileBytes(), identity = try fileIdentity()
        let other = snapshot(1, taskID: "task-e\u{301}")
        refused { try self.cold().checkpointMatching(before: other, after: self.snapshot(2, taskID: "task-e\u{301}")) }
        refused { try self.cold().checkpointMatching(before: before, after: self.snapshot(2, taskID: "task-e\u{301}")) }
        refused { try self.cold().discardMatching(expected: other) }
        try assertUnchanged(bytes, identity)
    }

    func testPendingSaveRefusesMatchingCheckpointAndDiscardAndKeepsAttempt() throws {
        let before = snapshot(1), after = snapshot(2)
        try store.checkpoint(before)
        let attempt = try store.freeze(sessionID: session, generation: 1, method: "saveDraft", argumentsJSON: "[\"{}\"]")
        let bytes = try fileBytes(), identity = try fileIdentity()
        refused { try self.cold().checkpointMatching(before: before, after: after) }
        refused { try self.cold().discardMatching(expected: before) }
        try assertUnchanged(bytes, identity)
        let saved = try XCTUnwrap(cold().read())
        XCTAssertEqual(saved.snapshot, before)
        XCTAssertEqual(saved.attempt, attempt)
    }

    func testAlreadyAfterButFrozenSaveCannotClaimCheckpointReplay() throws {
        let before = snapshot(1), after = snapshot(2)
        try store.checkpoint(after)
        let attempt = try store.freeze(sessionID: session, generation: 2, method: "checklistSave", argumentsJSON: "[\"{}\"]")
        let bytes = try fileBytes(), identity = try fileIdentity()
        refused { try self.cold().checkpointMatching(before: before, after: after) }
        refused { try self.cold().discardMatching(expected: after) }
        try assertUnchanged(bytes, identity)
        XCTAssertEqual(try cold().read()?.attempt, attempt)
    }

    func testAbsentCheckpointCannotBeCreatedByExactCAS() throws {
        refused { try self.store.checkpointMatching(before: self.snapshot(1), after: self.snapshot(2)) }
        XCTAssertNil(try cold().read())
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.url.path))
    }

    func testExactDiscardColdReplayIsIdempotentAndRemovesOnlyDraftLeaf() throws {
        let expected = snapshot(7)
        let sentinel = root.appendingPathComponent("other-private-file")
        try Data("preserve".utf8).write(to: sentinel)
        try store.checkpoint(expected)
        try cold().discardMatching(expected: expected)
        XCTAssertNil(try cold().read())
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.url.path))
        try cold().discardMatching(expected: expected)
        XCTAssertNil(try cold().read())
        XCTAssertEqual(try Data(contentsOf: sentinel), Data("preserve".utf8))
    }

    func testGenerationMustAdvanceExactlyOneAndOverflowRefuses() throws {
        let before = snapshot(1)
        try store.checkpoint(before)
        let bytes = try fileBytes(), identity = try fileIdentity()
        for generation in [1, 3, 10] {
            refused { try self.cold().checkpointMatching(before: before, after: self.snapshot(generation)) }
            try assertUnchanged(bytes, identity)
        }
        let maximum = snapshot(Int.max)
        let maximumStore = EditorDraftStore(databaseURL: root.appendingPathComponent("maximum.sqlite"))
        try maximumStore.checkpoint(maximum)
        let maximumBytes = try Data(contentsOf: maximumStore.url)
        for generation in [1, Int.max] {
            refused { try maximumStore.checkpointMatching(before: maximum, after: self.snapshot(generation)) }
            XCTAssertEqual(try Data(contentsOf: maximumStore.url), maximumBytes)
        }
    }

    func testMaximumNonOverflowingGenerationCanAdvanceAndReplay() throws {
        let before = snapshot(Int.max - 1), after = snapshot(Int.max)
        try store.checkpoint(before)
        try store.checkpointMatching(before: before, after: after)
        XCTAssertEqual(try cold().read()?.snapshot, after)
        let bytes = try fileBytes(), identity = try fileIdentity()
        try cold().checkpointMatching(before: before, after: after)
        try assertUnchanged(bytes, identity)
    }

    func testInvalidSnapshotsAreValidatedBeforeAnyMutationOrMissingDiscardNoop() throws {
        let before = snapshot(1), after = snapshot(2)
        let wrongVersionObject: [String: Any] = ["version": 2, "sessionID": session, "taskID": "task-exact",
                                               "generation": 1, "payloadJSON": "{}"]
        let wrongVersion = try JSONDecoder().decode(EditorDraftSnapshot.self,
            from: JSONSerialization.data(withJSONObject: wrongVersionObject))
        let invalid = [wrongVersion, snapshot(0), snapshot(-1), snapshot(1, sessionID: "invalid-session"),
                       snapshot(1, sessionID: session.uppercased()), snapshot(1, taskID: ""),
                       snapshot(1, taskID: String(repeating: "x", count: 501)),
                       snapshot(1, payload: "[]"), snapshot(1, payload: "{broken"),
                       snapshot(1, payload: "{\"x\":\"" + String(repeating: "x", count: 1_000_000) + "\"}")]
        try store.checkpoint(before)
        let bytes = try fileBytes(), identity = try fileIdentity()
        let absent = EditorDraftStore(databaseURL: root.appendingPathComponent("absent.sqlite"))
        for value in invalid {
            refused { try self.cold().checkpointMatching(before: value, after: after) }
            refused { try self.cold().checkpointMatching(before: before, after: value) }
            refused { try self.cold().discardMatching(expected: value) }
            refused { try absent.discardMatching(expected: value) }
            try assertUnchanged(bytes, identity)
            XCTAssertFalse(FileManager.default.fileExists(atPath: absent.url.path))
        }
    }

    func testCorruptLeafRefusesCASAndDiscardWithoutRemovingEvidence() throws {
        let corrupt = Data("{\"snapshot\":broken evidence}".utf8)
        try corrupt.write(to: store.url)
        let identity = try fileIdentity()
        refused { try self.cold().checkpointMatching(before: self.snapshot(1), after: self.snapshot(2)) }
        refused { try self.cold().discardMatching(expected: self.snapshot(1)) }
        try assertUnchanged(corrupt, identity)
    }

    func testSymlinkLeafRefusesWithoutChangingOrRemovingTarget() throws {
        let target = root.appendingPathComponent("private-target")
        let data = Data("private evidence".utf8)
        try data.write(to: target)
        try FileManager.default.createSymbolicLink(at: store.url, withDestinationURL: target)
        let identity = try fileIdentity()
        refused { try self.cold().checkpointMatching(before: self.snapshot(1), after: self.snapshot(2)) }
        refused { try self.cold().discardMatching(expected: self.snapshot(1)) }
        XCTAssertEqual(try fileIdentity(), identity)
        XCTAssertEqual(try FileManager.default.destinationOfSymbolicLink(atPath: store.url.path), target.path)
        XCTAssertEqual(try Data(contentsOf: target), data)
    }

    func testOversizeAndDirectoryLeafRefuseWithoutReplacementOrRemoval() throws {
        let oversized = Data(repeating: 0x61, count: 3_000_001)
        try oversized.write(to: store.url)
        let identity = try fileIdentity()
        refused { try self.cold().checkpointMatching(before: self.snapshot(1), after: self.snapshot(2)) }
        refused { try self.cold().discardMatching(expected: self.snapshot(1)) }
        try assertUnchanged(oversized, identity)
        try FileManager.default.removeItem(at: store.url)
        try FileManager.default.createDirectory(at: store.url, withIntermediateDirectories: false)
        let nested = store.url.appendingPathComponent("evidence")
        try Data("preserve nested".utf8).write(to: nested)
        let directoryIdentity = try fileIdentity()
        refused { try self.cold().checkpointMatching(before: self.snapshot(1), after: self.snapshot(2)) }
        refused { try self.cold().discardMatching(expected: self.snapshot(1)) }
        XCTAssertEqual(try fileIdentity(), directoryIdentity)
        XCTAssertEqual(try Data(contentsOf: nested), Data("preserve nested".utf8))
    }

    func testLegacyCheckpointAndDiscardSemanticsRemainAvailable() throws {
        let first = snapshot(1), later = snapshot(9)
        try store.checkpoint(first)
        try store.checkpoint(later)
        XCTAssertEqual(try cold().read()?.snapshot, later)
        try cold().discard(sessionID: session)
        XCTAssertNil(try cold().read())
        refused { try self.cold().discard(sessionID: self.session) }
        try cold().discardMatching(expected: later)
    }
}
