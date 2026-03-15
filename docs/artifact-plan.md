I’m verifying whether you currently have two distinct chunking systems, and whether the transcript-side chunking is actually shaped for summarization rather than just upload reliability.

No, not exactly. You currently have two different chunking systems, and only one of them is relevant to summarization.

Short answer
Audio chunking: yes, this is the upload-reliability system you’re talking about.
Transcript chunking: yes, this also now exists separately for summaries/artifacts.
But: the current transcript chunking is only a baseline, not yet the chunking I’d ultimately want for high-quality summaries, outlines, and titles.
The distinction
1. Audio chunking for transport/reliability
This is the old “don’t upload one giant audio blob” path. It batches recorded audio blobs and uploads them to storage during capture:


useChunkUpload.ts
Lines 106-174
const uploadChunkRange = async (startIndex: number, endIndex: number) => {
    // ...
    const blobParts =
        startIndex === 0 && webmHeaderSourceRef.current.current
            ? [webmHeaderSourceRef.current.current, ...chunkBatch]
            : chunkBatch;
    const file = new Blob(blobParts, { type: mimeTypeSourceRef.current.current });
    const formData = new FormData();
    formData.append("memoId", nextMemoId);
    formData.append("startIndex", String(startIndex));
    formData.append("endIndex", String(endIndex));
    formData.append("file", file, `${String(startIndex).padStart(7, "0")}-${String(endIndex).padStart(7, "0")}.webm`);
    const response = await fetch("/api/transcribe/upload-chunks", {
        method: "POST",
        body: formData,
    });
}
And later finalize stitches those uploaded audio files back together:


route.ts
Lines 141-169
const chunkBatches = (listedChunks ?? [])
    .map((entry) => parseChunkBatch(entry.name))
    .filter((entry): entry is ChunkBatch => entry !== null)
    .sort((left, right) => left.startIndex - right.startIndex);
const continuityError = validateChunkContinuity(chunkBatches, totalChunks);
const buffers: Buffer[] = [];
const chunkPaths = chunkBatches.map((batch) => `${chunkPrefix}/${batch.name}`);
for (const chunkPath of chunkPaths) {
    const { data, error } = await storage.download(chunkPath);
    // ...
    buffers.push(Buffer.from(await data.arrayBuffer()));
}
const audioBuffer = Buffer.concat(buffers);
That chunking is not your summarization/indexing chunking. It is purely transport/storage resilience.

2. Transcript chunking for summaries/artifacts
This is separate. After transcript segments exist, the app compacts adjacent transcript segments into memo_transcript_chunks using token thresholds:


memo-chunks.ts
Lines 41-100
function buildChunkRows(
    memoId: string,
    userId: string,
    source: MemoChunkSource,
    segments: SegmentRow[],
): ChunkRow[] {
    const rows: ChunkRow[] = [];
    // ...
    for (const segment of segments) {
        const normalizedText = segment.text.trim();
        if (!normalizedText) continue;
        const nextTokens = estimateTokenCount(normalizedText);
        const wouldExceedTarget =
            currentSegments.length > 0 &&
            currentTokens + nextTokens > CHUNK_TARGET_TOKENS;
        const wouldExceedMax =
            currentSegments.length > 0 &&
            currentTokens + nextTokens > CHUNK_MAX_TOKENS;
        if (wouldExceedTarget || wouldExceedMax) {
            flush();
        }
        currentSegments.push(segment);
        currentParts.push(normalizedText);
        currentTokens += nextTokens;
    }
    flush();
    return rows;
}
The thresholds are explicit:


memo-chunks.ts
Lines 3-4
export const CHUNK_TARGET_TOKENS = 800;
export const CHUNK_MAX_TOKENS = 1200;
So yes: there is now a real transcript-chunk layer for summarization/artifacts. It is not the same as audio upload chunking.

The important nuance
The answer to your real question is:

The code does have transcript chunking for summarization purposes now, but I would not say it is yet the ideal chunking strategy for the product you want.

Why it’s only a baseline
Good parts
The current transcript chunking is directionally right because it:

