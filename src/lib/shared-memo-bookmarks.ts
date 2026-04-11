import type { ResolvedMemoShare } from "@/lib/share-domain";

export type SharedMemoBookmark = {
  memoId: string;
  shareToken: string;
  title: string;
  authorName: string;
  authorAvatarUrl: string | null;
  createdAt: string;
  bookmarkedAt: string;
};

export function buildSharedMemoBookmark(
  memo: Pick<
    ResolvedMemoShare,
    "memoId" | "shareToken" | "title" | "authorName" | "authorAvatarUrl" | "createdAt"
  >,
  bookmarkedAt: string
): SharedMemoBookmark {
  return {
    memoId: memo.memoId,
    shareToken: memo.shareToken,
    title: memo.title,
    authorName: memo.authorName,
    authorAvatarUrl: memo.authorAvatarUrl,
    createdAt: memo.createdAt,
    bookmarkedAt,
  };
}
