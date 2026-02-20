import SwiftUI
import AVKit

struct PlaybackView: View {
    let memo: VoiceMemo
    @State private var audioPlayer: AVAudioPlayer?
    @State private var isPlaying = false
    
    var body: some View {
        VStack(spacing: 32) {
            Image(systemName: "waveform")
                .resizable()
                .scaledToFit()
                .frame(width: 80)
                .foregroundColor(.accentColor)
                .symbolEffect(.pulse, options: .repeating, isActive: isPlaying)
            
            VStack {
                Text(memo.createdAt, style: .date)
                    .font(.title)
            }
            
            Button(action: togglePlayback) {
                Image(systemName: isPlaying ? "pause.circle.fill" : "play.circle.fill")
                    .resizable()
                    .frame(width: 80, height: 80)
                    .foregroundColor(.accentColor)
            }
        }
        .padding()
        .onDisappear {
            audioPlayer?.stop()
        }
    }
    
    private func togglePlayback() {
        if isPlaying {
            audioPlayer?.pause()
            isPlaying = false
        } else {
            do {
                if audioPlayer == nil {
                    audioPlayer = try AVAudioPlayer(contentsOf: memo.url)
                    audioPlayer?.prepareToPlay()
                }
                audioPlayer?.play()
                isPlaying = true
            } catch {
                print("Could not play audio: \(error.localizedDescription)")
            }
        }
    }
}
