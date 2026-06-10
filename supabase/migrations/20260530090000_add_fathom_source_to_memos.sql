alter table public.memos
  add column if not exists source_app text,
  add column if not exists source_id text;

create unique index if not exists memos_user_source_app_source_id_idx
  on public.memos (user_id, source_app, source_id);

create index if not exists memos_user_source_app_created_idx
  on public.memos (user_id, source_app, created_at desc);
