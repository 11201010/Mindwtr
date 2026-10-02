import Foundation
import Darwin

/// The payload is deliberately opaque to the host; shared core validates its field schema on resume.
public struct EditorDraftSnapshot: Codable, Sendable, Equatable {
    public let version: Int
    public let sessionID: String
    public let taskID: String
    public let generation: Int
    public let payloadJSON: String

    public init(sessionID: String, taskID: String, generation: Int, payloadJSON: String) {
        version = 1
        self.sessionID = sessionID
        self.taskID = taskID
        self.generation = generation
        self.payloadJSON = payloadJSON
    }
}

public enum EditorDraftStoreError: LocalizedError, Sendable {
    case corrupt

    public var errorDescription: String? { "Saved editor draft is unreadable" }
}

struct EditorDraftAttempt: Codable, Equatable {
    let id: String
    let sessionID: String
    let taskID: String
    let generation: Int
    let method: String
    let argumentsJSON: String
}

private struct StoredEditorDraft: Codable {
    let snapshot: EditorDraftSnapshot
    let attempt: EditorDraftAttempt?
}

/// One fixed file beside the native database. All calls run on CoreHost's serial queue.
struct EditorDraftStore {
    let url: URL
    private static let maxPayload = 1_000_000
    private static let maxFile = 3_000_000

    init(databaseURL: URL) { url = databaseURL.appendingPathExtension("editor-draft.json") }

    private func validUUID(_ value: String) -> Bool {
        UUID(uuidString: value)?.uuidString.lowercased() == value
    }

    private func validObject(_ text: String, limit: Int) -> Bool {
        guard text.utf8.count <= limit,
              let value = try? JSONSerialization.jsonObject(with: Data(text.utf8)),
              value is [String: Any] else { return false }
        return true
    }

    private func validate(_ value: StoredEditorDraft) throws {
        let snapshot = value.snapshot
        guard snapshot.version == 1, validUUID(snapshot.sessionID),
              !snapshot.taskID.isEmpty, snapshot.taskID.utf8.count <= 500,
              snapshot.generation > 0, validObject(snapshot.payloadJSON, limit: Self.maxPayload) else {
            throw EditorDraftStoreError.corrupt
        }
        if let attempt = value.attempt {
            guard validUUID(attempt.id), attempt.sessionID == snapshot.sessionID,
                  attempt.taskID == snapshot.taskID, attempt.generation == snapshot.generation,
                  ["saveDraft", "checklistSave", "boardAction", "taskDelete", "taskPromote"].contains(attempt.method),
                  attempt.argumentsJSON.utf8.count <= 2_000_000,
                  let arguments = try? JSONSerialization.jsonObject(with: Data(attempt.argumentsJSON.utf8)) as? [String],
                  arguments.count == 1, validObject(arguments[0], limit: 2_000_000) else {
                throw EditorDraftStoreError.corrupt
            }
        }
    }

