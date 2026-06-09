# Codebase Map

Last mapped: 2026-06-09

This map describes the `voice-memos/` application inside `MomentumUploader`. The root
`/Users/marko/Code/MomentumUploader` folder is a container; the active git repo, package,
tests, Next app, Supabase migrations, and worker live under `voice-memos/`.

## System Shape

`voice-memos` is a Next.js App Router application for recording, uploading, transcribing,
sharing, discussing, importing, and querying voice memos.

Primary runtime boundaries:

- **Browser app:** `src/app/page.tsx`, `src/components/`, and `src/hooks/`.
- **Next route handlers:** `src/app/api/**/route.ts` and `src/app/s/[shareRef]/route.ts`.
- **Shared application primitives:** `src/lib/`.
- **Database/storage:** Supabase Postgres plus Storage bucket `voice-memos`.
- **Auth:** Clerk for web sessions, HMAC bearer tokens for desktop/API clients, OpenClaw API keys for agent runtimes.
- **Transcription:** NVIDIA Riva/Parakeet gRPC through `src/lib/riva.ts`, with `ffmpeg-static` transcoding.
- **LLM artifacts:** Anthropic in `src/lib/memo-artifacts.ts`.
- **Memo agent worker:** separate Node package in `agent-worker/`, polling `job_runs`.
- **Native client:** Swift sources in `MomentumMemos/`, using desktop token claims and memo APIs.

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
| `src/hooks/` | Browser state machines for recording, live transcription, chunk upload, workspace list state, playback, voiceover. |
| `src/lib/` | Auth, Supabase, transcription, memo data contracts, sharing, rooms, OpenClaw, Fathom, jobs, artifacts. |
| `supabase/migrations/` | Checked-in schema evolution and SQL function tests. |
| `agent-worker/` | Separate memo-agent job runner package and Docker image. |
| `public/openclaw/memo-room/v1/` | Static OpenClaw skill bundle served to external agent runtimes. |
| `docs/` | Product, schema, OpenClaw, and architecture docs. |
| `MomentumMemos/` | Swift app sources for native recording/upload. |

## Configuration And Scripts

Main package: `package.json`

- `npm run dev`: Next dev server with IPv4 DNS preference.
- `npm run build`: production build, required before feature completion.
- `npm test -- --passWithNoTests`: required full Jest suite per project instructions.
- `npm run lint`: ESLint.
- `npm run sync:openclaw-skill`: syncs OpenClaw skill bundle.
- `npm run fetch:memos`: local fetch script.

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

Canonical schema reference: `docs/database-schema.md`.

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

Collaboration and OpenClaw tables:

- `memo_rooms`, `memo_room_memos`, `memo_room_participants`, `memo_messages`, `message_reactions`.
- `agents`, `agent_room_state`, `agent_invocations`, `openclaw_runtimes`, `openclaw_claim_requests`, registration/rate-limit tables.
- `memo_agent_sessions`, `user_credits`, `credit_transactions` for the public share memo-agent chat.

Schema guidance:

- Treat `memos` and `memo_transcript_segments` as the memo-native foundation.
- Use `memo_transcript_chunks`, `memo_artifacts`, and `job_runs` for memo artifact orchestration.
- Do not route transcript infrastructure through generic `chunks`, `items`, or generic `artifacts` unless those schemas are explicitly extended with memo semantics.

## Auth And Trust Boundaries

| Boundary | Files | Notes |
| --- | --- | --- |
| Clerk web auth | `src/middleware.ts`, route handlers using `auth()` | Main browser sessions. Missing auth is often returned as 404 for owner-only memo APIs. |
| Bearer API tokens | `src/lib/api-token.ts`, `src/lib/memo-api-auth.ts`, `/api/auth/token`, `/api/connect/desktop/start`, `/api/auth/claim` | HMAC token format `vm1.payload.signature`; desktop flow stores one-time claim codes. |
| Supabase clients | `src/lib/supabase.ts` | `supabase` is public anon/RLS client; `supabaseAdmin` uses service role if present, falling back to anon. |
| Public shares | `src/lib/memo-share.ts`, `src/lib/share-route.ts`, `src/app/s/[shareRef]/route.ts` | Share token validates format, revoked/expired state, and read-only response formats. |
| Memo room participants | `src/lib/memo-rooms.ts`, `src/lib/agents.ts` | Human participants use Clerk/bearer user IDs; agent participants can use OpenClaw API keys or internal gateway headers. |
| OpenClaw runtime auth | `src/lib/openclaw-registry.ts`, `src/app/api/openclaw/*` | Runtime secrets are SHA-256 hashed and compared timing-safely. |

## Main Browser Data Flow

Entry point: `src/app/page.tsx`

1. Clerk `useUser()` decides signed-in state.
2. `useMemosWorkspace()` owns memo list, pagination, search, selected memo, upload state, Fathom import polling, optimistic memo insertion, and selected memo detail refresh.
3. `MemoSidebar`, `TranscriptFeedPanel`, `MemoDetailView`, and `RecorderPanel` are exported from `src/components/memos/MemoStudioSections.tsx`.
4. `AudioRecorder` owns browser media capture and delegates to recording/live/chunk hooks.
5. Completed recordings call `handleUploadComplete`, which creates or updates an optimistic memo row, selects it, and later reconciles with `/api/memos`.

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

## Recording And Transcription Flow

Short/manual upload path:

