import ExpoModulesCore
import UIKit

public final class MindwtrWatchConnectivityAppDelegateSubscriber: ExpoAppDelegateSubscriber {
    public func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // Watch background deliveries can arrive before React Native starts.
        // The receiver owns no database access, so it is safe to activate here.
        MindwtrWatchConnectivityReceiver.shared.activateAtLaunch()
        return true
    }
}
