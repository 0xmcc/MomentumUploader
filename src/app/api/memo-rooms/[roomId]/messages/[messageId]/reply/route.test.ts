/** @jest-environment node */

import { NextRequest } from "next/server";
import { POST } from "./route";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { supabaseAdmin } from "@/lib/supabase";

jest.mock("@/lib/memo-api-auth", () => ({
    resolveMemoUserId: jest.fn(),
}));

jest.mock("@/lib/supabase");

describe("POST /api/memo-rooms/:roomId/messages/:messageId/reply", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("derives reply topology from the parent message instead of trusting the client", async () => {
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

        const parentSingle = jest.fn().mockResolvedValue({
            data: {
                id: "message-parent",
                memo_room_id: "room-1",
                memo_id: "memo-1",
                root_message_id: "message-root",
                author_participant_id: "participant-other",
            },
            error: null,
        });
        const parentIdEq = jest.fn(() => ({ single: parentSingle }));
        const parentRoomEq = jest.fn(() => ({ eq: parentIdEq }));
        const parentSelect = jest.fn(() => ({ eq: parentRoomEq }));

        const insertSingle = jest.fn().mockResolvedValue({
            data: {
                id: "message-reply",
                memo_room_id: "room-1",
                memo_id: "memo-1",
                author_participant_id: "participant-owner",
                content: "Reply content",
                visibility: "public",
                restricted_participant_ids: null,
                reply_to_message_id: "message-parent",
                root_message_id: "message-root",
                anchor_start_ms: null,
                anchor_end_ms: null,
                anchor_segment_ids: null,
                created_at: "2026-03-16T18:11:00.000Z",
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
                if ((supabaseAdmin.from as jest.Mock).mock.calls.length === 2) {
                    return { select: parentSelect };
                }

                return { insert };
            }

            throw new Error(`Unexpected table ${table}`);
        });

        const req = {
            json: jest.fn().mockResolvedValue({
                content: "Reply content",
                visibility: "public",
                replyToMessageId: "client-lies",
                rootMessageId: "client-lies-too",
            }),
        } as unknown as NextRequest;

        const res = await POST(req, {
            params: Promise.resolve({ roomId: "room-1", messageId: "message-parent" }),
        });
        const body = await res.json();

        expect(res.status).toBe(201);
        expect(parentRoomEq).toHaveBeenCalledWith("memo_room_id", "room-1");
        expect(parentIdEq).toHaveBeenCalledWith("id", "message-parent");
        expect(insert).toHaveBeenCalledWith(
            expect.objectContaining({
                reply_to_message_id: "message-parent",
                root_message_id: "message-root",
                memo_id: "memo-1",
            })
        );
        expect(body.message).toMatchObject({
            id: "message-reply",
            replyToMessageId: "message-parent",
            rootMessageId: "message-root",
        });
    });
});
