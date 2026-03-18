## Implementation Plan - Memo-Room Agents for Voice Memos (Phase 6)

This plan assumes Phases 1-5 are accepted and that no implementation work is currently in progress. It preserves the full target architecture described in `architecture.md` and translates it into a repo-specific execution path for `voice-memos/`.

The objective is not to narrow the architecture. The objective is to make implementation less ambiguous by:

- locking the few invariants that must not drift;
- separating architecture commitments from replaceable implementation details;
- mapping work onto the current repo, auth model, route structure, and tests;
- making prerequisites and parallelizable work explicit.

---

## 0. Hard Contracts / Non-Negotiable Invariants

These are architectural commitments. Implementation details may change around them, but these must remain true throughout rollout.

### 0.1 Agent ownership / auth boundary

- Every agent has exactly one human owner.
- Agent-originated requests must resolve to both:
  - `owner_user_id` for existing memo ownership checks, and
  - internal `agent_id` for room participation and capability checks.
- No agent may act across ownership boundaries.
- Agent-aware handlers must fail closed if `agents.owner_user_id !== memoUserId`.

### 0.2 Room membership model

- Memo rooms are the participation boundary.
- Humans, agents, and system actors are all represented as room participants.
- An agent may only read or write within rooms where it has an active participant record.
- v1 usage may be one room per memo, but schema and API contracts must preserve room/memo separation and many-to-many room-to-memo evolution.

### 0.3 Message + reply threading semantics

- `memo_messages` is the canonical write surface for human and agent conversation.
- v1 thread structure is derived from `reply_to_message_id` plus backend-computed `root_message_id`.
- Clients must never control thread topology directly.
- Top-level messages always persist as:
  - `reply_to_message_id = null`
  - `root_message_id = id`
- Replies always persist as:
  - `reply_to_message_id = parent.id`
  - `root_message_id = parent.root_message_id`

### 0.4 Transcript anchor contract

- Transcript segments remain the ground-truth speech representation.
- Messages may anchor to transcript ranges, but they do not redefine transcript structure.
- Any anchor contract exposed to UI or agents must remain segment/time based:
  - `anchor_start_ms`
  - `anchor_end_ms`
  - `anchor_segment_ids`
- Anchor validation is server-side only and must reject impossible ranges.

### 0.5 Visibility guarantees

- Message visibility is part of the data model, not a UI hint.
- `public`, `owner_only`, and `restricted` visibility must be enforced consistently in:
  - room timelines,
  - thread fetches,
  - context endpoints,
  - tool responses,
  - any owner-visible or agent-visible derived views.
- Restricted visibility scopes must only reference participants in the same room.

### 0.6 Invocation idempotency

- Explicit agent requests are durable records, not transient prompts.
- A single routed invocation may produce at most one persisted answer unless explicitly retried.
- Idempotency must be enforced by a combination of:
  - `agent_invocations` uniqueness,
  - status transitions,
  - `agent_room_state` delta markers.

### 0.7 Protected owner / agent-internal data non-disclosure

- Owner-private messages, restricted messages, and agent-internal state must never leak to unauthorized humans, other agents, or public/share surfaces.
- Agent-internal state includes at minimum:
  - `agent_room_state.last_processed_invocation_id`
  - agent-specific settings not meant for other participants
  - internal ownership/auth linkage
- Existing share routes and memo exports must remain memo-content surfaces, not memo-room leakage surfaces.
- If share surfaces advertise agent onboarding, they may expose only public-safe discovery metadata such as manifest URLs, alternates, and a share-scoped handoff URL. Room ids, participant state, and write-capable runtime coordinates stay behind authenticated handoff.

---

## 1. Soft / Deferable Implementation Details

These are intentionally not architectural commitments. They can change without changing the destination system as long as the stable contracts above are preserved.

- Transcript search backend details behind the stable search API.
  - Postgres full-text search is the practical v1 default.
  - A vector index, denormalized segment search table, or hybrid retriever can replace it later without changing the API contract.
- Simulation harness details.
  - CLI, internal admin page, or test-only driver are all acceptable.
  - The architecture only requires a repeatable way to exercise explicit invocation and heartbeat behavior.
