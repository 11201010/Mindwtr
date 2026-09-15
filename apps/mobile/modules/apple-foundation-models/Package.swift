// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "MindwtrAppleFoundationModelsNativeTests",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "AppleClarificationRequestRegistry", targets: ["AppleClarificationRequestRegistry"]),
    ],
    targets: [
        .target(
            name: "AppleClarificationRequestRegistry",
            path: "ios",
            exclude: ["MindwtrAppleFoundationModelsModule.swift", "MindwtrAppleFoundationModels.podspec"]
        ),
        .testTarget(
            name: "AppleClarificationRequestRegistryTests",
            dependencies: ["AppleClarificationRequestRegistry"],
            path: "Tests"
        ),
    ]
)
