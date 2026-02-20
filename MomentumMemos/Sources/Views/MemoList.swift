import SwiftUI

struct MemoList: View {
    @EnvironmentObject var memoStore: MemoStore
    
    var body: some View {
        List(memoStore.memos) { memo in
            NavigationLink(value: memo) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(memo.createdAt, style: .date)
                            .font(.headline)
                        Text(memo.createdAt, style: .time)
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    
                    Spacer()
                    
                    VStack(alignment: .trailing, spacing: 4) {
                        Text(formatDuration(memo.duration))
                            .font(.subheadline.monospacedDigit())
                        
                        // Show cloud icon if uploaded
                        Image(systemName: memo.isUploaded ? "icloud.fill" : "icloud.slash")
                            .foregroundColor(memo.isUploaded ? .blue : .gray)
                            .imageScale(.small)
                    }
                }
                .padding(.vertical, 4)
            }
        }
    }
    
    private func formatDuration(_ duration: TimeInterval) -> String {
        let min = Int(duration) / 60
        let sec = Int(duration) % 60
        return String(format: "%d:%02d", min, sec)
    }
}
