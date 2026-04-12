import type { NextRequest } from "next/server";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { resolveMemoShare } from "@/lib/memo-share";
import { isValidShareToken } from "@/lib/share-access";
import { supabaseAdmin } from "@/lib/supabase";

type Params = { params: Promise<{ memoId: string }> };

async function resolveAgentAccess(memoId: string, shareToken: string) {
  if (!isValidShareToken(shareToken)) {
    return null;
  }

  const share = await resolveMemoShare(shareToken);
  if (share.status !== "ok") {
    return null;
  }

  return share.memo.memoId === memoId ? share.memo : null;
}

export async function GET(req: Request, { params }: Params): Promise<Response> {
  const userId = await resolveMemoUserId(req as NextRequest);
  if (!userId) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const { memoId } = await params;
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId")?.trim() ?? "";
  const shareToken = url.searchParams.get("shareToken")?.trim() ?? "";

  if (!sessionId || !shareToken) {
    return Response.json({ error: "Missing sessionId or shareToken." }, { status: 400 });
  }

  const memo = await resolveAgentAccess(memoId, shareToken);
  if (!memo) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const { data: session, error } = await supabaseAdmin
    .from("memo_agent_sessions")
    .select("ui_messages, provider_session_id")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .eq("memo_id", memo.memoId)
    .single();

  if (error || !session) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  return Response.json({
    messages: session.ui_messages ?? [],
    hasHistory: session.provider_session_id !== null,
  });
}
