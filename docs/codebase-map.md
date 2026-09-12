# Codebase Map

Last mapped: 2026-09-10 (`main` at `5f8b992`)

This is the canonical map for the repository rooted at
`/Users/marko/Documents/Code/MomentumUploader`. The Next app, root package, tests,
Supabase migrations, worker package, scripts, and native Swift sources all live directly
under this repository root. There is no nested `voice-memos/` repository.

The product currently contains two mostly separate browser applications:

- **Sonic Memos** at `/`: recording, transcription, memo feed/detail, sharing,
  collaboration, imports, voiceover, and memo-agent chat.
- **Sales Docs** at `/sales-docs*`: authenticated AI sales-call preparation with a
  public landing page, persisted generated sessions, and still-static recording/live
  coaching concepts.

They share the global Next.js/Clerk/theme shell, `supabaseAdmin`, the Anthropic SDK,
and deployment, but Sales Docs does not reuse the memo recording, transcript, room,
Fathom, OpenClaw, or agent-worker pipelines.

Machine-readable named relationships live in `docs/codebase-graph.yaml`. Use this file
for change-impact questions (`who calls this`, `what depends on this`, `what crosses the
trust boundary`) and this Markdown map for subsystem purpose, flows, and known risks.

## Durable Repository Memory

This map is the always-on layer; it should remain small enough to read at the start of a
substantial task. The graph is the relationship layer. Exact implementation truth remains
in code and nearby tests, found with `rg` by path/symbol rather than copied into this file.

Update both files when a change does any of the following:

- adds/removes a runtime, route family, persistence table, provider, or auth mechanism;
- changes the owner of client state or a cross-boundary data flow;
- changes a named dependency edge or known blast radius;
- resolves or introduces a risk recorded here.

Do not turn this into a session log. Recent attempts, temporary debugging state, and
unmerged plans belong in task context, not durable repo memory.

The retrieval layer is `scripts/repo-memory.mjs`. It builds an ignored
`.repo-memory/index.json` from source, tests, migrations, Swift, configuration, and
Markdown. TypeScript/JavaScript uses the installed TypeScript compiler API for real
top-level boundaries; Swift, SQL, and Markdown use structure-aware local parsers. The
index stores stable chunk keys, content hashes, exact line spans, symbols, imports,
calls, Supabase table/RPC operations, fetches, and environment-variable references.
An index-wide resolution pass connects relative and `@/` imports, imported call names,
local calls, and internal API fetches to target paths/symbols with resolved, probable,
or textual confidence. Unchanged files are reused by hash, and index replacement is atomic.

Retrieval is deliberately offline and deterministic. Hybrid mode combines BM25-style
ranking, local concept normalization, explicit file references, and import/API-neighbor
expansion. `--mode lexical` retains a strict BM25-only comparison path. There is no
embedding service or external database. `docs/repo-memory-eval.json` contains 15
clean-session path-recall cases; it is excluded from the index to prevent answer leakage.
The current retrieval MVP is an orientation tool, not proof of behavior: read every cited
range and its nearest tests before making a change. Its 2026-09-10 baseline is 3/15
strict cases, 63.6% path recall@5, 52.7% path recall@10, and 0.751 MRR in hybrid mode.
Lexical-only mode scores 2/15 strict, 48.5% recall@5, 40.5% recall@10, and 0.506 MRR.
Multi-hop
questions that require many distinct files are the clearest next retrieval-quality target.

## System Shape

`MomentumUploader` is a Next.js App Router repository whose original Sonic Memos product
records, uploads, transcribes, shares, discusses, imports, and queries voice memos. It now
also hosts the separate Sales Docs application.

Primary runtime boundaries:

- **Browser app:** `src/app/page.tsx`, `src/components/`, and `src/hooks/`.
- **Next route handlers:** `src/app/api/**/route.ts` and `src/app/s/[shareRef]/route.ts`.
- **Shared application primitives:** `src/lib/`.
- **Database/storage:** Supabase Postgres plus Storage bucket `voice-memos`.
- **Auth:** Clerk for web sessions, HMAC bearer tokens for desktop/API clients, OpenClaw API keys for agent runtimes.
- **Transcription:** NVIDIA Riva/Parakeet gRPC through `src/lib/riva.ts`, with `ffmpeg-static` transcoding.
- **LLM artifacts:** Anthropic in `src/lib/memo-artifacts.ts`.
- **Sales-document generation:** Anthropic in `src/lib/sales-doc-generation.ts`.
- **Memo agent worker:** separate Node package in `agent-worker/`, polling `job_runs`.
- **Native client:** incomplete Swift source fragments in `MomentumMemos/`; they currently
  write directly to Supabase and do not implement the repository's desktop bearer-token flow.

The app generally uses Clerk or bearer auth to resolve a `userId`, then server route handlers use
`supabaseAdmin` service-role access. RLS exists on many tables, but most server reads/writes rely on
explicit route-level ownership checks rather than RLS.

## Directory Map

| Path | Purpose |
| --- | --- |
| `src/app/` | App Router pages and route handlers. |
| `src/app/page.tsx` | Main authenticated/unauthed memo workspace shell. |
| `src/app/s/[shareRef]/route.ts` | Public share page, Markdown, JSON, and HEAD/OPTIONS rendering. |
| `src/components/` | Client UI components for recorder, memo workspace, share chat, theme, voiceover. |
| `src/components/sales-docs/` | Sales Docs workspace, document renderer, chat, coaching preview, drawers, and scoped CSS. |
| `src/hooks/` | Browser state machines for recording, live transcription, chunk upload, workspace list state, playback, voiceover. |
| `src/lib/` | Auth, Supabase, transcription, memo data contracts, sharing, rooms, OpenClaw, Fathom, jobs, artifacts. |
| `src/data/` | Sales Docs render contract plus large mock/fallback sessions. |
| `supabase/migrations/` | Checked-in schema evolution and SQL function tests. |
| `agent-worker/` | Separate memo-agent job runner package and Docker image. |
| `public/openclaw/memo-room/v1/` | Static OpenClaw skill bundle served to external agent runtimes. |
| `docs/` | Product, schema, OpenClaw, and architecture docs. |
| `MomentumMemos/` | Swift app sources for native recording/upload. |

