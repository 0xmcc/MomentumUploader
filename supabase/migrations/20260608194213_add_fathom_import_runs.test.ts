/** @jest-environment node */

import { readFileSync } from "node:fs";
import path from "node:path";

describe("20260608194213_add_fathom_import_runs migration", () => {
  it("creates an RLS-protected Fathom import progress table", () => {
    const migration = readFileSync(
      path.join(
        process.cwd(),
        "supabase/migrations/20260608194213_add_fathom_import_runs.sql"
      ),
      "utf8"
    );

    expect(migration).toMatch(
      /create table if not exists public\.fathom_import_runs/i
    );
    expect(migration).toMatch(
      /user_id\s+text\s+not null references public\.users\(id\) on delete cascade/i
    );
    expect(migration).toMatch(
      /status\s+text\s+not null default 'queued'[\s\S]*check \(status in \('queued', 'running', 'succeeded', 'failed'\)\)/i
    );
    expect(migration).toMatch(/imported_count integer not null default 0/i);
    expect(migration).toMatch(/meeting_count integer not null default 0/i);
    expect(migration).toMatch(/processed_pages integer not null default 0/i);
    expect(migration).toMatch(/next_cursor text/i);
    expect(migration).toMatch(/last_error text/i);
    expect(migration).toMatch(
      /create index if not exists fathom_import_runs_user_created_idx/i
    );
    expect(migration).toMatch(
      /create index if not exists fathom_import_runs_user_active_idx[\s\S]*where status in \('queued', 'running'\)/i
    );
    expect(migration).toMatch(
      /alter table public\.fathom_import_runs enable row level security/i
    );
    expect(migration).toMatch(
      /create policy "fathom_import_runs_select_own"[\s\S]*for select[\s\S]*using\s*\(\(auth\.jwt\(\)\s*->>\s*'sub'\)\s*=\s*user_id\)/i
    );
    expect(migration).toMatch(
      /grant select on public\.fathom_import_runs to authenticated/i
    );
    expect(migration).toMatch(
      /grant select, insert, update on public\.fathom_import_runs to service_role/i
    );
  });
});
