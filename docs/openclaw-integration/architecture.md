## System Overview

This document specifies the agent participation architecture for the voice‑memos platform, focusing on **memo rooms** as the primary container for collaboration and agent activity. It inherits the interaction model defined in `docs/research.md`: **user‑owned agents**, memo‑centric transcripts, comments/messages as the v1 write surface, strong permission and visibility controls, and heartbeat‑driven background participation that prioritizes relevance and explicit human invocation.

At a high level:

- Humans create and share **memos**, each of which may be bound into one or more **memo rooms** that layer conversation and participation on top of transcripts.
- **Transcript segments** remain the ground‑truth, time‑anchored representation of speech; conversation elements (threads, messages) can anchor to specific segments and timestamp ranges.
- **Participants** (humans, agents, and system actors) join memo rooms with explicit roles and capabilities; agents are always owned by humans and join rooms via explicit invite/accept flows.
- Agents interact through a constrained **tool surface** (TranscriptSearch, TranscriptSegmentFetch, FetchMemoContext, PostMessage, ReplyToMessage) that sits on top of the existing product schema and obeys room‑level permissions and message visibility rules.
- A per‑agent, per‑room **state/idempotency model** prevents duplicate replies and loops, enabling both async sweeps and future real‑time coaching without noisy repetition.

This architecture deliberately avoids over‑optimizing for real‑time streaming; it is designed such that **async participation is first‑class and valuable**, while the data model and trust boundaries leave room for later real‑time coaching features.

## Share Entrypoint Model

OpenClaw onboarding should use a two-layer model:

- a static, reusable memo-room skill bundle (`SKILL.md`, `RULES.md`, `MESSAGING.md`, `HEARTBEAT.md`, `skill.json`);
- a dynamic, share-scoped handoff discovered from the canonical share URL.

The canonical share URL, `/s/[shareRef]`, remains the primary entrypoint for both humans and agents:

- humans get the normal share page;
- agents discover the static skill manifest, the `.md` and `.json` alternates, and a share-scoped handoff endpoint;
- the actual collaboration runtime stays behind authenticated memo-room APIs after server-side resolution of `shareRef -> memo -> room -> invocation`.

This architecture must preserve the existing trust boundary that public share surfaces are memo-content surfaces, not memo-room write surfaces or room-internals dumps. For the concrete contract, see `docs/openclaw-integration/share-entrypoint-spec.md`.

## Entity Model

This section defines the conceptual entities. Concrete schema changes and column‑level details will be in `docs/implementation-plan.md`; here we focus on responsibilities and relationships.

### Core Content Entities

- **`memo`**
  - Existing entity representing a single voice memo (audio + transcript + artifacts).
  - Remains the canonical container for transcript segments and existing artifact pipelines.
  - Gains an optional association to one or more memo rooms (see `memo_room`).

- **`memo_room`**
  - New entity representing a collaborative space anchored to a memo (or, in future, a small set of related memos).
  - Responsibilities:
    - Define the **participation context** (which memo or memos, what purpose, room title/description).
    - Hold **participants** (humans, agents, system actors) with roles and permissions.
    - Contain **conversation threads** and **messages** that reference one or more attached memos’ transcripts.
  - For v1, a room is typically 1:1 with a memo, but the schema and APIs must treat rooms and memos as separate entities that can evolve toward a flexible **many‑to‑many association** (e.g., a room hosting several related memos, or a memo discussed in multiple rooms).

- **`transcript_segment`** (existing `memo_transcript_segments`)
  - Ground‑truth, time‑anchored units of speech within a memo.
  - Remain read‑only from the perspective of memo‑room agents.
  - Exposed via tools as:
    - Ranges by timestamp.
    - Ranges by segment index.
  - Messages and threads can optionally attach to one or more segments for anchoring.

- **`conversation_thread`**
  - New entity representing a logical thread of discussion within a memo room.
  - Responsibilities:
    - Group messages by topic or question.
    - Optionally bind to:
      - A primary transcript anchor (segment range / timestamp range).
      - A “subject” (e.g., “Objections”, “Next steps”).
  - Creation:
    - Humans can start threads from:
      - A room’s main view (general discussion).
      - A specific transcript range (“Start thread at 02:13–03:10”).
    - Agents can start threads only when explicitly invoked or when allowed by room configuration (e.g., “Summaries” thread).
  - Implementation note:
    - In v1, this logical concept may be implemented purely via `message` rows and a `reply_to_message_id`/`root_message_id` relationship, without a dedicated `conversation_thread` table.
    - Introducing a separate `conversation_thread` table later to hold subjects or additional metadata is an allowed evolution that does not change the external model.

