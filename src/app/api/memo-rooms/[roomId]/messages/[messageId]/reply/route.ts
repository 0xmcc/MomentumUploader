import { NextRequest, NextResponse } from "next/server";
import {
    canParticipantPost,
    createMessageId,
    getActiveAgentParticipant,
    getActiveHumanParticipant,
    isMessageVisibility,
    MEMO_ROOM_CORS,
    serializeMessage,
    validateRestrictedParticipantIds,
    validateTranscriptAnchor,
    type MemoMessageRow,
    type MessageVisibility,
} from "@/lib/memo-rooms";
import { resolveOptionalAgentContext } from "@/lib/agents";
import { supabaseAdmin } from "@/lib/supabase";

type Params = { params: Promise<{ roomId: string; messageId: string }> };

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: MEMO_ROOM_CORS });
}

export async function POST(req: NextRequest, { params }: Params) {
    const { roomId, messageId } = await params;
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

    const { data: parent, error: parentError } = await supabaseAdmin
        .from("memo_messages")
        .select("id, memo_room_id, memo_id, root_message_id, author_participant_id")
        .eq("memo_room_id", roomId)
        .eq("id", messageId)
        .single();

    if (parentError || !parent) {
        return NextResponse.json({ error: "Parent message not found" }, { status: 404, headers: MEMO_ROOM_CORS });
    }

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
        memoId: parent.memo_id as string,
        anchorStartMs: body.anchorStartMs,
        anchorEndMs: body.anchorEndMs,
        anchorSegmentIds: body.anchorSegmentIds,
    });

    if (!anchor) {
        return NextResponse.json({ error: "Invalid transcript anchor" }, { status: 422, headers: MEMO_ROOM_CORS });
    }

    const replyId = createMessageId();
    const { data, error } = await supabaseAdmin
        .from("memo_messages")
        .insert({
            id: replyId,
            memo_room_id: roomId,
            memo_id: parent.memo_id,
            author_participant_id: participant.id,
            content,
            visibility,
            restricted_participant_ids: restrictedParticipantIds,
            reply_to_message_id: parent.id,
            root_message_id: parent.root_message_id,
            ...anchor,
        })
        .select()
        .single();

    if (error || !data) {
        return NextResponse.json({ error: "Failed to create reply" }, { status: 500, headers: MEMO_ROOM_CORS });
    }

    return NextResponse.json(
        { message: serializeMessage(data as MemoMessageRow) },
        { status: 201, headers: MEMO_ROOM_CORS }
    );
}
