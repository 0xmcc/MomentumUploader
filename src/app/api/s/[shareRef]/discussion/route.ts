import { auth } from "@clerk/nextjs/server";
import {
  createMessageId,
  isMessageVisibleToParticipant,
  type MemoMessageRow,
  type MemoRoomParticipantRow,
} from "@/lib/memo-rooms";
import {
  findMemoDiscussion,
  getOrCreateMemoDiscussion,
  type MemoDiscussion,
} from "@/lib/memo-discussion";
import { resolveSharedMemoForRoute } from "@/lib/share-route";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveOwnerIdentity, type OwnerIdentity } from "@/lib/user-identity";

type Params = { params: Promise<{ shareRef: string }> };

type DiscussionAuthorParticipant =
  | {
      participant_type?: string | null;
      user_id?: string | null;
      agent_id?: string | null;
      role?: string | null;
    }
  | Array<{
      participant_type?: string | null;
      user_id?: string | null;
      agent_id?: string | null;
      role?: string | null;
    }>
  | null;

type DiscussionMessageRow = Omit<MemoMessageRow, "author_participant"> & {
  author_participant?:
    | DiscussionAuthorParticipant
    | undefined;
};

function resolveAuthorParticipant(message: DiscussionMessageRow) {
  return Array.isArray(message.author_participant)
    ? message.author_participant[0] ?? null
    : message.author_participant ?? null;
}

function isOwnerAuthoredMessage(message: DiscussionMessageRow): boolean {
  return resolveAuthorParticipant(message)?.role === "owner";
}

function resolveAuthorName(message: DiscussionMessageRow): string {
  const author = resolveAuthorParticipant(message);

  if (author?.role === "owner") {
    return "Memo owner";
  }

  if (author?.participant_type === "agent") {
    return "Agent";
  }

  return "Participant";
}

function serializeDiscussionMessage(
  message: DiscussionMessageRow,
  ownerIdentity: OwnerIdentity | null
) {
  const ownerAuthored = isOwnerAuthoredMessage(message);

  return {
    id: message.id,
    memoId: message.memo_id,
    authorName: ownerAuthored
      ? ownerIdentity?.displayName ?? "Memo owner"
      : resolveAuthorName(message),
    authorAvatarUrl: ownerAuthored ? ownerIdentity?.avatarUrl ?? null : null,
    authorIsOwner: ownerAuthored,
    content: message.content,
    anchorStartMs: message.anchor_start_ms,
    createdAt: message.created_at,
  };
}

export async function GET(_req: Request, { params }: Params): Promise<Response> {
  const { shareRef } = await params;
  const share = await resolveSharedMemoForRoute(shareRef);

  if (!share.ok) {
    return share.response;
  }

  const { userId } = await auth();
  const isOwner = userId != null && userId === share.memo.ownerUserId;
  const isAuthenticated = userId != null;
  let discussion: MemoDiscussion | null;
  try {
    discussion = await findMemoDiscussion(
      share.memo.memoId,
      share.memo.ownerUserId
    );
  } catch {
    return Response.json(
      { error: "Failed to load discussion." },
      { status: 500 }
    );
  }

  if (!discussion) {
    return Response.json({
      messages: [],
      isOwner,
      isAuthenticated,
    });
  }

  const ownerViewer: MemoRoomParticipantRow | null =
    isOwner && discussion.ownerParticipantId
      ? {
          id: discussion.ownerParticipantId,
          memo_room_id: discussion.roomId,
          participant_type: "human",
          user_id: userId,
          role: "owner",
          capability: "full_participation",
          default_visibility: "public",
          status: "active",
        }
      : null;

  let query = supabaseAdmin
    .from("memo_messages")
    .select(
      "id, memo_room_id, memo_id, author_participant_id, content, visibility, restricted_participant_ids, reply_to_message_id, root_message_id, anchor_start_ms, anchor_end_ms, anchor_segment_ids, created_at, author_participant:memo_room_participants!memo_messages_author_participant_id_fkey(participant_type, user_id, agent_id, role)"
    )
    .eq("memo_room_id", discussion.roomId);

  if (!ownerViewer) {
    query = query.eq("visibility", "public");
  }

  const { data, error } = await query.order("created_at", { ascending: true });

  if (error) {
    return Response.json(
      { error: "Failed to load discussion." },
      { status: 500 }
    );
  }

  const rows = (data ?? []) as DiscussionMessageRow[];
  const visibleRows = ownerViewer
    ? rows.filter((message) =>
        isMessageVisibleToParticipant(message as MemoMessageRow, ownerViewer)
      )
    : rows.filter((message) => message.visibility === "public");
  const ownerIdentity = visibleRows.some(isOwnerAuthoredMessage)
    ? await resolveOwnerIdentity(share.memo.ownerUserId)
    : null;

  return Response.json({
    messages: visibleRows.map((message) => serializeDiscussionMessage(message, ownerIdentity)),
    isOwner,
    isAuthenticated,
  });
}

export async function POST(req: Request, { params }: Params): Promise<Response> {
  const { shareRef } = await params;
  const share = await resolveSharedMemoForRoute(shareRef);

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

  const ownerIdentity = await resolveOwnerIdentity(share.memo.ownerUserId);

  return Response.json(
    {
      message: {
        id: data.id,
        memoId: data.memo_id,
        authorName: ownerIdentity?.displayName ?? "Memo owner",
        authorAvatarUrl: ownerIdentity?.avatarUrl ?? null,
        authorIsOwner: true,
        content: data.content,
        anchorStartMs: data.anchor_start_ms,
        createdAt: data.created_at,
      },
    },
    { status: 201 }
  );
}
