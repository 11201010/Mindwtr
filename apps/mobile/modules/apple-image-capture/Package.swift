// swift-tools-version: 5.10

import PackageDescription

let package = Package(
    name: "AppleImageCapture",
    platforms: [.iOS(.v15), .macOS(.v13)],
    products: [
        .library(name: "AppleImageCapture", targets: ["AppleImageCapture"]),
    ],
    targets: [
        .target(
            name: "AppleImageCapture",
            path: "ios",
            exclude: [
                "AppleImageCapture.podspec",
                "AppleImageCaptureModule.swift",
                "Tests",
            ],
            sources: ["AppleImageCaptureBounds.swift", "AppleImageAnalysisCoordinator.swift"]
        ),
        .testTarget(
            name: "AppleImageCaptureTests",
            dependencies: ["AppleImageCapture"],
            path: "ios/Tests"
        ),
    ]
)
