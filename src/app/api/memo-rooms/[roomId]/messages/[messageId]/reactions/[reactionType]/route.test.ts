/** @jest-environment node */

import { NextRequest } from "next/server";
import { DELETE } from "./route";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { supabaseAdmin } from "@/lib/supabase";

jest.mock("@/lib/memo-api-auth", () => ({
    resolveMemoUserId: jest.fn(),
}));

jest.mock("@/lib/supabase");

describe("DELETE /api/memo-rooms/:roomId/messages/:messageId/reactions/:reactionType", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("removes a human reaction from a room message", async () => {
        (resolveMemoUserId as jest.Mock).mockResolvedValue("owner-user");

        const participantSingle = jest.fn().mockResolvedValue({
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
        const participantStatusEq = jest.fn(() => ({ single: participantSingle }));
        const participantUserEq = jest.fn(() => ({ eq: participantStatusEq }));
        const participantRoomEq = jest.fn(() => ({ eq: participantUserEq }));
        const participantSelect = jest.fn(() => ({ eq: participantRoomEq }));

        const messageSingle = jest.fn().mockResolvedValue({
            data: { id: "message-1", memo_room_id: "room-1" },
            error: null,
        });
        const messageIdEq = jest.fn(() => ({ single: messageSingle }));
        const messageRoomEq = jest.fn(() => ({ eq: messageIdEq }));
        const messageSelect = jest.fn(() => ({ eq: messageRoomEq }));

        const deleteSingle = jest.fn().mockResolvedValue({
            data: { id: "reaction-1" },
            error: null,
        });
        const deleteReactionTypeEq = jest.fn(() => ({ select: jest.fn(() => ({ single: deleteSingle })) }));
        const deleteUserEq = jest.fn(() => ({ eq: deleteReactionTypeEq }));
        const deleteMessageEq = jest.fn(() => ({ eq: deleteUserEq }));
        const deleteReaction = jest.fn(() => ({ eq: deleteMessageEq }));

        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "memo_room_participants") {
                return { select: participantSelect };
            }

            if (table === "memo_messages") {
                return { select: messageSelect };
            }

            if (table === "message_reactions") {
                return { delete: deleteReaction };
            }

            throw new Error(`Unexpected table ${table}`);
        });

        const req = {} as NextRequest;
        const res = await DELETE(req, {
            params: Promise.resolve({
                roomId: "room-1",
                messageId: "message-1",
                reactionType: "helpful",
            }),
        });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(deleteReaction).toHaveBeenCalled();
        expect(body.success).toBe(true);
    });
});
