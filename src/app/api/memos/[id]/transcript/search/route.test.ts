/** @jest-environment node */

import { NextRequest } from "next/server";
import { GET } from "./route";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { supabaseAdmin } from "@/lib/supabase";

jest.mock("@/lib/memo-api-auth", () => ({
    resolveMemoUserId: jest.fn(),
}));

jest.mock("@/lib/supabase");

describe("GET /api/memos/:id/transcript/search", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("returns ranked transcript hits anchored to segment and time ranges", async () => {
        (resolveMemoUserId as jest.Mock).mockResolvedValue("user_a");

        const memoSingle = jest.fn().mockResolvedValue({
            data: { id: "memo-1", duration: 90 },
            error: null,
        });
        const memoUserEq = jest.fn(() => ({ single: memoSingle }));
        const memoIdEq = jest.fn(() => ({ eq: memoUserEq }));
        const memoSelect = jest.fn(() => ({ eq: memoIdEq }));

        const segmentOrder = jest.fn().mockResolvedValue({
            data: [
                {
                    id: 11,
                    segment_index: 1,
                    start_ms: 1400,
                    end_ms: 3100,
                    text: "Pricing overview and annual billing details.",
                },
                {
                    id: 12,
                    segment_index: 2,
                    start_ms: 3100,
                    end_ms: 4700,
                    text: "The customer raised pricing objections and asked for concessions.",
                },
                {
                    id: 13,
                    segment_index: 3,
                    start_ms: 4700,
                    end_ms: 7000,
                    text: "We closed with next steps and a pricing follow-up email.",
                },
            ],
            error: null,
        });
        const segmentSourceEq = jest.fn(() => ({ order: segmentOrder }));
        const segmentMemoEq = jest.fn(() => ({ eq: segmentSourceEq }));
        const segmentSelect = jest.fn(() => ({ eq: segmentMemoEq }));

        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "memos") {
                return { select: memoSelect };
            }

            if (table === "memo_transcript_segments") {
                return { select: segmentSelect };
            }

            throw new Error(`Unexpected table ${table}`);
        });

        const req = {
            nextUrl: new URL(
                "https://example.com/api/memos/memo-1/transcript/search?query=pricing%20objections&limit=2"
            ),
        } as NextRequest;
        const res = await GET(req, { params: Promise.resolve({ id: "memo-1" }) });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.search).toMatchObject({
            memoId: "memo-1",
            query: "pricing objections",
            source: "final",
            total: 2,
        });
        expect(body.search.hits).toEqual([
            {
                snippet: "The customer raised pricing objections and asked for concessions.",
                startMs: 3100,
                endMs: 4700,
                segmentIds: [12],
                score: 2,
            },
            {
                snippet: "Pricing overview and annual billing details.",
                startMs: 1400,
                endMs: 3100,
                segmentIds: [11],
                score: 1,
            },
        ]);
    });

    it("requires a non-empty search query", async () => {
        (resolveMemoUserId as jest.Mock).mockResolvedValue("user_a");

        const req = {
            nextUrl: new URL("https://example.com/api/memos/memo-1/transcript/search"),
        } as NextRequest;
        const res = await GET(req, { params: Promise.resolve({ id: "memo-1" }) });
        const body = await res.json();

        expect(res.status).toBe(422);
        expect(body.error).toBe("'query' is required");
        expect(supabaseAdmin.from).not.toHaveBeenCalled();
    });
});
