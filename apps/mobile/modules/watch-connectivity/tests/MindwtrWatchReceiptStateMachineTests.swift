import XCTest
@testable import MindwtrWatchPayloadValidation

final class MindwtrWatchReceiptStateMachineTests: XCTestCase {
    func testOrphanStageIsReusedOnlyForTheSamePayload() {
        XCTAssertEqual(
            MindwtrWatchReceiptStateMachine.stageAction(
                stageExists: false,
                bytesMatch: false
            ),
            .create
        )
        XCTAssertEqual(
            MindwtrWatchReceiptStateMachine.stageAction(
                stageExists: true,
                bytesMatch: true
            ),
            .reuse
        )
        XCTAssertEqual(
            MindwtrWatchReceiptStateMachine.stageAction(
                stageExists: true,
                bytesMatch: false
            ),
            .collision
        )
    }

    func testPreparedReceiptPublishesItsDurableStageExactlyOnce() {
        XCTAssertEqual(
            MindwtrWatchReceiptStateMachine.preparedRecoveryAction(
                stageExists: true,
                queueExists: false,
                bytesMatch: true
            ),
            .publishStage
        )
    }

    func testPreparedReceiptCompactsAfterPublishedQueueSurvivesCrash() {
        XCTAssertEqual(
            MindwtrWatchReceiptStateMachine.preparedRecoveryAction(
                stageExists: false,
                queueExists: true,
                bytesMatch: true
            ),
            .compactPublishedQueue
        )
    }

    func testPreparedReceiptNeverRecreatesQueueConsumedBeforeCrash() {
        XCTAssertEqual(
            MindwtrWatchReceiptStateMachine.preparedRecoveryAction(
                stageExists: false,
                queueExists: false,
                bytesMatch: false
            ),
            .compactConsumedQueue
        )
    }

    func testPreparedReceiptFailsClosedOnCollisionOrCorruption() {
        XCTAssertEqual(
            MindwtrWatchReceiptStateMachine.preparedRecoveryAction(
                stageExists: true,
                queueExists: true,
                bytesMatch: true
            ),
            .collision
        )
        XCTAssertEqual(
            MindwtrWatchReceiptStateMachine.preparedRecoveryAction(
                stageExists: true,
                queueExists: false,
                bytesMatch: false
            ),
            .collision
        )
        XCTAssertEqual(
            MindwtrWatchReceiptStateMachine.preparedRecoveryAction(
                stageExists: false,
                queueExists: true,
                bytesMatch: false
            ),
            .collision
        )
    }
}
