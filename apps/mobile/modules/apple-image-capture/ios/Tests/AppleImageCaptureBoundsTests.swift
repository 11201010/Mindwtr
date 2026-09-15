import XCTest
@testable import AppleImageCapture

final class AppleImageCaptureBoundsTests: XCTestCase {
    func testAcceptsRepresentativeBoundedImage() throws {
        XCTAssertNoThrow(try AppleImageBounds.validate(inputBytes: 2_000_000, width: 3_024, height: 4_032))
    }

    func testRejectsOversizedInputBeforeDecode() {
        XCTAssertThrowsError(
            try AppleImageBounds.validateInputBytes(AppleImageBounds.maxInputBytes + 1)
        )
    }

    func testRejectsPixelBombAndExtremeDimension() {
        XCTAssertThrowsError(try AppleImageBounds.validate(inputBytes: 1_000, width: 8_000, height: 8_000))
        XCTAssertThrowsError(
            try AppleImageBounds.validate(
                inputBytes: 1_000,
                width: AppleImageBounds.maxDimension + 1,
                height: 1
            )
        )
    }
}
