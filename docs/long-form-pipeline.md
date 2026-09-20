# Long-form capture as a programmable pipeline

The product this is becoming: audio capture as a first-class, programmable data
source. Hours, not minutes. Live and shareable while it runs. Automatable during
and after.

Written 2026-09-19 after a 1h42m upload sat on "Transcribing…" forever.

## What the spec asks for

1. **Live, shareable transcription** — real time, viewable by others at a URL
   while recording is still going, 1–2s lag.
2. **Programmable** — documented hooks. Automations fire *after* a recording
   completes and *during* it (keyword hit, speaker change, duration reached).
   Start/stop recordings programmatically; read the live stream; get structured
   data back (timestamps, speakers, confidence).
3. **Long-form first** — 1–3 hour sessions are the normal case, not the edge.
   Hundreds of MB. Chunking is internal and invisible. Limited by storage, not
   by an arbitrary time cap.

Explicitly not wanted: a manual tap-record-stop-share-export loop, or a closed
box that only yields data once everything is packaged as a file.

## Where the code actually stands

| Pillar | State |
| --- | --- |
| Live shareable transcript | **Built.** Public viewer page, share link, live segment stream. |
| Automation hooks | **Missing.** No webhooks anywhere in the codebase. |
| Long recordings | **Broken.** See below. |

Why long recordings break today:

- The memo row is created *before* the audio exists, so any later failure leaves
  a ghost stuck on "Transcribing…" forever.
- Transcription runs inline inside one HTTP request. A 1h42m file has no
  realistic chance of finishing inside a request.
- No retry, no resume. One network blip loses the whole upload.
- Uploads are capped at 75MB.

The good news: a real job system already exists here — a queue table, a worker
service, atomic claim, stale-job recovery, realtime updates. It runs the AI
transformations and agent chat. **Transcription is the one slow thing that does
not use it**, which is the whole bug.

## Build order

Reliability first: a pipeline you cannot trust is not worth automating against.

### 1. Transcription onto the existing queue
Upload enqueues a job; the worker does the slow part; the page watches it fill.
Kills all four failure modes above at once.
- [ ] Failing test: a long upload enqueues rather than transcribing inline
- [ ] Worker handles the transcription job type
- [ ] Resume/retry on failure, with attempts visible to the UI
- [ ] Raise or remove the 75MB cap now that nothing runs in a request

### 2. The event layer
- [ ] Emit `recording.started`, `transcript.segment`, `recording.completed`,
      `transcript.ready`, `transcript.failed`
- [ ] Webhook delivery with retries and a signature
- [ ] Documented endpoints for start/stop and for reading the live stream

### 3. During-recording automations
Falls out of `transcript.segment` almost free: keyword match, speaker change,
duration reached.

## The rule this pipeline is held to

`done` means the transcript exists. Never an exit code, never a 200. Four
scenarios per flow — the artifact appears, the job exits cleanly writing
nothing, the job crashes, the worker is absent — and the second is the one that
matters.
