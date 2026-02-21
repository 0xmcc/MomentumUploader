import WidgetKit
import SwiftUI
import AppIntents

struct Provider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> MomentumEntry {
        MomentumEntry(date: Date(), configuration: ConfigurationAppIntent())
    }

    func snapshot(for configuration: ConfigurationAppIntent, in context: Context) async -> MomentumEntry {
        MomentumEntry(date: Date(), configuration: configuration)
    }

    func timeline(for configuration: ConfigurationAppIntent, in context: Context) async -> Timeline<MomentumEntry> {
        let entries = [MomentumEntry(date: Date(), configuration: configuration)]
        return Timeline(entries: entries, policy: .never)
    }
}

struct MomentumEntry: TimelineEntry {
    let date: Date
    let configuration: ConfigurationAppIntent
}

struct ConfigurationAppIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Momentum Widget"
    static var description = IntentDescription("Shows immediate access to your memos")
    
    init() {}
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
