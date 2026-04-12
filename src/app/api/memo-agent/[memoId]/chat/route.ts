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

  let body: { sessionId?: string; message?: string; shareToken?: string };
  try {
    body = (await req.json()) as {
      sessionId?: string;
      message?: string;
      shareToken?: string;
    };
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const sessionId = body.sessionId?.trim() ?? "";
  const message = body.message?.trim() ?? "";
  const shareToken = body.shareToken?.trim() ?? "";

  if (!sessionId || !message) {
    return Response.json({ error: "Session and message are required." }, { status: 422 });
  }

  const memo = await resolveAgentAccess(memoId, shareToken);
  if (!memo) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const { data: session, error: sessionError } = await supabaseAdmin
    .from("memo_agent_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .eq("memo_id", memo.memoId)
    .single();

  if (sessionError || !session) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const { data: credits } = await supabaseAdmin
    .from("user_credits")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle();

  if (Number(credits?.balance ?? 100) < 1) {
    return Response.json({ error: "insufficient_credits" }, { status: 402 });
  }

  const channelName = `memo-agent:job:${crypto.randomUUID()}`;

  const { data: job, error: jobError } = await supabaseAdmin
    .from("job_runs")
    .insert({
      user_id: userId,
      job_type: "memo_agent_chat",
      entity_type: "memo_agent_session",
      entity_id: sessionId,
      status: "pending",
      params: {
        user_message: message,
        channel_name: channelName,
        memo_id: memo.memoId,
      },
    })
    .select("id")
    .single();

  if (jobError?.code === "23505") {
    return Response.json({ error: "job_in_progress" }, { status: 409 });
  }

  if (jobError || !job) {
    return Response.json({ error: "Failed to queue chat job." }, { status: 500 });
  }

  return Response.json({
    jobId: job.id,
    channelName,
  });
}
