create table if not exists public.openclaw_registration_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  owner_user_id text not null references public.users(id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'consumed', 'revoked')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);

create unique index if not exists openclaw_registration_tokens_owner_active_idx
  on public.openclaw_registration_tokens (owner_user_id)
  where status = 'active';

create table if not exists public.openclaw_runtimes (
  id uuid primary key default gen_random_uuid(),
  openclaw_external_id text not null unique,
  secret_hash text not null,
  display_name text,
  owner_user_id text not null references public.users(id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'revoked')),
  created_at timestamptz not null default now()
);

create unique index if not exists openclaw_runtimes_owner_active_idx
  on public.openclaw_runtimes (owner_user_id)
  where status = 'active';

create table if not exists public.openclaw_register_rate_limits (
  rate_limit_key text primary key,
  attempt_count integer not null check (attempt_count >= 0),
  window_started_at timestamptz not null,
  last_attempt_at timestamptz not null default now()
);

create index if not exists openclaw_register_rate_limits_last_attempt_at_idx
  on public.openclaw_register_rate_limits (last_attempt_at);

create or replace function public.issue_openclaw_registration_token(
  p_owner_user_id text,
  p_token_hash text,
  p_force boolean default false,
  p_expires_at timestamptz default (now() + interval '7 days')
)
returns table(status text, expires_at timestamptz)
language plpgsql
as $$
declare
  existing_token public.openclaw_registration_tokens%rowtype;
begin
  update public.openclaw_registration_tokens
  set status = 'revoked'
  where owner_user_id = p_owner_user_id
    and status = 'active'
    and expires_at <= now();

  select *
  into existing_token
  from public.openclaw_registration_tokens
  where owner_user_id = p_owner_user_id
    and status = 'active'
  for update;

  if found then
    if not coalesce(p_force, false) then
      return query
      select 'active_token_exists'::text, existing_token.expires_at;
      return;
    end if;

    update public.openclaw_registration_tokens
    set status = 'revoked'
    where id = existing_token.id;
  end if;

  insert into public.openclaw_registration_tokens (
    token_hash,
    owner_user_id,
    expires_at
  )
  values (
    p_token_hash,
    p_owner_user_id,
    p_expires_at
  );

  return query
  select 'created'::text, p_expires_at;
exception
  when unique_violation then
    select *
    into existing_token
    from public.openclaw_registration_tokens
    where owner_user_id = p_owner_user_id
      and status = 'active'
    order by created_at desc
    limit 1;

    return query
    select 'active_token_exists'::text, coalesce(existing_token.expires_at, p_expires_at);
end;
$$;

create or replace function public.register_openclaw_runtime(
  p_token_hash text,
  p_display_name text,
  p_openclaw_external_id text,
  p_secret_hash text
)
returns table(status text, owner_user_id text)
language plpgsql
as $$
declare
  active_token public.openclaw_registration_tokens%rowtype;
begin
  select *
  into active_token
  from public.openclaw_registration_tokens
  where token_hash = p_token_hash
    and status = 'active'
    and expires_at > now()
  for update;

  if not found then
    return query
    select 'token_not_found'::text, null::text;
    return;
  end if;

  if exists (
    select 1
    from public.openclaw_runtimes
    where owner_user_id = active_token.owner_user_id
      and status = 'active'
  ) then
    return query
    select 'active_runtime_exists'::text, active_token.owner_user_id;
    return;
  end if;

  begin
    insert into public.openclaw_runtimes (
      openclaw_external_id,
      secret_hash,
      display_name,
      owner_user_id
    )
    values (
      p_openclaw_external_id,
      p_secret_hash,
      p_display_name,
      active_token.owner_user_id
    );
  exception
    when unique_violation then
      if exists (
        select 1
        from public.openclaw_runtimes
        where owner_user_id = active_token.owner_user_id
          and status = 'active'
      ) then
        return query
        select 'active_runtime_exists'::text, active_token.owner_user_id;
        return;
      end if;

      raise;
  end;

  update public.openclaw_registration_tokens
  set status = 'consumed',
      consumed_at = now()
  where id = active_token.id
  returning *
  into active_token;

  if not found then
    raise exception 'failed to consume openclaw registration token after runtime creation';
  end if;

  return query
  select 'registered'::text, active_token.owner_user_id;
end;
$$;

create or replace function public.consume_openclaw_register_rate_limit(
  p_rate_limit_key text,
  p_max_attempts integer default 5,
  p_window_seconds integer default 60
)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
as $$
declare
  current_limit public.openclaw_register_rate_limits%rowtype;
  normalized_max_attempts integer := greatest(coalesce(p_max_attempts, 5), 1);
  normalized_window_seconds integer := greatest(coalesce(p_window_seconds, 60), 1);
  retry_after integer := 0;
begin
  if coalesce(length(trim(p_rate_limit_key)), 0) = 0 then
    raise exception 'p_rate_limit_key is required';
  end if;

  insert into public.openclaw_register_rate_limits (
    rate_limit_key,
    attempt_count,
    window_started_at,
    last_attempt_at
  )
  values (
    p_rate_limit_key,
    0,
    now(),
    now()
  )
  on conflict (rate_limit_key) do nothing;

  select *
  into current_limit
  from public.openclaw_register_rate_limits
  where rate_limit_key = p_rate_limit_key
  for update;

  if current_limit.window_started_at <= now() - make_interval(secs => normalized_window_seconds) then
    update public.openclaw_register_rate_limits
    set attempt_count = 1,
        window_started_at = now(),
        last_attempt_at = now()
    where rate_limit_key = p_rate_limit_key;

    return query
    select true, 0;
    return;
  end if;

  if current_limit.attempt_count >= normalized_max_attempts then
    retry_after := greatest(
      1,
      ceil(
        extract(
          epoch from (
            (current_limit.window_started_at + make_interval(secs => normalized_window_seconds)) - now()
          )
        )
      )::integer
    );

    update public.openclaw_register_rate_limits
    set last_attempt_at = now()
    where rate_limit_key = p_rate_limit_key;

    return query
    select false, retry_after;
    return;
  end if;

  update public.openclaw_register_rate_limits
  set attempt_count = current_limit.attempt_count + 1,
      last_attempt_at = now()
  where rate_limit_key = p_rate_limit_key;

  return query
  select true, 0;
end;
$$;