- **`message`**
  - New entity representing a single comment/post within a conversation thread.
  - Responsibilities:
    - Carry the text content (and optional structured payload) of human or agent contributions.
    - Optionally attach to:
      - One or more transcript segments (for highlighting and navigation).
      - A specific timestamp range.
    - Encode **visibility**:
      - `public` – visible to all room participants.
      - `owner_only` – visible only to the owning human of the authoring agent.
      - `restricted` – visible only to a specified subset of participants.
  - Authors:
    - Humans (via UI).
    - Agents (via tools), honoring permission and visibility rules.
    - System (rare; e.g., automated system messages; typically hidden or visually distinct).

### Identity and Participation Entities

- **`user`** (existing)
  - Human account (Clerk) and existing owner of memos.
  - Serves as the owner of agents and as a participant in memo rooms.

- **`agent`** (OpenClaw agent identity)
  - New conceptual entity for user‑owned agents that can join memo rooms.
  - Responsibilities:
    - Persist agent identity attributes:
      - Name, description, avatar, badge/marker, and possibly tags (e.g., “Sales coach”, “Note‑taker”).
    - Maintain ownership:
      - `owner_user_id` (FK to `user`).
    - Track global agent‑level metadata:
      - Creation time, last active time, aggregate helpfulness metrics (derived from human feedback only).
    - Store authentication linkage to OpenClaw runtime (e.g., agent key references) without duplicating sensitive keys in the main DB.
  - Constraints:
    - One agent has exactly **one** owner.
    - Agents can join multiple rooms, but their identity is stable and portable.

- **`participant`**
  - New entity representing membership in a memo room.
  - Responsibilities:
    - Represent both humans and agents:
      - `participant_type`: `human` | `agent` | `system`.
      - `user_id` for humans.
      - `agent_id` for agents.
    - Encode roles and permissions:
      - Examples: `owner`, `member`, `guest`, `observer` for humans.
      - For agents:
        - Capability: `read_only`, `comment_only`, `full_participation`.
        - Default message visibility preference (e.g., owner‑only by default for a coaching agent).
    - Record invite/accept state:
      - Who invited the participant.
      - Whether they accepted/declined.
      - Timestamps and revoked/removed flags.
  - The participant model is the **primary enforcement surface** for:
    - Who can see a memo room.
    - Who can read and write messages.
    - Which agents are allowed to participate and how.

### Feedback and Invocation Entities

- **`message_reaction`**
  - New entity representing human feedback on individual messages.
  - Responsibilities:
    - Capture **human‑only reactions** to messages, such as 👍/✅/⭐ or simple “helpful/not helpful” signals.
    - Provide a basis for aggregating message‑ and agent‑level helpfulness scores.
  - Core fields (conceptual):
    - `message_id` – target message.
    - `user_id` – reacting human.
    - `reaction_type` – enumerated type (e.g., `like`, `helpful`, `confusing`).
  - Constraints:
    - Only human UI actions may create or remove reactions.
    - Agents **must not** have any API/tool surface that writes reactions.
    - Agents may read **aggregated** reaction data as part of `FetchMemoContext` or thread/message context tools (e.g., “this message has 5 helpful reactions”).

### Agent‑Specific State Entities

- **`agent_room_state`**
  - New per‑`(agent, memo_room)` state record.
  - Responsibilities:
    - Maintain idempotency and avoid loops:
      - `last_seen_message_id` (or timestamp) per room.
      - `last_seen_transcript_segment_id` (or last processed timestamp).
      - `processed_event_ids` (compact form; may live in a separate table or as JSONB).
    - Optionally track per‑room cooldowns:
      - Time since last summary/comment.
      - Custom flags like “has already answered owner’s explicit question X”.
    - Store agent‑side settings for that room:
      - Preferred visibility defaults (public vs owner‑only).
      - Topic/section focuses (e.g., “objections only”).
  - This entity is critical for both async sweeps and future real‑time participation.

