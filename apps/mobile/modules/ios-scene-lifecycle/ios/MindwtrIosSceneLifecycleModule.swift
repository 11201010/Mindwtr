import ExpoModulesCore
import Foundation
import UIKit

public final class MindwtrIosSceneLifecycleModule: Module {
    private static let diagnosticsNotification = Notification.Name(
        "tech.dongdongbh.mindwtr.iosSceneLifecycleDiagnostics.changed"
    )
    private var diagnosticsObserver: NSObjectProtocol?

    public func definition() -> ModuleDefinition {
        Name("MindwtrIosSceneLifecycle")

        Events("onDiagnosticsChanged")

        OnCreate {
            self.diagnosticsObserver = NotificationCenter.default.addObserver(
                forName: Self.diagnosticsNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                self?.sendEvent("onDiagnosticsChanged", [:])
            }
        }

        OnDestroy {
            if let observer = self.diagnosticsObserver {
                NotificationCenter.default.removeObserver(observer)
                self.diagnosticsObserver = nil
            }
        }

        Function("drainDiagnostics") {
            let records = self.drainDiagnosticsOnMainQueue()
            NSLog(
                "[MindwtrScene] stage=bridgeReady deliveryKind=none count=%d",
                records.count
            )
            return records
        }
    }

    private func drainDiagnosticsOnMainQueue() -> [[String: Any]] {
        if Thread.isMainThread {
            return drainDiagnosticsFromAppDelegate()
        }
        return DispatchQueue.main.sync {
            drainDiagnosticsFromAppDelegate()
        }
    }

    private func drainDiagnosticsFromAppDelegate() -> [[String: Any]] {
        let selector = NSSelectorFromString("drainMindwtrSceneDiagnostics")
        guard let appDelegate = UIApplication.shared.delegate as? NSObject,
              appDelegate.responds(to: selector),
              let result = appDelegate.perform(selector)?.takeUnretainedValue(),
              let records = result as? [[String: Any]] else {
            return []
        }
        return records
    }
}
