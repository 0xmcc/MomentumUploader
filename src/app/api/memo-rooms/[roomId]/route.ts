import { NextRequest, NextResponse } from "next/server";
import {
    getActiveHumanParticipant,
    MEMO_ROOM_CORS,
    serializeParticipant,
    type MemoRoomParticipantRow,
} from "@/lib/memo-rooms";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { supabaseAdmin } from "@/lib/supabase";

type Params = { params: Promise<{ roomId: string }> };

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: MEMO_ROOM_CORS });
}

export async function GET(req: NextRequest, { params }: Params) {
    const userId = await resolveMemoUserId(req);
    const { roomId } = await params;

    if (!userId) {
        return NextResponse.json({ error: "Memo room not found" }, { status: 404, headers: MEMO_ROOM_CORS });
    }

    const participant = await getActiveHumanParticipant(roomId, userId);
    if (!participant) {
        return NextResponse.json({ error: "Memo room not found" }, { status: 404, headers: MEMO_ROOM_CORS });
    }

    const { data: room, error: roomError } = await supabaseAdmin
        .from("memo_rooms")
        .select("id, owner_user_id, title, description, created_at")
        .eq("id", roomId)
        .single();

    if (roomError || !room) {
        return NextResponse.json({ error: "Memo room not found" }, { status: 404, headers: MEMO_ROOM_CORS });
    }

    const { data: roomMemos, error: roomMemosError } = await supabaseAdmin
        .from("memo_room_memos")
        .select("memo_id")
        .eq("memo_room_id", roomId);

    if (roomMemosError) {
        return NextResponse.json({ error: "Failed to load memo room" }, { status: 500, headers: MEMO_ROOM_CORS });
    }

    const { data: participants, error: participantsError } = await supabaseAdmin
        .from("memo_room_participants")
        .select("id, memo_room_id, participant_type, user_id, agent_id, role, capability, default_visibility, status")
        .eq("memo_room_id", roomId);

    if (participantsError) {
        return NextResponse.json({ error: "Failed to load memo room" }, { status: 500, headers: MEMO_ROOM_CORS });
    }

    const activeParticipants = ((participants ?? []) as MemoRoomParticipantRow[])
        .filter((entry) => entry.status === "active")
        .map(serializeParticipant);

    return NextResponse.json(
        {
            room: {
                id: room.id,
                ownerUserId: room.owner_user_id,
                title: room.title,
                description: room.description ?? null,
                createdAt: room.created_at,
                memos: (roomMemos ?? []).map((entry) => ({ memoId: entry.memo_id as string })),
                participants: activeParticipants,
            },
            viewerParticipant: serializeParticipant(participant),
        },
        { headers: MEMO_ROOM_CORS }
    );
}
