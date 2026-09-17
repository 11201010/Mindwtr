import XCTest
@testable import AppleClarificationRequestRegistry

final class ApplePccEvaluationEngineTests: XCTestCase {
    func testFixturesAreFixedSyntheticAndBounded() throws {
        XCTAssertEqual(
            ApplePccEvaluationEngine.fixtures.map(\.fixtureId),
            [.smoke, .projectPlanning]
        )
        for fixture in ApplePccEvaluationEngine.fixtures {
            XCTAssertFalse(fixture.text.isEmpty)
            XCTAssertLessThanOrEqual(fixture.text.count, 2_000)
            XCTAssertTrue(fixture.text.lowercased().contains("synthetic"))
        }
    }

    func testBoundedSuggestionAcceptsAtMostThreeShortActions() throws {
        let result = ApplePccEvaluationEngine.boundedSuggestion(
            summary: "  A bounded summary.  ",
            nextActions: [" Confirm the room. ", "Ask about accessibility."],
            contextSize: 32_000
        )

        XCTAssertEqual(result.outcome, "completed")
        XCTAssertEqual(result.summary, "A bounded summary.")
        XCTAssertEqual(result.nextActions, ["Confirm the room.", "Ask about accessibility."])
        XCTAssertEqual(result.contextSize, 32_000)
    }

    func testBoundedSuggestionRejectsEmptyOrOversizedOutput() throws {
        XCTAssertEqual(
            ApplePccEvaluationEngine.boundedSuggestion(
                summary: "",
                nextActions: [],
                contextSize: nil
            ).outcome,
            "malformed_output"
        )
        XCTAssertEqual(
            ApplePccEvaluationEngine.boundedSuggestion(
                summary: "Summary",
                nextActions: ["One", "Two", "Three", "Four"],
                contextSize: nil
            ).outcome,
            "malformed_output"
        )
    }
}