chunks text, not audio blobs
uses a token budget
preserves timestamp provenance via segment ranges
persists chunks durably in memo_transcript_chunks
supports both live and final
That is the correct substrate.

Weak parts
But it’s still pretty primitive.

1. Live source segments are coarse
Your live persisted segments are not true ASR semantic segments. They are recorder-window locks based on 15 one-second chunks:


live-segments.ts
Lines 1-2
export const RECORDER_TIMESLICE_MS = 1000;
export const LIVE_LOCKED_SEGMENT_CHUNK_COUNT = 15;

live-segments.ts
Lines 21-28
return {
    memo_id: memoId,
    user_id: userId,
    segment_index: Math.floor(segment.startIndex / LIVE_LOCKED_SEGMENT_CHUNK_COUNT),
    start_ms: segment.startIndex * RECORDER_TIMESLICE_MS,
    end_ms: segment.endIndex * RECORDER_TIMESLICE_MS,
    text: segment.text.trim(),
    source: "live" as const,
};
So on the live path, a “segment” is basically a locked transcription window, not a sentence-aware or topic-aware unit. That’s workable, but not ideal for high-quality outline generation.

2. Chunking is size-based only
Current chunk compaction is basically:

append segments until token threshold
flush
repeat
There is:

no overlap
no sentence-boundary logic
no speaker/topic boundary logic
no special handling for abrupt topic transitions
That is fine for a first summary pass, but weak for TOC/outline quality.

3. The summary path is not hierarchical yet
Right now the rolling summary combines chunk texts and summarizes them directly:


memo-artifacts.ts
Lines 52-57
const combinedText = chunks
    .map((chunk) => chunk.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 12000);
That is not the “long transcript beyond context window” architecture you originally wanted. It is still basically:

gather chunks
flatten them
summarize a capped prefix
So it’s chunk-aware, but not yet truly hierarchical.

4. No chunk overlap
For retrieval and summarization robustness, overlap is often useful. Current chunking has none. That means important transitions can land right at chunk edges and lose context.

My verdict
So if your question is:

“Do we currently have the summarization-oriented chunking we actually want?”

My answer is:

Partially, but not really.

More precisely:

You do now have a distinct transcript chunk layer meant for summaries/artifacts.
You do not yet have the more deliberate chunking strategy I’d want for:
live table of contents
section/topic extraction
title generation
semantic retrieval over long memos
What I would call the current state
I’d classify it like this:

Audio chunking: correct for its job
Transcript chunking: real and useful
Transcript chunking quality: acceptable v1, not final architecture
What I would want instead
For your actual product goals, I’d want transcript chunking to evolve toward:

Stable low-level transcript units:
final ASR segments
live locked windows only as provisional units
Derived analysis chunks:
600-1200 token windows
slight overlap
preserve source segment ranges
Higher-level sectioning:
group chunks into section candidates
generate outline from section candidates
Hierarchical summaries:
chunk summaries
section summaries
memo summary
Title generation from reduced summaries, not raw transcript prefix
That would make the chunking actually aligned with the artifact product.

Decisive conclusion
You were right to question this.

The current codebase does not only have upload chunking anymore. It also has transcript chunking for summarization/artifacts.

But the current transcript chunking is still a simple compaction layer, not yet the high-quality chunking strategy you actually want for long-context memo intelligence.

Maintainability reflection
The good news is the system is evolving along the right seam: transcript truth in memo_transcript_segments, derived text chunks in memo_transcript_chunks, and artifacts on top. That separation is solid and scalable. It means you do not need to rip out the architecture to improve chunk quality later. The current implementation is not wasted work.

The weakness is that the chunker is still too generic for the product ambitions. Size-only chunking is cheap and easy to reason about, but it won’t be the long-term best layer for outlines, titles, and section-level navigation. The next improvement should be to keep the existing persistence model but upgrade the chunk-building logic: better boundaries, optional overlap, and explicit section-building on top rather than assuming token buckets alone are enough.

can you give me the sstep by step plan to do the artifact production from here

