// swift-tools-version: 5.10

import PackageDescription

let package = Package(
    name: "MindwtrWatchPayloadValidation",
    platforms: [
        .iOS(.v15),
        .macOS(.v13),
    ],
    products: [
        .library(
            name: "MindwtrWatchPayloadValidation",
            targets: ["MindwtrWatchPayloadValidation"]
        ),
    ],
    targets: [
        .target(
            name: "MindwtrWatchPayloadValidation",
            path: "ios",
            exclude: [
                "MindwtrWatchConnectivity.podspec",
                "MindwtrWatchConnectivityAppDelegateSubscriber.swift",
                "MindwtrWatchConnectivityModule.swift",
                "MindwtrWatchConnectivityReceiver.swift",
            ],
            sources: [
                "MindwtrCanonicalWave.swift",
                "MindwtrWatchAudioPathResolver.swift",
                "MindwtrWatchPayloadValidator.swift",
                "MindwtrWatchReceiptStateMachine.swift",
            ]
        ),
        .testTarget(
            name: "MindwtrWatchPayloadValidationTests",
            dependencies: ["MindwtrWatchPayloadValidation"],
            path: "tests"
        ),
    ]
)