## Repository Scale And Hotspots

At this revision the tracked repository is roughly 91k lines across 405 files. The
application contains 52 API route handlers, 102 tests under `src`, 23 SQL migrations,
and a separate worker test suite. Root Jest and TypeScript explicitly exclude the
worker, and no native test/build target is checked in.

Largest and/or highest-coupling files:

| File | Why it matters |
| --- | --- |
| `src/lib/share-contract.ts` (~3,600 lines) | Generates public share HTML/CSS/JS, Markdown, JSON, boot payload, and client behavior. |
| `src/components/memos/MemoStudioSections.tsx` (~1,371) | Owns most memo workspace presentation and several local UI state machines. |
| `src/lib/sales-doc-generation.ts` (~1,020) | Schema/prompt, validation, retry, session assembly, and demo coaching for Sales Docs. |
| `src/data/mockSalesDoc.ts` (~808) | Full fallback/demo data used by landing and authenticated empty/error states. |
| `src/components/sales-docs/ArtifactDocument.tsx` (~752) | Entire Sales Doc document surface plus outline and copy behavior. |
| `src/hooks/useMemosWorkspace.ts` (~677) | Memo list/detail, pagination, bookmarks, optimistic upload, title updates, and Fathom orchestration. |
| `src/components/memos/MemoAgentPanel.tsx` (~562) | Public-share chat session/history, Realtime subscription, and send state. |
| `src/lib/memo-artifacts.ts` (~510) | Artifact generation and job enqueueing. |

Import fan-in makes `src/lib/supabase.ts` and `src/lib/memo-api-auth.ts` the most
important backend dependency boundaries. Changes there have repo-wide blast radius.

## Configuration And Scripts

Main package: `package.json`

- `npm run dev`: Next dev server with IPv4 DNS preference.
- `npm run build`: production build, required before feature completion.
- `npm test -- --passWithNoTests`: required full Jest suite per project instructions.
- `npm run lint`: ESLint.
- `npm run sync:openclaw-skill`: syncs OpenClaw skill bundle.
- `npm run fetch:memos`: local fetch script.
- `npm run memory:index`: incrementally write `.repo-memory/index.json`.
- `npm run memory:ask -- "question"`: return ranked `path:start-end` citations; add
  `--json`, `--limit N`, or `--mode lexical` after `--` for agent consumption.
- `npm run memory:graph -- "path-or-symbol"`: list structural/data edges, including
  resolved target paths and symbols with confidence when available.
- `npm run memory:eval`: run the tracked 15-case clean-session retrieval suite.
- `npm run test:memory`: run the dependency-free repo-memory parser/index tests.

Test setup:

- Jest + React Testing Library via `jest.config.ts`.
- Test files are colocated as `*.test.ts` / `*.test.tsx`.
- `agent-worker/` tests are ignored by main Jest and run through `npm --prefix agent-worker test`.

Next config:

- `next.config.ts` raises request/server-action body limits to `75mb`.
- Includes `ffmpeg-static` in output tracing for `/api/transcribe` and `/api/transcribe/live`.

Global app shell:

- `src/app/layout.tsx` wraps all routes with `ClerkProvider` and `ThemeProvider`.
- `src/middleware.ts` validates Clerk env once, then applies Clerk middleware to pages and APIs.

## Core Data Model

Historical consolidated schema reference: `docs/database-schema.md` (currently stale;
see guidance below). Migration files remain the source for changes after 2026-05-19.

Important memo-native tables:

- `users`: minimal Clerk `sub` mirror.
- `memos`: top-level memo record, transcript fallback, audio URL, share metadata, status, Fathom source metadata.
- `memo_transcript_segments`: timestamped transcript source of truth, `source in ('live', 'final')`.
- `memo_transcript_chunks`: token-sized windows built from segments for artifacts/agent context.
- `memo_artifacts`: live/final summaries, outlines, titles, topics, action items.
- `job_runs`: shared queue for memo artifact jobs and memo-agent chat jobs.
- `memo_voiceovers`: persisted ElevenLabs speech-to-speech outputs.
- `shared_memo_bookmarks`: signed-in viewer bookmarks for public memos.
- `fathom_import_runs`: client-polled import state.
- `sales_doc_sessions`: owner-scoped Sales Docs snapshots stored as JSON plus
  redundant prompt/title/transcript/sidebar fields.

Collaboration and OpenClaw tables:

- `memo_rooms`, `memo_room_memos`, `memo_room_participants`, `memo_messages`, `message_reactions`.
- `agents`, `agent_room_state`, `agent_invocations`, `openclaw_runtimes`, `openclaw_claim_requests`, registration/rate-limit tables.
- `memo_agent_sessions`, `user_credits`, `credit_transactions` for the public share memo-agent chat.

Schema guidance:

- Treat `memos` and `memo_transcript_segments` as the memo-native foundation.
- Use `memo_transcript_chunks`, `memo_artifacts`, and `job_runs` for memo artifact orchestration.
- Do not route transcript infrastructure through generic `chunks`, `items`, or generic `artifacts` unless those schemas are explicitly extended with memo semantics.
- `docs/database-schema.md` is not currently a complete fresh-install source: it omits
  Fathom source fields/import runs and `sales_doc_sessions`. Checked-in migrations also
  assume pre-existing `users`, `memos`, and `job_runs` tables and the `voice-memos`
  storage bucket/policies.

