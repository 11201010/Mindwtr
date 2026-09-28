// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "MindwtrNativeCore",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [.library(name: "MindwtrNativeCore", targets: ["MindwtrNativeCore"])],
    targets: [
        .target(name: "SQLiteSupport", publicHeadersPath: "include", linkerSettings: [.linkedLibrary("sqlite3")]),
        .target(name: "MindwtrNativeCore", dependencies: ["SQLiteSupport"], linkerSettings: [.linkedFramework("JavaScriptCore")]),
        .testTarget(name: "MindwtrNativeCoreTests", dependencies: ["MindwtrNativeCore"]),
    ]
)
