import { NextRequest, NextResponse } from "next/server";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { findMemoDiscussion, type MemoDiscussion } from "@/lib/memo-discussion";
import { supabaseAdmin } from "@/lib/supabase";

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

type Params = { params: Promise<{ id: string }> };

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

    let discussion: MemoDiscussion | null;
    try {
        discussion = await findMemoDiscussion(memoId);
    } catch {
        return NextResponse.json(
            { error: "Failed to load memo room." },
            { status: 500, headers: CORS }
        );
    }

    const roomId = discussion?.roomId ?? null;

    return NextResponse.json(
        {
            room: roomId ? { roomId } : null,
        },
        { headers: CORS }
    );
}
