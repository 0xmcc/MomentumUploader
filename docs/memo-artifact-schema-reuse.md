# Memo Artifact Schema Reuse Guide

This document captures the current recommendation for how the `voice-memos` app should reuse the existing Supabase schema for transcript chunks, live artifacts, summaries, outlines, and related background jobs.

## Status

Accepted for current implementation direction.

## Why This Exists

We already have transcript-specific tables in the `voice-memos` app, but the live database also contains several generic infrastructure tables that look superficially similar to what we need:

- `artifacts`
- `artifact_embeddings`
- `chunks`
- `items`
- `job_runs`
- `memos`
- `memo_transcript_segments`

The goal of this document is to make one thing explicit:

- reuse the tables that actually match memo semantics
- avoid false reuse where a generic table name looks helpful but would hide memo-specific requirements in ad hoc metadata

## Current Confirmed Tables

### Memo-native tables

#### `memos`

This is the canonical top-level record for a memo. Based on the live schema and application code, it already carries:

- `id`
- `title`
- `transcript`
- `audio_url`
- `duration`
- `created_at`
- `stream_session_id`
- `share_token`
- `shared_at`
- `revoked_at`
- `is_shareable`
- `share_expires_at`
- `user_id`
- `transcript_status`

Use `memos` for:

- the memo itself
- current user-facing title
- the plain-text transcript fallback
- top-level memo lifecycle state
- share metadata

Do not turn `memos` into a junk drawer for chunk-level or artifact-level state.

#### `memo_transcript_segments`

This is the strongest existing foundation for transcript processing. It already supports:

- `memo_id`
- `user_id`
- `segment_index`
- `start_ms`
- `end_ms`
- `text`
- `source in ('live', 'final')`

Use `memo_transcript_segments` for:

- persisted transcript timeline
- persisted live segments
- persisted final segments
- timestamp provenance for all downstream features

This should remain the lowest-level source of truth for what was said and when.

## Generic Infrastructure Tables Found In The Live Database

These tables are not represented in the checked-in `supabase/migrations` folder, but they do exist in the live database and were inspected directly.

### `job_runs`

Columns include:

- `id`
- `user_id`
- `job_type`
- `entity_type`
- `entity_id`
- `status`
- `params`
- `result`
- `error`
- `started_at`
- `finished_at`
- `created_at`

This table is a strong match for memo artifact generation jobs.

Good fit for:

- summary generation runs
- outline refresh runs
- title generation runs
- live artifact rebuilds
- final artifact rebuilds

Example usage:

- `job_type = 'memo_outline_build'`
- `job_type = 'memo_summary_refresh'`
- `entity_type = 'memo'`
- `entity_id = <memo uuid>`

It also already has a uniqueness guard for one running job per job/entity combination, which is useful for preventing duplicate concurrent builds.

### `artifact_embeddings`

Columns include:

- `id`
- `user_id`
- `origin_app`
- `artifact_id`
- `embedder`
- `dims`
- `embedding`
- `content_hash`
- `created_at`

This is reusable if memo summaries, outlines, or other memo outputs are represented as first-class artifacts.

Good fit for:

- embeddings for memo summaries
- embeddings for memo outlines
- embeddings for other persisted derived memo artifacts

This is not a direct replacement for transcript chunk storage.

### `artifacts`

Columns include:

- `id`
- `user_id`
- `note_id`
- `interpretation_id`
- `title`
- `type`
- `content`
- `timestamp`
- `share_token`
- `shared_at`
- `revoked_at`
- `updated_at`
- `created_at`
- `origin_app`
- `artifact_type`
- `variant`
- `version`
- `content_hash`
- `metadata`
- `source_conversation_id`
- `source_message_id`
- `source_input_id`
- `is_shareable`
- `file_id`

This is a real generic artifact system, but it is not memo-native.

It can be reused if we make a conscious product-wide choice to standardize memo summaries, outlines, titles, and similar outputs under the shared artifact model.

It is missing obvious memo-specific structure such as:

