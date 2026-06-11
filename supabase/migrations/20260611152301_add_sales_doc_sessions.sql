create table if not exists public.sales_doc_sessions (
  id text primary key,
  title text not null,
  sidebar_label text not null,
  prompt text not null,
  transcript text,
  session_json jsonb not null,
  user_id text references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists sales_doc_sessions_created_at_idx
  on public.sales_doc_sessions (created_at desc);

alter table public.sales_doc_sessions enable row level security;

grant select, insert, update, delete on public.sales_doc_sessions to service_role;
