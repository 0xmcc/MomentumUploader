# Todo list from recent Cursor sessions

Synthesized from recent agent transcripts. Grouped by: **completed**, **in progress / still need**, and **optional follow-ups**.

---

## ⚠️ Lessons: transcript skipping / missing segments (avoid next time)

**Issue we ran into:** The app transcript was missing segments compared to a reference — less content at the start (e.g. reference had 4:30–6:14, app showed 0:00–1:30) and at the end (e.g. 8:11–9:02 missing). So segments or time ranges were being skipped or never made it into the locked/final transcript.

**Flag:** When re-implementing or fixing live transcript, avoid these causes of missing/skipped segments:

1. **`mergeLiveTranscript` not used on the segment-lock path.** We have merge logic in `live-transcript.ts` but it isn’t invoked when producing locked segments. Content that only exists in the “dirty” ASR window can be dropped when we lock. Wire merge into the lock path so locked segments are built from merged (last locked + current hypothesis) text, not raw API output only.
2. **Failed `/api/transcribe/live` requests create permanent gaps.** Failed calls are only logged; there’s no retry. One network blip = one segment never transcribed. Add retry with backoff (and/or mark that segment as failed in the UI) so we don’t silently lose segments.
3. **Tail vs locked semantics.** The first ~15–30 seconds may exist only in the tail/dirty window until the first 15-chunk lock. The last few seconds before stop exist only in the tail until `runFinalTailTick`. If tail isn’t preserved correctly across finalization or the final tail isn’t sent and merged, that content is missing. Verify tail preservation and that the final transcript includes tail content.
4. **Chunk-window boundaries and accounting.** We send 1s chunks and lock every 15 chunks. Speech at window boundaries, or in a chunk that never got a successful API response, can be missing. Ensure every chunk is accounted for: which were sent, which succeeded, which are in locked vs tail. Log or test so we can see gaps (e.g. chunk index at first lock, failed request count, tail length at stop).
5. **Reproducible repro before changing.** We didn’t have a concrete recording + “expected vs actual” transcript to prove *why* segments were missing (API failures vs tail vs merge vs recording length). Before changing the pipeline, get one repro: exact time ranges that should appear, then add minimal logging (chunk counts at lock, failed API count, tail at finalize) and run once to see which of the above is the cause. Fix with evidence, not guesswork.

---

## Recently completed

- **Prod uploads** — Production uploads fixed (was: works locally but not on prod). Separate from chunked-upload plan below.
- **Duplicate live transcript text** — Resolved in UX; segment-based transcription / current pipeline + `mergeLiveTranscript` guardrails mean duplicates are no longer seen. All duplicate-related tests pass (`live-transcript.test.ts`, `AudioRecorder.test.tsx`).
- **Voiceover studio toggle + copy transcript** — Toggle to show/hide voiceover studio in memo detail; copy-transcript button in main app and on share page (share page script fix for copy handler).
- **Vercel production verification** — Confirmed production deploys from `main`; bearer-token work stayed local.
- **Merge to main + deploy** — Branch `remove-redundant-transcription` merged to `main`, pushed, and `vercel --prod` run (live transcript workflow + docs).
- **Background-tab live transcription** — Removed pause-on-hidden; live transcription continues while tab is hidden; tests updated to assert continuity + deduplicated progress.
- **Live transcription diagnostics UI** — Collapsible panel (tab state, snapshot mode, chunk window, ASR hypothesis); horizontal layout; moved to side of transcript.
- **Duplicate-text repro tests** — Failing tests added: merge unit test for “longer dirty hidden-window” and recorder integration repro (repeated clause only once).
- **Desktop token claims in Supabase** — Migration + atomic RPC; fixed `internal_error`; SQL applied via MCP; committed and merged to main.
- **Skip redundant final Riva transcription** — Provisional transcript path: `runFinalTailTick`, `promoteLiveSegmentsToFinal`, API bypass when `provisionalTranscript` present; tests for bypass vs Riva path; code review: ship.
- **Supabase test infrastructure cleanup** — Reduced plan shipped: `src/lib/__mocks__/supabase.ts`, env guards in `jest.setup.ts`, test files converted to bare `jest.mock("@/lib/supabase")` (or `./supabase`).
- **Other environments: desktop_token_claims migration** — Migration applied / working in other environments; "Generate one-time code" works everywhere needed.

---

## Still need / in progress

### 1. Chunked uploads / uploading memos and chunks (planned, not implemented)

