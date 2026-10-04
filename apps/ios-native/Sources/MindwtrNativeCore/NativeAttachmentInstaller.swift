import Foundation
import AttachmentFileInstallerEngine

enum NativeAttachmentInstallerError: LocalizedError, Equatable {
    case invalidRequest, unavailable

    var errorDescription: String? {
        switch self {
        case .invalidRequest: return "Attachment installer request is invalid"
        case .unavailable: return "Attachment file operation is unavailable"
        }
    }
}

/// The native file bridge's install/hash boundary. Storage roots come from the
/// library owner, never from a JS request. RN's existing Apple engine owns file
/// identity, locking, streaming hashes, and interrupted-install recovery.
/// Calls must be serialized by the file-port owner, outside the JS engine queue.
final class NativeAttachmentInstaller {
    private let installer: AttachmentFileInstaller

    init(managedRoot: URL, sourceRoots: [URL]) throws {
        do {
            installer = try AttachmentFileInstaller(targetRoot: managedRoot, sourceRoots: sourceRoots)
        } catch {
            throw NativeAttachmentInstallerError.unavailable
        }
    }

    func handle(_ json: String) throws -> String {
        guard json.utf8.count <= 64 * 1024,
              let object = try? JSONSerialization.jsonObject(with: Data(json.utf8)),
              let request = object as? [String: Any],
              let operation = request["op"] as? String else {
            throw NativeAttachmentInstallerError.invalidRequest
        }
        let response: [String: Any]
        switch operation {
        case "install":
            guard Set(request.keys) == Set(["op", "staged", "target", "expected", "expectedDownloadSha256"]),
                  let rawExpected = request["expected"] as? [String: Any],
                  let kind = rawExpected["kind"] as? String else {
                throw NativeAttachmentInstallerError.invalidRequest
            }
            let expected: ExpectedAttachmentGeneration
            switch kind {
            case "absent":
                guard Set(rawExpected.keys) == Set(["kind"]) else { throw NativeAttachmentInstallerError.invalidRequest }
                expected = .absent
            case "present":
                guard Set(rawExpected.keys) == Set(["kind", "sha256"]) else { throw NativeAttachmentInstallerError.invalidRequest }
                expected = .present(sha256: try digest(rawExpected["sha256"]))
            default: throw NativeAttachmentInstallerError.invalidRequest
            }
            let staged = try fileURL(request["staged"])
            let target = try fileURL(request["target"])
            let downloadDigest = try digest(request["expectedDownloadSha256"])
            do {
                switch try installer.install(stagedInput: staged, targetInput: target,
                                             expected: expected, expectedDownloadSha256: downloadDigest) {
                case .installed(let preserved):
                    var result = ["status": "installed"]
                    if let preserved { result["preservedPath"] = preserved.absoluteString }
                    response = result
                case .conflict(let preserved):
                    response = ["status": "conflict", "preservedPath": preserved.absoluteString]
                }
            } catch { throw NativeAttachmentInstallerError.unavailable }
        case "hash":
            guard Set(request.keys) == Set(["op", "path"]) else { throw NativeAttachmentInstallerError.invalidRequest }
            let path = try fileURL(request["path"])
            do {
                let snapshot = try installer.hash(path)
                response = ["sha256": snapshot.sha256, "size": Double(snapshot.size),
                            "modificationTimeMs": snapshot.modificationTimeMs]
            } catch { throw NativeAttachmentInstallerError.unavailable }
        default: throw NativeAttachmentInstallerError.invalidRequest
        }
        return String(decoding: try JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]), as: UTF8.self)
    }

    private func digest(_ value: Any?) throws -> String {
        guard let text = value as? String, text.utf8.count == 64,
              text.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else {
            throw NativeAttachmentInstallerError.invalidRequest
        }
        return text
    }

    private func fileURL(_ value: Any?) throws -> URL {
        guard let text = value as? String, !text.isEmpty, text.utf8.count <= 16 * 1024,
              !text.utf8.contains(0), let url = URL(string: text), url.isFileURL,
              url.host == nil || url.host == "", url.user == nil, url.password == nil,
              url.port == nil, url.query == nil, url.fragment == nil, url.path.hasPrefix("/"),
              !url.pathComponents.contains("."), !url.pathComponents.contains(".."),
              !url.path.utf8.contains(0) else {
            throw NativeAttachmentInstallerError.invalidRequest
        }
        return url
    }
}
