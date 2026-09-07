import AppIntents
import Foundation

extension Notification.Name {
    static let mindwtrWatchOpenCapture = Notification.Name("tech.dongdongbh.mindwtr.watch.open-capture")
}

@available(watchOS 10.0, *)
struct MindwtrOpenWatchCaptureIntent: AppIntent {
    static var title: LocalizedStringResource = "Capture in Mindwtr"
    static var description = IntentDescription("Opens Mindwtr on Apple Watch for dictation or audio capture.")

    #if compiler(>=6.0)
    @available(watchOS 26.0, *)
    static var supportedModes: IntentModes {
        .foreground(.immediate)
    }
    #endif

    @available(*, deprecated, message: "Use supportedModes with newer App Intents SDKs.")
    static var openAppWhenRun: Bool { true }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        MindwtrWatchSnapshotStore.requestCaptureOnNextOpen()
        NotificationCenter.default.post(name: .mindwtrWatchOpenCapture, object: nil)
        return .result(dialog: "Mindwtr is ready to capture.")
    }
}

@available(watchOS 10.0, *)
struct MindwtrStartWatchPomodoroIntent: AppIntent {
    static var title: LocalizedStringResource = "Start Mindwtr Focus Timer"
    static var description = IntentDescription("Starts the current Mindwtr Pomodoro timer from Apple Watch.")

    #if compiler(>=6.0)
    @available(watchOS 26.0, *)
    static var supportedModes: IntentModes {
        .background
    }
    #endif

    @available(*, deprecated, message: "Use supportedModes with newer App Intents SDKs.")
    static var openAppWhenRun: Bool { false }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        MindwtrWatchConnectivityModel.shared.sendPomodoro(
            action: .start,
            taskId: MindwtrWatchConnectivityModel.shared.snapshot.pomodoro.taskId
        )
        return .result(dialog: "Starting the Mindwtr focus timer.")
    }
}

@available(watchOS 10.0, *)
struct MindwtrWatchShortcuts: AppShortcutsProvider {
    @AppShortcutsBuilder
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: MindwtrOpenWatchCaptureIntent(),
            phrases: [
                "Capture in \(.applicationName)",
                "Open \(.applicationName) capture",
            ],
            shortTitle: "Capture",
            systemImageName: "quote.bubble.fill"
        )
        AppShortcut(
            intent: MindwtrStartWatchPomodoroIntent(),
            phrases: [
                "Start a focus timer in \(.applicationName)",
                "Start \(.applicationName) focus",
            ],
            shortTitle: "Start Focus Timer",
            systemImageName: "timer"
        )
    }
}