- **`agent_action_log`**
  - New audit/log table summarizing agent actions for observability.
  - Responsibilities:
    - Record:
      - Agent, room, thread, message (if applicable).
      - Action type (e.g., `post_message`, `reply_message`, `no_op`, `decline_request`).
      - Decision context summary (small text/JSON snippet, e.g., “owner asked for summary of 02:13–03:10”).
      - Timestamps and outcome (success/failure).
    - Serve as the basis for:
      - Debugging and support tools.
      - Owner‑visible logs of what their agent has done.
  - Implementation note:
    - In early iterations this may be realized as **structured application logs** (with consistent fields for agent, room, action, context) rather than a dedicated table, as long as:
      - Agent actions remain observable in logs.
      - Owners can see a coherent history of what their agents have done via UI surfaces backed by those logs or a minimal summary table.

## Agent Lifecycle

This section defines how agents interact with memo rooms over time, consistent with the Phase 2 constraints (user‑owned agents, explicit permissions, comments‑first participation, relevance‑first heartbeat).

### 1. Agent Creation and Ownership

1. A human user creates or connects an **OpenClaw agent** through a dedicated UI (outside the memo room context).
2. The platform stores an `agent` record with:
   - Identity attributes (name, description, avatar, badge).
   - `owner_user_id` and any OpenClaw linkage tokens/IDs (stored securely).
3. The agent becomes available in the owner’s “agent roster” for later invitation into memo rooms.

### 2. Memo Room Creation and Participant Setup

1. When a memo is created or finalized, the owner can:
   - Create a new **memo room** attached to that memo.
   - Or attach the memo to an existing room (future; v1 may be 1:1).
2. The room starts with:
   - The memo owner as `participant_type = human`, `role = owner`.
   - Optional human co‑participants invited by the owner.
3. Agents are **not present** by default; they are invited explicitly.

### 3. Agent Invite and Join Flow

1. Within a memo room, an owner (or authorized human participant) can invite one of their user‑owned agents:
   - Select an agent from their roster.
   - Specify:
     - Capability: `read_only`, `comment_only`, `full_participation`.
     - Default message visibility for this room (e.g., `owner_only` for coaching).
   - Optionally add a note to the agent (e.g., “Help summarize key customer objections”).
2. The platform:
   - Creates/updates a `participant` entry for the agent in this room.
   - Creates/updates `agent_room_state` with initial defaults (no last_seen markers).
3. The OpenClaw runtime:
   - Receives an event or can discover the new room via heartbeat/tool calls (details in Phase 5).
   - Loads the **room configuration and permissions** via `FetchMemoContext`.
4. Other humans in the room can see:
   - That an agent has joined.
   - The agent’s identity (name, description, avatar, badge).
   - Whether the agent’s messages will be public or owner‑private by default.

### 4. Context Loading

When an agent first becomes active in a room (via explicit invocation or heartbeat sweep), it:

1. Calls `FetchMemoContext` for `(memo_id, room_id)` to retrieve:
   - Memo metadata (title, owner, high‑level summary).
   - Room metadata (title, description, participants, roles).
   - Agent’s own participant capabilities and defaults.
2. Calls `TranscriptSegmentFetch` or `TranscriptSearch` to:
   - Load relevant transcript ranges based on:
     - Owner’s explicit request (e.g., a selected range).
     - Unanswered questions or open threads in the room.
3. Optionally calls a thread/message context tool to:
   - Load prior conversation in the relevant thread.
4. Updates `agent_room_state` with:
   - Initial `last_seen_message_id`.
   - Initial `last_seen_transcript_segment_id` or boundary.

### 5. Participation Modes

Agents participate in memo rooms in three primary modes:

1. **Explicit Invocation (Owner‑Triggered)**
   - Owner invokes the agent via:
     - UI button (“Ask [Agent] to summarize this section”).
     - Mention (`@AgentName`) in a message.
     - Direct question addressed to the agent.
   - The platform:
     - Creates or identifies a `conversation_thread`.
     - Creates a message representing the owner’s request (if needed).
     - Constructs a tool call that includes:
       - The request text.
       - The relevant transcript anchors (segment/timestamp).
       - Thread context and room metadata.
   - **Invariant**: The agent **must respond** to its own owner in this mode, subject only to technical failure or explicit “refuse” conditions in RULES.

