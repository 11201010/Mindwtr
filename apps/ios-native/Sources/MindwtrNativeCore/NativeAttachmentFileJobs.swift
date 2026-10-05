import Foundation

/// A primitive cancellation flag may cross queues; a JS value never does.
final class NativeAttachmentCancellation: @unchecked Sendable {
    private let lock = NSLock()
    private var cancelled = false
    func cancel() { lock.lock(); cancelled = true; lock.unlock() }
    var isCancelled: Bool { lock.lock(); defer { lock.unlock() }; return cancelled }
    func check() throws { if isCancelled { throw NativeAttachmentFileJobsError.cancelled } }
}

final class NativeAttachmentLocalRequests: @unchecked Sendable {
    private let lock = NSLock()
    private var tokens: [UUID: NativeAttachmentCancellation] = [:]
    private var closing = false
    func register(_ token: NativeAttachmentCancellation, id: UUID) {
        lock.lock(); defer { lock.unlock() }
        if closing { token.cancel() }
        tokens[id] = token
    }
    func remove(_ id: UUID) { lock.lock(); tokens.removeValue(forKey: id); lock.unlock() }
    func close() {
        lock.lock(); closing = true; let current = Array(tokens.values); lock.unlock()
        current.forEach { $0.cancel() }
    }
}

#if DEBUG
final class NativeAttachmentHostHooks: @unchecked Sendable {
    var configureJobs: ((NativeAttachmentFileJobs) -> Void)?
    var pump: (() -> Void)?
}
#endif

enum NativeAttachmentFileJobsError: LocalizedError {
    case unavailable, capacity, cancelled
    var errorDescription: String? {
        switch self {
        case .unavailable: return "Attachment file operation is unavailable"
        case .capacity: return "Attachment file bridge capacity is unavailable"
        case .cancelled: return "Attachment file operation was cancelled"
        }
    }
}

/// Swift-only FIFO and mailbox. The engine takes serialized replies itself,
/// including while its synchronous JSC invoke occupies the engine queue.
final class NativeAttachmentFileJobs: @unchecked Sendable {
    static let maximumJobs = 16
    static let maximumReservedBytes = 48 * 1024 * 1024
    private struct Job {
        let token: NativeAttachmentCancellation
        let reserved: Int
    }
    private struct Answer {
        let id: String
        let json: String
        let body: String?
    }
    private let files: NativeAttachmentFiles
    private let installer: NativeAttachmentInstaller
    private let queue = DispatchQueue(label: "tech.dongdongbh.mindwtr.attachment-files", qos: .userInitiated)
    private let lock = NSLock()
    private let mutationLock = NSLock()
    private var jobs: [String: Job] = [:]
    private var answers: [Answer] = []
    private var taken: Answer?
    private var nextID: UInt64 = 0
    private var reservedBytes = 0
    private var accepting = true
    private var wake: (@Sendable () -> Void)?
    #if DEBUG
    /// Set before submitting work. Hooks run on the file queue, never on JSC.
    var beforeWork: ((String, Bool) throws -> Void)?
    var afterWork: ((String, Bool) -> Void)?
    var beforeFilePublish: (() throws -> Void)? {
        get { files.beforePublish }
        set { files.beforePublish = newValue }
    }
    var counters: (jobs: Int, bytes: Int) {
        lock.lock(); defer { lock.unlock() }; return (jobs.count, reservedBytes)
    }
    #endif

    init(libraryRoot: URL) throws {
        files = try NativeAttachmentFiles(libraryRoot: libraryRoot)
        installer = try NativeAttachmentInstaller(managedRoot: files.managedRoot, sourceRoots: files.sourceRoots)
    }
    var directoriesJSON: String { files.directoriesJSON }
    func setWake(_ callback: (@Sendable () -> Void)?) { lock.lock(); wake = callback; lock.unlock() }

