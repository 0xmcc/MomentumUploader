/** @jest-environment node */

import { auth } from "@clerk/nextjs/server";
import { GET } from "./route";
import { supabaseAdmin } from "@/lib/supabase";
import { NextRequest } from "next/server";
import { issueApiToken } from "@/lib/api-token";

jest.mock("@clerk/nextjs/server", () => ({
    auth: jest.fn(),
}));

jest.mock("@/lib/supabase", () => ({
    supabaseAdmin: {
        from: jest.fn(),
    },
}));

describe("GET /api/memos", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("returns an empty memo list when user is signed out", async () => {
        (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });

        const req = {
            nextUrl: new URL("https://example.com/api/memos"),
        } as NextRequest;

        const res = await GET(req);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body).toEqual({ memos: [], total: 0, limit: 50, offset: 0 });
        expect(supabaseAdmin.from).not.toHaveBeenCalled();
    });

    it("queries memos scoped to the authenticated user", async () => {
        (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user_abc" });

        const queryResult = {
            data: [
                {
                    id: "memo-1",
                    title: "Memo",
                    transcript: "hello world",
                    audio_url: "https://example.com/audio.webm",
                    duration: 20,
                    created_at: "2026-02-21T00:00:00.000Z",
                },
            ],
            error: null,
            count: 1,
        };
        const range = jest.fn(() => queryResult);
        const order = jest.fn(() => ({ range }));
        const eq = jest.fn(() => ({ order }));
        const select = jest.fn(() => ({ eq }));
        (supabaseAdmin.from as jest.Mock).mockReturnValue({ select });

        const req = {
            nextUrl: new URL("https://example.com/api/memos?limit=10&offset=0"),
        } as NextRequest;

        const res = await GET(req);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(eq).toHaveBeenCalledWith("user_id", "user_abc");
        expect(body.total).toBe(1);
        expect(body.memos).toHaveLength(1);
        expect(body.memos[0].id).toBe("memo-1");
        expect(body.memos[0].wordCount).toBe(2);
    });

    it("accepts a bearer api token when no session cookie exists", async () => {
        (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });
        process.env.MEMOS_API_TOKEN_SECRET = "test-secret";
        const { token } = issueApiToken({
            userId: "user_token",
            ttlSeconds: 3600,
        });

        const queryResult = {
            data: [
                {
                    id: "memo-token-1",
                    title: "Memo",
                    transcript: "token auth works",
                    audio_url: "https://example.com/audio.webm",
                    duration: 20,
                    created_at: "2026-02-21T00:00:00.000Z",
                },
            ],
            error: null,
            count: 1,
        };
        const range = jest.fn(() => queryResult);
        const order = jest.fn(() => ({ range }));
        const eq = jest.fn(() => ({ order }));
        const select = jest.fn(() => ({ eq }));
        (supabaseAdmin.from as jest.Mock).mockReturnValue({ select });

        const req = {
            nextUrl: new URL("https://example.com/api/memos?limit=10&offset=0"),
            headers: new Headers({ Authorization: `Bearer ${token}` }),
        } as NextRequest;

        const res = await GET(req);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(eq).toHaveBeenCalledWith("user_id", "user_token");
        expect(body.total).toBe(1);
        expect(body.memos[0].id).toBe("memo-token-1");
    });
});
