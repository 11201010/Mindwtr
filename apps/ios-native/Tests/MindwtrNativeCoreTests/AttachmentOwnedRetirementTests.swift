import XCTest
import Foundation
import Darwin
import AttachmentFileInstallerEngine
@testable import MindwtrNativeCore

final class AttachmentOwnedRetirementTests: XCTestCase {
    private typealias Proof = NativeAttachmentFiles.PublishedAttachmentProof
    private var root: URL!
    private var files: NativeAttachmentFiles!
    private var target: URL!
    private var source: URL!
    private var sibling: URL!
    private var proof: Proof!
    private let contents = Data("recorded published bytes + 世界".utf8)
    private let siblingBytes = Data("unrequested sibling".utf8)
    private enum Stop: Error { case cancelled, fault }

    override func setUpWithError() throws {
        let checkout = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let fixture = checkout.appendingPathComponent(".build/task229-fixtures/\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: fixture, withIntermediateDirectories: true)
        guard let physical = Darwin.realpath(fixture.path, nil) else { throw NativeAttachmentFilesError.unavailable }
        defer { Darwin.free(physical) }
        root = URL(fileURLWithPath: String(cString: physical), isDirectory: true)
        files = try NativeAttachmentFiles(libraryRoot: root)
        try FileManager.default.createDirectory(at: files.managedRoot, withIntermediateDirectories: false)
        let directories = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(files.directoriesJSON.utf8)) as? [String: String])
        source = try XCTUnwrap(URL(string: XCTUnwrap(directories["cache"]))).appendingPathComponent("source 世界.bin")
        try contents.write(to: source)
        target = files.managedRoot.appendingPathComponent("published 世界.bin")
        sibling = files.managedRoot.appendingPathComponent("untouched.bin")
        try siblingBytes.write(to: sibling)
        proof = try publish(source: source, target: target)
    }

    override func tearDownWithError() throws {
        files = nil
        if let root { try FileManager.default.removeItem(at: root) }
    }

    private func publish(source: URL, target: URL) throws -> Proof {
        let installer = try AttachmentFileInstaller(targetRoot: files.managedRoot, sourceRoots: files.sourceRoots)
        let reserved = try installer.prepareImmutableStage(targetInput: target,
            operationId: UUID().uuidString.lowercased().replacingOccurrences(of: "-", with: ""))
        let stage = NativeAttachmentFiles.ReservedAttachmentStageProof(stageURI: reserved.stagedUrl.absoluteString,
            stagedIdentity: reserved.stagedIdentity, directoryIdentity: reserved.directoryIdentity,
            privateDirectoryIdentity: reserved.privateDirectoryIdentity)
        let content = try files.fillReservedAttachmentStage(sourceProof: files.snapshotCacheSource(source.absoluteString), stageProof: stage)
        guard case .published = try installer.publishImmutable(stagedInput: reserved.stagedUrl, targetInput: target,
            expectedStagedSha256: content.sha256, expectedStagedIdentity: stage.stagedIdentity,
            expectedDirectoryIdentity: stage.directoryIdentity, expectedPrivateDirectoryIdentity: stage.privateDirectoryIdentity) else {
            throw NativeAttachmentFilesError.unavailable
        }
        return try files.verifyPublishedAttachment(targetURI: target.absoluteString, stageProof: stage,
            sha256: content.sha256, size: content.size)
    }

    private func changed(sha: String? = nil, size: Int64? = nil, identity: String? = nil, directory: String? = nil) -> Proof {
        Proof(sha256: sha ?? proof.sha256, size: size ?? proof.size,
              identity: identity ?? proof.identity, directoryIdentity: directory ?? proof.directoryIdentity)
    }
    private func token(_ url: URL) throws -> String {
        var value = stat()
        guard Darwin.lstat(url.path, &value) == 0 else { throw NativeAttachmentFilesError.unavailable }
        return "\(UInt64(value.st_dev)):\(UInt64(value.st_ino))"
    }
    @discardableResult private func retire(check: () throws -> Void = {}) throws -> NativeAttachmentFiles.PublishedAttachmentRetirementOutcome {
        try files.retirePublishedAttachment(targetURI: target.absoluteString, proof: proof, checkCancellation: check)
    }
    private func refused(_ body: () throws -> Void, expected: NativeAttachmentFilesError = .unavailable,
                         file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertThrowsError(try body(), file: file, line: line) { error in
            XCTAssertEqual(error as? NativeAttachmentFilesError, expected, file: file, line: line)
        }
    }
    private func unchanged(file: StaticString = #filePath, line: UInt = #line) throws {
        XCTAssertEqual(try Data(contentsOf: target), contents, file: file, line: line)
        try untouched(file: file, line: line)
    }
    private func untouched(file: StaticString = #filePath, line: UInt = #line) throws {
        XCTAssertEqual(try Data(contentsOf: sibling), siblingBytes, file: file, line: line)
        XCTAssertEqual(try Data(contentsOf: source), contents, file: file, line: line)
    }
    private func replaceManagedRoot() throws -> URL {
        let managed = files.managedRoot, retained = managed.appendingPathExtension("retained")
        try FileManager.default.moveItem(at: managed, to: retained)
        try FileManager.default.createDirectory(at: managed, withIntermediateDirectories: false)
        return retained
    }

    func testOwnedRetirementRemovesOnlyRecordedTargetAndColdRetryAcknowledgesDurableAbsence() throws {
        let names = try FileManager.default.contentsOfDirectory(atPath: files.managedRoot.path).sorted()
        XCTAssertEqual(try retire(), .removed)
        XCTAssertFalse(FileManager.default.fileExists(atPath: target.path))
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: files.managedRoot.path).sorted(), names.filter { $0 != target.lastPathComponent })
        try untouched()
        files = try NativeAttachmentFiles(libraryRoot: root)
        var syncs = 0
        files.beforeRetirementSync = { syncs += 1 }
        XCTAssertEqual(try retire(), .absent)
        XCTAssertEqual(try retire(), .absent)
        XCTAssertEqual(syncs, 2)
        try untouched()
    }

    func testMissingLeafRequiresRecordedRootEvenOnColdOwner() throws {
        try FileManager.default.removeItem(at: target)
        refused { _ = try files.retirePublishedAttachment(targetURI: target.absoluteString, proof: changed(directory: "0:0")) }
        let retained = try replaceManagedRoot()
        files = try NativeAttachmentFiles(libraryRoot: root)
        refused { _ = try retire() }
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: files.managedRoot.path), [])
        XCTAssertEqual(try Data(contentsOf: retained.appendingPathComponent(sibling.lastPathComponent)), siblingBytes)
    }

    func testMissingManagedParentNeverRecreatesItOrReturnsAbsent() throws {
        try FileManager.default.removeItem(at: files.managedRoot)
        refused { _ = try retire() }
        XCTAssertFalse(FileManager.default.fileExists(atPath: files.managedRoot.path))
        XCTAssertEqual(try Data(contentsOf: source), contents)
    }

    func testMissingDocumentsAncestorNeverRecreatesItOrReturnsAbsent() throws {
        let documents = files.managedRoot.deletingLastPathComponent()
        let retained = root.appendingPathComponent("retained-documents", isDirectory: true)
        try FileManager.default.moveItem(at: documents, to: retained)
        refused { _ = try retire() }
        XCTAssertFalse(FileManager.default.fileExists(atPath: documents.path))
        XCTAssertEqual(try Data(contentsOf: retained.appendingPathComponent("attachments").appendingPathComponent(target.lastPathComponent)), contents)
    }

    func testSameHashReplacementInodeIsNeverAdoptedOrDeleted() throws {
        let retained = files.managedRoot.appendingPathComponent("retained-original.bin")
        try FileManager.default.moveItem(at: target, to: retained)
        try contents.write(to: target)
        XCTAssertNotEqual(try token(target), proof.identity)
        refused { _ = try retire() }
        try unchanged()
        XCTAssertEqual(try Data(contentsOf: retained), contents)
    }

    func testChangedSameInodeBytesRefuseWithoutDeletion() throws {
        let replacement = Data(repeating: 0x78, count: contents.count)
        let handle = try FileHandle(forWritingTo: target)
        try handle.write(contentsOf: replacement); try handle.close()
        XCTAssertEqual(try token(target), proof.identity)
        refused { _ = try retire() }
        XCTAssertEqual(try Data(contentsOf: target), replacement)
        try untouched()
    }

    func testWrongDigestSizeAndRecordedIdentitiesRefusePresentFile() throws {
        for wrong in [changed(sha: String(repeating: "0", count: 64)), changed(size: proof.size + 1),
                      changed(identity: "0:0"), changed(directory: "0:0")] {
            refused { _ = try files.retirePublishedAttachment(targetURI: target.absoluteString, proof: wrong) }
            try unchanged()
        }
    }

    func testMalformedDigestSizeAndCanonicalTokensRejectBeforeFilesystemMutation() throws {
        for wrong in [changed(sha: "invalid"), changed(sha: String(repeating: "A", count: 64)),
                      changed(size: -1), changed(size: 9_007_199_254_740_992), changed(identity: "01:2"),
                      changed(identity: "1:-2"), changed(identity: "1:"), changed(directory: "01:2"),
                      changed(directory: String(repeating: "1", count: 42))] {
            refused({ _ = try files.retirePublishedAttachment(targetURI: target.absoluteString, proof: wrong) }, expected: .invalidRequest)
            try unchanged()
        }
    }

    func testSymlinkTargetRefusesAndKeepsReferencedBytes() throws {
        let retained = files.managedRoot.appendingPathComponent("retained-original.bin")
        try FileManager.default.moveItem(at: target, to: retained)
        try FileManager.default.createSymbolicLink(at: target, withDestinationURL: retained)
        refused { _ = try retire() }
        XCTAssertEqual(try FileManager.default.destinationOfSymbolicLink(atPath: target.path), retained.path)
        XCTAssertEqual(try Data(contentsOf: retained), contents)
        try untouched()
    }

    func testHardLinkedTargetRefusesBothNamesWithoutDeletion() throws {
        let linked = files.managedRoot.appendingPathComponent("second-link.bin")
        XCTAssertEqual(Darwin.link(target.path, linked.path), 0)
        refused { _ = try retire() }
        try unchanged()
        XCTAssertEqual(try Data(contentsOf: linked), contents)
    }

    func testDirectoryAndNonblockingFIFORefuseWithoutDeletion() throws {
        let retained = files.managedRoot.appendingPathComponent("retained-original.bin")
        try FileManager.default.moveItem(at: target, to: retained)
        try FileManager.default.createDirectory(at: target, withIntermediateDirectories: false)
        refused { _ = try retire() }
        XCTAssertTrue(FileManager.default.fileExists(atPath: target.path))
        try FileManager.default.removeItem(at: target)
        XCTAssertEqual(Darwin.mkfifo(target.path, mode_t(0o600)), 0)
        refused { _ = try retire() }
        var named = stat()
        XCTAssertEqual(Darwin.lstat(target.path, &named), 0)
        XCTAssertEqual(named.st_mode & mode_t(S_IFMT), mode_t(S_IFIFO))
        XCTAssertEqual(try Data(contentsOf: retained), contents)
        try untouched()
    }

    func testCacheNestedPrivateHiddenControlAndExternalPathsReject() throws {
        let hidden = files.managedRoot.appendingPathComponent(".mindwtr-attachment-installer.lock")
        let originalLock = try Data(contentsOf: hidden)
        for uri in [source.absoluteString, files.managedRoot.absoluteString,
                    files.managedRoot.appendingPathComponent("nested/file.bin").absoluteString,
                    files.managedRoot.appendingPathComponent(".mindwtr-install-\(String(repeating: "a", count: 32)).candidate/stage").absoluteString,
                    files.managedRoot.appendingPathComponent(".hidden.bin").absoluteString, hidden.absoluteString,
                    root.appendingPathComponent("external.bin").absoluteString, "https://example.test/file",
                    files.managedRoot.absoluteString + "%2e%2e/file", target.absoluteString + "?input=secret"] {
            refused({ _ = try files.retirePublishedAttachment(targetURI: uri, proof: proof) }, expected: .invalidRequest)
        }
        XCTAssertEqual(try Data(contentsOf: hidden), originalLock)
        try unchanged()
    }

    func testManagedRootReplacementDuringHashRefusesAndPreservesBothRoots() throws {
        var calls = 0
        var retained: URL?
        refused {
            _ = try retire {
                calls += 1
                if calls == 3 { retained = try replaceManagedRoot(); try contents.write(to: target) }
            }
        }
        let saved = try XCTUnwrap(retained)
        XCTAssertEqual(try Data(contentsOf: saved.appendingPathComponent(target.lastPathComponent)), contents)
        XCTAssertEqual(try Data(contentsOf: target), contents)
    }

    func testDocumentsAncestorReplacementDuringHashRefusesWithoutDeletingOriginal() throws {
        let documents = files.managedRoot.deletingLastPathComponent()
        let retained = root.appendingPathComponent("retained-documents", isDirectory: true)
        var calls = 0
        refused {
            _ = try retire {
                calls += 1
                if calls == 3 {
                    try FileManager.default.moveItem(at: documents, to: retained)
                    try FileManager.default.createDirectory(at: documents, withIntermediateDirectories: false)
                }
            }
        }
        XCTAssertEqual(try Data(contentsOf: retained.appendingPathComponent("attachments").appendingPathComponent(target.lastPathComponent)), contents)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: documents.path), [])
    }

    func testNamedReplacementDuringHashRefusesAndKeepsReplacement() throws {
        let retained = files.managedRoot.appendingPathComponent("retained-original.bin")
        var calls = 0
        refused {
            _ = try retire {
                calls += 1
                if calls == 3 { try FileManager.default.moveItem(at: target, to: retained); try contents.write(to: target) }
            }
        }
        try unchanged()
        XCTAssertEqual(try Data(contentsOf: retained), contents)
    }

    func testSameInodeMutationDuringHashRefusesAndKeepsChangedBytes() throws {
        var calls = 0
        refused {
            _ = try retire {
                calls += 1
                if calls == 3 {
                    let handle = try FileHandle(forWritingTo: target)
                    try handle.write(contentsOf: Data([0x78])); try handle.close()
                }
            }
        }
        XCTAssertEqual(try token(target), proof.identity)
        XCTAssertEqual(try Data(contentsOf: target).first, 0x78)
        try untouched()
    }

    func testPreunlinkNamedReplacementRefusesAfterTheFinalHook() throws {
        let retained = files.managedRoot.appendingPathComponent("retained-original.bin")
        files.beforeRetirementUnlink = {
            try FileManager.default.moveItem(at: self.target, to: retained)
            try self.contents.write(to: self.target)
        }
        refused { _ = try retire() }
        try unchanged()
        XCTAssertEqual(try Data(contentsOf: retained), contents)
    }

    func testPreunlinkManagedRootReplacementRefusesAfterTheFinalHook() throws {
        var retained: URL?
        files.beforeRetirementUnlink = { retained = try self.replaceManagedRoot(); try self.contents.write(to: self.target) }
        refused { _ = try retire() }
        XCTAssertEqual(try Data(contentsOf: XCTUnwrap(retained).appendingPathComponent(target.lastPathComponent)), contents)
        XCTAssertEqual(try Data(contentsOf: target), contents)
    }

    func testCancellationBeforeInspectionPreservesAllBytes() throws {
        XCTAssertThrowsError(try retire { throw Stop.cancelled }) { XCTAssertTrue($0 is Stop) }
        try unchanged()
    }

    func testCancellationDuringHashPreservesAllBytes() throws {
        var calls = 0
        XCTAssertThrowsError(try retire { calls += 1; if calls == 3 { throw Stop.cancelled } }) { XCTAssertTrue($0 is Stop) }
        XCTAssertEqual(calls, 3)
        try unchanged()
    }

    func testCancellationImmediatelyBeforeUnlinkPreservesAllBytes() throws {
        var cancelled = false, unlinked = false
        files.beforeRetirementUnlink = { cancelled = true }
        files.afterRetirementUnlink = { unlinked = true }
        XCTAssertThrowsError(try retire { if cancelled { throw Stop.cancelled } }) { XCTAssertTrue($0 is Stop) }
        XCTAssertFalse(unlinked)
        try unchanged()
    }

    func testCancellationAfterUnlinkReturnsActualDurableRemovedOutcome() throws {
        var cancelled = false, checks = 0, checksAtUnlink = 0, synced = false
        files.afterRetirementUnlink = { cancelled = true; checksAtUnlink = checks }
        files.beforeRetirementSync = { synced = true }
        XCTAssertEqual(try retire { checks += 1; if cancelled { throw Stop.cancelled } }, .removed)
        XCTAssertEqual(checks, checksAtUnlink)
        XCTAssertTrue(synced)
        XCTAssertFalse(FileManager.default.fileExists(atPath: target.path))
        try untouched()
    }

    func testPostunlinkSyncFaultIsFixedUncertainAndColdMissingRetrySyncsAgain() throws {
        files.beforeRetirementSync = { throw Stop.fault }
        refused { _ = try retire() }
        XCTAssertFalse(FileManager.default.fileExists(atPath: target.path))
        try untouched()
        files = try NativeAttachmentFiles(libraryRoot: root)
        var syncs = 0
        files.beforeRetirementSync = { syncs += 1 }
        XCTAssertEqual(try retire(), .absent)
        XCTAssertEqual(syncs, 1)
        try untouched()
    }

    func testLostAcknowledgmentImmediatelyAfterUnlinkRetainsUncertaintyUntilColdAbsentRetry() throws {
        files.afterRetirementUnlink = { throw Stop.fault }
        refused { _ = try retire() }
        XCTAssertFalse(FileManager.default.fileExists(atPath: target.path))
        files = try NativeAttachmentFiles(libraryRoot: root)
        var syncs = 0
        files.beforeRetirementSync = { syncs += 1 }
        XCTAssertEqual(try retire(), .absent)
        XCTAssertEqual(syncs, 1)
        try untouched()
    }

    func testNamedReplacementAfterUnlinkIsKeptAndNeverAcknowledgedAbsent() throws {
        let replacement = Data("new unrelated publication".utf8)
        files.afterRetirementUnlink = { try replacement.write(to: self.target) }
        refused { _ = try retire() }
        XCTAssertEqual(try Data(contentsOf: target), replacement)
        files = try NativeAttachmentFiles(libraryRoot: root)
        refused { _ = try retire() }
        XCTAssertEqual(try Data(contentsOf: target), replacement)
        try untouched()
    }

    func testRootReplacementAfterUnlinkIsUncertainAndColdAbsenceInWrongRootRefuses() throws {
        var retained: URL?
        files.afterRetirementUnlink = { retained = try self.replaceManagedRoot() }
        refused { _ = try retire() }
        files = try NativeAttachmentFiles(libraryRoot: root)
        refused { _ = try retire() }
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: files.managedRoot.path), [])
        XCTAssertEqual(try Data(contentsOf: XCTUnwrap(retained).appendingPathComponent(sibling.lastPathComponent)), siblingBytes)
    }

    func testPreexistingAbsenceStillRefusesReplacementDuringSyncBoundary() throws {
        try FileManager.default.removeItem(at: target)
        files.beforeRetirementSync = { try self.contents.write(to: self.target) }
        refused { _ = try retire() }
        try unchanged()
    }

    func testPreexistingAbsenceSyncFailureCannotBecomeSuccessfulVoid() throws {
        try FileManager.default.removeItem(at: target)
        files.beforeRetirementSync = { throw Stop.fault }
        refused { _ = try retire() }
        var syncs = 0
        files.beforeRetirementSync = { syncs += 1 }
        XCTAssertEqual(try retire(), .absent)
        XCTAssertEqual(syncs, 1)
        try untouched()
    }

    func testStreamingRetirementAboveBridgeByteLimitKeepsSourceAndSiblings() throws {
        let large = source.deletingLastPathComponent().appendingPathComponent("large-source.bin")
        let largeTarget = files.managedRoot.appendingPathComponent("large-publication.bin")
        let bytes = Data(repeating: 0x71, count: 17 * 1024 * 1024)
        try bytes.write(to: large)
        let largeProof = try publish(source: large, target: largeTarget)
        XCTAssertEqual(largeProof.size, Int64(bytes.count))
        XCTAssertEqual(try files.retirePublishedAttachment(targetURI: largeTarget.absoluteString, proof: largeProof), .removed)
        XCTAssertFalse(FileManager.default.fileExists(atPath: largeTarget.path))
        XCTAssertEqual(try Data(contentsOf: large), bytes)
        try unchanged()
    }

    func testRepeatedFailureAndAbsentRetriesCloseRetainedDescriptors() throws {
        func descriptors() -> Set<Int32> {
            var result = Set<Int32>()
            for fd in 0..<Darwin.getdtablesize() where Darwin.fcntl(fd, F_GETFD) != -1 { result.insert(fd) }
            return result
        }
        let before = descriptors()
        for _ in 0..<16 {
            refused { _ = try files.retirePublishedAttachment(targetURI: target.absoluteString, proof: changed(sha: String(repeating: "0", count: 64))) }
        }
        XCTAssertEqual(try retire(), .removed)
        for _ in 0..<16 { XCTAssertEqual(try retire(), .absent) }
        XCTAssertEqual(descriptors(), before)
        try untouched()
    }
}
