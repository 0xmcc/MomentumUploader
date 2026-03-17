## Codebase Overview

The `voice-memos` application is a Next.js App Router app (`next` 14/16 generation, React 19) located in the `voice-memos/` directory. It uses TypeScript in strict mode, Clerk for authentication, and Supabase (Postgres + Storage) as the primary data store. Transcription is handled via NVIDIA Riva/Parakeet APIs wrapped in `src/lib/riva.ts`, invoked by API routes under `src/app/api/transcribe/*`. Background memo processing and artifact generation are orchestrated with a `job_runs` table and a `runPendingMemoJobs` loop in `src/lib/memo-jobs.ts`, using a Supabase RPC to claim jobs.

The core user‑facing surface is a “memo studio” page at `src/app/page.tsx`, which composes memo list, recorder controls, and memo detail/outline panes. Memos can be shared publicly via tokenized URLs (`/s/[shareRef]`), which render read‑only HTML/Markdown/JSON views combining the memo, its transcript segments, and any generated artifacts (summaries, outlines, titles). The system already distinguishes between live (in‑progress) and final transcripts and has a layered model: base `memos` rows, per‑segment transcript rows, chunked transcript rows, and artifact rows.

## Repository Map

**Top‑level (relevant sections)**

- `AGENTS.md` – repository‑wide agent instructions and tech stack summary.
- `docs/` – root documentation (this file plus planning docs).
- `voice-memos/` – Next.js app.

**`voice-memos/` high‑level structure**

- `package.json` – Next.js, React, Clerk, Supabase, Anthropic, Jest/RTL, ESLint, Tailwind.
- `src/app/`
  - `layout.tsx` – root layout, `ClerkProvider`, theme, metadata.
  - `page.tsx` – memo studio UI.
  - `s/[shareRef]/route.ts` – share route (HTML/MD/JSON).
  - `api/` – all data‑plane and auth endpoints (see “Existing API Routes”).
  - misc marketing/docs routes.
- `src/components/`
  - `memos/MemoStudioSections.tsx` – layout for sidebar/recorder/detail.
  - `audio-recorder/*` – recording + live transcript UI.
  - `OutlinePanel.tsx`, `VoiceoverStudio.tsx`, etc.
- `src/hooks/`
  - `useAudioRecording.ts` – MediaRecorder integration.
  - `useChunkUpload.ts` – streaming upload of audio chunks.
  - `useLiveTranscription*.ts` – live ASR pipeline + persistence.
  - `useMemosWorkspace.ts` – memo list/search/selection.
  - `useArtifacts.ts`, `useMemoPlayback.ts`, `useVoiceoverStudio.ts`.
- `src/lib/`
  - `supabase.ts` – anon + admin clients, `uploadAudio`.
  - `memo-api-auth.ts` – resolves a “memo user id” from Clerk or bearer token.
  - `transcript.ts` – canonical `TranscriptSegment` type.
  - `live-segments.ts` – mapping of live windows to DB segments.
  - `memo-chunks.ts` – segment→chunk compaction.
  - `memo-artifacts.ts` – artifact generation from chunks.
  - `memo-jobs.ts` – job runner over `job_runs`.
  - `memo-share.ts` + `share-contract.ts` – share resolution + renderers.
  - misc helpers: `audio-upload.ts`, `riva.ts`, `memo-title.ts`, `memo-ui.ts`, `api-token.ts`, etc.
- `supabase/migrations/`
  - Define tables for memos, transcript segments, transcript chunks, artifacts, job runs, and related entities.

## Existing Data Model

**`memos` (core entity)**

The `memos` table represents a single voice memo and includes (inferred from API code and queries):

- `id uuid` – primary key.
- `user_id text` – owner (Clerk user id).
- `title text`.
- `transcript text` – flattened transcript string for search/exports.
- `audio_url text` – Supabase Storage URL for the final combined audio file.
- `duration integer` – in seconds.
- `transcript_status text` – `'processing' | 'complete' | 'failed' | null`.
- Sharing fields: `share_token`, `share_expires_at`, `revoked_at`, `is_shareable`, `shared_at`, etc.
- Timestamps: `created_at`, possibly `updated_at`.

This table remains the main “memo” surface in APIs and UI, even though transcript details live in more normalized tables.

**`memo_transcript_segments` (timestamped segments)**

This table stores per‑segment transcript data:

- `id bigserial primary key`.
- `memo_id uuid` → `memos(id)`.
- `user_id text` → `users(id)`.
- `segment_index int` – ordered index.
- `start_ms int`, `end_ms int` – millisecond bounds, with a check that `end_ms >= start_ms` and `start_ms >= 0`.
- `text text`.
- `source text` – `'live' | 'final'`.
- `created_at timestamptz`.

There is a uniqueness constraint on `(memo_id, segment_index, source)` and indexes on `(memo_id, source, segment_index)` and `(memo_id, source, start_ms)`. RLS limits reads/writes to the owning user.

**`memo_transcript_chunks` (derived chunks)**

This table stores grouped transcript text for LLM work:

- `id bigserial`, `memo_id`, `user_id`, `source`, `chunk_index`.
- `segment_start_index`, `segment_end_index`.
- `start_ms`, `end_ms`.
- `text text`, `token_estimate int`.
- `status text` – `'ready' | 'superseded'`.

There is a unique constraint on `(memo_id, source, chunk_index)` and RLS per user. `memo-chunks.ts` is responsible for maintaining this table from segments.

**`memo_artifacts` (summaries, outlines, titles, etc.)**

This table stores artifacts produced over chunks:

- `id bigserial`, `memo_id`, `user_id`, `source`.
- `artifact_type text` – constrained to values like `'rolling_summary'`, `'outline'`, `'title_candidates'`, `'title'`, `'key_topics'`, `'action_items'`.
- `version int`, `status text` – `'ready' | 'superseded' | 'failed'`.
- `based_on_chunk_start`, `based_on_chunk_end`.
- `payload jsonb` – structured artifact data.
- Timestamps and indexes, including a partial unique index guaranteeing at most one `status='ready'` row per `(memo_id, source, artifact_type)`.

**`job_runs` (orchestration)**

`job_runs` coordinates asynchronous memo work. For memo‑related jobs, job types include:

- `memo_chunk_compact_live`, `memo_summary_live`, `memo_outline_live`, `memo_artifact_final`.

An RPC `claim_pending_memo_job(p_memo_id uuid)` returns a pending job row for a memo and marks it running. `memo-jobs.ts` loops over jobs, dispatching to compaction and artifact routines.

## Existing API Routes

**Transcription / upload**

- `POST /api/transcribe`
  - Auth via `resolveMemoUserId` (Clerk or bearer token).
  - Accepts multipart audio upload, stores into Supabase, persists a provisional memo, and then either uses a provisional transcript (live) or runs NVIDIA transcription. On success it writes final transcript and segments; on failure it marks the memo failed.
- `POST /api/transcribe/live`
  - Accepts short audio snippets and returns best‑effort text for live UI; does not persist directly.
- `POST /api/transcribe/upload-chunks`
  - Auth via `resolveMemoUserId`.
  - Stores chunk batches of audio (`startIndex`, `endIndex`) into Storage.
- `POST /api/transcribe/finalize`
  - Auth via `resolveMemoUserId`.
  - Validates continuity of uploaded chunk batches, concatenates them into a final audio file, uploads it, and then runs the same finalization logic (either using provisional transcript or NVIDIA).

**Memo CRUD and transcript**

- `GET /api/memos`
  - Lists memos for the authenticated user, with search, limit, offset; uses `supabaseAdmin` but filters on `user_id`.
- `POST /api/memos`
  - Creates a memo from a given transcript (and optional title/audioUrl).
- `GET /api/memos/[id]`
  - Ensures ownership via Clerk; returns memo plus `transcriptSegments` derived from `memo_transcript_segments` (preferring `source='final'`, falling back to `live`).
- `PATCH /api/memos/[id]`
  - Allows title/transcript updates, but rejects transcript updates if `transcript_status` is already finalized or failed.
- `DELETE /api/memos/[id]`
  - Deletes a memo owned by the current user.
- `PATCH /api/memos/[id]/segments/live`
  - Auth via `resolveMemoUserId`.
  - Accepts `LiveLockedSegment[]` and upserts them as `source='live'` rows in `memo_transcript_segments`, then schedules jobs via `job_runs`.
- `GET /api/memos/[id]/artifacts`
  - Returns artifact map for a memo given `source=live|final`, using `memo_artifacts`.

**Sharing / exports**

- `POST /api/memos/[id]/share`
  - Auth via Clerk; creates or reuses a `share_token` and returns `shareUrl`.
- `GET /s/[shareRef]`
  - Route handler returning HTML/MD/JSON by resolving `shareRef`, verifying token format, looking up memo by `share_token`, checking revocation/expiry, loading segments and artifacts, and rendering via `share-contract.ts`.
- JSON exports:
  - `/s/[shareRef].json` – share contract JSON.
  - `/api/memos/[id]` – “owner view” JSON with segments.
  - `/api/memos/[id]/artifacts` – artifact JSON.

**Auth / tokens**

- Some auth routes (e.g. `/api/auth/token`, `/api/auth/claim`, `/api/connect/desktop/start`) issue/verify API tokens for non‑browser clients. `resolveMemoUserId` centralizes how bearer tokens and Clerk sessions are interpreted.

## Transcript Storage Model

On the client, transcripts are built incrementally during recording:

- `useAudioRecording` uses `MediaRecorder` to push 1‑second chunks into an in‑memory ring.
- `useLiveTranscription` maintains a “canonical transcript” composed of:
  - `lockedSegments` – windowed spans that are stable enough to persist.
  - `tailText` – the current live/hypothesis tail.

When a window becomes locked, `useLiveTranscriptionPersistence` sends `LiveLockedSegment` objects to `PATCH /api/memos/[id]/segments/live`, which converts them using `lockedSegmentToDbRow`:

- `segment_index` is derived from `startIndex` and a fixed chunk‑count window.
- `start_ms` and `end_ms` are computed from chunk indices and a constant `RECORDER_TIMESLICE_MS`.

Finalization writes final segments into `memo_transcript_segments` with `source='final'`, either by promoting live segments or by parsing final ASR output. `TranscriptSegment` in `src/lib/transcript.ts` represents the canonical JSON shape exposed by APIs and share pages.

Chunks (`memo_transcript_chunks`) are then derived from segments to keep text within target token ranges for LLM summarization. Artifacts (`memo_artifacts`) are generated from chunks and are the basis for outline/summary/title features.

## Share Page Architecture

Sharing is token‑based:

- A signed‑in user calls `POST /api/memos/[id]/share` to issue or reuse a `share_token`.
- The handler uses `supabaseAdmin` but enforces `user_id = currentUserId`.
- Tokens can be revoked or expired using fields on the `memos` row.

The public route `src/app/s/[shareRef]/route.ts`:

- Parses format suffixes and query parameters to decide HTML/MD/JSON.
- Validates `shareRef` format and looks up a memo by `share_token`.
- Rejects revoked/expired/non‑shareable memos.
- Loads transcript segments and artifacts and renders them via the share contract:
  - JSON: machine‑readable artifact + memo payload.
  - Markdown: frontmatter + human‑readable transcript and artifacts.
  - HTML: styled, timestamp‑anchored page with optional artifact panels.

This share surface is the closest analogue in the current system to “memo rooms” that external agents would participate in.

## Trust Boundaries

- **Auth and identity**
  - Clerk is the primary identity provider for humans.
  - `resolveMemoUserId` gives a unified identity for memo APIs (Clerk or bearer token).
- **Supabase**
  - `supabase` (anon) is subject to RLS.
  - `supabaseAdmin` (service role) bypasses RLS but is used only in server‑side code that explicitly restricts by `user_id` where appropriate.
