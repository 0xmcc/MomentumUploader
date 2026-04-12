import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import MemoAgentPanel from "@/components/memos/MemoAgentPanel";
import SharedMemoSummary from "@/components/memos/SharedMemoSummary";
import { resolveMemoShare } from "@/lib/memo-share";
import { parseShareRef } from "@/lib/share-contract";

type Params = {
  params: Promise<{ shareRef: string }>;
};

export default async function SharedMemoChatPage({ params }: Params) {
  const { shareRef } = await params;

  let parsedRef;
  try {
    parsedRef = parseShareRef(shareRef);
  } catch {
    notFound();
  }

  const { shareToken } = parsedRef;
  const { userId } = await auth();

  if (!userId) {
    redirect(`/sign-in?redirect_url=${encodeURIComponent(`/s/${shareRef}/chat`)}`);
  }

  const share = await resolveMemoShare(shareToken);
  if (share.status !== "ok") {
    notFound();
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(255,237,213,0.9),_rgba(250,245,235,1)_42%,_rgba(255,255,255,1)_100%)] p-6 text-stone-900 lg:h-screen lg:overflow-hidden">
      <div className="mx-auto grid max-w-7xl gap-6 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_420px]">
        <SharedMemoSummary memo={share.memo} />
        <MemoAgentPanel memoId={share.memo.memoId} shareToken={shareToken} />
      </div>
    </main>
  );
}
