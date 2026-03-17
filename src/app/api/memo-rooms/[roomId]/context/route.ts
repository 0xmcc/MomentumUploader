import { NextRequest, NextResponse } from "next/server";
import { resolveOptionalAgentContext } from "@/lib/agents";
import {
    getActiveAgentParticipant,
    getActiveHumanParticipant,
    isMessageVisibleToParticipant,
    MEMO_ROOM_CORS,
    serializeMessage,
    serializeParticipant,
    type MemoMessageRow,
    type MemoRoomParticipantRow,
} from "@/lib/memo-rooms";
import { supabaseAdmin } from "@/lib/supabase";

type Params = { params: Promise<{ roomId: string }> };

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: MEMO_ROOM_CORS });
}

export async function GET(req: NextRequest, { params }: Params) {
    const { roomId } = await params;
    const actorContext = await resolveOptionalAgentContext(req);

    if (!actorContext.ok) {
        return NextResponse.json({ error: "Memo room not found" }, { status: actorContext.status, headers: MEMO_ROOM_CORS });
    }

    const viewerParticipant = actorContext.agentId
        ? await getActiveAgentParticipant(roomId, actorContext.agentId)
        : await getActiveHumanParticipant(roomId, actorContext.memoUserId);

    if (!viewerParticipant) {
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

    const { data: roomMemos } = await supabaseAdmin
        .from("memo_room_memos")
        .select("memo_id")
        .eq("memo_room_id", roomId);

    const memoIds = (roomMemos ?? []).map((entry) => entry.memo_id as string);
    const { data: memos } = memoIds.length
        ? await supabaseAdmin
            .from("memos")
            .select("id, title, duration, created_at")
            .in("id", memoIds)
        : { data: [] };

    const { data: participants } = await supabaseAdmin
        .from("memo_room_participants")
        .select("id, memo_room_id, participant_type, user_id, agent_id, role, capability, default_visibility, status")
        .eq("memo_room_id", roomId);

    const { data: messages } = await supabaseAdmin
        .from("memo_messages")
        .select(
            "id, memo_room_id, memo_id, author_participant_id, content, visibility, restricted_participant_ids, reply_to_message_id, root_message_id, anchor_start_ms, anchor_end_ms, anchor_segment_ids, created_at, author_participant:memo_room_participants!memo_messages_author_participant_id_fkey(id, participant_type, user_id, agent_id)"
        )
        .eq("memo_room_id", roomId)
        .order("created_at", { ascending: false })
        .limit(10);

    const visibleMessages = ((messages ?? []) as MemoMessageRow[])
        .filter((message) => isMessageVisibleToParticipant(message, viewerParticipant))
        .map(serializeMessage)
        .reverse();

    let viewerAgentState: Record<string, unknown> | null = null;
    if (viewerParticipant.participant_type === "agent" && viewerParticipant.agent_id) {
        const { data: state } = await supabaseAdmin
            .from("agent_room_state")
            .select("last_seen_message_id, last_seen_transcript_segment_id, last_processed_invocation_id, default_visibility")
            .eq("memo_room_id", roomId)
            .eq("agent_id", viewerParticipant.agent_id)
            .single();

        viewerAgentState = state ?? null;
    }

    return NextResponse.json(
        {
            room: {
                id: room.id,
                ownerUserId: room.owner_user_id,
                title: room.title,
                description: room.description ?? null,
                createdAt: room.created_at,
                memos: (memos ?? []).map((memo) => ({
                    memoId: memo.id,
                    title: memo.title ?? null,
                    durationSeconds: memo.duration ?? null,
                    createdAt: memo.created_at,
                })),
                participants: ((participants ?? []) as MemoRoomParticipantRow[])
                    .filter((participant) => participant.status === "active")
                    .map(serializeParticipant),
                recentMessages: visibleMessages,
            },
            viewerParticipant: serializeParticipant(viewerParticipant),
            viewerAgentState,
        },
        { headers: MEMO_ROOM_CORS }
    );
}
