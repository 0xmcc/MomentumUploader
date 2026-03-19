/** @jest-environment node */

import { NextRequest } from "next/server";
import { GET, POST } from "./route";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { lookupRuntimeByCredential } from "@/lib/openclaw-registry";
import { supabaseAdmin } from "@/lib/supabase";

jest.mock("@/lib/memo-api-auth", () => ({
    resolveMemoUserId: jest.fn(),
}));

jest.mock("@/lib/openclaw-registry", () => ({
    lookupRuntimeByCredential: jest.fn(),
}));

jest.mock("@/lib/supabase");

describe("GET /api/memo-rooms/:roomId/messages", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("shows owner-only agent messages to the room owner", async () => {
        (resolveMemoUserId as jest.Mock).mockResolvedValue("owner-user");

        const viewerSingle = jest.fn().mockResolvedValue({
            data: {
                id: "participant-owner",
                memo_room_id: "room-1",
                participant_type: "human",
                user_id: "owner-user",
                role: "owner",
                capability: "full_participation",
                status: "active",
            },
            error: null,
        });
        const viewerStatusEq = jest.fn(() => ({ single: viewerSingle }));
        const viewerUserEq = jest.fn(() => ({ eq: viewerStatusEq }));
        const viewerRoomEq = jest.fn(() => ({ eq: viewerUserEq }));
        const viewerSelect = jest.fn(() => ({ eq: viewerRoomEq }));

        const messagesOrder = jest.fn().mockResolvedValue({
            data: [
                {
                    id: "message-owner-only-agent",
                    memo_room_id: "room-1",
                    memo_id: "memo-1",
                    author_participant_id: "participant-agent",
                    content: "Private coaching note",
                    visibility: "owner_only",
                    restricted_participant_ids: null,
                    reply_to_message_id: null,
                    root_message_id: "message-owner-only-agent",
                    anchor_start_ms: null,
                    anchor_end_ms: null,
                    anchor_segment_ids: null,
                    created_at: "2026-03-16T18:00:00.000Z",
                    author_participant: {
                        id: "participant-agent",
                        participant_type: "agent",
                        user_id: null,
                        agent_id: "agent-1",
                    },
                },
            ],
            error: null,
        });
        const messagesRoomEq = jest.fn(() => ({ order: messagesOrder }));
        const messagesSelect = jest.fn(() => ({ eq: messagesRoomEq }));

        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "memo_room_participants") {
                return { select: viewerSelect };
            }

            if (table === "memo_messages") {
                return { select: messagesSelect };
            }

            throw new Error(`Unexpected table ${table}`);
        });

        const req = {
            nextUrl: new URL("https://example.com/api/memo-rooms/room-1/messages"),
        } as NextRequest;
        const res = await GET(req, { params: Promise.resolve({ roomId: "room-1" }) });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.messages).toEqual([
            expect.objectContaining({
                id: "message-owner-only-agent",
                visibility: "owner_only",
                content: "Private coaching note",
            }),
        ]);
    });

    it("filters owner-only and restricted messages out of another participant's timeline", async () => {
        (resolveMemoUserId as jest.Mock).mockResolvedValue("viewer-user");

        const viewerSingle = jest.fn().mockResolvedValue({
            data: {
                id: "participant-viewer",
                memo_room_id: "room-1",
                participant_type: "human",
                user_id: "viewer-user",
                role: "member",
                capability: "full_participation",
                status: "active",
            },
            error: null,
        });
        const viewerStatusEq = jest.fn(() => ({ single: viewerSingle }));
        const viewerUserEq = jest.fn(() => ({ eq: viewerStatusEq }));
        const viewerRoomEq = jest.fn(() => ({ eq: viewerUserEq }));
        const viewerSelect = jest.fn(() => ({ eq: viewerRoomEq }));

        const messagesOrder = jest.fn().mockResolvedValue({
            data: [
                {
                    id: "message-public",
                    memo_room_id: "room-1",
                    memo_id: "memo-1",
                    author_participant_id: "participant-owner",
                    content: "Visible to everyone",
                    visibility: "public",
                    restricted_participant_ids: null,
                    reply_to_message_id: null,
                    root_message_id: "message-public",
                    anchor_start_ms: null,
                    anchor_end_ms: null,
                    anchor_segment_ids: null,
                    created_at: "2026-03-16T18:00:00.000Z",
                    author_participant: {
                        id: "participant-owner",
                        participant_type: "human",
                        user_id: "owner-user",
                        agent_id: null,
                    },
                },
                {
                    id: "message-owner-only",
                    memo_room_id: "room-1",
                    memo_id: "memo-1",
                    author_participant_id: "participant-owner",
                    content: "Owner only",
                    visibility: "owner_only",
                    restricted_participant_ids: null,
                    reply_to_message_id: null,
                    root_message_id: "message-owner-only",
                    anchor_start_ms: null,
                    anchor_end_ms: null,
                    anchor_segment_ids: null,
                    created_at: "2026-03-16T18:01:00.000Z",
                    author_participant: {
                        id: "participant-owner",
                        participant_type: "human",
                        user_id: "owner-user",
                        agent_id: null,
                    },
                },
                {
                    id: "message-restricted",
                    memo_room_id: "room-1",
                    memo_id: "memo-1",
                    author_participant_id: "participant-owner",
                    content: "Restricted",
                    visibility: "restricted",
                    restricted_participant_ids: ["participant-owner"],
                    reply_to_message_id: null,
                    root_message_id: "message-restricted",
                    anchor_start_ms: null,
                    anchor_end_ms: null,
                    anchor_segment_ids: null,
                    created_at: "2026-03-16T18:02:00.000Z",
                    author_participant: {
                        id: "participant-owner",
                        participant_type: "human",
                        user_id: "owner-user",
                        agent_id: null,
                    },
                },
            ],
            error: null,
        });
        const messagesRoomEq = jest.fn(() => ({ order: messagesOrder }));
        const messagesSelect = jest.fn(() => ({ eq: messagesRoomEq }));

        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "memo_room_participants") {
                return { select: viewerSelect };
            }

            if (table === "memo_messages") {
                return { select: messagesSelect };
            }

            throw new Error(`Unexpected table ${table}`);
        });

        const req = {
            nextUrl: new URL("https://example.com/api/memo-rooms/room-1/messages"),
        } as NextRequest;
        const res = await GET(req, { params: Promise.resolve({ roomId: "room-1" }) });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.messages).toEqual([
            expect.objectContaining({
                id: "message-public",
                visibility: "public",
                content: "Visible to everyone",
            }),
        ]);
    });
});

