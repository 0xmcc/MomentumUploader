/** @jest-environment node */

import { NextRequest } from "next/server";
import { GET } from "./route";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { FATHOM_REQUEST_TIMEOUT_MS } from "@/lib/fathom-import";

jest.mock("@/lib/memo-api-auth", () => ({
  resolveMemoUserId: jest.fn(),
}));

jest.mock("@/lib/supabase");

describe("GET /api/fathom/import/[jobId]", () => {
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

  it("processes one Fathom page and returns running progress when more pages remain", async () => {
    const startedRun = {
      id: "fathom-run-1",
      user_id: "user-1",
      status: "queued",
      imported_count: 0,
      meeting_count: 0,
      processed_pages: 0,
      next_cursor: null,
      created_at: "2026-06-08T19:00:00.000Z",
      started_at: null,
      completed_at: null,
      last_error: null,
    };

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        next_cursor: "page-2",
        items: [
          {
            title: "Customer discovery",
            meeting_title: "Acme discovery call",
            recording_id: 98765,
            url: "https://fathom.video/abc",
            share_url: "https://fathom.video/share/abc",
            created_at: "2026-05-01T16:00:00Z",
            recording_start_time: "2026-05-01T16:01:00Z",
            recording_end_time: "2026-05-01T16:31:00Z",
            transcript: [
              {
                speaker: { display_name: "Alice" },
                text: "First customer point.",
                timestamp: "00:00:05",
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;

    const runSingle = jest.fn().mockResolvedValue({ data: startedRun, error: null });
    const runEqUser = jest.fn(() => ({ single: runSingle }));
    const runEqId = jest.fn(() => ({ eq: runEqUser }));
    const runSelect = jest.fn(() => ({ eq: runEqId }));
    const runUpdateEq = jest.fn().mockResolvedValue({ error: null });
    const runUpdate = jest.fn(() => ({ eq: runUpdateEq }));

    const memoSingle = jest.fn().mockResolvedValue({
      data: { id: "memo-fathom-1", source_id: "98765" },
      error: null,
    });
    const memoSelect = jest.fn(() => ({ single: memoSingle }));
    const memoUpsert = jest.fn(() => ({ select: memoSelect }));

    const segmentDeleteSecondEq = jest.fn().mockResolvedValue({ error: null });
    const segmentDeleteFirstEq = jest.fn(() => ({ eq: segmentDeleteSecondEq }));
    const segmentDelete = jest.fn(() => ({ eq: segmentDeleteFirstEq }));
    const segmentInsert = jest.fn().mockResolvedValue({ error: null });

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === "fathom_import_runs") {
        return { select: runSelect, update: runUpdate };
      }
      if (table === "memos") {
        return { upsert: memoUpsert };
      }
      if (table === "memo_transcript_segments") {
        return { delete: segmentDelete, insert: segmentInsert };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const res = await GET({} as NextRequest, {
      params: Promise.resolve({ jobId: "fathom-run-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      jobId: "fathom-run-1",
      status: "running",
      imported: 1,
      meetings: 1,
      processedPages: 1,
      startedAt: expect.any(String),
      completedAt: null,
      error: null,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.fathom.ai/external/v1/meetings?include_transcript=true&include_summary=true&include_action_items=true",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Api-Key": "fathom-test-key" }),
      })
    );
    expect(runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "running",
        imported_count: 1,
        meeting_count: 1,
        processed_pages: 1,
        next_cursor: "page-2",
        completed_at: null,
        last_error: null,
      })
    );
  });

  it("returns completed progress without fetching Fathom again for a finished job", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const runSingle = jest.fn().mockResolvedValue({
      data: {
        id: "fathom-run-1",
        user_id: "user-1",
        status: "succeeded",
        imported_count: 4,
        meeting_count: 5,
        processed_pages: 2,
        next_cursor: null,
        created_at: "2026-06-08T19:00:00.000Z",
        started_at: "2026-06-08T19:00:01.000Z",
        completed_at: "2026-06-08T19:00:09.000Z",
        last_error: null,
      },
      error: null,
    });
    const runEqUser = jest.fn(() => ({ single: runSingle }));
    const runEqId = jest.fn(() => ({ eq: runEqUser }));
    const runSelect = jest.fn(() => ({ eq: runEqId }));

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === "fathom_import_runs") {
        return { select: runSelect };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const res = await GET({} as NextRequest, {
      params: Promise.resolve({ jobId: "fathom-run-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      jobId: "fathom-run-1",
      status: "succeeded",
      imported: 4,
      meetings: 5,
      processedPages: 2,
      startedAt: "2026-06-08T19:00:01.000Z",
      completedAt: "2026-06-08T19:00:09.000Z",
      error: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("marks the job failed when Fathom does not respond", async () => {
    jest.useFakeTimers();

    const runSingle = jest.fn().mockResolvedValue({
      data: {
        id: "fathom-run-1",
        user_id: "user-1",
        status: "queued",
        imported_count: 0,
        meeting_count: 0,
        processed_pages: 0,
        next_cursor: null,
        created_at: "2026-06-08T19:00:00.000Z",
        started_at: null,
        completed_at: null,
        last_error: null,
      },
      error: null,
    });
    const runEqUser = jest.fn(() => ({ single: runSingle }));
    const runEqId = jest.fn(() => ({ eq: runEqUser }));
    const runSelect = jest.fn(() => ({ eq: runEqId }));
    const runUpdateEq = jest.fn().mockResolvedValue({ error: null });
    const runUpdate = jest.fn(() => ({ eq: runUpdateEq }));

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === "fathom_import_runs") {
        return { select: runSelect, update: runUpdate };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const fetchMock = jest.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const abortError = new Error("The operation was aborted.");
          abortError.name = "AbortError";
          reject(abortError);
        });
      });
    });
    global.fetch = fetchMock;

    try {
      const responsePromise = GET({} as NextRequest, {
        params: Promise.resolve({ jobId: "fathom-run-1" }),
      });

      await jest.advanceTimersByTimeAsync(FATHOM_REQUEST_TIMEOUT_MS);

      const res = await responsePromise;
      const body = await res.json();

      expect(res.status).toBe(504);
      expect(body).toEqual({
        jobId: "fathom-run-1",
        status: "failed",
        imported: 0,
        meetings: 0,
        processedPages: 0,
        startedAt: expect.any(String),
        completedAt: expect.any(String),
        error: "Fathom did not respond before the import timeout.",
      });
      expect(runUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
          last_error: "Fathom did not respond before the import timeout.",
        })
      );
    } finally {
      jest.useRealTimers();
    }
  });
});
