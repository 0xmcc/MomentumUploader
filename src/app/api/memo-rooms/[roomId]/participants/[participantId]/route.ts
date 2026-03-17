import { NextRequest, NextResponse } from "next/server";
import { getActiveHumanParticipant, isMessageVisibility, MEMO_ROOM_CORS, serializeParticipant } from "@/lib/memo-rooms";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { supabaseAdmin } from "@/lib/supabase";

type Params = { params: Promise<{ roomId: string; participantId: string }> };

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: MEMO_ROOM_CORS });
}

export async function PATCH(req: NextRequest, { params }: Params) {
    const userId = await resolveMemoUserId(req);
    const { roomId, participantId } = await params;

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

    let body: {
        role?: string;
        capability?: "read_only" | "comment_only" | "full_participation";
        defaultVisibility?: "public" | "owner_only" | "restricted";
        status?: "active" | "removed";
    };

    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: MEMO_ROOM_CORS });
    }

    if (body.defaultVisibility && !isMessageVisibility(body.defaultVisibility)) {
        return NextResponse.json({ error: "Invalid visibility" }, { status: 422, headers: MEMO_ROOM_CORS });
    }

    const updates: Record<string, unknown> = {};
    if (body.role) updates.role = body.role;
    if (body.capability) updates.capability = body.capability;
    if (body.defaultVisibility) updates.default_visibility = body.defaultVisibility;
    if (body.status) {
        updates.status = body.status;
        updates.removed_at = body.status === "removed" ? new Date().toISOString() : null;
    }

    const { data, error } = await supabaseAdmin
        .from("memo_room_participants")
        .update(updates)
        .eq("memo_room_id", roomId)
        .eq("id", participantId)
        .select("id, memo_room_id, participant_type, user_id, agent_id, role, capability, default_visibility, status")
        .single();

    if (error || !data) {
        return NextResponse.json({ error: "Participant not found" }, { status: 404, headers: MEMO_ROOM_CORS });
    }

    if (data.participant_type === "agent" && body.defaultVisibility) {
        await supabaseAdmin
            .from("agent_room_state")
            .update({ default_visibility: body.defaultVisibility })
            .eq("memo_room_id", roomId)
            .eq("agent_id", data.agent_id);
    }

    return NextResponse.json({ participant: serializeParticipant(data as never) }, { headers: MEMO_ROOM_CORS });
}

export async function DELETE(req: NextRequest, { params }: Params) {
    return PATCH(
        new NextRequest(req.url, {
            method: "PATCH",
            body: JSON.stringify({ status: "removed" }),
            headers: req.headers,
        }),
        { params }
    );
}
