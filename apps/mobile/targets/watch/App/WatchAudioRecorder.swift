import AVFoundation
import Foundation

@MainActor
final class MindwtrWatchAudioRecorder: NSObject, ObservableObject, AVAudioRecorderDelegate {
    @Published private(set) var isRecording = false
    @Published private(set) var errorMessage: String?

    private var recorder: AVAudioRecorder?
    private var recordingId: UUID?
    private var createdAt: Date?
    private weak var connectivity: MindwtrWatchConnectivityModel?

    func toggle(using connectivity: MindwtrWatchConnectivityModel) {
        isRecording ? stopAndTransfer(using: connectivity) : start(using: connectivity)
    }

    private func start(using connectivity: MindwtrWatchConnectivityModel) {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement)
            try session.setActive(true)

            let id = UUID()
            let startedAt = Date()
            let url = try MindwtrWatchOutbox.prepareAudioURL(id: id)
            let settings: [String: Any] = [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: 16_000,
                AVNumberOfChannelsKey: 1,
                AVEncoderBitRateKey: 32_000,
                AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
            ]
            let recorder = try AVAudioRecorder(url: url, settings: settings)
            recorder.delegate = self
            recorder.prepareToRecord()
            guard recorder.record(forDuration: 120) else { throw RecordingError.couldNotStart }
            self.recorder = recorder
            recordingId = id
            createdAt = startedAt
            self.connectivity = connectivity
            isRecording = true
            errorMessage = nil
        } catch {
            errorMessage = String(localized: "Couldn’t start recording.")
            isRecording = false
        }
    }

    private func stopAndTransfer(using connectivity: MindwtrWatchConnectivityModel) {
        guard let recorder, recordingId != nil, createdAt != nil else { return }
        recorder.stop()
        finishAndTransfer(recorder: recorder, using: connectivity)
    }

    private func finishAndTransfer(recorder: AVAudioRecorder, using connectivity: MindwtrWatchConnectivityModel) {
        guard let recordingId, let createdAt else { return }
        isRecording = false
        self.recorder = nil
        self.recordingId = nil
        self.createdAt = nil
        connectivity.transferAudio(fileURL: recorder.url, id: recordingId, createdAt: createdAt)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    nonisolated func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            if flag, let connectivity = self.connectivity {
                self.finishAndTransfer(recorder: recorder, using: connectivity)
            } else {
                self.failRecording()
            }
        }
    }

    nonisolated func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
        Task { @MainActor [weak self] in
            self?.failRecording()
        }
    }

    private func failRecording() {
        isRecording = false
        recorder = nil
        recordingId = nil
        createdAt = nil
        errorMessage = String(localized: "Recording stopped unexpectedly.")
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private enum RecordingError: Error {
        case couldNotStart
    }
}
