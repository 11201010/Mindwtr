import Foundation

enum MindwtrWatchSnapshotStore {
    private static let snapshotKey = "mindwtr.watch.snapshot.v1"
    private static let openCaptureKey = "mindwtr.watch.open-capture"

    static var appGroup: String? {
        Bundle.main.object(forInfoDictionaryKey: "MindwtrWatchAppGroup") as? String
    }

    private static var defaults: UserDefaults? {
        guard let appGroup, !appGroup.isEmpty else { return nil }
        return UserDefaults(suiteName: appGroup)
    }

    static func load() -> MindwtrWatchSnapshot {
        guard let data = defaults?.data(forKey: snapshotKey),
              let snapshot = try? JSONDecoder().decode(MindwtrWatchSnapshot.self, from: data)
        else { return .empty }
        return snapshot
    }

    static func save(_ snapshot: MindwtrWatchSnapshot) {
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        defaults?.set(data, forKey: snapshotKey)
    }

    static func requestCaptureOnNextOpen() {
        defaults?.set(true, forKey: openCaptureKey)
    }

    static func consumeCaptureRequest() -> Bool {
        guard defaults?.bool(forKey: openCaptureKey) == true else { return false }
        defaults?.removeObject(forKey: openCaptureKey)
        return true
    }
}
