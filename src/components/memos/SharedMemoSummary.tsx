import type { ResolvedMemoShare } from "@/lib/share-domain";

function formatDateLabel(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }

  return new Date(parsed).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function SharedMemoSummary({
  memo,
}: {
  memo: ResolvedMemoShare;
}) {
  return (
    <section className="rounded-3xl border border-white/10 bg-neutral-950 p-6 text-white shadow-2xl shadow-black/20">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.24em] text-orange-300/80">
            Shared Memo
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">{memo.title}</h1>
          <p className="text-sm text-white/60">
            {memo.authorName} · {formatDateLabel(memo.createdAt)}
          </p>
        </div>
        <a
          href={`/s/${memo.shareToken}`}
          className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/80 transition hover:border-white/30 hover:text-white"
        >
          Open export
        </a>
      </div>

      <div className="grid gap-4 text-sm text-white/70 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
          <div className="mb-1 text-xs uppercase tracking-[0.18em] text-white/40">
            Status
          </div>
          <div>{memo.transcriptStatus ?? "available"}</div>
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
          <div className="mb-1 text-xs uppercase tracking-[0.18em] text-white/40">
            Recording
          </div>
          <div>{memo.isLiveRecording ? "Live memo" : "Uploaded memo"}</div>
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
          <div className="mb-1 text-xs uppercase tracking-[0.18em] text-white/40">
            Share token
          </div>
          <div className="truncate font-mono text-xs text-white/65">{memo.shareToken}</div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-white/8 bg-white/[0.02] p-5">
        <div className="mb-3 text-xs uppercase tracking-[0.18em] text-white/40">
          Transcript
        </div>
        <p className="whitespace-pre-wrap text-base leading-7 text-white/78">
          {memo.transcript || "No transcript available."}
        </p>
      </div>
    </section>
  );
}