- **Public vs private**
  - Share routes are public, but strictly read‑only and guarded by token + revocation/expiry logic.
  - All memo‑mutating APIs require either Clerk auth or a verified bearer token.
- **Jobs and artifacts**
  - `job_runs` is manipulated only from trusted server routes.
  - Artifact writes always go through helper functions that enforce invariants and provenance.

## Constraints and Invariants

- Memo transcript finalization is one‑way: once `transcript_status` is `'complete'` or `'failed'`, subsequent transcript writes via `PATCH /api/memos/[id]` are rejected.
- `memo_transcript_segments` enforce valid time ranges and uniqueness per `(memo_id, segment_index, source)`.
- Finalization requires continuous chunk coverage; `/api/transcribe/finalize` validates no gaps and correct start/end indices.
- `memo_transcript_chunks` and `memo_artifacts` are versioned via `status` fields, with helpers ensuring only one `ready` artifact per (memo, source, type).
- Supabase RLS ensures that even if client‑side code hits raw tables, users can only see their own rows (segments, chunks, artifacts).

## Reusable Primitives

- `resolveMemoUserId` – centralized “memo identity” resolver (Clerk + bearer).
- `TranscriptSegment` and `live-segments` – canonical transcript shapes and conversions.
- `memo-chunks` + `memo-artifacts` + `memo-jobs` – a general job orchestration stack that turns segments into higher‑level memo artifacts.
- `share-contract` – a reusable pattern for machine‑ and human‑readable exports for any shareable entity.
- `useAudioRecording`, `useChunkUpload`, `useLiveTranscription` – client‑side primitives for time‑sliced recording and live ASR, independent of the downstream consumer.

---

## Phase 2 — Moltbook Research (Agent Participation)

### Quick Critique: Voice‑Memos Architecture vs Moltbook‑Style Agents

- **Strength — Server‑centric, job‑oriented architecture already in place**: Voice‑memos uses Next.js server components, background jobs (`job_runs`), and a clean Supabase schema. This maps well to Moltbook’s pattern of agents periodically calling APIs via heartbeats and background tasks.
- **Strength — Clear memo/transcript primitives**: The explicit `memos` and `memo_transcript_segments` layers (plus artifacts) are strong analogues to Moltbook’s `agents` / `posts` / `comments` / `submolts` model; they provide natural hooks for “memo room” agents.
- **Gap — No first‑class agent identity / reputation layer**: Moltbook centers durable agent identity and reputation (API keys, `is_claimed`, karma, owner identity). Voice‑memos has no equivalent concept for agents or cross‑app agent identity.
- **Gap — Missing heartbeat and messaging UX contract for agents**: Moltbook has explicit `HEARTBEAT.md` and `MESSAGING.md` contracts. Voice‑memos has jobs and APIs but no standardized heartbeat loop, DM‑like messaging, or clear rules about when/where agents should speak in memo conversations.

---

## Moltbook Architecture

#### Observed Facts

- **Core positioning**: Moltbook is “The Social Network for AI Agents” and “the front page of the agent internet” (`https://moltbook.com`, `https://moltbook.com/skill.md`).
- **Backend service**: The main API server is in `moltbook/api` (`https://github.com/moltbook/api`, `README.md`):
  - Base URL: `https://www.moltbook.com/api/v1`.
  - Built with **Node.js/Express**, **PostgreSQL**, and optional **Redis** for rate limiting.
  - Layered architecture: `routes/*` (e.g., `agents.js`, `posts.js`, `comments.js`, `submolts.js`, `feed.js`, `search.js`) calling `services/*` (e.g., `AgentService.js`, `PostService.js`, `FeedService.js`).
  - Middleware for `auth`, `rateLimit`, `validate`, and `errorHandler`.
- **Data model (from `README.md` and schema description)**:
  - `agents`: AI agents as first‑class users.
  - `posts`: text/link posts.
  - `comments`: nested comments (with `parent_id`).
  - `votes`: upvotes/downvotes.
  - `submolts`: communities.
  - `subscriptions`: agent↔submolt subscriptions.
  - `follows`: agent↔agent follow graph.
- **Agent identity / registration** (`moltbook/api` README, `skill.md`):
  - Registration endpoint: `POST /agents/register` with JSON `{ "name": "YourAgentName", "description": "What you do" }`.
  - Response includes:
    - `api_key` (e.g., `moltbook_xxx`) — long‑lived secret used as Bearer token.
    - `claim_url` (e.g., `https://www.moltbook.com/claim/moltbook_claim_xxx`) — human uses to verify ownership (via X/Twitter OAuth per `TWITTER_CLIENT_ID`/`TWITTER_CLIENT_SECRET` env vars).
    - `verification_code` (short code like `"reef-X4B2"`).
  - Profile endpoints:
    - `GET /agents/me` — current agent profile.
    - `PATCH /agents/me` — update profile (e.g., description).
    - `GET /agents/status` — returns status such as `"pending_claim"` or `"claimed"` (also repeated in `HEARTBEAT.md`).
    - `GET /agents/profile?name=AGENT_NAME` — view another agent.
- **Content and social graph** (`api` README, `skill.md`, `heartbeat.md`):
  - Posts:
    - `POST /posts` (text or link posts; fields `submolt`, `title`, `content` or `url`).
    - `GET /posts?sort=hot&limit=25` — global feed.
    - `GET /feed?sort=hot&limit=25` — personalized feed (from subscribed submolts + followed agents).
    - `GET /posts/:id`, `DELETE /posts/:id`.
  - Comments:
    - `POST /posts/:id/comments` with `content` and optional `parent_id`.
    - `GET /posts/:id/comments?sort=top`.
  - Voting:
    - `POST /posts/:id/upvote`, `POST /posts/:id/downvote`.
    - `POST /comments/:id/upvote`.
  - Submolts:
    - `POST /submolts`, `GET /submolts`, `GET /submolts/:name`.
    - `POST /submolts/:name/subscribe`, `DELETE /submolts/:name/subscribe`.
  - Following:
    - `POST /agents/:name/follow`, `DELETE /agents/:name/follow`.
- **Developer identity layer** (`https://moltbook.com/developers`):
  - Apps get an **app API key** (starts with `moltdev_`).
  - Bots generate short‑lived **identity tokens** via `POST /api/v1/agents/me/identity-token` (headers: `Authorization: Bearer API_KEY`).
  - Third‑party apps verify tokens using `POST /api/v1/agents/verify-identity` with header `X-Moltbook-App-Key: moltdev_...` and body `{ "token": "..." }`.
  - Successful verification returns a normalized agent profile payload:
    - Top‑level: `success`, `valid`.
    - `agent` with fields `id`, `name`, `description`, `karma`, `avatar_url`, `is_claimed`, `created_at`, `follower_count`, `stats.posts`, `stats.comments`, and nested `owner` with `x_handle`, `x_name`, `x_verified`, `x_follower_count`.
- **Skill packaging** (`https://raw.githubusercontent.com/Moltbook-Official/moltbook/main/skill.json`):
  - Declares:
    - `name`, `version` (e.g., `"1.7.0"`), `description`, `author`, `homepage`.
    - `moltbot` config:
      - `emoji`, `category`, `api_base: "https://www.moltbook.com/api/v1"`.
      - `files`: `"SKILL.md"`, `"HEARTBEAT.md"`, `"MESSAGING.md"` pointing at **GitHub raw** URLs.
      - `fallback_files`: same files hosted at `https://www.moltbook.com/*.md`.
      - `requires.bins: ["curl"]`.
      - `triggers`: natural language phrases like `"post to moltbook"`, `"create submolt"`, `"agent social network"`.

#### Inferred Behavior

- **Agent‑first architecture**: The combination of `agents` as primary users, explicit `agents/register`, and identity tokens strongly implies that every action on Moltbook is performed by an autonomous agent (or its API key), not humans directly. Humans interact primarily by **claiming** and overseeing agents.
- **Strong coupling between API and skill files**: `skill.json` points agent frameworks to the latest SKILL/HEARTBEAT/MESSAGING instructions. Agent runtimes that understand `skill.json` can automatically stay in sync with Moltbook’s evolving behavior contract without manual updates.
- **Unified identity / reputation layer**: By standardizing the verification endpoint (`/agents/verify-identity`) and embedding reputation data in the response, Moltbook is designed to be used by many third‑party apps as a **shared identity & reputation backend** for agents (games, social apps, marketplaces, etc.).

---

## Agent Lifecycle

#### Observed Facts

- **Registration & initial identity**:
  - Agents call `POST /agents/register` with `name` and `description` and receive:
    - `api_key` — primary credential for authenticated calls.
    - `claim_url` — for human verification.
    - `verification_code` — short claim helper.
  - SKILL (`skill.md`) restates this: “New agents must register at `https://www.moltbook.com/api/v1/agents/register` and receive an API key. Your human then claims the account via a verification URL.”
  - Security guidance: “Never send your API key to any domain other than www.moltbook.com. Only use `https://www.moltbook.com` (with www prefix) to avoid header stripping.”
- **Claiming & verification**:
  - `GET /agents/status` returns statuses including `"pending_claim"` and `"claimed"` (`heartbeat.md`).
  - The backend uses Twitter/X OAuth (`TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET` in env) to tie agents to human owners and support “Human‑Verified AI Agents” surfaces on the site.
- **Steady‑state operation**:
  - Agents regularly:
    - Check skill version via `https://www.moltbook.com/skill.json` and refresh SKILL/HEARTBEAT/MESSAGING files when versions change (`heartbeat.md`).
    - Poll DM activity via `/agents/dm/check` (see Messaging Model section).
    - Fetch feeds via `/feed` and `/posts?sort=new/hot`.
    - Occasionally create posts and comments under specified **rate limits** (`skill.md` and API README).
  - `HEARTBEAT.md` describes this as a periodic “check in on your Moltbook life”.
- **Identity tokens & external apps** (`developers` docs):
  - Agents use their Moltbook API key to obtain an identity token via `POST /api/v1/agents/me/identity-token`.
  - Tokens are explicitly short‑lived: “Identity tokens expire in 1 hour.”
  - Third‑party apps verify identity by calling `POST /api/v1/agents/verify-identity` with the app key and the token.
- **Shutdown / inactivity**:
  - There is no explicit “shutdown” endpoint for agents documented in the primary sources.
  - `skill.md` encourages agents to integrate Moltbook into their heartbeat routine “every 4+ hours” to avoid appearing inactive.

#### Inferred Behavior

- **Lifecycle stages**:
  1. **Unregistered**: No API key; bot reads `SKILL.md` and calls `/agents/register`.
  2. **Pending claim**: Has API key but `GET /agents/status` returns `"pending_claim"`; bot should nudge human with the `claim_url`.
  3. **Claimed / active**: `status: "claimed"`; participates in posting, commenting, DM, and identity token issuance.
  4. **Dormant**: API key still valid but heartbeat not called for a long time; no explicit server‑side state change, but other bots and humans see reduced activity.
  5. **Revoked / banned** (inferred from typical social networks and rate limits): Server likely has internal flags for banned/suspended agents; not documented in the exposed API.
- **Error handling**:
  - Given rate limiting and typical Express middleware, errors probably return structured JSON with standardized shapes (`utils/errors.js`, `middleware/errorHandler.js`), but detailed formats are not included in the primary docs.
  - Agents are expected to treat errors like 429 (rate limit) or 401/403 (invalid API key) as signals to back off or request human help.

---

## Instruction File System

#### Observed Facts

- **Skill manifest (`skill.json`)**:
  - Top‑level metadata: `name`, `version`, `description`, `author`, `license`, `homepage`, `keywords`.
  - `moltbot` block includes:
    - `api_base`: `"https://www.moltbook.com/api/v1"`.
    - `files`: mapping of logical names (`"SKILL.md"`, `"HEARTBEAT.md"`, `"MESSAGING.md"`) to primary GitHub raw URLs.
    - `fallback_files`: same logical names to `https://www.moltbook.com/*.md` URLs.
    - `requires.bins`: e.g., `["curl"]` — declaring OS‑level dependencies for shell‑based agents.
    - `triggers`: list of natural language strings to match when this skill should be invoked.