- Optional observability storage.
  - Structured application logs are sufficient at first.
  - A dedicated `agent_action_log` table is optional until SQL querying or user-facing action history requires it.
- Orchestrator scheduling policy details beyond the priority order.
  - The priority order is fixed.
  - Cadence, batching, worker fan-out, and backoff policy are implementation choices.
- Exact UI composition choices inside the memo studio shell.
  - The room view must expose transcript, messages, participants, and agent actions.
  - Whether that arrives as tabs, split panes, or responsive collapses is a product implementation detail.
- Internal adapter packaging.
  - The short-term adapter may live in Next.js server code.
  - It can later move into a dedicated internal service if the external tool contract stays stable.

---

## 2. Delivery Tier Legend

Every new table, endpoint, and subsystem below is labeled with one of these tiers:

- `Foundational now`: required to establish the architecture and core CRUD boundary correctly.
- `Needed for v1 but can come after core CRUD`: required for the first usable product slice, but can follow the base room/message foundation.
- `Optional / later-stage support`: valuable support capability that should not block the core architecture landing correctly.

---

## 3. Repo Integration Seams

This section maps the target architecture onto the current `voice-memos` codebase so implementation work extends the repo rather than fighting it.

### 3.1 Auth and identity seam

Current repo seam:

- `src/lib/memo-api-auth.ts`
  - `resolveMemoUserId(req)` resolves the active Clerk user or bearer-token-backed user id.
- Repo-verified identity shape:
  - memo ownership columns in this app are `text` Clerk user ids;
  - the baseline database model includes `public.users(id text)`, so new `owner_user_id` / `user_id` references should keep using `text`;
  - when RLS is added for memo-room/agent tables, compare against the Clerk JWT subject shape used elsewhere in the repo rather than assuming UUID auth ids.

Implementation direction:

- Reuse `resolveMemoUserId` as the human ownership/auth primitive.
- Wrap it with an agent-aware internal auth layer rather than replacing it everywhere.
- Add a narrow helper for agent-aware routes, for example:
  - resolve `memoUserId` using current logic;
  - attach `agentId` when the request came through the internal agent gateway;
  - centralize the invariant that agent owner must equal `memoUserId`.

What is reused, wrapped, extended, replaced:

- Reused:
  - existing `resolveMemoUserId` user resolution behavior.
- Wrapped:
  - agent-facing routes should wrap this with agent identity resolution.
- Extended:
  - request context for agent-aware routes.
- Replaced:
  - nothing in existing human memo routes unless a route is explicitly upgraded to support agents.

### 3.2 Existing memo detail and transcript APIs

Current repo seam:

- `src/app/api/memos/[id]/route.ts`
  - returns memo detail and transcript segments for owner-scoped memo detail.
- `src/app/api/memos/[id]/segments/live/route.ts`
  - writes live transcript segments.
- `src/app/api/memos/[id]/artifacts/route.ts`
  - returns memo artifacts.
- `src/app/api/memos/[id]/share/route.ts` and `/s/[shareRef]`
  - existing memo sharing surface.

Implementation direction:

- Reuse existing memo ownership checks and transcript segment retrieval logic.
- Extend memo transcript access with dedicated room/tool endpoints rather than overloading share routes.
- Add a transcript window/search surface that reads from the same memo-native transcript foundation:
  - `memos`
  - `memo_transcript_segments`
  - `memo_transcript_chunks`
- Keep memo-room logic additive; do not merge room visibility concerns into public/share responses.

What is reused, wrapped, extended, replaced:

- Reused:
  - memo ownership patterns, transcript segment reads, artifact reads.
- Wrapped:
  - transcript fetch/search for room-scoped agent tools.
- Extended:
  - `GET /api/memos/[id]/transcript`
  - `GET /api/memos/[id]/transcript/search`
- Replaced:
  - no existing transcript write path.

### 3.3 Existing share route and share-contract seam

Current repo seam:

- `src/app/s/[shareRef]/route.ts`
  - canonical public share route that already serves HTML plus `.md` and `.json` alternates.
- `src/lib/share-contract.ts`
  - shared renderers and payload builders for HTML, markdown, and JSON exports.

Implementation direction:

