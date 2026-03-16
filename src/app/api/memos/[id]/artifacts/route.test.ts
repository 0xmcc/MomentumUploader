/** @jest-environment node */

import { auth } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { ARTIFACT_TYPES } from "@/lib/artifact-types";
import { supabaseAdmin } from "@/lib/supabase";

jest.mock("@clerk/nextjs/server", () => ({
    auth: jest.fn(),
}));

jest.mock("@/lib/supabase", () => ({
    supabaseAdmin: {
        from: jest.fn(),
    },
}));

function makeRequest(url: string) {
    return new NextRequest(url);
}

describe("GET /api/memos/:id/artifacts", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("returns 400 when the source param is missing", async () => {
        (auth as jest.Mock).mockResolvedValue({ userId: "user-1" });

        const response = await GET(makeRequest("https://example.com/api/memos/memo-1/artifacts"), {
            params: Promise.resolve({ id: "memo-1" }),
        });

        expect(response.status).toBe(400);
    });

    it("returns 400 when the source param is invalid", async () => {
        (auth as jest.Mock).mockResolvedValue({ userId: "user-1" });

        const response = await GET(
            makeRequest("https://example.com/api/memos/memo-1/artifacts?source=bad"),
            { params: Promise.resolve({ id: "memo-1" }) }
        );

        expect(response.status).toBe(400);
    });

    it("returns 401 when unauthenticated", async () => {
        (auth as jest.Mock).mockResolvedValue({ userId: null });

        const response = await GET(
            makeRequest("https://example.com/api/memos/memo-1/artifacts?source=live"),
            { params: Promise.resolve({ id: "memo-1" }) }
        );

        expect(response.status).toBe(401);
    });

    it("returns 404 when the memo is not owned by the user", async () => {
        (auth as jest.Mock).mockResolvedValue({ userId: "user-1" });
        const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
        const memoEqUser = jest.fn(() => ({ maybeSingle }));
        const memoEqId = jest.fn(() => ({ eq: memoEqUser }));
        const memoSelect = jest.fn(() => ({ eq: memoEqId }));
        (supabaseAdmin.from as jest.Mock).mockReturnValue({ select: memoSelect });

        const response = await GET(
            makeRequest("https://example.com/api/memos/memo-1/artifacts?source=live"),
            { params: Promise.resolve({ id: "memo-1" }) }
        );

        expect(response.status).toBe(404);
    });

    it("returns all artifact keys with null values when none exist", async () => {
        (auth as jest.Mock).mockResolvedValue({ userId: "user-1" });
        const maybeSingle = jest.fn().mockResolvedValue({ data: { id: "memo-1" }, error: null });
        const memoEqUser = jest.fn(() => ({ maybeSingle }));
        const memoEqId = jest.fn(() => ({ eq: memoEqUser }));
        const memoSelect = jest.fn(() => ({ eq: memoEqId }));

        const eqStatus = jest.fn().mockResolvedValue({ data: [], error: null });
        const eqSource = jest.fn(() => ({ eq: eqStatus }));
        const eqMemo = jest.fn(() => ({ eq: eqSource }));
        const artifactSelect = jest.fn(() => ({ eq: eqMemo }));

        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "memos") {
                return { select: memoSelect };
            }
            if (table === "memo_artifacts") {
                return { select: artifactSelect };
            }
            throw new Error(`Unexpected table: ${table}`);
        });

        const response = await GET(
            makeRequest("https://example.com/api/memos/memo-1/artifacts?source=live"),
            { params: Promise.resolve({ id: "memo-1" }) }
        );
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(Object.keys(body)).toEqual([...ARTIFACT_TYPES]);
        for (const artifactType of ARTIFACT_TYPES) {
            expect(body[artifactType]).toBeNull();
        }
    });

    it("returns the ready artifact entry and leaves other keys null", async () => {
        (auth as jest.Mock).mockResolvedValue({ userId: "user-1" });
        const maybeSingle = jest.fn().mockResolvedValue({ data: { id: "memo-1" }, error: null });
        const memoEqUser = jest.fn(() => ({ maybeSingle }));
        const memoEqId = jest.fn(() => ({ eq: memoEqUser }));
        const memoSelect = jest.fn(() => ({ eq: memoEqId }));

        const eqStatus = jest.fn().mockResolvedValue({
            data: [
                {
                    artifact_type: "rolling_summary",
                    payload: { summary: "Live summary" },
                    based_on_chunk_start: 0,
                    based_on_chunk_end: 2,
                    version: 3,
                    updated_at: "2026-03-15T10:00:00.000Z",
                },
            ],
            error: null,
        });
        const eqSource = jest.fn(() => ({ eq: eqStatus }));
        const eqMemo = jest.fn(() => ({ eq: eqSource }));
        const artifactSelect = jest.fn(() => ({ eq: eqMemo }));

        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "memos") {
                return { select: memoSelect };
            }
            if (table === "memo_artifacts") {
                return { select: artifactSelect };
            }
            throw new Error(`Unexpected table: ${table}`);
        });

        const response = await GET(
            makeRequest("https://example.com/api/memos/memo-1/artifacts?source=live"),
            { params: Promise.resolve({ id: "memo-1" }) }
        );
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.rolling_summary).toEqual({
            payload: { summary: "Live summary" },
            basedOnChunkStart: 0,
            basedOnChunkEnd: 2,
            version: 3,
            updatedAt: "2026-03-15T10:00:00.000Z",
        });
        expect(body.outline).toBeNull();
    });
});
