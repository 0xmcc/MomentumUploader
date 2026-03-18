/** @jest-environment node */

import { NextRequest } from "next/server";
import { POST } from "./route";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { resolveMemoShare } from "@/lib/memo-share";
import { supabaseAdmin } from "@/lib/supabase";

jest.mock("@/lib/memo-api-auth", () => ({
    resolveMemoUserId: jest.fn(),
}));

jest.mock("@/lib/memo-share", () => ({
    resolveMemoShare: jest.fn(),
}));

jest.mock("@/lib/supabase", () => ({
    supabaseAdmin: {
        from: jest.fn(),
    },
}));

const sharedMemo = {
    memoId: "memo-1",
    ownerUserId: "user-owner",
    shareToken: "sharetoken1234",
    title: "Shared Memo",
    transcript: "Transcript",
    transcriptStatus: "complete",
    transcriptSegments: null,
    mediaUrl: "https://example.com/audio.webm",
    createdAt: "2026-03-16T12:00:00.000Z",
    sharedAt: "2026-03-16T12:05:00.000Z",
    expiresAt: null,
    isLiveRecording: false,
};

describe("POST /api/s/:shareRef/invite", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (resolveMemoShare as jest.Mock).mockResolvedValue({ status: "ok", memo: sharedMemo });
        (resolveMemoUserId as jest.Mock).mockResolvedValue("user-owner");
    });

    it("creates an invite nonce for the memo owner and returns copyable invite text", async () => {
        const insert = jest.fn().mockResolvedValue({ error: null });

        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "openclaw_invite_nonces") {
                return { insert };
            }

            throw new Error(`Unexpected table ${table}`);
        });

        const req = new NextRequest("https://example.com/api/s/sharetoken1234/invite", {
            method: "POST",
        });
        const res = await POST(req, { params: Promise.resolve({ shareRef: "sharetoken1234" }) });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(insert).toHaveBeenCalledWith(
            expect.objectContaining({
                share_ref: "sharetoken1234",
                owner_user_id: "user-owner",
                status: "active",
                nonce: expect.any(String),
                expires_at: expect.any(String),
            })
        );
        expect(body.expiresAt).toEqual(expect.any(String));
        expect(body.inviteText).toContain(
            "https://example.com/s/sharetoken1234?nonce="
        );
    });

    it("falls back to a share-link invite when the nonce table is unavailable", async () => {
        const insert = jest.fn().mockResolvedValue({
            error: {
                code: "42P01",
                message: 'relation "public.openclaw_invite_nonces" does not exist',
            },
        });

        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "openclaw_invite_nonces") {
                return { insert };
            }

            throw new Error(`Unexpected table ${table}`);
        });

        const req = new NextRequest("https://example.com/api/s/sharetoken1234/invite", {
            method: "POST",
        });
        const res = await POST(req, { params: Promise.resolve({ shareRef: "sharetoken1234" }) });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.expiresAt).toBeNull();
        expect(body.inviteText).toContain("https://example.com/s/sharetoken1234");
        expect(body.inviteText).not.toContain("?nonce=");
    });

    it("rejects unauthenticated and non-owner invite attempts", async () => {
        (resolveMemoUserId as jest.Mock).mockResolvedValueOnce(null);

        const unauthenticatedReq = new NextRequest(
            "https://example.com/api/s/sharetoken1234/invite",
            { method: "POST" }
        );
        const unauthenticatedRes = await POST(unauthenticatedReq, {
            params: Promise.resolve({ shareRef: "sharetoken1234" }),
        });
        expect(unauthenticatedRes.status).toBe(401);

        (resolveMemoUserId as jest.Mock).mockResolvedValueOnce("user-other");
        const forbiddenReq = new NextRequest(
            "https://example.com/api/s/sharetoken1234/invite",
            { method: "POST" }
        );
        const forbiddenRes = await POST(forbiddenReq, {
            params: Promise.resolve({ shareRef: "sharetoken1234" }),
        });
        expect(forbiddenRes.status).toBe(403);
    });

    it("matches share-token failure semantics", async () => {
        const invalidReq = new NextRequest("https://example.com/api/s/nope!/invite", {
            method: "POST",
        });
        const invalidRes = await POST(invalidReq, {
            params: Promise.resolve({ shareRef: "nope!" }),
        });
        expect(invalidRes.status).toBe(404);

        (resolveMemoShare as jest.Mock).mockResolvedValueOnce({ status: "not_found" });
        const notFoundReq = new NextRequest(
            "https://example.com/api/s/sharetoken1234/invite",
            { method: "POST" }
        );
        const notFoundRes = await POST(notFoundReq, {
            params: Promise.resolve({ shareRef: "sharetoken1234" }),
        });
        expect(notFoundRes.status).toBe(404);

        (resolveMemoShare as jest.Mock).mockResolvedValueOnce({ status: "revoked" });
        const revokedReq = new NextRequest(
            "https://example.com/api/s/sharetoken1234/invite",
            { method: "POST" }
        );
        const revokedRes = await POST(revokedReq, {
            params: Promise.resolve({ shareRef: "sharetoken1234" }),
        });
        expect(revokedRes.status).toBe(410);

        (resolveMemoShare as jest.Mock).mockResolvedValueOnce({ status: "expired" });
        const expiredReq = new NextRequest(
            "https://example.com/api/s/sharetoken1234/invite",
            { method: "POST" }
        );
        const expiredRes = await POST(expiredReq, {
            params: Promise.resolve({ shareRef: "sharetoken1234" }),
        });
        expect(expiredRes.status).toBe(410);
    });
});