Yes. The right move now is not to add more artifact types immediately. The right move is to finish one complete artifact vertical slice end to end, prove it works live and final, then extend the same pipeline to the rest.

My recommendation: build outline next, and use that work to harden the whole artifact system. Once outline is solid, title, key_topics, and action_items become straightforward.

Recommended order
Harden job execution so artifact generation is reliable.
Add artifact read APIs.
Implement outline generation for live and final.
Render the outline in the recorder UI and share page.
Upgrade title generation to consume artifact outputs.
Add key_topics and action_items.
Add optional embeddings/retrieval later.
Step-by-step plan
1. Freeze the invariants first
Before touching more code, lock these rules in your head and in tests:

memo_transcript_segments is the source of truth.
memo_transcript_chunks is a derived analysis layer.
memo_artifacts is a derived presentation/intelligence layer.
live artifacts are provisional.
final artifacts are canonical.
memos.transcript remains a fallback projection, not the analysis substrate.
If you do not hold those lines, the codebase will drift back toward transcript-blob hacks.

2. Fix job execution reliability first
Right now artifact generation can silently degrade if the RPC path is missing or if pending jobs are not picked up promptly. Do not build more artifact features on top of that.

The concrete goal for this phase:

Every live segment persist should deterministically lead to:
chunk compaction
then artifact refresh
Every finalization should deterministically lead to:
final chunk compaction
final artifact generation
live artifact superseding
You want one dependable execution model:

either run jobs inline after enqueue
or run them via a dedicated worker/poller
but do not leave the current half-inline, half-deferred ambiguity
Acceptance criteria:

no silent skip when artifact generation is expected
idempotent reruns
one running job per memo/job type
clear logs for queued, started, succeeded, failed
3. Add a proper artifact read layer
Do this before adding more generation types.

Right now artifacts mostly exist in storage, not in product APIs. Add one clean read path that can answer:

give me current live artifacts for memo X
give me current final artifacts for memo X
fall back sanely if missing
A clean shape is:

GET /api/memos/:id/artifacts?source=live
GET /api/memos/:id/artifacts?source=final
optionally GET /api/memos/:id/artifacts/current with resolution rules
Return normalized payloads, not raw rows only. The UI should not need to understand artifact supersession or query rules.

Acceptance criteria:

recorder UI can fetch live artifacts
memo detail/share page can fetch final artifacts
missing artifact types return predictable empty state
4. Implement outline as the next artifact type
This should be the first serious artifact after rolling summary.

Why outline first:

it gives visible product value
it exercises timestamp provenance
it forces chunk-to-section thinking
it becomes the base for titles and navigation
The first version should be simple:

input: ready chunks for a memo/source
output: ordered outline items
each item includes:
title
summary
start_ms
end_ms
chunk_start
chunk_end
Do not overcomplicate V1 with embeddings or clustering. Build a prompt that turns chunk groups into 3-8 sections with timestamps grounded in chunk ranges.

Artifact payload example:

{
  "items": [
    {
      "title": "Opening context and framing",
      "summary": "The speaker sets up the topic and explains the purpose of the memo.",
      "startMs": 0,
      "endMs": 128000,
      "chunkStart": 0,
      "chunkEnd": 1
    }
  ]
}
Acceptance criteria:

one current ready outline per memo/source
every outline item points back to chunk ranges
no outline item exists without provenance
5. Make live outline incremental, not fully rebuilt every tick
Do not regenerate the whole world every 1.5 seconds.

Use thresholds based on new locked chunks, not raw time:

first outline build after 1-2 live chunks
rebuild only after at least 1-2 new chunks beyond the last artifact boundary
supersede prior live outline when a newer one is ready
This keeps cost bounded and prevents artifact thrash.

You already do something similar for rolling summary with based_on_chunk_end. Reuse that exact pattern for outline.

Acceptance criteria:

live outline updates periodically during recording
no rebuild spam on every tail refresh
artifact state advances monotonically
6. Surface artifacts in the recorder UI
Once outline exists in storage and is readable, put it in the live UI.

