import Foundation
import Combine

class Uploader: NSObject, ObservableObject, URLSessionDataDelegate, URLSessionTaskDelegate {
    private var session: URLSession!
    private var store: MemoStore?
    private var callbacks: [Int: URL] = [:]
    private var receivedData: [Int: Data] = [:]
    
    override init() {
        super.init()
        let config = URLSessionConfiguration.default
        self.session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }
    
    func setupStore(_ store: MemoStore) {
        self.store = store
    }
    
    func enqueueUpload(for fileURL: URL) {
        let filename = fileURL.lastPathComponent
        let storageUrlString = "\(Env.supabaseUrl)/storage/v1/object/voice-memos/audio/\(filename)"
        guard let apiURL = URL(string: storageUrlString) else { return }
        
        var request = URLRequest(url: apiURL)
        request.httpMethod = "POST"
        request.setValue("audio/x-m4a", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(Env.supabaseAnonKey)", forHTTPHeaderField: "Authorization")
        request.setValue(Env.supabaseAnonKey, forHTTPHeaderField: "apikey")
        
        let task = session.uploadTask(with: request, fromFile: fileURL)
        callbacks[task.taskIdentifier] = fileURL
        task.resume()
    }
    
    // MARK: - URLSession Delegates
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        if receivedData[dataTask.taskIdentifier] == nil {
            receivedData[dataTask.taskIdentifier] = Data()
        }
        receivedData[dataTask.taskIdentifier]?.append(data)
    }
    
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let fileURL = callbacks[task.taskIdentifier] else { return }
        callbacks.removeValue(forKey: task.taskIdentifier)
        
        DispatchQueue.main.async {
            if let error = error {
                print("Upload failed: \(error)")
                return
            }
            
            if let httpResp = task.response as? HTTPURLResponse, !(200...299).contains(httpResp.statusCode) {
                print("Upload failed with HTTP status: \(httpResp.statusCode)")
                return
            }
            
            // Upload successful, write metadata row
            self.writeMetadata(for: fileURL)
            self.receivedData.removeValue(forKey: task.taskIdentifier)
        }
    }
    
    private func writeMetadata(for fileURL: URL) {
        let filename = fileURL.lastPathComponent
        guard let apiURL = URL(string: "\(Env.supabaseUrl)/rest/v1/memos") else { return }
        
        var request = URLRequest(url: apiURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(Env.supabaseAnonKey)", forHTTPHeaderField: "Authorization")
        request.setValue(Env.supabaseAnonKey, forHTTPHeaderField: "apikey")
        
        let fileUrlString = "\(Env.supabaseUrl)/storage/v1/object/public/voice-memos/audio/\(filename)"
        
        let payload: [String: Any] = [
            "title": "Voice Memo",
            "transcript": "",
            "audio_url": fileUrlString
        ]
        
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: payload)
            
            let dataTask = URLSession.shared.dataTask(with: request) { _, resp, err in
                DispatchQueue.main.async {
                    if let err = err {
                        print("Metadata insert failed: \(err)")
                    } else if let httpResp = resp as? HTTPURLResponse, !(200...299).contains(httpResp.statusCode) {
                        print("Metadata insert failed with HTTP \(httpResp.statusCode)")
                    } else {
                        print("Metadata inserted successfully.")
                        self.store?.saveMetadata(for: fileURL, title: "Voice Memo", transcript: "")
                        self.store?.markUploaded(fileURL)
                    }
                }
            }
            dataTask.resume()
        } catch {
            print("Failed to encode JSON payload: \(error)")
        }
    }
}