## Auth And Trust Boundaries

| Boundary | Files | Notes |
| --- | --- | --- |
| Clerk web auth | `src/middleware.ts`, route handlers using `auth()` | Main browser sessions. Missing auth is often returned as 404 for owner-only memo APIs. |
| Bearer API tokens | `src/lib/api-token.ts`, `src/lib/memo-api-auth.ts`, `/api/auth/token`, `/api/connect/desktop/start`, `/api/auth/claim` | HMAC token format `vm1.payload.signature`; desktop flow stores one-time claim codes. |
| Supabase clients | `src/lib/supabase.ts` | `supabase` is public anon/RLS client; `supabaseAdmin` uses service role if present, falling back to anon. |
| Public shares | `src/lib/memo-share.ts`, `src/lib/share-route.ts`, `src/app/s/[shareRef]/route.ts` | Share token validates format, revoked/expired state, and read-only response formats. |
| Memo room participants | `src/lib/memo-rooms.ts`, `src/lib/agents.ts` | Human participants use Clerk/bearer user IDs; agent participants can use OpenClaw API keys or internal gateway headers. |
| OpenClaw runtime auth | `src/lib/openclaw-registry.ts`, `src/app/api/openclaw/*` | Runtime secrets are SHA-256 hashed and compared timing-safely. |
| Sales Docs | `src/app/sales-docs/page.tsx`, `src/app/sales-docs-recording/page.tsx`, `src/app/api/sales-docs/generate/route.ts` | Pages and generation explicitly call Clerk `auth()`; middleware alone does not protect them. |

`src/middleware.ts` initializes Clerk across matched pages and APIs, but does not enforce
authentication. Each page or route must still validate the viewer. Because most server
code uses the service-role client, ownership must be enforced in the route or query before
reading/mutating rows or storage objects.

## Main Browser Data Flow

Entry point: `src/app/page.tsx`

1. Clerk `useUser()` decides signed-in state.
2. `useMemosWorkspace()` owns memo list, pagination, search, selected memo, upload state, Fathom import polling, optimistic memo insertion, and selected memo detail refresh.
3. `src/app/page.tsx` owns only navigation-level state: `record` versus `feed`, the
   selected memo, and the guard that warns before navigation stops a live recording.
4. Exactly one center surface renders: `RecorderPanel`, `TranscriptFeedPanel`, or
   `MemoDetailView`. The feed defaults to summarized memo posts but can show transcript rows.
5. `MemoSidebar`, `TranscriptFeedPanel`, `MemoDetailView`, and `RecorderPanel` are exported from `src/components/memos/MemoStudioSections.tsx`.
6. `AudioRecorder` owns browser media capture and delegates to recording/live/chunk hooks.
7. Completed recordings call `handleUploadComplete`, which creates or updates an optimistic memo row, selects it, and later reconciles with `/api/memos`.

Important state owners:

- `src/hooks/useMemosWorkspace.ts`: memo list and upload orchestration.
- `src/components/AudioRecorder.tsx`: recorder composition and upload/finalize branching.
- `src/hooks/useAudioRecording.ts`: `MediaRecorder`, browser mic permissions, WebM header capture.
- `src/hooks/useLiveTranscription.ts`: composed live transcript state.
- `src/hooks/useLiveTranscription.session.ts`: live ASR polling, document visibility behavior, catch-up/final-tail logic.
- `src/hooks/useLiveTranscription.persistence.ts`: PATCHes live memo transcript and live segments.
- `src/hooks/useLiveTranscription.share.ts`: creates `/api/memos/live` row and share link.
- `src/hooks/useChunkUpload.ts`: signed Supabase Storage chunk uploads and pruning.
- `src/hooks/useMemoPlayback.ts`: audio playback and share-link copy state.
- `src/hooks/useVoiceoverStudio.ts`: speech-to-speech fetch/cache/playback state.
- `src/components/memos/MemoStudioSections.tsx`: memo-side presentation cluster; the
  transcript and Voiceover Studio are independently collapsible peer sections.

## Recording And Transcription Flow

Legacy multipart upload path (still implemented, but no longer wired from production `Home`):

1. UI sends `FormData(file, memoId?, provisionalTranscript?)` to `POST /api/transcribe`.
2. `src/app/api/transcribe/route.ts` resolves user ID and delegates to `src/app/api/transcribe/workflow-*`.
3. `parseUploadRequest()` validates body and size.
4. `uploadAudioToStorage()` uploads to `voice-memos/audio/...`.
5. `persistMemoProvisional()` inserts/updates `memos` with `transcript_status = processing`.
6. If no provisional transcript exists, `transcribeUploadedAudio()` calls `src/lib/riva.ts`.
7. `updateMemoFinal()` stores transcript, generates title, persists final segments, compacts chunks, and runs/enqueues artifact jobs.
8. If ASR fails after audio storage, `updateMemoFailed()` marks the memo failed but returns a degraded success response with saved audio.

Current manual MP3/M4A path:

1. `src/lib/audio-upload.ts` creates a live memo.
2. It requests signed chunk-upload data from `/api/transcribe/upload-chunks`.
3. The browser uploads the file directly with Supabase `uploadToSignedUrl`.
4. It calls `/api/transcribe/finalize`, sharing the same finalization path as recordings.

Live/long recording path:

1. `useLiveTranscriptionShare.startLiveShareSession()` calls `POST /api/memos/live`, then `POST /api/memos/[id]/share`.
2. Browser live ticks send rolling WebM snapshots to `POST /api/transcribe/live`.
3. Locked live segments are PATCHed to `/api/memos/[id]/segments/live`.
4. `useChunkUpload` periodically asks `/api/transcribe/upload-chunks` for signed upload URLs and uploads chunk ranges directly to Supabase Storage.
5. On stop, `AudioRecorder.handleFinalize()` flushes chunks and calls `POST /api/transcribe/finalize`.
6. Finalize either promotes provisional live segments to final or assembles uploaded chunk files, saves full audio, calls ASR, and finalizes.

