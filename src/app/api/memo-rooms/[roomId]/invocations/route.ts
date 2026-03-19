import { NextRequest, NextResponse } from "next/server";
import {
    createMessageId,
    getActiveAgentParticipant,
    getActiveHumanParticipant,
    isMessageVisibility,
    MEMO_ROOM_CORS,
    resolveAttachedMemoId,
    serializeMessage,
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

export async function POST(req: NextRequest, { params }: Params) {
    const { roomId } = await params;
    const actorContext = await resolveOptionalAgentContext(req);

    if (!actorContext.ok) {
        const status = actorContext.status === 403 ? 403 : 404;
        const error = status === 403 ? actorContext.error : "Memo room not found";
        return NextResponse.json({ error }, { status, headers: MEMO_ROOM_CORS });
    }

    const requester = actorContext.agentId
        ? await getActiveAgentParticipant(roomId, actorContext.agentId)
        : await getActiveHumanParticipant(roomId, actorContext.memoUserId);
    if (!requester) {
        return NextResponse.json({ error: "Memo room not found" }, { status: 404, headers: MEMO_ROOM_CORS });
    }

    if (requester.participant_type !== "human" || requester.role !== "owner") {
        return NextResponse.json({ error: "Only room owners can invoke agents" }, { status: 403, headers: MEMO_ROOM_CORS });
    }

    let body: {
        agentId?: string;
        memoId?: string;
        content?: string;
        visibility?: MessageVisibility;
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

    const agentId = body.agentId?.trim();
    if (!agentId) {
        return NextResponse.json({ error: "'agentId' is required" }, { status: 422, headers: MEMO_ROOM_CORS });
    }

    const agentParticipant = await getActiveAgentParticipant(roomId, agentId);
    if (!agentParticipant) {
        return NextResponse.json({ error: "Agent not found" }, { status: 404, headers: MEMO_ROOM_CORS });
    }

    const visibility = body.visibility ?? agentParticipant.default_visibility ?? "owner_only";
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

    const anchor = await validateTranscriptAnchor({
        memoId: memoResolution.memoId,
        anchorStartMs: body.anchorStartMs,
        anchorEndMs: body.anchorEndMs,
        anchorSegmentIds: body.anchorSegmentIds,
    });

    if (!anchor) {
        return NextResponse.json({ error: "Invalid transcript anchor" }, { status: 422, headers: MEMO_ROOM_CORS });
    }

    const requestMessageId = createMessageId();
    const { data: message, error: messageError } = await supabaseAdmin
        .from("memo_messages")
        .insert({
            id: requestMessageId,
            memo_room_id: roomId,
            memo_id: memoResolution.memoId,
            author_participant_id: requester.id,
            content,
            visibility,
            restricted_participant_ids: null,
            reply_to_message_id: null,
            root_message_id: requestMessageId,
            ...anchor,
        })
        .select()
        .single();

    if (messageError || !message) {
        return NextResponse.json({ error: "Failed to create invocation message" }, { status: 500, headers: MEMO_ROOM_CORS });
    }

    const { data: invocation, error: invocationError } = await supabaseAdmin
        .from("agent_invocations")
        .insert({
            agent_id: agentId,
            memo_room_id: roomId,
            memo_id: memoResolution.memoId,
            request_message_id: requestMessageId,
            invoked_by_user_id: actorContext.memoUserId,
            status: "pending",
            anchor_start_ms: anchor.anchor_start_ms,
            anchor_end_ms: anchor.anchor_end_ms,
            anchor_segment_ids: anchor.anchor_segment_ids,
        })
        .select()
        .single();

    if (invocationError || !invocation) {
        return NextResponse.json({ error: "Failed to create invocation" }, { status: 500, headers: MEMO_ROOM_CORS });
    }

    return NextResponse.json(
        {
            message: serializeMessage(message as MemoMessageRow),
            invocation: {
                id: invocation.id,
                agentId: invocation.agent_id,
                memoId: invocation.memo_id,
                roomId: invocation.memo_room_id,
                requestMessageId: invocation.request_message_id,
                status: invocation.status,
                createdAt: invocation.created_at,
            },
        },
        { status: 201, headers: MEMO_ROOM_CORS }
    );
}
