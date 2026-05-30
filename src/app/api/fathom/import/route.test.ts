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

  it("imports Fathom meetings into memos and final transcript segments", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        next_cursor: null,
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
              {
                speaker: { display_name: "Bob" },
                text: "Second customer point.",
                timestamp: "00:00:12",
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;

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
      if (table === "memos") {
        return { upsert: memoUpsert };
      }
      if (table === "memo_transcript_segments") {
        return { delete: segmentDelete, insert: segmentInsert };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const res = await POST({} as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ imported: 1, meetings: 1 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.fathom.ai/external/v1/meetings?include_transcript=true&include_summary=true&include_action_items=true",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Api-Key": "fathom-test-key" }),
      })
    );
    expect(memoUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        source_app: "fathom",
        source_id: "98765",
        title: "Acme discovery call",
        transcript: "Alice: First customer point.\n\nBob: Second customer point.",
        audio_url: "https://fathom.video/share/abc",
        duration: 1800,
        transcript_status: "complete",
      }),
      { onConflict: "user_id,source_app,source_id" }
    );
    expect(segmentDeleteFirstEq).toHaveBeenCalledWith("memo_id", "memo-fathom-1");
    expect(segmentDeleteSecondEq).toHaveBeenCalledWith("source", "final");
    expect(segmentInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        memo_id: "memo-fathom-1",
        user_id: "user-1",
        segment_index: 0,
        start_ms: 5000,
        end_ms: 12000,
        text: "Alice: First customer point.",
        source: "final",
      }),
      expect.objectContaining({
        memo_id: "memo-fathom-1",
        user_id: "user-1",
        segment_index: 1,
        start_ms: 12000,
        text: "Bob: Second customer point.",
        source: "final",
      }),
    ]);
  });
});
