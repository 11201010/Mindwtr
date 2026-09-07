import SwiftUI

@main
struct MindwtrWatchApp: App {
    @StateObject private var model = MindwtrWatchConnectivityModel.shared

    var body: some Scene {
        WindowGroup {
            MindwtrWatchRootView()
                .environmentObject(model)
        }
    }
}
