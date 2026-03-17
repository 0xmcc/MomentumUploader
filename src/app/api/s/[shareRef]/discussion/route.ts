import { auth } from "@clerk/nextjs/server";
import { createMessageId } from "@/lib/memo-rooms";
import {
  findMemoDiscussion,
  getOrCreateMemoDiscussion,
} from "@/lib/memo-discussion";
import { resolveMemoShare } from "@/lib/memo-share";
import { isValidShareToken } from "@/lib/share-access";
import { supabaseAdmin } from "@/lib/supabase";

type Params = { params: Promise<{ shareRef: string }> };

type DiscussionMessageRow = {
  id: string;
  memo_id: string;
  content: string;
  anchor_start_ms: number | null;
  created_at: string;
  author_participant?:
    | {
        participant_type?: string | null;
        role?: string | null;
      }
    | Array<{
        participant_type?: string | null;
        role?: string | null;
      }>
    | null;
};

function respondShareStatus(status: "not_found" | "revoked" | "expired"): Response {
  if (status === "not_found") {
    return Response.json({ error: "This share link is not available." }, { status: 404 });
  }

  if (status === "revoked") {
    return Response.json({ error: "This share link is no longer active." }, { status: 410 });
  }

  return Response.json({ error: "This share link has expired." }, { status: 410 });
}

function resolveAuthorName(message: DiscussionMessageRow): string {
  const author = Array.isArray(message.author_participant)
    ? message.author_participant[0] ?? null
    : message.author_participant ?? null;

  if (author?.role === "owner") {
    return "Owner";
  }

  if (author?.participant_type === "agent") {
    return "Agent";
  }

  return "Participant";
}

function serializeDiscussionMessage(message: DiscussionMessageRow) {
  return {
    id: message.id,
    memoId: message.memo_id,
    authorName: resolveAuthorName(message),
    content: message.content,
    anchorStartMs: message.anchor_start_ms,
    createdAt: message.created_at,
  };
}

async function resolveSharedMemo(shareRef: string) {
  if (!isValidShareToken(shareRef)) {
    return { ok: false as const, response: respondShareStatus("not_found") };
  }

  const share = await resolveMemoShare(shareRef);
  if (share.status !== "ok") {
    return { ok: false as const, response: respondShareStatus(share.status) };
  }

  return { ok: true as const, memo: share.memo };
}

export async function GET(_req: Request, { params }: Params): Promise<Response> {
  const { shareRef } = await params;
  const share = await resolveSharedMemo(shareRef);

  if (!share.ok) {
    return share.response;
  }

  const { userId } = await auth();
  const isOwner = userId != null && userId === share.memo.ownerUserId;
  const isAuthenticated = userId != null;
  const discussion = await findMemoDiscussion(
    share.memo.memoId,
    share.memo.ownerUserId
  );

  if (!discussion) {
    return Response.json({
      messages: [],
      isOwner,
      isAuthenticated,
    });
  }

  const { data, error } = await supabaseAdmin
    .from("memo_messages")
    .select(
      "id, memo_id, content, anchor_start_ms, created_at, author_participant:memo_room_participants!memo_messages_author_participant_id_fkey(participant_type, role)"
    )
    .eq("memo_room_id", discussion.roomId)
    .eq("visibility", "public")
    .order("created_at", { ascending: true });

  if (error) {
    return Response.json(
      { error: "Failed to load discussion." },
      { status: 500 }
    );
  }

  return Response.json({
    messages: ((data ?? []) as DiscussionMessageRow[]).map(
      serializeDiscussionMessage
    ),
    isOwner,
    isAuthenticated,
  });
}

export async function POST(req: Request, { params }: Params): Promise<Response> {
  const { shareRef } = await params;
  const share = await resolveSharedMemo(shareRef);

  if (!share.ok) {
    return share.response;
  }

  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  if (userId !== share.memo.ownerUserId) {
    return Response.json({ error: "Only the memo owner can post." }, { status: 403 });
  }

  let body: { content?: string };
  try {
    body = (await req.json()) as { content?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const content = body.content?.trim();
  if (!content) {
    return Response.json({ error: "Content is required." }, { status: 422 });
  }

  let discussion;
  try {
    discussion = await getOrCreateMemoDiscussion(
      share.memo.memoId,
      userId,
      share.memo.title
    );
  } catch {
    return Response.json(
      { error: "Failed to prepare discussion." },
      { status: 500 }
    );
  }

  const messageId = createMessageId();
  const { data, error } = await supabaseAdmin
    .from("memo_messages")
    .insert({
      id: messageId,
      memo_room_id: discussion.roomId,
      memo_id: share.memo.memoId,
      author_participant_id: discussion.ownerParticipantId,
      content,
      visibility: "public",
      restricted_participant_ids: null,
      reply_to_message_id: null,
      root_message_id: messageId,
      anchor_start_ms: null,
      anchor_end_ms: null,
      anchor_segment_ids: null,
    })
    .select("id, memo_id, content, anchor_start_ms, created_at")
    .single();

  if (error || !data) {
    return Response.json({ error: "Failed to create message." }, { status: 500 });
  }

  return Response.json(
    {
      message: {
        id: data.id,
        memoId: data.memo_id,
        authorName: "Owner",
        content: data.content,
        anchorStartMs: data.anchor_start_ms,
        createdAt: data.created_at,
      },
    },
    { status: 201 }
  );
}
