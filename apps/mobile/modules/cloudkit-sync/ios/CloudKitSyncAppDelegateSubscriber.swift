import ExpoModulesCore
import UIKit

public final class CloudKitSyncAppDelegateSubscriber: ExpoAppDelegateSubscriber {
    // The signature must match UIApplicationDelegate's optional requirement
    // exactly (it returns Void). Expo forwards a push only to subscribers that
    // `responds(to:)` that selector, and a method that merely "nearly matches"
    // is not exposed to Objective-C at all, so the old `-> Bool` version was
    // never called and CloudKit silent pushes never reached the app.
    public func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        let handled = CloudKitSyncModule.handleRemoteNotificationPayload(userInfo)
        completionHandler(handled ? .newData : .noData)
    }
}
