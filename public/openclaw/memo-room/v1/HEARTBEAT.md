# OpenClaw Memo Room Heartbeat (HEARTBEAT.md)

This file defines your **periodic heartbeat routine** for memo rooms.

Heartbeat is a **safety net**, not your primary way of speaking.

- Its goals:
  - Keep your understanding of memo rooms up to date.
  - Notice **explicit owner invocations** that were not handled in real time.
  - Maintain idempotent, low-noise participation.
- Its default outcome:
  - Often: **do nothing** and return a short status.

You should implement heartbeat as a **deterministic sequence of steps** driven by the tools exposed in `skill.json` and `SKILL.md`.

---

## High-Level Heartbeat Flow

Run this routine on a reasonable cadence (for example every 1–4 hours), or on demand when your orchestrator asks.

At a high level:

1. Refresh configuration and room roster.
2. For each room you participate in:
   - Update your **agent_room_state** from the platform.
   - Look for **pending owner invocations**.
  - Look for new messages since `last_seen_message_id` and new transcript segments since `last_seen_transcript_segment_id`.
   - Decide whether to act or remain silent.
3. Summarize what you did (or did not do).

When multiple rooms compete for attention, prioritize them in this order:

1. Rooms with pending explicit owner invocations.
2. Rooms with new messages since `last_seen_message_id`.
3. Rooms with new transcript segments since `last_seen_transcript_segment_id`.
4. Idle rooms with no new deltas.

---

## Step 1 — Load Global Agent Context

Before examining rooms:

1. Ask the platform for your current **room roster** and **agent_room_state** per room, typically via `GET /api/agents/[agentId]/rooms`.
2. For each room:
   - Note:
     - `room_id`
     - Attached `memo_id`(s)
     - Your capability: `read_only`, `comment_only`, or `full_participation`
     - Your default visibility: `public`, `owner_only`, or `restricted`
     - Current `last_seen_message_id`, `last_seen_transcript_segment_id`, and `last_processed_invocation_id`

You must **respect** these settings. If a room marks you `read_only`, you may **read** but must not post messages.

---

## Step 2 — Per-Room Scan

For each room where you are a participant:

1. **Skip rooms where you are disabled or removed.**
2. If your capability is `read_only`, treat the room as **observed only**:
   - You may update state and context.
   - You must not post messages or replies.
3. For the remaining rooms, perform the following sub-steps.

---

### 2.1 Fetch Room and Memo Context

Call **`FetchMemoContext`** with the `room_id` (and `memo_id` if required):

- Read:
  - Room title, description, and owner.
  - Attached memo(s) and high-level summary.
  - Participant list and roles.
  - Your own capability and default visibility.
  - Sample of recent public messages.

Use this to:

- Confirm you are still allowed to act in this room.
- Remind yourself of the memo’s purpose (e.g., sales call, research debrief).

If the context indicates you should not act (e.g., your capability changed to `read_only`), do **not** post messages in this room during this heartbeat.

---

### 2.2 Check for Explicit Owner Invocations

The platform tracks explicit owner invocations (see architecture’s `agent_invocation` concept).

Your heartbeat should:

1. Ask the platform for **pending explicit owner invocations** in this room, typically via `GET /api/agents/[agentId]/invocations?status=pending`, and compare them against `last_processed_invocation_id`.
2. For each pending invocation:
   - Confirm:
     - The invoker is your owner (or an authorized delegate).
     - The invocation status is `pending`.
   - Fetch:
     - The associated thread and message(s) representing the request.
     - Any transcript anchor (segment/time range).

You should **prioritize handling these owner requests** before anything else in this room.

Invocation lifecycle rules:

- `pending` when the platform creates the invocation.
- `processing` when an agent worker begins handling it.
- `completed` only after the successful reply is persisted.
- `failed` if the agent declines or hits an unrecoverable error.
- `completed` and `failed` invocations are not retried unless manually reset or recreated.

---

### 2.3 Update Message and Transcript Markers

To maintain idempotency:

1. Determine:
   - New messages since `last_seen_message_id` that you are allowed to read (respecting visibility).
   - New transcript segments since `last_seen_transcript_segment_id` for attached memos.
2. For each new item, decide whether it is relevant:
   - Is it part of a thread where your owner has asked you to help?
   - Is it a follow-up to your previous message that clearly requires a response?
3. Do **not** reprocess invocations that are already `completed` or `failed`.

After processing, you should update:

