import XCTest
@testable import AppleClarificationRequestRegistry

final class AppleClarificationRequestRegistryTests: XCTestCase {
    func testDuplicateRequestIdIsRejectedWithoutReplacingOriginal() throws {
        let registry = AppleClarificationRequestRegistry<String>()
        let originalToken = try XCTUnwrap(registry.reserve("original", for: "request-1"))

        XCTAssertNil(registry.reserve("replacement", for: "request-1"))
        XCTAssertEqual(registry.value(for: "request-1"), "original")
        XCTAssertEqual(registry.remove("request-1", token: originalToken), "original")
    }

    func testRemovalRequiresTheReservationIdentity() throws {
        let registry = AppleClarificationRequestRegistry<String>()
        let token = try XCTUnwrap(registry.reserve("value", for: "request-1"))

        XCTAssertNil(registry.remove("request-1", token: UUID()))
        XCTAssertEqual(registry.value(for: "request-1"), "value")
        XCTAssertEqual(registry.remove("request-1", token: token), "value")
        XCTAssertNil(registry.value(for: "request-1"))
    }

    func testRemoveAllReturnsEveryActiveValueForCancellation() {
        let registry = AppleClarificationRequestRegistry<String>()
        XCTAssertNotNil(registry.reserve("first", for: "request-1"))
        XCTAssertNotNil(registry.reserve("second", for: "request-2"))

        XCTAssertEqual(Set(registry.removeAll()), Set(["first", "second"]))
        XCTAssertNil(registry.value(for: "request-1"))
        XCTAssertNil(registry.value(for: "request-2"))
    }
}
