alter table public.agents
  add column if not exists openclaw_external_id text,
  add column if not exists openclaw_display_name text,
  add column if not exists openclaw_context text;

create unique index if not exists agents_openclaw_external_id_owner_idx
  on public.agents (owner_user_id, openclaw_external_id)
  where openclaw_external_id is not null;

create table public.openclaw_invite_nonces (
  id            uuid primary key default gen_random_uuid(),
  share_ref     text not null,
  owner_user_id text not null references public.users(id) on delete cascade,
  nonce         text not null unique,
  status        text not null default 'active'
                check (status in ('active', 'consumed', 'expired')),
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now(),
  consumed_at   timestamptz
);

create index openclaw_invite_nonces_share_ref_idx
  on public.openclaw_invite_nonces (share_ref);

create index openclaw_invite_nonces_nonce_idx
  on public.openclaw_invite_nonces (nonce)
  where status = 'active';

create table public.openclaw_claim_requests (
  id                    uuid primary key default gen_random_uuid(),
  share_ref             text not null,
  memo_id               uuid not null references public.memos(id) on delete cascade,
  owner_user_id         text not null references public.users(id) on delete cascade,
  openclaw_external_id  text not null,
  openclaw_display_name text,
  openclaw_context      text,
  status                text not null default 'pending'
                        check (status in ('pending', 'claimed', 'rejected')),
  agent_id              uuid references public.agents(id),
  created_at            timestamptz not null default now(),
  claimed_at            timestamptz
);

create unique index openclaw_claim_requests_share_pending_idx
  on public.openclaw_claim_requests (share_ref)
  where status = 'pending';

create index openclaw_claim_requests_external_id_idx
  on public.openclaw_claim_requests (openclaw_external_id);

create or replace function public.claim_openclaw_invite_nonce(
  p_share_ref text,
  p_memo_id uuid,
  p_owner_user_id text,
  p_openclaw_external_id text,
  p_openclaw_display_name text,
  p_openclaw_context text,
  p_nonce text
)
returns setof public.openclaw_claim_requests
language plpgsql
as $$
declare
  consumed_nonce public.openclaw_invite_nonces%rowtype;
  inserted_claim public.openclaw_claim_requests%rowtype;
begin
  update public.openclaw_invite_nonces
    set status = 'consumed',
        consumed_at = now()
  where nonce = p_nonce
    and share_ref = p_share_ref
    and owner_user_id = p_owner_user_id
    and status = 'active'
    and expires_at > now()
  returning * into consumed_nonce;

  if not found then
    return;
  end if;

  insert into public.openclaw_claim_requests (
    share_ref,
    memo_id,
    owner_user_id,
    openclaw_external_id,
    openclaw_display_name,
    openclaw_context,
    status
  )
  values (
    p_share_ref,
    p_memo_id,
    p_owner_user_id,
    p_openclaw_external_id,
    p_openclaw_display_name,
    p_openclaw_context,
    'pending'
  )
  returning * into inserted_claim;

  return next inserted_claim;
end;
$$;
