- delete voice memos
- (Phase 4 prereq) parallelize per-chunk summaries with Promise.all() in two-pass artifact generation — sequential await on N chunks = ~50-100s for long memos
- add voiceover playback to shared page
- show credit cost for each voiceover in VoiceOverStudio
- allow broader selection of voices
- allow custom voices
- upload files to transcribe (m4a, mp3, mp4?? we probably want to support video)
- mobile responsiveness
- credit system + payments for credits
- require that each voiceover consumes credits that are tied to each user
- recording duration limit for free tier (upsell); paid tier gets longer or unlimited (see [docs/tiers-and-limits.md](docs/tiers-and-limits.md) and [docs/edge-cases/recording-duration-and-auto-stop.md](docs/edge-cases/recording-duration-and-auto-stop.md))

## Cleaned-up product todo

### P0: Share page fixes
- redesign the share page so the first impression feels polished
- replace the tiny `Create account` CTA with a large, high-visibility primary button
- remove the live transcription diagnostics UI from the share page
- keep the `Live transcription` label on the signed-out share page
- fix signed-out live transcription so it works without authentication

### P1: Share page persistence / conversion
- if a user visits a share page, remember it and surface it later in their side menu
- add a clean way for users to save a share page into their account
- best current product direction: let users fork/copy the shared item into their own workspace rather than "attach" it vaguely to the account

### P1: VoiceOver Studio
- add pricing controls to VoiceOver Studio
- support collaborative voice remixing / "DJ each other's voice" workflows, with explicit permissions and product controls

### P1: Quality fixes
- fix the voiceover generation/playback flow
- audit the current voiceover experience for broken states, unclear controls, and output quality issues