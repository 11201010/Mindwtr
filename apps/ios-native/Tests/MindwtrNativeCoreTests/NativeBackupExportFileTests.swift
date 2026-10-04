import Foundation
import XCTest
@testable import MindwtrNativeCore

final class NativeBackupExportFileTests: XCTestCase {
    private let backupName = "mindwtr-backup-2026-10-04T12-34-56-789Z.json"

    private func withRoot(_ body: (URL) throws -> Void) throws {
        let root = URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
            .appendingPathComponent(".mindwtr-export-test-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: root) }
        try body(root)
    }

    func testIndependentImmutableUnicodeFilesAndOwnedCleanup() throws {
        try withRoot { root in
            let port = NativeBackupExportFile(libraryRoot: root)
            let text = "{\"notes\":\"日本語 🦉\\nمرحبا\"}"
            let first = try port.prepare(fileName: backupName, json: text)
            let second = try port.prepare(fileName: backupName, json: "{}")
            XCTAssertNotEqual(first.url, second.url)
            XCTAssertEqual(try Data(contentsOf: first.url), Data(text.utf8))
            XCTAssertEqual(try Data(contentsOf: second.url), Data("{}".utf8))
            port.discard(UUID())
            port.discard(first.id)
            XCTAssertFalse(FileManager.default.fileExists(atPath: first.url.path))
            XCTAssertTrue(FileManager.default.fileExists(atPath: second.url.path))
            port.discard(second.id)
            XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: root.path), [])
        }
    }

    func testFailedWriteLeavesNoFileOrDirectory() throws {
        try withRoot { root in
            let port = NativeBackupExportFile(libraryRoot: root)
            port.beforeWrite = { throw CocoaError(.fileWriteOutOfSpace) }
            XCTAssertThrowsError(try port.prepare(fileName: backupName, json: "private"))
            XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: root.path), [])
        }
    }

    func testInterruptedCleanupRemovesOnlyOwnedRegularBackupFamily() throws {
        try withRoot { root in
            let orphan = root.appendingPathComponent("backup-export-" + UUID().uuidString.lowercased())
            try FileManager.default.createDirectory(at: orphan, withIntermediateDirectories: false)
            try Data("interrupted".utf8).write(to: orphan.appendingPathComponent(backupName))
            let unrelated = root.appendingPathComponent("backup-export-" + UUID().uuidString.lowercased())
            try FileManager.default.createDirectory(at: unrelated, withIntermediateDirectories: false)
            let retained = unrelated.appendingPathComponent("retained.txt")
            try Data("retained".utf8).write(to: retained)
            let linked = root.appendingPathComponent("backup-export-" + UUID().uuidString.lowercased())
            try FileManager.default.createSymbolicLink(at: linked, withDestinationURL: unrelated)
            let port = NativeBackupExportFile(libraryRoot: root)
            try port.discardInterruptedExports()
            XCTAssertFalse(FileManager.default.fileExists(atPath: orphan.path))
            XCTAssertEqual(try String(contentsOf: retained), "retained")
            XCTAssertEqual(try FileManager.default.destinationOfSymbolicLink(atPath: linked.path), unrelated.path)
            let active = try port.prepare(fileName: backupName, json: "{}")
            try port.discardInterruptedExports()
            XCTAssertTrue(FileManager.default.fileExists(atPath: active.url.path))
            port.discard(active.id)
        }
    }

    func testRejectsCallerPathsAndSymlinkedLibraryWithoutTouchingTarget() throws {
        try withRoot { root in
            let port = NativeBackupExportFile(libraryRoot: root)
            for invalidName in ["../private.json", "/private.json", "mindwtr-backup-x.json", self.backupName + "/other", self.backupName + "\n"] {
                XCTAssertThrowsError(try port.prepare(fileName: invalidName, json: "private"))
            }
            let target = root.appendingPathComponent("target", isDirectory: true)
            try FileManager.default.createDirectory(at: target, withIntermediateDirectories: false)
            let link = root.appendingPathComponent("link", isDirectory: true)
            try FileManager.default.createSymbolicLink(at: link, withDestinationURL: target)
            XCTAssertThrowsError(try NativeBackupExportFile(libraryRoot: link).prepare(fileName: backupName, json: "private"))
            XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: target.path), [])
        }
    }
}
