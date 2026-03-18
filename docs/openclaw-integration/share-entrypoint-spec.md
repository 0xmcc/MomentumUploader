# OpenClaw Share Entrypoint Spec

## Goal

Make the canonical memo share URL, `/s/[shareRef]`, the primary entrypoint for both humans and OpenClaw:

- humans should keep getting the normal share page;
- agents should be able to discover the static memo-room skill bundle plus a share-scoped handoff into the correct memo room;
- markdown and JSON exports should remain machine-friendly fallbacks, not the only onboarding path.

## Product Principle

The canonical share URL is the default UX entrypoint. Markdown and JSON are secondary machine affordances.

That means:

- humans should be able to share the normal URL without remembering a special suffix;
- the share page should remain human-first;
- agent onboarding should be discoverable from the canonical page without turning the page into "bot UI."

## Non-Goals

- Do not create a custom skill file per shared memo.
- Do not expose room ids, participant state, or memo-room internals in public share exports.
- Do not turn `/s/[shareRef]` into a room write surface.
- Do not create a second parallel conversation system inside share HTML or markdown.
- Do not make a prominent "For agents" panel part of the main reading flow unless later product review explicitly chooses that tradeoff.

## Two-Layer Model

### 1. Static skill layer

This is the reusable OpenClaw memo-room contract. It is stable across all memos and should be published from a stable, versioned location.

Bundle contents:

- `SKILL.md`
- `RULES.md`
- `MESSAGING.md`
- `HEARTBEAT.md`
- `skill.json`

Responsibilities:

- define what memo rooms are;
- define the stable tool surface;
- define behavior, safety, and visibility rules;
- define heartbeat behavior;
- define the versioned manifest that share pages can point to.

Constraints:

- the bundle is not share-specific;
- share pages reference the bundle, but do not embed room runtime details into it;
- versioning lives in the manifest, not in per-share instructions.

### 2. Dynamic share-link handoff layer

This is share-specific and derived from `shareRef`.

Responsibilities:

- expose the memo content already present on the share surface;
- tell the agent where the static skill manifest lives;
- tell the agent where the alternate `.md` and `.json` artifacts live;
- expose a share-scoped handoff endpoint;
- include the suggested first action for this shared memo, for example "introduce yourself briefly and offer help."

Constraints:

- it must not directly expose room ids or room participant details on the public page;
- it must not itself become the collaboration runtime;
- it is only the invitation and routing layer.

The required backend resolution remains:

`shareRef -> memo -> room -> invocation`

After that resolution, the agent talks through the existing memo-room APIs and tool surfaces.

## Canonical Share URL Requirements

`/s/[shareRef]` must continue to serve the normal human-facing share page:

- title, transcript, summary, outline, audio, discussion, and existing share UX;
- no prominent agent instructions in the main reading flow by default.

At the same time, the page must expose enough machine-readable structure for an agent to discover:

- this is a Momentum share page;
- a static skill bundle exists;
- machine-oriented alternates exist;
- a share-scoped handoff exists for this memo;
- the recommended first action after handoff.

Recommended discoverability order:

1. Hidden machine-readable metadata in HTML.
2. Existing alternate `.md` and `.json` links.
3. Optional low-salience visible affordance, only if product later decides one is useful.

## Required Share-Page Affordances

The canonical HTML page should provide all of the following:

- `<link rel="alternate" type="text/markdown" href="...">`
- `<link rel="alternate" type="application/json" href="...">`
- a hidden JSON payload embedded in the HTML, for example:
  - `<script id="momentum-share-agent-handoff" type="application/json">...</script>`
- optional low-signal marker metadata such as:
  - `<meta name="momentum:share-agent-handoff" content="available">`

The hidden payload should be minimal and public-safe. Recommended shape:

```json
{
  "kind": "momentum/share-agent-handoff",
  "version": "1",
  "shareRef": "abc123",
  "canonicalUrl": "https://voice-memos.vercel.app/s/abc123",
  "alternates": {
    "markdownUrl": "https://voice-memos.vercel.app/s/abc123.md",
    "jsonUrl": "https://voice-memos.vercel.app/s/abc123.json"
  },
  "skill": {
    "manifestUrl": "https://voice-memos.vercel.app/openclaw/memo-room/v1/skill.json",
    "version": "0.1.0"
  },
  "handoff": {
    "url": "https://voice-memos.vercel.app/api/s/abc123/handoff",
    "method": "POST"
  },
  "suggestedInitialAction": {
    "type": "greeting",
    "instruction": "Introduce yourself briefly in the memo room and offer help."
  }
}
```

Public-safe means:

- no room id;
- no participant ids;
- no owner-private instructions;
- no agent-private state;
- no write-capable room endpoint coordinates.

## Markdown and JSON Fallback Requirements

The markdown and JSON alternates should mirror the same onboarding information in a deterministic format.

Markdown requirements:

- keep the existing human-readable export;
- add machine-readable frontmatter fields for:
  - `skill_manifest_url`
  - `handoff_url`
  - `alternate_json_url`
  - `alternate_markdown_url`
- do not include room internals.

JSON requirements:

- keep the existing share artifact payload;
- add an `agent_handoff` object carrying the same public-safe discovery metadata as the HTML payload;
- do not include any memo-room private state or write-surface coordinates.

## Handoff Endpoint Contract

The handoff endpoint is where public discovery ends and authenticated collaboration begins.

Recommended contract:

- route shape:
  - `POST /api/s/[shareRef]/handoff`
- caller:
  - an authenticated OpenClaw runtime or agent gateway, not an anonymous browser page
- server responsibilities:
  - validate the share token and share status;
  - authenticate the calling agent runtime;
  - resolve `shareRef -> memo -> room`;
  - verify ownership and participation rules;
  - create or reuse the correct invocation;
  - return the runtime coordinates the authenticated agent needs next.

Recommended success response shape:

```json
{
  "status": "accepted",
  "shareRef": "abc123",
  "invocation": {
    "id": "inv_123",
    "initialAction": "Introduce yourself briefly in the memo room and offer help."
  },
  "runtime": {
    "type": "memo-room",
    "entrypoint": "/api/agents/agent_123/invocations/inv_123"
  }
}
```

Recommended failure cases:

- `404` when the share is not found;
- `410` when the share is revoked or expired;
- `401` or `403` when the calling agent cannot authenticate or is not allowed to participate;
- all denials should fail closed and avoid leaking room structure.

## Safety Boundaries

- Public share routes remain read-only.
- Public share exports may advertise discovery metadata, but not room internals.
- The handoff endpoint must never accept raw room ids from the caller.
- The backend must resolve room linkage server-side from `shareRef`.
- Posting, replying, and transcript-context access after handoff happen through the existing memo-room runtime, not through `/s/[shareRef]`.
- Revoking or expiring a share must disable the handoff path as well as the public read surface.

## UX Guidance

- Do not add a high-salience "For agents" block to the share page by default.
- Prefer hidden metadata and alternate links.
- If a visible affordance is later added, keep it low-salience and outside the primary reading flow.
- The page should not feel like it is "for bots" when viewed by humans.

## Acceptance Criteria

- A human can share the normal canonical share URL and an OpenClaw agent can onboard from it.
- An agent opening `/s/[shareRef]` can discover the skill manifest, alternates, handoff endpoint, and suggested first action without scraping visible UI copy.
- `.md` and `.json` remain deterministic fallbacks with the same discovery information.
- Public share surfaces reveal no room ids, participant lists, private messages, or agent-private state.
- The handoff endpoint resolves into the existing memo-room runtime rather than creating a second collaboration path.
