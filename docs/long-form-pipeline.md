# Long-form capture as a programmable pipeline

The product this is becoming: audio capture as a first-class, programmable data
source. Hours, not minutes. Live and shareable while it runs. Automatable during
and after.

Written 2026-09-19 after a 1h42m upload sat on "Transcribing…" forever.

The spec itself, in Marko's words, is [PRODUCT-SPEC.md](./PRODUCT-SPEC.md).
What follows is the summary and the plan.

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
- [x] Failing test: a long upload enqueues rather than transcribing inline
      (`src/app/api/transcribe/finalize/route.test.ts`)
- [x] Worker handles the transcription job type
      (`agent-worker/src/transcribe.ts`, claimed via
      `agent-worker/src/transcribe-queue.ts`)
- [x] Resume/retry on failure: the audio is assembled and recorded on the memo
      before the slow part, the chunks survive a failed attempt, and a killed
      worker's job goes back to `pending` once its heartbeat stops
      (`recover_stale_transcribe_jobs`)
- [x] Raise the 75MB cap — 2GB on the chunked path, and the one route that
      still reads a whole file inside a request says which limit it means
- [ ] Attempts visible to the UI. The page sees `transcript_status` and the
      stall wait now scales with the recording's length, but the attempt count
      itself is not surfaced.

### 2. The event layer
- [x] Webhook delivery with retries and a signature
      (`src/lib/transcript-webhook.ts`): one configurable endpoint,
      `transcript.ready` and `transcript.failed`, HMAC-SHA256 over the
      timestamp and the exact bytes, off unless both URL and secret are set.
- [ ] `recording.started`, `transcript.segment`, `recording.completed`
- [ ] Documented endpoints for start/stop and for reading the live stream

### 3. During-recording automations
Falls out of `transcript.segment` almost free: keyword match, speaker change,
duration reached.

## Running it, and what is not yet proven

The worker needs, besides its existing Supabase and Anthropic settings:

    NVIDIA_API_KEY=              # without it, transcribe jobs fail, loudly
    TRANSCRIPT_WEBHOOK_URL=      # both, or nothing is sent
    TRANSCRIPT_WEBHOOK_SECRET=

Honest gaps, as of 2026-09-19:

- **No real audio has been through this.** Every test stands a stub where
  NVIDIA is. The wiring to the real engine is verified only as far as "the
  module loads and exports the function, and its .proto files are found".
- **The Docker image cannot reach the engine.** `agent-worker/Dockerfile`
  copies only `agent-worker/src`, and the transcription job imports the app's
  `src/lib/riva`. Run the worker from the repo (`npm start` in `agent-worker/`)
  until the image is rebuilt with the app's lib and protos, or a transcribe job
  fails with a missing-module error. It fails visibly, not silently.
- **The migration has not been applied to any database.** Until
  `20260919120000_add_memo_transcribe_jobs.sql` runs, the claim RPC does not
  exist and nothing is ever claimed.

## The rule this pipeline is held to

`done` means the transcript exists. Never an exit code, never a 200. Four
scenarios per flow — the artifact appears, the job exits cleanly writing
nothing, the job crashes, the worker is absent — and the second is the one that
matters.
