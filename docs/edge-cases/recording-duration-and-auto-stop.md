# Recording Duration and Auto-Stop Behaviour

## Scenario

A user starts a live recording and:

- forgets to stop it, or
- intentionally leaves it running for a very long time (e.g. 2–12+ hours).

## What Happens Today

### Recording

- The browser `MediaRecorder` runs with a 1s timeslice.
- We accumulate **all** audio chunks in memory (`audioChunksRef`) for the entire session.
- `recordingTime` increments every second with **no hard maximum duration**.

### Live transcription

- `useLiveTranscription` periodically builds WebM snapshots from all recorded chunks and sends them to `/api/transcribe/live`.
- There is **no explicit live-session duration cap**; ticks continue as long as `isRecordingRef.current` is `true`.

### Upload and final transcript

- When the user eventually stops recording:
  - We concatenate the header blob plus **all** audio chunks into a single WebM `Blob`.
  - That blob is uploaded to `/api/transcribe` in one request.
- For multi-hour sessions, this blob is likely:
  - very large (hundreds of MB),
  - prone to causing browser memory pressure or crashes,
  - at risk of hitting server or platform upload size/time limits.

### Practical implication

- Long recordings *appear* to work while running (live transcript keeps updating), but:
  - There is no guarantee the final upload will succeed.
  - The app can fail in opaque ways (tab crash, network error, server rejection).
  - This effectively means **multi-hour recordings are not reliably supported** today.

## Intended Behaviour (Proposed)

**Product guardrail:** `voice-memos` should explicitly define and communicate a **maximum supported recording duration**.

Recommended baseline:

- **Max supported duration:** 60–90 minutes per recording.
- **Auto-stop rule:** When `recordingTime` reaches the max duration:
  - Automatically stop recording.
  - Finalize the live transcription session.
  - Trigger the normal upload flow.
  - Show a clear, user-facing message explaining that the recording was stopped at the limit and they can start a new memo to continue.

**Tier-based duration (product):** Max recording duration may be applied only to **free** accounts as an incentive to upgrade; **paid** users get a higher limit or no limit. Same auto-stop + message behaviour, with the limit (and copy, e.g. “Upgrade to record longer”) derived from user tier. See [tiers-and-limits.md](../tiers-and-limits.md).

Additional options (future iterations):

- Allow a user setting for shorter limits (e.g. 15/30/60 min) while keeping a hard upper bound.
- If we ever want *true* all-day recording:
  - Stream chunks to the backend incrementally instead of keeping everything in memory.
  - Persist long sessions as multiple memos or time-bounded segments (e.g. one memo per hour) rather than a single massive file.

## Invariants We Should Enforce

- **Explicit maximum:** There is a clearly documented maximum duration for a single recording, surfaced in both product copy and tests.
- **Deterministic outcome:** Crossing the max duration always:
  - stops recording,
  - surfaces a clear explanation to the user,
  - attempts to upload what was captured so far.
- **No silent failure:** The app should never sit in a state where a huge recording appears active but cannot realistically be finalized or uploaded.

