import Foundation

enum AppleClarificationReservation<Value> {
    case reserved(token: UUID, value: Value)
    case duplicate
    case cancelledBeforeReservation
}

/// Small identity-checked registry for native inference tasks. Duplicate request
/// IDs are rejected, and an older task's defer cannot remove a newer entry.
/// Cancellation can arrive through the Expo bridge before registration; a
/// bounded, one-shot tombstone makes that ordering cancel the later reservation.
final class AppleClarificationRequestRegistry<Value>: @unchecked Sendable {
    private struct Entry {
        let token: UUID
        let value: Value
    }

    private let lock = NSLock()
    private var entries: [String: Entry] = [:]
    private var pendingCancellationIds: Set<String> = []
    private var pendingCancellationOrder: [String] = []
    private let maxPendingCancellationCount: Int

    init(maxPendingCancellationCount: Int = 128) {
        self.maxPendingCancellationCount = max(1, maxPendingCancellationCount)
    }

    /// The factory runs under the registry lock only after the request ID has
    /// passed duplicate and pending-cancellation checks. This ensures rejected
    /// requests cannot begin inference before their reservation result is known.
    func reserve(
        for requestId: String,
        createValue: () -> Value
    ) -> AppleClarificationReservation<Value> {
        lock.lock()
        defer { lock.unlock() }

        if pendingCancellationIds.remove(requestId) != nil {
            pendingCancellationOrder.removeAll { $0 == requestId }
            return .cancelledBeforeReservation
        }
        guard entries[requestId] == nil else { return .duplicate }

        let token = UUID()
        let value = createValue()
        entries[requestId] = Entry(token: token, value: value)
        return .reserved(token: token, value: value)
    }

    func value(for requestId: String) -> Value? {
        lock.lock()
        defer { lock.unlock() }
        return entries[requestId]?.value
    }

    /// Returns an active value for immediate cancellation. If registration has
    /// not happened yet, records a bounded one-shot cancellation tombstone.
    func cancel(_ requestId: String) -> Value? {
        lock.lock()
        defer { lock.unlock() }

        if let value = entries[requestId]?.value {
            return value
        }
        guard !pendingCancellationIds.contains(requestId) else { return nil }
        pendingCancellationIds.insert(requestId)
        pendingCancellationOrder.append(requestId)
        if pendingCancellationOrder.count > maxPendingCancellationCount {
            let evicted = pendingCancellationOrder.removeFirst()
            pendingCancellationIds.remove(evicted)
        }
        return nil
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
        pendingCancellationIds.removeAll()
        pendingCancellationOrder.removeAll()
        return values
    }
}
