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
  update public.openclaw_registration_tokens as active_tokens
  set status = 'revoked'
  where active_tokens.owner_user_id = p_owner_user_id
    and active_tokens.status = 'active'
    and active_tokens.expires_at <= now();

  select *
  into existing_token
  from public.openclaw_registration_tokens as active_tokens
  where active_tokens.owner_user_id = p_owner_user_id
    and active_tokens.status = 'active'
  for update;

  if found then
    if not coalesce(p_force, false) then
      return query
      select 'active_token_exists'::text, existing_token.expires_at;
      return;
    end if;

    update public.openclaw_registration_tokens as active_tokens
    set status = 'revoked'
    where active_tokens.id = existing_token.id;
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
    from public.openclaw_registration_tokens as latest_active_token
    where latest_active_token.owner_user_id = p_owner_user_id
      and latest_active_token.status = 'active'
    order by latest_active_token.created_at desc
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
  from public.openclaw_registration_tokens as registration_tokens
  where registration_tokens.token_hash = p_token_hash
    and registration_tokens.status = 'active'
    and registration_tokens.expires_at > now()
  for update;

  if not found then
    return query
    select 'token_not_found'::text, null::text;
    return;
  end if;

  if exists (
    select 1
    from public.openclaw_runtimes as runtimes
    where runtimes.owner_user_id = active_token.owner_user_id
      and runtimes.status = 'active'
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
        from public.openclaw_runtimes as runtimes
        where runtimes.owner_user_id = active_token.owner_user_id
          and runtimes.status = 'active'
      ) then
        return query
        select 'active_runtime_exists'::text, active_token.owner_user_id;
        return;
      end if;

      raise;
  end;

  update public.openclaw_registration_tokens as registration_tokens
  set status = 'consumed',
      consumed_at = now()
  where registration_tokens.id = active_token.id
  returning *
  into active_token;

  if not found then
    raise exception 'failed to consume openclaw registration token after runtime creation';
  end if;

  return query
  select 'registered'::text, active_token.owner_user_id;
end;
$$;