- Keep the canonical share URL human-first and read-only.
- Extend the share contract with public-safe agent discovery metadata in HTML, markdown, and JSON.
- Keep that metadata limited to:
  - skill manifest location;
  - alternate markdown/json locations;
  - share-scoped handoff endpoint;
  - suggested initial action.
- Add a separate authenticated handoff endpoint rather than turning `/s/[shareRef]` into a write surface.
- Keep room resolution server-side: `shareRef -> memo -> room -> invocation`.

What is reused, wrapped, extended, replaced:

- Reused:
  - the existing canonical share route and alternate export model.
- Wrapped:
  - share-scoped agent discovery should wrap the current share contract instead of bypassing it.
- Extended:
  - HTML boot metadata, markdown frontmatter, JSON payload shape, and a share-scoped handoff endpoint.
- Replaced:
  - no existing human-visible share UX needs to be replaced for v1.

### 3.4 Current memo detail / memo studio UI seam

Current repo seam:

- `src/app/page.tsx`
  - owns the main memo studio shell.
- `src/components/memos/MemoStudioSections.tsx`
  - current memo detail presentation, transcript rendering, share actions, voiceover section, playback controls.

Implementation direction:

- Reuse the current memo studio shell and styling as the outer container.
- Extend the selected memo detail view into a memo-room-aware workspace rather than introducing a disconnected parallel app surface.
- Preserve current transcript rendering, audio playback, and memo utilities, then layer:
  - room metadata,
  - messages/thread pane,
  - participant list,
  - owner controls such as `Ask [Agent]`.

What is reused, wrapped, extended, replaced:

- Reused:
  - page shell, selected memo flow, transcript rendering, playback/seek behavior, existing styling patterns.
- Wrapped:
  - `MemoDetailView` should become room-aware or delegate to a room layout wrapper.
- Extended:
  - transcript anchors, room discussion UI, participant presence.
- Replaced:
  - none of the existing memo detail basics; the room layer is a superset.

### 3.5 Existing test conventions seam

Current repo seam:

- Route tests are colocated with handlers, for example:
  - `src/app/api/memos/[id]/route.test.ts`
  - `src/app/api/memos/[id]/segments/live/route.test.ts`
- Tests use Jest with node environment for route handlers.
- Patterns already in repo:
  - mock `supabaseAdmin`;
  - mock auth helpers (`auth` or `resolveMemoUserId`);
  - assert route status/body and exact DB calls.

Implementation direction:

- Reuse the colocated route test pattern for all memo-room and agent endpoints.
- Reuse Jest + React Testing Library for UI pieces.
- Prefer repo-consistent integration-style route tests over isolated logic-only tests when behavior spans auth, visibility, and DB access.

What is reused, wrapped, extended, replaced:

- Reused:
  - colocated `route.test.ts` style and Jest mocks.
- Wrapped:
  - agent gateway or auth-context helpers should be mocked where needed.
- Extended:
  - invariant-focused integration tests for visibility, threading, and idempotency.
- Replaced:
  - no need to introduce a new test runner or a separate route-testing framework.

---

## 4. Data Model and Schema Inventory

All schema changes live in `supabase/migrations/`. Existing memo-native foundations remain authoritative.

### 4.1 Existing memo-native tables that remain foundational

| Table | Role in target architecture | Tier |
| --- | --- | --- |
| `memos` | Canonical memo container, owner boundary, duration source, transcript/artifact parent | Foundational now |
| `memo_transcript_segments` | Ground-truth time-anchored transcript units used by anchors, fetch, and search result mapping | Foundational now |
| `memo_transcript_chunks` | Existing transcript chunk/search support surface and memo artifact generation input | Foundational now |
| `memo_artifacts` | Existing summary/context surface reused by room context and agent context | Foundational now |
| `job_runs` | Existing orchestration substrate reused for memo artifact generation and potentially room-related jobs where appropriate | Foundational now |

Constraints:

- Extend these surfaces; do not redefine their semantics.
- Memo-room architecture must treat `memos` and `memo_transcript_segments` as the memo-native foundation.
- Reuse `job_runs` deliberately for memo artifact generation orchestration, not as a generic catch-all for agent state.

### 4.2 New room, participant, and message tables

