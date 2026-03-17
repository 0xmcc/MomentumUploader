import { supabaseAdmin } from "@/lib/supabase";

export type MemoDiscussion = {
  roomId: string;
  ownerParticipantId: string | null;
};

async function findLinkedRoomId(memoId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("memo_room_memos")
    .select("memo_room_id")
    .eq("memo_id", memoId);

  if (error || !data || data.length === 0) {
    return null;
  }

  for (const link of data) {
    if (typeof link.memo_room_id === "string" && link.memo_room_id.length > 0) {
      return link.memo_room_id;
    }
  }

  return null;
}

async function findOwnerParticipantId(
  roomId: string,
  ownerUserId: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("memo_room_participants")
    .select("id")
    .eq("memo_room_id", roomId)
    .eq("user_id", ownerUserId)
    .eq("role", "owner")
    .eq("status", "active")
    .maybeSingle();

  if (error || !data || typeof data.id !== "string") {
    return null;
  }

  return data.id;
}

export async function findMemoDiscussion(
  memoId: string,
  ownerUserId?: string | null
): Promise<MemoDiscussion | null> {
  const roomId = await findLinkedRoomId(memoId);
  if (!roomId) {
    return null;
  }

  const ownerParticipantId = ownerUserId
    ? await findOwnerParticipantId(roomId, ownerUserId)
    : null;

  return {
    roomId,
    ownerParticipantId,
  };
}

export async function getOrCreateMemoDiscussion(
  memoId: string,
  ownerUserId: string,
  memoTitle: string
): Promise<{ roomId: string; ownerParticipantId: string }> {
  const existingDiscussion = await findMemoDiscussion(memoId, ownerUserId);
  let roomId = existingDiscussion?.roomId ?? null;
  let ownerParticipantId = existingDiscussion?.ownerParticipantId ?? null;

  if (!roomId) {
    const title = memoTitle.trim() || "Memo Room";
    const { data: room, error: roomError } = await supabaseAdmin
      .from("memo_rooms")
      .insert({
        owner_user_id: ownerUserId,
        title,
        description: null,
      })
      .select("id")
      .single();

    if (roomError || !room || typeof room.id !== "string") {
      throw new Error("Failed to create memo discussion room");
    }

    roomId = room.id;

    const { error: roomMemoError } = await supabaseAdmin
      .from("memo_room_memos")
      .insert({
        memo_room_id: roomId,
        memo_id: memoId,
      });

    if (roomMemoError) {
      throw new Error("Failed to attach memo discussion room");
    }
  }

  if (!ownerParticipantId) {
    const { data: participant, error: participantError } = await supabaseAdmin
      .from("memo_room_participants")
      .insert({
        memo_room_id: roomId,
        participant_type: "human",
        user_id: ownerUserId,
        role: "owner",
        capability: "full_participation",
        default_visibility: "public",
        status: "active",
      })
      .select("id")
      .single();

    if (
      participantError ||
      !participant ||
      typeof participant.id !== "string"
    ) {
      throw new Error("Failed to seed memo discussion owner");
    }

    ownerParticipantId = participant.id;
  }

  return {
    roomId,
    ownerParticipantId,
  };
}
