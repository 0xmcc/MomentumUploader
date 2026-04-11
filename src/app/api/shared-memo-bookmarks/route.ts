import { auth } from "@clerk/nextjs/server";
import { isExpired, isRevoked, resolveExpiration } from "@/lib/share-access";
import { buildSharedMemoBookmark } from "@/lib/shared-memo-bookmarks";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveOwnerIdentity } from "@/lib/user-identity";
import { NextRequest } from "next/server";

type BookmarkRow = {
  memo_id: string;
  created_at: string;
};

type MemoRow = {
  id: string;
  user_id: string | null;
  title: string | null;
  created_at: string;
  share_token: string | null;
  shared_at: string | null;
  revoked_at?: string | null;
  is_shareable?: boolean;
  share_expires_at?: string | null;
  expires_at?: string | null;
};

export async function GET(_req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ bookmarks: [] });
  }

  const { data: bookmarkRows, error: bookmarkError } = await supabaseAdmin
    .from("shared_memo_bookmarks")
    .select("memo_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (bookmarkError || !bookmarkRows || bookmarkRows.length === 0) {
    return Response.json({ bookmarks: [] });
  }

  const orderedBookmarks = bookmarkRows as BookmarkRow[];
  const memoIds = orderedBookmarks.map((row) => row.memo_id);
  const { data: memoRows, error: memoError } = await supabaseAdmin
    .from("memos")
    .select(
      "id, user_id, title, created_at, share_token, shared_at, revoked_at, is_shareable, share_expires_at, expires_at"
    )
    .in("id", memoIds);

  if (memoError || !memoRows) {
    return Response.json({ bookmarks: [] });
  }

  const memosById = new Map<string, MemoRow>();
  for (const row of memoRows as MemoRow[]) {
    const shareToken = typeof row.share_token === "string" ? row.share_token : null;
    if (!shareToken || isRevoked(row) || isExpired(resolveExpiration(row))) {
      continue;
    }
    memosById.set(row.id, row);
  }

  const ownerIdentityCache = new Map<
    string,
    Awaited<ReturnType<typeof resolveOwnerIdentity>>
  >();
  const bookmarks = [];

  for (const bookmarkRow of orderedBookmarks) {
    const memoRow = memosById.get(bookmarkRow.memo_id);
    if (!memoRow) {
      continue;
    }

    const ownerUserId = memoRow.user_id ?? null;
    const cacheKey = ownerUserId ?? "__anonymous__";
    if (!ownerIdentityCache.has(cacheKey)) {
      ownerIdentityCache.set(cacheKey, await resolveOwnerIdentity(ownerUserId));
    }
    const ownerIdentity = ownerIdentityCache.get(cacheKey) ?? null;

    bookmarks.push(
      buildSharedMemoBookmark(
        {
          memoId: memoRow.id,
          shareToken: memoRow.share_token ?? "",
          title: memoRow.title ?? "Shared Voice Memo",
          authorName: ownerIdentity?.displayName ?? "MomentumUploader User",
          authorAvatarUrl: ownerIdentity?.avatarUrl ?? null,
          createdAt: memoRow.created_at,
        },
        bookmarkRow.created_at
      )
    );
  }

  return Response.json({ bookmarks });
}
