/** @jest-environment node */

import { NextRequest } from "next/server";
import { GET } from "./route";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { supabaseAdmin } from "@/lib/supabase";

jest.mock("@/lib/memo-api-auth", () => ({
    resolveMemoUserId: jest.fn(),
}));

jest.mock("@/lib/supabase");

describe("GET /api/memos/:id/transcript", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("returns a bounded transcript window with context metadata", async () => {
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
                { id: 10, segment_index: 0, start_ms: 0, end_ms: 1400, text: "Intro." },
                { id: 11, segment_index: 1, start_ms: 1400, end_ms: 3100, text: "Pricing overview." },
                { id: 12, segment_index: 2, start_ms: 3100, end_ms: 4700, text: "Customer objection." },
                { id: 13, segment_index: 3, start_ms: 4700, end_ms: 7000, text: "Next steps." },
                { id: 14, segment_index: 4, start_ms: 7000, end_ms: 9300, text: "Wrap up." },
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
                "https://example.com/api/memos/memo-1/transcript?startMs=2000&endMs=5000&contextBeforeMs=500&contextAfterMs=1000"
            ),
        } as NextRequest;
        const res = await GET(req, { params: Promise.resolve({ id: "memo-1" }) });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.transcript).toMatchObject({
            memoId: "memo-1",
            source: "final",
            totalDurationMs: 90000,
            windowStartMs: 1500,
            windowEndMs: 6000,
            hasMoreBefore: true,
            hasMoreAfter: true,
        });
        expect(body.transcript.segments).toEqual([
            {
                segmentId: 11,
                segmentIndex: 1,
                startMs: 1400,
                endMs: 3100,
                text: "Pricing overview.",
            },
            {
                segmentId: 12,
                segmentIndex: 2,
                startMs: 3100,
                endMs: 4700,
                text: "Customer objection.",
            },
            {
                segmentId: 13,
                segmentIndex: 3,
                startMs: 4700,
                endMs: 7000,
                text: "Next steps.",
            },
        ]);
    });

    it("falls back to live transcript segments when final transcript rows do not exist", async () => {
        (resolveMemoUserId as jest.Mock).mockResolvedValue("user_a");

        const memoSingle = jest.fn().mockResolvedValue({
            data: { id: "memo-1", duration: 30 },
            error: null,
        });
        const memoUserEq = jest.fn(() => ({ single: memoSingle }));
        const memoIdEq = jest.fn(() => ({ eq: memoUserEq }));
        const memoSelect = jest.fn(() => ({ eq: memoIdEq }));

        const segmentSelect = jest.fn(() => ({
            eq: jest.fn((column: string, value: string) => {
                expect(column).toBe("memo_id");
                expect(value).toBe("memo-1");

                return {
                    eq: jest.fn((sourceColumn: string, sourceValue: string) => {
                        expect(sourceColumn).toBe("source");

                        return {
                            order: jest.fn().mockResolvedValue({
                                data:
                                    sourceValue === "final"
                                        ? []
                                        : [
                                            {
                                                id: 20,
                                                segment_index: 0,
                                                start_ms: 0,
                                                end_ms: 1800,
                                                text: "Recovered live segment.",
                                            },
                                        ],
                                error: null,
                            }),
                        };
                    }),
                };
            }),
        }));

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
            nextUrl: new URL("https://example.com/api/memos/memo-1/transcript"),
        } as NextRequest;
        const res = await GET(req, { params: Promise.resolve({ id: "memo-1" }) });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.transcript.source).toBe("live");
        expect(body.transcript.segments).toEqual([
            {
                segmentId: 20,
                segmentIndex: 0,
                startMs: 0,
                endMs: 1800,
                text: "Recovered live segment.",
            },
        ]);
    });
});
