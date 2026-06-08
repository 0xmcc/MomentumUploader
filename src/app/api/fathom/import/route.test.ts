/** @jest-environment node */

import { NextRequest } from "next/server";
import { POST } from "./route";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { supabaseAdmin } from "@/lib/supabase";

jest.mock("@/lib/memo-api-auth", () => ({
  resolveMemoUserId: jest.fn(),
}));

jest.mock("@/lib/supabase");

describe("POST /api/fathom/import", () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv, FATHOM_API_KEY: "fathom-test-key" };
    (resolveMemoUserId as jest.Mock).mockResolvedValue("user-1");
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = originalEnv;
  });

  it("requires an authenticated memo user", async () => {
    (resolveMemoUserId as jest.Mock).mockResolvedValue(null);
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const res = await POST({} as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ error: "Unauthorized" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("reports a configuration error when Fathom has no API key", async () => {
    delete process.env.FATHOM_API_KEY;
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const res = await POST({} as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body).toEqual({
      error: "Fathom import is not configured",
      detail: "FATHOM_API_KEY is not set on the server.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("starts a Fathom import job without fetching meetings in the initial request", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const runSingle = jest.fn().mockResolvedValue({
      data: {
        id: "fathom-run-1",
        status: "queued",
        imported_count: 0,
        meeting_count: 0,
        processed_pages: 0,
        created_at: "2026-06-08T19:00:00.000Z",
        started_at: null,
        completed_at: null,
        last_error: null,
      },
      error: null,
    });
    const runSelect = jest.fn(() => ({ single: runSingle }));
    const runInsert = jest.fn(() => ({ select: runSelect }));

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === "fathom_import_runs") {
        return { insert: runInsert };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const res = await POST({} as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body).toEqual({
      jobId: "fathom-run-1",
      status: "queued",
      imported: 0,
      meetings: 0,
      processedPages: 0,
      startedAt: null,
      completedAt: null,
      error: null,
    });
    expect(runInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        status: "queued",
        imported_count: 0,
        meeting_count: 0,
        processed_pages: 0,
      })
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

});
