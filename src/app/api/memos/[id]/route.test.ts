/** @jest-environment node */

import { auth } from "@clerk/nextjs/server";
import { GET, PATCH } from "./route";
import { supabaseAdmin } from "@/lib/supabase";
import { NextRequest } from "next/server";

jest.mock("@clerk/nextjs/server", () => ({
    auth: jest.fn(),
}));

jest.mock("@/lib/supabase");

describe("GET /api/memos/:id", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("returns 404 when the request is signed out", async () => {
        (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });

        const req = {} as NextRequest;
        const res = await GET(req, { params: Promise.resolve({ id: "memo-1" }) });
        const body = await res.json();

        expect(res.status).toBe(404);
        expect(body.error).toBe("Memo not found");
        expect(supabaseAdmin.from).not.toHaveBeenCalled();
    });

    it("returns 404 when a signed-in user requests another user's memo", async () => {
        (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user_a" });

        const single = jest.fn().mockResolvedValue({ data: null, error: { message: "not found" } });
        const userEq = jest.fn(() => ({ single }));
        const idEq = jest.fn(() => ({ eq: userEq }));
        const select = jest.fn(() => ({ eq: idEq }));
        (supabaseAdmin.from as jest.Mock).mockReturnValue({ select });

        const req = {} as NextRequest;
        const res = await GET(req, { params: Promise.resolve({ id: "memo-owned-by-user-b" }) });
        const body = await res.json();

        expect(res.status).toBe(404);
        expect(body.error).toBe("Memo not found");
        expect(idEq).toHaveBeenCalledWith("id", "memo-owned-by-user-b");
        expect(userEq).toHaveBeenCalledWith("user_id", "user_a");
    });

    it("returns final transcript segments for the memo detail view", async () => {
        (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user_a" });

        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "memos") {
                const single = jest.fn().mockResolvedValue({
                    data: {
                        id: "memo-1",
                        title: "Segmented memo",
                        transcript: "Fallback flat transcript",
                        audio_url: "https://example.com/memo-1.webm",
                        duration: 42,
                        created_at: "2026-03-15T12:00:00.000Z",
                    },
                    error: null,
                });
                const userEq = jest.fn(() => ({ single }));
                const idEq = jest.fn(() => ({ eq: userEq }));
                const select = jest.fn(() => ({ eq: idEq }));
                return { select };
            }

            if (table === "memo_transcript_segments") {
                const order = jest.fn().mockResolvedValue({
                    data: [
                        {
                            segment_index: 0,
                            start_ms: 0,
                            end_ms: 1800,
                            text: "First segment.",
                        },
                        {
                            segment_index: 1,
                            start_ms: 1800,
                            end_ms: 4200,
                            text: "Second segment.",
                        },
                    ],
                    error: null,
                });
                const sourceEq = jest.fn(() => ({ order }));
                const memoEq = jest.fn(() => ({ eq: sourceEq }));
                const select = jest.fn(() => ({ eq: memoEq }));
                return { select };
            }

            throw new Error(`Unexpected table: ${table}`);
        });

        const req = {} as NextRequest;
        const res = await GET(req, { params: Promise.resolve({ id: "memo-1" }) });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.memo.transcriptSegments).toEqual([
            {
                id: "0",
                startMs: 0,
                endMs: 1800,
                text: "First segment.",
            },
            {
                id: "1",
                startMs: 1800,
                endMs: 4200,
                text: "Second segment.",
            },
        ]);
    });
});

describe("PATCH /api/memos/:id — finalization lock", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user_a" });
    });

    function makePatchReq(body: Record<string, unknown>) {
        return {
            json: async () => body,
        } as unknown as NextRequest;
    }

    it("returns 409 when patching transcript of a completed memo", async () => {
        // First from call: status check for finalization lock
        const statusSingle = jest.fn().mockResolvedValue({
            data: { transcript_status: "complete" },
            error: null,
        });
        const statusEq2 = jest.fn(() => ({ single: statusSingle }));
        const statusEq1 = jest.fn(() => ({ eq: statusEq2 }));
        const statusSelect = jest.fn(() => ({ eq: statusEq1 }));
        (supabaseAdmin.from as jest.Mock).mockReturnValue({ select: statusSelect });

        const req = makePatchReq({ transcript: "overwrite attempt" });
        const res = await PATCH(req, { params: Promise.resolve({ id: "memo-1" }) });
        const body = await res.json();

        expect(res.status).toBe(409);
        expect(body.error).toMatch(/finalized/i);
    });

    it("returns 409 when patching transcript of a failed memo", async () => {
        const statusSingle = jest.fn().mockResolvedValue({
            data: { transcript_status: "failed" },
            error: null,
        });
        const statusEq2 = jest.fn(() => ({ single: statusSingle }));
        const statusEq1 = jest.fn(() => ({ eq: statusEq2 }));
        const statusSelect = jest.fn(() => ({ eq: statusEq1 }));
        (supabaseAdmin.from as jest.Mock).mockReturnValue({ select: statusSelect });

        const req = makePatchReq({ transcript: "overwrite attempt" });
        const res = await PATCH(req, { params: Promise.resolve({ id: "memo-1" }) });

        expect(res.status).toBe(409);
    });

    it("allows patching transcript of a processing memo", async () => {
        let callCount = 0;
        (supabaseAdmin.from as jest.Mock).mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
                // Status check: returns 'processing'
                const statusSingle = jest.fn().mockResolvedValue({
                    data: { transcript_status: "processing" },
                    error: null,
                });
                const statusEq2 = jest.fn(() => ({ single: statusSingle }));
                const statusEq1 = jest.fn(() => ({ eq: statusEq2 }));
                const statusSelect = jest.fn(() => ({ eq: statusEq1 }));
                return { select: statusSelect };
            }
            // Second call: the actual update
            const updateSingle = jest.fn().mockResolvedValue({
                data: { id: "memo-1", transcript: "new text", audio_url: "", created_at: new Date().toISOString() },
                error: null,
            });
            const updateEq2 = jest.fn(() => ({ select: jest.fn(() => ({ single: updateSingle })) }));
            const updateEq1 = jest.fn(() => ({ eq: updateEq2 }));
            const update = jest.fn(() => ({ eq: updateEq1 }));
            return { update };
        });

        const req = makePatchReq({ transcript: "new text" });
        const res = await PATCH(req, { params: Promise.resolve({ id: "memo-1" }) });

        expect(res.status).toBe(200);
    });

    it("allows patching title without checking transcript_status", async () => {
        // No status-check call; straight to update
        const updateSingle = jest.fn().mockResolvedValue({
            data: { id: "memo-1", transcript: "", audio_url: "", created_at: new Date().toISOString() },
            error: null,
        });
        const updateEq2 = jest.fn(() => ({ select: jest.fn(() => ({ single: updateSingle })) }));
        const updateEq1 = jest.fn(() => ({ eq: updateEq2 }));
        const update = jest.fn(() => ({ eq: updateEq1 }));
        (supabaseAdmin.from as jest.Mock).mockReturnValue({ update });

        const req = makePatchReq({ title: "My Title" });
        const res = await PATCH(req, { params: Promise.resolve({ id: "memo-1" }) });

        expect(res.status).toBe(200);
        // Status check should not be called for title-only patches
        const allCalls = (supabaseAdmin.from as jest.Mock).mock.calls;
        // Only one from call (the update itself, no status-check select)
        expect(allCalls.length).toBe(1);
    });
});