Best place:

next to the live transcript/debug area
a compact “Conversation Outline” panel
click on an item to jump transcript/audio position when possible
Display rules:

if live outline exists, show it
else if rolling summary exists, show that
else show “Listening for structure…”
Do not try to show 5 artifact types at once. One strong artifact panel beats an overloaded inspector.

Acceptance criteria:

during a live recording, the outline visibly grows
items appear in order
empty and loading states feel intentional
7. Surface artifacts on the share page
After the live UI works, make the share page artifact-aware.

Current share page is transcript-first. Change it so it can render:

live rolling summary
live outline
final rolling summary
final outline
Recommended priority:

summary at top
outline below it
transcript below that
This is where the feature starts feeling real to users.

Acceptance criteria:

share page reads artifact APIs or artifact-backed payloads
live shares refresh and show updated outline/summary
final shares show canonical final artifacts
8. Migrate title generation off the old transcript-prefix path
Do this only after outline and rolling_summary are stable.

Current title generation still uses:

raw transcript
first 3000 chars
That is the old world and should be retired.

New title inputs should be:

final outline
final rolling summary
maybe top chunk summaries later
Then write:

title_candidates
title
update memos.title from the canonical final title artifact
This keeps memo title as a projection, not the generation source.

Acceptance criteria:

title generation no longer depends on transcript.slice(0, 3000)
title can be regenerated from stored artifacts
live title remains optional; final title is canonical
9. Add key_topics and action_items
Once outline is working, these are much easier.

Recommended order:

key_topics
action_items
Why:

key_topics is structurally close to outline
action_items needs stronger extraction discipline and often benefits from better prompts
Keep payloads explicit. Do not bury semantics in freeform text blobs.

Example:

key_topics.payload = { topics: [{ label, confidence, chunkStart, chunkEnd }] }
action_items.payload = { items: [{ text, owner, dueHint, chunkStart, chunkEnd }] }
10. Only then consider embeddings and retrieval
This is valuable, but not the next step.

Do embeddings after:

chunks are reliable
outline is working
title is artifact-driven
summary reads are live in UI
Otherwise you will build retrieval on shifting foundations.

When you do add embeddings:

embed memo_transcript_chunks
optionally embed outline and rolling_summary
do hybrid search later, not first
Concrete implementation phases
Phase 1: Reliability and reads
Harden job_runs execution
Add artifact read API
Add tests for enqueue -> generate -> read
Phase 2: Outline artifact
Add outline generation module
Add live/final outline generation flow
Persist with based_on_chunk_start/end
Add tests
Phase 3: UI integration
Render live outline in recorder
Render final/live artifacts on share page
Add loading/empty states
Phase 4: Title migration
Generate title_candidates and canonical title
Update memos.title from final artifact
Remove dependency on raw transcript prefix
Phase 5: Additional artifacts
key_topics
action_items
Phase 6: Retrieval
embeddings
hybrid search
artifact-aware querying
What I would do first, specifically
If you want the most leveraged next task, it is this:

Implement outline as a fully wired artifact vertical slice and make it visible live.

Not title. Not embeddings. Not action items.

outline will force you to solve:

chunk provenance
artifact lifecycle
live refresh cadence
read APIs
share/live rendering
Once that works, the rest of the artifact system stops being theoretical.

Definition of done for “artifact production”
I would not call this done until all of these are true:

live locked segments persist
live chunks compact reliably
live artifacts are generated reliably
artifacts are readable through stable APIs
recorder UI shows live artifacts
share page shows live/final artifacts
finalization upgrades live -> final artifacts
title generation consumes artifact outputs
failures are visible and retryable
Right now you are only partway through that list.

Decisive recommendation
Do not branch into five artifact types now. Finish one vertical slice.

The best next slice is:

job reliability
artifact read API
outline generation
live/share rendering
final title migration
That is the fastest path from “promising backend scaffolding” to “real artifact product.”

