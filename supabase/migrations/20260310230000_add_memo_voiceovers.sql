-- Voiceover persistence: store generated voiceovers per memo + voice so they survive refresh.
-- Unique (memo_id, voice_id); audio stored in Supabase storage, URL in audio_url.
create table if not exists public.memo_voiceovers (
  id uuid primary key default gen_random_uuid(),
  memo_id uuid not null references public.memos(id) on delete cascade,
  user_id text not null,
  voice_id text not null,
  audio_url text,
  storage_path text,
  content_type text,
  status text not null default 'processing' check (status in ('processing', 'ready')),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (memo_id, voice_id)
);

create index if not exists memo_voiceovers_user_id_idx
  on public.memo_voiceovers (user_id);

create index if not exists memo_voiceovers_memo_id_idx
  on public.memo_voiceovers (memo_id);

alter table public.memo_voiceovers enable row level security;

create policy "memo_voiceovers_select_own"
  on public.memo_voiceovers
  for select
  using (auth.uid()::text = user_id);

create policy "memo_voiceovers_insert_own"
  on public.memo_voiceovers
  for insert
  with check (auth.uid()::text = user_id);

create policy "memo_voiceovers_update_own"
  on public.memo_voiceovers
  for update
  using (auth.uid()::text = user_id)
  with check (auth.uid()::text = user_id);

create policy "memo_voiceovers_delete_own"
  on public.memo_voiceovers
  for delete
  using (auth.uid()::text = user_id);