1. UI sends `FormData(file, memoId?, provisionalTranscript?)` to `POST /api/transcribe`.
2. `src/app/api/transcribe/route.ts` resolves user ID and delegates to `src/app/api/transcribe/workflow-*`.
3. `parseUploadRequest()` validates body and size.
4. `uploadAudioToStorage()` uploads to `voice-memos/audio/...`.
5. `persistMemoProvisional()` inserts/updates `memos` with `transcript_status = processing`.
6. If no provisional transcript exists, `transcribeUploadedAudio()` calls `src/lib/riva.ts`.
7. `updateMemoFinal()` stores transcript, generates title, persists final segments, compacts chunks, and runs/enqueues artifact jobs.
8. If ASR fails after audio storage, `updateMemoFailed()` marks the memo failed but returns a degraded success response with saved audio.

Live/long recording path:

1. `useLiveTranscriptionShare.startLiveShareSession()` calls `POST /api/memos/live`, then `POST /api/memos/[id]/share`.
2. Browser live ticks send rolling WebM snapshots to `POST /api/transcribe/live`.
3. Locked live segments are PATCHed to `/api/memos/[id]/segments/live`.
4. `useChunkUpload` periodically asks `/api/transcribe/upload-chunks` for signed upload URLs and uploads chunk ranges directly to Supabase Storage.
5. On stop, `AudioRecorder.handleFinalize()` flushes chunks and calls `POST /api/transcribe/finalize`.
6. Finalize either promotes provisional live segments to final or assembles uploaded chunk files, saves full audio, calls ASR, and finalizes.

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
- Default provider is Anthropic, with config stubs for OpenAI/Google model names.

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
- Native client claims that code via `/api/auth/claim` and then uses bearer auth against memo APIs.
- `resolveMemoUserId()` accepts Clerk session first, then bearer token.

## Feature And Marketing Pages

- `/features/openclaw`: large OpenClaw product/integration page.
- `/features/speaker-diarization`: large feature page.
- `/docs`: API documentation page.
- `/portfolio`: lightweight showcase.
- `/sign-in/[[...sign-in]]`: Clerk sign-in page.

These are user-facing but mostly separate from memo data flow, except `/docs` exposes API-token guidance and `/features/openclaw` links into OpenClaw flows.

## Most Likely Files To Change

| Product area | Likely files |
| --- | --- |
| Main memo list/workspace UI | `src/app/page.tsx`, `src/hooks/useMemosWorkspace.ts`, `src/components/memos/MemoStudioSections.tsx`, `src/lib/memo-ui.ts` |
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
| Migrations | `supabase/migrations/*.test.ts` |

## Risks And Unclear Boundaries

- **`supabaseAdmin` fallback:** `src/lib/supabase.ts` falls back from service role to anon key if `SUPABASE_SERVICE_ROLE_KEY` is missing. Many routes assume service-role behavior, so missing env can become confusing authorization/storage failures.
- **Route-level authorization is critical:** Server handlers bypass RLS, so every new route must explicitly check ownership/participant visibility before reading or mutating.
- **Share renderer size:** `src/lib/share-contract.ts` is a 3,600-line string renderer with embedded CSS/JS/HTML. Changes are high risk and should be covered by `share-contract.test.ts` plus route tests.
- **Large UI files:** `MemoStudioSections.tsx`, `useMemosWorkspace.ts`, `AudioRecorder.tsx`, and `MemoAgentPanel.tsx` contain several concerns each. Avoid broad refactors unless adding focused tests first.
- **Live/final transcript race:** Live PATCHes can arrive after finalization. `/api/memos/[id]` returns 409 when transcript status is complete/failed, but related live segment and job behavior should be considered for changes.
- **Chunk continuity:** Finalization requires contiguous chunk ranges from 0 to `totalChunks`. Any change to pruning, start/end indices, or header handling must update chunk-upload and finalize tests together.
- **Job type overloading:** `job_runs` powers memo artifact jobs and memo-agent chat jobs. Different SQL functions claim different subsets. New jobs need careful uniqueness/index/status compatibility.
- **`job_runs` base table is not created in checked-in migrations:** migrations add indexes/functions/columns against `job_runs`, while `docs/database-schema.md` reconstructs the base table. Fresh installs must follow the consolidated schema doc or add a base-table migration.
- **Type mismatch risk around job IDs:** app code and docs often treat `job_runs.id` as UUID, while `agent-worker/src/types.ts` and some tests type job IDs as `number`. Verify the live schema before changing credit transactions or worker code.
- **Fathom import is request-driven:** Long imports depend on client polling. If the browser stops polling, the run stalls in queued/running state until polled again.
- **Provider/env-dependent paths:** NVIDIA, Anthropic, ElevenLabs, Fathom, Clerk, Supabase, and OpenClaw code paths depend on env. Tests mock most of these; production failures often appear as route-level 500/502/503.
- **OpenClaw schema compatibility:** Several OpenClaw routes intentionally degrade when migrations are missing. Check `openclaw-compat.ts` and relevant migration tests before removing fallbacks.
- **Public discussion/bookmark scripts:** Public share engagement lives partly in generated HTML/JS rather than React components, so normal component patterns do not apply.
- **Native app boundary:** Swift sources exist but this map focused on the web/worker implementation. Changes to token issuance or upload contract should inspect `MomentumMemos/Sources/Core/*`.

## Change Workflow Recommendations

- For any behavior change, write or update the nearest failing test first per `AGENTS.md`.
- Prefer route tests for API behavior and hook/component tests for client state.
- For schema changes, add a migration test next to the SQL migration.
- For share HTML changes, test both rendered contract helpers and `/s/[shareRef]` route formats.
- For live recording changes, test browser hook state and server finalize/chunk behavior together.
- Before declaring feature work complete, run `npm test -- --passWithNoTests` and `npm run build`.
