import { NextRequest, NextResponse } from "next/server";
import { resolveOptionalAgentContext } from "@/lib/agents";
import { isMessageVisibility } from "@/lib/memo-rooms";
import { supabaseAdmin } from "@/lib/supabase";

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-openclaw-internal-key, x-memo-agent-id",
};

type Params = { params: Promise<{ agentId: string; roomId: string }> };

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: CORS });
}

export async function PATCH(req: NextRequest, { params }: Params) {
    const { agentId, roomId } = await params;
    const actorContext = await resolveOptionalAgentContext(req, agentId);

    if (!actorContext.ok) {
        return NextResponse.json({ error: actorContext.error }, { status: actorContext.status, headers: CORS });
    }

    let body: {
        lastSeenMessageId?: string | null;
        lastSeenTranscriptSegmentId?: number | null;
        lastProcessedInvocationId?: string | null;
        defaultVisibility?: "public" | "owner_only" | "restricted";
    };

    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
    }

    if (body.defaultVisibility && !isMessageVisibility(body.defaultVisibility)) {
        return NextResponse.json({ error: "Invalid visibility" }, { status: 422, headers: CORS });
    }

    const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
    };
    if (body.lastSeenMessageId !== undefined) updates.last_seen_message_id = body.lastSeenMessageId;
    if (body.lastSeenTranscriptSegmentId !== undefined) {
        updates.last_seen_transcript_segment_id = body.lastSeenTranscriptSegmentId;
    }
    if (body.lastProcessedInvocationId !== undefined) {
        updates.last_processed_invocation_id = body.lastProcessedInvocationId;
    }
    if (body.defaultVisibility !== undefined) {
        updates.default_visibility = body.defaultVisibility;
    }

    const { data, error } = await supabaseAdmin
        .from("agent_room_state")
        .update(updates)
        .eq("agent_id", agentId)
        .eq("memo_room_id", roomId)
        .select("agent_id, memo_room_id, last_seen_message_id, last_seen_transcript_segment_id, last_processed_invocation_id, default_visibility, updated_at")
        .single();

    if (error || !data) {
        return NextResponse.json({ error: "Agent room state not found" }, { status: 404, headers: CORS });
    }

    return NextResponse.json(
        {
            state: {
                agentId: data.agent_id,
                roomId: data.memo_room_id,
                lastSeenMessageId: data.last_seen_message_id ?? null,
                lastSeenTranscriptSegmentId: data.last_seen_transcript_segment_id ?? null,
                lastProcessedInvocationId: data.last_processed_invocation_id ?? null,
                defaultVisibility: data.default_visibility,
                updatedAt: data.updated_at,
            },
        },
        { headers: CORS }
    );
}
