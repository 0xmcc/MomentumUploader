create table if not exists public.desktop_token_claims (
  code text primary key,
  token text not null,
  token_expires_at timestamptz not null,
  claim_expires_at timestamptz not null
);

create or replace function public.claim_desktop_token(p_code text)
returns table(token text, token_expires_at timestamptz)
language sql
as $$
  delete from public.desktop_token_claims
  where code = p_code
    and claim_expires_at > now()
  returning token, token_expires_at;
$$;
