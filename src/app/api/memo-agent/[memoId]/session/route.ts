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

export async function POST(req: NextRequest, { params }: Params): Promise<Response> {
  const userId = await resolveMemoUserId(req);
  if (!userId) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const { memoId } = await params;

  let body: { shareToken?: string };
  try {
    body = (await req.json()) as { shareToken?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const shareToken = body.shareToken?.trim() ?? "";
  const memo = await resolveAgentAccess(memoId, shareToken);
  if (!memo) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const { error: resetError } = await supabaseAdmin.rpc(
    "reset_monthly_credits_if_needed",
    { p_user_id: userId }
  );
  if (resetError) {
    return Response.json({ error: "Failed to prepare credits." }, { status: 500 });
  }

  const { data: session, error: sessionError } = await supabaseAdmin
    .from("memo_agent_sessions")
    .upsert({ user_id: userId, memo_id: memo.memoId }, { onConflict: "user_id,memo_id" })
    .select("id, provider_session_id")
    .single();

  if (sessionError || !session) {
    return Response.json({ error: "Failed to prepare session." }, { status: 500 });
  }

  const { data: credits } = await supabaseAdmin
    .from("user_credits")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle();

  return Response.json({
    sessionId: session.id,
    creditBalance: Number(credits?.balance ?? 100),
    hasHistory: session.provider_session_id !== null,
  });
}
