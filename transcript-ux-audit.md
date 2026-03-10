# Transcript UX Audit: Share Page

This audit evaluates the current share page transcript UX against best practices from leading transcription tools (Otter.ai, Descript, Notta, Apple Voice Memos) and provides a pragmatic, phased roadmap for improvements in `MomentumUploader/voice-memos`.

## 1. Immediate Improvements (Existing Data Model: `string` only)

Currently, `memo.transcript` is a single block of string text rendered inside a scrolling container (`div.transcript`).

**Immediate UX Wins:**
- **Sticky Audio Player:** Ensure the `<audio>` element and "Transcript" header are sticky/fixed at the top (or bottom) of the container so when the user scrolls through a long text block, the playback controls are never lost.
- **Heuristic Paragraph Breaks:** Replace raw `\n` characters with actual `<p>` tags and give them comfortable bottom margins (`margin-bottom: 1.25rem`). Even without timestamps, breaking up walls of text based on punctuation strings or explicit newlines vastly improves scanning.
- **Typography & Line Length:** Add a `max-width: 65ch; margin: 0 auto;` to the transcript container. Walls of long text are hard to track horizontally. Improve `line-height` to `1.6` or `1.7`.
- **"Copy to Clipboard" Action:** Add a highly visible "Copy Transcript" button next to "Export transcript" for quick pasting into other tools without needing to download a `.txt` file.
- **Enhanced Search Highlighting:** The current custom search implementation is great, but could auto-scroll smoothly (`scrollIntoView({ behavior: 'smooth', block: 'center' })`) to keep the matched term in the center of the viewport rather than snapping `nearest`.

## 2. Improvements Requiring Structured Segments (with Timestamps)

Transitioning from `string` to an array of objects like `{ text: string, startTime: number, endTime: number }` unlocks interaction primitives that define modern transcription apps:

- **Click-to-Play Navigation:** (Seen in Descript and Otter) Users should be able to click on any paragraph (or word) to instantly jump the `<audio>` player to that `startTime`.
- **Active Playback Highlighting (Karaoke UI):** As the audio plays, use an `onTimeUpdate` listener to sync the audio's `currentTime` with the segment data and highlight the currently spoken paragraph or sentence in orange or bold text.
- **Auto-Scrolling:** (Seen in Notta) When playback is active, the transcript container should automatically scroll to keep the actively spoken segment centered on the screen.
- **Visual Timestamps:** Display a subtle, non-intrusive timestamp (e.g., `[02:14]`) at the beginning of each major paragraph or segment to give the user a spatial sense of time.

## 3. Improvements Requiring Speaker Diarization / Upstream Changes

If the upstream transcription pipeline emits `{ speaker: string, text: string, start: number, end: number }`:

- **Speaker Labels & Colors:** Group continuous text spoken by the same person into a visual "bubble" or block with the speaker's name (e.g., "Speaker 1" or a user-defined name) attached. Use alternating subtle accent colors (e.g., varying borders or background tints) to differentiate turns in the conversation.
- **Filtering by Speaker:** Allow viewers of the share page to click a speaker's name to see only their contributions or quickly navigate between their specific turns.
- **Speaker Timeline:** Add a mini-timeline below the audio player showing colored segments indicating who is speaking and when.

## 4. Phased Rollout Plan

To prevent "big bang" redesign risks and to deliver value quickly, adhere to this phased approach:

### Phase 1: Typography & Layout Polish (This week / Next PR)
*Requires no changes to the data model or database.*
1. Update `share-contract.ts` HTML builder to convert `\n\n` into distinct paragraph `<p>` tags.
2. Apply sticky positioning (`position: sticky; top: 0; z-index: 10;`) to the player/header.
3. Optimize line length (`max-width: 65ch`) and add a `Copy to Clipboard` button using vanilla JS.

### Phase 2: Structural Navigation (Next 2-4 weeks)
*Requires migrating database schema from `text` to `jsonb` or related tables for segments.*
1. Change the `<div class="transcript">` dynamically into a list of clickable `<p data-start="...">` nodes.
2. Add a `timeupdate` event listener to the `<audio>` element that applies an `.active` CSS class to the matching time segment.
3. Enable "Click-to-Play" jumping.

### Phase 3: Conversational Diarization (Mid-Term)
*Requires upstream AI transcription changes (e.g., Whisper diarization) and UI state management.*
1. Display Speaker 1 / Speaker 2 avatars next to text groups.
2. Implement visual distinction (indentation or alternating background colors) for distinct speaker turns.
