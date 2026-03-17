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

    const { data: participants, error } = await supabaseAdmin
        .from("memo_room_participants")
        .select("memo_room_id, role, capability, default_visibility, status")
        .eq("agent_id", agentId)
        .eq("status", "active");

    if (error) {
        return NextResponse.json({ error: "Failed to load rooms" }, { status: 500, headers: CORS });
    }

    const roomIds = (participants ?? []).map((entry) => entry.memo_room_id as string);
    const { data: rooms } = roomIds.length
        ? await supabaseAdmin
            .from("memo_rooms")
            .select("id, title, description, created_at")
            .in("id", roomIds)
        : { data: [] };

    const { data: states } = roomIds.length
        ? await supabaseAdmin
            .from("agent_room_state")
            .select("memo_room_id, last_seen_message_id, last_seen_transcript_segment_id, last_processed_invocation_id, default_visibility")
            .eq("agent_id", agentId)
        : { data: [] };

    const stateByRoom = new Map((states ?? []).map((state) => [state.memo_room_id as string, state]));

    return NextResponse.json(
        {
            rooms: (rooms ?? []).map((room) => ({
                id: room.id,
                title: room.title,
                description: room.description ?? null,
                createdAt: room.created_at,
                state: stateByRoom.get(room.id as string) ?? null,
            })),
        },
        { headers: CORS }
    );
}
