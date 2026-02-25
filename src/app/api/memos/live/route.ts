import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";
import { LIVE_MEMO_TITLE } from "@/lib/live-memo";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/** POST /api/memos/live
 * Creates an in-progress memo row so transcript updates can be shared live.
 */
export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
  }

  const { data, error } = await supabaseAdmin
    .from("memos")
    .insert({
      title: LIVE_MEMO_TITLE,
      transcript: "",
      audio_url: "",
      user_id: userId,
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    return NextResponse.json(
      { error: error?.message ?? "Unable to create live memo" },
      { status: 500, headers: CORS }
    );
  }

  return NextResponse.json({ memoId: data.id }, { status: 201, headers: CORS });
}
