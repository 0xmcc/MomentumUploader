-- Add transcript_status to memos to decouple upload completion from transcription completion.
-- Default 'complete' is backward-compatible — all existing rows keep their current meaning.

ALTER TABLE memos
  ADD COLUMN transcript_status text NOT NULL DEFAULT 'complete';

ALTER TABLE memos
  ADD CONSTRAINT memos_transcript_status_check
  CHECK (transcript_status IN ('processing', 'complete', 'failed'));
