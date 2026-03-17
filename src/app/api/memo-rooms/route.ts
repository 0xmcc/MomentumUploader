import { NextRequest, NextResponse } from "next/server";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { MEMO_ROOM_CORS } from "@/lib/memo-rooms";
import { supabaseAdmin } from "@/lib/supabase";

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: MEMO_ROOM_CORS });
}

export async function POST(req: NextRequest) {
    const userId = await resolveMemoUserId(req);
    if (!userId) {
        return NextResponse.json({ error: "Memo not found" }, { status: 404, headers: MEMO_ROOM_CORS });
    }

    let body: {
        memoId?: string;
        title?: string;
        description?: string;
    };

    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: MEMO_ROOM_CORS });
    }

    if (!body.memoId) {
        return NextResponse.json({ error: "'memoId' is required" }, { status: 422, headers: MEMO_ROOM_CORS });
    }

    const { data: memo, error: memoError } = await supabaseAdmin
        .from("memos")
        .select("id, user_id, title")
        .eq("id", body.memoId)
        .eq("user_id", userId)
        .single();

    if (memoError || !memo) {
        return NextResponse.json({ error: "Memo not found" }, { status: 404, headers: MEMO_ROOM_CORS });
    }

    const title = body.title?.trim() || (typeof memo.title === "string" && memo.title.trim()) || "Memo Room";
    const description = body.description?.trim() || null;

    const { data: room, error: roomError } = await supabaseAdmin
        .from("memo_rooms")
        .insert({
            owner_user_id: userId,
            title,
            description,
        })
        .select()
        .single();

    if (roomError || !room) {
        return NextResponse.json({ error: "Failed to create memo room" }, { status: 500, headers: MEMO_ROOM_CORS });
    }

    const { error: roomMemoError } = await supabaseAdmin
        .from("memo_room_memos")
        .insert({
            memo_room_id: room.id,
            memo_id: body.memoId,
        });

    if (roomMemoError) {
        return NextResponse.json({ error: "Failed to attach memo to room" }, { status: 500, headers: MEMO_ROOM_CORS });
    }

    const { error: participantError } = await supabaseAdmin
        .from("memo_room_participants")
        .insert({
            memo_room_id: room.id,
            participant_type: "human",
            user_id: userId,
            role: "owner",
            capability: "full_participation",
            default_visibility: "public",
            status: "active",
        });

    if (participantError) {
        return NextResponse.json({ error: "Failed to seed room owner" }, { status: 500, headers: MEMO_ROOM_CORS });
    }

    return NextResponse.json(
        {
            room: {
                id: room.id,
                ownerUserId: room.owner_user_id,
                title: room.title,
                description: room.description ?? null,
                createdAt: room.created_at,
                memos: [{ memoId: body.memoId }],
            },
        },
        { status: 201, headers: MEMO_ROOM_CORS }
    );
}