The maintainability upside of this plan is that it preserves the good architecture already emerging in the codebase: transcript truth, chunk derivation, artifact derivation, and projection into UI. It avoids redundancy because every later feature reuses the same chunk and artifact lifecycle rather than inventing a parallel prompt path. The main risk is trying to accelerate by adding more artifact enums before the read/write/job loop is stable. That would create the illusion of progress while increasing surface area and debugging cost.

Wait, so you don't think we should improve the chunking right now?

Not as the main thing, no.

I would not pause artifact production to do a big chunking redesign right now. That would be the wrong priority. The bigger problem today is not “your chunk boundaries are slightly suboptimal.” The bigger problem is that the system still doesn’t fully consume artifacts end to end, and the current summary path still flattens chunk text into one capped prompt.

This is the more urgent limitation:


memo-artifacts.ts
Lines 52-57
const combinedText = chunks
    .map((chunk) => chunk.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 12000);
That means even with persisted chunks, the system is still doing a semi-monolithic summary step. So if I had to choose where engineering time goes next, I would spend it on:

reliable artifact execution
outline generation
artifact read/rendering
hierarchical artifact production
before I spend it on a sophisticated chunker.

The decisive answer
No to a full chunking rethink right now.
Yes to a few targeted chunking improvements if they are cheap and unblock better artifacts.
What I would improve now
Only these bounded changes:

Split live and final chunking policy.
Live chunks can stay coarser and cheaper.
Final chunks can be a bit more deliberate.
Stop using “all chunks flattened into one prompt” for artifact generation.
This matters more than boundary tuning.
Add tests for chunk boundary quality.
especially topic shifts
short memos
very long memos
abrupt transitions
Preserve provenance cleanly.
which you mostly already do
What I would not do now
I would not spend this cycle on:

semantic/topic-aware chunking
overlap tuning experiments
speaker-aware chunking
fancy clustering before outline exists
embedding-driven chunk architecture
That is premature. You would be optimizing in the dark.

Why
Because current chunking is already “good enough” for a first real artifact slice.

You already have:

transcript segments
token-bounded transcript chunks
source separation (live vs final)
chunk provenance
That is enough to build outline V1 and see where chunking actually breaks down. Once you have a live outline and final outline in front of you, the weaknesses will be obvious and concrete instead of theoretical.

The real sequencing
The correct order is:

Use current chunking to ship one real artifact vertical slice.
Observe where outputs are weak.
Then improve chunking based on actual failure modes.
That is much better than trying to perfect chunking first.

One important exception
If you want one chunking-related change immediately, this is the one I’d do first:

Make artifact generation hierarchical instead of flattening all ready chunks into one prompt.

That is not a chunk-storage redesign, but it solves the long-context problem much more directly than fiddling with chunk boundaries.

So bluntly:

improving chunk boundaries right now: nice to have
fixing artifact generation flow so it actually respects chunking: must do now
Maintainability reflection
The architecture is already at the point where chunking can evolve without forcing a rewrite, which is a good sign. You have the right separation between segments, chunks, and artifacts. That means you do not need to “get chunking perfect” before moving forward. If you stop now to over-design the chunker, you’ll likely introduce complexity before you’ve proven which artifact outputs actually matter.

The better long-term strategy is to keep the current chunk model as a stable V1 substrate, finish one artifact slice, and then revise chunking using observed artifact failures as the guide. That avoids speculative complexity and keeps the system honest. The only chunk-related improvement that deserves priority now is making downstream artifact generation truly chunk-aware and hierarchical, because that directly addresses the core product goal.

What's this priority compared to the below plan?



Yes. The right move now is not to add more artifact types immediately. The right move is to finish one complete artifact vertical slice end to end, prove it works live and final, then extend the same pipeline to the rest.



My recommendation: build outline next, and use that work to harden the whole artifact system. Once outline is solid, title, key_topics, and action_items become straightforward.



Recommended order

Harden job execution so artifact generation is reliable.

Add artifact read APIs.

Implement outline generation for live and final.

Render the outline in the recorder UI and share page.

Upgrade title generation to consume artifact outputs.

Add key_topics and action_items.

