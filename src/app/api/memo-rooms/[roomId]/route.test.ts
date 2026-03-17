/** @jest-environment node */

import { NextRequest } from "next/server";
import { GET } from "./route";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { supabaseAdmin } from "@/lib/supabase";

jest.mock("@/lib/memo-api-auth", () => ({
    resolveMemoUserId: jest.fn(),
}));

jest.mock("@/lib/supabase");

describe("GET /api/memo-rooms/:roomId", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("returns room detail, attached memos, and roster for an active human participant", async () => {
        (resolveMemoUserId as jest.Mock).mockResolvedValue("user_owner");

        const participantSingle = jest.fn().mockResolvedValue({
            data: {
                id: "participant-owner",
                memo_room_id: "room-1",
                participant_type: "human",
                user_id: "user_owner",
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

        const roomSingle = jest.fn().mockResolvedValue({
            data: {
                id: "room-1",
                owner_user_id: "user_owner",
                title: "Customer call",
                description: "Objection review",
                created_at: "2026-03-16T18:00:00.000Z",
            },
            error: null,
        });
        const roomEq = jest.fn(() => ({ single: roomSingle }));
        const roomSelect = jest.fn(() => ({ eq: roomEq }));

        const roomMemosEq = jest.fn().mockResolvedValue({
            data: [{ memo_id: "memo-1" }],
            error: null,
        });
        const roomMemosSelect = jest.fn(() => ({ eq: roomMemosEq }));

        const rosterEq = jest.fn().mockResolvedValue({
            data: [
                {
                    id: "participant-owner",
                    participant_type: "human",
                    user_id: "user_owner",
                    agent_id: null,
                    role: "owner",
                    capability: "full_participation",
                    default_visibility: "public",
                    status: "active",
                },
            ],
            error: null,
        });
        const rosterSelect = jest.fn(() => ({ eq: rosterEq }));

        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "memo_room_participants") {
                if ((supabaseAdmin.from as jest.Mock).mock.calls.length === 1) {
                    return { select: participantSelect };
                }

                return { select: rosterSelect };
            }

            if (table === "memo_rooms") {
                return { select: roomSelect };
            }

            if (table === "memo_room_memos") {
                return { select: roomMemosSelect };
            }

            throw new Error(`Unexpected table ${table}`);
        });

        const req = {} as NextRequest;
        const res = await GET(req, { params: Promise.resolve({ roomId: "room-1" }) });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.room).toMatchObject({
            id: "room-1",
            ownerUserId: "user_owner",
            title: "Customer call",
            description: "Objection review",
        });
        expect(body.room.memos).toEqual([{ memoId: "memo-1" }]);
        expect(body.room.participants).toEqual([
            expect.objectContaining({
                id: "participant-owner",
                participantType: "human",
                userId: "user_owner",
                role: "owner",
            }),
        ]);
    });

    it("returns 404 for users who are not active participants", async () => {
        (resolveMemoUserId as jest.Mock).mockResolvedValue("user_stranger");

        const participantSingle = jest.fn().mockResolvedValue({
            data: null,
            error: null,
        });
        const participantStatusEq = jest.fn(() => ({ single: participantSingle }));
        const participantUserEq = jest.fn(() => ({ eq: participantStatusEq }));
        const participantRoomEq = jest.fn(() => ({ eq: participantUserEq }));
        const participantSelect = jest.fn(() => ({ eq: participantRoomEq }));

        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "memo_room_participants") {
                return { select: participantSelect };
            }

            throw new Error(`Unexpected table ${table}`);
        });

        const req = {} as NextRequest;
        const res = await GET(req, { params: Promise.resolve({ roomId: "room-1" }) });
        const body = await res.json();

        expect(res.status).toBe(404);
        expect(body.error).toBe("Memo room not found");
    });
});
