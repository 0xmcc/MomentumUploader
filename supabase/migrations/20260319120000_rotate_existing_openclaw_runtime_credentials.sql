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
  active_runtime public.openclaw_runtimes%rowtype;
  registration_status text := 'registered';
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

  select *
  into active_runtime
  from public.openclaw_runtimes as runtimes
  where runtimes.owner_user_id = active_token.owner_user_id
    and runtimes.status = 'active'
  order by runtimes.created_at desc
  limit 1
  for update;

  if found then
    update public.openclaw_runtimes as runtimes
    set secret_hash = p_secret_hash,
        display_name = coalesce(nullif(trim(p_display_name), ''), runtimes.display_name)
    where runtimes.id = active_runtime.id;

    registration_status := 'rotated_existing_runtime';
  else
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
        nullif(trim(p_display_name), ''),
        active_token.owner_user_id
      );
    exception
      when unique_violation then
        select *
        into active_runtime
        from public.openclaw_runtimes as runtimes
        where runtimes.owner_user_id = active_token.owner_user_id
          and runtimes.status = 'active'
        order by runtimes.created_at desc
        limit 1
        for update;

        if not found then
          raise;
        end if;

        update public.openclaw_runtimes as runtimes
        set secret_hash = p_secret_hash,
            display_name = coalesce(nullif(trim(p_display_name), ''), runtimes.display_name)
        where runtimes.id = active_runtime.id;

        registration_status := 'rotated_existing_runtime';
    end;
  end if;

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
  select registration_status, active_token.owner_user_id;
end;
$$;
