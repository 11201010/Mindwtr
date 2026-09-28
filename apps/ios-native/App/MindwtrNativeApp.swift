import SwiftUI

@main
struct MindwtrNativeApp: App {
    @StateObject private var model = CoreModel()

    var body: some Scene {
        WindowGroup {
            InboxScreen(model: model)
                .task { await model.start() }
        }
    }
}