Add optional embeddings/retrieval later.

Step-by-step plan

1. Freeze the invariants first

Before touching more code, lock these rules in your head and in tests:



memo_transcript_segments is the source of truth.

memo_transcript_chunks is a derived analysis layer.

memo_artifacts is a derived presentation/intelligence layer.

live artifacts are provisional.

final artifacts are canonical.

memos.transcript remains a fallback projection, not the analysis substrate.

If you do not hold those lines, the codebase will drift back toward transcript-blob hacks.



2. Fix job execution reliability first

Right now artifact generation can silently degrade if the RPC path is missing or if pending jobs are not picked up promptly. Do not build more artifact features on top of that.



The concrete goal for this phase:



Every live segment persist should deterministically lead to:

chunk compaction

then artifact refresh

Every finalization should deterministically lead to:

final chunk compaction

final artifact generation

live artifact superseding

You want one dependable execution model:



either run jobs inline after enqueue

or run them via a dedicated worker/poller

but do not leave the current half-inline, half-deferred ambiguity

Acceptance criteria:



no silent skip when artifact generation is expected

idempotent reruns

one running job per memo/job type

clear logs for queued, started, succeeded, failed

3. Add a proper artifact read layer

Do this before adding more generation types.



Right now artifacts mostly exist in storage, not in product APIs. Add one clean read path that can answer:



give me current live artifacts for memo X

give me current final artifacts for memo X

fall back sanely if missing

A clean shape is:



GET /api/memos/:id/artifacts?source=live

GET /api/memos/:id/artifacts?source=final

optionally GET /api/memos/:id/artifacts/current with resolution rules

Return normalized payloads, not raw rows only. The UI should not need to understand artifact supersession or query rules.



Acceptance criteria:



recorder UI can fetch live artifacts

memo detail/share page can fetch final artifacts

missing artifact types return predictable empty state

4. Implement outline as the next artifact type

This should be the first serious artifact after rolling summary.



Why outline first:



it gives visible product value

it exercises timestamp provenance

it forces chunk-to-section thinking

it becomes the base for titles and navigation

The first version should be simple:



input: ready chunks for a memo/source

output: ordered outline items

each item includes:

title

summary

start_ms

end_ms

chunk_start

chunk_end

Do not overcomplicate V1 with embeddings or clustering. Build a prompt that turns chunk groups into 3-8 sections with timestamps grounded in chunk ranges.



Artifact payload example:



{

  "items": [

    {

      "title": "Opening context and framing",

      "summary": "The speaker sets up the topic and explains the purpose of the memo.",

      "startMs": 0,

      "endMs": 128000,

      "chunkStart": 0,

      "chunkEnd": 1

    }

  ]

}

Acceptance criteria:



one current ready outline per memo/source

every outline item points back to chunk ranges

no outline item exists without provenance

5. Make live outline incremental, not fully rebuilt every tick

Do not regenerate the whole world every 1.5 seconds.



Use thresholds based on new locked chunks, not raw time:



first outline build after 1-2 live chunks

rebuild only after at least 1-2 new chunks beyond the last artifact boundary

supersede prior live outline when a newer one is ready

This keeps cost bounded and prevents artifact thrash.



You already do something similar for rolling summary with based_on_chunk_end. Reuse that exact pattern for outline.



Acceptance criteria:



live outline updates periodically during recording

no rebuild spam on every tail refresh

artifact state advances monotonically

6. Surface artifacts in the recorder UI

Once outline exists in storage and is readable, put it in the live UI.



Best place:



next to the live transcript/debug area

a compact “Conversation Outline” panel

click on an item to jump transcript/audio position when possible

Display rules:



if live outline exists, show it

else if rolling summary exists, show that

else show “Listening for structure…”

Do not try to show 5 artifact types at once. One strong artifact panel beats an overloaded inspector.



Acceptance criteria:



during a live recording, the outline visibly grows

items appear in order

empty and loading states feel intentional

7. Surface artifacts on the share page

After the live UI works, make the share page artifact-aware.