    private func bytes() throws -> Data? {
        let fd = open(url.path, O_RDONLY | O_NOFOLLOW)
        if fd < 0 {
            if errno == ENOENT { return nil }
            if errno == ELOOP { throw EditorDraftStoreError.corrupt }
            throw HostFailure("Cannot read editor draft")
        }
        defer { Darwin.close(fd) }
        var info = stat()
        guard fstat(fd, &info) == 0 else { throw HostFailure("Cannot inspect editor draft") }
        guard info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG), info.st_size >= 0,
              info.st_size <= off_t(Self.maxFile) else { throw EditorDraftStoreError.corrupt }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 16_384)
        while true {
            let count = buffer.withUnsafeMutableBytes { Darwin.read(fd, $0.baseAddress, $0.count) }
            if count < 0 && errno == EINTR { continue }
            guard count >= 0 else { throw HostFailure("Cannot read editor draft") }
            if count == 0 { break }
            guard data.count + count <= Self.maxFile else { throw EditorDraftStoreError.corrupt }
            data.append(contentsOf: buffer[..<count])
        }
        return data
    }

    func read() throws -> (snapshot: EditorDraftSnapshot, attempt: EditorDraftAttempt?)? {
        guard let data = try bytes() else { return nil }
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(object.keys) == Set(object["attempt"] == nil ? ["snapshot"] : ["snapshot", "attempt"]),
              let rawSnapshot = object["snapshot"] as? [String: Any],
              Set(rawSnapshot.keys) == Set(["version", "sessionID", "taskID", "generation", "payloadJSON"]),
              object["attempt"] == nil || (object["attempt"] as? [String: Any]).map({
                  Set($0.keys) == Set(["id", "sessionID", "taskID", "generation", "method", "argumentsJSON"])
              }) == true,
              let stored = try? JSONDecoder().decode(StoredEditorDraft.self, from: data) else {
            throw EditorDraftStoreError.corrupt
        }
        try validate(stored)
        return (stored.snapshot, stored.attempt)
    }

    private func write(_ snapshot: EditorDraftSnapshot, attempt: EditorDraftAttempt? = nil) throws {
        let value = StoredEditorDraft(snapshot: snapshot, attempt: attempt)
        try validate(value)
        let data = try JSONEncoder().encode(value)
        guard data.count <= Self.maxFile else { throw EditorDraftStoreError.corrupt }
        try DurableFile.write(data, to: url, privateDraft: true)
    }

    func checkpoint(_ snapshot: EditorDraftSnapshot) throws {
        try validate(StoredEditorDraft(snapshot: snapshot, attempt: nil))
        if let current = try read() {
            guard current.snapshot.sessionID == snapshot.sessionID,
                  current.snapshot.taskID == snapshot.taskID,
                  current.attempt == nil else {
                throw HostFailure("Editor draft belongs to another or pending session")
            }
            if current.snapshot == snapshot { return }
            guard snapshot.generation > current.snapshot.generation else {
                throw HostFailure("Editor draft checkpoint is stale")
            }
        }
        try write(snapshot)
    }

    func freeze(sessionID: String, generation: Int, method: String, argumentsJSON: String) throws -> EditorDraftAttempt {
        guard let current = try read(), current.attempt == nil,
              current.snapshot.sessionID == sessionID, current.snapshot.generation == generation else {
            throw HostFailure("Editor draft changed before Save")
        }
        let attempt = EditorDraftAttempt(id: UUID().uuidString.lowercased(), sessionID: sessionID,
                                         taskID: current.snapshot.taskID, generation: generation,
                                         method: method, argumentsJSON: argumentsJSON)
        try write(current.snapshot, attempt: attempt)
        return attempt
    }

    func thaw(_ attempt: EditorDraftAttempt) throws {
        guard let current = try read() else { throw HostFailure("Editor draft Save attempt changed") }
        if current.attempt == nil, current.snapshot.sessionID == attempt.sessionID,
           current.snapshot.taskID == attempt.taskID, current.snapshot.generation == attempt.generation { return }
        guard current.attempt == attempt else {
            throw HostFailure("Editor draft Save attempt changed")
        }
        try write(current.snapshot)
    }

    func removeMatching(_ attempt: EditorDraftAttempt) throws {
        guard let current = try read() else { return }
        guard current.attempt == attempt else { throw HostFailure("Editor draft Save attempt changed") }
        try DurableFile.remove(url)
    }

    func discard(sessionID: String) throws {
        guard let current = try read(), current.snapshot.sessionID == sessionID,
              current.attempt == nil else { throw HostFailure("Editor draft is not editable") }
        try DurableFile.remove(url)
    }

    func discardCorrupt() throws {
        do {
            _ = try read()
            throw HostFailure("Editor draft is valid; reload before discarding")
        } catch EditorDraftStoreError.corrupt {
            try DurableFile.remove(url)
        }
    }
}