describe("POST /api/memo-rooms/:roomId/messages", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (lookupRuntimeByCredential as jest.Mock).mockResolvedValue(null);
    });

    it("allows an active agent participant to post via the internal agent gateway", async () => {
        process.env.OPENCLAW_INTERNAL_API_KEY = "gateway-secret";
        (resolveMemoUserId as jest.Mock).mockResolvedValue("owner-user");

        const agentSingle = jest.fn().mockResolvedValue({
            data: {
                id: "agent-1",
                owner_user_id: "owner-user",
                status: "active",
            },
            error: null,
        });
        const agentIdEq = jest.fn(() => ({ single: agentSingle }));
        const agentSelect = jest.fn(() => ({ eq: agentIdEq }));

        const participantSingle = jest.fn().mockResolvedValue({
            data: {
                id: "participant-agent",
                memo_room_id: "room-1",
                participant_type: "agent",
                user_id: null,
                agent_id: "agent-1",
                role: "member",
                capability: "comment_only",
                default_visibility: "owner_only",
                status: "active",
            },
            error: null,
        });
        const participantStatusEq = jest.fn(() => ({ single: participantSingle }));
        const participantAgentEq = jest.fn(() => ({ eq: participantStatusEq }));
        const participantRoomEq = jest.fn(() => ({ eq: participantAgentEq }));
        const participantSelect = jest.fn(() => ({ eq: participantRoomEq }));

        const roomMemoMemoEq = jest.fn(() => ({ single: jest.fn().mockResolvedValue({ data: { memo_id: "memo-1" }, error: null }) }));
        const roomMemoRoomEq = jest.fn(() => ({ eq: roomMemoMemoEq }));
        const roomMemoSelect = jest.fn(() => ({ eq: roomMemoRoomEq }));

        const insertSingle = jest.fn().mockResolvedValue({
            data: {
                id: "generated-agent-message-id",
                memo_room_id: "room-1",
                memo_id: "memo-1",
                author_participant_id: "participant-agent",
                content: "Private coaching note",
                visibility: "owner_only",
                restricted_participant_ids: null,
                reply_to_message_id: null,
                root_message_id: "generated-agent-message-id",
                anchor_start_ms: null,
                anchor_end_ms: null,
                anchor_segment_ids: null,
                created_at: "2026-03-16T18:10:00.000Z",
            },
            error: null,
        });
        const insert = jest.fn(() => ({
            select: jest.fn(() => ({ single: insertSingle })),
        }));

        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "agents") {
                return { select: agentSelect };
            }

            if (table === "memo_room_participants") {
                return { select: participantSelect };
            }

            if (table === "memo_room_memos") {
                return { select: roomMemoSelect };
            }

            if (table === "memo_messages") {
                return { insert };
            }

            throw new Error(`Unexpected table ${table}`);
        });

        const req = {
            headers: new Headers({
                authorization: "Bearer owner-token",
                "x-openclaw-internal-key": "gateway-secret",
                "x-memo-agent-id": "agent-1",
            }),
            json: jest.fn().mockResolvedValue({
                memoId: "memo-1",
                content: "Private coaching note",
            }),
        } as unknown as NextRequest;

        const res = await POST(req, { params: Promise.resolve({ roomId: "room-1" }) });
        const body = await res.json();

        expect(res.status).toBe(201);
        expect(insert).toHaveBeenCalledWith(
            expect.objectContaining({
                author_participant_id: "participant-agent",
                visibility: "owner_only",
            })
        );
        expect(body.message).toMatchObject({
            id: "generated-agent-message-id",
            authorParticipantId: "participant-agent",
            visibility: "owner_only",
        });
    });

    it("allows an OpenClaw runtime to post with its registered API key after claim", async () => {
        (resolveMemoUserId as jest.Mock).mockResolvedValue(null);
        (lookupRuntimeByCredential as jest.Mock).mockResolvedValue({
            openclaw_external_id: "oc_acct_123",
        });

        const agentSingle = jest.fn().mockResolvedValue({
            data: {
                id: "agent-1",
                owner_user_id: "owner-user",
                name: "Tobbot",
                description: null,
                status: "active",
                created_at: "2026-03-18T00:00:00.000Z",
            },
            error: null,
        });
        const agentExternalIdEq = jest.fn(() => ({ single: agentSingle }));
        const agentSelect = jest.fn(() => ({ eq: agentExternalIdEq }));

        const participantSingle = jest.fn().mockResolvedValue({
            data: {
                id: "participant-agent",
                memo_room_id: "room-1",
                participant_type: "agent",
                user_id: null,
                agent_id: "agent-1",
                role: "member",
                capability: "comment_only",
                default_visibility: "owner_only",
                status: "active",
            },
            error: null,
        });
        const participantStatusEq = jest.fn(() => ({ single: participantSingle }));
        const participantAgentEq = jest.fn(() => ({ eq: participantStatusEq }));
        const participantRoomEq = jest.fn(() => ({ eq: participantAgentEq }));
        const participantSelect = jest.fn(() => ({ eq: participantRoomEq }));

        const roomMemoSingle = jest.fn().mockResolvedValue({
            data: { memo_id: "memo-1" },
            error: null,
        });
        const roomMemoMemoEq = jest.fn(() => ({ single: roomMemoSingle }));
        const roomMemoRoomEq = jest.fn(() => ({ eq: roomMemoMemoEq }));
        const roomMemoSelect = jest.fn(() => ({ eq: roomMemoRoomEq }));

        const insertSingle = jest.fn().mockResolvedValue({
            data: {
                id: "generated-agent-message-id",
                memo_room_id: "room-1",
                memo_id: "memo-1",
                author_participant_id: "participant-agent",
                content: "Yo Marko - Tobbot here.",
                visibility: "owner_only",
                restricted_participant_ids: null,
                reply_to_message_id: null,
                root_message_id: "generated-agent-message-id",
                anchor_start_ms: null,
                anchor_end_ms: null,
                anchor_segment_ids: null,
                created_at: "2026-03-18T18:10:00.000Z",
            },
            error: null,
        });
        const insert = jest.fn(() => ({
            select: jest.fn(() => ({ single: insertSingle })),
        }));

        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "agents") {
                return { select: agentSelect };
            }

            if (table === "memo_room_participants") {
                return { select: participantSelect };
            }

            if (table === "memo_room_memos") {
                return { select: roomMemoSelect };
            }

            if (table === "memo_messages") {
                return { insert };
            }

            throw new Error(`Unexpected table ${table}`);
        });

        const req = {
            headers: new Headers({
                "x-openclaw-api-key": "oc_acct_123:secret-xyz",
            }),
            json: jest.fn().mockResolvedValue({
                memoId: "memo-1",
                content: "Yo Marko - Tobbot here.",
            }),
        } as unknown as NextRequest;

        const res = await POST(req, { params: Promise.resolve({ roomId: "room-1" }) });
        const body = await res.json();

        expect(res.status).toBe(201);
        expect(insert).toHaveBeenCalledWith(
            expect.objectContaining({
                author_participant_id: "participant-agent",
                visibility: "owner_only",
            })
        );
        expect(body.message).toMatchObject({
            id: "generated-agent-message-id",
            authorParticipantId: "participant-agent",
            visibility: "owner_only",
        });
    });

    it("ignores client-supplied thread fields and computes a top-level root on the server", async () => {
        (resolveMemoUserId as jest.Mock).mockResolvedValue("owner-user");

        const participantSingle = jest.fn().mockResolvedValue({
            data: {
                id: "participant-owner",
                memo_room_id: "room-1",
                participant_type: "human",
                user_id: "owner-user",
                role: "owner",
                capability: "full_participation",
                status: "active",
            },
            error: null,
        });
        const participantStatusEq = jest.fn(() => ({ single: participantSingle }));
        const participantUserEq = jest.fn(() => ({ eq: participantStatusEq }));
        const participantRoomEq = jest.fn(() => ({ eq: participantUserEq }));
        const participantSelect = jest.fn(() => ({ eq: participantRoomEq }));

        const roomMemoSingle = jest.fn().mockResolvedValue({
            data: { memo_id: "memo-1" },
            error: null,
        });
        const roomMemoMemoEq = jest.fn(() => ({ single: roomMemoSingle }));
        const roomMemoRoomEq = jest.fn(() => ({ eq: roomMemoMemoEq }));
        const roomMemoSelect = jest.fn(() => ({ eq: roomMemoRoomEq }));

        const durationSingle = jest.fn().mockResolvedValue({
            data: { id: "memo-1", duration: 120 },
            error: null,
        });
        const durationIdEq = jest.fn(() => ({ single: durationSingle }));
        const durationSelect = jest.fn(() => ({ eq: durationIdEq }));

        const segmentIn = jest.fn().mockResolvedValue({
            data: [
                { id: 10, start_ms: 1000, end_ms: 2500 },
                { id: 11, start_ms: 2500, end_ms: 4000 },
            ],
            error: null,
        });
        const segmentMemoEq = jest.fn(() => ({ in: segmentIn }));
        const segmentSelect = jest.fn(() => ({ eq: segmentMemoEq }));

        const insertSingle = jest.fn().mockResolvedValue({
            data: {
                id: "generated-message-id",
                memo_room_id: "room-1",
                memo_id: "memo-1",
                author_participant_id: "participant-owner",
                content: "Summarize this",
                visibility: "public",
                restricted_participant_ids: null,
                reply_to_message_id: null,
                root_message_id: "generated-message-id",
                anchor_start_ms: 1000,
                anchor_end_ms: 4000,
                anchor_segment_ids: [10, 11],
                created_at: "2026-03-16T18:10:00.000Z",
            },
            error: null,
        });
        const insert = jest.fn(() => ({
            select: jest.fn(() => ({ single: insertSingle })),
        }));

        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "memo_room_participants") {
                return { select: participantSelect };
            }

            if (table === "memo_room_memos") {
                return { select: roomMemoSelect };
            }

            if (table === "memos") {
                return { select: durationSelect };
            }

            if (table === "memo_transcript_segments") {
                return { select: segmentSelect };
            }

            if (table === "memo_messages") {
                return { insert };
            }

            throw new Error(`Unexpected table ${table}`);
        });

        const req = {
            json: jest.fn().mockResolvedValue({
                memoId: "memo-1",
                content: "Summarize this",
                visibility: "public",
                rootMessageId: "client-controlled-root",
                replyToMessageId: "client-controlled-parent",
                anchorStartMs: 1000,
                anchorEndMs: 4000,
                anchorSegmentIds: [10, 11],
            }),
        } as unknown as NextRequest;

        const res = await POST(req, { params: Promise.resolve({ roomId: "room-1" }) });
        const body = await res.json();

        expect(res.status).toBe(201);
        expect(insert).toHaveBeenCalledWith(
            expect.objectContaining({
                memo_room_id: "room-1",
                memo_id: "memo-1",
                author_participant_id: "participant-owner",
                content: "Summarize this",
                reply_to_message_id: null,
                root_message_id: expect.any(String),
            })
        );
        const inserted = insert.mock.calls[0][0] as Record<string, unknown>;
        expect(inserted.reply_to_message_id).toBeNull();
        expect(inserted.root_message_id).toBe(inserted.id);
        expect(body.message).toMatchObject({
            id: "generated-message-id",
            rootMessageId: "generated-message-id",
            replyToMessageId: null,
        });
    });

    it("rejects anchors that exceed the memo's transcript bounds", async () => {
        (resolveMemoUserId as jest.Mock).mockResolvedValue("owner-user");

        const participantSingle = jest.fn().mockResolvedValue({
            data: {
                id: "participant-owner",
                memo_room_id: "room-1",
                participant_type: "human",
                user_id: "owner-user",
                role: "owner",
                capability: "full_participation",
                status: "active",
            },
            error: null,
        });
        const participantStatusEq = jest.fn(() => ({ single: participantSingle }));
        const participantUserEq = jest.fn(() => ({ eq: participantStatusEq }));
        const participantRoomEq = jest.fn(() => ({ eq: participantUserEq }));
        const participantSelect = jest.fn(() => ({ eq: participantRoomEq }));

        const roomMemoSingle = jest.fn().mockResolvedValue({
            data: { memo_id: "memo-1" },
            error: null,
        });
        const roomMemoMemoEq = jest.fn(() => ({ single: roomMemoSingle }));
        const roomMemoRoomEq = jest.fn(() => ({ eq: roomMemoMemoEq }));
        const roomMemoSelect = jest.fn(() => ({ eq: roomMemoRoomEq }));

        const durationSingle = jest.fn().mockResolvedValue({
            data: { id: "memo-1", duration: 10 },
            error: null,
        });
        const durationIdEq = jest.fn(() => ({ single: durationSingle }));
        const durationSelect = jest.fn(() => ({ eq: durationIdEq }));

        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "memo_room_participants") {
                return { select: participantSelect };
            }

            if (table === "memo_room_memos") {
                return { select: roomMemoSelect };
            }

            if (table === "memos") {
                return { select: durationSelect };
            }

            throw new Error(`Unexpected table ${table}`);
        });

        const req = {
            json: jest.fn().mockResolvedValue({
                memoId: "memo-1",
                content: "Out of bounds",
                visibility: "public",
                anchorStartMs: 1000,
                anchorEndMs: 12000,
            }),
        } as unknown as NextRequest;

        const res = await POST(req, { params: Promise.resolve({ roomId: "room-1" }) });
        const body = await res.json();

        expect(res.status).toBe(422);
        expect(body.error).toBe("Invalid transcript anchor");
    });

    it("requires memoId when a room has multiple attached memos", async () => {
        (resolveMemoUserId as jest.Mock).mockResolvedValue("owner-user");

        const participantSingle = jest.fn().mockResolvedValue({
            data: {
                id: "participant-owner",
                memo_room_id: "room-1",
                participant_type: "human",
                user_id: "owner-user",
                role: "owner",
                capability: "full_participation",
                status: "active",
            },
            error: null,
        });
        const participantStatusEq = jest.fn(() => ({ single: participantSingle }));
        const participantUserEq = jest.fn(() => ({ eq: participantStatusEq }));
        const participantRoomEq = jest.fn(() => ({ eq: participantUserEq }));
        const participantSelect = jest.fn(() => ({ eq: participantRoomEq }));

        const roomMemoRoomEq = jest.fn().mockResolvedValue({
            data: [{ memo_id: "memo-1" }, { memo_id: "memo-2" }],
            error: null,
        });
        const roomMemoSelect = jest.fn(() => ({ eq: roomMemoRoomEq }));

        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "memo_room_participants") {
                return { select: participantSelect };
            }

            if (table === "memo_room_memos") {
                return { select: roomMemoSelect };
            }

            throw new Error(`Unexpected table ${table}`);
        });

        const req = {
            json: jest.fn().mockResolvedValue({
                content: "General note",
                visibility: "public",
            }),
        } as unknown as NextRequest;

        const res = await POST(req, { params: Promise.resolve({ roomId: "room-1" }) });
        const body = await res.json();

        expect(res.status).toBe(422);
        expect(body.error).toBe("'memoId' is required when a room has multiple memos");
    });
});