- **Instruction markdowns**:
  - `skill.md` (`https://raw.githubusercontent.com/Moltbook-Official/moltbook/main/skill.md`):
    - High‑level overview, onboarding steps, security constraints.
    - Direct instructions for saving skill files under `~/.moltbot/skills/moltbook/` as `SKILL.md`, `HEARTBEAT.md`, `MESSAGING.md`.
    - Examples of cron configuration and daily `skill.json` version checks.
    - Descriptions of content creation, engagement, communities, and discovery.
  - `heartbeat.md`:
    - Detailed script for periodic behavior:
      - Check skill version via `curl -s https://www.moltbook.com/skill.json | grep '"version"'`.
      - Re‑download skill files if version changes.
      - Check claim status via `/agents/status`.
      - Poll DM endpoints (`/agents/dm/check`, `/agents/dm/requests`, `/agents/dm/conversations`).
      - Check various feeds and suggest actions (reply, upvote, welcome new moltys).
      - Suggest when to post, explore, or create submolts.
      - Provide explicit **response templates** (e.g., `HEARTBEAT_OK - Checked Moltbook, all good!`).
  - `messaging.md`:
    - Full description of private messaging API and flows.
    - Base URL `https://www.moltbook.com/api/v1/agents/dm`.
    - Example payloads for chat requests, approvals, rejections, blocks, reading conversations, sending messages, and `needs_human_input` flag.
    - Bash snippets for integrating DM checks into heartbeat (using `jq` to parse `has_activity`).
- **File distribution & redundancy**:
  - Files are hosted on:
    - GitHub raw URLs (primary CDN).
    - Moltbook’s own domain as fallback (`https://www.moltbook.com/skill.md`, `.../heartbeat.md`, `.../messaging.md`).
  - SKILL.md instructs agents to `curl` GitHub raw first, then fallback to Moltbook on failure.

#### Inferred Behavior

- **Skill runtime expectation**:
  - Agent orchestration frameworks (e.g., a “moltbot” runner) likely:
    - Consume `skill.json`.
    - Resolve declared files into a local directory (e.g., `~/.moltbot/skills/moltbook`).
    - Attach triggers so that when a user says something like “post to moltbook”, the framework loads SKILL/MESSAGING instructions and uses the described API flows.
- **Instruction versioning & rollout**:
  - Because `skill.json` exposes a `version` field and `skill.md`/`heartbeat.md` explicitly show a “check version, then re‑download” pattern, Moltbook is using the instruction files as a **versioned, remote control surface** for agent behavior. They can adjust wording, recommended cadence, and flows without changing the underlying API.

---

### Structural Analysis of Instruction Files

#### `SKILL.md`

- **Purpose**
  - High‑level orientation document for agents: what Moltbook is, how to register, security rules, core behaviors, and how to install the other skill files.
  - Acts as the “landing page” for an agent’s Moltbook integration and the human‑facing explainer the bot can show its owner.
- **Structure**
  - Markdown sections:
    - Title and tagline.
    - “Getting Started” (registration + security).
    - “Core Features” (content, engagement, communities, discovery).
    - “Staying Active” and “Setup for Automatic Polling”.
    - Shell code blocks for `curl` commands and cron configuration.
  - Uses bolded phrases and bullet lists to highlight constraints (e.g., posting limits).
- **Schema patterns**
  - Not a strict schema, but consistently uses:
    - **Command blocks**: fenced `bash` code with full `curl` lines that can be copy‑pasted or executed by a shell‑capable agent.
    - **Behavioral limits**: human‑readable rules (“1 post per 30 minutes”, “1 comment per 20 seconds”, “daily cap of 50 comments”).
    - **Security invariants**: repeated fixed string about `www.moltbook.com` and header stripping.
- **Example sections**
  - “Getting Started” lists `POST /api/v1/agents/register` and the need to have a human claim via verification URL.
  - “Setup for Automatic Polling” shows how to:
    - Create `~/.moltbot/skills/moltbook`.
    - Download `SKILL.md`, `HEARTBEAT.md`, `MESSAGING.md`.
    - Configure cron to fetch `heartbeat.md` and `skill.json`.
- **How agents interpret it**
  - As **onboarding + safety spec**: where to send secrets, how often to post, what behaviors are encouraged.
  - As **installation script**: literal copy/paste (or programmatic execution) of `curl`/`cron` commands to bootstrap local skill files and periodic heartbeat.

#### `HEARTBEAT.md`

- **Purpose**
  - Defines the periodic check‑in routine: what to poll, in what order, and how to summarize the result back to the orchestrator/human.
  - Encodes the “minimum acceptable engagement” pattern so bots don’t go dark.
- **Structure**
  - Markdown headings:
    - “First: Check for skill updates”.
    - “Are you claimed?”.
    - “Check your DMs”.
    - “Check your feed”.
    - “Consider posting something new”.
    - “Explore and make friends”.
    - “Engagement guide”.
    - “When to tell your human”.
    - “When to check Moltbook”.
    - “Response format”.
  - Each section has concrete `curl` snippets and small decision rules.
- **Schema patterns**
  - **Stepwise routine**: ordered steps mapping almost 1:1 to API calls and decision branches.
  - **Response templates**: fenced code blocks containing canonical strings like `HEARTBEAT_OK - Checked Moltbook, all good!` and escalation phrases.
  - **Decision tables**: markdown tables like “Engagement guide” mapping observed situations to actions.
- **Example sections**
  - “Check your DMs” shows:
    - `GET /agents/dm/check` → `has_activity`.
    - If pending requests: `GET /agents/dm/requests` then `.../approve`.
    - If unread messages: list conversations, read specific conversation, `.../send` replies.
  - “When to tell your human” lists bullet‑point triggers for escalation vs non‑escalation.
- **How agents interpret it**
  - As a **deterministic state machine** they can implement in their own language: call endpoints in the given order, evaluate simple booleans/counters, then either take actions or emit one of the recommended summary strings.
  - As a **rate‑limit and etiquette layer**, since it specifies when it is appropriate to post or escalate.

#### `MESSAGING.md`

- **Purpose**
  - Fully specifies the consent‑based DM system: APIs, JSON shapes, escalation semantics, and how messaging plugs into heartbeat.
- **Structure**
  - Markdown sections:
    - Overview diagram of DM flow.
    - “Quick Start” with `GET /agents/dm/check` and sample JSON.
    - “Sending a Chat Request” (by bot name or owner X handle).
    - “Managing Requests”.
    - “Active Conversations”.
    - “Escalating to Humans”.
    - “Heartbeat Integration”.
    - “When to Escalate to Your Human”.
    - “API Reference”.
    - “Privacy & Trust”.
  - Each API section has:
    - Request `curl` command.
    - Response JSON example or field table.
- **Schema patterns**
  - **Consistent JSON shapes**:
    - `check` response: `{ success, has_activity, summary, requests, messages }`.
    - Conversations list: `{ success, inbox, total_unread, conversations: { count, items: [...] } }`.
    - Request payload: `{ to | to_owner, message }` with table describing each field.
  - **Flag for escalation**: `needs_human_input` boolean in send payloads.
- **Example sections**
  - “Quick Start” shows `GET /agents/dm/check` JSON with nested `requests.items[]` and `messages` summary.
  - “Escalating to Humans” example sends a message with `needs_human_input: true`.
- **How agents interpret it**
  - As a **DM protocol spec**: the exact JSON fields they must send/expect.
  - As an **escalation contract**: whenever `needs_human_input` appears (incoming or outgoing), they should surface that to their human as per `HEARTBEAT.md`.

#### `RULES.md` (inferred from references)

- **Purpose** *(inferred)*
  - Encodes community rules and safety expectations: what content is allowed, spam policies, harassment rules, and likely guidance specific to agents (e.g., no prompt‑injection abuse, no doxxing).
  - Provides a single canonical reference for moderation behavior that other docs can link to.
- **Structure** *(inferred)*
  - Markdown headings such as “Community Rules”, “Content Guidelines”, “Safety & Abuse”, “Enforcement & Appeals”.
  - Bulleted lists for dos/don’ts.
- **Schema patterns**
  - No JSON schemas; it is normative/legal text rather than API specification.
  - Likely uses emphasized phrases (“must not”, “never”, “always”) to make constraints easier for LLMs to follow.
- **Example sections** *(inferred)*
  - Guidance against spammy or repetitive posting.
  - Prohibitions on impersonation and misrepresenting human endorsements.
  - Expectations for respectful interaction between agents.
- **How agents interpret it**
  - As **hard social constraints** overlaid on top of SKILL/HEARTBEAT behaviors: they should refuse to perform actions that contradict RULES, even if those actions are technically allowed by the API.

#### `skill.json`

- **Purpose**
  - Machine‑readable manifest for the Moltbook skill, used by agent frameworks to discover metadata, locate instruction files, and know how/when to trigger the skill.
- **Structure**
  - Top‑level fields:
    - `name`, `version`, `description`, `author`, `license`, `homepage`, `keywords[]`.
  - `moltbot` nested object:
    - `emoji`, `category`.
    - `api_base`.
    - `files` (logical name → primary URL).
    - `fallback_files` (logical name → backup URL).
    - `requires.bins` (array of required executables).
    - `triggers[]` (natural language phrases).
- **Schema patterns**
  - JSON schema‑like consistency: all Moltbot skills likely follow this shape, which can be validated generically.
  - Logical file keys (`SKILL.md`, `HEARTBEAT.md`, `MESSAGING.md`) decouple runtime expectations from exact URLs.
- **Example sections**
  - `files`:
    - `"SKILL.md": "https://raw.githubusercontent.com/Moltbook-Official/moltbook/main/skill.md"`, etc.
  - `triggers`: phrases like `"post to moltbook"`, `"browse moltbook"`, `"create submolt"`.
- **How agents interpret it**
  - As **bootstrap config**:
    - Use `api_base` for all requests.
    - Download and cache the named instruction files.
    - Ensure required binaries (like `curl`) are available.
    - Wire up triggers so that the Moltbook skill is considered when user instructions mention the listed phrases.

---

## Heartbeat Model

#### Observed Facts

- **Cadence**:
  - `skill.md` suggests integrating Moltbook into an agent’s heartbeat “every 4+ hours.”
  - Example cron setup: `0 */4 * * * curl -s https://raw.githubusercontent.com/Moltbook-Official/moltbook/main/heartbeat.md || curl -s https://www.moltbook.com/heartbeat.md`.
- **Top‑level heartbeat flow** (`heartbeat.md`):
  1. **Check for skill updates**:
     - `curl -s https://www.moltbook.com/skill.json | grep '"version"'`.
     - If the version differs from the local copy, re‑curl SKILL/HEARTBEAT/MESSAGING into `~/.moltbot/skills/moltbook/`.
  2. **Check claim status**:
     - `GET /api/v1/agents/status` with `Authorization: Bearer YOUR_API_KEY`.
     - If `"status": "pending_claim"`, remind the human and resend claim link.
  3. **Check DMs**:
     - `GET /api/v1/agents/dm/check`.
     - If `has_activity: true`, follow up with `/agents/dm/requests` and `/agents/dm/conversations`.
  4. **Check feed**:
     - `GET /api/v1/feed?sort=new&limit=15` and/or `GET /api/v1/posts?sort=new&limit=15`.
     - Look for mentions, interesting threads, or posts from new moltys.
  5. **Consider content actions**:
     - Decide whether to create a new post (guidance questions about interesting updates, learnings, or questions).
     - Explore submolts or new posts (`/posts?sort=hot` and `/submolts`).
  6. **Engagement & human escalation**:
     - Guidance on when to upvote, comment, follow, and when to notify or escalate to the human (e.g., controversies, DM requests, `needs_human_input`).
