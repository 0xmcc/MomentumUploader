export type Memo = {
  id: string;
  transcript: string;
  createdAt: string;
  url?: string;
  modelUsed?: string;
  wordCount: number;
  durationSeconds?: number;
  success?: boolean;
};

export const FAILED_TRANSCRIPT = "[Transcription failed]";
export const DEFAULT_PENDING_MIME_TYPE = "audio/webm";
export const SHARE_STATE_RESET_MS = 5000;
export const MEMO_RECONCILE_DELAY_MS = 1500;
export const MEMO_TITLE_WORD_LIMIT = 6;

export function isMemoFailed(memo: Pick<Memo, "transcript">) {
  return memo.transcript === FAILED_TRANSCRIPT || !memo.transcript;
}

export function getMemoTitle(memo: Memo) {
  if (isMemoFailed(memo)) {
    return "Transcription failed";
  }

  const words = memo.transcript.split(" ");
  if (words.length <= MEMO_TITLE_WORD_LIMIT) {
    return memo.transcript;
  }

  return `${words.slice(0, MEMO_TITLE_WORD_LIMIT).join(" ")}...`;
}

export function getFileExtensionFromMime(mimeType: string) {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  return "webm";
}

export function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMins = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatSecs(s: number) {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function exportMarkdown(memo: Memo) {
  const date = new Date(memo.createdAt).toISOString();
  const duration =
    memo.durationSeconds != null ? formatSecs(memo.durationSeconds) : "unknown";
  const safeTitle = date.slice(0, 10);

  const md = [
    "---",
    `id: ${memo.id}`,
    `date: "${date}"`,
    `model: "${memo.modelUsed ?? "unknown"}"`,
    `word_count: ${memo.wordCount}`,
    `duration: "${duration}"`,
    memo.url ? `audio_url: "${memo.url}"` : null,
    "---",
    "",
    "# Voice Memo Transcript",
    "",
    "## Metadata",
    "",
    "| Field | Value |",
    "| ----- | ----- |",
    `| Date | ${new Date(memo.createdAt).toLocaleString("en-US", {
      dateStyle: "long",
      timeStyle: "short",
    })} |`,
    `| Duration | ${duration} |`,
    `| Word count | ${memo.wordCount} |`,
    `| Model | ${memo.modelUsed ?? "unknown"} |`,
    memo.url ? `| Audio | [Listen](${memo.url}) |` : null,
    "",
    "## Transcript",
    "",
    memo.transcript || "*(no transcript)*",
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");

  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `memo-${safeTitle}-${memo.id.slice(0, 8)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  if (typeof document === "undefined") {
    return false;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.select();

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    document.body.removeChild(textArea);
  }

  return copied;
}
