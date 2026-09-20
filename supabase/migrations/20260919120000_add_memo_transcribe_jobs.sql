-- Transcription onto the existing job queue.
--
-- Transcription was the one genuinely slow thing this app does that ran inside
-- an HTTP request, which is why a 1h42m recording could never finish. These
-- functions let the worker claim it like any other job.
--
-- Three functions, and the difference between them matters:
--   claim_pending_transcribe_job   -- atomic take, oldest first
--   heartbeat_job_run              -- "still working", so a three-hour job is
--                                     not mistaken for a dead one
--   recover_stale_transcribe_jobs  -- a worker killed mid-job leaves the job
--                                     reclaimable rather than lost

create or replace function public.claim_pending_transcribe_job()
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
    where job_type = 'memo_transcribe'
      and status = 'pending'
    order by created_at
    limit 1
    for update skip locked
  )
  returning *;
$$;

-- A heartbeat is just a fresher started_at. Staleness is then "has not been
-- heard from", not "has been running a while" — the second would kill a long
-- recording halfway through, which is exactly the case this pipeline exists for.
create or replace function public.heartbeat_job_run(p_job_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.job_runs
  set started_at = now()
  where id = p_job_id
    and status = 'running';
$$;

create or replace function public.recover_stale_transcribe_jobs(
  p_stale_seconds integer default 300
)
returns setof public.job_runs
language sql
security definer
set search_path = public
as $$
  update public.job_runs
  set status = 'pending',
      started_at = null
  where job_type = 'memo_transcribe'
    and status = 'running'
    and started_at is not null
    and started_at < now() - make_interval(secs => p_stale_seconds)
  returning *;
$$;

create index if not exists job_runs_pending_by_type_idx
  on public.job_runs (job_type, status, created_at);
