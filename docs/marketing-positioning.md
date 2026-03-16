# Marketing & Positioning

Use this doc for messaging, landing copy, and segment-specific marketing. It summarizes what the product does better than alternatives, the strategic directions we’re considering, and the audience segments that get the most value.

---

## What we do better (differentiators)

These are concrete strengths to lead with in positioning and marketing.

| Strength | What it means | Why it matters |
|--------|----------------|----------------|
| **One link, three formats** | Same share URL gives HTML (human), `.md` (markdown for AI/agents), and `.json` (for APIs). Canonical URL + path/query for format. | Recipients and systems get the format they need without extra steps. Few tools offer machine-readable export from the same link. |
| **Live share while recording** | Share link works during recording; share page auto-refreshes so recipients see transcript (and audio when done) updating. | “Share standup as it happens” or “someone can follow live.” Most products only allow sharing after the recording is finished. |
| **Very long recordings** | Chunked upload during recording, finalize at stop → 4–6 hour sessions without timeouts or body limits. | Web recorders and many APIs cap at ~1–2 hours. We support long meetings, workshops, and sessions. |
| **Timestamped transcript + seek** | Segments have start/end times; share page: click a timestamp to seek playback and highlight that segment. Deep link (e.g. `#t-45000`) jumps to 45s. | Recipients can “play from here” and share exact moments. Many tools show transcript but don’t sync playback or support shareable seek links. |
| **API + docs** | REST API with token auth: list memos (with search), get memo, update, delete, upload & transcribe. Documented in-app. | “Use this as infrastructure.” Fits developers and automation. Otter/Rev are closed; Apple Voice Memos has no API. |
| **Copy + export on share, no login** | Recipients can copy transcript and export as .txt from the shared page without an account. | Friction-free for “send this to someone who just needs the text.” |
| **Search on the share page** | In-page search in the transcript with prev/next and match count. | When you share one long memo, the recipient can find a specific part quickly. |
| **No duplicate full re-transcribe** | When we have a good live transcript, we promote it to final and skip a second full pass. | Faster and cheaper for the user and for us; transcript is ready sooner after stop. |

**Don’t overclaim:** Transcription quality depends on our ASR. “Better transcript” is only a differentiator if we’ve validated it. Our edge is **share model, length, live sharing, timestamps/seek, and API**, not necessarily raw accuracy vs. Otter/Rev.

---

## Strategic directions we’re considering

Three possible next steps; we can pick one and ship it before adding more.

| Direction | Focus | Next step | When to choose |
|-----------|--------|-----------|-----------------|
| **A. Share as growth engine** | Make the share experience and recipient CTA so good that shares drive signups. | Improve what recipients see and the one clear CTA (e.g. “Get your own memo in one tap,” “Listen + see transcript”). | Growth is the priority. |
| **B. One “do something with it” action** | One obvious post-transcript action: e.g. “Copy summary,” “Export as email draft,” or “Extract action items.” | Add one button/flow that uses existing or minimal logic; make it the demo. | Differentiation and “why this instead of recorder + generic AI?” is the priority. |
| **C. Lock transcript trust** | Prove and fix transcript reliability (e.g. missing segments). | One concrete repro, minimal logging, fix root cause, add regression test. | Retention and trust are the priority, or we’ve seen missing-segment issues. |

We should do **one** of these fully before layering in more roadmap (tier limits, full artifact pipeline, observability). Let user feedback guide which one.

---

## Audience segments & marketing angles

Groups that get the most value from our differentiators, and how to talk to them.

### 1. People who need long recordings

**Who:** Researchers, interviewers, workshop facilitators, anyone recording 2–6+ hour sessions.

**What we do better:** No arbitrary cap; chunked upload and finalize-at-stop mean 4–6 hour recordings don’t hit timeouts or body limits.

**Marketing angle:** “Record for hours. No timeouts, no giant uploads. One link to share when you’re done.”

**Channels / use cases:** Long-form interviews, field notes, all-day events, legal/medical long sessions.

---

### 2. People who share with others (and want it friction-free)

**Who:** Anyone who records and then needs to send the transcript or audio to a colleague, client, or team.

**What we do better:** One share link → HTML for reading/listening, copy/export with no login. Live share so the other person can follow while you’re still recording.

**Marketing angle:** “Share one link. They get the transcript and audio. No app install, no sign-up. Optional: share while you’re still recording.”

**Channels / use cases:** Standups, client updates, meeting notes, async updates.

---

### 3. Developers & automation (API / pipelines)

**Who:** Devs building workflows, integrations, or tools that ingest or process voice memos.

**What we do better:** REST API with token auth, docs in-app. Same share URL can return JSON or Markdown for scripts and agents.

**Marketing angle:** “Voice memos as infrastructure. List, get, upload, transcribe. Share link returns HTML, Markdown, or JSON—your choice.”

**Channels / use cases:** Custom dashboards, agent pipelines, Notion/Slack integrations, internal tools.

---

### 4. AI / agent builders

**Who:** Teams or individuals feeding transcripts or structured memos into LLMs, RAG, or other AI systems.

**What we do better:** Share URL with `.md` or `?format=json` gives clean, structured output (transcript, metadata, optional summary/outline in markdown). One canonical URL for humans and agents.

**Marketing angle:** “One link for humans and agents. Markdown and JSON from the same URL. No scraping, no export dance.”

**Channels / use cases:** RAG over personal memos, meeting bots, summarization pipelines, custom AI workflows.

---

### 5. People who need “play from here” and exact references

**Who:** Anyone sharing a long memo where the recipient needs to jump to a specific moment or quote.

**What we do better:** Timestamped segments, click-to-seek on the share page, deep links (e.g. `#t-45000`). Search in transcript on the share page.

**Marketing angle:** “Share a link to the moment. Timestamps that seek the audio. Search the transcript on the page.”

**Channels / use cases:** Feedback on talks, legal/HR references, teaching, support.

---

## How to use this doc

- **Landing / homepage:** Lead with 2–3 differentiators that match your primary segment; add a line per segment (“For long recordings,” “For sharing with your team,” “For developers”).
- **Segment-specific campaigns:** Use the “Marketing angle” and “Channels / use cases” per segment for ad copy, emails, or partner messaging.
- **Roadmap and positioning:** When deciding what to build next, align with one strategic direction (A, B, or C) and the segment you’re going after first.
- **Sales / demos:** Lead with the differentiators table; tell the “one link, three formats” and “live share” story for share-heavy users, and the API/JSON story for technical buyers.