| Table | Purpose | Key notes | Tier |
| --- | --- | --- | --- |
| `memo_rooms` | Room-level collaboration container | Separate from `memos`; v1 usually 1 room per memo but no architectural 1:1 collapse | Foundational now |
| `memo_room_memos` | Room-to-memo association | Preserve many-to-many flexibility from day one | Foundational now |
| `memo_room_participants` | Membership for humans, agents, system actors | Primary permission and visibility enforcement surface | Foundational now |
| `memo_messages` | Canonical message/comment primitive | Carries thread semantics, anchors, visibility, authorship | Foundational now |
| `message_reactions` | Human-only reactions on messages | Aggregated feedback, no agent write path | Needed for v1 but can come after core CRUD |

Recommended v1 shape:

- `memo_messages` should use inline anchor fields in v1:
  - `anchor_start_ms`
  - `anchor_end_ms`
  - `anchor_segment_ids`
- `memo_messages.memo_id` should remain a single attached-memo reference per message even when a room contains multiple memos.
  - The schema should enforce that `(memo_room_id, memo_id)` exists in `memo_room_memos`.
  - Write APIs may omit `memoId` only when the room currently has exactly one attached memo.
- A dedicated anchor join table is an allowed future evolution, but not required to land the core architecture.

### 4.3 New agent identity and state tables

| Table | Purpose | Key notes | Tier |
| --- | --- | --- | --- |
| `agents` | Persistent user-owned agent registry | Stores non-secret identity and ownership metadata only | Needed for v1 but can come after core CRUD |
| `agent_room_state` | Per-agent per-room state and delta markers | Avoid duplicate scans/replies; stores room-scoped settings | Needed for v1 but can come after core CRUD |
| `agent_invocations` | Durable record of explicit owner-triggered requests | Status lifecycle is the idempotency spine | Needed for v1 but can come after core CRUD |
| `agent_action_log` | Optional durable audit trail | Start with structured logs unless SQL querying is required | Optional / later-stage support |

### 4.4 Required constraints and indexes

These are not optional if the corresponding table lands.

- `memo_room_memos`
  - composite PK `(memo_room_id, memo_id)`
- `memo_room_participants`
  - membership uniqueness within a room by human or agent identity
  - indexes for room membership and restricted visibility checks
- `memo_messages`
  - backend-computed thread fields only
  - composite room/memo integrity against `memo_room_memos`
  - room timeline index on `(memo_room_id, created_at desc)`
  - thread lookup index on `(root_message_id)`
  - anchor bounds validation
- `message_reactions`
  - unique `(message_id, user_id, reaction_type)`
- `agent_room_state`
  - unique `(agent_id, memo_room_id)`
- `agent_invocations`
  - unique `(agent_id, request_message_id)`
  - status index for worker polling

---

## 5. API and Tool Surface Inventory

All new endpoints should live under `src/app/api/` as App Router route handlers and follow the repo's existing auth and colocated test conventions.

### 5.1 Room and participant endpoints

| Endpoint | Purpose | Tier |
| --- | --- | --- |
| `POST /api/memo-rooms` | Create room, attach memo, add owner as participant | Foundational now |
| `GET /api/memo-rooms/[roomId]` | Fetch room detail, attached memos, roster | Foundational now |
| `POST /api/memo-rooms/[roomId]/participants` | Invite humans or agents, seed agent room state | Needed for v1 but can come after core CRUD |
| `PATCH /api/memo-rooms/[roomId]/participants/[participantId]` | Update role/capability/default visibility | Needed for v1 but can come after core CRUD |
| `DELETE /api/memo-rooms/[roomId]/participants/[participantId]` | Remove participant or revoke agent membership | Needed for v1 but can come after core CRUD |

### 5.2 Message endpoints

| Endpoint | Purpose | Tier |
| --- | --- | --- |
| `GET /api/memo-rooms/[roomId]/messages` | Room timeline or thread fetch with visibility enforcement | Foundational now |
| `POST /api/memo-rooms/[roomId]/messages` | Create top-level message and enforce anchor/thread rules | Foundational now |
| `POST /api/memo-rooms/[roomId]/messages/[messageId]/reply` | Create reply with backend-derived thread root | Foundational now |

Required behaviors:

- ignore any client-supplied thread topology fields;
- require `memoId` on write when a room has multiple attached memos;
- validate anchors against memo bounds;
- enforce restricted participant ids as same-room participant ids only;
- enforce participant capability before allowing writes.

