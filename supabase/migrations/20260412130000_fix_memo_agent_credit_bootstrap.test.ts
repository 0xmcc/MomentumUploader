/** @jest-environment node */

import { readFileSync } from "node:fs";
import path from "node:path";

describe("20260412130000_fix_memo_agent_credit_bootstrap migration", () => {
  const migration = readFileSync(
    path.join(
      process.cwd(),
      "supabase/migrations/20260412130000_fix_memo_agent_credit_bootstrap.sql"
    ),
    "utf8"
  );

  it("bootstraps public.users before creating or resetting user credits", () => {
    expect(migration).toMatch(
      /create or replace function public\.reset_monthly_credits_if_needed/i
    );
    expect(migration).toMatch(
      /insert into public\.users \(id\) values \(p_user_id\)[\s\S]*on conflict \(id\) do nothing/i
    );
    expect(migration).toMatch(
      /insert into public\.user_credits \(user_id\) values \(p_user_id\)[\s\S]*on conflict \(user_id\) do nothing/i
    );
  });
});