    func submit(_ json: String, installer isInstaller: Bool = false) throws -> String {
        let count = json.utf8.count
        guard count <= (isInstaller ? 64 * 1024 : 24 * 1024 * 1024) else { throw NativeAttachmentFileJobsError.capacity }
        // Only small requests can return bytes. Large frames are base64 writes
        // or will be refused by the adapter, without allocating on this queue.
        var replyReservation = 64 * 1024
        if !isInstaller, count <= 64 * 1024,
           let value = try? NativeJSON.jsonObject(with: Data(json.utf8)) as? [String: Any],
           let op = value["op"] as? String, ["readBytes", "readBytesRange", "readDirectory"].contains(op) {
            replyReservation = NativeAttachmentFiles.maximumBytes
        }
        let reservation = count + replyReservation
        lock.lock()
        guard accepting, jobs.count < Self.maximumJobs,
              reservation <= Self.maximumReservedBytes - reservedBytes, nextID < UInt64.max else {
            lock.unlock(); throw NativeAttachmentFileJobsError.capacity
        }
        nextID += 1
        let id = String(nextID), token = NativeAttachmentCancellation()
        jobs[id] = Job(token: token, reserved: reservation)
        reservedBytes += reservation
        queue.async { [self] in
            let answer: Answer
            do {
                try token.check()
                #if DEBUG
                try beforeWork?(id, isInstaller)
                #endif
                try token.check()
                mutationLock.lock()
                defer { mutationLock.unlock() }
                let value: Any
                let bytes: Data?
                if isInstaller {
                    // Once begun the RN installer must finish; cancellation
                    // cannot undo publication or release the library early.
                    value = try NativeJSON.jsonObject(with: Data(installer.handle(json).utf8))
                    bytes = nil
                } else {
                    let reply = try files.call(json, checkCancellation: token.check)
                    value = reply.value ?? NSNull(); bytes = reply.bytes
                }
                var envelope: [String: Any] = ["id": id, "value": value]
                if bytes != nil { envelope["body"] = true }
                let encoded = try JSONSerialization.data(withJSONObject: envelope, options: [.sortedKeys])
                guard encoded.count <= replyReservation else { throw NativeAttachmentFileJobsError.capacity }
                answer = Answer(id: id, json: String(decoding: encoded, as: UTF8.self), body: bytes?.base64EncodedString())
            } catch {
                let message: String
                if let fixed = error as? NativeAttachmentFilesError { message = fixed.localizedDescription }
                else if let fixed = error as? NativeAttachmentInstallerError { message = fixed.localizedDescription }
                else if let fixed = error as? NativeAttachmentFileJobsError { message = fixed.localizedDescription }
                else { message = NativeAttachmentFileJobsError.unavailable.localizedDescription }
                let envelope = ["id": id, "error": message]
                let encoded = try! JSONSerialization.data(withJSONObject: envelope, options: [.sortedKeys])
                answer = Answer(id: id, json: String(decoding: encoded, as: UTF8.self), body: nil)
            }
            #if DEBUG
            afterWork?(id, isInstaller)
            #endif
            lock.lock(); answers.append(answer); let callback = wake; lock.unlock()
            callback?()
        }
        lock.unlock()
        return id
    }

    func abort(_ id: String) { lock.lock(); let token = jobs[id]?.token; lock.unlock(); token?.cancel() }
    func next() -> String {
        lock.lock(); defer { lock.unlock() }
        // The polyfill takes a body immediately after its metadata. Retain its
        // admission reservation until that body is actually consumed.
        guard taken == nil, !answers.isEmpty else { return "" }
        let answer = answers.removeFirst()
        if answer.body != nil { taken = answer } else { release(answer.id) }
        return answer.json
    }
    func body() -> String {
        lock.lock(); defer { lock.unlock() }
        guard let answer = taken else { return "" }
        taken = nil; release(answer.id); return answer.body ?? ""
    }
    private func release(_ id: String) {
        if let job = jobs.removeValue(forKey: id) { reservedBytes -= job.reserved }
    }
    func deleteNow(_ uri: String) throws {
        mutationLock.lock(); defer { mutationLock.unlock() }
        try files.deleteNow(uri)
    }
    func drain() { queue.sync {} }
    func cancelAndDrain() {
        lock.lock(); let tokens = jobs.values.map(\.token); lock.unlock()
        tokens.forEach { $0.cancel() }; drain()
    }
    func shutdown() {
        lock.lock(); accepting = false; wake = nil; lock.unlock()
        cancelAndDrain()
        lock.lock(); answers.removeAll(); taken = nil; jobs.removeAll(); reservedBytes = 0; lock.unlock()
    }
}
