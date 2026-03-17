/** @jest-environment node */

import { NextRequest } from "next/server";
import { PATCH } from "./route";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { supabaseAdmin } from "@/lib/supabase";

jest.mock("@/lib/memo-api-auth", () => ({
    resolveMemoUserId: jest.fn(),
}));

jest.mock("@/lib/supabase");

describe("PATCH /api/agents/:agentId/invocations/:invocationId", () => {
    const previousGatewayKey = process.env.OPENCLAW_INTERNAL_API_KEY;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.OPENCLAW_INTERNAL_API_KEY = "gateway-secret";
    });

    afterAll(() => {
        process.env.OPENCLAW_INTERNAL_API_KEY = previousGatewayKey;
    });

    it("marks an invocation completed and advances the agent room state", async () => {
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

        const invocationSingle = jest.fn().mockResolvedValue({
            data: {
                id: "invocation-1",
                agent_id: "agent-1",
                memo_room_id: "room-1",
                memo_id: "memo-1",
                request_message_id: "request-message-1",
                status: "pending",
            },
            error: null,
        });
        const invocationIdEq = jest.fn(() => ({ single: invocationSingle }));
        const invocationAgentEq = jest.fn(() => ({ eq: invocationIdEq }));
        const invocationSelect = jest.fn(() => ({ eq: invocationAgentEq }));

        const messageSingle = jest.fn().mockResolvedValue({
            data: {
                id: "reply-message-1",
                memo_room_id: "room-1",
                author_participant: {
                    id: "participant-agent",
                    participant_type: "agent",
                    user_id: null,
                    agent_id: "agent-1",
                },
            },
            error: null,
        });
        const messageIdEq = jest.fn(() => ({ single: messageSingle }));
        const messageSelect = jest.fn(() => ({ eq: messageIdEq }));

        const invocationUpdateSingle = jest.fn().mockResolvedValue({
            data: {
                id: "invocation-1",
                status: "completed",
                response_message_id: "reply-message-1",
            },
            error: null,
        });
        const invocationUpdateIdEq = jest.fn(() => ({
            select: jest.fn(() => ({ single: invocationUpdateSingle })),
        }));
        const invocationUpdateAgentEq = jest.fn(() => ({ eq: invocationUpdateIdEq }));
        const invocationUpdate = jest.fn(() => ({ eq: invocationUpdateAgentEq }));

        const stateRoomEq = jest.fn().mockResolvedValue({ data: null, error: null });
        const stateAgentEq = jest.fn(() => ({ eq: stateRoomEq }));
        const stateUpdate = jest.fn(() => ({ eq: stateAgentEq }));

        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "agents") {
                return { select: agentSelect };
            }

            if (table === "agent_invocations") {
                if ((supabaseAdmin.from as jest.Mock).mock.calls.length === 2) {
                    return { select: invocationSelect };
                }

                return { update: invocationUpdate };
            }

            if (table === "memo_messages") {
                return { select: messageSelect };
            }

            if (table === "agent_room_state") {
                return { update: stateUpdate };
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
                status: "completed",
                responseMessageId: "reply-message-1",
            }),
        } as unknown as NextRequest;

        const res = await PATCH(req, {
            params: Promise.resolve({ agentId: "agent-1", invocationId: "invocation-1" }),
        });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(invocationUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                status: "completed",
                response_message_id: "reply-message-1",
            })
        );
        expect(stateUpdate).toHaveBeenCalledWith({
            last_processed_invocation_id: "invocation-1",
        });
        expect(body.invocation).toMatchObject({
            id: "invocation-1",
            status: "completed",
            responseMessageId: "reply-message-1",
        });
    });
});
