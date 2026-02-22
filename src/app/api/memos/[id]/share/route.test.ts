/** @jest-environment node */

import { POST } from "./route";
import { supabaseAdmin } from "@/lib/supabase";
import { NextRequest } from "next/server";

jest.mock("@/lib/supabase", () => ({
    supabaseAdmin: {
        from: jest.fn(),
    },
}));

type MockState = {
    currentMemo: Record<string, unknown> | null;
    currentError: { message: string } | null;
    updatedMemo: Record<string, unknown> | null;
    updateError: { message: string } | null;
};

function setupSupabaseMock(state: MockState) {
    const maybeSingle = jest.fn().mockResolvedValue({
        data: state.currentMemo,
        error: state.currentError,
    });
    const eqAfterSelect = jest.fn(() => ({ maybeSingle }));
    const selectAfterEq = jest.fn(() => ({ eq: eqAfterSelect }));

    const single = jest.fn().mockResolvedValue({
        data: state.updatedMemo,
        error: state.updateError,
    });
    const selectAfterUpdate = jest.fn(() => ({ single }));
    const eqAfterUpdate = jest.fn(() => ({ select: selectAfterUpdate }));
    const update = jest.fn(() => ({ eq: eqAfterUpdate }));

    (supabaseAdmin.from as jest.Mock).mockReturnValue({
        select: selectAfterEq,
        eq: eqAfterSelect,
        update,
    });

    return { update };
}

describe("POST /api/memos/:id/share", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("returns existing active share link when token is already valid", async () => {
        setupSupabaseMock({
            currentMemo: {
                id: "memo-1",
                share_token: "token1234abcd",
                revoked_at: null,
                is_shareable: true,
                share_expires_at: null,
            },
            currentError: null,
            updatedMemo: null,
            updateError: null,
        });

        const req = {
            nextUrl: { origin: "https://example.com" },
        } as NextRequest;

        const res = await POST(req, { params: Promise.resolve({ id: "memo-1" }) });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.shareToken).toBe("token1234abcd");
        expect(body.shareUrl).toBe("https://example.com/s/token1234abcd");
    });

    it("creates and returns a new share link when token is missing", async () => {
        const { update } = setupSupabaseMock({
            currentMemo: {
                id: "memo-2",
                share_token: null,
                revoked_at: null,
                is_shareable: true,
            },
            currentError: null,
            updatedMemo: {
                id: "memo-2",
                share_token: "newtokenabcd1234",
            },
            updateError: null,
        });

        const req = {
            nextUrl: { origin: "https://example.com" },
        } as NextRequest;

        const res = await POST(req, { params: Promise.resolve({ id: "memo-2" }) });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.memoId).toBe("memo-2");
        expect(body.shareToken).toBe("newtokenabcd1234");
        expect(body.shareUrl).toBe("https://example.com/s/newtokenabcd1234");
        expect(update).toHaveBeenCalled();
        const updatesArg = update.mock.calls[0][0] as Record<string, unknown>;
        expect(typeof updatesArg.share_token).toBe("string");
        expect((updatesArg.share_token as string).length).toBeGreaterThanOrEqual(16);
        expect(updatesArg.revoked_at).toBeNull();
        expect(updatesArg.is_shareable).toBe(true);
    });

    it("supports minimal memo schema by only updating columns that exist", async () => {
        const { update } = setupSupabaseMock({
            currentMemo: {
                id: "memo-3",
                title: "Legacy memo row",
                transcript: "hello",
                audio_url: "https://example.com/audio.webm",
                created_at: "2026-02-22T00:00:00.000Z",
            },
            currentError: null,
            updatedMemo: {
                id: "memo-3",
                share_token: "legacytoken1234",
            },
            updateError: null,
        });

        const req = {
            nextUrl: { origin: "https://example.com" },
        } as NextRequest;

        const res = await POST(req, { params: Promise.resolve({ id: "memo-3" }) });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.shareUrl).toBe("https://example.com/s/legacytoken1234");

        const updatesArg = update.mock.calls[0][0] as Record<string, unknown>;
        expect(typeof updatesArg.share_token).toBe("string");
        expect(updatesArg).not.toHaveProperty("shared_at");
        expect(updatesArg).not.toHaveProperty("revoked_at");
        expect(updatesArg).not.toHaveProperty("is_shareable");
        expect(updatesArg).not.toHaveProperty("share_expires_at");
        expect(updatesArg).not.toHaveProperty("expires_at");
    });

    it("returns 404 when memo does not exist", async () => {
        setupSupabaseMock({
            currentMemo: null,
            currentError: null,
            updatedMemo: null,
            updateError: null,
        });

        const req = {
            nextUrl: { origin: "https://example.com" },
        } as NextRequest;

        const res = await POST(req, { params: Promise.resolve({ id: "missing" }) });
        const body = await res.json();

        expect(res.status).toBe(404);
        expect(body.error).toBe("Memo not found");
    });
});