Current production `/` does not pass `onAudioInput` into `RecorderPanel`. The older
`useMemosWorkspace.handleAudioInput` multipart/login-retry machinery remains in code and
tests but has no production caller.

Provider details:

- `src/lib/riva.ts` transcodes all audio to 16kHz mono WAV/PCM16 through ffmpeg.
- Live ASR calls are queued to protect the provider; final calls bypass the live queue to reduce stop-to-result lag.
- `src/app/api/transcribe/finalize/route.ts` validates chunk continuity before concatenation.

## Memo APIs

Owner APIs:

- `GET/POST /api/memos`: list paginated memos or create a manual memo.
- `GET/PATCH/DELETE /api/memos/[id]`: detail, title/transcript patch, delete.
- `POST /api/memos/live`: create in-progress live memo.
- `POST /api/memos/[id]/share`: create/update share token and return share URL.
- `GET /api/memos/[id]/download-chunks`: download failed recording chunks.
- `PATCH /api/memos/[id]/segments/live`: persist locked live segments and enqueue live compaction.
- `GET /api/memos/[id]/transcript`: bounded transcript window by time or segment range.
- `GET /api/memos/[id]/transcript/search`: simple term search over preferred final/live segments.
- `GET /api/memos/[id]/artifacts?source=live|final`: ready artifact map.
- `POST /api/memos/[id]/title`: regenerate memo title.
- `POST /api/memos/[id]/voiceover`: ElevenLabs speech-to-speech generation and persisted streaming.

Shared primitives:

- `src/lib/memo-ui.ts`: client `Memo` shape, status helpers, formatting, Markdown export, clipboard fallback.
- `src/lib/memo-transcript.ts`: preferred source loading, windowing, search.
- `src/lib/memo-chunks.ts`: transcript segment compaction.
- `src/lib/memo-artifacts.ts`: Anthropic/fallback summaries and outlines, final/live artifact jobs.
- `src/lib/memo-jobs.ts`: local synchronous drain of pending memo jobs via `claim_pending_memo_job`.

## Public Share Surface

Files:

- `src/app/s/[shareRef]/route.ts`
- `src/app/s/[shareRef]/chat/page.tsx`
- `src/lib/memo-share.ts`
- `src/lib/share-contract.ts`
- `src/lib/share-access.ts`
- `src/lib/share-route.ts`
- `src/components/memos/SharedMemoSummary.tsx`
- `src/components/memos/MemoAgentPanel.tsx`

Behavior:

- Share refs can be plain HTML, `.md`, `.json`, or `?format=html|md|json`.
- `share-contract.ts` renders the entire HTML page string, Markdown, JSON, embedded boot payload, AI destination links, live refresh behavior, bookmark/discussion widgets, and OpenClaw handoff metadata.
- Public share GET uses final artifacts if `transcriptStatus === "complete"`, otherwise live artifacts.
- Public share route is read-only; mutating HTTP methods return 405.
- `/s/[shareRef]/chat` is a React page that combines `SharedMemoSummary` and `MemoAgentPanel`.

Share-adjacent APIs:

- `/api/s/[shareRef]/bookmark`: viewer bookmark CRUD.
- `/api/shared-memo-bookmarks`: signed-in user's saved public memos.
- `/api/s/[shareRef]/discussion`: public share discussion.
- `/api/s/[shareRef]/claim`, `/invite`, `/handoff`, `/openclaw-status`: OpenClaw claim/invite/handoff lifecycle.

## Memo Rooms And Agents

Concept:

- A `memo_room` is a collaboration space attached to one or more memos.
- `memo_room_participants` represent humans, agents, or system actors.
- `memo_messages` are the comments/thread surface, optionally anchored to transcript time ranges and segment IDs.
- Visibility can be `public`, `owner_only`, or `restricted`.

Core files:

- `src/lib/memo-rooms.ts`: participant types, capability checks, visibility filtering, transcript anchor validation, serializers.
- `src/lib/memo-discussion.ts`: find or create canonical memo discussion room for a memo.
- `src/lib/agents.ts`: agent serialization and OpenClaw/human request context resolution.
- `src/components/memos/MemoRoomPanel.tsx`: owner UI for discussion, visibility selection, adding/invoking agents.

Main room routes:

- `POST /api/memo-rooms`: create/get room for memo.
- `GET /api/memos/[id]/room`: locate room for memo.
- `GET /api/memo-rooms/[roomId]`: room detail.
- `GET /api/memo-rooms/[roomId]/context`: room, memos, participants, recent visible messages, viewer agent state.
- `GET/POST /api/memo-rooms/[roomId]/messages`: visible message list and top-level post.
- `POST /api/memo-rooms/[roomId]/messages/[messageId]/reply`: reply post.
- `POST/DELETE /api/memo-rooms/[roomId]/messages/[messageId]/reactions`: human reactions.
- `POST/PATCH/DELETE /api/memo-rooms/[roomId]/participants...`: add/update/remove participants.
- `POST /api/memo-rooms/[roomId]/invocations`: create owner request for an agent.

Agent API routes:

- `/api/agents`: owner-owned agent CRUD-ish list/create.
- `/api/agents/[agentId]/rooms`, `/work-items`, `/invocations`, `/rooms/[roomId]/state`: OpenClaw runtime work surfaces.
- `/api/openclaw/registration-token`: owner issues one-time token.
- `/api/openclaw/register`: runtime exchanges token for `openclaw_external_id:secret`.

## Memo Agent Chat Worker

