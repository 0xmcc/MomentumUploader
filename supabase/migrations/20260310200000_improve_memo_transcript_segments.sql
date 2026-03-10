create index memo_transcript_segments_memo_source_idx
  on public.memo_transcript_segments (memo_id, source, segment_index);

create index memo_transcript_segments_memo_source_time_idx
  on public.memo_transcript_segments (memo_id, source, start_ms);

alter table public.memo_transcript_segments
  add constraint memo_transcript_segments_valid_time
  check (start_ms >= 0 and end_ms >= start_ms);
