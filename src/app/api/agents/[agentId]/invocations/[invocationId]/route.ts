import { NextRequest, NextResponse } from "next/server";
import { resolveOptionalAgentContext } from "@/lib/agents";
import { supabaseAdmin } from "@/lib/supabase";

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "PATCH, OPTIONS",
    "Access-Control-Allow-Headers":
        "Content-Type, Authorization, x-openclaw-api-key, x-openclaw-internal-key, x-memo-agent-id",
};

type Params = { params: Promise<{ agentId: string; invocationId: string }> };

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: CORS });
}

export async function PATCH(req: NextRequest, { params }: Params) {
    const { agentId, invocationId } = await params;
    const actorContext = await resolveOptionalAgentContext(req, agentId);

    if (!actorContext.ok) {
        return NextResponse.json({ error: actorContext.error }, { status: actorContext.status, headers: CORS });
    }

    let body: { status?: "processing" | "completed" | "failed"; responseMessageId?: string; failureReason?: string };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
    }

    if (!body.status) {
        return NextResponse.json({ error: "'status' is required" }, { status: 422, headers: CORS });
    }

    const { data: invocation, error: invocationError } = await supabaseAdmin
        .from("agent_invocations")
        .select("id, agent_id, memo_room_id, memo_id, request_message_id, status")
        .eq("agent_id", agentId)
        .eq("id", invocationId)
        .single();

    if (invocationError || !invocation) {
        return NextResponse.json({ error: "Invocation not found" }, { status: 404, headers: CORS });
    }

    if (invocation.status === "completed") {
        return NextResponse.json({ error: "Invocation already completed" }, { status: 409, headers: CORS });
    }

    if (body.status === "completed" && !body.responseMessageId) {
        return NextResponse.json({ error: "'responseMessageId' is required" }, { status: 422, headers: CORS });
    }

    if (body.status === "completed") {
        const { data: responseMessage, error: responseError } = await supabaseAdmin
            .from("memo_messages")
            .select(
                "id, memo_room_id, author_participant:memo_room_participants!memo_messages_author_participant_id_fkey(id, participant_type, user_id, agent_id)"
            )
            .eq("id", body.responseMessageId)
            .single();

        const author = Array.isArray(responseMessage?.author_participant)
            ? responseMessage.author_participant[0]
            : responseMessage?.author_participant;

        if (
            responseError ||
            !responseMessage ||
            responseMessage.memo_room_id !== invocation.memo_room_id ||
            author?.participant_type !== "agent" ||
            author.agent_id !== agentId
        ) {
            return NextResponse.json({ error: "Invalid response message" }, { status: 422, headers: CORS });
        }
    }

    const updates: Record<string, unknown> = {
        status: body.status,
        updated_at: new Date().toISOString(),
    };

    if (body.status === "completed") {
        updates.response_message_id = body.responseMessageId;
        updates.completed_at = new Date().toISOString();
    }

    if (body.status === "failed") {
        updates.failure_reason = body.failureReason ?? null;
    }

    const { data, error } = await supabaseAdmin
        .from("agent_invocations")
        .update(updates)
        .eq("agent_id", agentId)
        .eq("id", invocationId)
        .select("id, agent_id, memo_room_id, memo_id, request_message_id, response_message_id, status, created_at, updated_at, completed_at")
        .single();

    if (error || !data) {
        return NextResponse.json({ error: "Failed to update invocation" }, { status: 500, headers: CORS });
    }

    if (body.status === "completed" || body.status === "failed") {
        const { error: stateError } = await supabaseAdmin
            .from("agent_room_state")
            .update({ last_processed_invocation_id: invocationId })
            .eq("agent_id", agentId)
            .eq("memo_room_id", invocation.memo_room_id);

        if (stateError) {
            return NextResponse.json({ error: "Failed to update room state" }, { status: 500, headers: CORS });
        }
    }

    return NextResponse.json(
        {
            invocation: {
                id: data.id,
                agentId: data.agent_id,
                memoId: data.memo_id,
                roomId: data.memo_room_id,
                requestMessageId: data.request_message_id,
                responseMessageId: data.response_message_id ?? null,
                status: data.status,
                createdAt: data.created_at,
                updatedAt: data.updated_at,
                completedAt: data.completed_at ?? null,
            },
        },
        { headers: CORS }
    );
}
