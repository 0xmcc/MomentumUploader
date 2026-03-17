/** @jest-environment node */

import { auth } from "@clerk/nextjs/server";
import { GET, POST } from "./route";
import {
    findMemoDiscussion,
    getOrCreateMemoDiscussion,
} from "@/lib/memo-discussion";
import { resolveMemoShare } from "@/lib/memo-share";
import { supabaseAdmin } from "@/lib/supabase";

jest.mock("@clerk/nextjs/server", () => ({
    auth: jest.fn(),
}));

jest.mock("@/lib/memo-share", () => ({
    resolveMemoShare: jest.fn(),
}));

jest.mock("@/lib/memo-discussion", () => ({
    findMemoDiscussion: jest.fn(),
    getOrCreateMemoDiscussion: jest.fn(),
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

describe("share discussion route", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (resolveMemoShare as jest.Mock).mockResolvedValue({ status: "ok", memo: sharedMemo });
        (auth as jest.Mock).mockResolvedValue({ userId: null });
        (findMemoDiscussion as jest.Mock).mockResolvedValue(null);
    });

    it("returns public discussion messages for a valid share and reports owner/auth state independently of room existence", async () => {
        (auth as jest.Mock).mockResolvedValue({ userId: "user-owner" });
        (findMemoDiscussion as jest.Mock).mockResolvedValue({
            roomId: "room-1",
            ownerParticipantId: "participant-owner",
        });

        const order = jest.fn().mockResolvedValue({
            data: [
                {
                    id: "message-1",
                    memo_id: "memo-1",
                    author_participant_id: "participant-owner",
                    content: "First public note",
                    visibility: "public",
                    restricted_participant_ids: null,
                    reply_to_message_id: null,
                    root_message_id: "message-1",
                    anchor_start_ms: 12000,
                    anchor_end_ms: null,
                    anchor_segment_ids: null,
                    created_at: "2026-03-16T12:10:00.000Z",
                    author_participant: {
                        id: "participant-owner",
                        participant_type: "human",
                        user_id: "user-owner",
                        role: "owner",
                    },
                },
            ],
            error: null,
        });
        const visibilityEq = jest.fn(() => ({ order }));
        const roomEq = jest.fn(() => ({ eq: visibilityEq }));
        const select = jest.fn(() => ({ eq: roomEq }));

        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "memo_messages") {
                return { select };
            }

            throw new Error(`Unexpected table ${table}`);
        });

        const res = await GET(
            new Request("https://example.com/api/s/sharetoken1234/discussion"),
            { params: Promise.resolve({ shareRef: "sharetoken1234" }) }
        );
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body).toEqual({
            messages: [
                {
                    id: "message-1",
                    memoId: "memo-1",
                    authorName: "Owner",
                    content: "First public note",
                    anchorStartMs: 12000,
                    createdAt: "2026-03-16T12:10:00.000Z",
                },
            ],
            isOwner: true,
            isAuthenticated: true,
        });
        expect(roomEq).toHaveBeenCalledWith("memo_room_id", "room-1");
        expect(visibilityEq).toHaveBeenCalledWith("visibility", "public");
    });

    it("returns an empty discussion instead of an error when no room exists", async () => {
        (auth as jest.Mock).mockResolvedValue({ userId: "user-owner" });
        (findMemoDiscussion as jest.Mock).mockResolvedValue(null);

        const res = await GET(
            new Request("https://example.com/api/s/sharetoken1234/discussion"),
            { params: Promise.resolve({ shareRef: "sharetoken1234" }) }
        );
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body).toEqual({
            messages: [],
            isOwner: true,
            isAuthenticated: true,
        });
        expect(supabaseAdmin.from).not.toHaveBeenCalled();
    });

    it("matches existing share-token failure semantics", async () => {
        const invalidRes = await GET(
            new Request("https://example.com/api/s/nope!/discussion"),
            { params: Promise.resolve({ shareRef: "nope!" }) }
        );
        expect(invalidRes.status).toBe(404);

        (resolveMemoShare as jest.Mock).mockResolvedValueOnce({ status: "not_found" });
        const notFoundRes = await GET(
            new Request("https://example.com/api/s/sharetoken1234/discussion"),
            { params: Promise.resolve({ shareRef: "sharetoken1234" }) }
        );
        expect(notFoundRes.status).toBe(404);

        (resolveMemoShare as jest.Mock).mockResolvedValueOnce({ status: "revoked" });
        const revokedRes = await GET(
            new Request("https://example.com/api/s/sharetoken1234/discussion"),
            { params: Promise.resolve({ shareRef: "sharetoken1234" }) }
        );
        expect(revokedRes.status).toBe(410);

        (resolveMemoShare as jest.Mock).mockResolvedValueOnce({ status: "expired" });
        const expiredRes = await GET(
            new Request("https://example.com/api/s/sharetoken1234/discussion"),
            { params: Promise.resolve({ shareRef: "sharetoken1234" }) }
        );
        expect(expiredRes.status).toBe(410);
    });

    it("creates a public owner message for the memo owner", async () => {
        (auth as jest.Mock).mockResolvedValue({ userId: "user-owner" });
        (getOrCreateMemoDiscussion as jest.Mock).mockResolvedValue({
            roomId: "room-1",
            ownerParticipantId: "participant-owner",
        });

        const single = jest.fn().mockResolvedValue({
            data: {
                id: "message-1",
                memo_id: "memo-1",
                content: "Hello from the owner",
                anchor_start_ms: null,
                created_at: "2026-03-16T12:10:00.000Z",
            },
            error: null,
        });
        const select = jest.fn(() => ({ single }));
        const insert = jest.fn(() => ({ select }));

        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "memo_messages") {
                return { insert };
            }

            throw new Error(`Unexpected table ${table}`);
        });

        const res = await POST(
            new Request("https://example.com/api/s/sharetoken1234/discussion", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ content: "Hello from the owner" }),
            }),
            { params: Promise.resolve({ shareRef: "sharetoken1234" }) }
        );
        const body = await res.json();

        expect(res.status).toBe(201);
        expect(getOrCreateMemoDiscussion).toHaveBeenCalledWith(
            "memo-1",
            "user-owner",
            "Shared Memo"
        );
        expect(insert).toHaveBeenCalledWith(
            expect.objectContaining({
                memo_room_id: "room-1",
                memo_id: "memo-1",
                author_participant_id: "participant-owner",
                content: "Hello from the owner",
                visibility: "public",
            })
        );
        expect(body.message).toMatchObject({
            memoId: "memo-1",
            authorName: "Owner",
            content: "Hello from the owner",
        });
    });

    it("rejects unauthenticated, non-owner, and empty discussion posts", async () => {
        const unauthenticatedRes = await POST(
            new Request("https://example.com/api/s/sharetoken1234/discussion", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ content: "Hello" }),
            }),
            { params: Promise.resolve({ shareRef: "sharetoken1234" }) }
        );
        expect(unauthenticatedRes.status).toBe(401);

        (auth as jest.Mock).mockResolvedValueOnce({ userId: "user-other" });
        const forbiddenRes = await POST(
            new Request("https://example.com/api/s/sharetoken1234/discussion", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ content: "Hello" }),
            }),
            { params: Promise.resolve({ shareRef: "sharetoken1234" }) }
        );
        expect(forbiddenRes.status).toBe(403);

        (auth as jest.Mock).mockResolvedValueOnce({ userId: "user-owner" });
        const invalidRes = await POST(
            new Request("https://example.com/api/s/sharetoken1234/discussion", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ content: "   " }),
            }),
            { params: Promise.resolve({ shareRef: "sharetoken1234" }) }
        );
        expect(invalidRes.status).toBe(422);
    });
});
