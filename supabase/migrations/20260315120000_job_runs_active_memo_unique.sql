create unique index if not exists job_runs_one_active_per_entity_type
  on public.job_runs (entity_id, entity_type, job_type)
  where status in ('pending', 'running');
