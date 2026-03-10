import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";
import { generateMemoTitle } from "@/lib/memo-title";

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: CORS });
}

/** POST /api/memos/:id/title
 * Regenerates an AI title for an existing memo using its transcript.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
    }

    const { id } = await params;

    const { data: memo, error } = await supabaseAdmin
        .from("memos")
        .select("transcript")
        .eq("id", id)
        .eq("user_id", userId)
        .single();

    if (error || !memo) {
        return NextResponse.json({ error: "Memo not found" }, { status: 404, headers: CORS });
    }

    const title = await generateMemoTitle(memo.transcript ?? "", userId, supabaseAdmin);

    const { error: updateError } = await supabaseAdmin
        .from("memos")
        .update({ title })
        .eq("id", id)
        .eq("user_id", userId);

    if (updateError) {
        return NextResponse.json({ error: "Failed to save title" }, { status: 500, headers: CORS });
    }

    return NextResponse.json({ title }, { headers: CORS });
}
