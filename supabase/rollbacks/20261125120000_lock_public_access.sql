-- Restores the state before the lock, which was open to the public.
begin;
alter table public.memos disable row level security;
alter table public.job_runs disable row level security;
grant all on table public.memos to anon, authenticated;
grant all on table public.job_runs to anon, authenticated;
create policy "Allow public uploads to voice-memos" on storage.objects for insert to public with check (bucket_id = 'voice-memos');
create policy "Allow public reads from voice-memos" on storage.objects for select to public using (bucket_id = 'voice-memos');
grant execute on function public.claim_pending_memo_job(uuid) to public, anon, authenticated;
grant execute on function public.claim_pending_agent_job() to public, anon, authenticated;
grant execute on function public.claim_pending_transcribe_job() to public, anon, authenticated;
grant execute on function public.heartbeat_job_run(uuid) to public, anon, authenticated;
grant execute on function public.recover_stale_transcribe_jobs(integer) to public, anon, authenticated;
commit;
