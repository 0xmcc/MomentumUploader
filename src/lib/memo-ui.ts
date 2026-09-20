import type { TranscriptSegment } from "@/lib/transcript";
export type { SharedMemoBookmark } from "@/lib/shared-memo-bookmarks";

export type TranscriptStatus = "processing" | "complete" | "failed";

export type Memo = {
  id: string;
  title?: string | null;
  summary?: string | null;
  transcript: string;
  transcriptSegments?: TranscriptSegment[] | null;
  transcriptStatus?: TranscriptStatus;
  createdAt: string;
  url?: string;
  modelUsed?: string;
  wordCount: number;
  durationSeconds?: number;
  success?: boolean;
};

export const FAILED_TRANSCRIPT = "[Transcription failed]";
export const SHARE_STATE_RESET_MS = 5000;
export const MEMO_RECONCILE_DELAY_MS = 1500;
export const MEMO_TITLE_WORD_LIMIT = 6;
export const MEMO_ESTIMATED_COST_PER_MINUTE_USD = 0.3;

export function isMemoFailed(memo: Pick<Memo, "transcript" | "transcriptStatus">) {
  if (memo.transcriptStatus !== undefined) {
    return memo.transcriptStatus === "failed";
  }
  // Fallback for memos fetched before the transcript_status column existed.
  return memo.transcript === FAILED_TRANSCRIPT;
}

export function isMemoProcessing(memo: Pick<Memo, "transcriptStatus">) {
  return memo.transcriptStatus === "processing";
}

/**
 * How long a transcription may sit in "processing" before we stop pretending
 * it is on its way.
 *
 * This was ten minutes flat, from when transcription ran inside one request
 * and nothing could legitimately take longer. It runs in the worker now, and a
 * long recording legitimately takes a long time — so the allowance grows with
 * the recording. Telling the owner of a 1h42m meeting that it "looks stuck,
 * try uploading it again" at minute ten gets you two copies of it and no
 * transcript.
 */
export const TRANSCRIPT_STALLED_AFTER_MS = 10 * 60 * 1000;

/** The wait a recording of this length has earned before it looks dead. */
export function transcriptStalledAfterMs(durationSeconds?: number | null): number {
  const recordingMs =
    typeof durationSeconds === "number" && Number.isFinite(durationSeconds)
      ? Math.max(0, durationSeconds) * 1000
      : 0;
  return TRANSCRIPT_STALLED_AFTER_MS + recordingMs;
}

function minutesSince(createdAt: string, now: number): number | null {
  const started = Date.parse(createdAt);
  if (Number.isNaN(started)) return null;
  return Math.max(0, Math.floor((now - started) / 60_000));
}

type ProgressMemo = Pick<Memo, "transcript" | "transcriptStatus" | "createdAt"> &
  Partial<Pick<Memo, "durationSeconds">>;

/** Processing, still empty, and old enough that something has gone wrong. */
export function isMemoStalled(memo: ProgressMemo, now: number = Date.now()) {
  if (!isMemoProcessing(memo)) return false;
  if (memo.transcript.trim()) return false;
  const started = Date.parse(memo.createdAt);
  if (Number.isNaN(started)) return false;
  return now - started >= transcriptStalledAfterMs(memo.durationSeconds);
}

/**
 * What to show while a transcript is not ready. Never tells the reader to
 * refresh — the page polls — and always says how long it has been waiting, so
 * a slow job is distinguishable from a dead one.
 */
export function describeTranscriptProgress(
  memo: ProgressMemo,
  now: number = Date.now()
): string {
  const elapsed = minutesSince(memo.createdAt, now);
  const waited = elapsed === null ? null : `${elapsed} min`;

  if (isMemoStalled(memo, now)) {
    return waited
      ? `Still transcribing after ${waited}. It looks stuck — the job probably failed. Try uploading it again.`
      : "This looks stuck — the job probably failed. Try uploading it again.";
  }

  return waited
    ? `Transcribing. Started ${waited} ago; this page updates on its own.`
    : "Transcribing. This page updates on its own.";
}

const PROVISIONAL_TITLES = new Set([
  "Voice Memo",
  "Live recording (in progress)",
  "Manual Voice Memo",
]);

export function getMemoTitle(memo: Memo) {
  if (isMemoFailed(memo)) {
    return "Transcription failed";
  }
  if (isMemoProcessing(memo) && !memo.transcript) {
    return "Transcribing…";
  }

  if (memo.title && !PROVISIONAL_TITLES.has(memo.title)) {
    return memo.title;
  }

  const words = memo.transcript.split(" ");
  if (words.length <= MEMO_TITLE_WORD_LIMIT) {
    return memo.transcript;
  }

  return `${words.slice(0, MEMO_TITLE_WORD_LIMIT).join(" ")}...`;
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

export function getMemoEstimatedCostUsd(durationSeconds?: number | null) {
  if (
    durationSeconds == null ||
    !isFinite(durationSeconds) ||
    durationSeconds < 0
  ) {
    return null;
  }

  const rawCost =
    (durationSeconds / 60) * MEMO_ESTIMATED_COST_PER_MINUTE_USD;
  return Math.round(rawCost * 100) / 100;
}

export function formatUsd(amount: number) {
  return `$${amount.toFixed(2)}`;
}

export function formatMemoEstimatedCost(durationSeconds?: number | null) {
  const estimatedCost = getMemoEstimatedCostUsd(durationSeconds);
  return estimatedCost == null ? "--" : formatUsd(estimatedCost);
}

const AUDIO_EXTENSIONS = new Set([
  "aac",
  "flac",
  "m4a",
  "mp3",
  "mp4",
  "ogg",
  "wav",
  "webm",
]);

function getAudioExtensionFromUrl(url: string) {
  const fallback = "webm";

  try {
    const parsed = new URL(url);
    const fileName = parsed.pathname.split("/").pop() ?? "";
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
    return AUDIO_EXTENSIONS.has(ext) ? ext : fallback;
  } catch {
    return fallback;
  }
}

export function getMemoAudioDownloadName(
  memo: Pick<Memo, "id" | "createdAt" | "url">
) {
  const date = new Date(memo.createdAt);
  const safeDate = Number.isNaN(date.getTime())
    ? "unknown-date"
    : date.toISOString().slice(0, 10);
  const ext = memo.url ? getAudioExtensionFromUrl(memo.url) : "webm";
  return `memo-${safeDate}-${memo.id.slice(0, 8)}.${ext}`;
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
