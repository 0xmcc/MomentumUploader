/** @jest-environment node */

import { NextRequest } from "next/server";
import { POST } from "./route";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { supabaseAdmin } from "@/lib/supabase";

jest.mock("@/lib/memo-api-auth", () => ({
    resolveMemoUserId: jest.fn(),
}));

jest.mock("@/lib/supabase");

describe("POST /api/memo-rooms/:roomId/invocations", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("creates an owner request message and a durable agent invocation", async () => {
        (resolveMemoUserId as jest.Mock).mockResolvedValue("owner-user");

        const ownerSingle = jest.fn().mockResolvedValue({
            data: {
                id: "participant-owner",
                memo_room_id: "room-1",
                participant_type: "human",
                user_id: "owner-user",
                role: "owner",
                capability: "full_participation",
                default_visibility: "public",
                status: "active",
            },
            error: null,
        });
        const ownerStatusEq = jest.fn(() => ({ single: ownerSingle }));
        const ownerUserEq = jest.fn(() => ({ eq: ownerStatusEq }));
        const ownerRoomEq = jest.fn(() => ({ eq: ownerUserEq }));
        const ownerSelect = jest.fn(() => ({ eq: ownerRoomEq }));

        const agentParticipantSingle = jest.fn().mockResolvedValue({
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
        const agentParticipantStatusEq = jest.fn(() => ({ single: agentParticipantSingle }));
        const agentParticipantAgentEq = jest.fn(() => ({ eq: agentParticipantStatusEq }));
        const agentParticipantRoomEq = jest.fn(() => ({ eq: agentParticipantAgentEq }));
        const agentParticipantSelect = jest.fn(() => ({ eq: agentParticipantRoomEq }));

        const roomMemoMemoEq = jest.fn(() => ({ single: jest.fn().mockResolvedValue({ data: { memo_id: "memo-1" }, error: null }) }));
        const roomMemoRoomEq = jest.fn(() => ({ eq: roomMemoMemoEq }));
        const roomMemoSelect = jest.fn(() => ({ eq: roomMemoRoomEq }));

        const memoSingle = jest.fn().mockResolvedValue({
            data: { id: "memo-1", duration: 120 },
            error: null,
        });
        const memoIdEq = jest.fn(() => ({ single: memoSingle }));
        const memoSelect = jest.fn(() => ({ eq: memoIdEq }));

        const messageInsert = jest.fn(() => ({
            select: jest.fn(() => ({
                single: jest.fn().mockResolvedValue({
                    data: {
                        id: "request-message-1",
                        memo_room_id: "room-1",
                        memo_id: "memo-1",
                        author_participant_id: "participant-owner",
                        content: "Summarize the objection section",
                        visibility: "owner_only",
                        restricted_participant_ids: null,
                        reply_to_message_id: null,
                        root_message_id: "request-message-1",
                        anchor_start_ms: 1000,
                        anchor_end_ms: 4000,
                        anchor_segment_ids: [10, 11],
                        created_at: "2026-03-16T18:10:00.000Z",
                    },
                    error: null,
                }),
            })),
        }));

        const invocationInsert = jest.fn(() => ({
            select: jest.fn(() => ({
                single: jest.fn().mockResolvedValue({
                    data: {
                        id: "invocation-1",
                        agent_id: "agent-1",
                        memo_room_id: "room-1",
                        memo_id: "memo-1",
                        request_message_id: "request-message-1",
                        invoked_by_user_id: "owner-user",
                        status: "pending",
                        created_at: "2026-03-16T18:10:00.000Z",
                    },
                    error: null,
                }),
            })),
        }));

        const segmentIn = jest.fn().mockResolvedValue({
            data: [
                { id: 10, start_ms: 1000, end_ms: 2500 },
                { id: 11, start_ms: 2500, end_ms: 4000 },
            ],
            error: null,
        });
        const segmentMemoEq = jest.fn(() => ({ in: segmentIn }));
        const segmentSelect = jest.fn(() => ({ eq: segmentMemoEq }));

        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "memo_room_participants") {
                if ((supabaseAdmin.from as jest.Mock).mock.calls.length === 1) {
                    return { select: ownerSelect };
                }

                return { select: agentParticipantSelect };
            }

            if (table === "memo_room_memos") {
                return { select: roomMemoSelect };
            }

            if (table === "memos") {
                return { select: memoSelect };
            }

            if (table === "memo_transcript_segments") {
                return { select: segmentSelect };
            }

            if (table === "memo_messages") {
                return { insert: messageInsert };
            }

            if (table === "agent_invocations") {
                return { insert: invocationInsert };
            }

            throw new Error(`Unexpected table ${table}`);
        });

        const req = {
            json: jest.fn().mockResolvedValue({
                agentId: "agent-1",
                memoId: "memo-1",
                content: "Summarize the objection section",
                visibility: "owner_only",
                anchorStartMs: 1000,
                anchorEndMs: 4000,
                anchorSegmentIds: [10, 11],
            }),
        } as unknown as NextRequest;

        const res = await POST(req, { params: Promise.resolve({ roomId: "room-1" }) });
        const body = await res.json();

        expect(res.status).toBe(201);
        expect(messageInsert).toHaveBeenCalledWith(
            expect.objectContaining({
                author_participant_id: "participant-owner",
                visibility: "owner_only",
            })
        );
        const insertedMessage = messageInsert.mock.calls[0][0] as Record<string, unknown>;
        const insertedInvocation = invocationInsert.mock.calls[0][0] as Record<string, unknown>;
        expect(insertedInvocation).toMatchObject({
            agent_id: "agent-1",
            memo_room_id: "room-1",
            invoked_by_user_id: "owner-user",
            status: "pending",
        });
        expect(insertedInvocation.request_message_id).toBe(insertedMessage.id);
        expect(body.invocation).toMatchObject({
            id: "invocation-1",
            agentId: "agent-1",
            requestMessageId: expect.any(String),
            status: "pending",
        });
    });
});
