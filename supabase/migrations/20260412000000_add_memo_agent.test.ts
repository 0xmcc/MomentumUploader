/** @jest-environment node */

import { readFileSync } from "node:fs";
import path from "node:path";

describe("20260412000000_add_memo_agent migration", () => {
  const migration = readFileSync(
    path.join(
      process.cwd(),
      "supabase/migrations/20260412000000_add_memo_agent.sql"
    ),
    "utf8"
  );

  it("creates memo_agent_sessions with provider, provider_session_id, ui_messages", () => {
    expect(migration).toMatch(
      /create table if not exists public\.memo_agent_sessions/i
    );
    expect(migration).toMatch(
      /provider\s+text\s+not null default 'anthropic'/i
    );
    expect(migration).toMatch(/provider_session_id\s+text/i);
    expect(migration).toMatch(/ui_messages\s+jsonb\s+not null default '\[\]'/i);
    expect(migration).toMatch(/unique \(user_id, memo_id\)/i);
  });

  it("applies separate per-operation RLS policies", () => {
    expect(migration).toMatch(
      /alter table public\.memo_agent_sessions enable row level security/i
    );
    expect(migration).toMatch(
      /"memo_agent_sessions_select_own"[\s\S]*for select/i
    );
    expect(migration).toMatch(
      /"memo_agent_sessions_insert_own"[\s\S]*for insert/i
    );
    expect(migration).toMatch(
      /"memo_agent_sessions_update_own"[\s\S]*for update/i
    );
  });

  it("uses uuid for credit_transactions.job_id to match public.job_runs.id", () => {
    expect(migration).toMatch(/job_id\s+uuid\s+references public\.job_runs/i);
  });

  it("creates claim_pending_agent_job with memo_agent_chat filter", () => {
    expect(migration).toMatch(
      /create or replace function public\.claim_pending_agent_job/i
    );
    expect(migration).toMatch(/job_type = 'memo_agent_chat'/i);
    expect(migration).toMatch(/for update skip locked/i);
  });

  it("adds params column to job_runs if not exists", () => {
    expect(migration).toMatch(
      /alter table public\.job_runs[\s\S]*add column if not exists params jsonb/i
    );
  });

  it("deduct_credits takes uuid p_job_id and inserts on conflict before balance check", () => {
    expect(migration).toMatch(/p_job_id uuid/i);
    expect(migration).toMatch(
      /insert into public\.user_credits[\s\S]*on conflict \(user_id\) do nothing/i
    );
    expect(migration).toMatch(/if v_balance < p_amount then/i);
  });
});
