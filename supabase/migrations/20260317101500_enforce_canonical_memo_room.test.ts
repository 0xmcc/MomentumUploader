/** @jest-environment node */

import { readFileSync } from "node:fs";
import path from "node:path";

describe("20260317101500_enforce_canonical_memo_room migration", () => {
  it("deduplicates historical memo-room links before creating the unique index", () => {
    const migration = readFileSync(
      path.join(
        process.cwd(),
        "supabase/migrations/20260317101500_enforce_canonical_memo_room.sql"
      ),
      "utf8"
    );

    const deleteIndex = migration.search(/delete\s+from\s+public\.memo_room_memos/i);
    const uniqueIndex = migration.search(
      /create\s+unique\s+index\s+if\s+not\s+exists\s+memo_room_memos_memo_unique/i
    );

    expect(migration).toMatch(/row_number\(\)\s+over\s*\(\s*partition\s+by\s+memo_id/i);
    expect(deleteIndex).toBeGreaterThanOrEqual(0);
    expect(uniqueIndex).toBeGreaterThan(deleteIndex);
  });
});
