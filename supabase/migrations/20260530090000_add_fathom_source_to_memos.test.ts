/** @jest-environment node */

import { readFileSync } from "node:fs";
import path from "node:path";

describe("20260530090000_add_fathom_source_to_memos migration", () => {
  it("adds stable external source columns and a user-scoped idempotency index", () => {
    const migration = readFileSync(
      path.join(
        process.cwd(),
        "supabase/migrations/20260530090000_add_fathom_source_to_memos.sql"
      ),
      "utf8"
    );

    expect(migration).toMatch(
      /alter table public\.memos[\s\S]*add column if not exists source_app text/i
    );
    expect(migration).toMatch(
      /alter table public\.memos[\s\S]*add column if not exists source_id text/i
    );
    expect(migration).toMatch(
      /create unique index if not exists memos_user_source_app_source_id_idx[\s\S]*on public\.memos \(user_id, source_app, source_id\)/i
    );
    expect(migration).toMatch(
      /create index if not exists memos_user_source_app_created_idx[\s\S]*on public\.memos \(user_id, source_app, created_at desc\)/i
    );
  });
});
