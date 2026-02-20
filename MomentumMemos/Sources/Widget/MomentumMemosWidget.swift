import WidgetKit
import SwiftUI

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> MomentumEntry {
        MomentumEntry(date: Date(), configuration: ConfigurationAppIntent())
    }

    func getSnapshot(in context: Context, completion: @escaping (MomentumEntry) -> ()) {
        let entry = MomentumEntry(date: Date(), configuration: ConfigurationAppIntent())
        completion(entry)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> ()) {
        let entries = [MomentumEntry(date: Date(), configuration: ConfigurationAppIntent())]
        let timeline = Timeline(entries: entries, policy: .never)
        completion(timeline)
    }
}

struct MomentumEntry: TimelineEntry {
    let date: Date
    let configuration: ConfigurationAppIntent
}

struct ConfigurationAppIntent: AppIntent {
    static var title: LocalizedStringResource = "Momentum Widget"
    static var description = IntentDescription("Shows immediate access to your memos")
}

struct MomentumWidgetEntryView : View {
    var entry: Provider.Entry

    var body: some View {
        VStack {
            Image(systemName: "mic.fill")
                .foregroundColor(.red)
                .font(.system(size: 30))
            Text("Record")
                .font(.caption)
        }
        .containerBackground(for: .widget) {
            Color.secondary.opacity(0.1)
        }
    }
}

@main
struct MomentumMemosWidget: Widget {
    let kind: String = "MomentumMemosWidget"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: kind, intent: ConfigurationAppIntent.self, provider: Provider()) { entry in
            MomentumWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Momentum Memos")
        .description("Quick recording access from your Home Screen.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
