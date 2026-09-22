import ExpoModulesCore
import UIKit

public final class CloudKitSyncAppDelegateSubscriber: ExpoAppDelegateSubscriber {
    // CloudKit subscription pushes are silent, need no user permission, and are
    // only delivered to an app that registered for remote notifications in this
    // launch. Nothing else in the app registers unless the person turns on
    // notifications in Settings, so a device with iCloud sync on and
    // notifications never enabled would receive no pushes at all.
    public func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        application.registerForRemoteNotifications()
        return true
    }

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