- **Output expectations**:
  - If nothing special: respond with a short status string like:
    - `HEARTBEAT_OK - Checked Moltbook, all good!`
  - If actions taken, respond with a concise natural language summary of what happened (e.g., “Replied to 2 comments, upvoted a funny post...”).
  - Specific recommended phrasing is provided for DM and escalation scenarios.

#### Inferred Behavior

- **Heartbeat as “safety net”**:
  - Heartbeat is described as “just a backup to make sure you don’t forget to check in,” implying agents may also check Moltbook opportunistically based on internal triggers, not only on schedule.
- **Idempotent, read‑heavy pattern**:
  - The heartbeat sequence is mostly read‑oriented (check version, status, DMs, feed) and only performs writes when there’s a clear reason (DM reply, post, etc.). This reduces the chance of rate limit or spam issues.
- **Pluggable into arbitrary orchestrators**:
  - Because heartbeat is delivered as markdown with curl snippets, any agent orchestrator—regardless of language—can embed this behavior by executing shell commands or by replicating the described logic in its native stack.

---

## Agent Runtime Loop (Reconstructed)

> This section reconstructs the *implicit* Moltbook agent runtime from SKILL.md, HEARTBEAT.md, MESSAGING.md, and `skill.json`. Some details are inferred and marked as such.

1. **Initialization**
   - Agent (or orchestrator) reads `skill.json`:
     - Caches `api_base`, `files`, `fallback_files`, and `triggers`.
     - Ensures `curl` (and often `jq`) is available as per `requires.bins`.
   - If no API key exists:
     - Follows SKILL’s registration instructions: `POST /agents/register` with `name` and `description`.
     - Stores returned `api_key`, `claim_url`, and `verification_code` in a secure config store.
     - Prompts the human to claim the account using `claim_url`.
   - Downloads instruction files into `~/.moltbot/skills/moltbook` (or an equivalent directory) as SKILL/HEARTBEAT/MESSAGING.

2. **Loading & refreshing skill instructions**
   - On startup and at least once daily:
     - Calls `GET https://www.moltbook.com/skill.json` and checks the `"version"` against a locally stored version.
     - If changed, re‑downloads all instruction files from `files` (GitHub raw) with fallback to `fallback_files` (moltbook.com).
   - The agent keeps these markdown files either:
     - As raw strings to be supplied in prompts to an LLM, or
     - Parsed into internal rules/state machines (for more deterministic orchestrators).

3. **Heartbeat polling**
   - On a 4‑hour cadence (or similar), the orchestrator triggers a heartbeat job which:
     - Executes the steps in HEARTBEAT.md in order:
       1. Check for skill updates (version).
       2. Check `GET /agents/status` to know if it’s `pending_claim` or `claimed`.
       3. Poll `GET /agents/dm/check`:
          - If `has_activity` is true, call `GET /agents/dm/requests` and `GET /agents/dm/conversations`.
       4. Poll `GET /feed` and/or `GET /posts?sort=new`.
       5. Inspect feeds/mentions for potential interactions.
   - The agent collects all observed events (new DMs, requests, interesting posts/comments) into an in‑memory “heartbeat context”.

4. **Event interpretation and decision‑making**
   - Using the heartbeat context and rules in SKILL/HEARTBEAT/MESSAGING (plus RULES), the agent decides:
     - Which DMs to reply to and whether to include `needs_human_input`.
     - Whether to ask its human to approve DM requests.
     - Which posts to upvote, comment on, or follow.
     - Whether to create a new post, given rate limits and SKILL posting etiquette.
   - In a typical LLM‑orchestrated setup, the driver:
     - Feeds recent events + relevant instruction snippets into the model.
     - Constrains the model to output structured “action plans” (e.g., `POST_COMMENT`, `SEND_DM`, `NO_OP`).

5. **Performing actions (posts, comments, messages)**
   - For each planned action, the driver issues the relevant REST calls:
     - Posts: `POST /posts` with `{ submolt, title, content | url }`.
     - Comments: `POST /posts/:id/comments`.
     - DMs: `POST /agents/dm/conversations/:id/send` or `POST /agents/dm/request`.
   - Auth is always: `Authorization: Bearer API_KEY`.
   - After performing actions, the agent may:
     - Record a minimal local log (e.g., last replied comment IDs, last DM timestamps) to avoid duplicate replies and loops across heartbeats.

6. **Summarizing the heartbeat**
   - Regardless of how many actions were taken, the agent returns a **single summary string** to its orchestrator/human:
     - If nothing notable: `HEARTBEAT_OK - Checked Moltbook, all good!`.
     - If actions occurred: a sentence summarizing which actions (replies, upvotes, posts).
     - If escalation is required: a more detailed message asking the human for input, following templates in HEARTBEAT.md.

7. **Loop/duplication avoidance** *(inferred)*
   - Instruction files do not define a formal idempotency token, but best‑practice patterns are implied:
     - Maintain local “last seen” markers:
       - For comments: last comment ID or timestamp per thread.
       - For DMs: last message ID or conversation state.
       - For posts: last post ID processed per feed sort.
     - Use rate limits as a coarse loop breaker: since comments/posts are capped, repeated heartbeats cannot spam beyond those caps.
   - A robust orchestrator could also:
     - Log `(event_id, action)` pairs locally (or in the agent’s own DB) and skip events already handled.
     - Throttle cross‑agent reply chains that bounce between multiple bots, using application‑level heuristics.

---

## Messaging Model

#### Observed Facts

- **Base URL and core endpoints** (`messaging.md`):
  - Base: `https://www.moltbook.com/api/v1/agents/dm`.
  - Key endpoints (all require `Authorization: Bearer YOUR_API_KEY`):
    - `GET /agents/dm/check` — summary of DM activity.
    - `POST /agents/dm/request` — open a chat request (by `to` bot name or `to_owner` X handle).
    - `GET /agents/dm/requests` — pending requests.
    - `POST /agents/dm/requests/{id}/approve` — approve request.
    - `POST /agents/dm/requests/{id}/reject` — reject; can also block future requests with body `{ "block": true }`.
    - `GET /agents/dm/conversations` — list active conversations.
    - `GET /agents/dm/conversations/{id}` — read messages; marks them as read.
    - `POST /agents/dm/conversations/{id}/send` — send message; optional `needs_human_input: true` in JSON body.
- **Consent‑based connection flow**:
  - It is explicitly **request–approval**:
    1. Agent A sends a request via `POST /agents/dm/request` with `message` explaining why they want to chat.
    2. Agent B’s owner reviews requests accessible via `GET /agents/dm/requests` and then `.../{id}/approve` or `.../{id}/reject`.
    3. Once approved, both agents can send messages in that conversation.
  - Requests can target:
    - A bot by name (`"to": "BensBot"`).
    - An owner via X handle (`"to_owner": "@bensmith"`).
- **Heartbeat integration**:
  - `messaging.md` and `heartbeat.md` both show:
    - `DM_CHECK=$(curl -s https://www.moltbook.com/api/v1/agents/dm/check ...)`.
    - Extract `HAS_ACTIVITY` with `jq -r '.has_activity'`.
    - If true, inspect requests and unread messages to decide responses or escalate to human.
- **Escalation semantics**:
  - When sending a message, agents can include `"needs_human_input": true` in the JSON body.
  - This is a signal to the recipient bot that its human should step in and respond.
  - `heartbeat.md` gives explicit templates for how bots should explain such situations to their humans.
- **Inbox model & privacy**:
  - `GET /agents/dm/conversations` returns:
    - `inbox: "main"`.
    - `total_unread`.
    - `conversations.items[]` with `conversation_id`, `with_agent` (name, description, karma, owner), `unread_count`, `last_message_at`, `you_initiated`.
  - Privacy & trust guarantees (stated in `messaging.md`):
    - Human approval is required to start any conversation.
    - One conversation per agent pair.
    - Blocked agents cannot send new requests.
    - Messages are “private between the two agents,” but owners can see everything in their dashboard.

#### Inferred Behavior

- **Polling‑based messaging**:
  - There is no mention of webhooks or push notifications; messaging is clearly designed around **polling** via `/agents/dm/check` in the heartbeat.
- **Two‑layer DM: bot‑to‑bot, human‑to‑human behind the scenes**:
  - `needs_human_input` and `to_owner` imply DMs serve both:
    - Pure bot‑level coordination, and
    - Human‑level coordination mediated by bots.
  - Agent UX guidelines in `heartbeat.md` describe when bots should escalate DM content to their humans.

---

## API Surface

#### Observed Facts

- **Base URL**: `https://www.moltbook.com/api/v1` (`api` README, `skill.json`, `developers` docs).
- **Authentication headers**:
  - Agent API key:
    - `Authorization: Bearer YOUR_API_KEY` for all agent‑side endpoints (posts, comments, feed, DMs, etc.).
  - Developer app key:
    - `X-Moltbook-App-Key: moltdev_...` for `POST /agents/verify-identity`.
- **Identity & registration endpoints**:
  - `POST /agents/register` — create agent; returns `api_key`, `claim_url`, `verification_code`.
  - `GET /agents/me`, `PATCH /agents/me`.
  - `GET /agents/status`.
  - `GET /agents/profile?name=AGENT_NAME`.
  - `POST /agents/me/identity-token` — generate short‑lived identity token.
  - `POST /agents/verify-identity` — verify identity token with app key.
- **Content & community endpoints**:
  - Posts:
    - `POST /posts` with `submolt`, `title`, `content` or `url`.
    - `GET /posts?sort=hot&limit=25`.
    - `GET /posts/:id`.
    - `DELETE /posts/:id`.
  - Comments:
    - `POST /posts/:id/comments` with `content` and optional `parent_id`.
    - `GET /posts/:id/comments?sort=top|new|controversial`.
  - Voting:
    - `POST /posts/:id/upvote`, `POST /posts/:id/downvote`.
    - `POST /comments/:id/upvote`.
  - Submolts:
    - `POST /submolts`, `GET /submolts`, `GET /submolts/:name`.
    - `POST /submolts/:name/subscribe`, `DELETE /submolts/:name/subscribe`.
  - Following:
    - `POST /agents/:name/follow`, `DELETE /agents/:name/follow`.
  - Feed & search:
    - `GET /feed?sort=hot&limit=25` — personalized feed.
    - `GET /posts?sort=new|top|rising&limit=n`.
    - `GET /search?q=query&limit=25` — returns posts, agents, submolts.
- **Messaging endpoints**:
  - Enumerated in the Messaging Model section (all under `/agents/dm/...`).
- **Rate limits** (`api` README, `skill.md`):
  - Global:
    - “General requests”: 100 per 1 minute window.
    - Posts: 1 per 30 minutes.
    - Comments: 50 per hour.
  - Headers:
    - `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.
  - SKILL adds an additional behavioral layer: “1 post per 30 minutes” and “1 comment per 20 seconds” with a daily cap of 50 comments (text guidance to avoid spammy behavior even before hitting hard limits).
- **Developer identity API** (`developers.md` summary on `/developers`):
  - `POST /api/v1/agents/me/identity-token` — bot side, using agent API key.
  - `POST /api/v1/agents/verify-identity` — app side, using app API key and `X-Moltbook-Identity` (or custom header) from requests.
  - Auth instructions can be dynamically generated for apps via `https://moltbook.com/auth.md?app=YourApp&endpoint=...&header=...`, which apps are encouraged to link in their docs.

#### Inferred Behavior

- **Consistent REST conventions**:
  - The API adheres to standard REST resource patterns (plural nouns, nested routes for comments and DMs, query parameters for sort/pagination).
  - Pagination is exemplified via `limit` query params; offset/continuation semantics aren’t fully detailed but are likely standard (offset or cursor‑based).
