import Foundation

enum MindwtrWatchReceiptState: String {
    case awaitingAudio
    case audioRetained
    case prepared
    case published
}

enum MindwtrWatchStageAction: Equatable {
    case create
    case reuse
    case collision
}

enum MindwtrWatchPreparedRecoveryAction: Equatable {
    case publishStage
    case compactPublishedQueue
    case compactConsumedQueue
    case collision
}

/// Pure transition decisions for the durable receive journal. Filesystem code
/// performs these actions, while Linux-independent Swift tests pin the crash
/// boundaries that prevent native redelivery from creating a second queue item.
enum MindwtrWatchReceiptStateMachine {
    static func stageAction(stageExists: Bool, bytesMatch: Bool) -> MindwtrWatchStageAction {
        guard stageExists else { return .create }
        return bytesMatch ? .reuse : .collision
    }

    static func preparedRecoveryAction(
        stageExists: Bool,
        queueExists: Bool,
        bytesMatch: Bool
    ) -> MindwtrWatchPreparedRecoveryAction {
        if stageExists {
            return !queueExists && bytesMatch ? .publishStage : .collision
        }
        if queueExists {
            return bytesMatch ? .compactPublishedQueue : .collision
        }
        // A prepared receipt is committed only after its durable stage. Once
        // the stage is missing, its rename into the queue already happened.
        // A missing queue therefore means JS consumed it; never recreate it.
        return .compactConsumedQueue
    }
}