### 5.3 Context and transcript endpoints

| Endpoint | Purpose | Tier |
| --- | --- | --- |
| `GET /api/memo-rooms/[roomId]/context` | Memo-room context for agents and room UI | Needed for v1 but can come after core CRUD |
| `GET /api/memos/[id]/transcript` | Segment/time window fetch for transcript tooling | Needed for v1 but can come after core CRUD |
| `GET /api/memos/[id]/transcript/search` | Transcript search returning segment/time anchored hits | Needed for v1 but can come after core CRUD |

Transcript search v1 decision:

- Use Postgres full-text search first.
- Keep the stable response contract segment/time anchored so the backend can change later.
- Prefer searching segment-derived or chunk-derived text over inventing a separate memo-room transcript store.

### 5.4 Agent-facing state and orchestration endpoints

| Endpoint | Purpose | Tier |
| --- | --- | --- |
| `GET /api/agents/[agentId]/rooms` | List participating rooms plus state summary | Needed for v1 but can come after core CRUD |
| `GET /api/agents/[agentId]/invocations` | List pending/recent explicit invocations | Needed for v1 but can come after core CRUD |
| `PATCH /api/agents/[agentId]/invocations/[invocationId]` | Move invocation through status lifecycle | Needed for v1 but can come after core CRUD |
| `PATCH /api/agents/[agentId]/rooms/[roomId]/state` | Update room delta markers after processing | Needed for v1 but can come after core CRUD |

### 5.5 Reaction endpoints

| Endpoint | Purpose | Tier |
| --- | --- | --- |
| `POST /api/memo-rooms/[roomId]/messages/[messageId]/reactions` | Human-only reaction create | Needed for v1 but can come after core CRUD |
| `DELETE /api/memo-rooms/[roomId]/messages/[messageId]/reactions/[reactionType]` | Human-only reaction removal | Needed for v1 but can come after core CRUD |

Agents must have no reaction write endpoint.

### 5.6 Tool contract mapping

| Tool / contract surface | Backend mapping | Tier |
| --- | --- | --- |
| `TranscriptSearch` | `GET /api/memos/[memoId]/transcript/search` | Needed for v1 but can come after core CRUD |
| `TranscriptSegmentFetch` | `GET /api/memos/[memoId]/transcript` | Needed for v1 but can come after core CRUD |
| `FetchMemoContext` | `GET /api/memo-rooms/[roomId]/context` | Needed for v1 but can come after core CRUD |
| `PostMessage` | `POST /api/memo-rooms/[roomId]/messages` | Foundational now |
| `ReplyToMessage` | `POST /api/memo-rooms/[roomId]/messages/[messageId]/reply` | Foundational now |

---

## 6. Subsystem Inventory

This captures the major subsystems already implied by the architecture and plan, with delivery tiers.

| Subsystem | Scope | Tier |
| --- | --- | --- |
| Room and membership core | Room creation, room-to-memo association, participant membership checks | Foundational now |
| Message and thread core | Message CRUD, reply threading, anchors, visibility | Foundational now |
| Transcript retrieval/search surface | Window fetch and search against memo-native transcript data | Needed for v1 but can come after core CRUD |
| Agent registry and auth gateway | Agent identity resolution and owner-bound auth context | Needed for v1 but can come after core CRUD |
| Agent room state and invocation lifecycle | Delta markers, explicit invocation idempotency, status transitions | Needed for v1 but can come after core CRUD |
| Memo-room UI shell | Transcript plus discussion plus participant presence in studio | Needed for v1 but can come after core CRUD |
| Reactions and helpfulness aggregation | Human feedback loop for messages | Needed for v1 but can come after core CRUD |
| Scheduling and heartbeat orchestration | Prioritized agent work discovery and execution | Needed for v1 but can come after core CRUD |
| Simulation harness | Controlled testing of agent behavior before rollout | Optional / later-stage support |
| Durable action logging table | Queryable action audit in SQL | Optional / later-stage support |

---

## 7. Dependency Graph / Prerequisite Map

This is the execution map. Each major area lists its dependencies, parallel work, and completion gate.

### 7.1 Phase A - Schema foundation

Scope:

