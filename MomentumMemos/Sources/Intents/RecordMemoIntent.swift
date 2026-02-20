import AppIntents

struct RecordMemoIntent: AppIntent {
    static var title: LocalizedStringResource = "Record Voice Memo"
    static var description = IntentDescription("Starts recording a new voice memo in Momentum Memos.")
    
    static var openAppWhenRun: Bool = true
    
    @MainActor
    func perform() async throws -> some IntentResult {
        // App Intents can trigger app launch or deep integration.  
        // In a true implementation, an App Group handles state sharing.
        // For Momentum Memos, we open the app where the singleton/viewmodel catches it.
        NotificationCenter.default.post(name: Notification.Name("IntentStartRecording"), object: nil)
        
        return .result()
    }
}
