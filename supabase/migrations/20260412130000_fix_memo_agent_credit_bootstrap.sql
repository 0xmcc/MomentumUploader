create or replace function public.reset_monthly_credits_if_needed(p_user_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now_period timestamptz := date_trunc('month', now());
begin
  insert into public.users (id) values (p_user_id)
  on conflict (id) do nothing;

  insert into public.user_credits (user_id) values (p_user_id)
  on conflict (user_id) do nothing;

  update public.user_credits
  set balance = monthly_allowance,
      billing_period_start = v_now_period,
      updated_at = now()
  where user_id = p_user_id
    and billing_period_start < v_now_period;
end;
$$;
