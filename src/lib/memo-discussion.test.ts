/** @jest-environment node */

import {
  findMemoDiscussion,
  getOrCreateMemoDiscussion,
} from "@/lib/memo-discussion";
import { supabaseAdmin } from "@/lib/supabase";

jest.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

function mockRoomLinkSelect(result: { data: unknown; error: unknown }) {
  const roomLimit = jest.fn().mockResolvedValue(result);
  const roomOrderById = jest.fn(() => ({ limit: roomLimit }));
  const roomOrderByCreatedAt = jest.fn(() => ({ order: roomOrderById }));
  const roomEq = jest.fn(() => ({ order: roomOrderByCreatedAt }));
  const roomSelect = jest.fn(() => ({ eq: roomEq }));

  return {
    roomLimit,
    roomSelect,
  };
}

describe("findMemoDiscussion", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does not misreport generic Supabase failures as a multiple-rooms invariant violation", async () => {
    const { roomSelect } = mockRoomLinkSelect({
      data: null,
      error: { message: "connection lost" },
    });

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table !== "memo_room_memos") {
        throw new Error(`Unexpected table ${table}`);
      }

      return { select: roomSelect };
    });

    await expect(findMemoDiscussion("memo-1")).rejects.toThrow(
      "Failed to load memo discussion room"
    );
    await expect(findMemoDiscussion("memo-1")).rejects.not.toThrow(
      "Invariant violation: memo memo-1 has multiple linked rooms"
    );
  });

  it("chooses the canonical discussion room when a memo is linked to multiple rooms", async () => {
    const { roomSelect } = mockRoomLinkSelect({
      data: [
        { memo_room_id: "room-older", created_at: "2026-03-17T05:05:34.976862+00:00" },
        { memo_room_id: "room-newer", created_at: "2026-03-17T05:06:34.976862+00:00" },
      ],
      error: null,
    });

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table !== "memo_room_memos") {
        throw new Error(`Unexpected table ${table}`);
      }

      return { select: roomSelect };
    });

    await expect(findMemoDiscussion("memo-1")).resolves.toEqual({
      roomId: "room-older",
      ownerParticipantId: null,
    });
  });

  it("recovers when attaching a newly created room loses the canonical-room race", async () => {
    const roomLinkLimit = jest
      .fn()
      .mockResolvedValueOnce({
        data: [],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ memo_room_id: "room-live" }],
        error: null,
      });
    const roomLinkOrderById = jest.fn(() => ({ limit: roomLinkLimit }));
    const roomLinkOrderByCreatedAt = jest.fn(() => ({ order: roomLinkOrderById }));
    const roomLinkEq = jest.fn(() => ({ order: roomLinkOrderByCreatedAt }));
    const roomLinkSelect = jest.fn(() => ({ eq: roomLinkEq }));

    const roomSingle = jest.fn().mockResolvedValue({
      data: { id: "room-new" },
      error: null,
    });
    const roomSelect = jest.fn(() => ({ single: roomSingle }));
    const roomInsert = jest.fn(() => ({ select: roomSelect }));
    const roomDeleteOwnerEq = jest.fn().mockResolvedValue({
      error: null,
    });
    const roomDeleteIdEq = jest.fn(() => ({ eq: roomDeleteOwnerEq }));
    const roomDelete = jest.fn(() => ({ eq: roomDeleteIdEq }));

    const roomMemoInsert = jest.fn().mockResolvedValue({
      error: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "memo_room_memos_memo_unique"',
      },
    });

    const participantMaybeSingle = jest.fn().mockResolvedValue({
      data: {
        id: "participant-owner",
      },
      error: null,
    });
    const participantStatusEq = jest.fn(() => ({ maybeSingle: participantMaybeSingle }));
    const participantRoleEq = jest.fn(() => ({ eq: participantStatusEq }));
    const participantUserEq = jest.fn(() => ({ eq: participantRoleEq }));
    const participantRoomEq = jest.fn(() => ({ eq: participantUserEq }));
    const participantSelect = jest.fn(() => ({ eq: participantRoomEq }));
    const participantInsert = jest.fn();

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === "memo_room_memos") {
        return {
          select: roomLinkSelect,
          insert: roomMemoInsert,
        };
      }

      if (table === "memo_rooms") {
        return {
          insert: roomInsert,
          delete: roomDelete,
        };
      }

      if (table === "memo_room_participants") {
        return {
          select: participantSelect,
          insert: participantInsert,
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    await expect(
      getOrCreateMemoDiscussion("memo-1", "user-owner", "Shared Memo")
    ).resolves.toEqual({
      roomId: "room-live",
      ownerParticipantId: "participant-owner",
    });
    expect(roomMemoInsert).toHaveBeenCalledWith({
      memo_room_id: "room-new",
      memo_id: "memo-1",
    });
    expect(roomDelete).toHaveBeenCalled();
    expect(roomDeleteIdEq).toHaveBeenCalledWith("id", "room-new");
    expect(roomDeleteOwnerEq).toHaveBeenCalledWith("owner_user_id", "user-owner");
    expect(participantInsert).not.toHaveBeenCalled();
  });

  it("keeps the canonical discussion when orphan cleanup fails after losing the room race", async () => {
    const roomLinkLimit = jest
      .fn()
      .mockResolvedValueOnce({
        data: [],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ memo_room_id: "room-live" }],
        error: null,
      });
    const roomLinkOrderById = jest.fn(() => ({ limit: roomLinkLimit }));
    const roomLinkOrderByCreatedAt = jest.fn(() => ({ order: roomLinkOrderById }));
    const roomLinkEq = jest.fn(() => ({ order: roomLinkOrderByCreatedAt }));
    const roomLinkSelect = jest.fn(() => ({ eq: roomLinkEq }));

    const roomSingle = jest.fn().mockResolvedValue({
      data: { id: "room-new" },
      error: null,
    });
    const roomSelect = jest.fn(() => ({ single: roomSingle }));
    const roomInsert = jest.fn(() => ({ select: roomSelect }));
    const roomDeleteOwnerEq = jest.fn().mockResolvedValue({
      error: { message: "statement timeout" },
    });
    const roomDeleteIdEq = jest.fn(() => ({ eq: roomDeleteOwnerEq }));
    const roomDelete = jest.fn(() => ({ eq: roomDeleteIdEq }));

    const roomMemoInsert = jest.fn().mockResolvedValue({
      error: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "memo_room_memos_memo_unique"',
      },
    });

    const participantMaybeSingle = jest.fn().mockResolvedValue({
      data: {
        id: "participant-owner",
      },
      error: null,
    });
    const participantStatusEq = jest.fn(() => ({ maybeSingle: participantMaybeSingle }));
    const participantRoleEq = jest.fn(() => ({ eq: participantStatusEq }));
    const participantUserEq = jest.fn(() => ({ eq: participantRoleEq }));
    const participantRoomEq = jest.fn(() => ({ eq: participantUserEq }));
    const participantSelect = jest.fn(() => ({ eq: participantRoomEq }));
    const participantInsert = jest.fn();

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === "memo_room_memos") {
        return {
          select: roomLinkSelect,
          insert: roomMemoInsert,
        };
      }

      if (table === "memo_rooms") {
        return {
          insert: roomInsert,
          delete: roomDelete,
        };
      }

      if (table === "memo_room_participants") {
        return {
          select: participantSelect,
          insert: participantInsert,
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    await expect(
      getOrCreateMemoDiscussion("memo-1", "user-owner", "Shared Memo")
    ).resolves.toEqual({
      roomId: "room-live",
      ownerParticipantId: "participant-owner",
    });
    expect(roomDelete).toHaveBeenCalled();
    expect(participantInsert).not.toHaveBeenCalled();
  });

  it("recovers when seeding the owner participant loses a concurrent insert race", async () => {
    const roomLinkLimit = jest.fn().mockResolvedValue({
      data: [{ memo_room_id: "room-live" }],
      error: null,
    });
    const roomLinkOrderById = jest.fn(() => ({ limit: roomLinkLimit }));
    const roomLinkOrderByCreatedAt = jest.fn(() => ({ order: roomLinkOrderById }));
    const roomLinkEq = jest.fn(() => ({ order: roomLinkOrderByCreatedAt }));
    const roomLinkSelect = jest.fn(() => ({ eq: roomLinkEq }));

    const participantMaybeSingle = jest.fn().mockResolvedValue({
      data: {
        id: "participant-owner",
      },
      error: null,
    });
    const participantSingle = jest.fn().mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "memo_room_participants_room_user_unique"',
      },
    });
    const participantSelect = jest.fn(() => ({ single: participantSingle }));
    const participantInsert = jest.fn(() => ({ select: participantSelect }));
    const participantStatusEq = jest.fn(() => ({ maybeSingle: participantMaybeSingle }));
    const participantRoleEq = jest.fn(() => ({ eq: participantStatusEq }));
    const participantUserEq = jest.fn(() => ({ eq: participantRoleEq }));
    const participantRoomEq = jest.fn(() => ({ eq: participantUserEq }));
    const participantLookupSelect = jest.fn(() => ({ eq: participantRoomEq }));

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === "memo_room_memos") {
        return { select: roomLinkSelect };
      }

      if (table === "memo_room_participants") {
        return {
          insert: participantInsert,
          select: participantLookupSelect,
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    await expect(
      getOrCreateMemoDiscussion("memo-1", "user-owner", "Shared Memo")
    ).resolves.toEqual({
      roomId: "room-live",
      ownerParticipantId: "participant-owner",
    });
  });
});
