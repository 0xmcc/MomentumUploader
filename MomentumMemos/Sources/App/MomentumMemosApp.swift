import SwiftUI
import AppIntents

@main
struct MomentumMemosApp: App {
    @StateObject private var memoStore = MemoStore()
    @StateObject private var recordingManager = RecordingManager()
    @StateObject private var uploader = Uploader()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(memoStore)
                .environmentObject(recordingManager)
                .environmentObject(uploader)
                .onAppear {
                    // Start uploader observation
                    uploader.setupStore(memoStore)
                }
        }
    }
}
