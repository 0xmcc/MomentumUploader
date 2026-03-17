/** @jest-environment node */

import { NextRequest } from "next/server";
import { POST } from "./route";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { supabaseAdmin } from "@/lib/supabase";

jest.mock("@/lib/memo-api-auth", () => ({
    resolveMemoUserId: jest.fn(),
}));

jest.mock("@/lib/supabase");

describe("POST /api/memo-rooms", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("creates a room for an owned memo and seeds the owner as an active participant", async () => {
        (resolveMemoUserId as jest.Mock).mockResolvedValue("user_owner");

        const memoSingle = jest.fn().mockResolvedValue({
            data: {
                id: "memo-1",
                user_id: "user_owner",
                title: "Owned memo",
            },
            error: null,
        });
        const memoUserEq = jest.fn(() => ({ single: memoSingle }));
        const memoIdEq = jest.fn(() => ({ eq: memoUserEq }));
        const memoSelect = jest.fn(() => ({ eq: memoIdEq }));

        const roomInsertSingle = jest.fn().mockResolvedValue({
            data: {
                id: "room-1",
                owner_user_id: "user_owner",
                title: "Room title",
                description: "Room description",
                created_at: "2026-03-16T18:00:00.000Z",
            },
            error: null,
        });
        const roomInsert = jest.fn(() => ({
            select: jest.fn(() => ({ single: roomInsertSingle })),
        }));

        const roomMemoInsert = jest.fn().mockResolvedValue({
            data: null,
            error: null,
        });

        const participantInsert = jest.fn().mockResolvedValue({
            data: null,
            error: null,
        });

        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "memos") {
                return { select: memoSelect };
            }

            if (table === "memo_rooms") {
                return { insert: roomInsert };
            }

            if (table === "memo_room_memos") {
                return { insert: roomMemoInsert };
            }

            if (table === "memo_room_participants") {
                return { insert: participantInsert };
            }

            throw new Error(`Unexpected table ${table}`);
        });

        const req = {
            json: jest.fn().mockResolvedValue({
                memoId: "memo-1",
                title: "Room title",
                description: "Room description",
            }),
        } as unknown as NextRequest;

        const res = await POST(req);
        const body = await res.json();

        expect(res.status).toBe(201);
        expect(memoIdEq).toHaveBeenCalledWith("id", "memo-1");
        expect(memoUserEq).toHaveBeenCalledWith("user_id", "user_owner");
        expect(roomInsert).toHaveBeenCalledWith({
            owner_user_id: "user_owner",
            title: "Room title",
            description: "Room description",
        });
        expect(roomMemoInsert).toHaveBeenCalledWith({
            memo_room_id: "room-1",
            memo_id: "memo-1",
        });
        expect(participantInsert).toHaveBeenCalledWith({
            memo_room_id: "room-1",
            participant_type: "human",
            user_id: "user_owner",
            role: "owner",
            capability: "full_participation",
            default_visibility: "public",
            status: "active",
        });
        expect(body.room).toMatchObject({
            id: "room-1",
            ownerUserId: "user_owner",
            title: "Room title",
            description: "Room description",
        });
        expect(body.room.memos).toEqual([{ memoId: "memo-1" }]);
    });

    it("returns 404 when the user tries to create a room for another user's memo", async () => {
        (resolveMemoUserId as jest.Mock).mockResolvedValue("user_owner");

        const memoSingle = jest.fn().mockResolvedValue({
            data: null,
            error: { message: "not found" },
        });
        const memoUserEq = jest.fn(() => ({ single: memoSingle }));
        const memoIdEq = jest.fn(() => ({ eq: memoUserEq }));
        const memoSelect = jest.fn(() => ({ eq: memoIdEq }));

        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "memos") {
                return { select: memoSelect };
            }

            throw new Error(`Unexpected table ${table}`);
        });

        const req = {
            json: jest.fn().mockResolvedValue({
                memoId: "memo-foreign",
                title: "No access",
            }),
        } as unknown as NextRequest;

        const res = await POST(req);
        const body = await res.json();

        expect(res.status).toBe(404);
        expect(body.error).toBe("Memo not found");
    });
});
