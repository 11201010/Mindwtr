import CloudKit
import Foundation
import XCTest
@testable import CloudKitAttachmentErrorClassifier

final class CloudKitOperationTimeoutsTests: XCTestCase {
    /// `CKOperation.configuration` is an Objective-C `copy` property, so a
    /// helper that mutated it in place could be a silent no-op. This is the
    /// test that proves the timeouts are still on the operation afterwards.
    func testApplyKeepsTheTimeoutsOnTheOperation() {
        let op = CKFetchRecordZoneChangesOperation()
        op.qualityOfService = .userInitiated

        CloudKitOperationTimeouts.apply(to: op)

        XCTAssertEqual(op.configuration.timeoutIntervalForRequest, 30)
        XCTAssertEqual(op.configuration.timeoutIntervalForResource, 180)
        XCTAssertEqual(op.configuration.qualityOfService, .userInitiated)
    }

    /// Attachment transfers get a longer total budget; 180 s would fail a
    /// large attachment forever on a slow connection.
    func testAssetOperationsGetTheLongerResourceTimeout() {
        let op = CKModifyRecordsOperation()
        op.qualityOfService = .userInitiated

        CloudKitOperationTimeouts.apply(to: op, resourceSeconds: CloudKitOperationTimeouts.assetResourceSeconds)

        XCTAssertEqual(op.configuration.timeoutIntervalForRequest, 30)
        XCTAssertEqual(op.configuration.timeoutIntervalForResource, 600)
        XCTAssertEqual(op.configuration.qualityOfService, .userInitiated)
    }
}
