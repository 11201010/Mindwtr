import XCTest
@testable import AppleClarificationRequestRegistry

final class AppleClarificationRequestRegistryTests: XCTestCase {
    func testDuplicateRequestIdIsRejectedWithoutReplacingOriginal() throws {
        let registry = AppleClarificationRequestRegistry<String>()
        guard case .reserved(let originalToken, _) = registry.reserve(
            for: "request-1",
            createValue: { "original" }
        ) else {
            return XCTFail("Expected the original request to be reserved")
        }

        guard case .duplicate = registry.reserve(
            for: "request-1",
            createValue: { "replacement" }
        ) else {
            return XCTFail("Expected the duplicate request to be rejected")
        }
        XCTAssertEqual(registry.value(for: "request-1"), "original")
        XCTAssertEqual(registry.remove("request-1", token: originalToken), "original")
    }

    func testRemovalRequiresTheReservationIdentity() throws {
        let registry = AppleClarificationRequestRegistry<String>()
        guard case .reserved(let token, _) = registry.reserve(
            for: "request-1",
            createValue: { "value" }
        ) else {
            return XCTFail("Expected the request to be reserved")
        }

        XCTAssertNil(registry.remove("request-1", token: UUID()))
        XCTAssertEqual(registry.value(for: "request-1"), "value")
        XCTAssertEqual(registry.remove("request-1", token: token), "value")
        XCTAssertNil(registry.value(for: "request-1"))
    }

    func testRemoveAllReturnsEveryActiveValueForCancellation() {
        let registry = AppleClarificationRequestRegistry<String>()
        guard case .reserved = registry.reserve(for: "request-1", createValue: { "first" }),
              case .reserved = registry.reserve(for: "request-2", createValue: { "second" }) else {
            return XCTFail("Expected both requests to be reserved")
        }

        XCTAssertEqual(Set(registry.removeAll()), Set(["first", "second"]))
        XCTAssertNil(registry.value(for: "request-1"))
        XCTAssertNil(registry.value(for: "request-2"))
    }

    func testCancelBeforeReserveRejectsWithoutCreatingValueAndIsOneShot() {
        let registry = AppleClarificationRequestRegistry<String>()
        var factoryCallCount = 0

        XCTAssertNil(registry.cancel("request-1"))
        guard case .cancelledBeforeReservation = registry.reserve(
            for: "request-1",
            createValue: {
                factoryCallCount += 1
                return "must-not-start"
            }
        ) else {
            return XCTFail("Expected cancel-before-reserve ordering to reject the request")
        }
        XCTAssertEqual(factoryCallCount, 0)

        guard case .reserved(_, let value) = registry.reserve(
            for: "request-1",
            createValue: {
                factoryCallCount += 1
                return "next-request"
            }
        ) else {
            return XCTFail("Expected the cancellation tombstone to be consumed once")
        }
        XCTAssertEqual(value, "next-request")
        XCTAssertEqual(factoryCallCount, 1)
    }

    func testReserveBeforeCancelReturnsTheRegisteredValue() {
        let registry = AppleClarificationRequestRegistry<String>()
        guard case .reserved = registry.reserve(for: "request-1", createValue: { "active" }) else {
            return XCTFail("Expected the request to be reserved")
        }

        XCTAssertEqual(registry.cancel("request-1"), "active")
    }

    func testPendingCancellationRetentionIsBounded() {
        let registry = AppleClarificationRequestRegistry<String>(maxPendingCancellationCount: 2)
        XCTAssertNil(registry.cancel("request-1"))
        XCTAssertNil(registry.cancel("request-2"))
        XCTAssertNil(registry.cancel("request-3"))

        guard case .reserved = registry.reserve(for: "request-1", createValue: { "evicted" }) else {
            return XCTFail("Expected the oldest tombstone to be evicted")
        }
        guard case .cancelledBeforeReservation = registry.reserve(
            for: "request-2",
            createValue: { "must-not-start" }
        ) else {
            return XCTFail("Expected a retained tombstone to reject registration")
        }
        guard case .cancelledBeforeReservation = registry.reserve(
            for: "request-3",
            createValue: { "must-not-start" }
        ) else {
            return XCTFail("Expected the newest tombstone to reject registration")
        }
    }
}
