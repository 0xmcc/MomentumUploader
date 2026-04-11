/** @jest-environment node */

import { readFileSync } from "node:fs";
import path from "node:path";

describe("20260411120000_add_shared_memo_bookmarks migration", () => {
  it("creates an RLS-protected bookmark table keyed by user and memo", () => {
    const migration = readFileSync(
      path.join(
        process.cwd(),
        "supabase/migrations/20260411120000_add_shared_memo_bookmarks.sql"
      ),
      "utf8"
    );

    expect(migration).toMatch(
      /create table if not exists public\.shared_memo_bookmarks/i
    );
    expect(migration).toMatch(
      /memo_id\s+uuid\s+not null references public\.memos\(id\) on delete cascade/i
    );
    expect(migration).toMatch(
      /user_id\s+text\s+not null references public\.users\(id\) on delete cascade/i
    );
    expect(migration).toMatch(
      /create unique index if not exists shared_memo_bookmarks_user_memo_idx/i
    );
    expect(migration).toMatch(
      /create index if not exists shared_memo_bookmarks_user_created_idx/i
    );
    expect(migration).toMatch(
      /alter table public\.shared_memo_bookmarks enable row level security/i
    );
    expect(migration).toMatch(
      /create policy "shared_memo_bookmarks_select_own"[\s\S]*for select[\s\S]*using\s*\(\(auth\.jwt\(\)\s*->>\s*'sub'\)\s*=\s*user_id\)/i
    );
    expect(migration).toMatch(
      /create policy "shared_memo_bookmarks_insert_own"[\s\S]*for insert[\s\S]*with check\s*\(\(auth\.jwt\(\)\s*->>\s*'sub'\)\s*=\s*user_id\)/i
    );
    expect(migration).toMatch(
      /create policy "shared_memo_bookmarks_delete_own"[\s\S]*for delete[\s\S]*using\s*\(\(auth\.jwt\(\)\s*->>\s*'sub'\)\s*=\s*user_id\)/i
    );
  });
});