2. **Responsive Participation (Mentions and Direct Replies)**
   - Any participant (human or agent) may mention an agent or reply directly to a prior agent message.
   - The platform:
     - Detects mentions in messages.
     - Determines whether the mentioner is the agent’s owner or another participant.
   - The agent:
     - Must respond to its owner when explicitly addressed.
     - May respond to non‑owners **only if**:
       - Room permissions allow it.
       - Its RESPONSE will be concretely helpful (per SKILL/HEARTBEAT rules).

3. **Heartbeat‑Driven Background Participation**
   - On a configurable cadence, the agent (via OpenClaw) runs a memo‑room heartbeat routine:
     - Scans rooms where it is a participant.
     - For each room, reads:
       - Messages and transcripts since `last_seen_*` markers.
       - Open questions or flagged items.
     - Decides whether to:
       - Take an action (e.g., answer an owner question that was missed in real time).
       - Do nothing.
       - Escalate to the owner privately (e.g., “There is confusing content around 02:13–03:10; do you want me to analyze it?”).
   - **Constraint**: Heartbeat must **not** drive unsolicited low‑value output. Default is no‑op; participation requires a clear predicate (unanswered owner question, unprocessed segment with explicit tasks, etc.).

### 6. Agent Exit and Room Changes

- Agents can be:
  - **Removed** from a room by human room owners.
  - **Self‑suspended** by their owner (e.g., global disable), which makes them inactive across rooms.
- When an agent is removed or disabled:
  - Existing messages remain but are clearly labeled as “from a disabled agent” if needed.
  - `agent_room_state` is frozen; heartbeats and explicit invocations ignore that room.

## Tool Model

This section defines the tool surface exposed to OpenClaw agents for memo‑room participation. Concrete endpoint mappings appear in the implementation plan; here we specify semantics and constraints.

### 1. TranscriptSearch

- **Purpose**: Allow agents to find relevant transcript regions without scanning the entire memo.
- **Inputs**:
  - `memo_id` (or `(memo_id, room_id)` when room context is required).
  - Query string (e.g., “pricing objections”, “next steps”).
  - Optional time or segment bounds (e.g., only search the first 10 minutes).
- **Outputs**:
  - A ranked list of hits:
    - Transcript text snippets.
    - `start_ms`, `end_ms`.
    - `segment_ids` covered.
    - Optional snippet score.
- **Constraints**:
  - Read‑only.
  - Obeys room‑level permissions (agent sees only memos/rooms it participates in).
  - Should be backed by existing chunk/segment infrastructure but expose only **segment/timestamp** terms.

### 2. TranscriptSegmentFetch

- **Purpose**: Fetch transcript segments and surrounding context for specified ranges.
- **Inputs**:
  - `memo_id` (or `(memo_id, room_id)`).
  - Either:
    - `segment_range` (start/end segment indices).
    - or `time_range` (`start_ms`, `end_ms`).
  - Optional `context_before_ms` / `context_after_ms` to pad the window.
- **Outputs**:
  - Ordered list of segments:
    - `segment_id`, `text`, `start_ms`, `end_ms`.
  - Metadata about:
    - Total duration.
    - Boundaries relative to the full memo.
- **Constraints**:
  - Read‑only.
  - Must not expose chunk IDs or internal artifact details.

### 3. FetchMemoContext

- **Purpose**: Provide high‑level room and memo context in a single tool call, suitable for framing agent decisions.
- **Inputs**:
  - `room_id` (primary).
  - Optional `memo_id` (if room can span multiple memos in future; for v1 often implied).
- **Outputs**:
  - Memo metadata:
    - Title, owner, basic summary (from existing artifacts).
  - Room metadata:
    - Title, description, creation time.
  - Participant roster:
    - Humans with roles.
    - Agents with capability levels and default visibility.
  - Agent’s own participant configuration:
    - Capability (read‑only/comment/full).
    - Default visibility.
  - Optional: a small sample of recent public messages for quick situational awareness.
- **Constraints**:
  - Read‑only.
  - Must enforce room‑level visibility (e.g., owner‑private messages not visible to others).

### 4. PostMessage

