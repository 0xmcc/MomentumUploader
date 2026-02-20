# MomentumMemos Apple App

This is the pure native Swift/SwiftUI codebase for Momentum Memos, providing an "I can trust it" feeling. It serves as a unified cross-platform app for iOS, iPadOS, and macOS.

## Features Currently Implemented:
- **AVFoundation Recording**: Uses `AVAudioRecorder` to capture high-quality `.m4a` audio reliably.
- **Adaptive SwiftUI Layout**: Built around `NavigationSplitView`, the app scales automatically from iPhone screens to sprawling Mac windows. 
- **Immediate Local Persistence**: Recordings are persisted to disk the second recording halts. 
- **Background Uploads**: Uses a background-configured `URLSession` to guarantee audio gets to the cloud even if the phone gets locked. 
- **WidgetKit**: A Quick Record widget target.
- **App Intents**: Extends Momentum Memos into Siri, Spotlight, and Shortcuts. 

## Setting up the Xcode Project

Because this codebase includes targets for Intents and Widgets which require explicit signing and configurations, the smartest way to structure this is through a standard Xcode Workspace:

1. Open Xcode -> File -> New -> Project
2. Select the **Multiplatform** tab, then choose **App**.
3. Name the product `MomentumMemos`.
4. Drag the `Sources/App`, `Sources/Core`, and `Sources/Views` folders into your new project, replacing the existing template `ContentView.swift` and `App.swift`.

### Enabling Background Audio Setup
1. In the Project Navigator, select the `MomentumMemos` project file.
2. Select your `MomentumMemos` app target.
3. Under the **Signing & Capabilities** tab:
    - Click **+ Capability** and add **Background Modes**.
    - Check the box for **Audio, AirPlay, and Picture in Picture**.
    - This allows the app to record while the screen is locked or while jumping into another app.

### Setting up the WidgetKit Extension
1. Go to File -> New -> Target
2. Select **Widget Extension** from iOS or Multiplatform.
3. Name it `MomentumMemosWidget`.
4. Replace its template `.swift` files with our `MomentumMemosWidget.swift`.

### Setting up the App Intent
1. The included `RecordMemoIntent.swift` should just be dragged into the Shared App Target AND the Widget Target. 
2. It'll expose "Record Voice Memo" directly to Shortcuts and Siri.

## A Note on Cloud Integration (In `Uploader.swift`)
The currently implemented Uploader targets an example URL. You will need to drop in your specific backend API endpoint path.