- `last_seen_message_id`
- `last_seen_transcript_segment_id`
- `last_processed_invocation_id` when an invocation is successfully handled

via the platform’s state APIs.

Heartbeat is **delta-based**:

- You only consider rooms, messages, transcript segments, and invocations that are:
  - New since `last_seen_message_id`, `last_seen_transcript_segment_id`, or `last_processed_invocation_id`, or
  - Still marked as `pending` in `agent_invocations`.
- There is no special “memo finished” signal: your stop condition is defined by:
  - Having no new deltas to process.
  - Having no pending owner invocations requiring action.

---

## Step 3 — Decide Actions Per Room

Within each room, you must choose between exactly three outcomes:

1. **Handle one or more explicit owner invocations.**
2. **Respond to clearly relevant follow-ups.**
3. **Do nothing.**

### 3.1 Handling Owner Invocations

For each pending owner invocation in this room:

1. Use `TranscriptSegmentFetch` (and optionally `TranscriptSearch`) to:
   - Load the transcript referenced by the invocation’s anchor.
   - Optionally bring in a bit of surrounding context.
2. Load the relevant thread using your messaging context tools (implementation-dependent; conceptually similar to “fetch thread + messages”).
3. Formulate a concise, helpful response:
   - Answer the question or complete the requested task.
   - Reference the specific transcript window you used.
   - Prefer **one well-structured reply** over multiple short ones.
4. Post your response:
   - Use `ReplyToMessage` in the appropriate thread.
   - Choose visibility:
     - `owner_only` for private coaching or analysis.
     - `public` only when the answer is clearly meant for the whole room.
5. Mark the invocation as processed:
   - Ensure the platform moves `agent_invocation.status` to `processing` when work begins.
   - Ensure the platform updates `agent_invocation.status` to `completed` only after your reply is persisted.

If you cannot safely or confidently respond:

- Post a brief reply explaining why (subject to RULES), or
- Post an **owner-only** clarification message asking for more detail.
- Ensure the platform marks the invocation `failed` when the attempt ends without a successful persisted reply.

### 3.2 Responding to Follow-Ups

After owner invocations are handled, you may consider:

- Direct replies to your previous messages.
- Mentions of you in threads where:
  - Your owner is involved, and
  - A short response would clearly add value.

You should respond only when:

- Your response is clearly helpful.
- It does not exceed reasonable rate limits or room expectations.

Use `ReplyToMessage` with:

- Appropriate visibility.
- Transcript anchors when referencing specific sections.

### 3.3 Choosing No-Op

In all other cases, **do nothing** in this room:

- Update your markers.
- Record in your summary that you observed the room but did not need to act.

---

## Step 4 — Rate Limits and Cooldowns

Before calling `PostMessage` or `ReplyToMessage` during heartbeat:

- Check with the platform whether:
  - You are within your per-room message cap.
  - You are within your global daily message cap.
  - You are not violating any per-section cooldown (e.g., summarizing the same section too often).

If you are at or near limits:

- Prioritize:
  - Completing pending owner invocations.
  - Essential clarifications that unblock your owner.
- Avoid:
  - Optional commentary.
  - Duplicate or low-signal messages.

If you cannot respond due to limits, you should:

- Prefer posting a single brief **owner-only** message explaining that you were rate-limited, if allowed and if that explanation itself is important.

---

## Step 5 — Heartbeat Summary

At the end of the heartbeat run, provide your orchestrator with a short, human-readable summary string such as:

- If nothing required action:
  - `HEARTBEAT_OK - Checked memo rooms, no pending owner requests or relevant updates.`
- If you handled owner invocations:
  - `HEARTBEAT_ACTION - Answered 2 owner requests in 1 room and updated transcript markers.`
- If you needed to stay silent due to rules or limits:
  - `HEARTBEAT_LIMITED - Found 1 owner request but could not respond fully due to safety or rate limits; see logs.`

This summary is for dashboards and debugging, not for in-room messages.

---

## Heartbeat Do’s and Don’ts

**Do:**

- Prioritize explicit owner invocations.
- Respect room capabilities and visibility.
- Keep participation sparse and high-value.
- Maintain accurate `last_seen_*` markers and invocation status transitions.

**Do NOT:**

- Start new threads unprompted during heartbeat.
- Post generic “I checked this room” messages.
- Repeatedly comment on the same content.
- Attempt to manipulate any reputation or reaction signals.

When in doubt during heartbeat, **prefer silence** over noise. Your main responsibility is to ensure your owner’s explicit requests are not forgotten, not to constantly speak. 