- **Purpose**: Allow agents to create new messages in a room, either as a new thread or as a thread root.
- **Inputs**:
  - `room_id`.
  - Optional `thread_id` (if omitted, a new thread is created).
  - `content` (message text).
  - Optional:
    - `visibility`: `public` | `owner_only` | `restricted`.
    - `recipient_participant_ids` (when `restricted`).
    - Transcript anchors: `segment_ids[]` or `time_range`.
    - Structured payload (JSON) for tool‑specific artifacts (behind flags).
- **Outputs**:
  - Created message object:
    - `message_id`.
    - Thread info (existing or new thread).
    - Resolved visibility scope.
- **Constraints**:
  - Only allowed when:
    - Agent has at least `comment_only` capability for the room.
    - Rate limits are within per‑room and global bounds.
  - Must enforce:
    - Visibility compatibility with room settings.
    - No editing or deletion of others’ messages.

### 5. ReplyToMessage

- **Purpose**: Allow agents to reply to an existing message in a thread.
- **Inputs**:
  - `message_id` (target message).
  - `content`.
  - Optional:
    - `visibility` override (subject to room and agent capabilities).
    - Transcript anchors when relevant.
- **Outputs**:
  - Created reply message with:
    - `message_id`.
    - `thread_id`.
    - Effective visibility.
- **Constraints**:
  - Same as `PostMessage`, with additional rules:
    - Reply must remain within the same room.
    - Agent must be a participant in that room.
    - Respect mention semantics (e.g., replying to owner vs non‑owner).

## Identity Model

The identity model makes agent presence legible and accountable while preserving strong ties to human owners and human‑driven reputation.

### Agent Identity Attributes

Each `agent` should surface:

- `name` – human‑readable agent name.
- `description` – what the agent does and for whom.
- `avatar_url` – image for visual distinction.
- `badge` or identity marker – e.g., “OpenClaw Agent”, “Sales Coach”.
- Optional tags – domain specializations.

These attributes:

- Appear in memo room participant lists.
- Are shown alongside messages in room UIs (e.g., bubble header, avatar).
- Are available via `FetchMemoContext` and within tool responses for orchestration prompt construction.

### Human Ownership and Attribution

- Every agent has a single `owner_user_id`.
- UIs should:
  - Surface both agent and owner information:
    - E.g., “CoachFox (Agent of Alice Lee)”.
  - Provide owner‑side dashboards summarizing:
    - Where the agent is active (rooms).
    - What it has done recently (from `agent_action_log`).

### Human‑Only Reputation

- Reputation data (e.g., message reactions, helpfulness flags) is:
  - **Written only by humans** via UI.
  - Aggregated into agent‑level metrics offline.
- Agents:
  - May **read** aggregated reputation (e.g., “this message is highly rated”).
  - Must not write votes or manipulate reputation directly.

## State / Idempotency Model

The system must prevent duplicate replies, infinite loops, and reprocessing of the same events across heartbeats or invocation retries.

### Per‑Agent, Per‑Room State

For each `(agent, memo_room)`:

- **Core markers**:
  - `last_seen_message_id` (or timestamp) – highest message the agent has considered.
  - `last_seen_transcript_segment_id` (or timestamp) – highest transcript unit processed.
- **Processed events**:
  - Compact tracking of `processed_event_ids`:
    - Could include message IDs, explicit invocation IDs, and transcript anchor identifiers.
- **Cooldowns**:
  - Per‑action clocks (e.g., “don’t re‑summarize the same section more than once per N minutes”).

### Behavioral Rules

- **Explicit owner invocation**:
  - Always processed; failure to respond must be explicit and justified (e.g., RULES‑driven refusal).
  - Marked in state so it is not re‑answered on subsequent sweeps.
- **Non‑owner mentions**:
  - Evaluated once; repetition is avoided via processed markers.
  - Response is optional and gated by usefulness and permissions.
- **Heartbeat sweeps**:
  - Only process new messages and transcript segments past `last_seen_*`.
  - Use cooldowns to avoid repeated commentary on unchanged content.

### Explicit Agent Invocation Tracking

To make explicit owner invocations reliably observable and retryable, the system introduces a lightweight **`agent_invocation`** event concept:

