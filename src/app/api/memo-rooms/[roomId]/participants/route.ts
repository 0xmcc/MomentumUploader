import { NextRequest, NextResponse } from "next/server";
import { requireOwnedAgent } from "@/lib/agents";
import {
    getActiveHumanParticipant,
    isMessageVisibility,
    MEMO_ROOM_CORS,
    serializeParticipant,
    type MemoRoomParticipantRow,
} from "@/lib/memo-rooms";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { supabaseAdmin } from "@/lib/supabase";

type Params = { params: Promise<{ roomId: string }> };

type ParticipantBody = {
    participantType?: "human" | "agent";
    userId?: string;
    agentId?: string;
    role?: string;
    capability?: "read_only" | "comment_only" | "full_participation";
    defaultVisibility?: "public" | "owner_only" | "restricted";
};

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: MEMO_ROOM_CORS });
}

export async function POST(req: NextRequest, { params }: Params) {
    const userId = await resolveMemoUserId(req);
    const { roomId } = await params;

    if (!userId) {
        return NextResponse.json({ error: "Memo room not found" }, { status: 404, headers: MEMO_ROOM_CORS });
    }

    const requester = await getActiveHumanParticipant(roomId, userId);
    if (!requester) {
        return NextResponse.json({ error: "Memo room not found" }, { status: 404, headers: MEMO_ROOM_CORS });
    }

    if (requester.role !== "owner") {
        return NextResponse.json({ error: "Only room owners can manage participants" }, { status: 403, headers: MEMO_ROOM_CORS });
    }

    let body: ParticipantBody;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: MEMO_ROOM_CORS });
    }

    if (body.participantType !== "human" && body.participantType !== "agent") {
        return NextResponse.json({ error: "'participantType' is required" }, { status: 422, headers: MEMO_ROOM_CORS });
    }

    const role = body.role ?? "member";
    const capability = body.capability ?? "full_participation";
    const defaultVisibility = body.defaultVisibility ?? "public";
    if (!isMessageVisibility(defaultVisibility)) {
        return NextResponse.json({ error: "Invalid visibility" }, { status: 422, headers: MEMO_ROOM_CORS });
    }

    if (body.participantType === "agent") {
        const agentId = body.agentId?.trim();
        if (!agentId) {
            return NextResponse.json({ error: "'agentId' is required" }, { status: 422, headers: MEMO_ROOM_CORS });
        }

        const agent = await requireOwnedAgent(agentId, userId);
        if (!agent) {
            return NextResponse.json({ error: "Agent not found" }, { status: 404, headers: MEMO_ROOM_CORS });
        }

        const { data, error } = await supabaseAdmin
            .from("memo_room_participants")
            .insert({
                memo_room_id: roomId,
                participant_type: "agent",
                agent_id: agent.id,
                role,
                capability,
                default_visibility: defaultVisibility,
                status: "active",
                invited_by_user_id: userId,
            })
            .select("id, memo_room_id, participant_type, user_id, agent_id, role, capability, default_visibility, status")
            .single();

        if (error || !data) {
            return NextResponse.json({ error: "Failed to add participant" }, { status: 500, headers: MEMO_ROOM_CORS });
        }

        const { error: stateError } = await supabaseAdmin
            .from("agent_room_state")
            .insert({
                agent_id: agent.id,
                memo_room_id: roomId,
                default_visibility: defaultVisibility,
            });

        if (stateError) {
            return NextResponse.json({ error: "Failed to seed agent room state" }, { status: 500, headers: MEMO_ROOM_CORS });
        }

        return NextResponse.json(
            { participant: serializeParticipant(data as MemoRoomParticipantRow) },
            { status: 201, headers: MEMO_ROOM_CORS }
        );
    }

    const targetUserId = body.userId?.trim();
    if (!targetUserId) {
        return NextResponse.json({ error: "'userId' is required" }, { status: 422, headers: MEMO_ROOM_CORS });
    }

    const { data, error } = await supabaseAdmin
        .from("memo_room_participants")
        .insert({
            memo_room_id: roomId,
            participant_type: "human",
            user_id: targetUserId,
            role,
            capability,
            default_visibility: defaultVisibility,
            status: "active",
            invited_by_user_id: userId,
        })
        .select("id, memo_room_id, participant_type, user_id, agent_id, role, capability, default_visibility, status")
        .single();

    if (error || !data) {
        return NextResponse.json({ error: "Failed to add participant" }, { status: 500, headers: MEMO_ROOM_CORS });
    }

    return NextResponse.json(
        { participant: serializeParticipant(data as MemoRoomParticipantRow) },
        { status: 201, headers: MEMO_ROOM_CORS }
    );
}
