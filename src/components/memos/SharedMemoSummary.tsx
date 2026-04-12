"use client";

import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import type { ResolvedMemoShare } from "@/lib/share-domain";
import { copyToClipboard, formatSecs } from "@/lib/memo-ui";

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

function getRenderableTranscriptSegments(memo: ResolvedMemoShare) {
  return Array.isArray(memo.transcriptSegments)
    ? memo.transcriptSegments.filter((segment) => segment.text.trim().length > 0)
    : [];
}

function resolveConfiguredShareUrl(shareToken: string): string {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configuredSiteUrl) {
    return `/s/${shareToken}`;
  }

  try {
    return new URL(`/s/${shareToken}`, configuredSiteUrl).toString();
  } catch {
    return `/s/${shareToken}`;
  }
}

export default function SharedMemoSummary({
  memo,
}: {
  memo: ResolvedMemoShare;
}) {
  const transcriptSegments = getRenderableTranscriptSegments(memo);
  const hasTranscriptSegments = transcriptSegments.length > 0;
  const [shareUrl, setShareUrl] = useState(() => resolveConfiguredShareUrl(memo.shareToken));
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    const configuredShareUrl = resolveConfiguredShareUrl(memo.shareToken);
    if (configuredShareUrl.startsWith("/")) {
      setShareUrl(`${window.location.origin}${configuredShareUrl}`);
      return;
    }

    setShareUrl(configuredShareUrl);
  }, [memo.shareToken]);

  useEffect(() => {
    if (copyStatus === "idle") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setCopyStatus("idle");
    }, 1500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [copyStatus]);

  async function handleCopyShareLink() {
    const copied = await copyToClipboard(shareUrl);
    setCopyStatus(copied ? "copied" : "failed");
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-neutral-950 p-6 text-white shadow-2xl shadow-black/20 lg:flex lg:h-full lg:min-h-0 lg:flex-col">
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
            Share link
          </div>
          <button
            type="button"
            onClick={() => {
              void handleCopyShareLink();
            }}
            className="flex w-full items-center gap-2 text-left font-mono text-xs text-orange-300 transition hover:text-orange-200"
          >
            <span className="min-w-0 flex-1 truncate underline decoration-orange-400/70 underline-offset-4">
              {shareUrl}
            </span>
            <Copy aria-hidden="true" size={12} className="shrink-0 text-orange-300/75" />
          </button>
          {(copyStatus === "copied" || copyStatus === "failed") ? (
            <div className="mt-1 text-[11px] text-white/45">
              {copyStatus === "copied" ? "Copied" : "Copy failed"}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-white/8 bg-white/[0.02] p-5 lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
        <div className="mb-3 text-xs uppercase tracking-[0.18em] text-white/40">
          Transcript
        </div>
        {hasTranscriptSegments ? (
          <div className="space-y-3">
            {transcriptSegments.map((segment) => (
              <div
                key={segment.id}
                className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 rounded-2xl px-4 py-3"
              >
                <div className="pt-1 font-mono text-xs uppercase tracking-[0.18em] text-orange-300/75">
                  {formatSecs(segment.startMs / 1000)}
                </div>
                <p className="text-base leading-7 text-white/78">{segment.text}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="whitespace-pre-wrap text-base leading-7 text-white/78">
            {memo.transcript || "No transcript available."}
          </p>
        )}
      </div>
    </section>
  );
}
