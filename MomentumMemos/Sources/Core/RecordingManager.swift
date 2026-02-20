import Foundation
import AVFoundation
import Combine

class RecordingManager: NSObject, ObservableObject, AVAudioRecorderDelegate {
    @Published var isRecording = false
    @Published var recordingDuration: TimeInterval = 0
    
    private var audioRecorder: AVAudioRecorder?
    private var timer: Timer?
    var onSave: ((URL) -> Void)?
    
    private var documentsDirectory: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }
    
    override init() {
        super.init()
        setupSession()
    }
    
    private func setupSession() {
        // Set up the AVAudioSession for background recording compatibility
        #if os(iOS)
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .default, options: [.allowBluetooth, .defaultToSpeaker])
            try session.setActive(true)
        } catch {
            print("Failed to set up audio session: \(error)")
        }
        #endif
    }
    
    func toggleRecording(onSave: @escaping (URL) -> Void) {
        if isRecording {
            stopRecording()
        } else {
            startRecording(onSave: onSave)
        }
    }
    
    func startRecording(onSave: @escaping (URL) -> Void) {
        #if os(iOS)
        AVAudioSession.sharedInstance().requestRecordPermission { [weak self] allowed in
            DispatchQueue.main.async {
                if allowed {
                    self?.beginRecording(onSave: onSave)
                } else {
                    print("Recording permission denied")
                }
            }
        }
        #else
        // macOS permission check
        beginRecording(onSave: onSave)
        #endif
    }
    
    private func beginRecording(onSave: @escaping (URL) -> Void) {
        self.onSave = onSave
        let filename = documentsDirectory.appendingPathComponent(UUID().uuidString + ".m4a")
        
        // High quality AAC formatting natively supported by Apple everywhere
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
        ]
        
        do {
            audioRecorder = try AVAudioRecorder(url: filename, settings: settings)
            audioRecorder?.delegate = self
            audioRecorder?.record()
            
            isRecording = true
            recordingDuration = 0
            
            timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
                self?.recordingDuration += 0.1
            }
        } catch {
            print("Could not start recording: \(error)")
            isRecording = false
        }
    }
    
    func stopRecording() {
        audioRecorder?.stop()
        isRecording = false
        timer?.invalidate()
        timer = nil
    }
    
    // MARK: - AVAudioRecorderDelegate
    
    func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        if flag {
            // Saves locally immediately
            onSave?(recorder.url)
        }
    }
}
