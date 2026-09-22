import CloudKit
import Foundation

/// Gives every CKOperation a timeout.
///
/// A CKOperation left in flight with no timeout just sits there when iOS
/// suspends the app mid-request during a background sync: the run's own
/// deadline is a JavaScript timer that does not fire while suspended, so
/// nothing gives up until the app is foregrounded again — up to half an hour
/// late in the field (v1.3.0/1.3.1 iPad log, 2026-09-16..22). Every
/// CKOperation CloudKitSyncManager or CloudKitChangeTracker creates goes
/// through this one helper so none can be missed later.
///
/// CloudKit reports a timed-out operation as a plain network-failure-class
/// CKError (.networkFailure / .networkUnavailable / .requestRateLimited /
/// .serviceUnavailable) — the same codes this codebase already treats as
/// transient (see CloudKitAttachmentErrorClassifier), so no extra mapping is
/// needed: a timeout ends the run `failed`, never `crashed`.
enum CloudKitOperationTimeouts {
    /// One network round trip. This is an inactivity timeout, so a transfer
    /// that keeps moving bytes keeps resetting it.
    static let requestSeconds: TimeInterval = 30

    /// The whole operation including CloudKit's own retries. Short enough to
    /// fit inside a background run and to leave the JS run's own 4-minute
    /// deadline (MOBILE_BACKGROUND_SYNC_DEADLINE_MS in background-sync-task.ts)
    /// room to still abort cleanly after it.
    static let recordResourceSeconds: TimeInterval = 180

    /// Attachment transfers. `timeoutIntervalForResource` is a total wall-clock
    /// cap on the transfer, not an idle timeout, and an attachment may be up to
    /// 50 MB (DEFAULT_MAX_FILE_SIZE_BYTES in packages/core/src/attachment-validation.ts).
    /// 180 s would need a sustained 2.3 Mbit/s and would fail forever below
    /// that, foreground uploads included; 600 s needs about 700 kbit/s.
    static let assetResourceSeconds: TimeInterval = 600

    /// `CKOperation.configuration` is an Objective-C `copy` property, so the
    /// getter is free to hand back a throwaway copy and mutating it in place
    /// would be silently lost. Read, change, write back — correct either way.
    /// The write-back carries `qualityOfService` across because every call site
    /// sets `op.qualityOfService` just before calling this, and a fresh
    /// configuration would otherwise drop it back to the default.
    static func apply(to op: CKOperation, resourceSeconds: TimeInterval = recordResourceSeconds) {
        let config = op.configuration ?? CKOperation.Configuration()
        config.qualityOfService = op.qualityOfService
        config.timeoutIntervalForRequest = requestSeconds
        config.timeoutIntervalForResource = resourceSeconds
        op.configuration = config
    }
}
