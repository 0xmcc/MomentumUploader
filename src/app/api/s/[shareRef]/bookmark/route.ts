import { auth } from "@clerk/nextjs/server";
import { resolveSharedMemoForRoute } from "@/lib/share-route";
import { buildSharedMemoBookmark } from "@/lib/shared-memo-bookmarks";
import { supabaseAdmin } from "@/lib/supabase";

type Params = { params: Promise<{ shareRef: string }> };

async function requireViewerAndSharedMemo(params: Params["params"]) {
  const { userId } = await auth();
  if (!userId) {
    return {
      ok: false as const,
      userId: null,
      shared: null,
      response: Response.json({ error: "Authentication required." }, { status: 401 }),
    };
  }

  const { shareRef } = await params;
  const shared = await resolveSharedMemoForRoute(shareRef);
  if (!shared.ok) {
    return {
      ok: false as const,
      userId,
      shared: null,
      response: shared.response,
    };
  }

  return {
    ok: true as const,
    userId,
    shared,
  };
}

async function loadBookmarkCount(memoId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("shared_memo_bookmarks")
    .select("*", { count: "exact", head: true })
    .eq("memo_id", memoId);

  if (error || typeof count !== "number" || !Number.isFinite(count)) {
    return 0;
  }

  return Math.max(0, count);
}

export async function GET(_req: Request, { params }: Params): Promise<Response> {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({
      isAuthenticated: false,
      isBookmarked: false,
      bookmarkCount: 0,
    });
  }

  const { shareRef } = await params;
  const shared = await resolveSharedMemoForRoute(shareRef);
  if (!shared.ok) {
    return shared.response;
  }

  const { data, error } = await supabaseAdmin
    .from("shared_memo_bookmarks")
    .select("created_at")
    .eq("user_id", userId)
    .eq("memo_id", shared.memo.memoId)
    .maybeSingle();

  if (error) {
    return Response.json({ error: "Failed to load bookmark state." }, { status: 500 });
  }

  const bookmarkCount = await loadBookmarkCount(shared.memo.memoId);

  return Response.json({
    isAuthenticated: true,
    isBookmarked: Boolean(data),
    bookmarkCount,
  });
}

export async function POST(_req: Request, { params }: Params): Promise<Response> {
  const result = await requireViewerAndSharedMemo(params);
  if (!result.ok) {
    return result.response;
  }

  const { userId, shared } = result;
  const { data, error } = await supabaseAdmin
    .from("shared_memo_bookmarks")
    .upsert(
      {
        user_id: userId,
        memo_id: shared.memo.memoId,
      },
      { onConflict: "user_id,memo_id" }
    )
    .select("created_at")
    .single();

  if (error || !data?.created_at) {
    return Response.json({ error: "Failed to save bookmark." }, { status: 500 });
  }

  return Response.json({
    bookmark: buildSharedMemoBookmark(shared.memo, data.created_at as string),
  });
}

export async function DELETE(_req: Request, { params }: Params): Promise<Response> {
  const result = await requireViewerAndSharedMemo(params);
  if (!result.ok) {
    return result.response;
  }

  const { userId, shared } = result;
  const { error } = await supabaseAdmin
    .from("shared_memo_bookmarks")
    .delete()
    .eq("user_id", userId)
    .eq("memo_id", shared.memo.memoId)
    .select("memo_id")
    .maybeSingle();

  if (error) {
    return Response.json({ error: "Failed to remove bookmark." }, { status: 500 });
  }

  return Response.json({ success: true });
}
