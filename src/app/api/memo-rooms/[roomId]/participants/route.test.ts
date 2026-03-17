/** @jest-environment node */

import { NextRequest } from "next/server";
import { POST } from "./route";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { supabaseAdmin } from "@/lib/supabase";

jest.mock("@/lib/memo-api-auth", () => ({
    resolveMemoUserId: jest.fn(),
}));

jest.mock("@/lib/supabase");

describe("POST /api/memo-rooms/:roomId/participants", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("invites an owned agent and seeds agent room state", async () => {
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

        const agentSingle = jest.fn().mockResolvedValue({
            data: {
                id: "agent-1",
                owner_user_id: "owner-user",
                name: "Coach",
                status: "active",
            },
            error: null,
        });
        const agentIdEq = jest.fn(() => ({ single: agentSingle }));
        const agentSelect = jest.fn(() => ({ eq: agentIdEq }));

        const participantInsert = jest.fn(() => ({
            select: jest.fn(() => ({
                single: jest.fn().mockResolvedValue({
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
                }),
            })),
        }));

        const stateInsert = jest.fn().mockResolvedValue({ data: null, error: null });

        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "memo_room_participants") {
                if ((supabaseAdmin.from as jest.Mock).mock.calls.length === 1) {
                    return { select: ownerSelect };
                }

                return { insert: participantInsert };
            }

            if (table === "agents") {
                return { select: agentSelect };
            }

            if (table === "agent_room_state") {
                return { insert: stateInsert };
            }

            throw new Error(`Unexpected table ${table}`);
        });

        const req = {
            json: jest.fn().mockResolvedValue({
                participantType: "agent",
                agentId: "agent-1",
                capability: "comment_only",
                defaultVisibility: "owner_only",
            }),
        } as unknown as NextRequest;

        const res = await POST(req, { params: Promise.resolve({ roomId: "room-1" }) });
        const body = await res.json();

        expect(res.status).toBe(201);
        expect(participantInsert).toHaveBeenCalledWith({
            memo_room_id: "room-1",
            participant_type: "agent",
            agent_id: "agent-1",
            role: "member",
            capability: "comment_only",
            default_visibility: "owner_only",
            status: "active",
            invited_by_user_id: "owner-user",
        });
        expect(stateInsert).toHaveBeenCalledWith({
            agent_id: "agent-1",
            memo_room_id: "room-1",
            default_visibility: "owner_only",
        });
        expect(body.participant).toMatchObject({
            id: "participant-agent",
            participantType: "agent",
            agentId: "agent-1",
            defaultVisibility: "owner_only",
        });
    });
});
