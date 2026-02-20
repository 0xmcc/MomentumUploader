import Foundation
import Combine

class Uploader: NSObject, ObservableObject, URLSessionTaskDelegate {
    private var session: URLSession!
    private var store: MemoStore?
    private var uploadTasks: [URL: URLSessionUploadTask] = [:]
    
    override init() {
        super.init()
        
        // Use background session configuration for OS-level background uploads
        let config = URLSessionConfiguration.background(withIdentifier: "com.momentum.memos.uploadSession")
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true 
        self.session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }
    
    func setupStore(_ store: MemoStore) {
        self.store = store
    }
    
    // Called when a memo is newly recorded and saved.
    func enqueueUpload(for fileURL: URL) {
        guard !uploadTasks.keys.contains(fileURL) else { return }
        
        // Suppose we have an API endpoint to accept the chunk
        guard let apiURL = URL(string: "https://example.com/api/upload") else { return }
        
        var request = URLRequest(url: apiURL)
        request.httpMethod = "POST"
        request.setValue("audio/x-m4a", forHTTPHeaderField: "Content-Type")
        
        // This task is handed off to the OS daemon, runs background/locked
        let task = session.uploadTask(with: request, fromFile: fileURL)
        uploadTasks[fileURL] = task
        task.taskDescription = fileURL.path
        task.resume()
    }
    
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let description = task.taskDescription else { return }
        let url = URL(fileURLWithPath: description)
        
        DispatchQueue.main.async {
            self.uploadTasks.removeValue(forKey: url)
            if error == nil {
                // Upload successful
                self.store?.markUploaded(url)
            } else {
                print("Upload failed: \(error!)")
                // Could retry automatically here
            }
        }
    }
}