- add room, room-memo, participant, and message schema;
- add agent schema if the team wants a single migration wave;
- add constraints and indexes.

Depends on:

- accepted architecture;
- current memo-native schema staying authoritative.

Can run in parallel with:

- API contract drafting;
- UI wireframe work;
- test fixture planning.

Must complete before:

- any route handlers that depend on new tables;
- RLS policy implementation and route tests that assume final table names/columns.

Completion gate:

- migration files are stable enough that route handler code can target them without churn.

### 7.2 Phase B - Room/message CRUD backend

Scope:

- `POST /api/memo-rooms`
- `GET /api/memo-rooms/[roomId]`
- `GET /api/memo-rooms/[roomId]/messages`
- `POST /api/memo-rooms/[roomId]/messages`
- `POST /api/memo-rooms/[roomId]/messages/[messageId]/reply`
- supporting lib helpers for permissions, thread derivation, and anchor validation.

Depends on:

- Phase A schema foundation;
- auth seam decision to keep `resolveMemoUserId` as the user identity primitive.

Can run in parallel with:

- transcript search endpoint implementation;
- agent registry table migration and supporting libs;
- UI scaffolding that reads mock room/message data.

Must complete before:

- any realistic memo-room UI;
- agent posting tools;
- invocation flow integration.

Completion gate:

- core room/message CRUD is test-covered and enforces threading, visibility, and anchor invariants.

### 7.3 Phase C - Transcript tool surface

Scope:

- transcript window endpoint;
- transcript search endpoint;
- shared transcript result mapping utilities.

Depends on:

- existing memo-native transcript tables;
- clear API contract for segment/time-anchored search results.

Can run in parallel with:

- Phase B route work;
- agent gateway implementation;
- UI anchor-selection interactions.

Must complete before:

- usable agent context loading;
- explicit agent asks scoped to transcript ranges;
- simulation harness scenarios that require search/fetch.

Completion gate:

- agents and UI can fetch transcript windows and search results without reading raw low-level tables directly.

### 7.4 Phase D - Agent registry, auth gateway, and invocation/state backend

Scope:

- `agents` support surface;
- agent-aware auth resolution;
- room participant invite/remove for agents;
- `agent_room_state`;
- `agent_invocations`;
- state and invocation endpoints;
- share-scoped handoff endpoint that resolves public share links into authenticated runtime entrypoints.

Depends on:

- Phase A schema;
- Phase B message CRUD;
- hard contract for owner-bound auth and idempotency.

Can run in parallel with:

- transcript tool work;
- memo-room UI work that initially only supports human messages;
- structured logging instrumentation.

Must complete before:

- real agent posting in shared rooms;
- heartbeat sweeps;
- owner-triggered `Ask [Agent]` actions.

Completion gate:

- explicit invocation can be created, processed once, and persisted without crossing ownership boundaries;
- a canonical share link can resolve into authenticated agent runtime without exposing room internals on the public share surface.

### 7.5 Phase E - Memo-room UI integration

Scope:

- room-aware memo detail surface in the current studio;
- participant presence;
- message list/composer;
- transcript anchor interactions;
- owner `Ask [Agent]` controls.

Depends on:

- Phase B room/message CRUD;
- at least a minimal version of Phase C transcript fetch;
- enough of Phase D to show real agent participants and explicit asks if those controls ship.

Can run in parallel with:

- remaining Phase D orchestration work;
- reaction endpoint work;
- simulation harness work.

Must complete before:

- internal dogfooding of the real room experience;
- rollout beyond API-only validation.

Completion gate:

- a selected memo in the current studio can display transcript plus room discussion without regressing existing memo detail basics.

### 7.6 Phase F - Reactions, scheduling, and rollout controls

Scope:

- reaction endpoints and aggregation;
- prioritized heartbeat scheduling;
- feature flags and staged rollout.

Depends on:

- Phase D agent state/invocation model;
- Phase E UI if reactions are user-visible in the first release.

Can run in parallel with:

- simulation harness work;
- observability/logging improvements.

Must complete before:

- production rollout of background agent participation;
- any helpfulness-driven ranking or user feedback loops.

Completion gate:

- prioritized worker behavior and reaction flows are stable enough for limited production traffic.

### 7.7 Phase G - Simulation and later support surfaces

