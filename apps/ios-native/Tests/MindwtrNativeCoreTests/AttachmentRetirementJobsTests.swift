import XCTest
import Foundation
import Darwin
import CryptoKit
@testable import MindwtrNativeCore

final class AttachmentRetirementJobsTests: XCTestCase {
    private typealias PublishedProof = NativeAttachmentFiles.PublishedAttachmentProof
    private typealias StageProof = NativeAttachmentFiles.ReservedAttachmentStageProof
    private var root: URL!
    private var jobs: NativeAttachmentFileJobs!
    private var managed: URL!
    private var cache: URL!
    private var sibling: URL!
    private var source: URL!
    private let operationID = String(repeating: "b", count: 32)
    private let bytes = Data("recorded attachment 世界".utf8)
    private let siblingBytes = Data("unrequested managed sibling".utf8)
    private let sourceBytes = Data("source cache retained".utf8)

    override func setUpWithError() throws {
        let checkout = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let fixture = checkout.appendingPathComponent(".build/task232-fixtures/\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: fixture, withIntermediateDirectories: true)
        guard let physical = Darwin.realpath(fixture.path, nil) else { throw NativeAttachmentFilesError.unavailable }
        defer { Darwin.free(physical) }
        root = URL(fileURLWithPath: String(cString: physical), isDirectory: true)
        jobs = try NativeAttachmentFileJobs(libraryRoot: root)
        let directories = try object(jobs.directoriesJSON)
        let documents = try XCTUnwrap(URL(string: XCTUnwrap(directories["document"] as? String)))
        cache = try XCTUnwrap(URL(string: XCTUnwrap(directories["cache"] as? String)))
        managed = documents.appendingPathComponent("attachments", isDirectory: true)
        try FileManager.default.createDirectory(at: managed, withIntermediateDirectories: false)
        sibling = managed.appendingPathComponent("sibling.bin")
        source = cache.appendingPathComponent("source.bin")
        try siblingBytes.write(to: sibling)
        try sourceBytes.write(to: source)
    }

    override func tearDownWithError() throws {
        jobs?.shutdown()
        if let root { try FileManager.default.removeItem(at: root) }
    }

    func testPublishedVerifiedRemovalAndColdDurableAbsentHaveExactReplies() throws {
        let (target, proof) = try publication()
        XCTAssertEqual(try status(.retirePublished(targetURI: target.absoluteString, proof: proof)), "removed")
        XCTAssertFalse(FileManager.default.fileExists(atPath: target.path))
        jobs.shutdown()
        jobs = try NativeAttachmentFileJobs(libraryRoot: root)
        XCTAssertEqual(try status(.retirePublished(targetURI: target.absoluteString, proof: proof)), "absent")
        XCTAssertEqual(jobs.next(), "")
        XCTAssertEqual(jobs.counters.jobs, 0); XCTAssertEqual(jobs.counters.bytes, 0)
        try untouched()
    }

    func testPublishedEqualBytesDifferentInodeRetainsBothGenerations() throws {
        let (target, proof) = try publication()
        let retained = cache.appendingPathComponent("retained-publication")
        try FileManager.default.moveItem(at: target, to: retained)
        try bytes.write(to: target)
        XCTAssertEqual(try error(.retirePublished(targetURI: target.absoluteString, proof: proof)), "Attachment file operation is unavailable")
        XCTAssertEqual(try Data(contentsOf: target), bytes)
        XCTAssertEqual(try Data(contentsOf: retained), bytes)
        try untouched()
    }

    func testPublishedHardLinkIsRetainedAtBothNames() throws {
        let (target, proof) = try publication()
        let linked = cache.appendingPathComponent("hardlink")
        XCTAssertEqual(Darwin.link(target.path, linked.path), 0)
        XCTAssertEqual(try error(.retirePublished(targetURI: target.absoluteString, proof: proof)), "Attachment file operation is unavailable")
        XCTAssertEqual(try Data(contentsOf: target), bytes)
        XCTAssertEqual(try Data(contentsOf: linked), bytes)
        try untouched()
    }

    func testPublishedDigestSizeAndIdentityMismatchRetainBytes() throws {
        let (target, proof) = try publication()
        let wrong: [PublishedProof] = [
            PublishedProof(sha256: String(repeating: "0", count: 64), size: proof.size, identity: proof.identity, directoryIdentity: proof.directoryIdentity),
            PublishedProof(sha256: proof.sha256, size: proof.size + 1, identity: proof.identity, directoryIdentity: proof.directoryIdentity),
            PublishedProof(sha256: proof.sha256, size: proof.size, identity: "0:0", directoryIdentity: proof.directoryIdentity)
        ]
        for value in wrong {
            XCTAssertEqual(try error(.retirePublished(targetURI: target.absoluteString, proof: value)), "Attachment file operation is unavailable")
            XCTAssertEqual(try Data(contentsOf: target), bytes)
        }
        try untouched()
    }

    func testPublishedMissingWrongRootCannotBecomeAbsent() throws {
        let (target, proof) = try publication()
        XCTAssertEqual(try status(.retirePublished(targetURI: target.absoluteString, proof: proof)), "removed")
        let wrong = PublishedProof(sha256: proof.sha256, size: proof.size, identity: proof.identity, directoryIdentity: "0:0")
        XCTAssertEqual(try error(.retirePublished(targetURI: target.absoluteString, proof: wrong)), "Attachment file operation is unavailable")
        try untouched()
    }

    func testPublishedMissingManagedRootIsNeverRecreated() throws {
        let (target, proof) = try publication()
        XCTAssertEqual(try status(.retirePublished(targetURI: target.absoluteString, proof: proof)), "removed")
        let retained = root.appendingPathComponent("retained-root", isDirectory: true)
        try FileManager.default.moveItem(at: managed, to: retained)
        XCTAssertEqual(try error(.retirePublished(targetURI: target.absoluteString, proof: proof)), "Attachment file operation is unavailable")
        XCTAssertFalse(FileManager.default.fileExists(atPath: managed.path))
        try untouched(managedRoot: retained)
    }

    func testPublishedSymlinkTargetIsRetainedAndNotFollowed() throws {
        let (target, proof) = try publication()
        try FileManager.default.removeItem(at: target)
        try FileManager.default.createSymbolicLink(at: target, withDestinationURL: sibling)
        XCTAssertEqual(try error(.retirePublished(targetURI: target.absoluteString, proof: proof)), "Attachment file operation is unavailable")
        XCTAssertEqual(try FileManager.default.destinationOfSymbolicLink(atPath: target.path), sibling.path)
        try untouched()
    }

    func testPrivatePartialStageRemovalAndColdMissingPreservePublishedTarget() throws {
        let target = managed.appendingPathComponent("staged.bin")
        let stage = try prepare(target)
        try fill(stage, bytes: Data("partial, no completed content proof".utf8))
        try bytes.write(to: target)
        XCTAssertEqual(try status(.retirePrivateStage(stage: stage, targetURI: target.absoluteString, operationID: operationID)), "removed")
        XCTAssertFalse(FileManager.default.fileExists(atPath: try namespace(stage).path))
        jobs.shutdown()
        jobs = try NativeAttachmentFileJobs(libraryRoot: root)
        XCTAssertEqual(try status(.retirePrivateStage(stage: stage, targetURI: target.absoluteString, operationID: operationID)), "missing")
        XCTAssertEqual(try Data(contentsOf: target), bytes)
        try untouched()
    }

    func testPrivateExactEmptyNamespaceIsRetiredAsMissing() throws {
        let target = managed.appendingPathComponent("staged.bin"), stage = try prepare(target)
        try FileManager.default.removeItem(at: stageURL(stage))
        XCTAssertEqual(try status(.retirePrivateStage(stage: stage, targetURI: target.absoluteString, operationID: operationID)), "missing")
        XCTAssertFalse(FileManager.default.fileExists(atPath: try namespace(stage).path))
        try untouched()
    }

    func testPrivateWrongRecordedRootNamespaceAndStageProofsReturnConflict() throws {
        let target = managed.appendingPathComponent("staged.bin"), stage = try prepare(target)
        try fill(stage, bytes: bytes)
        for field in 0..<3 {
            let wrong = StageProof(stageURI: stage.stageURI,
                stagedIdentity: field == 0 ? "0:0" : stage.stagedIdentity,
                directoryIdentity: field == 1 ? "0:0" : stage.directoryIdentity,
                privateDirectoryIdentity: field == 2 ? "0:0" : stage.privateDirectoryIdentity)
            XCTAssertEqual(try status(.retirePrivateStage(stage: wrong, targetURI: target.absoluteString, operationID: operationID)), "conflict")
            XCTAssertEqual(try Data(contentsOf: stageURL(stage)), bytes)
        }
        try untouched()
    }

    func testPrivateEqualBytesReplacementNamespaceIsNeverAdopted() throws {
        let target = managed.appendingPathComponent("staged.bin"), stage = try prepare(target)
        try fill(stage, bytes: bytes)
        let retained = cache.appendingPathComponent("retained-private", isDirectory: true)
        try FileManager.default.moveItem(at: namespace(stage), to: retained)
        try FileManager.default.createDirectory(at: namespace(stage), withIntermediateDirectories: false)
        try bytes.write(to: stageURL(stage))
        XCTAssertEqual(try status(.retirePrivateStage(stage: stage, targetURI: target.absoluteString, operationID: operationID)), "conflict")
        XCTAssertEqual(try Data(contentsOf: stageURL(stage)), bytes)
        XCTAssertEqual(try Data(contentsOf: retained.appendingPathComponent("stage")), bytes)
        try untouched()
    }

    func testPrivateHardLinkedStageReturnsConflictWithoutUnlink() throws {
        let target = managed.appendingPathComponent("staged.bin"), stage = try prepare(target)
        try fill(stage, bytes: bytes)
        let linked = cache.appendingPathComponent("hardlink")
        XCTAssertEqual(Darwin.link(try stageURL(stage).path, linked.path), 0)
        XCTAssertEqual(try status(.retirePrivateStage(stage: stage, targetURI: target.absoluteString, operationID: operationID)), "conflict")
        XCTAssertEqual(try Data(contentsOf: stageURL(stage)), bytes)
        XCTAssertEqual(try Data(contentsOf: linked), bytes)
        try untouched()
    }

    func testPrivateMissingManagedRootIsNeverRecreated() throws {
        let target = managed.appendingPathComponent("staged.bin"), stage = try prepare(target)
        let retained = root.appendingPathComponent("retained-root", isDirectory: true)
        try FileManager.default.moveItem(at: managed, to: retained)
        XCTAssertEqual(try error(.retirePrivateStage(stage: stage, targetURI: target.absoluteString, operationID: operationID)), "Attachment file operation is unavailable")
        XCTAssertFalse(FileManager.default.fileExists(atPath: managed.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: retained.appendingPathComponent(try namespace(stage).lastPathComponent).appendingPathComponent("stage").path))
        try untouched(managedRoot: retained)
    }

    func testPrivateReplacedRootWithMissingNamespaceReturnsConflict() throws {
        let target = managed.appendingPathComponent("staged.bin"), stage = try prepare(target)
        XCTAssertEqual(try status(.retirePrivateStage(stage: stage, targetURI: target.absoluteString, operationID: operationID)), "removed")
        let retained = root.appendingPathComponent("retained-root", isDirectory: true)
        try FileManager.default.moveItem(at: managed, to: retained)
        try FileManager.default.createDirectory(at: managed, withIntermediateDirectories: false)
        XCTAssertEqual(try status(.retirePrivateStage(stage: stage, targetURI: target.absoluteString, operationID: operationID)), "conflict")
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: managed.path), [])
        try untouched(managedRoot: retained)
    }

    func testQueuedCancellationBehindLatchExecutesNeitherRetirement() throws {
        let (target, proof) = try publication()
        let stageTarget = managed.appendingPathComponent("staged.bin"), stage = try prepare(stageTarget)
        let entered = DispatchSemaphore(value: 0), release = DispatchSemaphore(value: 0)
        defer { release.signal() }
        jobs.beforeWork = { _, _ in entered.signal(); release.wait() }
        let first = try raw(["op": "barrier"])
        XCTAssertEqual(entered.wait(timeout: .now() + 5), .success)
        let publishedID = try jobs.submitDraft(.retirePublished(targetURI: target.absoluteString, proof: proof))
        let stageID = try jobs.submitDraft(.retirePrivateStage(stage: stage, targetURI: stageTarget.absoluteString, operationID: operationID))
        jobs.abort(publishedID); jobs.abort(stageID)
        release.signal(); jobs.drain(); jobs.beforeWork = nil
        XCTAssertNil(try takeRaw(first)["error"])
        XCTAssertEqual(try takeDraft(publishedID)["error"] as? String, "Attachment file operation was cancelled")
        XCTAssertEqual(try takeDraft(stageID)["error"] as? String, "Attachment file operation was cancelled")
        XCTAssertEqual(try Data(contentsOf: target), bytes)
        XCTAssertTrue(FileManager.default.fileExists(atPath: try stageURL(stage).path))
        XCTAssertEqual(jobs.counters.jobs, 0); XCTAssertEqual(jobs.counters.bytes, 0)
        try untouched()
    }

    func testPublishedCancellationBeforeUnlinkPreservesExactBytes() throws {
        let (target, proof) = try publication()
        let entered = DispatchSemaphore(value: 0), release = DispatchSemaphore(value: 0)
        defer { release.signal() }
        jobs.beforeRetirementUnlink = { entered.signal(); release.wait() }
        let id = try jobs.submitDraft(.retirePublished(targetURI: target.absoluteString, proof: proof))
        XCTAssertEqual(entered.wait(timeout: .now() + 5), .success)
        jobs.abort(id); release.signal()
        XCTAssertEqual(try takeDraft(id)["error"] as? String, "Attachment file operation was cancelled")
        XCTAssertEqual(try Data(contentsOf: target), bytes)
        jobs.beforeRetirementUnlink = nil
        XCTAssertEqual(jobs.counters.bytes, 0)
        try untouched()
    }

    func testPublishedCancellationAfterUnlinkDrainsToActualCompletedOutcome() throws {
        let (target, proof) = try publication()
        let entered = DispatchSemaphore(value: 0), release = DispatchSemaphore(value: 0), drained = DispatchSemaphore(value: 0)
        defer { release.signal() }
        jobs.afterRetirementUnlink = { entered.signal(); release.wait() }
        let id = try jobs.submitDraft(.retirePublished(targetURI: target.absoluteString, proof: proof))
        XCTAssertEqual(entered.wait(timeout: .now() + 5), .success)
        XCTAssertFalse(FileManager.default.fileExists(atPath: target.path))
        let owner = jobs!
        DispatchQueue.global().async { owner.cancelAndDrain(); drained.signal() }
        XCTAssertEqual(drained.wait(timeout: .now() + 0.05), .timedOut)
        release.signal(); XCTAssertEqual(drained.wait(timeout: .now() + 5), .success)
        XCTAssertEqual(jobs.counters.jobs, 1)
        XCTAssertEqual(try status(id), "removed")
        jobs.afterRetirementUnlink = nil
        XCTAssertNil(try takeRaw(raw(["op": "barrier"]))["error"])
        XCTAssertEqual(jobs.counters.jobs, 0); XCTAssertEqual(jobs.counters.bytes, 0)
        try untouched()
    }

    func testStartedPrivateRetirementRetainsActualResultThroughCancelAndDrain() throws {
        let target = managed.appendingPathComponent("staged.bin"), stage = try prepare(target)
        let entered = DispatchSemaphore(value: 0), release = DispatchSemaphore(value: 0), drained = DispatchSemaphore(value: 0)
        defer { release.signal() }
        jobs.afterWork = { _, installer in if installer { entered.signal(); release.wait() } }
        let id = try jobs.submitDraft(.retirePrivateStage(stage: stage, targetURI: target.absoluteString, operationID: operationID))
        XCTAssertEqual(entered.wait(timeout: .now() + 5), .success)
        XCTAssertFalse(FileManager.default.fileExists(atPath: try namespace(stage).path))
        let owner = jobs!
        DispatchQueue.global().async { owner.cancelAndDrain(); drained.signal() }
        XCTAssertEqual(drained.wait(timeout: .now() + 0.05), .timedOut)
        release.signal(); XCTAssertEqual(drained.wait(timeout: .now() + 5), .success)
        XCTAssertEqual(jobs.counters.jobs, 1)
        XCTAssertEqual(try status(id), "removed")
        jobs.afterWork = nil
        XCTAssertNil(try takeRaw(raw(["op": "barrier"]))["error"])
        XCTAssertEqual(jobs.counters.jobs, 0); XCTAssertEqual(jobs.counters.bytes, 0)
        try untouched()
    }

    func testTypedRetirementFIFOAndExactReplyRoutingPreserveHeldRawBody() throws {
        let (target, proof) = try publication()
        let stageTarget = managed.appendingPathComponent("staged.bin"), stage = try prepare(stageTarget)
        var execution: [String] = []
        jobs.beforeWork = { id, _ in execution.append(id) }
        let read = try raw(["op": "readBytes", "uri": source.absoluteString])
        let publishedID = try jobs.submitDraft(.retirePublished(targetURI: target.absoluteString, proof: proof))
        let barrier = try raw(["op": "barrier"])
        let stageID = try jobs.submitDraft(.retirePrivateStage(stage: stage, targetURI: stageTarget.absoluteString, operationID: operationID))
        jobs.drain()
        XCTAssertEqual(execution, [read, publishedID, barrier, stageID])
        let held = try takeRaw(read)
        XCTAssertEqual(held["body"] as? Bool, true)
        let reserved = jobs.counters.bytes
        XCTAssertEqual(jobs.next(), "")
        XCTAssertEqual(jobs.takeDraft(read), ""); XCTAssertEqual(jobs.takeDraft(barrier), "")
        XCTAssertEqual(jobs.takeDraft("unknown"), "")
        XCTAssertEqual(jobs.counters.jobs, 4); XCTAssertEqual(jobs.counters.bytes, reserved)
        XCTAssertEqual(try status(stageID), "removed")
        XCTAssertEqual(jobs.next(), "")
        XCTAssertEqual(jobs.counters.jobs, 3)
        XCTAssertGreaterThan(jobs.counters.bytes, NativeAttachmentFiles.maximumBytes)
        XCTAssertEqual(try status(publishedID), "removed")
        XCTAssertEqual(jobs.takeDraft(stageID), ""); XCTAssertEqual(jobs.next(), "")
        XCTAssertEqual(jobs.counters.jobs, 2)
        XCTAssertEqual(Data(base64Encoded: jobs.body()), sourceBytes)
        XCTAssertNil(try takeRaw(barrier)["error"])
        XCTAssertEqual(jobs.counters.jobs, 0); XCTAssertEqual(jobs.counters.bytes, 0)
        try untouched()
    }

    func testCompatibilityJSONCannotInvokeEitherRetirementPrimitive() throws {
        let (target, proof) = try publication()
        let stageTarget = managed.appendingPathComponent("staged.bin"), stage = try prepare(stageTarget)
        for op in ["retirePublished", "retirePrivateStage", "retirePublishedAttachment", "retireOwnedPrivateStage"] {
            let request: [String: Any] = ["op": op, "targetURI": target.absoluteString,
                "proof": ["sha256": proof.sha256, "size": proof.size, "identity": proof.identity, "directoryIdentity": proof.directoryIdentity],
                "stageURI": stage.stageURI, "operationID": operationID]
            XCTAssertEqual(try takeRaw(raw(request))["error"] as? String, "Attachment file request is invalid")
            XCTAssertEqual(try takeRaw(raw(request, installer: true))["error"] as? String, "Attachment installer request is invalid")
        }
        XCTAssertEqual(try Data(contentsOf: target), bytes)
        XCTAssertTrue(FileManager.default.fileExists(atPath: try stageURL(stage).path))
        XCTAssertEqual(jobs.counters.jobs, 0); XCTAssertEqual(jobs.counters.bytes, 0)
        try untouched()
    }

    func testRetirementRepliesKeepCountAndSmallReservationsUntilExactConsumption() throws {
        let (target, proof) = try publication()
        var ids: [String] = []
        for _ in 0..<NativeAttachmentFileJobs.maximumJobs {
            ids.append(try jobs.submitDraft(.retirePublished(targetURI: target.absoluteString, proof: proof)))
        }
        jobs.drain()
        XCTAssertEqual(jobs.counters.jobs, 16)
        XCTAssertGreaterThan(jobs.counters.bytes, 16 * 64 * 1024)
        XCTAssertEqual(jobs.next(), "")
        XCTAssertThrowsError(try jobs.submitDraft(.retirePublished(targetURI: target.absoluteString, proof: proof))) { error in
            XCTAssertEqual(error.localizedDescription, "Attachment file bridge capacity is unavailable")
        }
        XCTAssertEqual(try status(ids.removeFirst()), "removed")
        ids.append(try jobs.submitDraft(.retirePublished(targetURI: target.absoluteString, proof: proof)))
        for id in ids { XCTAssertEqual(try status(id), "absent") }
        XCTAssertEqual(jobs.counters.jobs, 0); XCTAssertEqual(jobs.counters.bytes, 0)
        try untouched()
    }

    func testRetirementSharesByteBudgetWithoutReleasingRawBodies() throws {
        let (target, proof) = try publication()
        let read: [String: Any] = ["op": "readBytes", "uri": source.absoluteString]
        let first = try raw(read), second = try raw(read)
        let typed = try jobs.submitDraft(.retirePublished(targetURI: target.absoluteString, proof: proof))
        jobs.drain()
        XCTAssertGreaterThan(jobs.counters.bytes, 32 * 1024 * 1024)
        XCTAssertThrowsError(try raw(read))
        XCTAssertEqual(try takeRaw(first)["body"] as? Bool, true)
        XCTAssertEqual(try status(typed), "removed")
        XCTAssertEqual(jobs.counters.jobs, 2)
        XCTAssertGreaterThan(jobs.counters.bytes, 32 * 1024 * 1024)
        XCTAssertEqual(jobs.next(), "")
        XCTAssertThrowsError(try raw(read))
        XCTAssertEqual(Data(base64Encoded: jobs.body()), sourceBytes)
        let last = try raw(read)
        XCTAssertEqual(try takeRaw(second)["body"] as? Bool, true)
        XCTAssertEqual(Data(base64Encoded: jobs.body()), sourceBytes)
        XCTAssertEqual(try takeRaw(last)["body"] as? Bool, true)
        XCTAssertEqual(Data(base64Encoded: jobs.body()), sourceBytes)
        XCTAssertEqual(jobs.counters.jobs, 0); XCTAssertEqual(jobs.counters.bytes, 0)
        try untouched()
    }

    func testShutdownClearsRetirementRepliesAndHeldBodyAndClosesAdmission() throws {
        let (target, proof) = try publication()
        let stageTarget = managed.appendingPathComponent("staged.bin"), stage = try prepare(stageTarget)
        let read = try raw(["op": "readBytes", "uri": source.absoluteString])
        let publishedID = try jobs.submitDraft(.retirePublished(targetURI: target.absoluteString, proof: proof))
        let stageID = try jobs.submitDraft(.retirePrivateStage(stage: stage, targetURI: stageTarget.absoluteString, operationID: operationID))
        XCTAssertEqual(try takeRaw(read)["body"] as? Bool, true)
        XCTAssertEqual(jobs.counters.jobs, 3)
        jobs.shutdown()
        XCTAssertEqual(jobs.next(), ""); XCTAssertEqual(jobs.body(), "")
        XCTAssertEqual(jobs.takeDraft(publishedID), ""); XCTAssertEqual(jobs.takeDraft(stageID), "")
        XCTAssertEqual(jobs.counters.jobs, 0); XCTAssertEqual(jobs.counters.bytes, 0)
        XCTAssertThrowsError(try jobs.submitDraft(.retirePublished(targetURI: target.absoluteString, proof: proof)))
        XCTAssertThrowsError(try jobs.submitDraft(.retirePrivateStage(stage: stage, targetURI: stageTarget.absoluteString, operationID: operationID)))
        XCTAssertFalse(FileManager.default.fileExists(atPath: target.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: try namespace(stage).path))
        try untouched()
    }

    func testMalformedAndEscapedOversizedRetirementRefusesBeforeAdmission() throws {
        let target = managed.appendingPathComponent("uncreated.bin")
        let proof = PublishedProof(sha256: String(repeating: "a", count: 64), size: 0, identity: "1:2", directoryIdentity: "1:3")
        let stage = StageProof(stageURI: managed.appendingPathComponent("uncreated-stage").absoluteString,
                               stagedIdentity: "1:2", directoryIdentity: "1:3", privateDirectoryIdentity: "1:4")
        jobs.beforeWork = { _, _ in XCTFail("Malformed retirement reached the worker") }
        let wrong: [PublishedProof] = [
            PublishedProof(sha256: String(repeating: "A", count: 64), size: 0, identity: "1:2", directoryIdentity: "1:3"),
            PublishedProof(sha256: proof.sha256, size: -1, identity: "1:2", directoryIdentity: "1:3"),
            PublishedProof(sha256: proof.sha256, size: 9_007_199_254_740_992, identity: "1:2", directoryIdentity: "1:3"),
            PublishedProof(sha256: proof.sha256, size: 0, identity: "01:2", directoryIdentity: "1:3"),
            PublishedProof(sha256: proof.sha256, size: 0, identity: "1:2", directoryIdentity: String(repeating: "1", count: 42))
        ]
        var requests = wrong.map { NativeAttachmentDraftFileRequest.retirePublished(targetURI: target.absoluteString, proof: $0) }
        requests += [
            .retirePublished(targetURI: String(repeating: "a", count: 16 * 1024 + 1), proof: proof),
            .retirePublished(targetURI: "file:///bad\0path", proof: proof),
            .retirePrivateStage(stage: stage, targetURI: target.absoluteString, operationID: String(repeating: "A", count: 32)),
            .retirePrivateStage(stage: stage, targetURI: "", operationID: operationID)
        ]
        for field in 0..<3 {
            let malformed = StageProof(stageURI: stage.stageURI, stagedIdentity: field == 0 ? "1:" : "1:2",
                directoryIdentity: field == 1 ? ":2" : "1:3", privateDirectoryIdentity: field == 2 ? "1:02" : "1:4")
            requests.append(.retirePrivateStage(stage: malformed, targetURI: target.absoluteString, operationID: operationID))
        }
        for request in requests {
            XCTAssertThrowsError(try jobs.submitDraft(request)) { error in
                XCTAssertTrue(error is NativeAttachmentFilesError || error is NativeAttachmentInstallerError)
            }
        }
        let escaped = String(repeating: "\"", count: 16 * 1024)
        let oversized = StageProof(stageURI: escaped, stagedIdentity: "1:2", directoryIdentity: "1:3", privateDirectoryIdentity: "1:4")
        XCTAssertThrowsError(try jobs.submitDraft(.retirePrivateStage(stage: oversized, targetURI: escaped, operationID: operationID))) { error in
            XCTAssertEqual(error.localizedDescription, "Attachment file bridge capacity is unavailable")
        }
        jobs.drain()
        XCTAssertEqual(jobs.counters.jobs, 0); XCTAssertEqual(jobs.counters.bytes, 0)
        XCTAssertEqual(jobs.next(), "")
        XCTAssertFalse(FileManager.default.fileExists(atPath: target.path))
        try untouched()
    }

    func testNativeRetirementErrorsAreFixedAndContainNoSuppliedSecrets() throws {
        let (target, proof) = try publication()
        let stageTarget = managed.appendingPathComponent("staged.bin"), stage = try prepare(stageTarget)
        let secret = "private-retirement-secret"
        let uri = "https://name:\(secret)@example.test/target"
        let published = try takeDraft(jobs.submitDraft(.retirePublished(targetURI: uri, proof: proof)))
        XCTAssertEqual(published["error"] as? String, "Attachment file request is invalid")
        let privateStage = try takeDraft(jobs.submitDraft(.retirePrivateStage(stage: stage, targetURI: uri, operationID: operationID)))
        XCTAssertEqual(privateStage["error"] as? String, "Attachment installer request is invalid")
        XCTAssertFalse(try json(published).contains(secret)); XCTAssertFalse(try json(privateStage).contains(secret))
        jobs.beforeWork = { _, _ in throw NSError(domain: "sensitive", code: 1, userInfo: [NSLocalizedDescriptionKey: secret]) }
        let requests: [NativeAttachmentDraftFileRequest] = [
            .retirePublished(targetURI: target.absoluteString, proof: proof),
            .retirePrivateStage(stage: stage, targetURI: stageTarget.absoluteString, operationID: operationID)
        ]
        for request in requests {
            let failed = try takeDraft(jobs.submitDraft(request))
            XCTAssertEqual(failed["error"] as? String, "Attachment file operation is unavailable")
            XCTAssertFalse(try json(failed).contains(secret))
        }
        XCTAssertEqual(try Data(contentsOf: target), bytes)
        XCTAssertTrue(FileManager.default.fileExists(atPath: try stageURL(stage).path))
        try untouched()
    }

    private func publication() throws -> (URL, PublishedProof) {
        let target = managed.appendingPathComponent("published.bin")
        try bytes.write(to: target)
        return (target, PublishedProof(sha256: digest(bytes), size: Int64(bytes.count),
                                      identity: try identity(target), directoryIdentity: try identity(managed)))
    }

    private func prepare(_ target: URL) throws -> StageProof {
        let answer = try takeDraft(jobs.submitDraft(.prepareStage(targetURI: target.absoluteString, operationID: operationID)))
        XCTAssertEqual(Set(answer.keys), ["id", "value"])
        let value = try XCTUnwrap(answer["value"] as? [String: Any])
        XCTAssertEqual(Set(value.keys), ["stageURI", "stagedIdentity", "directoryIdentity", "privateDirectoryIdentity"])
        return StageProof(stageURI: try XCTUnwrap(value["stageURI"] as? String),
            stagedIdentity: try XCTUnwrap(value["stagedIdentity"] as? String),
            directoryIdentity: try XCTUnwrap(value["directoryIdentity"] as? String),
            privateDirectoryIdentity: try XCTUnwrap(value["privateDirectoryIdentity"] as? String))
    }

    private func stageURL(_ stage: StageProof) throws -> URL { try XCTUnwrap(URL(string: stage.stageURI)) }
    private func namespace(_ stage: StageProof) throws -> URL { try stageURL(stage).deletingLastPathComponent() }
    private func fill(_ stage: StageProof, bytes: Data) throws {
        let handle = try FileHandle(forWritingTo: stageURL(stage))
        defer { try? handle.close() }
        try handle.write(contentsOf: bytes)
    }
    private func digest(_ bytes: Data) -> String { SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() }
    private func identity(_ url: URL) throws -> String {
        var info = stat()
        guard Darwin.lstat(url.path, &info) == 0 else { throw NativeAttachmentFilesError.unavailable }
        return "\(UInt64(info.st_dev)):\(UInt64(info.st_ino))"
    }
    private func json(_ value: Any) throws -> String {
        String(decoding: try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), as: UTF8.self)
    }
    private func object(_ value: String) throws -> [String: Any] {
        try XCTUnwrap(NativeJSON.jsonObject(with: Data(value.utf8)) as? [String: Any])
    }
    private func raw(_ request: [String: Any], installer: Bool = false) throws -> String {
        try jobs.submit(json(request), installer: installer)
    }
    private func takeRaw(_ id: String) throws -> [String: Any] {
        jobs.drain()
        let answer = try object(jobs.next())
        XCTAssertEqual(answer["id"] as? String, id)
        return answer
    }
    private func takeDraft(_ id: String) throws -> [String: Any] {
        jobs.drain()
        let answer = try object(jobs.takeDraft(id))
        XCTAssertEqual(answer["id"] as? String, id)
        return answer
    }
    private func status(_ request: NativeAttachmentDraftFileRequest) throws -> String { try status(jobs.submitDraft(request)) }
    private func status(_ id: String) throws -> String {
        let answer = try takeDraft(id)
        XCTAssertEqual(Set(answer.keys), ["id", "value"])
        let value = try XCTUnwrap(answer["value"] as? [String: Any])
        XCTAssertEqual(Set(value.keys), ["status"])
        return try XCTUnwrap(value["status"] as? String)
    }
    private func error(_ request: NativeAttachmentDraftFileRequest) throws -> String {
        let answer = try takeDraft(jobs.submitDraft(request))
        XCTAssertEqual(Set(answer.keys), ["id", "error"])
        return try XCTUnwrap(answer["error"] as? String)
    }
    private func untouched(managedRoot: URL? = nil) throws {
        XCTAssertEqual(try Data(contentsOf: (managedRoot ?? managed).appendingPathComponent(sibling.lastPathComponent)), siblingBytes)
        XCTAssertEqual(try Data(contentsOf: source), sourceBytes)
    }
}
