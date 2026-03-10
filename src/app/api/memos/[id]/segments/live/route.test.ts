/** @jest-environment node */

import { NextRequest } from "next/server";
import { PATCH } from "./route";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { runPendingMemoJobs } from "@/lib/memo-jobs";

jest.mock("@/lib/supabase", () => ({
    supabaseAdmin: {
        from: jest.fn(),
    },
}));

jest.mock("@/lib/memo-api-auth", () => ({
    resolveMemoUserId: jest.fn(),
}));

jest.mock("@/lib/memo-jobs", () => ({
    runPendingMemoJobs: jest.fn(),
}));

function makeRequest(body: Record<string, unknown>) {
    return {
        json: async () => body,
    } as unknown as NextRequest;
}

describe("PATCH /api/memos/:id/segments/live", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("returns 404 when the requester is not authenticated", async () => {
        (resolveMemoUserId as jest.Mock).mockResolvedValue(null);

        const response = await PATCH(makeRequest({ segments: [] }), {
            params: Promise.resolve({ id: "memo-1" }),
        });
        const body = await response.json();

        expect(response.status).toBe(404);
        expect(body.error).toMatch(/memo not found/i);
        expect(supabaseAdmin.from).not.toHaveBeenCalled();
    });

    it("returns 404 when the memo is not owned by the authenticated user", async () => {
        (resolveMemoUserId as jest.Mock).mockResolvedValue("user-1");

        const memoSingle = jest.fn().mockResolvedValue({
            data: null,
            error: { message: "not found" },
        });
        const memoEqUser = jest.fn(() => ({ single: memoSingle }));
        const memoEqId = jest.fn(() => ({ eq: memoEqUser }));
        const memoSelect = jest.fn(() => ({ eq: memoEqId }));

        (supabaseAdmin.from as jest.Mock).mockReturnValue({
            select: memoSelect,
        });

        const response = await PATCH(makeRequest({
            segments: [{ startIndex: 0, endIndex: 15, text: "hello" }],
        }), {
            params: Promise.resolve({ id: "memo-1" }),
        });

        expect(response.status).toBe(404);
        expect(runPendingMemoJobs).not.toHaveBeenCalled();
    });

    it("upserts locked live segments and enqueues a compaction job", async () => {
        (resolveMemoUserId as jest.Mock).mockResolvedValue("user-1");
        (runPendingMemoJobs as jest.Mock).mockResolvedValue(undefined);

        const memoSingle = jest.fn().mockResolvedValue({
            data: { id: "memo-1" },
            error: null,
        });
        const memoEqUser = jest.fn(() => ({ single: memoSingle }));
        const memoEqId = jest.fn(() => ({ eq: memoEqUser }));
        const memoSelect = jest.fn(() => ({ eq: memoEqId }));

        const upsert = jest.fn().mockResolvedValue({ data: null, error: null });
        const insert = jest.fn().mockResolvedValue({ data: null, error: null });

        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "memos") {
                return { select: memoSelect };
            }
            if (table === "memo_transcript_segments") {
                return { upsert };
            }
            if (table === "job_runs") {
                return { insert };
            }
            throw new Error(`Unexpected table: ${table}`);
        });

        const response = await PATCH(makeRequest({
            segments: [
                { startIndex: 0, endIndex: 15, text: "first locked segment" },
                { startIndex: 15, endIndex: 30, text: "second locked segment" },
            ],
        }), {
            params: Promise.resolve({ id: "memo-1" }),
        });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(runPendingMemoJobs).toHaveBeenCalledWith("memo-1", supabaseAdmin);
        expect(upsert).toHaveBeenCalledWith(
            [
                {
                    memo_id: "memo-1",
                    user_id: "user-1",
                    segment_index: 0,
                    start_ms: 0,
                    end_ms: 15000,
                    text: "first locked segment",
                    source: "live",
                },
                {
                    memo_id: "memo-1",
                    user_id: "user-1",
                    segment_index: 1,
                    start_ms: 15000,
                    end_ms: 30000,
                    text: "second locked segment",
                    source: "live",
                },
            ],
            {
                onConflict: "memo_id,segment_index,source",
            }
        );
        expect(insert).toHaveBeenCalledWith({
            user_id: "user-1",
            job_type: "memo_chunk_compact_live",
            entity_type: "memo",
            entity_id: "memo-1",
            status: "queued",
        });
    });
});
