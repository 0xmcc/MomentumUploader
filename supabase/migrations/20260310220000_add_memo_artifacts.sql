create table public.memo_artifacts (
  id                   bigserial    primary key,
  memo_id              uuid         not null references public.memos(id) on delete cascade,
  user_id              text         not null references public.users(id) on delete cascade,
  source               text         not null check (source in ('live', 'final')),
  artifact_type        text         not null check (
                         artifact_type in (
                           'rolling_summary',
                           'outline',
                           'title_candidates',
                           'title',
                           'key_topics',
                           'action_items'
                         )
                       ),
  version              integer      not null default 1,
  status               text         not null default 'ready'
                                    check (status in ('ready', 'superseded', 'failed')),
  based_on_chunk_start integer,
  based_on_chunk_end   integer,
  payload              jsonb        not null,
  created_at           timestamptz  not null default now(),
  updated_at           timestamptz  not null default now()
);

create unique index memo_artifacts_one_ready_per_type
  on public.memo_artifacts (memo_id, source, artifact_type)
  where (status = 'ready');

alter table public.memo_artifacts enable row level security;

create policy users_own_artifacts on public.memo_artifacts
  for all
  using     ((auth.jwt() ->> 'sub') = user_id)
  with check ((auth.jwt() ->> 'sub') = user_id);

create index memo_artifacts_memo_source_type_idx
  on public.memo_artifacts (memo_id, source, artifact_type, status);

create or replace function public.claim_pending_memo_job(p_memo_id uuid)
returns setof public.job_runs
language sql
security definer
set search_path = public
as $$
  update public.job_runs
  set status = 'running',
      started_at = now()
  where id = (
    select id
    from public.job_runs
    where entity_id = p_memo_id
      and entity_type = 'memo'
      and status = 'pending'
    order by created_at
    limit 1
    for update skip locked
  )
  returning *;
$$;
