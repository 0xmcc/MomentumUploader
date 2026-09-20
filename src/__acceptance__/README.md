# Acceptance tests

These are the five acceptance criteria from `docs/PRODUCT-SPEC.md` ("How we
know it is met"), written as executable tests. They are the definition of done
for the long-form pipeline in `docs/long-form-pipeline.md` — not a unit suite.

Run them:

```
npx jest src/__acceptance__
```

They take about a second, spend nothing, touch no network and wait on no real
timer. A three-hour recording is simulated with an injected clock; the
transcription engine is a stub.

## What each file covers

| File | Criterion |
| --- | --- |
| `long-form-pipeline.acceptance.test.ts` | 1 (three-hour recording), 2 (worker killed mid-job), 4a (the webhook fires only once the transcript exists), 5 (skipped — phase 3) |
| `live-share.acceptance.test.ts` | 3 (a second person opens the share URL mid-recording) |
| `webhook-delivery.acceptance.test.ts` | 4b (delivery is retried when the receiver is down) |

## The rule these are held to

From `docs/long-form-pipeline.md`:

> `done` means the transcript exists. Never an exit code, never a 200.

So no test here asserts on a return value, a status code, or a process
finishing. Every assertion reads the stored rows back: the transcript is there,
it has the words from the end of the recording as well as the start, and it was
written after the job was claimed.

**The scenario that matters most is the lie** — an engine that resolves
successfully having produced nothing. That is the exact shape of the 1h42m
upload that sat on "Transcribing…" forever, because success was inferred from a
process exiting cleanly. If that test passes before the artifact check exists,
the artifact check is inert. Each flow has four scenarios: the transcript
appears, the engine exits cleanly writing nothing, the engine crashes, no
worker runs at all.

## The contract the pipeline tests assume

`long-form-pipeline.acceptance.test.ts` drives **one pass of a worker** and
then reads the database back. It resolves that entry point at call time rather
than importing it by name, so a criterion fails with a message about the
missing behaviour instead of a compile error taking the whole file down:

1. `agent-worker/src/transcribe-queue.drainTranscribeQueue` plus
   `agent-worker/src/transcribe.processTranscribeJob` — where the worker
   actually lives; this is what the tests bind to. Only the engine, the audio
   fetch and the clock are doubled, so the claim, the recovery, the writes and
   their ordering are the real code.
2. Failing that, `@/lib/transcription-queue.runTranscriptionWorker(supabase, deps)`
   — an app-side entry with the same shape, if the pipeline ever moves.

The shape the tests speak in, and the adapter maps onto whichever exists:

```ts
(supabase, {
  transcribe: (input: {
    memoId: string;
    userId: string;
    audioUrl: string;
    durationSeconds: number;
    heartbeat: () => Promise<void>;   // "still working"
  }) => Promise<
    | { transcript?: string; segments?: Array<{ startMs: number; endMs: number; text: string }> }
    | void
  >;
  now?: () => number;
  staleAfterMs?: number;
  deliverWebhook?: (event: Record<string, unknown>) => Promise<unknown>;
}) => Promise<unknown>
```

One pass must:

1. recover `memo_transcribe` jobs that have not been heard from within
   `staleAfterMs` (`recover_stale_transcribe_jobs`) — and leave alone the ones
   that have (`heartbeat_job_run`), or a three-hour job gets stolen at minute 90;
2. claim the oldest pending job atomically (`claim_pending_transcribe_job`);
3. run `deps.transcribe`, passing a `heartbeat` the engine calls as it goes;
4. write the transcript to `memos.transcript`, the segments to
   `memo_transcript_segments`, and set `transcript_status`;
5. mark the job `succeeded` **only if that transcript actually landed** —
   otherwise `failed`, with the memo `failed` and the audio left intact;
6. fire `deps.deliverWebhook` with `transcript.ready` (after the row exists) or
   `transcript.failed`, and never let a webhook failure undo a finished
   transcript.

The RPC names and semantics come from
`supabase/migrations/20260919120000_add_memo_transcribe_jobs.sql`; the in-memory
Supabase double in the test file mirrors them. The SQL itself is covered by that
migration's own test — what is under test here is the pipeline that uses it.

If the implementation is renamed or moved, change the lookup in
`runTranscriptionWorker()` at the top of the test file — the assertions below it
are the part that matters.

To check the tests are not inert, break the lookup on purpose (point it at a
name nothing exports) and re-run: every criterion should fail saying the
pipeline is missing. If any of them still passes, that one is not testing what
it claims to.

## Criterion 5 is deliberately skipped

"A keyword spoken at minute 90 triggers its automation before the recording
ends" is **phase 3** of `docs/long-form-pipeline.md` (during-recording
automations), and phases 1 and 2 come first. Its test is written out and marked
`it.skip("[PHASE 3] …")` so the shape is on the record rather than in a TODO:
the automation has to fire while the recording is still running, which is what
makes it different from the completion webhook. Un-skip it when
`@/lib/transcript-automations` exists.
