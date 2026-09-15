import Foundation

enum AppleImageCaptureError: Error, LocalizedError {
    case invalidOperation
    case invalidImage
    case inputTooLarge
    case pixelBoundsExceeded
    case cancelled

    var errorDescription: String? {
        switch self {
        case .invalidOperation: return "APPLE_IMAGE_INVALID_OPERATION"
        case .invalidImage: return "APPLE_IMAGE_INVALID_IMAGE"
        case .inputTooLarge: return "APPLE_IMAGE_INPUT_TOO_LARGE"
        case .pixelBoundsExceeded: return "APPLE_IMAGE_PIXEL_BOUNDS_EXCEEDED"
        case .cancelled: return "APPLE_IMAGE_CANCELLED"
        }
    }
}

struct AppleImageBounds {
    static let maxInputBytes = 12 * 1024 * 1024
    static let maxPixelCount = 24_000_000
    static let maxDimension = 8_192
    static let analysisDimension = 2_048

    static func validateInputBytes(_ inputBytes: Int) throws {
        guard inputBytes > 0 else { throw AppleImageCaptureError.invalidImage }
        guard inputBytes <= maxInputBytes else { throw AppleImageCaptureError.inputTooLarge }
    }

    static func validatePixels(width: Int, height: Int) throws {
        guard width > 0, height > 0 else { throw AppleImageCaptureError.invalidImage }
        guard width <= maxDimension, height <= maxDimension else {
            throw AppleImageCaptureError.pixelBoundsExceeded
        }
        let (pixelCount, overflow) = width.multipliedReportingOverflow(by: height)
        guard !overflow, pixelCount <= maxPixelCount else {
            throw AppleImageCaptureError.pixelBoundsExceeded
        }
    }

    static func validate(inputBytes: Int, width: Int, height: Int) throws {
        try validateInputBytes(inputBytes)
        try validatePixels(width: width, height: height)
    }
}
