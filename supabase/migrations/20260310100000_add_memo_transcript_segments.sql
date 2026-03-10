-- Add memo_transcript_segments table for structured timestamped transcript data.
-- Segments are written at final transcription time only; the plain memos.transcript
-- field is unchanged and continues to serve search, exports, and live share refresh.
-- source column ('live' | 'final') is included now to support future live segment
-- writes without a schema migration.

create table public.memo_transcript_segments (
  id            bigserial    primary key,
  memo_id       uuid         not null references public.memos(id) on delete cascade,
  user_id       text         not null references public.users(id) on delete cascade,
  segment_index integer      not null,
  start_ms      integer      not null,
  end_ms        integer      not null,
  text          text         not null,
  source        text         not null default 'final'
                             check (source in ('live', 'final')),
  created_at    timestamptz  not null default now(),
  constraint memo_transcript_segments_unique
    unique (memo_id, segment_index, source)
);

create index memo_transcript_segments_lookup
  on public.memo_transcript_segments (memo_id, segment_index);

alter table public.memo_transcript_segments enable row level security;

-- Defense-in-depth: deny direct client access; service role bypasses RLS.
-- Uses Clerk JWT sub pattern consistent with the rest of the schema
-- (user_id is text, not uuid — auth.uid() would be wrong here).
create policy "users_own_segments"
  on public.memo_transcript_segments
  for all
  using  ((auth.jwt() ->> 'sub') = user_id)
  with check ((auth.jwt() ->> 'sub') = user_id);
