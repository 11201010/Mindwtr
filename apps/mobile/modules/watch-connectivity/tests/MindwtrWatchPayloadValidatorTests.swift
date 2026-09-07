import Foundation
import XCTest
@testable import MindwtrWatchPayloadValidation

final class MindwtrWatchPayloadValidatorTests: XCTestCase {
    private let id = "9D8A4448-255F-4C49-A40B-1855FA86BE2D"

    func testNormalizesTextCaptureAndCanonicalizesUUID() throws {
        let validated = try MindwtrWatchPayloadValidator.validateTransport([
            "protocolVersion": 1,
            "id": id,
            "createdAt": "2026-09-06T15:04:05.123Z",
            "source": "apple-watch",
            "kind": "text",
            "title": "  Call Sam  ",
        ])

        XCTAssertEqual(validated.id, id.lowercased())
        XCTAssertEqual(validated.kind, .text)
        XCTAssertEqual(validated.queuePayload["title"] as? String, "Call Sam")
        XCTAssertEqual(validated.queuePayload["protocolVersion"] as? Int, 1)
    }

    func testRejectsUnknownFieldsAndProtocolKinds() {
        var payload = basePayload(kind: "text")
        payload["title"] = "Capture"
        payload["unexpected"] = "ignored only by unsafe implementations"
        XCTAssertThrowsError(try MindwtrWatchPayloadValidator.validateTransport(payload))

        payload = basePayload(kind: "delete")
        XCTAssertThrowsError(try MindwtrWatchPayloadValidator.validateTransport(payload))
    }

    func testRejectsInvalidAndOutOfRangeDates() {
        var payload = basePayload(kind: "defer")
        payload["taskId"] = "task-1"
        payload["startDate"] = "2026-02-29"
        XCTAssertThrowsError(try MindwtrWatchPayloadValidator.validateTransport(payload))

        payload["startDate"] = "2028-02-29"
        XCTAssertNoThrow(try MindwtrWatchPayloadValidator.validateTransport(payload))

        payload["createdAt"] = "1999-12-31T23:59:59Z"
        XCTAssertThrowsError(try MindwtrWatchPayloadValidator.validateTransport(payload))
    }

    func testValidatesEveryCommandKind() throws {
        var complete = basePayload(kind: "complete")
        complete["taskId"] = "task-1"
        XCTAssertEqual(
            try MindwtrWatchPayloadValidator.validateTransport(complete).kind,
            .complete
        )

        var pomodoro = basePayload(kind: "pomodoro")
        pomodoro["action"] = "pause"
        XCTAssertEqual(
            try MindwtrWatchPayloadValidator.validateTransport(pomodoro).kind,
            .pomodoro
        )

        pomodoro["action"] = "finish"
        XCTAssertThrowsError(try MindwtrWatchPayloadValidator.validateTransport(pomodoro))
    }

    func testApplicationContextStripsNullsAndKeepsPropertyListShape() throws {
        let normalized = try MindwtrWatchPayloadValidator.normalizeApplicationContext([
            "protocolVersion": 1,
            "generatedAt": "2026-09-06T15:04:05Z",
            "focus": [["id": "task-1", "title": "One"]],
            "pomodoro": [
                "phase": "focus",
                "isRunning": false,
                "remainingSeconds": 1_500,
                "completionAlert": true,
                "phaseEndTime": NSNull(),
                "taskId": NSNull(),
                "taskTitle": NSNull(),
            ],
        ])

        let pomodoro = try XCTUnwrap(normalized["pomodoro"] as? [String: Any])
        XCTAssertNil(pomodoro["phaseEndTime"])
        XCTAssertNil(pomodoro["taskId"])
        XCTAssertEqual(pomodoro["completionAlert"] as? Bool, true)
        XCTAssertTrue(PropertyListSerialization.propertyList(normalized, isValidFor: .binary))
    }

    func testApplicationContextEnforcesFocusAndTitleBounds() {
        let focus = (0...MindwtrWatchPayloadValidator.maxFocusTasks).map {
            ["id": "task-\($0)", "title": "Task \($0)"]
        }
        XCTAssertThrowsError(try MindwtrWatchPayloadValidator.normalizeApplicationContext([
            "protocolVersion": 1,
            "generatedAt": "2026-09-06T15:04:05Z",
            "focus": focus,
            "pomodoro": [
                "phase": "break",
                "isRunning": true,
                "remainingSeconds": 300,
            ],
        ]))
    }

    private func basePayload(kind: String) -> [String: Any] {
        [
            "protocolVersion": 1,
            "id": id,
            "createdAt": "2026-09-06T15:04:05Z",
            "source": "apple-watch",
            "kind": kind,
        ]
    }
}
