Ready for review
Select text to add comments on the plan
Artifact Production Implementation Plan
Context
The MomentumUploader app has a solid data architecture (segments → chunks → artifacts) but the artifact production pipeline is incomplete. Currently only rolling_summary is generated, artifact reads have no dedicated API, the share page is transcript-only, artifact generation still flattens all chunks into one capped prompt (slice(0, 12000)), and title generation still reads raw transcript prefix instead of artifact outputs. This plan closes those gaps via a subagent-parallel execution strategy.

Working directory: /Users/marko/Code/MomentumUploader/voice-memos

Critical Files
File	Role
src/lib/memo-artifacts.ts	Artifact generation (rolling summary inline, job tracking)
src/lib/memo-chunks.ts	Transcript chunking (CHUNK_TARGET_TOKENS=800, CHUNK_MAX_TOKENS=1200)
src/lib/memo-jobs.ts	Job orchestration (runPendingMemoJobs, claim_pending_memo_job)
src/lib/live-segments.ts	Live segment constants and DB row builders
src/lib/memo-title.ts	Title generation — currently reads transcript.slice(0, 3000) directly
src/app/s/[shareRef]/route.ts	Share page (HTML/MD/JSON, server-side rendered, auto-refresh)
src/components/AudioRecorder.tsx	Recorder UI (uses useLiveTranscription, renders LiveTranscriptView)
src/app/api/memos/[id]/	Memo API routes (no artifact read route exists yet)
migrations/20260310220000_add_memo_artifacts.sql	Artifacts table + claim_pending_memo_job()
Artifact types defined but not yet generated: outline, title_candidates, title, key_topics, action_items

Phase 1 — Reliability + Read API (run 2 subagents in parallel)
Subagent A: Unify job lifecycle semantics
Goal: Job state transitions are consistent and traceable across all artifact flows.

Current problem: Job semantics are inconsistent across flows. The live segment compaction route correctly inserts jobs as status='pending' (then claims them via claim_pending_memo_job()), but the rolling summary helper in memo-artifacts.ts inserts jobs directly as status='running'. Both approaches exist in production code simultaneously. This is the real problem — not that everything is inline.

Tasks:

Audit all job_runs insert sites. Identify every place that sets status='running' directly instead of 'pending'.
Normalize all artifact jobs to use the pending → running → succeeded/failed path via claim_pending_memo_job().
Add concurrency guard: if a pending or running job for the same (entity_id, job_type) already exists, skip enqueue. Guarding only running is insufficient — during rapid live segment persists, multiple pending rows can pile up before the runner catches up, creating queue spam. At most one active job (pending or running) per (entity_id, job_type) at any time. Enforce via an app-code pre-insert check first (safe default). If a DB-level partial unique index is added later, it must include entity_type to avoid breaking other flows that share job_runs — verify cross-feature usage before applying a DB constraint.
Add structured logging at each state transition: queued, started, succeeded, failed.
Ensure runPendingMemoJobs() is called after every live segment persist and after finalization.
Make reruns idempotent: re-running a succeeded job writes a new artifact and supersedes the old one without duplicating job rows.
Acceptance criteria:

All artifact job flows use pending as initial status
No duplicate active (pending or running) jobs per (entity_id, job_type) at any time
State transitions appear in logs
Subagent B: Add artifact read API (two paths)
Goal: Recorder UI can fetch its own artifacts; share page reads artifacts server-side directly.

Two distinct read paths (do not conflate them):

Path 1 — Private authenticated API (src/app/api/memos/[id]/artifacts/route.ts):

GET /api/memos/[id]/artifacts?source=live → returns all status='ready' artifacts for that source

GET /api/memos/[id]/artifacts?source=final → same for final

Default (no source) → returns final if any exist, else live

Auth: verify user session owns the memo (user_id match). No share-token support here — that is the wrong layer.

Define a shared ARTIFACT_TYPES registry in src/lib/artifact-types.ts (new file, ~10 lines):

export const ARTIFACT_TYPES = ['rolling_summary', 'outline', 'title_candidates', 'title', 'key_topics', 'action_items'] as const;
export type ArtifactType = typeof ARTIFACT_TYPES[number];
Both the API route and the share page server handler import from this registry to build the fixed-shape response. Neither recreates the list by hand.

Return a fixed map keyed by artifact type — always return all known types, null for absent ones:

{
  "rolling_summary": { "payload": { "summary": "...", "wordCount": 42 }, "basedOnChunkStart": 0, "basedOnChunkEnd": 3, "version": 2, "updatedAt": "..." },
  "outline": null,
  "title_candidates": null,
  "title": null,
  "key_topics": null,
  "action_items": null
}
UI code checks artifacts.outline !== null — no knowledge of supersession rules needed

Path 2 — Server-side share page query (modify src/app/s/[shareRef]/route.ts):

After resolving the share, query memo_artifacts directly (server-side Supabase admin client)
No HTTP roundtrip to the private API — share page is already server-side
Fetch status='ready' artifacts for the appropriate source (live if recording, final if finalized)
Acceptance criteria:

GET /api/memos/:id/artifacts?source=live returns current rolling_summary payload for authenticated memo owner
Share page server handler can retrieve artifacts without going through the private user API
Phase 2 — Outline Generation (sequential, after Phase 1)
Goal: First serious artifact beyond rolling summary, proving the full vertical slice.

Single subagent: implement outline artifact
Tasks:

Add generateOutline(memoId, source, chunks) to memo-artifacts.ts:
Input: ready chunks with chunk_index, text, start_ms, end_ms
Prompt Claude to identify 3-8 sections and return only chunk index ranges (chunkStart, chunkEnd) plus title and summary per section
Server code derives startMs/endMs from the chunk rows — model must not invent timestamps. Validate: startMs = chunks[chunkStart].start_ms, endMs = chunks[chunkEnd].end_ms
Validate all model-returned indices server-side before storing:
Reject any item where chunkStart > chunkEnd
Reject any item where chunkStart or chunkEnd is outside [0, chunks.length - 1]
Reject if items have overlapping chunk coverage or duplicate chunkStart/chunkEnd pairs
On validation failure: log and either retry once or store a failed artifact status — never silently store invalid outline data
Output shape stored in payload:
{ "items": [{ "title": string, "summary": string, "startMs": number, "endMs": number, "chunkStart": number, "chunkEnd": number }] }
Add threshold check (same pattern as rolling summary): only generate outline if 2+ new chunks since based_on_chunk_end of the last ready outline artifact.
Wire into the live job flow: after chunk compaction, if threshold met, enqueue outline job as pending.
Wire into finalization: generate source='final' outline, supersede any live outline.
Supersede old live outline when newer one is written (set prior status='superseded').
Model: claude-haiku-4-5 (fast, cheap for live) Max output tokens: ~600

Acceptance criteria:

After 2+ live chunks, a ready outline artifact exists in memo_artifacts
After finalization, a final outline exists and the live one is superseded
Every outline item's startMs/endMs matches the actual chunk row timestamps (no hallucinated values)
Invalid chunk indices from model are rejected, not silently stored
Phase 3 — UI Integration (run 2 subagents in parallel, after Phase 2)
Subagent A: Recorder live outline panel
Goal: Show live outline in AudioRecorder during active recording.

Tasks:

Add useArtifacts(memoId) hook that polls GET /api/memos/:id/artifacts?source=live every ~5s during active recording only (stop polling when recording stops).
In AudioRecorder.tsx, below LiveTranscriptView, add an OutlinePanel component:
If outline artifact exists: render ordered list of items (title + summary)
Else if rolling_summary exists: render summary text
Else: render "Listening for structure…" placeholder
No click-to-seek in V1
Acceptance criteria:

Outline panel appears during recording after 2+ locked chunks (~30s)
Updates without page reload
Empty and loading states render intentionally
Subagent B: Share page artifact rendering
Goal: Share page shows summary + outline above transcript.

Artifact source resolution rule (explicit, applied server-side):

If transcript_status = 'complete' → use source = 'final' artifacts
Otherwise → use source = 'live' artifacts
If no artifacts exist for the chosen source → degrade gracefully (show transcript only, no error)
Tasks:

In src/app/s/[shareRef]/route.ts, after resolving the share, query memo_artifacts directly using the resolution rule above (server-side — do not call the private user API).
Render in HTML output:
Rolling summary section (if exists) above transcript
Outline section (if exists) below summary, above transcript
Each outline item as a section heading; timestamp shown as text (1m 23s) linked to audio seek position
Update Markdown output to include ## Summary and ## Outline sections before ## Transcript
Live share auto-refresh already exists (3s interval) — ensure it re-fetches artifacts in the refresh cycle
Acceptance criteria:

Share page shows summary if available
Share page shows outline if available
Live share page refreshes both transcript and artifacts
Phase 4 — Chunk-Consumption Upgrade (sequential, after Phase 2)
Note: This phase may pull forward if outline quality is visibly degraded by flat prompt flattening. If V1 outline output looks weak (missing latter half of long memos), move this before Phase 3 UI work.

Goal: Stop flattening all chunks into one .slice(0, 12000) prompt.

Current problem in memo-artifacts.ts:

const combinedText = chunks
    .map((chunk) => chunk.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 12000);  // ← silently truncates long memos
Tasks:

Replace flat combinedText for rolling summary:
If total chunk text ≤ 8000 tokens: pass all chunks directly
If > 8000 tokens: two-pass — summarize each chunk independently, then summarize the summaries
Apply same hierarchical pattern to outline generation
Add tests: 50+ chunks should produce artifacts covering the full duration, not just the first ~12 min
Acceptance criteria:

15+ minute memos have outline items and summaries covering the full recording
No .slice(0, N) truncation in artifact generation paths
Phase 5 — Title Migration (sequential, after Phase 3)
Goal: Title generation consumes artifact outputs, not raw transcript prefix.

Current problem in memo-title.ts:

content: `...${transcript.slice(0, 3000)}`  // ← old world
Ownership decision: Title generation moves entirely into the artifact system. memo-title.ts is deleted. All LLM-powered derivations live in memo-artifacts.ts (or a new memo-artifact-title.ts module if the file gets too large). There is no "thin projection layer" — that would preserve the old split in new form. The only DB write to memos.title is a plain Supabase update triggered by the artifact system after the title artifact is written.

Tasks:

After finalization, once final outline and final rolling_summary artifacts exist, enqueue a memo_title_final job that generates the title_candidates artifact:
Input: final outline items + final rolling summary payload
Output: { "candidates": [string, string, string] }
After title_candidates is ready, enqueue stage 2: pick best candidate, write title artifact with { "title": string } payload
After title artifact is written, update memos.title inline in the same job handler — this is a projection write, not a generation step
Check memo-title.ts for non-LLM fallback behavior before deleting. The core invariant is: no title generation may read raw transcript directly. Whether memo-title.ts is deleted or replaced by a non-LLM projection helper is secondary. If it contains only LLM + transcript-slice logic, delete it. If it contains useful non-generation behavior (fallback copy, DB update helpers), extract that into the artifact job handler and delete the rest.
Acceptance criteria:

title generation no longer reads raw transcript
memos.title is updated from the artifact payload, not from a direct LLM call on raw text
Title can be regenerated by re-running the artifact jobs (idempotent)
memo-title.ts contains no LLM calls and no transcript.slice(...) after this phase
Subagent Execution Map
Phase 1 (parallel):
  ├── Subagent A: Unify job lifecycle
  └── Subagent B: Artifact read API (2 paths)

Phase 2 (sequential, depends on Phase 1):
  └── Subagent: Outline generation + provenance validation

Phase 3 (parallel, depends on Phase 2):
  ├── Subagent A: Recorder outline panel
  └── Subagent B: Share page artifacts
  [may be preceded by Phase 4 if outline quality is poor]

Phase 4 (sequential, after Phase 2 — may pull earlier):
  └── Subagent: Chunk-consumption upgrade

Phase 5 (sequential, after Phase 3 + 4):
  └── Subagent: Title migration
Verification
After Phase 1:

# Check job_runs for a recording session:
# SELECT job_type, status, created_at FROM job_runs
#   WHERE entity_type = 'memo' AND entity_id = '...'
#   ORDER BY created_at;
# Should show: pending→running→succeeded, no duplicates per job_type
# Hit the private API:
# GET /api/memos/:id/artifacts?source=live  (with auth)
# Should return: { rolling_summary: { payload: { summary: "...", wordCount: N }, ... }, outline: null, ... }
After Phase 2:

# After 2+ locked segments (~30s of recording):
# SELECT artifact_type, status, based_on_chunk_start, based_on_chunk_end, payload
#   FROM memo_artifacts
#   WHERE memo_id = '...' AND artifact_type = 'outline';
# payload.items[*].startMs must equal memo_transcript_chunks[chunkStart].start_ms exactly
After Phase 3:

Record 60s → outline panel should appear in recorder UI
Open share page → should show summary and outline above transcript
After Phase 4:

Record 15+ minute memo → outline items should span the full duration, not truncate after ~12 min
After Phase 5:

Finalize a memo → memos.title should be updated from the artifact, not from a raw transcript slice