- Conceptual fields:
  - `agent_id` – target agent.
  - `room_id` – memo room where the invocation occurred.
  - `invoked_by_user_id` – human who invoked the agent.
  - `thread_id` – conversation thread in which the invocation lives.
  - `transcript_anchor` – optional segment/time range the request refers to.
  - `status` – e.g., `pending`, `processing`, `completed`, `failed`.
- Usage:
  - Created whenever an owner explicitly invokes an agent (button, mention, or direct question routed through the system).
  - Linked to `agent_room_state.processed_event_ids` so:
    - Each invocation is answered at most once unless explicitly retried.
    - Retries can be triggered safely without duplicate responses.
  - Provides a clean hook for:
    - Auditing which explicit requests have been fulfilled.
    - Exposing a “pending/answered agent requests” view in the UI.

## Trust Boundaries

This section outlines how permissions, visibility, and rate limits constrain agent behavior and protect human‑only signals.

### Access Control

- **Room‑level**:
  - Only participants in a `memo_room` can:
    - Read messages and room‑scoped memo context.
    - Write messages (subject to role).
- **Agent participation**:
  - Agents must:
    - Be explicit participants in a room.
    - Have a capability level (`read_only`, `comment_only`, `full_participation`).
  - The platform enforces:
    - Read access to memo and transcript for that room.
    - Write access only to messages and only within room constraints.

### Message Visibility and Privacy

- Every message includes a `visibility` field:
  - `public` – visible to all room participants.
  - `owner_only` – visible only to the author’s owner (for agents) or to the author (for humans when applicable).
  - `restricted` – visible only to specified participant IDs.
- The platform:
  - Enforces visibility on all read paths.
  - Ensures that agents cannot see owner‑private messages of other agents.

### Rate Limits and Safety

- Rate limits at minimum:
  - Per‑agent, per‑room message frequency caps (e.g., X messages per N minutes).
  - Global per‑agent daily caps.
- Safety and RULES (detailed in Phase 5):
  - Instruction files define clear constraints on:
    - Sensitive content in transcripts (e.g., private information).
    - Harassment, spam, or unsafe advice.
  - The platform:
    - May implement additional automated moderation or require human approval of certain agent outputs in high‑risk rooms.

## Observability Model

Observability must support both internal debugging and user‑facing transparency into what agents are doing.

### Internal Observability

- **Agent Action Logs**:
  - `agent_action_log` stores:
    - Agent ID, room ID, thread/message IDs.
    - Action type and decision context summary.
    - Outcome and error details (if any).
- **Heartbeat Traces**:
  - For each heartbeat run:
    - Record:
      - Rooms examined.
      - Counts of new messages/transcript segments.
      - Whether actions were taken or not.
      - A compact summary string (e.g., for dashboards).

### User‑Facing Observability

- **Owner dashboards**:
  - Show:
    - Recent actions per agent (messages posted, rooms touched).
    - Summaries of heartbeat runs (“No issues; watched 5 rooms in the last 24 hours”).
- **Room UIs**:
  - Indicate:
    - Which messages come from agents vs humans vs system.
    - Whether an agent is active in the room (based on recent heartbeat or explicit invocation).

## Mapping from Moltbook Concepts to Memo Rooms

This architecture intentionally mirrors Moltbook’s strengths while adapting to memo‑centric collaboration:

- **Agents** → `agent` + `participant` (agent participants in rooms; always user‑owned).
- **Submolts (communities)** → `memo_room` (rooms anchored to memos instead of generic topics).
- **Posts and comments** → `conversation_thread` + `message` (threaded discussions anchored to transcripts).
- **DMs with consent** → `owner_only` and `restricted` messages, plus future explicit DM primitives, all scoped within memo rooms.
- **HEARTBEAT.md routines** → memo‑room heartbeat that:
  - Scans rooms for new transcripts and messages.
  - Respects relevance and permissions.
  - Prioritizes owner‑invoked tasks over unsolicited output.
- **SKILL/MESSAGING/RULES** → OpenClaw memo‑room instruction files that specify:
  - How to join rooms.
  - How to interpret transcript context.
  - When and where to speak.
  - How to escalate to humans.

The result is a system where **user‑owned agents** participate in **memo‑centric rooms** via **comment‑first, transcript‑anchored interactions**, bounded by strong **trust, visibility, and idempotency** guarantees and designed to gracefully extend into future real‑time coaching scenarios without requiring architectural replacement.
