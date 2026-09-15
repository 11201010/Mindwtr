import Foundation

/// Small identity-checked registry for native inference tasks. Duplicate request
/// IDs are rejected, and an older task's defer cannot remove a newer entry.
final class AppleClarificationRequestRegistry<Value>: @unchecked Sendable {
    private struct Entry {
        let token: UUID
        let value: Value
    }

    private let lock = NSLock()
    private var entries: [String: Entry] = [:]

    func reserve(_ value: Value, for requestId: String) -> UUID? {
        lock.lock()
        defer { lock.unlock() }
        guard entries[requestId] == nil else { return nil }
        let token = UUID()
        entries[requestId] = Entry(token: token, value: value)
        return token
    }

    func value(for requestId: String) -> Value? {
        lock.lock()
        defer { lock.unlock() }
        return entries[requestId]?.value
    }

    @discardableResult
    func remove(_ requestId: String, token: UUID) -> Value? {
        lock.lock()
        defer { lock.unlock() }
        guard entries[requestId]?.token == token else { return nil }
        return entries.removeValue(forKey: requestId)?.value
    }

    func removeAll() -> [Value] {
        lock.lock()
        defer { lock.unlock() }
        let values = entries.values.map(\.value)
        entries.removeAll()
        return values
    }
}
