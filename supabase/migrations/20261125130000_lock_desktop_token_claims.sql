-- Pairing rows hold a live device token until it is claimed. Row protection
-- was off, so the public key could read them. Server-only from here.
begin;
alter table public.desktop_token_claims enable row level security;
revoke all on table public.desktop_token_claims from anon, authenticated, public;
grant all on table public.desktop_token_claims to service_role;
commit;
