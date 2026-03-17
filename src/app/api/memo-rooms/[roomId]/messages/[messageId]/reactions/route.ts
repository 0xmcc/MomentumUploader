import { NextRequest, NextResponse } from "next/server";
import { getActiveHumanParticipant, MEMO_ROOM_CORS } from "@/lib/memo-rooms";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { supabaseAdmin } from "@/lib/supabase";

type Params = { params: Promise<{ roomId: string; messageId: string }> };

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: MEMO_ROOM_CORS });
}

export async function POST(req: NextRequest, { params }: Params) {
    const userId = await resolveMemoUserId(req);
    const { roomId, messageId } = await params;

    if (!userId) {
        return NextResponse.json({ error: "Memo room not found" }, { status: 404, headers: MEMO_ROOM_CORS });
    }

    const participant = await getActiveHumanParticipant(roomId, userId);
    if (!participant) {
        return NextResponse.json({ error: "Memo room not found" }, { status: 404, headers: MEMO_ROOM_CORS });
    }

    const { data: message, error: messageError } = await supabaseAdmin
        .from("memo_messages")
        .select("id, memo_room_id")
        .eq("memo_room_id", roomId)
        .eq("id", messageId)
        .single();

    if (messageError || !message) {
        return NextResponse.json({ error: "Message not found" }, { status: 404, headers: MEMO_ROOM_CORS });
    }

    let body: { reactionType?: string };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: MEMO_ROOM_CORS });
    }

    const reactionType = body.reactionType?.trim();
    if (!reactionType) {
        return NextResponse.json({ error: "'reactionType' is required" }, { status: 422, headers: MEMO_ROOM_CORS });
    }

    const { data, error } = await supabaseAdmin
        .from("message_reactions")
        .insert({
            message_id: messageId,
            user_id: userId,
            reaction_type: reactionType,
        })
        .select("id, message_id, user_id, reaction_type, created_at")
        .single();

    if (error || !data) {
        return NextResponse.json({ error: "Failed to create reaction" }, { status: 500, headers: MEMO_ROOM_CORS });
    }

    return NextResponse.json(
        {
            reaction: {
                id: data.id,
                messageId: data.message_id,
                userId: data.user_id,
                reactionType: data.reaction_type,
                createdAt: data.created_at,
            },
        },
        { status: 201, headers: MEMO_ROOM_CORS }
    );
}
