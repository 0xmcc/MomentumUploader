import { NextRequest, NextResponse } from "next/server";
import { getActiveHumanParticipant, MEMO_ROOM_CORS } from "@/lib/memo-rooms";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { supabaseAdmin } from "@/lib/supabase";

type Params = { params: Promise<{ roomId: string; messageId: string; reactionType: string }> };

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: MEMO_ROOM_CORS });
}

export async function DELETE(req: NextRequest, { params }: Params) {
    const userId = await resolveMemoUserId(req);
    const { roomId, messageId, reactionType } = await params;

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

    const { error } = await supabaseAdmin
        .from("message_reactions")
        .delete()
        .eq("message_id", messageId)
        .eq("user_id", userId)
        .eq("reaction_type", reactionType)
        .select("id")
        .single();

    if (error) {
        return NextResponse.json({ error: "Failed to remove reaction" }, { status: 500, headers: MEMO_ROOM_CORS });
    }

    return NextResponse.json({ success: true }, { headers: MEMO_ROOM_CORS });
}
