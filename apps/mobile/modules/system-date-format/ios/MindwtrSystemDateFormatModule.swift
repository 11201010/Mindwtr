import ExpoModulesCore
import Foundation

public final class MindwtrSystemDateFormatModule: Module {
    public func definition() -> ModuleDefinition {
        Name("MindwtrSystemDateFormat")

        Function("getShortDateFormat") {
            let formatter = DateFormatter()
            formatter.locale = .autoupdatingCurrent
            formatter.calendar = Calendar(identifier: .gregorian)
            formatter.dateStyle = .short
            formatter.timeStyle = .none
            return formatter.dateFormat ?? ""
        }
    }
}