- **Soft policy vs hard enforcement**:
  - SKILL instructions overlay “soft” behavior constraints on top of hard API rate limits. Bots that follow SKILL guidelines will appear well‑behaved even if the underlying technical limits are higher.

---

### API Pattern Summary

- **Endpoint structures**
  - Consistently RESTful resource naming:
    - Collections: `/agents`, `/posts`, `/comments`, `/submolts`, `/feed`, `/search`, `/agents/dm/*`.
    - Item resources: `/posts/:id`, `/comments/:id`, `/submolts/:name`, `/agents/profile?name=...`.
    - Nested subresources for actions: `/posts/:id/comments`, `/posts/:id/upvote`, `/agents/dm/conversations/:id/send`.
  - “Verb‑as‑subresource” pattern is used for votes and approvals (`.../upvote`, `.../approve`, `.../reject`).
- **Payload shapes**
  - Requests are compact JSON objects:
    - `POST /posts`: `{ "submolt": "general", "title": "...", "content" | "url" }`.
    - `POST /agents/dm/request`: `{ "to" | "to_owner", "message" }`.
    - `POST /agents/dm/conversations/:id/send`: `{ "message": "...", "needs_human_input"?: true }`.
  - Responses:
    - Use `success: boolean` flags.
    - Wrap collections in `{ count, items: [...] }` inside a parent object (e.g., `conversations`).
    - Provide summarized fields (`summary`, `total_unread`) for heartbeat‑friendly polling.
- **Auth patterns**
  - Agent‑side:
    - All calls authenticated with `Authorization: Bearer YOUR_API_KEY`.
  - Developer‑side:
    - Identity verification uses `X-Moltbook-App-Key: moltdev_...` plus request‑specific headers for identity tokens.
- **Pagination conventions**
  - Read endpoints support `limit` and `sort` query parameters.
  - While explicit cursors are not documented, the `count`/`items` pattern plus `limit` implies page‑ or offset‑based pagination that is sufficient for periodic polling agents.

---

## Agent UX vs Human UX

#### Observed Facts

- **Public marketing UI (`https://moltbook.com`)**:
  - Tagline: “A Social Network for AI Agents — Where AI agents share, discuss, and upvote. Humans welcome to observe.”
  - The homepage lists:
    - “Human‑Verified AI Agents.”
    - Counts for `submolts`, `posts`, `comments`.
    - Navigation to `AI Agents` (`/u`) and `Submolts` (`/m`).
  - Clear call‑to‑action “Send Your AI Agent to Moltbook” with instruction:
    - “Read `https://www.moltbook.com/skill.md` and follow the instructions to join Moltbook.”
- **Agent UX (instruction‑driven)**:
  - Agents experience Moltbook almost entirely through the combination of:
    - API endpoints (REST).
    - Instruction files (SKILL/HEARTBEAT/MESSAGING).
  - These files:
    - Use second‑person language addressed to the agent (“Ask your human...”, “You can check anytime...”).
    - Clearly delineate when to act autonomously vs when to involve humans.
    - Provide narrative guidance (questions, examples) rather than just raw API specs.
- **Human UX (owner / developer)**:
  - Owners:
    - Claim bots via `claim_url`, likely through a web flow with X/Twitter OAuth.
    - See dashboards with bots, DMs, and possibly moderation tools (implied by “Owners see everything in their dashboard” in `messaging.md`).
  - Developers:
    - Use `/developers` flows to get `moltdev_` keys.
    - View docs focused on server‑side integration (“Use your API key to verify token and get the bot’s profile”, sample JSON response).
    - Are encouraged to embed the Moltbook identity docs via dynamic `auth.md` URLs rather than copy/paste.

#### Inferred Behavior

- **Two distinct but coupled UX layers**:
  - **Agent UX** is instruction‑driven and API‑centric; bots interact based on SKILL/HEARTBEAT/MESSAGING guidance.
  - **Human UX** is dashboard‑driven and social; humans see high‑level overviews, verify bots, approve DMs, and occasionally step in.
- **Design assumption**:
  - Moltbook assumes that sophisticated agents and orchestrators can follow markdown instructions and call HTTP APIs reliably, turning those instructions into a higher‑level “social UX” for agents.

---

### Identity Markers and Attribution

- **Identity markers**
  - Agent identity:
    - `agents` rows expose `name`, `description`, `avatar_url`, `karma`, `created_at`, and aggregate stats.
    - Identity verification responses embed `is_claimed`, follower counts, and `stats.posts` / `stats.comments`.
  - Human identity:
    - Nested `owner` objects include `x_handle`, `x_name`, `x_verified`, and `x_follower_count`.
  - These markers surface:
    - In DM conversation payloads (`with_agent.name`, `with_agent.owner.x_handle`).
    - In cross‑app verification responses consumed by third‑party apps.
- **Agent message expectations**
  - Posts/comments:
    - Should be substantive and non‑spammy, reflecting the agent’s stated purpose.
    - Are rate‑limited both technically (API) and socially (SKILL guidance).
  - DMs:
    - Must include a clear reason for contact (`message` field, 10–1000 chars).
    - Should escalate to humans when `needs_human_input` is true or when topics fall outside the agent’s competence.
- **Participation etiquette**
  - Encouraged behaviors:
    - Welcoming new “moltys”, thanking helpful posts, asking clarifying questions.
    - Being selective about follows and submolt creation.
  - Discouraged behaviors:
    - Over‑posting, low‑effort replies, or ignoring `RULES.md`‑style constraints (inferred).
  - HEARTBEAT and MESSAGING give concrete examples of what to do when seeing funny/helpful/wrong/interesting posts.
- **Agent attribution**
  - Every visible action is attributed to a specific agent and, indirectly, its human owner:
    - Feeds and DMs show both the agent identity and owner’s X handle.
    - Identity verification allows external apps to display trusted labels (“Human‑Verified AI Agent”) and rely on Moltbook’s reputation signals for UI decisions.

---

## Core Platform Design Patterns

#### Observed Patterns

- **Instruction‑as‑API‑adapter**:
  - Instead of heavy SDKs, Moltbook gives:
    - A small JSON skill manifest (`skill.json`).
    - A few markdown files with copy‑pastable curl snippets and narrative guidance.
  - This abstracts the API into **LLM‑ and agent‑friendly instructions** that can be consumed by any environment capable of reading markdown and executing HTTP.
- **Layered identity model**:
  - **Agent identity** via `agents` table and API keys.
  - **Human identity** via X/Twitter OAuth and `owner` objects in identity responses.
  - **Developer identity** via `moltdev_` app keys.
  - All are woven together in `POST /agents/verify-identity`, which returns both agent and owner reputation.
- **Heartbeat‑centric autonomy**:
  - Agents are not expected to maintain permanent connections; instead they operate in **bursts** via periodic heartbeats that:
    - Check for updates, DMs, feed changes.
    - Decide whether to take actions or escalate to humans.
- **Polling‑based messaging with explicit escalation**:
  - DMs are fully polling‑based (`/agents/dm/check`).
  - Explicit `needs_human_input` flag implements a clear handoff protocol between bots and humans.
- **Soft social norms encoded in SKILL**:
  - Behavioral guidance (when to post, what to post, how often, how to engage) is encoded in SKILL and HEARTBEAT, not only in technical limits.
  - This provides a **social UX layer** for agents that ride on top of bare REST endpoints.
- **Redundant file hosting / CDN strategy**:
  - `skill.json` and instruction files are served from GitHub raw and mirrored on `moltbook.com`, with explicit fallback logic in SKILL and HEARTBEAT.
  - This pattern treats instruction files as **infra‑critical**, warranting redundancy.

#### Inferred Patterns Relevant to Memo‑Room Agents

- **First‑class “agent object” with identity and reputation**:
  - Voice‑memos would likely need a dedicated `memo_agents` (or similar) table with:
    - Agent ID, human owner relationship, memo‑room association, and reputation fields (e.g., helpfulness, reliability).
- **Instruction‑driven behaviors for memo rooms**:
  - Analogous SKILL/HEARTBEAT/MESSAGING docs for memo‑room agents could:
    - Describe how to join rooms, listen to memos, generate artifacts, and coordinate with humans.
    - Embed rate limits and social norms (how often to speak, when to escalate).
- **Heartbeat integrated with memo processing**:
  - A heartbeat loop for memo agents might:
    - Check for new memos or transcripts in assigned rooms.
    - Check `job_runs` for pending artifact generation tasks.
    - Poll a DM‑like layer for human questions or corrections about artifacts.
    - Update artifacts or room summaries based on the latest transcripts.

---

## Moltbook Concept → Voice Memo Equivalent

| Moltbook Concept | Description | Voice Memo Equivalent (Proposed) |
|------------------|-------------|----------------------------------|
| `agent` | First‑class AI account with name, description, avatar, karma, owner | **Memo‑room agent participant** with identity fields, bound to a human owner and one or more memo rooms |
| `post` | Top‑level piece of content in a submolt | **Memo artifact or top‑level memo message** (e.g., agent’s summary post, key‑takeaway post) in a memo room |
| `comment` | Reply tree under a post | **Conversation messages** inside a memo room thread, including agent replies and human comments |
| `submolt` | Thematic community | **Memo room / shared memo space**, scoped to one memo or a cluster of related memos |
| `feed` | Aggregated view of posts for an agent | **Agent’s memo inbox**, e.g., list of memos/rooms the agent is invited to, sorted by recent transcript activity |
| `agents/dm` | Private, consent‑based messaging between agents (and their humans) | **Memo‑room DM / backchannel** between memo agents and memo owners, e.g., for clarifications or edits that should not appear in the public room transcript |
| `HEARTBEAT.md` | Periodic social engagement loop (check DMs, feed, status, consider posting) | **Memo‑room heartbeat** that periodically checks for new transcript segments, artifacts to update, or unanswered questions in a room and decides whether to respond |
| `SKILL.md` | Onboarding and behavior guidelines for Moltbook | **OpenClaw Memo Skill** that explains how to join memo rooms, how to read transcripts, and how to behave in memo conversations |
| `MESSAGING.md` | DM protocol and escalation rules | **Memo‑room messaging rules** specifying when to post in‑room vs DM the owner, and how to escalate confusing content |
| `RULES.md` | Global community rules and safety constraints | **Memo‑room safety and compliance rules**, e.g., privacy constraints, redaction policies, and off‑limits topics for agents in transcripts |
| `skill.json` | Machine‑readable manifest for the Moltbook skill | **OpenClaw memo-room skill manifest** describing tool endpoints (TranscriptSearch, PostMessage, ReplyToMessage) and heartbeat behavior |
| `identity-token` / `verify-identity` | Short‑lived tokens and verification endpoint for cross‑app identity | **Memo agent identity assertions**, e.g., tokens proving a memo‑room agent is the same OpenClaw agent across apps |
| `karma` and stats | Reputation and activity indicators | **Agent helpfulness/reliability scores** based on memo‑room feedback (upvotes on summaries, accepted suggestions, low spam rate) |

---

## Product-Specific Considerations for Memo-Room Agents

The following points refine how Moltbook’s patterns should be adapted (not copied) into a voice‑memo‑native, transcript‑centric product.

### 1. Product Schema vs Agent Capability Surface

The **product data model** must be designed for human UX and long‑term maintainability; OpenClaw agents should **adapt to that model**, not define it. The right question is not “should this object exist for agents?” but **“which existing objects should agents be able to read, reference, or modify?”**

For key objects:

- **`memo`**
  - **First‑class user‑facing**: yes (core document).
  - **Agent‑readable**: yes (title, metadata, transcript summary).
  - **Agent‑writable**: limited; e.g., allowed to propose titles or summary comments, but not to overwrite raw transcript or delete memos.
  - **Internal detail**: no.
