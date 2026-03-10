create table public.memo_transcript_chunks (
  id                  bigserial    primary key,
  memo_id             uuid         not null references public.memos(id) on delete cascade,
  user_id             text         not null references public.users(id) on delete cascade,
  source              text         not null check (source in ('live', 'final')),
  chunk_index         integer      not null,
  segment_start_index integer      not null,
  segment_end_index   integer      not null,
  start_ms            integer      not null,
  end_ms              integer      not null,
  text                text         not null,
  token_estimate      integer,
  status              text         not null default 'ready'
                                   check (status in ('ready', 'superseded')),
  created_at          timestamptz  not null default now(),
  updated_at          timestamptz  not null default now(),
  unique (memo_id, source, chunk_index)
);

alter table public.memo_transcript_chunks enable row level security;

create policy users_own_chunks on public.memo_transcript_chunks
  for all
  using     ((auth.jwt() ->> 'sub') = user_id)
  with check ((auth.jwt() ->> 'sub') = user_id);

create index memo_transcript_chunks_memo_source_idx
  on public.memo_transcript_chunks (memo_id, source, chunk_index);
