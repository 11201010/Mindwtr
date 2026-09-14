// swift-tools-version: 5.10

import PackageDescription

let package = Package(
    name: "MindwtrSiriActionStore",
    platforms: [
        .iOS(.v15),
        .macOS(.v13),
    ],
    products: [
        .library(
            name: "MindwtrSiriActionStore",
            targets: ["MindwtrSiriActionStore"]
        ),
    ],
    targets: [
        .target(
            name: "MindwtrSiriActionStore",
            path: "ios",
            exclude: [
                "MindwtrIosSiriActions.podspec",
                "MindwtrIosSiriActionsModule.swift",
            ],
            sources: ["MindwtrSiriActionStore.swift"]
        ),
        .testTarget(
            name: "MindwtrSiriActionStoreTests",
            dependencies: ["MindwtrSiriActionStore"],
            path: "tests"
        ),
    ]
)