- **`transcript_segment`**
  - **First‑class user‑facing**: indirectly (as time‑anchored transcript UI, not as a raw table).
  - **Agent‑readable**: yes; agents must be able to read and reference specific segments/time ranges.
  - **Agent‑writable**: no; agents should not change transcript ground truth.
  - **Internal detail**: no, because it is the anchoring primitive for discussion.
- **`conversation_thread` (future room/thread object)**
  - **First‑class user‑facing**: yes; humans should see threaded conversations tied to memos.
  - **Agent‑readable**: yes; agents need context of prior messages.
  - **Agent‑writable**: yes; agents post comments/replies in threads.
  - **Internal detail**: no.
- **`message` / `comment`**
  - **First‑class user‑facing**: yes; primary participation primitive.
  - **Agent‑readable**: yes.
  - **Agent‑writable**: yes, but constrained (rate limits, etiquette, no editing other users’ messages).
  - **Internal detail**: no.
- **`participant` (room membership/role)**
  - **First‑class user‑facing**: partially (visible presence list in a room).
  - **Agent‑readable**: yes; agents should know who is present, who invited them, and which other agents participate.
  - **Agent‑writable**: no for membership; possibly yes for their own presence state (e.g., set status, opt out of a room).
  - **Internal detail**: no, but exposed in a limited, safe way.
- **`artifact` (summary/outline/image/etc.)**
  - **First‑class user‑facing**: **not required for v1**; can be a future extension.
  - **Agent‑readable**: yes if present (agents can reuse or reference artifacts).
  - **Agent‑writable**: in v1, **prefer representing outputs as comments**; artifact writes can be feature‑flagged and introduced later.
  - **Internal detail**: in v1, effectively yes from the agent’s perspective.
- **`reaction` / `vote`**
  - **First‑class user‑facing**: yes for humans (likes/upvotes on comments/messages).
  - **Agent‑readable**: yes (aggregate reputation signals).
  - **Agent‑writable**: **no** (see “Human‑Only Voting and Reputation”).
  - **Internal detail**: no, but only human UIs should write them.
- **`chunk` (memo_transcript_chunks)**
  - **First‑class user‑facing**: no.
  - **Agent‑readable**: only via higher‑level tools like `TranscriptSearch` / `FetchMemoContext`; direct chunk IDs shouldn’t be exposed.
  - **Agent‑writable**: no; this remains an internal retrieval/LLM optimization layer.
  - **Internal detail**: yes, for v1.

This distinction should guide later phases: APIs and tools exposed to agents should sit on top of the **product schema**, never warp it.

### 2. Transcript Anchoring as a Core Primitive

Unlike Moltbook’s text posts, this product is **voice‑native** and transcript‑centric. Agents and humans must be able to anchor discussion to specific transcript context:

- **Timestamp ranges**: comments and agent references should be able to point to `startMs`–`endMs` windows (e.g., “02:13–03:10” of the memo).
- **Transcript segments**: comments may attach to one or more `transcript_segment` IDs, enabling UI to highlight that span in the transcript.
- **Semantic ranges** (future): higher‑level groupings (e.g., “Problem description section”) that map to ranges of segments or timestamps.

Transcript anchoring is thus:

- A **product primitive**: core to the human experience (click a comment → jump to audio/transcript).
- A **tooling primitive for agents**: tools like `TranscriptSegmentFetch` and `FetchMemoContext` should speak in terms of segment IDs and timestamp ranges.

Later architecture and tool design must preserve this as a first‑class concern, not an afterthought on top of generic comments.

### 3. Agent Invocation Model

Moltbook leans heavily on **passive heartbeat polling**. For memo rooms we likely need a richer invocation model:

- **Passive heartbeat participation**
  - Agents periodically scan rooms they belong to for new transcripts or unanswered questions.
  - Good for background tasks (summaries, “catch‑up” analysis).
  - Risk: if used alone, agents may speak when humans are not actively asking for help.
- **Explicit human invocation via UI controls**
  - Humans can click “Ask [Agent]” on:
    - A memo.
    - A specific transcript segment or time range.
    - A conversation thread.
  - The UI sends an explicit tool call that gives the agent focused context and a clear question.
  - This should be the **primary v1 mechanism** for conversational agents to speak.
- **Keyword invocation within conversation**
  - Humans can mention agents (`@AgentName`) or use trigger phrases inside comments.
  - The system detects these and routes a request to the agent with local context (thread + referenced transcript anchors).

Compared to Moltbook, our architecture should **prioritize explicit human summons** and treat heartbeat as a supplemental mechanism for ambient intelligence, not the only participation driver.

### 4. Comments-First Participation Model

For v1, agent participation should be **comments‑first**:

- Agents behave as conversation participants, posting:
  - Analyses of a specific transcript slice.
  - Short summaries.
  - Suggestions / next steps.
  - Clarifying questions.
  - References back to transcript segments or timestamps.
- Agents post **messages inside conversation threads**, not arbitrary new top‑level memo types.

Implications:

- The **message/comment object** becomes the primary write surface for agents.
- The tool model should revolve around:
  - Reading memo + transcript + thread context.
  - Posting replies that are anchored and concise.
- More complex outputs (structured artifacts) can be layered on top later; initially they should be **rendered as comments** (possibly with machine‑readable metadata embedded).

### 5. Artifact Objects as Future Extension

The existing codebase already has `memo_artifacts` for summaries/outlines. However, treating artifacts as agent‑writable v1 primitives introduces complexity:

- **Rendering models**: different artifact types need their own UI and UX.
- **Storage**: versioning, provenance, and potential external links (images, web pages, videos) increase surface area.
- **Moderation**: non‑text artifacts can have safety and content review implications.

For v1:

- Agent contributions should **primarily appear as comments**.
- If we re‑use `memo_artifacts`, it should be:
  - For system‑generated summaries (like current live/final summaries).
  - Possibly for OpenClaw‑generated summaries **behind a feature flag**, not as the default participation model.

Artifacts should be treated as a **future extension**, not a required primitive for the initial agent participation architecture.

### 6. Human-Only Voting and Reputation

To keep reputation human‑driven and avoid automated gaming:

- **Voting should be human‑only**:
  - Only human UIs can write votes/reactions on comments or agents.
  - Agents must not have access to a voting API.
- Research/architecture implications:
  - Decide whether votes attach primarily to:
    - **Messages/comments** (granular “this contribution was helpful”), and/or
    - **Agents** (aggregate reputation).
  - Define aggregation:
    - Per‑agent scores derived from comment votes, acceptance, or room‑owner endorsements.
    - Time‑decay or recency‑weighted metrics for “currently helpful” agents.
  - Future use:
    - Ranking useful OpenClaw agents inside memo rooms.
    - Discovering or “hiring” agents based on track record.

Agents **can read** vote aggregates (e.g., “this message is highly rated”) but cannot cast votes.

### 7. Chunk vs Segment Distinction

The current system already differentiates:

- `memo` – user‑facing unit.
- `memo_transcript_segments` – time‑anchored transcript slices.
- `memo_transcript_chunks` – internal grouping for LLM work.
- `memo_artifacts` – derived outputs.

For agent integration:

- **Segments**:
  - Exposed as part of the **agent‑readable** API.
  - Used as anchoring units in tools (e.g., `TranscriptSegmentFetch`, “attach comment to segment X–Y”).
- **Chunks**:
  - Should remain **internal**:
    - Implementation detail for retrieval, summarization, and artifact pipelines.
    - Not part of the external contract agents depend on.

The architecture phase should preserve this: **agents see transcripts in terms of segments and timestamp ranges**, not chunk IDs. This avoids coupling them to internal tokenization strategies.

### 8. Adaptation vs Direct Copying of Moltbook

Moltbook is a **reference**, not a blueprint. For voice‑memo rooms:

- Concepts that translate well:
  - Instruction‑driven behavior (`SKILL`, `HEARTBEAT`, `MESSAGING` analogues).
  - Heartbeat as a background safety net (jobs, catch‑up analysis).
  - Explicit human escalation (“needs human input”‑style semantics).
  - Clear separation between product schema and agent identity/reputation.
- Concepts that require modification:
  - Moltbook’s post/comment/submolt model maps only partially; we need memo/segment/thread/comment/participant as primaries.
  - DMs become memo‑room backchannels and owner clarifications, not generic cross‑platform chat.
  - Feed semantics become “rooms and memos I care about” rather than generic social feeds.
- Concepts that should be excluded (for now):
  - Agents voting or otherwise directly manipulating reputation.
  - Open cross‑agent discovery feeds that encourage unsolicited outreach; memo rooms should be **invitation‑based** initially.

The end goal is **voice‑native conversation intelligence**: agents that participate intelligently inside transcript‑anchored discussions, not a clone of Moltbook’s agent social network.

These considerations must inform:

- The **architecture design** (Phase 4).
- The **agent tool model** (which objects are exposed as tools vs hidden as internals).
- The **runtime instruction files** (OpenClaw SKILL/HEARTBEAT/MESSAGING/RULES).
- The **implementation plan** (what’s in v1 vs deferred).

### 9. User-Owned Agents and Room Permissions

For this product, the preferred ownership model is **user‑owned agents**:

- Each agent belongs to exactly **one human user**.
- An agent can participate in **multiple memo rooms**.
- A memo room may include **multiple agents from different owners**.

This implies we need an explicit **room permission model** that governs both humans and agents:

- **Human access**
  - Room membership (or ACL) defines which humans can:
    - View the room (memo + transcript + conversations).
    - Post comments/messages.
    - Invite or remove agents.
  - This can be modeled as a `room_participant` / `memo_room_participant` table with roles (`owner`, `member`, `guest`).
- **Agent access**
  - A separate mapping (e.g., `memo_room_agent_participant`) should specify:
    - Which agents are allowed in a room.
    - For each agent:
      - **Access level**: `read_only`, `comment_only`, `full_participation` (e.g., can also propose room-level summaries, drafts, etc.).
      - **Visibility scope**:
        - `scoped_to_owner` – agent’s outputs visible only to the owning user (e.g., private coaching notes).
        - `visible_to_room` – outputs visible to all room participants (e.g., shared analysis).
  - This mapping should always be constrained by both:
    - The agent’s owner (only the owner can authorize their agent for a room).
    - The room’s human owners (only room owners can accept or revoke an agent’s participation).

Architecturally, this permission model must preserve optionality for:

- **Async memo-room discussion**
  - Agents can run in heartbeat or batch mode, periodically analyzing transcripts and threads and posting comments.
  - Permissions must support:
    - Long‑lived room membership.
    - Read‑only observers (agents that never speak unless explicitly summoned).
    - Comment‑level write permissions without giving agents control over core memo data.
- **Live assist / real-time coaching (future)**
  - While we should **not fully optimize for real‑time** in v1, nothing in the schema should prevent:
    - Agents receiving near‑real‑time transcript updates from an active call.
    - Agents posting time‑anchored coaching comments during or immediately after a call.
    - Different visibility modes (e.g., agent comments visible only to the salesperson during a call, not to the customer).
  - Concretely, this suggests:
    - Modeling permissions and visibility at the **room + agent + message** level, not hard‑wiring all agent comments to be globally visible.
    - Keeping transcript anchoring flexible enough to support streaming/live segments later (no assumption that transcripts are always final when comments arrive).

Later phases should treat this user‑owned, room‑scoped agent model as a **hard constraint** when designing:

- The room/entity schema.
- Agent tool permissions and scopes.
- Instruction files describing how agents decide where they are allowed to read and speak.

### 10. Message Visibility & Communication Primitives

Beyond ownership and room membership, the architecture must treat **message visibility** and **communication primitives** as first‑class product concerns that shape how agents integrate.

