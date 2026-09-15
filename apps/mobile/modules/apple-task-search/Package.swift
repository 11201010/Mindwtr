// swift-tools-version: 5.10

import PackageDescription

let package = Package(
    name: "MindwtrAppleTaskSearchCollector",
    platforms: [.macOS(.v13)],
    products: [
        .library(
            name: "MindwtrAppleTaskSearchCollector",
            targets: ["MindwtrAppleTaskSearchCollector"]
        ),
    ],
    targets: [
        .target(
            name: "MindwtrAppleTaskSearchCollector",
            path: "ios",
            exclude: [
                "MindwtrAppleTaskSearch.podspec",
                "MindwtrAppleTaskSearchModule.swift",
            ],
            sources: ["MindwtrAppleTaskSearchCollector.swift"]
        ),
        .testTarget(
            name: "MindwtrAppleTaskSearchCollectorTests",
            dependencies: ["MindwtrAppleTaskSearchCollector"],
            path: "tests"
        ),
    ]
)