This is distinct from memo-room OpenClaw agents. It powers the public share "Memo agent" chat.

Client:

- `src/components/memos/MemoAgentPanel.tsx`
- `/api/memo-agent/[memoId]/session`
- `/api/memo-agent/[memoId]/history`
- `/api/memo-agent/[memoId]/chat`

Server flow:

1. Session route verifies the viewer is authenticated and that `shareToken` resolves to the requested memo.
2. It upserts `users`, resets monthly credits, and upserts `memo_agent_sessions`.
3. Chat route checks credits, inserts `job_runs` with `job_type = memo_agent_chat`, and returns a Supabase Realtime channel name.
4. Browser subscribes to that channel and appends streamed events.

Worker:

- `agent-worker/src/index.ts`: creates service-role Supabase client, recovers stale jobs, subscribes to `job_runs`, and drains queue.
- `agent-worker/src/worker.ts`: claims jobs, materializes workspace, runs Claude Agent SDK, emits realtime events, deducts credits, persists UI messages.
- `agent-worker/src/workspace.ts`: creates `/tmp/memo-workspaces/<sessionId>/context.md`, `transcript.md`, optional `attachments/memo-audio.*`.
- `agent-worker/src/credits.ts`: token/tool-round credit cost model.

Worker constraints:

- Max 5 global active jobs and 2 per user.
- Allowed model tools are read/search only: `Read`, `Glob`, `Grep`.
- Execution always uses the Claude Agent SDK. OpenAI/Google are model-name/config stubs,
  not implemented provider clients.
- `agent-worker/src/index.ts` resets chat jobs running over five minutes, subscribes to
  `job_runs`, polls every ten seconds, and cleans stale workspaces hourly.
- `/tmp/memo-workspaces/<sessionId>` contains `context.md`, preferred final
  `transcript.md`, `.last_active`, and optional downloaded audio. Cleanup removes entries
  inactive for more than 24 hours.
- Concurrency limits are process-local. Cross-replica single-claim behavior comes from
  `claim_pending_agent_job()` and `FOR UPDATE SKIP LOCKED`.

## Fathom Import

Files:

- `src/lib/fathom-import.ts`
- `src/hooks/useMemosWorkspace.ts`
- `/api/fathom/import`
- `/api/fathom/import/[jobId]`
- `/api/fathom/import/settings`
- `supabase/migrations/20260608194213_add_fathom_import_runs.sql`

Flow:

1. Client starts import with `POST /api/fathom/import`.
2. Route creates a `fathom_import_runs` row and returns `202`.
3. Client polls `/api/fathom/import/[jobId]`.
4. Each GET processes one Fathom page, normalizes meetings/transcript entries, upserts into `memos` on `(user_id, source_app, source_id)`, and replaces final segments.
5. The run completes when Fathom returns no `next_cursor`.

Important boundary: import execution happens during polling requests, not in a background worker.

## Voiceover

Files:

- `src/components/VoiceoverStudio.tsx`
- `src/hooks/useVoiceoverStudio.ts`
- `/api/memos/[id]/voiceover`
- `src/lib/elevenlabs-voices.ts`
- `supabase/migrations/20260310230000_add_memo_voiceovers.sql`

Flow:

1. User opens Voiceover Studio on a memo with audio.
2. Client selects a curated voice and POSTs `{ voiceId }`.
3. Server checks memo ownership, fetches source audio, calls ElevenLabs speech-to-speech, stores generated MP3 in `voice-memos/voiceovers/...`, updates `memo_voiceovers`, and streams audio back.
4. Client caches up to 20 generated object URLs per memo.

The route has fallback behavior for deployments where `memo_voiceovers` is missing, but proper persistence requires the migration.

## Sales Docs

Sales Docs is a second application inside the same Next deployment, not a mode of Sonic
Memos. Its implementation is isolated under `src/app/sales-docs*`,
`src/components/sales-docs/`, `src/data/salesDocTypes.ts`, `src/data/mockSalesDoc.ts`,
`src/lib/sales-doc-generation.ts`, and `src/lib/sales-doc-sessions.ts`.

Routes:

- `/sales-docs-landing`: public marketing page. It embeds the real workspace component
  with mock sessions as a scaled, inert product mockup.
- `/sales-docs`: Clerk-gated server page. It loads the newest 20 owner sessions and falls
  back to polished mocks when no rows exist or loading fails.
- `/sales-docs-recording`: Clerk-gated static recording prototype. It does not record,
  upload, transcribe, or generate.
- `POST /api/sales-docs/generate`: Clerk-gated generation and best-effort persistence.

Canonical UI contract:

```text
SalesSession
├── chat -> ChatPanel
└── doc: SalesDoc
    ├── sourceInputs -> prompt/upload descriptors
    ├── callBrief, salesDiagnosis, beliefLadder
    ├── pitchScript, objectionPrep, callFlow, nextBestQuestions
    └── liveCoaching -> demo-derived prep preview
```

Client flow:

1. `LandingPromptForm` sends the prompt in `/sales-docs?prompt=...`.
2. The server page preserves that target through Clerk sign-in and loads persisted sessions.
3. `SalesDocsWorkspace` removes the query string after hydration and starts generation once.
4. A pending sidebar row, `GeneratingDocument`, and pending coaching rail replace the
   stale active document.
5. `POST /api/sales-docs/generate` returns a complete new `SalesSession`; composer sends
   also create new sessions rather than mutating the active one.
6. Success prepends/activates the new session. Failure restores the prior document and
   leaves the chat error visible.

Server flow:

1. The route caps prompts at 4,000 characters and transcripts at 200,000.
2. `generateSalesDoc()` calls `claude-opus-4-8` with adaptive thinking and up to 32k
   output tokens. The full JSON schema is placed in the prompt, not enforced through
   provider structured output.