- `memo_id`
- `source = live|final`
- `based_on_chunk_start`
- `based_on_chunk_end`
- direct timestamp provenance
- explicit artifact status for memo workflows

If we reuse `artifacts`, those semantics must be made explicit and consistent in `metadata`. If we do not enforce that discipline, the table becomes technical debt quickly.

### `chunks`

Columns include:

- `id`
- `file_id`
- `user_id`
- `content`
- `embedding`
- `created_at`

Despite the name, this is not a clean fit for memo transcript chunks.

It is missing the memo-specific fields we actually need:

- `memo_id`
- `source`
- `chunk_index`
- `segment_start_index`
- `segment_end_index`
- `start_ms`
- `end_ms`
- lifecycle status

Do not treat the existing `chunks` table as the memo chunk table unless it is deliberately extended to represent memo transcript chunks. As-is, it looks more like a generic file chunk store.

### `items`

Columns include:

- `id`
- `user_id`
- `type`
- `title`
- `preview`
- `content`
- `cleaned_content`
- `interpretation`
- `source`
- `source_id`
- `source_url`
- `metadata`
- `share_token`
- `shared_at`
- `revoked_at`
- `created_at`
- `updated_at`
- `cleaned_at`
- `interpreted_at`
- `source_type`
- `canonical_url`
- `external_id`
- `dedupe_key`
- `content_hash`
- `raw`

This is an ingestion/content table, not a memo transcript or memo artifact table.

Do not use it for:

- transcript chunks
- outline items
- summary items
- live memo artifact state

The semantics are too broad and too detached from memo timestamp provenance.

## Reuse Matrix

### Reuse directly

- `memos`
- `memo_transcript_segments`
- `job_runs`

### Reuse conditionally

- `artifact_embeddings`
- `artifacts`

### Do not reuse as-is

- `chunks`
- `items`

## Recommended Architecture

### Keep these responsibilities explicit

#### `memos`

Use for:

- canonical memo record
- top-level title
- plain transcript fallback
- share state
- top-level memo status

#### `memo_transcript_segments`

Use for:

- persisted transcript truth
- live segment persistence
- final segment persistence
- timestamp provenance

#### `job_runs`

Use for:

- build orchestration
- status tracking
- retries
- debugging failed generation jobs

### Add memo-specific structure where the current schema is too generic

We should not fake memo transcript chunks by forcing them into the current `chunks` table unless that table is intentionally extended to carry memo-specific semantics.

We should not fake memo outline items or summary state by spreading memo-specific meaning across generic `items` rows.

If we need a durable memo chunk layer or memo-native artifact layer, it is better to create those concepts explicitly than to hide them behind a generic name.

## Strong Rules Going Forward

- `memos.transcript` is a convenience projection and fallback, not the long-term analysis substrate.
- `memo_transcript_segments` is the source of truth for what was said and when.
- Stable transcript units should persist.
- Only stable transcript units should feed durable artifact generation.
- `job_runs` should own generation run state.
- Reuse generic tables only when their semantics already match the memo workflow.
- Do not choose a table because the name sounds right; choose it because its invariants match the product.

## Practical Next-Step Guidance

If we continue building live summaries, outlines, or title generation for memos, the safest incremental path is:

1. Keep `memos` as the memo-level record.
2. Keep `memo_transcript_segments` as transcript truth.
3. Reuse `job_runs` for generation orchestration.
4. Reuse `artifact_embeddings` only if derived memo outputs become first-class artifacts.
5. Reuse `artifacts` only if we intentionally standardize memo outputs under the generic artifact system.
6. Do not use the existing `chunks` or `items` tables as memo transcript infrastructure without deliberate schema changes.

## Bottom Line

We do already have artifact-like and chunk-like tables in the live database, but only some of them are good fits.

The cleanest current reuse plan is:

- keep `memos`
- keep `memo_transcript_segments`
- reuse `job_runs`
- optionally reuse `artifact_embeddings`
- reuse `artifacts` only with discipline
- avoid using `chunks` and `items` as the memo transcript foundation

This keeps the memo system explicit, queryable, and maintainable instead of burying memo semantics inside generic records and JSON blobs.
