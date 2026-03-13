# Shared Memo Rooms Conversation

Date: 2026-03-09

## User Direction

The goal is to evolve the live-transcript voice memo app into something usable by both humans and their OpenCall-style agents.

Key product ideas raised:

- Make the app feel more social.
- Let AI participate directly around a transcript.
- Potentially add a Claude Agent SDK-style interface at the bottom of the page so users can ask questions based on the transcript.
- Potentially expose an API so OpenClaw or other agents can read from the memo/share surface.
- Add a comment section or social feed to each sharing page.
- Show how many people are currently in the page and how many total views it has.
- Add a way for people to "join the conversation."
- Support both human participants and agent participants.
- Allow an OpenCall agent to join through a link that includes instructions for using the API and reading the transcript.
- Encourage agents to be creative, use tools, learn interesting things from the transcript, and contribute positively and humorously.

## Product Recommendation

The strongest direction is not to start with a Claude panel embedded at the bottom of the page.

The better first move is to turn each shared memo into a **conversation surface** where both humans and agents can participate against the same transcript.

Why:

- An embedded Claude panel is useful, but it is mostly a private copilot.
- A shared memo room creates a durable social object.
- It supports humans and agents as first-class participants.
- It creates a cleaner foundation for comments, anchors, presence, views, and future automation.

## Recommended Build Order

1. Transcript-anchor conversation layer
2. Agent invitation and agent identity model
3. Public share-page social mechanics
4. Optional embedded "Ask an agent" panel

## Core Product Model

Suggested core entities:

- `memo`
- `transcript_segment` or `anchor`
- `conversation_thread`
- `message`
- `participant`

A message should be able to target:

- the whole memo
- a transcript anchor range
- another message

A participant should support:

- `human`
- `agent`
- later `system`

## Agent Access Model

Do not let public share links inherit broad API access.

Instead, create a separate **agent invite token** with narrow permissions:

- read this memo/share payload
- read transcript anchors
- post messages into this one conversation
- optionally attach links or generated artifacts

This should behave like "this agent can join this room," not "this agent can access the whole account."

## Share Page Evolution

The share page should become a lightweight live room with four modules:

- Transcript
- Conversation
- Participants
- Activity

The conversation should support:

- human comments
- agent comments
- anchor-linked replies
- lightweight reactions
- "agent is thinking" state
- attached links or generated artifacts

The participants area should show:

- human participants
- agent participants
- live presence count
- total view count

## Key Data Model Distinctions

These should remain separate:

- **Presence** = ephemeral, realtime
- **Views** = durable analytics
- **Comments** = durable conversation state

Do not merge them into one table or one event stream without a strong reason.

## Direct Recommendation On Current Options

Between the two initial directions:

- Claude SDK at the bottom: valuable later, weak as the first core move
- API/share surface for agents: better platform foundation

Best long-term approach:

- Build the API/share + conversation model first
- Then let Claude or another agent UI become just another client of that same system

## Why This Fits The Current Codebase

Relevant existing foundation already exists:

- Share routes already support `html`, `md`, and `json`
- There is already an agent-facing docs/export surface
- Live transcript state is already persisted into a live memo
- `memo_transcript_segments` already exists and anticipates future live segment writes

That means the product is already leaning toward machine-readable memo sharing, which is the right base for agent participation.

## Suggested MVP

The scoped MVP recommendation:

1. Anchor-aware comments on shared memo pages
2. Realtime presence count on the share page
3. Durable view count
4. Agent invite link that allows a single external agent to read the share JSON and post comments
5. Agent messages rendered with a distinct identity badge

## What Not To Build First

Avoid starting with:

- full Claude SDK embed
- multi-agent orchestration
- arbitrary tool execution directly inside the page
- "vibe code something from the transcript" write-back flows

Those are second-wave features after the room metaphor works.

## Main Risk

The main risk is identity and abuse, not UI.

Important trust boundaries:

- public share link = read access
- agent invite token = read + comment on one memo/thread
- owner auth = full control

## Final Product Thesis

Build **shared memo rooms** first, not just "Claude at the bottom."

That creates a stronger foundation for:

- transcript anchors
- comments
- presence
- views
- human participation
- agent participation
- future embedded AI clients
