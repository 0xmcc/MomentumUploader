import Foundation
import Combine
import AVFoundation

struct VoiceMemo: Identifiable, Codable, Equatable {
    var id: UUID
    var url: URL
    var createdAt: Date
    var duration: TimeInterval
    var isUploaded: Bool
}

class MemoStore: ObservableObject {
    @Published var memos: [VoiceMemo] = []
    
    // Use App Group container if you plan to share with Widgets/Intents
    // For single app, DocumentDirectory works. 
    // We recommend App Group for real widget sharing: FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.com.momentum.memos")
    private var documentsDirectory: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }
    
    init() {
        loadMemos()
    }
    
    func loadMemos() {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let files = try FileManager.default.contentsOfDirectory(at: self.documentsDirectory, includingPropertiesForKeys: [.creationDateKey, .fileSizeKey], options: .skipsHiddenFiles)
                let audioFiles = files.filter { $0.pathExtension == "m4a" }
                
                let loadedMemos = audioFiles.compactMap { url -> VoiceMemo? in
                    guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
                          let creationDate = attributes[.creationDate] as? Date else { return nil }
                    let asset = AVURLAsset(url: url)
                    let duration = CMTimeGetSeconds(asset.duration)
                    let isUploaded = UserDefaults.standard.bool(forKey: "uploaded_\(url.lastPathComponent)")
                    return VoiceMemo(id: UUID(), url: url, createdAt: creationDate, duration: duration.isNaN ? 0 : duration, isUploaded: isUploaded)
                }.sorted(by: { $0.createdAt > $1.createdAt })
                
                DispatchQueue.main.async {
                    self.memos = loadedMemos
                }
            } catch {
                print("Failed to load memos: \(error)")
            }
        }
    }
    
    func memoSaved(at url: URL) {
        // Called immediately when RecordingManager finishes saving the file
        loadMemos()
    }
    
    func markUploaded(_ url: URL) {
        UserDefaults.standard.set(true, forKey: "uploaded_\(url.lastPathComponent)")
        if let index = memos.firstIndex(where: { $0.url == url }) {
            memos[index].isUploaded = true
        }
    }
}
