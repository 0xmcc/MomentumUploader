/** @jest-environment node */

import { NextRequest } from "next/server";
import { GET } from "./route";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { supabaseAdmin } from "@/lib/supabase";

jest.mock("@/lib/memo-api-auth", () => ({
    resolveMemoUserId: jest.fn(),
}));

jest.mock("@/lib/supabase");

describe("GET /api/agents/:agentId/work-items", () => {
    const previousGatewayKey = process.env.OPENCLAW_INTERNAL_API_KEY;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.OPENCLAW_INTERNAL_API_KEY = "gateway-secret";
    });

    afterAll(() => {
        process.env.OPENCLAW_INTERNAL_API_KEY = previousGatewayKey;
    });

    it("prioritizes pending invocations ahead of new messages and idle rooms", async () => {
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

        const invocationStatusIn = jest.fn(() => ({
            order: jest.fn().mockResolvedValue({
                data: [
                    {
                        id: "invocation-1",
                        agent_id: "agent-1",
                        memo_room_id: "room-1",
                        memo_id: "memo-1",
                        request_message_id: "message-1",
                        status: "pending",
                        created_at: "2026-03-16T18:00:00.000Z",
                    },
                ],
                error: null,
            }),
        }));
        const invocationAgentEq = jest.fn(() => ({ in: invocationStatusIn }));
        const invocationSelect = jest.fn(() => ({ eq: invocationAgentEq }));

        const participantStatusEq = jest.fn().mockResolvedValue({
            data: [
                { memo_room_id: "room-1", agent_id: "agent-1", status: "active" },
                { memo_room_id: "room-2", agent_id: "agent-1", status: "active" },
            ],
            error: null,
        });
        const participantAgentEq = jest.fn(() => ({ eq: participantStatusEq }));
        const participantSelect = jest.fn(() => ({ eq: participantAgentEq }));

        const roomIdIn = jest.fn().mockResolvedValue({
            data: [
                { agent_id: "agent-1", memo_room_id: "room-1", last_seen_message_id: "message-0", last_seen_transcript_segment_id: 20 },
                { agent_id: "agent-1", memo_room_id: "room-2", last_seen_message_id: "message-2", last_seen_transcript_segment_id: 30 },
            ],
            error: null,
        });
        const stateAgentEq = jest.fn(() => ({ in: roomIdIn }));
        const stateSelect = jest.fn(() => ({ eq: stateAgentEq }));

        const latestMessagesOrder = jest.fn().mockResolvedValue({
            data: [
                { id: "message-1", memo_room_id: "room-1", memo_id: "memo-1", created_at: "2026-03-16T18:00:00.000Z" },
                { id: "message-2", memo_room_id: "room-2", memo_id: "memo-2", created_at: "2026-03-16T17:00:00.000Z" },
            ],
            error: null,
        });
        const latestMessagesRoomIn = jest.fn(() => ({ order: latestMessagesOrder }));
        const latestMessagesSelect = jest.fn(() => ({ in: latestMessagesRoomIn }));

        const roomMemoRoomIn = jest.fn().mockResolvedValue({
            data: [
                { memo_room_id: "room-1", memo_id: "memo-1" },
                { memo_room_id: "room-2", memo_id: "memo-2" },
            ],
            error: null,
        });
        const roomMemoSelect = jest.fn(() => ({ in: roomMemoRoomIn }));

        const transcriptMemoIn = jest.fn(() => ({
            order: jest.fn().mockResolvedValue({
                data: [
                    { id: 21, memo_id: "memo-1" },
                    { id: 30, memo_id: "memo-2" },
                ],
                error: null,
            }),
        }));
        const transcriptSelect = jest.fn(() => ({ in: transcriptMemoIn }));

        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "agents") {
                return { select: agentSelect };
            }

            if (table === "agent_invocations") {
                return { select: invocationSelect };
            }

            if (table === "memo_room_participants") {
                return { select: participantSelect };
            }

            if (table === "agent_room_state") {
                return { select: stateSelect };
            }

            if (table === "memo_messages") {
                return { select: latestMessagesSelect };
            }

            if (table === "memo_room_memos") {
                return { select: roomMemoSelect };
            }

            if (table === "memo_transcript_segments") {
                return { select: transcriptSelect };
            }

            throw new Error(`Unexpected table ${table}`);
        });

        const req = {
            headers: new Headers({
                authorization: "Bearer owner-token",
                "x-openclaw-internal-key": "gateway-secret",
                "x-memo-agent-id": "agent-1",
            }),
        } as unknown as NextRequest;

        const res = await GET(req, { params: Promise.resolve({ agentId: "agent-1" }) });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.workItems).toEqual([
            expect.objectContaining({ type: "invocation", priority: 1, roomId: "room-1" }),
            expect.objectContaining({ type: "new_messages", priority: 2, roomId: "room-1" }),
            expect.objectContaining({ type: "idle", priority: 4, roomId: "room-2" }),
        ]);
    });
});
