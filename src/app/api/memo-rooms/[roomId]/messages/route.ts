import { NextRequest, NextResponse } from "next/server";
import {
    canParticipantPost,
    createMessageId,
    getActiveAgentParticipant,
    getActiveHumanParticipant,
    isMessageVisibleToParticipant,
    isMessageVisibility,
    MEMO_ROOM_CORS,
    resolveAttachedMemoId,
    serializeMessage,
    validateRestrictedParticipantIds,
    validateTranscriptAnchor,
    type MessageVisibility,
    type MemoMessageRow,
} from "@/lib/memo-rooms";
import { resolveOptionalAgentContext } from "@/lib/agents";
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

    const participant = actorContext.agentId
        ? await getActiveAgentParticipant(roomId, actorContext.agentId)
        : await getActiveHumanParticipant(roomId, actorContext.memoUserId);
    if (!participant) {
        return NextResponse.json({ error: "Memo room not found" }, { status: 404, headers: MEMO_ROOM_CORS });
    }

    const rootMessageId = req.nextUrl.searchParams.get("rootMessageId");
    let query = supabaseAdmin
        .from("memo_messages")
        .select(
            "id, memo_room_id, memo_id, author_participant_id, content, visibility, restricted_participant_ids, reply_to_message_id, root_message_id, anchor_start_ms, anchor_end_ms, anchor_segment_ids, created_at, author_participant:memo_room_participants!memo_messages_author_participant_id_fkey(id, participant_type, user_id, agent_id)"
        )
        .eq("memo_room_id", roomId);

    if (rootMessageId) {
        query = query.eq("root_message_id", rootMessageId);
    }

    const { data, error } = await query.order("created_at", { ascending: true });

    if (error) {
        return NextResponse.json({ error: "Failed to load messages" }, { status: 500, headers: MEMO_ROOM_CORS });
    }

    const visibleMessages = ((data ?? []) as MemoMessageRow[])
        .filter((message) => isMessageVisibleToParticipant(message, participant))
        .map(serializeMessage);

    return NextResponse.json({ messages: visibleMessages }, { headers: MEMO_ROOM_CORS });
}

export async function POST(req: NextRequest, { params }: Params) {
    const { roomId } = await params;
    const actorContext = await resolveOptionalAgentContext(req);

    if (!actorContext.ok) {
        const status = actorContext.status === 403 ? 403 : 404;
        const error = status === 403 ? actorContext.error : "Memo room not found";
        return NextResponse.json({ error }, { status, headers: MEMO_ROOM_CORS });
    }

    const participant = actorContext.agentId
        ? await getActiveAgentParticipant(roomId, actorContext.agentId)
        : await getActiveHumanParticipant(roomId, actorContext.memoUserId);
    if (!participant) {
        return NextResponse.json({ error: "Memo room not found" }, { status: 404, headers: MEMO_ROOM_CORS });
    }

    if (!canParticipantPost(participant)) {
        return NextResponse.json({ error: "Participant cannot post messages" }, { status: 403, headers: MEMO_ROOM_CORS });
    }

    let body: {
        memoId?: string;
        content?: string;
        visibility?: MessageVisibility;
        restrictedParticipantIds?: string[];
        anchorStartMs?: number;
        anchorEndMs?: number;
        anchorSegmentIds?: number[];
    };

    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: MEMO_ROOM_CORS });
    }

    const content = body.content?.trim();
    if (!content) {
        return NextResponse.json({ error: "'content' is required" }, { status: 422, headers: MEMO_ROOM_CORS });
    }

    const visibility = body.visibility ?? participant.default_visibility ?? "public";
    if (!isMessageVisibility(visibility)) {
        return NextResponse.json({ error: "Invalid visibility" }, { status: 422, headers: MEMO_ROOM_CORS });
    }

    const memoResolution = await resolveAttachedMemoId(roomId, body.memoId);
    if (!memoResolution.ok) {
        if (memoResolution.reason === "memo_id_required") {
            return NextResponse.json(
                { error: "'memoId' is required when a room has multiple memos" },
                { status: 422, headers: MEMO_ROOM_CORS }
            );
        }

        return NextResponse.json({ error: "Memo room not found" }, { status: 404, headers: MEMO_ROOM_CORS });
    }
    const memoId = memoResolution.memoId;

    const restrictedParticipantIds =
        visibility === "restricted"
            ? [...new Set(body.restrictedParticipantIds ?? [])]
            : null;

    if (visibility === "restricted") {
        const validRestrictedIds = await validateRestrictedParticipantIds(roomId, restrictedParticipantIds);
        if (!validRestrictedIds) {
            return NextResponse.json({ error: "Invalid restricted participants" }, { status: 422, headers: MEMO_ROOM_CORS });
        }
    }

    const anchor = await validateTranscriptAnchor({
        memoId,
        anchorStartMs: body.anchorStartMs,
        anchorEndMs: body.anchorEndMs,
        anchorSegmentIds: body.anchorSegmentIds,
    });

    if (!anchor) {
        return NextResponse.json({ error: "Invalid transcript anchor" }, { status: 422, headers: MEMO_ROOM_CORS });
    }

    const messageId = createMessageId();
    const { data, error } = await supabaseAdmin
        .from("memo_messages")
        .insert({
            id: messageId,
            memo_room_id: roomId,
            memo_id: memoId,
            author_participant_id: participant.id,
            content,
            visibility,
            restricted_participant_ids: restrictedParticipantIds,
            reply_to_message_id: null,
            root_message_id: messageId,
            ...anchor,
        })
        .select()
        .single();

    if (error || !data) {
        return NextResponse.json({ error: "Failed to create message" }, { status: 500, headers: MEMO_ROOM_CORS });
    }

    return NextResponse.json(
        { message: serializeMessage(data as MemoMessageRow) },
        { status: 201, headers: MEMO_ROOM_CORS }
    );
}
