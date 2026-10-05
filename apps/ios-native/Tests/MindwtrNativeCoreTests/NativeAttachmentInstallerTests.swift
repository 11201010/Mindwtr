import XCTest
import CryptoKit
@testable import MindwtrNativeCore

final class NativeAttachmentInstallerTests: XCTestCase {
    private var root: URL!
    private var managed: URL { root.appendingPathComponent("attachments", isDirectory: true) }
    private var stage: URL { root.appendingPathComponent("staging", isDirectory: true) }

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: managed, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: stage, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws { if let root { try FileManager.default.removeItem(at: root) } }

    private func host() throws -> NativeAttachmentInstaller {
        try NativeAttachmentInstaller(managedRoot: managed, sourceRoots: [stage, managed])
    }
    private func sha(_ text: String) -> String { SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined() }
    private func request(_ object: [String: Any], on host: NativeAttachmentInstaller? = nil) throws -> [String: Any] {
        let input = String(decoding: try JSONSerialization.data(withJSONObject: object), as: UTF8.self)
        let output = try (host ?? self.host()).handle(input)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(output.utf8)) as? [String: Any])
    }
    private func install(_ source: URL, _ target: URL, _ bytes: String, expected: [String: String] = ["kind": "absent"]) throws -> [String: Any] {
        try request(["op": "install", "staged": source.absoluteString, "target": target.absoluteString,
                     "expected": expected, "expectedDownloadSha256": sha(bytes)])
    }

    func testInstallHashAndReplacementThroughRecreatedHost() throws {
        let source = stage.appendingPathComponent("first")
        let target = managed.appendingPathComponent("attachment.txt")
        try Data("first generation".utf8).write(to: source)
        XCTAssertEqual(try install(source, target, "first generation")["status"] as? String, "installed")
        let digest = try request(["op": "hash", "path": target.absoluteString], on: host())
        XCTAssertEqual(digest["sha256"] as? String, sha("first generation"))
        XCTAssertEqual(digest["size"] as? Int, 16)
        XCTAssertGreaterThan(try XCTUnwrap(digest["modificationTimeMs"] as? Double), 0)
        let next = stage.appendingPathComponent("second")
        try Data("new bytes".utf8).write(to: next)
        XCTAssertEqual(try install(next, target, "new bytes", expected: ["kind": "present", "sha256": sha("first generation")])["status"] as? String, "installed")
        XCTAssertEqual(try Data(contentsOf: target), Data("new bytes".utf8))
        XCTAssertEqual(try request(["op": "hash", "path": target.absoluteString])["sha256"] as? String, sha("new bytes"))
    }

    func testConflictPreservesBothGenerationsAndReturnsOriginalStagedReference() throws {
        let source = stage.appendingPathComponent("download")
        let target = managed.appendingPathComponent("attachment.txt")
        try Data("incoming".utf8).write(to: source)
        try Data("local edit".utf8).write(to: target)
        let answer = try install(source, target, "incoming")
        XCTAssertEqual(answer["status"] as? String, "conflict")
        let preserved = try XCTUnwrap(URL(string: XCTUnwrap(answer["preservedPath"] as? String)))
        XCTAssertEqual(preserved.standardizedFileURL, source.standardizedFileURL)
        XCTAssertEqual(try Data(contentsOf: preserved), Data("incoming".utf8))
        XCTAssertEqual(try Data(contentsOf: target), Data("local edit".utf8))
    }

    func testWrongDigestDoesNotPublishOrRemoveSource() throws {
        let source = stage.appendingPathComponent("download")
        let target = managed.appendingPathComponent("attachment.txt")
        try Data("original".utf8).write(to: source)
        XCTAssertThrowsError(try install(source, target, "different")) { error in
            XCTAssertEqual(error as? NativeAttachmentInstallerError, .unavailable)
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: target.path))
        XCTAssertEqual(try Data(contentsOf: source), Data("original".utf8))
    }

    func testOutsideRootsAndSymlinkRefusedWithoutExposingPaths() throws {
        let outside = root.appendingPathComponent("private-source-name")
        let target = managed.appendingPathComponent("attachment.txt")
        try Data("private bytes".utf8).write(to: outside)
        XCTAssertThrowsError(try install(outside, target, "private bytes")) { error in
            XCTAssertEqual(error.localizedDescription, "Attachment file operation is unavailable")
        }
        let link = stage.appendingPathComponent("link")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: outside)
        XCTAssertThrowsError(try install(link, target, "private bytes"))
        XCTAssertThrowsError(try request(["op": "hash", "path": outside.absoluteString]))
        XCTAssertFalse(FileManager.default.fileExists(atPath: target.path))
        XCTAssertEqual(try Data(contentsOf: outside), Data("private bytes".utf8))
    }

    func testMalformedRequestsFailBeforeIO() throws {
        let source = stage.appendingPathComponent("source")
        let target = managed.appendingPathComponent("target")
        try Data("bytes".utf8).write(to: source)
        let valid: [String: Any] = ["op": "install", "staged": source.absoluteString, "target": target.absoluteString,
                                    "expected": ["kind": "absent"], "expectedDownloadSha256": sha("bytes")]
        var unknown = valid; unknown["root"] = root.absoluteString
        var malformedExpected = valid; malformedExpected["expected"] = ["kind": "absent", "sha256": sha("bytes")]
        var uppercaseDigest = valid; uppercaseDigest["expectedDownloadSha256"] = sha("bytes").uppercased()
        var notDigest = valid; notDigest["expectedDownloadSha256"] = true
        var remote = valid; remote["staged"] = "file://server/private-source-name"
        var port = valid; port["staged"] = "file://:123" + source.path
        var relative = valid; relative["staged"] = "file:relative"
        var query = valid; query["staged"] = source.absoluteString + "?credential=private"
        var traversal = valid; traversal["staged"] = stage.absoluteString + "/../private-source-name"
        var missing = valid; missing.removeValue(forKey: "target")
        for value in [unknown, malformedExpected, uppercaseDigest, notDigest, remote, port, relative, query, traversal, missing,
                      ["op": "publishImmutable"], ["op": "hash", "path": target.absoluteString, "extra": false]] {
            XCTAssertThrowsError(try request(value)) { error in
                XCTAssertEqual(error as? NativeAttachmentInstallerError, .invalidRequest)
            }
        }
        XCTAssertThrowsError(try host().handle(String(repeating: " ", count: 65537)))
        XCTAssertThrowsError(try host().handle("[]"))
        XCTAssertFalse(FileManager.default.fileExists(atPath: target.path))
        XCTAssertEqual(try Data(contentsOf: source), Data("bytes".utf8))
    }
}
