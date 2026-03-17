/** @jest-environment node */

import { NextRequest } from "next/server";
import { GET } from "./route";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { supabaseAdmin } from "@/lib/supabase";

jest.mock("@/lib/memo-api-auth", () => ({
  resolveMemoUserId: jest.fn(),
}));

jest.mock("@/lib/supabase");

describe("GET /api/memos/:id/room", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns null when the memo is linked to a room the viewer cannot actually open", async () => {
    (resolveMemoUserId as jest.Mock).mockResolvedValue("user_owner");

    const memoSingle = jest.fn().mockResolvedValue({
      data: { id: "memo-1" },
      error: null,
    });
    const memoUserEq = jest.fn(() => ({ single: memoSingle }));
    const memoIdEq = jest.fn(() => ({ eq: memoUserEq }));
    const memoSelect = jest.fn(() => ({ eq: memoIdEq }));

    const roomLinkEq = jest.fn().mockResolvedValue({
      data: [{ memo_room_id: "room-stale" }],
      error: null,
    });
    const roomLinkSelect = jest.fn(() => ({ eq: roomLinkEq }));

    const participantSingle = jest.fn().mockResolvedValue({
      data: null,
      error: { message: "not found" },
    });
    const participantStatusEq = jest.fn(() => ({ single: participantSingle }));
    const participantUserEq = jest.fn(() => ({ eq: participantStatusEq }));
    const participantRoomEq = jest.fn(() => ({ eq: participantUserEq }));
    const participantSelect = jest.fn(() => ({ eq: participantRoomEq }));

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === "memos") {
        return { select: memoSelect };
      }

      if (table === "memo_room_memos") {
        return { select: roomLinkSelect };
      }

      if (table === "memo_room_participants") {
        return { select: participantSelect };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    const req = {} as NextRequest;

    const res = await GET(req, { params: Promise.resolve({ id: "memo-1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ room: null });
  });

  it("skips stale links and returns a linked room the viewer can open", async () => {
    (resolveMemoUserId as jest.Mock).mockResolvedValue("user_owner");

    const memoSingle = jest.fn().mockResolvedValue({
      data: { id: "memo-1" },
      error: null,
    });
    const memoUserEq = jest.fn(() => ({ single: memoSingle }));
    const memoIdEq = jest.fn(() => ({ eq: memoUserEq }));
    const memoSelect = jest.fn(() => ({ eq: memoIdEq }));

    const roomLinkEq = jest.fn().mockResolvedValue({
      data: [
        { memo_room_id: "room-stale" },
        { memo_room_id: "room-live" },
      ],
      error: null,
    });
    const roomLinkSelect = jest.fn(() => ({ eq: roomLinkEq }));

    const participantSingle = jest
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { message: "not found" },
      })
      .mockResolvedValueOnce({
        data: {
          id: "participant-1",
          memo_room_id: "room-live",
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

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === "memos") {
        return { select: memoSelect };
      }

      if (table === "memo_room_memos") {
        return { select: roomLinkSelect };
      }

      if (table === "memo_room_participants") {
        return { select: participantSelect };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    const req = {} as NextRequest;

    const res = await GET(req, { params: Promise.resolve({ id: "memo-1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ room: { roomId: "room-live" } });
  });
});
