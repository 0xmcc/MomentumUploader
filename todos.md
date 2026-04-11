# Voice Memos Product Todo

## P0: Acquisition and first impression

- redesign the share page so the first impression feels polished and intentional
- replace the tiny `Create account` CTA with a large, high-visibility primary button
- remove the live transcription diagnostics UI from the share page
- keep the `Live transcription` label on the signed-out share page
- fix signed-out live transcription so it works without authentication
- make the share page mobile-responsive

## P1: Activation and retention

- if a user visits a share page, remember it and surface it later in their side menu
- add a clean way for users to save a share page into their account
- preferred product direction: let users fork/copy the shared item into their own workspace rather than vaguely "attach" it to the account
- add voiceover playback to the shared page

## P1: Core product reliability

- fix the voiceover generation/playback flow
- audit the current voiceover experience for broken states, unclear controls, and output quality issues
- support file uploads for transcription beyond live recording (`m4a`, `mp3`, `mp4`, and likely video-oriented inputs)
- improve long-memo artifact generation performance by parallelizing per-chunk summaries with `Promise.all()` in the two-pass pipeline, since sequential awaits add roughly `50-100s` on long recordings

## P1: Monetization and limits

- add pricing controls to `VoiceOverStudio`
- show credit cost for each voiceover in `VoiceOverStudio`
- add a credit system and payments for credits
- require each voiceover to consume credits tied to the requesting user
- add a recording duration limit for free tier users as an upsell, while paid tiers get longer or unlimited recording time (see [docs/tiers-and-limits.md](docs/tiers-and-limits.md) and [docs/edge-cases/recording-duration-and-auto-stop.md](docs/edge-cases/recording-duration-and-auto-stop.md))

## P2: Voice creation expansion

- allow a broader selection of voices
- allow custom voices
- support collaborative voice remixing / "DJ each other's voice" workflows, with explicit permissions, consent, and product controls

## P3: Open product cleanup question

- decide whether "delete voice memos" is still actually desired, and if so define the exact product behavior before implementation

