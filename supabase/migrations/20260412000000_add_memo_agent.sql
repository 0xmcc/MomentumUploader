create table if not exists public.memo_agent_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.users(id) on delete cascade,
  memo_id uuid not null references public.memos(id) on delete cascade,
  provider text not null default 'anthropic'
    check (provider in ('anthropic', 'openai', 'google')),
  provider_session_id text,
  ui_messages jsonb not null default '[]',
  last_active_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, memo_id)
);

alter table public.memo_agent_sessions enable row level security;

create policy "memo_agent_sessions_select_own"
  on public.memo_agent_sessions for select
  using ((auth.jwt() ->> 'sub') = user_id);

create policy "memo_agent_sessions_insert_own"
  on public.memo_agent_sessions for insert
  with check ((auth.jwt() ->> 'sub') = user_id);

create policy "memo_agent_sessions_update_own"
  on public.memo_agent_sessions for update
  using ((auth.jwt() ->> 'sub') = user_id)
  with check ((auth.jwt() ->> 'sub') = user_id);

create index if not exists memo_agent_sessions_user_memo_idx
  on public.memo_agent_sessions (user_id, memo_id);

create table if not exists public.user_credits (
  user_id text primary key references public.users(id) on delete cascade,
  balance numeric(10,4) not null default 100,
  tier text not null default 'free' check (tier in ('free', 'pro')),
  billing_period_start timestamptz not null default date_trunc('month', now()),
  monthly_allowance numeric(10,4) not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_credits enable row level security;

create policy "user_credits_select_own"
  on public.user_credits for select
  using ((auth.jwt() ->> 'sub') = user_id);

create policy "user_credits_insert_own"
  on public.user_credits for insert
  with check ((auth.jwt() ->> 'sub') = user_id);

create table if not exists public.credit_transactions (
  id bigserial primary key,
  user_id text not null references public.users(id) on delete cascade,
  job_id uuid references public.job_runs(id) on delete set null,
  kind text not null check (kind in ('deduction', 'refund', 'topup', 'monthly_reset')),
  amount numeric(10,4) not null,
  balance_after numeric(10,4) not null,
  detail jsonb,
  created_at timestamptz not null default now()
);

alter table public.credit_transactions enable row level security;

create policy "credit_transactions_select_own"
  on public.credit_transactions for select
  using ((auth.jwt() ->> 'sub') = user_id);

create index if not exists credit_transactions_user_created_idx
  on public.credit_transactions (user_id, created_at desc);

alter table public.job_runs add column if not exists params jsonb;

create or replace function public.claim_pending_agent_job()
returns setof public.job_runs
language sql
security definer
set search_path = public
as $$
  update public.job_runs
  set status = 'running',
      started_at = now()
  where id = (
    select id
    from public.job_runs
    where job_type = 'memo_agent_chat'
      and status = 'pending'
    order by created_at
    limit 1
    for update skip locked
  )
  returning *;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'job_runs'
  ) then
    alter publication supabase_realtime add table public.job_runs;
  end if;
end;
$$;

create or replace function public.deduct_credits(
  p_user_id text,
  p_job_id uuid,
  p_amount numeric,
  p_detail jsonb default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
begin
  insert into public.user_credits (user_id) values (p_user_id)
  on conflict (user_id) do nothing;

  select balance into v_balance
  from public.user_credits
  where user_id = p_user_id
  for update;

  if v_balance < p_amount then
    return jsonb_build_object(
      'ok', false,
      'error', 'insufficient_credits',
      'balance', v_balance
    );
  end if;

  update public.user_credits
  set balance = balance - p_amount,
      updated_at = now()
  where user_id = p_user_id;

  v_balance := v_balance - p_amount;

  insert into public.credit_transactions (
    user_id,
    job_id,
    kind,
    amount,
    balance_after,
    detail
  )
  values (
    p_user_id,
    p_job_id,
    'deduction',
    p_amount,
    v_balance,
    p_detail
  );

  return jsonb_build_object('ok', true, 'balance', v_balance);
end;
$$;

create or replace function public.reset_monthly_credits_if_needed(p_user_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now_period timestamptz := date_trunc('month', now());
begin
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