3. Returned text is fence-stripped, JSON-parsed, runtime-validated, and retried once only
   for invalid JSON or contract validation failure.
4. Server code assigns IDs/timestamps/source metadata and derives a static demo coaching
   preview from diagnosis gaps and Belief Ladder status.
5. `saveSalesDocSession()` provisions `users` and inserts the whole session JSON plus
   scalar columns. Save failure is logged but does not fail the generation response.

Implemented interaction is narrower than the visual surface. Session selection, prompt
generation, outline scrolling, section/document copy, responsive drawers, auth, loading,
and persistence work. Recording/upload/paste, real live coaching, export, regenerate,
share, session CRUD, most navigation/top-bar actions, and the Call Brief alternate view
are still inert concepts.

Sales Docs does not currently reuse memo audio, transcription, Fathom, artifacts, rooms,
OpenClaw, or the agent worker. Although the API accepts a `transcript`, no Sales Docs UI
submits one.

## Desktop And Native Client

Files:

- `src/lib/api-token.ts`
- `src/lib/desktop-token-claims.ts`
- `/api/auth/token`
- `/api/connect/desktop/start`
- `/api/auth/claim`
- `src/app/connect/desktop/page.tsx`
- `MomentumMemos/Sources/**`

Flow:

- Web user can issue a bearer token directly through `/api/auth/token`.
- Desktop connection flow creates a one-time short code via `/api/connect/desktop/start`.
- `/api/auth/claim` can atomically exchange that code for a bearer token.
- `resolveMemoUserId()` accepts Clerk session first, then bearer token.
- The checked-in Swift sources do **not** implement this server contract. They directly
  upload with a Supabase anon key, contain unresolved symbols/missing project metadata,
  and should be treated as a non-buildable prototype rather than a supported client.

The Swift tree has no `.xcodeproj`, `Package.swift`, entitlements, `Info.plist`, tests, or
CI. It also lacks connect-code UI, token persistence, bearer headers, and server
transcription/finalization calls.

## Feature And Marketing Pages

- `/features/openclaw`: large OpenClaw product/integration page.
- `/features/speaker-diarization`: large feature page.
- `/docs`: API documentation page.
- `/portfolio`: lightweight showcase.
- `/sign-in/[[...sign-in]]`: Clerk sign-in page.
- `/sales-docs-landing`: public Sales Docs marketing and product mockup.
- `/sales-docs`: authenticated Sales Docs workspace.
- `/sales-docs-recording`: authenticated but static recording concept.

These are user-facing but mostly separate from memo data flow, except `/docs` exposes API-token guidance and `/features/openclaw` links into OpenClaw flows.

## Most Likely Files To Change

| Product area | Likely files |
| --- | --- |
| Main memo list/workspace UI | `src/app/page.tsx`, `src/hooks/useMemosWorkspace.ts`, `src/components/memos/MemoStudioSections.tsx`, `src/lib/memo-ui.ts` |
| Memo record/feed/detail navigation | `src/app/page.tsx`, `src/components/memos/MemoStudioSections.tsx` |
| Recording controls and mic behavior | `src/components/AudioRecorder.tsx`, `src/hooks/useAudioRecording.ts`, `src/components/audio-recorder/*` |
| Live transcript UX/windowing | `src/hooks/useLiveTranscription*.ts`, `src/hooks/live-transcript-*`, `src/components/audio-recorder/LiveTranscriptView.tsx` |
| Chunk upload/finalization | `src/hooks/useChunkUpload.ts`, `/api/transcribe/upload-chunks`, `/api/transcribe/finalize`, `src/app/api/transcribe/workflow-*` |
| NVIDIA/Riva transcription | `src/lib/riva.ts`, `/api/transcribe/live`, `/api/transcribe/route.ts`, `next.config.ts` |
| Memo CRUD/list/detail | `/api/memos/**`, `src/lib/memo-api-auth.ts`, `src/lib/memo-ui.ts`, `src/lib/transcript.ts` |
| Transcript search/window APIs | `/api/memos/[id]/transcript/**`, `src/lib/memo-transcript.ts` |
| Memo artifacts/summaries/outlines | `src/lib/memo-chunks.ts`, `src/lib/memo-artifacts.ts`, `src/lib/memo-jobs.ts`, `/api/memos/[id]/artifacts` |
| Public share page | `src/app/s/[shareRef]/route.ts`, `src/lib/share-contract.ts`, `src/lib/memo-share.ts`, `src/lib/share-access.ts`, `src/components/memos/SharedMemoSummary.tsx` |
| Share bookmarks/discussion | `/api/s/[shareRef]/*`, `/api/shared-memo-bookmarks`, `src/lib/shared-memo-bookmarks.ts`, `src/lib/user-identity.ts` |
| Memo rooms | `src/lib/memo-rooms.ts`, `src/lib/memo-discussion.ts`, `/api/memo-rooms/**`, `src/components/memos/MemoRoomPanel.tsx` |
| OpenClaw runtime integration | `src/lib/agents.ts`, `src/lib/openclaw-*`, `/api/openclaw/**`, `/api/agents/**`, `public/openclaw/memo-room/v1/*` |
| Memo-agent share chat | `src/components/memos/MemoAgentPanel.tsx`, `/api/memo-agent/**`, `agent-worker/src/*`, `supabase/migrations/20260412000000_add_memo_agent.sql` |
| Fathom import | `src/lib/fathom-import.ts`, `src/hooks/useMemosWorkspace.ts`, `/api/fathom/import/**`, Fathom migration |
| Voiceover Studio | `src/hooks/useVoiceoverStudio.ts`, `src/components/VoiceoverStudio.tsx`, `/api/memos/[id]/voiceover`, `src/lib/elevenlabs-voices.ts` |
| Desktop/native auth | `src/lib/api-token.ts`, `src/lib/desktop-token-claims.ts`, `/api/auth/*`, `/api/connect/desktop/start`, `MomentumMemos/Sources/**` |
| Sales Docs workspace/UI | `src/app/sales-docs*/`, `src/components/sales-docs/*`, `src/data/salesDocTypes.ts`, `src/data/mockSalesDoc.ts` |
| Sales Docs generation | `/api/sales-docs/generate`, `src/lib/sales-doc-generation.ts`, `src/lib/sales-doc-generation.fixtures.ts` |
| Sales Docs persistence | `src/lib/sales-doc-sessions.ts`, `supabase/migrations/20260611152301_add_sales_doc_sessions.sql` |
| Database schema | `supabase/migrations/*.sql`, `docs/database-schema.md`, nearby migration tests |