Current share page is transcript-first. Change it so it can render:



live rolling summary

live outline

final rolling summary

final outline

Recommended priority:



summary at top

outline below it

transcript below that

This is where the feature starts feeling real to users.



Acceptance criteria:



share page reads artifact APIs or artifact-backed payloads

live shares refresh and show updated outline/summary

final shares show canonical final artifacts

8. Migrate title generation off the old transcript-prefix path

Do this only after outline and rolling_summary are stable.



Current title generation still uses:



raw transcript

first 3000 chars

That is the old world and should be retired.



New title inputs should be:



final outline

final rolling summary

maybe top chunk summaries later

Then write:



title_candidates

title

update memos.title from the canonical final title artifact

This keeps memo title as a projection, not the generation source.



Acceptance criteria:



title generation no longer depends on transcript.slice(0, 3000)

title can be regenerated from stored artifacts

live title remains optional; final title is canonical

9. Add key_topics and action_items

Once outline is working, these are much easier.



Recommended order:



key_topics

action_items

Why:



key_topics is structurally close to outline

action_items needs stronger extraction discipline and often benefits from better prompts

Keep payloads explicit. Do not bury semantics in freeform text blobs.



Example:



key_topics.payload = { topics: [{ label, confidence, chunkStart, chunkEnd }] }

action_items.payload = { items: [{ text, owner, dueHint, chunkStart, chunkEnd }] }

10. Only then consider embeddings and retrieval

This is valuable, but not the next step.



Do embeddings after:



chunks are reliable

outline is working

title is artifact-driven

summary reads are live in UI

Otherwise you will build retrieval on shifting foundations.



When you do add embeddings:



embed memo_transcript_chunks

optionally embed outline and rolling_summary

do hybrid search later, not first

Concrete implementation phases

Phase 1: Reliability and reads

Harden job_runs execution

Add artifact read API

Add tests for enqueue -> generate -> read

Phase 2: Outline artifact

Add outline generation module

Add live/final outline generation flow

Persist with based_on_chunk_start/end

Add tests

Phase 3: UI integration

Render live outline in recorder

Render final/live artifacts on share page

Add loading/empty states

Phase 4: Title migration

Generate title_candidates and canonical title

Update memos.title from final artifact

Remove dependency on raw transcript prefix

Phase 5: Additional artifacts

key_topics

action_items

Phase 6: Retrieval

embeddings

hybrid search

artifact-aware querying

What I would do first, specifically

If you want the most leveraged next task, it is this:



Implement outline as a fully wired artifact vertical slice and make it visible live.



Not title. Not embeddings. Not action items.



outline will force you to solve:



chunk provenance

artifact lifecycle

live refresh cadence

read APIs

share/live rendering

Once that works, the rest of the artifact system stops being theoretical.



Definition of done for “artifact production”

I would not call this done until all of these are true:



live locked segments persist

live chunks compact reliably

live artifacts are generated reliably

artifacts are readable through stable APIs

recorder UI shows live artifacts

share page shows live/final artifacts

finalization upgrades live -> final artifacts

title generation consumes artifact outputs

failures are visible and retryable

Right now you are only partway through that list.



Decisive recommendation

Do not branch into five artifact types now. Finish one vertical slice.



The best next slice is:



job reliability

artifact read API

outline generation

live/share rendering

final title migration

That is the fastest path from “promising backend scaffolding” to “real artifact product.”



The maintainability upside of this plan is that it preserves the good architecture already emerging in the codebase: transcript truth, chunk derivation, artifact derivation, and projection into UI. It avoids redundancy because every later feature reuses the same chunk and artifact lifecycle rather than inventing a parallel prompt path. The main risk is trying to accelerate by adding more artifact enums before the read/write/job loop is stable. That would create the illusion of progress while increasing surface area and debugging cost.

Compared to that plan, chunking improvement is lower priority than the first 4-5 items, but higher priority than embeddings and probably higher than polishing secondary artifact types.

So if I rank it honestly:

Priority order
Job execution reliability
Artifact read API
One complete outline vertical slice
Live/share rendering of artifacts
Stop artifact generation from flattening all chunks into one capped prompt
Title migration onto artifact outputs
Chunking quality improvements
key_topics / action_items
Embeddings / retrieval
That is the order I’d use.

Why chunking is not first
Because your current biggest risk is not “the chunk boundaries are imperfect.” It’s that the artifact system still doesn’t have a fully reliable and visible end-to-end path.

Right now:

artifacts can degrade due to job execution issues
artifacts are not yet a first-class read surface
outline is not yet implemented as a visible product feature
summary generation still partly defeats the chunk model by flattening chunk text
That means if you stop now to redesign chunking, you’ll be optimizing a pipeline that still is not fully closed.

But chunking is not trivial either
Where I would revise the earlier framing is this:

I would not treat chunking as “ignore until much later.” I would treat it as a mid-priority systems improvement, but after you harden the artifact loop and before you go wide on many more artifact types.

So compared to the plan you pasted:

chunking redesign is below

job reliability
read APIs
outline V1
basic UI rendering
chunking redesign is above or intertwined with

title sophistication
key topics
action items
embeddings
The key distinction
There are really two different chunking concerns:

1. Chunk persistence architecture
This is already good enough. You have:

memo_transcript_segments
memo_transcript_chunks
source = live | final
provenance fields
I would not redesign this now.

2. Chunk-building and chunk-consumption quality
This does deserve attention soon.

Specifically:

size-only chunk building
no overlap
coarse live segment boundaries
artifact generation still flattening chunks into one prompt
That part is not ideal.

What I’d insert into your plan
I would modify your plan slightly, not replace it.

Revised phases
Phase 1: Reliability and reads
Harden job_runs execution
Add artifact read API
Add tests for enqueue -> generate -> read
Phase 2: Outline V1
Add outline generation module
Add live/final outline generation flow
Persist with based_on_chunk_start/end
Add tests
Phase 3: UI integration
Render live outline in recorder
Render final/live artifacts on share page
Add loading/empty states
Phase 4: Chunk-consumption upgrade
Stop flattening all ready chunks into one capped prompt
Make summary/outline generation hierarchical or batched
Add chunk-boundary tests around topic shifts and long memos
Optionally add light overlap for final chunks only
Phase 5: Title migration
Generate title_candidates and canonical title
Update memos.title from final artifact
Remove dependency on raw transcript prefix
Phase 6: Additional artifacts
key_topics
action_items
Phase 7: Retrieval
embeddings
hybrid search
artifact-aware querying
That is the plan I actually believe in.

If you want the blunt version
Your pasted plan is mostly right, but it is missing one important thing:

before you go broad on more artifact types, you should upgrade how artifacts consume chunks.

Because right now this is still too crude:


memo-artifacts.ts
Lines 52-57
const combinedText = chunks
    .map((chunk) => chunk.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 12000);
That is the first place where chunking quality actually matters operationally.

So the blunt answer is:

No, I would not move chunking above reliability/read APIs/outline V1.
Yes, I would move chunk-aware artifact generation above title migration and definitely above embeddings.
Yes, I would probably improve chunk consumption before adding key_topics and action_items.
My final recommendation
If I were running this project, I would do:

Fix the artifact execution loop.
Add artifact reads.
Ship live/final outline.
Render it in product.
Then immediately improve the chunk-to-artifact generation path.
Then migrate title generation.
Then expand artifact types.
That is the best balance between shipping something visible and not building more intelligence on a weak chunk-consumption layer.

Maintainability reflection
This sequencing matters because there are two kinds of debt here. One is architectural debt, which you are mostly avoiding by keeping segments, chunks, and artifacts separate. The other is pipeline debt, where the storage model looks sophisticated but the generation logic still collapses back into monolithic prompt behavior. That second form of debt is more dangerous right now. It makes the system look more mature than it is. The right move is to first prove the artifact loop end to end with one visible artifact, then harden the chunk-consumption path before multiplying artifact types.

That gives you the best long-term payoff with the least fake progress.