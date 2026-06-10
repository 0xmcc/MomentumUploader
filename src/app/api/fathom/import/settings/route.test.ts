/** @jest-environment node */

import { NextRequest } from "next/server";
import { GET } from "./route";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { supabaseAdmin } from "@/lib/supabase";

jest.mock("@/lib/memo-api-auth", () => ({
  resolveMemoUserId: jest.fn(),
}));

jest.mock("@/lib/supabase");

describe("GET /api/fathom/import/settings", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv, FATHOM_API_KEY: "fathom-test-key" };
    (resolveMemoUserId as jest.Mock).mockResolvedValue("user-1");
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns connection status and the latest import run summary", async () => {
    const latestSingle = jest.fn().mockResolvedValue({
      data: {
        id: "fathom-run-1",
        status: "succeeded",
        imported_count: 7,
        meeting_count: 8,
        processed_pages: 2,
        started_at: "2026-06-08T19:00:01.000Z",
        completed_at: "2026-06-08T19:00:09.000Z",
        last_error: null,
      },
      error: null,
    });
    const latestLimit = jest.fn(() => ({ maybeSingle: latestSingle }));
    const latestOrder = jest.fn(() => ({ limit: latestLimit }));
    const latestEq = jest.fn(() => ({ order: latestOrder }));
    const latestSelect = jest.fn(() => ({ eq: latestEq }));

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === "fathom_import_runs") {
        return { select: latestSelect };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const res = await GET({} as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      configured: true,
      connectionStatus: "connected",
      lastImport: {
        jobId: "fathom-run-1",
        status: "succeeded",
        imported: 7,
        meetings: 8,
        processedPages: 2,
        startedAt: "2026-06-08T19:00:01.000Z",
        completedAt: "2026-06-08T19:00:09.000Z",
        error: null,
      },
    });
  });

  it("reports that Fathom is not configured without querying runs", async () => {
    delete process.env.FATHOM_API_KEY;

    const res = await GET({} as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      configured: false,
      connectionStatus: "not_configured",
      lastImport: null,
    });
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });
});