## Test Map

There is broad test coverage. Use nearest tests first, then full suite.

| Area | Tests |
| --- | --- |
| Main workspace | `src/hooks/useMemosWorkspace*.test.tsx`, `src/app/__tests__/*`, `src/components/memos/MemoStudioSections.test.tsx` |
| Recorder/live | `src/components/AudioRecorder*.test.tsx`, `src/hooks/useLiveTranscription*.test.tsx`, `src/hooks/useChunkUpload*.test.tsx`, `src/components/audio-recorder/*test*` |
| Transcription APIs | `src/app/api/transcribe/*.test.ts`, `src/app/api/transcribe/workflow.test.ts`, `src/lib/riva*.test.ts` |
| Memo APIs | `src/app/api/memos/**/*.test.ts`, `src/lib/memo-*.test.ts` |
| Share | `src/app/s/[shareRef]/route.test.ts`, `src/app/s/[shareRef]/chat/page.test.tsx`, `src/lib/share-*.test.ts`, `src/components/memos/SharedMemoSummary.test.tsx` |
| Rooms/agents | `src/app/api/memo-rooms/**/*.test.ts`, `src/app/api/agents/**/*.test.ts`, `src/lib/agents.test.ts`, `src/lib/memo-discussion.test.ts` |
| Memo-agent worker | `agent-worker/src/*.test.ts` with `npm --prefix agent-worker test` |
| Fathom | `src/app/api/fathom/**/*.test.ts`, `src/lib/fathom-import.ts` coverage through route tests |
| Voiceover | `src/app/api/memos/[id]/voiceover/route.test.ts`, `src/hooks/useVoiceoverStudio.ts` indirectly through component tests |
| Sales Docs | `src/app/sales-docs*/page.test.tsx`, `src/app/api/sales-docs/generate/route.test.ts`, `src/components/sales-docs/*.test.tsx`, `src/lib/sales-doc-*.test.ts`, Sales Docs migration test |
| Migrations | `supabase/migrations/*.test.ts` |
| Repository memory | `scripts/repo-memory.test.mjs` (chunking, incremental reuse, resolved calls, deterministic hybrid/lexical ranking); clean-session retrieval cases in `docs/repo-memory-eval.json` |

Root verification does not include `agent-worker/`; use `npm --prefix agent-worker test`
separately. The native prototype has no test/build target. Only the worker Docker smoke
test has checked-in CI; there is no root lint/test/build CI workflow.

## Risks And Unclear Boundaries

- **Unauthenticated live-ASR spend:** `POST /api/transcribe/live` performs ffmpeg and
  NVIDIA work without auth, an explicit maximum size, or rate limiting.
- **Chunk download ownership gap:** `/api/memos/[id]/download-chunks` requires Clerk but
  does not verify that the requested memo belongs to the viewer before listing/downloading
  `audio/chunks/<memoId>`.
- **Anonymous orphan memos:** `POST /api/memos` permits a missing user and inserts
  `user_id: null`.
- **Provisional-finalize tenant gap:** the provisional transcript branch calls
  `promoteLiveSegmentsToFinal(memoId, userId)`, whose segment select/delete filters by
  memo ID but not owner. `updateMemoFinal()` filters its memo update by owner but does not
  prove a row changed, so a guessed foreign memo ID can corrupt final segments and still
  produce a success response.
- **Server-side arbitrary URL fetch:** manual memo creation accepts `audioUrl`, while
  Voiceover and the worker fetch stored memo audio URLs. This forms an SSRF boundary and
  needs URL/host/size/time restrictions.
- **Public storage capability:** original audio and generated voiceovers use permanent
  public object URLs. Row ownership protects discovery, not possession of the URL.
- **Security-definer grants:** queue/credit RPC migrations use `SECURITY DEFINER` without
  revoking default `PUBLIC` execute and granting only the intended service role. Verify
  live grants before assuming these functions are private.
- **`supabaseAdmin` fallback:** `src/lib/supabase.ts` falls back from service role to anon key if `SUPABASE_SERVICE_ROLE_KEY` is missing. Many routes assume service-role behavior, so missing env can become confusing authorization/storage failures.
- **Route-level authorization is critical:** Server handlers bypass RLS, so every new route must explicitly check ownership/participant visibility before reading or mutating.
- **Share renderer size:** `src/lib/share-contract.ts` is a 3,600-line string renderer with embedded CSS/JS/HTML. Changes are high risk and should be covered by `share-contract.test.ts` plus route tests.
- **Large UI files:** `MemoStudioSections.tsx`, `useMemosWorkspace.ts`, `AudioRecorder.tsx`, and `MemoAgentPanel.tsx` contain several concerns each. Avoid broad refactors unless adding focused tests first.
- **Live/final transcript race:** Live PATCHes can arrive after finalization. `/api/memos/[id]` returns 409 when transcript status is complete/failed, but related live segment and job behavior should be considered for changes.
- **Chunk continuity:** Finalization requires contiguous chunk ranges from 0 to `totalChunks`. Any change to pruning, start/end indices, or header handling must update chunk-upload and finalize tests together.
- **Job type overloading:** `job_runs` powers memo artifact jobs and memo-agent chat jobs.
  `claim_pending_memo_job` claims any pending `entity_type='memo'` row, including unsupported
  job types that TypeScript later fails. New jobs need careful claim/uniqueness/status compatibility.
