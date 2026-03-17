/** @jest-environment node */

import { NextRequest } from "next/server";
import { POST } from "./route";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { supabaseAdmin } from "@/lib/supabase";

jest.mock("@/lib/memo-api-auth", () => ({
    resolveMemoUserId: jest.fn(),
}));

jest.mock("@/lib/supabase");

describe("POST /api/memo-rooms/:roomId/messages/:messageId/reactions", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("creates a human reaction for a visible room message", async () => {
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

        const insertSingle = jest.fn().mockResolvedValue({
            data: {
                id: "reaction-1",
                message_id: "message-1",
                user_id: "owner-user",
                reaction_type: "helpful",
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

            if (table === "memo_messages") {
                return { select: messageSelect };
            }

            if (table === "message_reactions") {
                return { insert };
            }

            throw new Error(`Unexpected table ${table}`);
        });

        const req = {
            json: jest.fn().mockResolvedValue({ reactionType: "helpful" }),
        } as unknown as NextRequest;

        const res = await POST(req, {
            params: Promise.resolve({ roomId: "room-1", messageId: "message-1" }),
        });
        const body = await res.json();

        expect(res.status).toBe(201);
        expect(insert).toHaveBeenCalledWith({
            message_id: "message-1",
            user_id: "owner-user",
            reaction_type: "helpful",
        });
        expect(body.reaction).toMatchObject({
            id: "reaction-1",
            messageId: "message-1",
            reactionType: "helpful",
        });
    });
});
