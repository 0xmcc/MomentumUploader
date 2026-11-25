-- Restores the state before the lock, which was open to the public.
begin;
alter table public.desktop_token_claims disable row level security;
grant all on table public.desktop_token_claims to anon, authenticated;
commit;