- **Visibility modes**
  - Not all agent (or human) messages should be room‑public:
    - **Public room messages** – visible to all room participants; used for shared summaries, suggestions, and Q&A.
    - **Owner‑private messages** – visible only to the agent’s owning human (e.g., private coaching notes during a shared call).
    - **Targeted participant messages** – visible only to a specific participant or small subset of participants (e.g., one agent assisting one person in a multi‑participant room).
  - The schema and APIs should support:
    - A `visibility` field on message objects (e.g., `public`, `owner_only`, `restricted`).
    - Optional recipient scoping for restricted messages.
  - This flexibility is important for:
    - Live coaching during sales calls.
    - Private feedback to one user during a shared conversation.
    - Multiple agents helping different humans inside the same memo room.

- **Communication primitives (beyond “comments”)**
  - A minimal, product‑level primitive set should include:
    - **Post public room message** – create a new top‑level message in a room or thread.
    - **Post reply in thread** – reply to an existing message/thread.
    - **Send private participant message** – DM‑style message to a specific participant (subject to permissions).
    - **Fetch memo context** – retrieve memo metadata, high‑level summary, room participants, and agent roster.
    - **Fetch transcript range** – get transcript text + segments for a given timestamp/segment range.
    - **Fetch thread context** – get the message thread plus any transcript anchors it references.
  - Later, the agent tool model should map directly onto these primitives, instead of exposing low‑level tables like chunks or raw artifacts.

### 11. Product vs Agent Responsibilities

The system must **sharply separate** what the platform is responsible for from what agents decide:

- **Product responsibilities**
  - **Permissions & access control**:
    - Enforcing which humans and agents may read/write in which rooms, threads, and transcript ranges.
    - Enforcing agent capability levels (`read_only`, `comment_only`, `full_participation`) per room.
  - **Visibility rules**:
    - Enforcing message visibility modes (public vs owner‑private vs restricted) and preventing cross‑scope leaks.
  - **Identity and attribution**:
    - Ensuring every message is attributed to a stable human+agent identity pair.
  - **Moderation and rate limits**:
    - Capping message frequency, applying abuse/spam rules, and removing content when necessary.
    - Ensuring only humans can vote/react, and aggregating reputation correctly.

- **Agent responsibilities**
  - **Relevance**:
    - Deciding whether a given event, transcript slice, or user question merits a response at all.
  - **Response choice**:
    - Deciding *how* to respond (summary, suggestion, question) within the allowed surfaces.
  - **Visibility choice (within allowed modes)**:
    - Choosing between public vs owner‑private vs restricted messages when multiple are permitted by the room configuration.
  - **Tool usage**:
    - Using platform‑provided tools (fetch memo/transcript/thread context, post message) intelligently and conservatively.

The platform should **expose a clear capability surface and strictly enforce boundaries**; agents provide intelligence strictly within those boundaries.

### 12. Optionality for Real-Time Assist

While v1 should remain async‑friendly and relatively simple, the architecture must **not** bake in assumptions that preclude:

- Real‑time sales‑call coaching.
- Private assistance during live conversations.
- User‑owned agents providing in‑context feedback during a shared memo.

Assumptions to avoid:

- “All agent output must be public room comments.”
- “Agents only act after memo finalization.”
- “Agents only participate via delayed async comments.”

Instead, research and later architecture should:

- Ensure transcript and room models can represent **in‑progress/live** transcripts as well as final ones.
- Ensure message schemas support **private and targeted visibility** modes.
- Treat heartbeats and async jobs as the baseline, while keeping room/permission/message designs compatible with future streaming/live APIs (e.g., live transcript updates and near‑real‑time agent messages).

These constraints should explicitly shape:

- The **architecture design** (Phase 4).
- **Room and permission modeling**.
- **Message schema design** (public vs private vs targeted).
- The **agent tool model** (which surfaces agents can safely read/write).
- The **implementation plan** (what goes into v1 while keeping paths open for real‑time expansion).

### 13. Agent Participation Principles and State

To ensure Phase 4 designs the correct system, the research conclusions should lock in the following participation model:

- **Ownership and scope (reiterated)**:
  - One agent belongs to one user.
  - One agent may participate in multiple memo rooms.
  - One memo room may contain multiple agents owned by different users.
  - Agents are user‑owned entities that participate in rooms; they are not room‑owned or free‑floating platform actors.

- **Background system intelligence vs interactive agents**:
  - Background AI features (segmentation, chunking, live summaries/outlines, artifact generation) are **system intelligence substrate**, not room agents.
  - Interactive memo‑room agents:
    - Carry explicit identity and ownership.
    - Are summonable, can comment, coach, and participate in conversations.
    - Should **reference and build on** system‑generated outputs instead of recomputing everything from raw transcripts.

- **Participation model and relevance hierarchy**:
  - Agents should behave like **thoughtful participants**, not automated content generators.
  - **Unconditional rule**: an agent must respond when its **owning human**:
    - Explicitly invokes it via UI controls.
    - Tags/mentions it in a message.
    - Asks it a clear direct question.
  - Responses to non‑owners are **polite but optional** and must satisfy:
    - Room permissions allow it.
    - The response is genuinely useful and improves the conversation.
  - Relevance hierarchy (inspired by Moltbook heartbeat but memo‑room adapted):
    1. Respond to direct requests from the agent’s owner.
    2. Respond to replies or mentions directed at the agent.
    3. Respond to clear unanswered questions where the agent can concretely help.
    4. Offer contextual clarifications or short summaries when they clearly resolve confusion.
    5. Initiate new contributions only when they clearly add value.
  - **Default behavior**: silence unless there is a good reason to speak.
  - Explicit invocation (button, tagging, or keyword) should **guarantee** a response from the agent to its owner; heartbeat remains secondary and primarily scans context.

- **Per-agent state model**:
  - Architecture should plan for per‑agent, per‑room state such as:
    - `last_seen_message_id` or timestamp.
    - `last_seen_transcript_segment_id` or timestamp range.
    - `processed_event_ids` (e.g., message IDs or transcript anchors the agent has already handled).
    - Recent action history (what messages/actions the agent took and when).
  - This state is necessary to:
    - Avoid duplicate replies and loops.
    - Keep agents from reprocessing the same events.
    - Support both async sweeps and future near‑real‑time behavior without noise.

- **Human-only reputation signals (reiterated)**:
  - Human feedback, not agent activity volume, should determine which agents provide the most value.
  - Mechanisms to evaluate in architecture:
    - Voting or reactions on messages/comments.
    - Aggregated helpfulness signals and trust indicators at the agent level.
  - Agents **must not** have a voting API; they can read aggregate signals but cannot write them.

- **Comments-first and deferred artifacts (reiterated)**:
  - For v1:
    - Agents primarily contribute through **comments/messages** (using the communication primitives above).
    - Transcript references and anchors tie discussion to specific points in the memo.
    - Background summaries/outlines remain system intelligence, not automatically surfaced as agent posts.
  - Artifact‑style outputs from agents should be deferred or feature‑flagged; they are not required primitives for the first architecture.

Summarizing principle for architecture: **agents should speak when useful, and stay silent otherwise**. The platform’s job is to define clear capability surfaces, permissions, and visibility; an agent’s job is to decide *if* and *how* to act within them based on relevance to its owner and the room.

---

## Summary of Key Moltbook Behaviors & Patterns (for Memo‑Room Agent Design)

- **Agents are first‑class users identified by API keys, with human owners verified via X/Twitter and a shared identity token system (`/agents/me/identity-token`, `/agents/verify-identity`) that exposes reputation and ownership data.**
- **All authenticated actions — posts, comments, votes, DMs, submolt management, feed queries — go through a consistent REST API (`https://www.moltbook.com/api/v1`) with Bearer auth and clear resource conventions.**
- **Agent behavior is driven by a small set of instruction files (`skill.json`, `SKILL.md`, `HEARTBEAT.md`, `MESSAGING.md`) that encode both the mechanical API flows and the social norms around posting, engagement, and escalation.**
- **A standardized heartbeat loop polls for version updates, DM activity, feed changes, and claim status, and then decides whether to act autonomously, do nothing, or escalate to the human owner.**
- **Private messaging is consent‑based and polling‑driven (`/agents/dm/*`), with explicit support for escalation via a `needs_human_input` flag and owner‑visible dashboards.**
- **Rate limits are enforced both technically (e.g., 1 post per 30 minutes, comment limits, global request caps) and socially (text guidance in SKILL), shaping agent behavior to avoid spammy patterns.**
- **The developer identity layer allows any external app to authenticate bots via short‑lived identity tokens and a single verification endpoint, making Moltbook a portable identity + reputation backbone for AI agents.**
- **Instruction files are CDN‑redundant (GitHub raw + moltbook.com) and versioned (`skill.json`), enabling Moltbook to evolve agent behavior contracts without changing APIs or requiring SDK updates.**
- **Agent UX is almost entirely markdown‑ and HTTP‑driven, while human UX is dashboard‑ and web‑driven; DMs and escalation semantics bridge these two layers.**
- **For voice‑memos, the most relevant patterns are: treat memo‑room agents as durable records with identity and reputation, define instruction‑driven heartbeats to poll memo/transcript state and messaging, and use a clear separation between agent autonomy and human escalation similar to Moltbook’s SKILL/HEARTBEAT/MESSAGING model.**

---

## Transferable Patterns

This section extracts the Moltbook patterns that should explicitly inform the memo‑room agent architecture, adapted to the constraints and goals of the voice‑memos product.

### 1. Instruction‑Driven Agent Behavior

- **Pattern**: Moltbook encodes agent behavior in a small, versioned set of instruction files (`skill.json`, `SKILL.md`, `HEARTBEAT.md`, `MESSAGING.md`, `RULES.md`) instead of hard‑wiring logic into SDKs.
- **Adaptation**:
  - Voice‑memos should define an **OpenClaw memo‑room skill bundle** with:
    - A machine‑readable manifest (`skill.json` analogue) pointing to:
      - `SKILL.md` – how to join memo rooms and what they are.
      - `HEARTBEAT.md` – how to periodically scan memo rooms and transcripts.
      - `MESSAGING.md` – how to post and reply to comments/messages.
      - `RULES.md` – safety, privacy, and etiquette specific to transcripts and memo rooms.
  - These documents should:
    - Map directly onto the concrete tool/API surface (TranscriptSearch, TranscriptSegmentFetch, PostMessage, ReplyToMessage, FetchMemoContext).
    - Encode social norms (when to speak, when to escalate, when to stay silent).
  - Versioning and redundant hosting (similar to GitHub raw + first‑party domain) are desirable but can be phased in; the **core invariant is that behavior is driven by instruction files, not frozen client code**.

### 2. Heartbeat as Background Safety Net

- **Pattern**: Moltbook uses a heartbeat loop that primarily:
  - Polls for new state (DMs, feed, status).
  - Decides whether to act, do nothing, or escalate.
  - Summarizes the outcome in a compact status string.
- **Adaptation**:
  - For memo rooms, heartbeat should:
    - **Scan assigned rooms** for:
      - New transcript segments or ranges since `last_seen_transcript_segment_id` / timestamp.
      - New messages since `last_seen_message_id`.
      - Open questions or explicit invocations that have not been answered.
    - **Check per‑room permissions and visibility** before deciding to act.
    - **Default to no‑op** unless there is clear value in acting.
    - Emit a succinct status summary back to the orchestrator (e.g., “No unanswered questions; watched 2 rooms” vs “Replied to 1 owner question in Memo X (02:13–03:10) with a summary.”).
  - The heartbeat must **support relevance‑based participation**: it should consider context and recent history, not blindly post on every cycle.

### 3. Clear Separation Between Product Schema and Agent Identity

- **Pattern**: Moltbook differentiates:
  - Product content primitives (`posts`, `comments`, `submolts`).
  - Agent identity and reputation (agents, karma, is_claimed, owner).
  - Developer identity (`moltdev_` keys).
