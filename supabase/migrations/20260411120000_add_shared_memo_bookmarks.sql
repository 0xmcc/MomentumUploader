create table if not exists public.shared_memo_bookmarks (
  memo_id uuid not null references public.memos(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, memo_id)
);

create unique index if not exists shared_memo_bookmarks_user_memo_idx
  on public.shared_memo_bookmarks (user_id, memo_id);

create index if not exists shared_memo_bookmarks_user_created_idx
  on public.shared_memo_bookmarks (user_id, created_at desc);

alter table public.shared_memo_bookmarks enable row level security;

create policy "shared_memo_bookmarks_select_own"
  on public.shared_memo_bookmarks
  for select
  using ((auth.jwt() ->> 'sub') = user_id);

create policy "shared_memo_bookmarks_insert_own"
  on public.shared_memo_bookmarks
  for insert
  with check ((auth.jwt() ->> 'sub') = user_id);

create policy "shared_memo_bookmarks_delete_own"
  on public.shared_memo_bookmarks
  for delete
  using ((auth.jwt() ->> 'sub') = user_id);
