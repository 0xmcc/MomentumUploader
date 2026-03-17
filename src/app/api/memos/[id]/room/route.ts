import { NextRequest, NextResponse } from "next/server";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { getActiveHumanParticipant } from "@/lib/memo-rooms";
import { supabaseAdmin } from "@/lib/supabase";

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

type Params = { params: Promise<{ id: string }> };

async function resolveAccessibleRoomIdForMemo(
    memoId: string,
    userId: string
): Promise<string | null> {
    const { data: roomLinks, error: roomLinkError } = await supabaseAdmin
        .from("memo_room_memos")
        .select("memo_room_id")
        .eq("memo_id", memoId);

    if (roomLinkError || !roomLinks || roomLinks.length === 0) {
        return null;
    }

    const linkedRoomIds = roomLinks
        .map((link) =>
            typeof link.memo_room_id === "string" ? link.memo_room_id : null
        )
        .filter((roomId): roomId is string => roomId !== null);

    for (const roomId of linkedRoomIds) {
        const participant = await getActiveHumanParticipant(roomId, userId);
        if (participant) {
            return roomId;
        }
    }

    return null;
}

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest, { params }: Params) {
    const userId = await resolveMemoUserId(req);
    const { id: memoId } = await params;

    if (!userId) {
        return NextResponse.json({ room: null }, { headers: CORS });
    }

    const { data: memo, error: memoError } = await supabaseAdmin
        .from("memos")
        .select("id")
        .eq("id", memoId)
        .eq("user_id", userId)
        .single();

    if (memoError || !memo) {
        return NextResponse.json({ room: null }, { headers: CORS });
    }

    const accessibleRoomId = await resolveAccessibleRoomIdForMemo(memoId, userId);

    return NextResponse.json(
        {
            room: accessibleRoomId ? { roomId: accessibleRoomId } : null,
        },
        { headers: CORS }
    );
}
