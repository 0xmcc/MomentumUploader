import { NextRequest, NextResponse } from "next/server";
import { resolveOptionalAgentContext } from "@/lib/agents";
import { supabaseAdmin } from "@/lib/supabase";

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-openclaw-internal-key, x-memo-agent-id",
};

type Params = { params: Promise<{ agentId: string }> };

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest, { params }: Params) {
    const { agentId } = await params;
    const actorContext = await resolveOptionalAgentContext(req, agentId);

    if (!actorContext.ok) {
        return NextResponse.json({ error: actorContext.error }, { status: actorContext.status, headers: CORS });
    }

    const status = req.nextUrl.searchParams.get("status");
    let query = supabaseAdmin
        .from("agent_invocations")
        .select("id, agent_id, memo_room_id, memo_id, request_message_id, response_message_id, status, created_at, updated_at, completed_at")
        .eq("agent_id", agentId)
        .order("created_at", { ascending: false });

    if (status) {
        query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) {
        return NextResponse.json({ error: "Failed to load invocations" }, { status: 500, headers: CORS });
    }

    return NextResponse.json(
        {
            invocations: (data ?? []).map((invocation) => ({
                id: invocation.id,
                agentId: invocation.agent_id,
                roomId: invocation.memo_room_id,
                memoId: invocation.memo_id,
                requestMessageId: invocation.request_message_id,
                responseMessageId: invocation.response_message_id ?? null,
                status: invocation.status,
                createdAt: invocation.created_at,
                updatedAt: invocation.updated_at,
                completedAt: invocation.completed_at ?? null,
            })),
        },
        { headers: CORS }
    );
}
