create table if not exists public.fathom_import_runs (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.users(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed')),
  imported_count integer not null default 0 check (imported_count >= 0),
  meeting_count integer not null default 0 check (meeting_count >= 0),
  processed_pages integer not null default 0 check (processed_pages >= 0),
  next_cursor text,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fathom_import_runs_user_created_idx
  on public.fathom_import_runs (user_id, created_at desc);

create index if not exists fathom_import_runs_user_active_idx
  on public.fathom_import_runs (user_id, status, created_at desc)
  where status in ('queued', 'running');

alter table public.fathom_import_runs enable row level security;

create policy "fathom_import_runs_select_own"
  on public.fathom_import_runs
  for select
  using ((auth.jwt() ->> 'sub') = user_id);

grant select on public.fathom_import_runs to authenticated;
grant select, insert, update on public.fathom_import_runs to service_role;
