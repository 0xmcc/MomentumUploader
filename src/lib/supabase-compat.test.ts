/** @jest-environment node */

import { isMissingColumnError, isMissingTableError } from "@/lib/supabase-compat";

describe("supabase compatibility helpers", () => {
  it("recognizes missing-column errors without matching unrelated errors", () => {
    expect(
      isMissingColumnError(
        { code: "42703", message: "column memos.transcript_status does not exist" },
        "memos",
        "transcript_status"
      )
    ).toBe(true);

    expect(
      isMissingColumnError(
        { code: "23505", message: "duplicate key value violates unique constraint" },
        "memos",
        "transcript_status"
      )
    ).toBe(false);
  });

  it("recognizes missing-table errors from Postgres and PostgREST", () => {
    expect(
      isMissingTableError(
        {
          code: "42P01",
          message: 'relation "public.sales_doc_sessions" does not exist',
        },
        "sales_doc_sessions"
      )
    ).toBe(true);
    expect(
      isMissingTableError(
        {
          code: "PGRST205",
          message:
            "Could not find the table 'sales_doc_sessions' in the schema cache",
        },
        "sales_doc_sessions"
      )
    ).toBe(true);
    expect(
      isMissingTableError(
        {
          code: "PGRST205",
          message:
            "Could not find the table 'other_table' in the schema cache",
        },
        "sales_doc_sessions"
      )
    ).toBe(false);
  });
});
