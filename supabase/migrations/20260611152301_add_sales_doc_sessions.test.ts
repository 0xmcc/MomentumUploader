/** @jest-environment node */

import { readFileSync } from "node:fs";
import path from "node:path";

describe("20260611152301_add_sales_doc_sessions migration", () => {
  it("creates an RLS-protected SalesDoc sessions table for service-role access", () => {
    const migration = readFileSync(
      path.join(
        process.cwd(),
        "supabase/migrations/20260611152301_add_sales_doc_sessions.sql"
      ),
      "utf8"
    );

    expect(migration).toMatch(
      /create table if not exists public\.sales_doc_sessions/i
    );
    expect(migration).toMatch(/id\s+text\s+primary key/i);
    expect(migration).toMatch(/title\s+text\s+not null/i);
    expect(migration).toMatch(/sidebar_label\s+text\s+not null/i);
    expect(migration).toMatch(/prompt\s+text\s+not null/i);
    expect(migration).toMatch(/transcript\s+text/i);
    expect(migration).toMatch(/session_json\s+jsonb\s+not null/i);
    expect(migration).toMatch(
      /user_id\s+text\s+references public\.users\(id\) on delete cascade/i
    );
    expect(migration).toMatch(
      /created_at\s+timestamptz\s+not null default now\(\)/i
    );
    expect(migration).toMatch(
      /create index if not exists sales_doc_sessions_created_at_idx[\s\S]*on public\.sales_doc_sessions \(created_at desc\)/i
    );
    expect(migration).toMatch(
      /alter table public\.sales_doc_sessions enable row level security/i
    );
    expect(migration).not.toMatch(/create policy/i);
    expect(migration).not.toMatch(
      /grant\s+[\s\S]*\s+on public\.sales_doc_sessions to (anon|authenticated)/i
    );
    expect(migration).toMatch(
      /grant select, insert, update, delete on public\.sales_doc_sessions to service_role/i
    );
  });
});