- **`job_runs` base table is not created in checked-in migrations:** migrations add indexes/functions/columns against `job_runs`, while `docs/database-schema.md` reconstructs the base table. Fresh installs must follow the consolidated schema doc or add a base-table migration.
- **Type mismatch risk around job IDs:** app code and docs often treat `job_runs.id` as UUID, while `agent-worker/src/types.ts` and some tests type job IDs as `number`. Verify the live schema before changing credit transactions or worker code.
- **Fathom import is request-driven:** Long imports depend on client polling. If the browser stops polling, the run stalls in queued/running state until polled again.
- **Provider/env-dependent paths:** NVIDIA, Anthropic, ElevenLabs, Fathom, Clerk, Supabase, and OpenClaw code paths depend on env. Tests mock most of these; production failures often appear as route-level 500/502/503.
- Fathom requests remove copy/paste whitespace from API keys and reject remaining
  non-printable/non-ASCII characters before fetch. Transport errors use credential-free
  messages; import serialization redacts historical invalid-header errors.
- **Deployment-global Fathom account:** `FATHOM_API_KEY` is global, not per-user OAuth;
  every authorized user imports from the same configured Fathom account.
- **OpenClaw schema compatibility:** Several OpenClaw routes intentionally degrade when migrations are missing. Check `openclaw-compat.ts` and relevant migration tests before removing fallbacks.
- **Public discussion/bookmark scripts:** Public share engagement lives partly in generated HTML/JS rather than React components, so normal component patterns do not apply.
- **Native app boundary:** the Swift tree is not buildable as checked in and bypasses the
  server auth/transcription contracts. Treat it as a prototype until a project, missing
  symbols, bearer flow, server upload flow, tests, and CI exist.
- **Worker slot leak:** `processJob()` increments its per-user active count before session
  lookup/workspace materialization, but the protecting `finally` begins afterward.
  Early failure leaks the slot until process restart and leaves the job for stale recovery.
- **Worker event race:** the browser enqueues before subscribing to the returned Realtime
  channel. There is no status/result catch-up endpoint, so fast completion, reload, socket
  loss, or worker failure can strand client send state.
- **Worker credits are postpaid:** enqueue only checks for balance >= 1, while actual cost
  is deducted after provider work. Expensive output can be generated and then discarded.
- **Worker multi-replica semantics:** database claiming prevents the same pending row from
  being claimed concurrently, but process-local per-user limits and five-minute stale-job
  recovery do not coordinate across replicas; slow active work can be requeued.
- **Worker materialized data:** memo transcript/audio is written under a persistent
  `/tmp/memo-workspaces` volume for up to 24 hours. Audio download is fully buffered and
  has no explicit byte limit, timeout, or hostname policy.
- **Sales Docs persistence ambiguity:** generation succeeds even when save fails, and
  missing/empty/error states render mocks. A successful-looking document can disappear
  after refresh while the UI still appears populated.
- **Unvalidated stored Sales Docs JSON:** listing casts `session_json` directly to
  `SalesSession`; malformed or old-schema rows can crash the workspace. The component
  also assumes at least one initial session.
- **Sales Docs cost/idempotency:** generation allows five minutes, Opus, 32k output,
  adaptive thinking, and one full corrective retry, with no cancellation or idempotency.
- **Sales Docs prompt URL exposure:** landing inputs travel in the query string and Clerk
  redirect before hydration removes them, exposing prospect details to history/log/referrer
  surfaces.
- **Sales Docs schema/query mismatch:** `user_id` is nullable and the index is global
  `created_at`; the actual access pattern needs `(user_id, created_at desc)`. There is no
  schema version, update/delete API, or direct-user RLS policy.
- **Sales Docs UI overstates implementation:** recording, input upload/paste, live coaching,
  export/regenerate/share, session CRUD, and many navigation/top-bar controls are visual only.
- **Orphaned upload implementation:** `useMemosWorkspace.handleAudioInput` remains tested
  but production `Home` no longer connects it; current manual files use signed chunk upload.
- **Auth capability inconsistency:** some memo APIs accept Clerk or bearer auth while memo
  detail/update/delete, live creation, share, artifacts, title, voiceover, bookmarks, and
  share discussion are Clerk-only. Desktop/API clients do not have a uniform surface.
- **Non-atomic workflows:** memo finalization, Fathom import, rooms/invocations, artifacts,
  voiceovers, and worker completion span multiple row/storage operations. Partial success is
  an expected state that callers and repair tooling must handle.

## Change Workflow Recommendations

- Root `AGENTS.md` points nontrivial tasks to this map and the relationship graph. Treat
  them as orientation, then read the nearest implementation and tests before changing behavior.
- Refresh the local retrieval index with `npm run memory:index` after source or memory-map
  changes; use `memory:ask` and `memory:graph` to orient, then verify citations in code.
- For any behavior change, write or update the nearest failing test first.
- Prefer route tests for API behavior and hook/component tests for client state.
- For schema changes, add a migration test next to the SQL migration.
- For share HTML changes, test both rendered contract helpers and `/s/[shareRef]` route formats.
- For live recording changes, test browser hook state and server finalize/chunk behavior together.
- Before declaring feature work complete, run `npm test -- --passWithNoTests` and `npm run build`.
- When touching the worker, also run `npm --prefix agent-worker test`; root Jest/build do
  not cover it. There is currently no repository-native verification path for Swift.
