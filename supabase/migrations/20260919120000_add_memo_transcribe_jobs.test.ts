/** @jest-environment node */

/**
 * Transcription joins the queue the rest of the app already uses.
 *
 * The worker claims `memo_agent_chat` through `claim_pending_agent_job`, which
 * filters to that one job type. A transcribe job needs the same atomic claim —
 * `for update skip locked`, so two workers cannot take the same recording — and
 * a heartbeat, so a job that outlives the five-minute agent-chat staleness
 * window is not stolen mid-transcription while a killed worker's job still is.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

describe("20260919120000_add_memo_transcribe_jobs migration", () => {
  const migration = readFileSync(
    path.join(
      process.cwd(),
      "supabase/migrations/20260919120000_add_memo_transcribe_jobs.sql"
    ),
    "utf8"
  );

  it("creates claim_pending_transcribe_job filtered to memo_transcribe", () => {
    expect(migration).toMatch(
      /create or replace function public\.claim_pending_transcribe_job/i
    );
    expect(migration).toMatch(/job_type = 'memo_transcribe'/i);
  });

  it("claims atomically so two workers cannot take the same recording", () => {
    expect(migration).toMatch(/for update skip locked/i);
    expect(migration).toMatch(/set status = 'running'/i);
    expect(migration).toMatch(/started_at = now\(\)/i);
  });

  it("takes the oldest pending job first", () => {
    expect(migration).toMatch(/order by created_at/i);
    expect(migration).toMatch(/limit 1/i);
  });

  it("exposes a heartbeat that only touches a running job", () => {
    expect(migration).toMatch(
      /create or replace function public\.heartbeat_job_run/i
    );
    expect(migration).toMatch(/p_job_id uuid/i);
    expect(migration).toMatch(/status = 'running'/i);
  });

  it("reclaims a job whose heartbeat has gone quiet, and only a stale one", () => {
    expect(migration).toMatch(
      /create or replace function public\.recover_stale_transcribe_jobs/i
    );
    expect(migration).toMatch(/p_stale_seconds/i);
    // Back to pending — a killed worker must leave the job reclaimable.
    expect(migration).toMatch(/set status = 'pending'/i);
    expect(migration).toMatch(/started_at < now\(\) - /i);
  });

  it("indexes the pending lookup the worker polls", () => {
    expect(migration).toMatch(
      /create index if not exists[\s\S]*job_runs[\s\S]*job_type/i
    );
  });
});
