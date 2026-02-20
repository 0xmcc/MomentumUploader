import SwiftUI

struct ContentView: View {
    @EnvironmentObject var memoStore: MemoStore
    @EnvironmentObject var recordingManager: RecordingManager
    @EnvironmentObject var uploader: Uploader
    
    // Size class adaptation
    @Environment(\.horizontalSizeClass) var horizontalSizeClass
    
    var body: some View {
        NavigationSplitView {
            MemoList()
                .navigationTitle("Momentum Memos")
        } detail: {
            if let first = memoStore.memos.first {
                PlaybackView(memo: first)
            } else {
                ContentUnavailableView("No Memos", systemImage: "mic.slash", description: Text("Record your first memo!"))
            }
        }
        .safeAreaInset(edge: .bottom) {
            recordingControls
        }
    }
    
    private var recordingControls: some View {
        VStack {
            if recordingManager.isRecording {
                Text(timeString(time: recordingManager.recordingDuration))
                    .font(.system(.title, design: .monospaced))
                    .foregroundColor(.red)
                    .padding(.bottom, 8)
            }
            
            Button(action: {
                if recordingManager.isRecording {
                    recordingManager.stopRecording()
                } else {
                    recordingManager.startRecording { url in
                        // After saving locally immediately
                        memoStore.memoSaved(at: url)
                        // Trigger background upload
                        uploader.enqueueUpload(for: url)
                    }
                }
            }) {
                ZStack {
                    Circle()
                        .strokeBorder(Color.primary.opacity(0.1), lineWidth: 4)
                        .frame(width: 80, height: 80)
                    
                    Circle()
                        .fill(recordingManager.isRecording ? Color.red : Color.blue)
                        .frame(width: recordingManager.isRecording ? 40 : 64, height: recordingManager.isRecording ? 40 : 64)
                        .cornerRadius(recordingManager.isRecording ? 8 : 32)
                        .animation(.spring(), value: recordingManager.isRecording)
                }
            }
            .buttonStyle(PlainButtonStyle())
        }
        .padding()
        .background(.ultraThinMaterial)
    }
    
    // Formatting Helper
    private func timeString(time: TimeInterval) -> String {
        let minutes = Int(time) / 60 % 60
        let seconds = Int(time) % 60
        let deciseconds = Int((time - Double(Int(time))) * 10)
        return String(format: "%02i:%02i.%i", minutes, seconds, deciseconds)
    }
}
