-- memos and job_runs had row protection off and full grants to the public key,
-- so anyone holding the key shipped in the website could read, edit or delete
-- them, and list every audio file. All app access goes through the server's
-- service_role key, which bypasses row protection and is unaffected.
-- Undo: supabase/rollbacks/20261125120000_lock_public_access.sql
begin;

alter table public.memos enable row level security;
alter table public.job_runs enable row level security;

revoke all on table public.memos from anon, authenticated, public;
revoke all on table public.job_runs from anon, authenticated, public;
grant all on table public.memos to service_role;
grant all on table public.job_runs to service_role;

-- Signed uploads and public direct links do not use these.
drop policy if exists "Allow public uploads to voice-memos" on storage.objects;
drop policy if exists "Allow public reads from voice-memos" on storage.objects;

revoke execute on function public.claim_pending_memo_job(uuid) from public, anon, authenticated;
revoke execute on function public.claim_pending_agent_job() from public, anon, authenticated;
revoke execute on function public.claim_pending_transcribe_job() from public, anon, authenticated;
revoke execute on function public.heartbeat_job_run(uuid) from public, anon, authenticated;
revoke execute on function public.recover_stale_transcribe_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_pending_memo_job(uuid) to service_role;
grant execute on function public.claim_pending_agent_job() to service_role;
grant execute on function public.claim_pending_transcribe_job() to service_role;
grant execute on function public.heartbeat_job_run(uuid) to service_role;
grant execute on function public.recover_stale_transcribe_jobs(integer) to service_role;

commit;