- **What we discussed:** Avoid a single giant upload at stop; move to **chunked uploads** and **server-side streaming** so long recordings (e.g. 4–6 hours) don't hit timeouts, body-size limits, or tab memory.
- **Client:** Keep `MediaRecorder` + 1s chunks and `audioChunksRef` for live transcription. **In parallel**, periodically upload **batches** of chunks to the server (e.g. every 10–30s). On stop, send a small **"finalize"** request (no huge blob) so the server knows "you have all the audio for memo X; transcribe it." Optionally **prune** chunks from `audioChunksRef` after they're uploaded and no longer needed for live windows → keeps browser memory bounded.
- **Server:** For each memo, **append** uploaded audio chunks to durable storage (Supabase Storage); track chunk indices / byte offsets. On finalize, concatenate stored chunks (or stream) and run transcription once.
- **Ref:** Session `03bb574a` (long recordings, max duration, chunked upload architecture).

### 2. Recording duration limit for free tier (upsell) (planned, not implemented)

- **What:** No global max duration for everyone. Apply **max recording duration only to free accounts** as an incentive to upgrade; paid users get a higher limit or unlimited. Same auto-stop + message UX; limit and copy derived from user tier.
- **Docs:** [docs/tiers-and-limits.md](tiers-and-limits.md), [docs/edge-cases/recording-duration-and-auto-stop.md](edge-cases/recording-duration-and-auto-stop.md). Product todos: [todos.md](../todos.md) (credit system + tiers).
- **Do:** When tier/billing exists: wire tier-based duration cap in `useAudioRecording` (and optionally enforce at upload). Free = e.g. 1h; paid = longer or no cap.

### 3. Bearer token / share auth branch (if still desired)

- **What:** `feat/bearer-token-transcribe-live` (or similar) was kept local; production was confirmed to deploy from `main` only, so bearer-token work was not deployed.
- **Do:** If you still want bearer auth for live transcribe or share flows, merge or re-implement on a new branch and deploy when ready.

### 4. Production observability → reproduce → fix → notify (planned)

- **What:** Automated pipeline: view production logs, periodically identify errors, create failing tests to reproduce them, run an agent to attempt fixes, and send a notification (e.g. SMS) when there’s a failure and a solution is being worked on.
- **Docs:** [docs/production-observability-agent-loop.md](production-observability-agent-loop.md).
- **Do:** Choose first piece (log aggregation + repro, or “notify on new error”); implement pipeline (Vercel + Supabase + GitHub Actions + notification channel).

---

## Optional follow-ups (from code reviews)

- **runFinalTailTick:** Add a unit test (mocked refs + fetch spy) that it calls `/api/transcribe/live` only when there is a tail and does not trigger a PATCH to `/api/memos/:id`.
- **No stale PATCH:** Add test that after stop + `runFinalTailTick`, no fetch to `/api/memos/:id` with method PATCH is made (only upload POST is allowed).
- **Tail coverage:** Test that speech in the last second before stop appears in the stored transcript.
- **Refactor:** Extract shared blob-construction logic used by `runLiveTick` and `runFinalTailTick` into one helper to avoid drift.
- **Diagnostics panel:** Optional: make sidebar narrower / more “inspector-like”; optionally label first chunk, tail start, overflow on the chunk-window bar.

---

## Other items from sweep (optional or one-off)

- **More edge-case docs:** Add one short doc per scenario as they come up: tab close mid-recording, network failures during upload, auth expiry during long live sessions (see `docs/edge-cases/README.md`).
- **Bitrate for noisy environments:** Consider lowering default to 64 kbps Opus (or 48 kbps) for long recordings; optional “High quality” toggle at 96–128 kbps. Keeps transcription quality in noisy venues while reducing data volume (ref: `03bb574a`).
- **Verify upload+share E2E:** After signing in locally, run full flow: upload a recording, wait for memo, get share URL. Migration `20260310100000_add_memo_transcript_segments.sql` was applied via MCP; browser verification was blocked by “Sign In” (ref: `d2c205e1`).
- **Supabase link (CLI):** Wire up `supabase link` in `voice-memos/` so `supabase db push` works in this checkout; project ref is recoverable from app config (ref: `d2c205e1`).
- **Indexing/summaries/titles from segments:** Use `memo_transcript_segments` (timestamped chunks) for search indexing, summaries, and titles instead of one giant transcript string (ref: `9736b233`).

---

## Reference: session IDs (for transcript lookup)

- Voiceover toggle + copy: `ac041a6c`
- Latest changes summary + merge to main + deploy: `4faef038`
- Vercel production check: `7862b80d`
- Background-tab + diagnostics UI + duplicate repro tests: `414af028`
- Desktop claims Supabase + test infra plan: `47b7578b`
- Skip redundant Riva + review: `451f9052`
- Transcript pipeline commit + db push: `d2c205e1`
- Commit/merge (no terminal): `012d9b36`
- Chunked uploads / long recordings (memos + chunks): `03bb574a`
- Prod uploads not working: `74806678`
- Transcript segments / indexing (9736b233)