Scope:

- simulation harness;
- optional durable action log table;
- deeper operator tooling.

Depends on:

- stable tool contracts from earlier phases.

Can run in parallel with:

- controlled rollout;
- observability refinements.

Must complete before:

- nothing in core CRUD or v1 UI.

Completion gate:

- internal testing and support ergonomics improve without changing core architecture.

---

## 8. Backend Design Notes by Area

### 8.1 Auth and request context

v1 decision:

- Keep `resolveMemoUserId(req)` as the base user identity resolver.
- Introduce an internal agent gateway that:
  - resolves OpenClaw auth to `agent_id`;
  - resolves that `agent_id` to `owner_user_id`;
  - injects a downstream auth context carrying both values.

Route-level rule:

- Human-only routes may continue to use `resolveMemoUserId` directly.
- Agent-aware routes must additionally require:
  - active room participation;
  - matching owner boundary;
  - capability-appropriate action.

### 8.2 Threading and message persistence

v1 decision:

- Do not introduce a dedicated `conversation_threads` table yet.
- Represent thread structure with `memo_messages` only.

Required backend behavior:

- top-level vs reply topology is computed server-side;
- replies may not cross rooms;
- parent message and memo anchor association must be validated before insert.

### 8.3 Transcript fetch/search

v1 decision:

- reuse existing transcript segment and chunk infrastructure;
- expose search/fetch through stable segment/time APIs only.

Practical guidance:

- build transcript search as a read surface over memo-native data;
- do not create a room-specific transcript copy;
- do not use generic chunks/items as memo transcript infrastructure unless the schema is explicitly extended for memo semantics.

### 8.4 Scheduling and heartbeat prioritization

Priority order is fixed:

1. Pending explicit invocations.
2. Rooms with new messages since `last_seen_message_id`.
3. Rooms with new transcript segments since `last_seen_transcript_segment_id`.
4. Idle rooms with no new deltas.

Everything else is soft:

- cadence;
- batching strategy;
- worker sharding;
- retry/backoff policy.

### 8.5 Observability

v1 decision:

- start with structured logs for agent actions and failures;
- add `agent_action_log` only if operator or owner-facing querying requires SQL-backed history.

Required logged fields even without a table:

- `agent_id`
- `memo_room_id`
- `memo_id`
- `message_id` when applicable
- `invocation_id` when applicable
- `action_type`
- outcome
- timestamp

---

## 9. Frontend / UX Plan

The UI should extend the current memo studio rather than fork into a disconnected tool.

### 9.1 Room-aware memo detail

Destination view for a selected memo:

- transcript pane with time anchors and selection;
- room discussion pane derived from `memo_messages`;
- participant list showing humans and agents;
- owner actions such as `Ask [Agent]`.

Repo fit:

- `src/app/page.tsx` remains the memo studio entry point.
- `src/components/memos/MemoStudioSections.tsx` remains the starting detail surface.
- New memo-room components should plug into that shell rather than bypass it.

Likely new components:

- `src/components/memo-rooms/MemoRoomLayout.tsx`
- `src/components/memo-rooms/MessageList.tsx`
- `src/components/memo-rooms/MessageComposer.tsx`
- `src/components/memo-rooms/ParticipantsList.tsx`
- `src/components/memo-rooms/AgentPresenceBadge.tsx`

All of these are `Needed for v1 but can come after core CRUD`.

### 9.2 Transcript anchor interactions

Required UX behavior:

- clicking a message anchor highlights or seeks the transcript/audio;
- selecting a transcript range can prefill a new message;
- explicit owner asks can target a selected range.

This should reuse current transcript rendering and playback behavior where possible, not replace it.

### 9.3 Visibility and agent attribution

Required UX behavior:

- agent messages are visibly distinct and attributable;
- owner-only or restricted content must have clear UI treatment for authorized viewers;
- unauthorized viewers must not receive hidden content in payloads.

---

## 10. Testing Plan

Testing remains Jest + React Testing Library, with test files colocated next to the code they cover.

### 10.1 Route handler tests

Follow the existing repo pattern:

- colocated `route.test.ts`;
- node environment;
- mock `supabaseAdmin`;
- mock `auth` or `resolveMemoUserId`;
- assert exact authorization and DB behavior.