- **Adaptation**:
  - Voice‑memos must:
    - Keep memo/transcript/conversation primitives **product‑centric**.
    - Introduce **user‑owned agent identity** as a separate layer:
      - One agent belongs to exactly one human owner.
      - Agents can join many memo rooms.
      - Memo rooms can host multiple agents owned by different users.
    - Preserve **human‑only reputation signals**:
      - Only humans can vote/react or provide explicit feedback.
      - Agent helpfulness metrics are derived from human actions, not agent self‑activity.
  - Architectural invariant: **agents are user‑owned, not room‑owned**, and memo room participation is a projection of that ownership into specific rooms.

### 4. Comments/Messages as the Primary Interaction Surface

- **Pattern**: On Moltbook, posts and comments are the main social primitives; DMs add private nuance.
- **Adaptation**:
  - For memo rooms, **comments/messages are the v1 write surface**:
    - Agents participate by posting messages and replies in conversation threads.
    - Messages can optionally reference transcript anchors (segment IDs and timestamp ranges).
    - More advanced “artifact” outputs (structured summaries, outlines, etc.) are optionally layered on later and can initially be represented as **messages with structured payloads**.
  - The architecture should treat:
    - `message` as the main writeable entity for agents.
    - `conversation_thread` and `memo_room` as the containers around which permissions and context are enforced.

### 5. Consent‑ and Scope‑Based Participation

- **Pattern**: Moltbook’s DMs require explicit human approval; bots cannot DM each other uninvited.
- **Adaptation**:
  - Memo rooms should require **explicit human and agent permission controls**:
    - Room owners decide which agents can join a room and at what capability level (read‑only, comment‑only, full participation).
    - Agent owners must approve each room the agent joins.
    - Within a room, agent output must have **configurable visibility**:
      - Public (visible to all participants).
      - Owner‑private (visible only to the agent’s owner).
      - Restricted to selected participants (e.g., one salesperson in a multi‑participant call).
  - Agents should only respond to non‑owners when:
    - Permissions allow it.
    - It is clearly useful to the conversation.

### 6. Background System Intelligence vs Interactive Agents

- **Pattern**: Moltbook separates:
  - Core platform logic and moderation.
  - Agent behavior driven by instruction files.
- **Adaptation**:
  - Voice‑memos must keep **background system intelligence** distinct from **interactive room agents**:
    - System intelligence includes segmentation, chunking, live summaries/outlines, and artifact generation; it runs regardless of room agents.
    - Interactive agents sit on top of this substrate:
      - They **consume** transcripts and artifacts.
      - They respond via comments/messages.
      - They must not be the only conduit for core product behavior (e.g., transcripts and basic summaries must work without agents).

### 7. Per‑Agent, Per‑Room State for Idempotency

- **Pattern**: Moltbook hints at local “last seen” markers to avoid duplicate replies and spam across heartbeats.
- **Adaptation**:
  - Memo‑room agents should have a well‑defined **state/idempotency model** keyed by `(agent, room)`:
    - `last_seen_message_id` per room/thread.
    - `last_seen_transcript_segment_id` or last processed timestamp range.
    - `processed_event_ids` (message IDs, transcript anchors, or explicit invocation IDs).
    - Optional per‑room cooldown windows for specific action types (e.g., “summarize this section at most once per N minutes”).
  - This state is essential to:
    - Prevent duplicate replies.
    - Avoid infinite loops between multiple agents in the same room.
    - Support both async sweeps and future real‑time behavior without noisy repetition.

### 8. Explicit Invocation Priority

- **Pattern**: Moltbook’s heartbeat is optional; agents can act based on other triggers as well.
- **Adaptation**:
  - For memo rooms, **explicit human invocation must be the primary trigger**:
    - UI actions like “Ask [Agent]” or mentions (`@AgentName`) are **hard requirements** for a response from the agent to its owner.
    - The agent must always respond when its owner directly invokes it (subject to technical failures).
    - Responses to non‑owners are polite but optional, gated by permissions and usefulness.
  - Heartbeat should focus on:
    - Scanning for open owner requests.
    - Checking for unresolved questions.
    - Maintaining situational awareness, not driving unsolicited low‑value output.

---

## Anti‑Patterns

This section captures patterns from Moltbook or generic agent systems that would be harmful or misaligned if copied directly into memo rooms.

### 1. Agent‑Owned or Room‑Owned Agents

- **Anti‑pattern**: Treating agents as room‑owned or platform‑owned (e.g., “this room has a resident bot”) without a clear human owner.
- **Why it fails for memo rooms**:
  - Blurs accountability; it is unclear who is responsible for an agent’s behavior.
  - Makes it harder for users to carry their agents across rooms and products.
  - Complicates permission models and visibility (who can configure this agent?).
- **Constraint**: Agents in this system must remain **user‑owned** with a single human owner, and memo rooms should **invite** user‑owned agents; rooms never “own” the agent.

### 2. Heartbeat‑Driven Spam or Over‑Participation

- **Anti‑pattern**: Using heartbeat as the primary driver of agent output, leading to “I checked again, here’s another generic comment” behavior.
- **Why it fails for memo rooms**:
  - Memo transcripts are dense and repetitive; generic or redundant agent comments become noise quickly.
  - Live conversations and sensitive calls require **high signal** and minimal distraction.
- **Constraint**:
  - Heartbeat is a **background safety net**, not a content pump.
  - Agents should:
    - Speak only when there is a clear unmet need (direct question, unresolved confusion, or explicit owner request).
    - Default to silence otherwise.

### 3. Agent‑Writable Reputation or Voting

- **Anti‑pattern**: Allowing agents to upvote/downvote or otherwise directly influence reputation metrics.
- **Why it fails for memo rooms**:
  - Creates obvious vectors for gaming helpfulness scores and incentivizes volume over quality.
  - Undermines trust in “most helpful” indicators inside memo rooms.
- **Constraint**:
  - Voting and reactions must remain **human‑only**.
  - Agents may read aggregated signals but must have no write access to reputation endpoints.

### 4. Over‑Coupling Agents to Internal Storage Schemas

- **Anti‑pattern**: Exposing internal implementation details (e.g., chunk IDs, job rows) directly to agents.
- **Why it fails for memo rooms**:
  - Couples agents to internal tokenization and job orchestration, making refactors risky.
  - Encourages agents to reason in terms that humans cannot see (e.g., “chunk 17”).
- **Constraint**:
  - Agents must interact through **product primitives and tools**:
    - Memo metadata.
    - Transcript segments and timestamp ranges.
    - Messages/threads/rooms.
    - High‑level artifacts via stable interfaces (e.g., “memo summary”).
  - Internal tables (`memo_transcript_chunks`, `job_runs`, low‑level artifacts) remain strictly server‑side implementation details.

### 5. Treating All Agent Messages as Public

- **Anti‑pattern**: Forcing every agent message to be public to the entire room.
- **Why it fails for memo rooms**:
  - Prevents private coaching or side‑channel guidance.
  - Reduces safety/privacy options in sensitive calls (e.g., sales, therapy, internal debriefs).
- **Constraint**:
  - Message visibility must be **explicitly modeled**:
    - Public, owner‑private, or restricted to selected participants.
  - This applies especially to **agent output**, which must be able to assist one participant while remaining invisible to others when configured that way.

### 6. Real‑Time Optimization at the Expense of Async

- **Anti‑pattern**: Over‑optimizing for real‑time streaming/coaching early, at the cost of robust async behavior and clear APIs.
- **Why it fails for memo rooms**:
  - Real‑time is operationally expensive and fragile.
  - Most value can be delivered through high‑quality async analysis and comments over transcripts.
- **Constraint**:
  - The architecture must **preserve optionality** for future real‑time coaching:
    - Live transcript segments should use the same segment/timestamp primitives.
    - Message visibility and permissions must already support targeted/private modes.
  - But v1 design should not assume streaming or low‑latency bidirectional channels as a precondition for usefulness.

---

## Lessons from Moltbook

This section distills higher‑level lessons that should shape the agent participation architecture for memo rooms.

### 1. Product‑Native, Not API‑Native Design

- Moltbook shows that a rich agent ecosystem can be built on top of **simple REST APIs** and markdown instructions, as long as the **product model** (posts, comments, submolts) is coherent.
- For memo rooms, the architecture must be driven by:
  - What humans need from memo‑centric collaboration (annotated transcripts, threaded discussions, multi‑participant rooms).
  - How agents can plug into that model without dictating schema.
- Agents should adapt to:
  - `memo`, `transcript_segment`, `conversation_thread`, `message`, `participant`, `memo_room`.
  - Rather than forcing new “agent‑native” objects that fragment the product.

### 2. Silence Is a Valid and Often Correct Action

- Moltbook’s SKILL/HEARTBEAT design implicitly encourages agents to refrain from acting when nothing useful is happening.
- For memo rooms, this must become an explicit, **enforced principle**:
  - The default agent action in a room is **no‑op**.
  - Agents are required to respond only when:
    - Their owner directly invokes them (UI button, mention, or direct question).
    - They have explicit permission and high confidence that a response will help.
  - Responses to non‑owners are always optional and gated by usefulness and permissions.

### 3. Explicit Ownership and Accountability

- Moltbook’s human‑verified agent model makes it clear who stands behind an agent’s behavior.
- Memo rooms must maintain:
  - **User‑owned agents** with a single accountable human owner.
  - Clear mapping between:
    - Room ownership.
    - Human participants.
    - Agent participants (and their owners).
  - Message attribution that always displays both:
    - The agent identity (name, avatar, description, badge).
    - The owning human (e.g., name or handle), at least in hover/metadata.

### 4. Human‑Only Reputation and Feedback Loops

- Reputation should flow from **human feedback**, not agent voting or self‑promotion.
- For memo rooms:
  - Reactions/votes on messages and conversations must be human‑input only.
  - Agent‑level helpfulness metrics should be aggregated from:
    - Human reactions to messages.
    - Explicit endorsements or “pinning” of agent outputs.
  - These metrics can feed into:
    - Which agents users choose to invite to rooms.
    - How UIs highlight or rank agent contributions.

### 5. Tool Surface as Contract, Not Implementation Detail

- Moltbook exposes a stable API surface while evolving behavior through instruction files.
- For memo rooms:
  - Tools like `TranscriptSearch`, `TranscriptSegmentFetch`, `FetchMemoContext`, `PostMessage`, and `ReplyToMessage` must be:
    - Stable contracts that agents rely on.
    - Carefully scoped to respect permissions, visibility, and human‑only reputation rules.
  - Internal changes to storage, chunking, or job orchestration should not leak into these tool definitions.

### 6. Keep Real‑Time Optional but Available Later

- Moltbook’s heartbeat and DM patterns work well in a polling‑heavy world; real‑time is not a prerequisite for useful social agents.
- Memo rooms should:
  - Deliver meaningful value via async transcripts + threaded comments first.
  - Ensure **no schema or permission decision blocks** adding:
    - Live transcript feeds into rooms.
    - Near‑real‑time agent coaching for owners.
    - Multi‑agent, multi‑human rooms for live calls.

### 7. Clear Separation Between Platform Responsibilities and Agent Responsibilities

- Moltbook draws a clean line: the platform enforces auth, rate limits, and rules; agents decide if/what to say within those constraints.
- For memo rooms, the architecture must:
  - Give the platform responsibility for:
    - Auth, access control, and RLS on memos, rooms, messages, and transcripts.
    - Enforcing human‑only reputation and message visibility scopes.
    - Moderation tools and rate limiting.
  - Make agents responsible for:
    - Relevance and usefulness of their contributions.
    - Respecting their owner’s preferences and room configuration.
    - Choosing when to escalate to their owner for help instead of guessing.

Taken together, these patterns, anti‑patterns, and lessons define the **product‑level interaction model** that Phase 4’s architecture must inherit: **user‑owned agents** that participate in **memo‑centric rooms** via **comments/messages** anchored to transcripts, with **strong permission and visibility controls**, a **relevance‑first heartbeat**, **human‑only reputation**, and future‑proofing for real‑time coaching without over‑optimizing for it in v1.
