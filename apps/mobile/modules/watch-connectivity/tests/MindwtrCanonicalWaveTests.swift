import AudioToolbox
import Foundation
import XCTest
@testable import MindwtrWatchPayloadValidation

final class MindwtrCanonicalWaveTests: XCTestCase {
    func testConversionClientFormatAlwaysTargetsWhisperPCM() {
        let format = MindwtrCanonicalWave.clientFormat()

        XCTAssertEqual(format.mSampleRate, 16_000)
        XCTAssertEqual(format.mFormatID, kAudioFormatLinearPCM)
        XCTAssertEqual(format.mChannelsPerFrame, 1)
        XCTAssertEqual(format.mBitsPerChannel, 16)
        XCTAssertEqual(format.mBytesPerFrame, 2)
        XCTAssertEqual(format.mBytesPerPacket, 2)
        XCTAssertEqual(format.mFramesPerPacket, 1)
        XCTAssertNotEqual(format.mFormatFlags & kAudioFormatFlagIsSignedInteger, 0)
        XCTAssertNotEqual(format.mFormatFlags & kAudioFormatFlagIsPacked, 0)
        XCTAssertEqual(format.mFormatFlags & kAudioFormatFlagIsBigEndian, 0)
    }

    func testBuildsExactWhisperCompatibleHeader() throws {
        let oneSecondDataBytes = Int(MindwtrCanonicalWave.byteRate)
        let header = try MindwtrCanonicalWave.header(dataByteCount: oneSecondDataBytes)

        XCTAssertEqual(header.count, 44)
        XCTAssertTrue(MindwtrCanonicalWave.validateHeader(
            header,
            fileSize: header.count + oneSecondDataBytes,
            maximumFileSize: 1_000_000
        ))
    }

    func testRejectsNonCanonicalSampleRateChannelsAndChunkLayout() throws {
        let dataByteCount = 32_000
        let fileSize = 44 + dataByteCount
        let canonical = try MindwtrCanonicalWave.header(dataByteCount: dataByteCount)

        var wrongRate = canonical
        wrongRate[24] = 0x44 // 44_100 Hz instead of 16_000
        wrongRate[25] = 0xAC
        XCTAssertFalse(MindwtrCanonicalWave.validateHeader(
            wrongRate,
            fileSize: fileSize,
            maximumFileSize: 1_000_000
        ))

        var stereo = canonical
        stereo[22] = 2
        XCTAssertFalse(MindwtrCanonicalWave.validateHeader(
            stereo,
            fileSize: fileSize,
            maximumFileSize: 1_000_000
        ))

        var nonCanonicalChunk = canonical
        nonCanonicalChunk.replaceSubrange(36..<40, with: Data("LIST".utf8))
        XCTAssertFalse(MindwtrCanonicalWave.validateHeader(
            nonCanonicalChunk,
            fileSize: fileSize,
            maximumFileSize: 1_000_000
        ))
    }

    func testRejectsHeaderWhoseDataSizeDoesNotMatchFile() throws {
        let header = try MindwtrCanonicalWave.header(dataByteCount: 32_000)
        XCTAssertFalse(MindwtrCanonicalWave.validateHeader(
            header,
            fileSize: header.count + 31_998,
            maximumFileSize: 1_000_000
        ))
    }
}