Coverage priority:

- room creation and ownership;
- message post/reply behavior;
- visibility filtering;
- restricted participant validation;
- agent auth boundary;
- share handoff auth and resolution;
- invocation uniqueness and status progression.

### 10.2 Library tests

Add colocated tests for:

- room permission helpers;
- message topology computation;
- anchor validation;
- transcript search result mapping;
- agent state transition helpers.

### 10.3 UI tests

Use React Testing Library for:

- room-aware memo detail rendering;
- participant list and agent attribution;
- transcript anchor interactions;
- owner action controls.

### 10.4 Core invariant tests

These are the permanent safety net and should be treated as must-have:

- visibility filtering across room/message/context endpoints;
- client-supplied thread fields ignored;
- reply chains preserve stable `root_message_id`;
- anchor bounds rejected when invalid;
- read-only agents cannot post;
- agent owner mismatch is rejected;
- duplicate `(agent_id, request_message_id)` invocations are rejected;
- completed invocations are not answered again without explicit retry;
- protected owner-only or agent-internal data does not leak through room/context/tool responses.
- public share payloads may advertise agent discovery metadata, but must not leak room ids, participant lists, private messages, or agent-private state.

### 10.5 Simulation tests

Simulation remains important, but the exact harness form is soft.

Minimum scenarios:

- explicit owner invocation with a single persisted reply;
- heartbeat no-op when nothing new exists;
- heartbeat reply when new room activity exists;
- restricted visibility scenarios;
- rate-limit and cooldown scenarios if those policies land in v1.

---

## 11. Recommended Build Order

This is the crisp execution sequence for this repo.

### Step 1 - Land foundational schema

Ship:

- `memo_rooms`
- `memo_room_memos`
- `memo_room_participants`
- `memo_messages`
- core constraints and indexes

Optional in same migration wave if desired:

- `agents`
- `agent_room_state`
- `agent_invocations`

Do not proceed to room UI before this schema is stable.

### Step 2 - Land core room/message CRUD

Ship:

- `POST /api/memo-rooms`
- `GET /api/memo-rooms/[roomId]`
- `GET /api/memo-rooms/[roomId]/messages`
- `POST /api/memo-rooms/[roomId]/messages`
- `POST /api/memo-rooms/[roomId]/messages/[messageId]/reply`

This is the first usable architecture slice.

### Step 3 - Land transcript tool surfaces

Ship:

- `GET /api/memos/[id]/transcript`
- `GET /api/memos/[id]/transcript/search`
- shared context assembly needed for room-level fetches

This unlocks transcript-anchored UI and agent tooling without changing the transcript foundation.

### Step 4 - Land agent identity, membership, and invocation flow

Ship:

- agent registry support;
- participant invite/update/remove for agents;
- internal agent gateway;
- `agent_room_state`;
- `agent_invocations`;
- orchestration-facing endpoints;
- share-scoped handoff path from canonical share links into agent runtime.

This is the minimum viable agent backend.

### Step 5 - Land memo-room UI in the current studio

Ship:

- room-aware memo detail surface;
- participants list;
- message composer/list;
- transcript anchor interactions;
- owner `Ask [Agent]` controls.

This is the first end-to-end user-visible slice.

### Step 6 - Land feedback, prioritization, and rollout controls

Ship:

- reactions;
- prioritized heartbeat scheduling;
- feature flags and staged rollout.

### Step 7 - Add later support surfaces

Ship when needed:

- simulation harness refinements;
- durable `agent_action_log`;
- richer operator tooling.

---

## 12. Boundaries That Must Not Be Violated During Implementation

- Do not weaken existing memo ownership and share boundaries.
- Do not move agent logic into low-level transcript chunking or artifact tables.
- Do not use memo-room data to backfill public/share routes unless that is explicitly designed and reviewed later.
- Do not turn `/s/[shareRef]`, `.md`, or `.json` into direct room write surfaces.
- Do not expose agent-private or owner-private content through convenience context payloads.
- Do not collapse rooms into memos in API or schema shape just because v1 usage is usually 1:1.
- Do not allow client-controlled thread topology or anchor validity.

The memo-room agent layer must remain additive on top of the current product, not a rewrite of memo storage, transcript storage, or sharing.
