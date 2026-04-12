import path from "node:path";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";

export const DEFAULT_WORKSPACE_ROOT = "/tmp/memo-workspaces";
const STALE_WORKSPACE_MS = 24 * 60 * 60 * 1000;

type MemoRow = {
  id: string;
  title: string | null;
  created_at: string | null;
  duration: number | null;
  transcript: string | null;
  audio_url?: string | null;
};

type SegmentRow = {
  start_ms: number | null;
  text: string | null;
};

function quoteYaml(value: string | null | undefined): string {
  return JSON.stringify(value ?? "");
}

async function touchHeartbeat(filePath: string, timestamp = new Date()) {
  const value = timestamp.toISOString();
  await writeFile(filePath, `${value}\n`, "utf8");
  await utimes(filePath, timestamp, timestamp);
}

function buildTranscript(segments: SegmentRow[], fallbackTranscript: string | null): string {
  if (segments.length > 0) {
    return segments
      .map((segment) => `[${segment.start_ms ?? 0}ms] ${segment.text ?? ""}`.trimEnd())
      .join("\n");
  }

  return fallbackTranscript?.trim() ? fallbackTranscript : "";
}

async function maybeDownloadAudio(url: string | null | undefined, attachmentsDir: string) {
  if (!url) {
    return;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return;
    }

    const urlObject = new URL(url);
    const extension = path.extname(urlObject.pathname) || ".bin";
    const bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(path.join(attachmentsDir, `memo-audio${extension}`), bytes);
  } catch (error) {
    console.warn("[memo-agent-worker] failed to download memo audio", {
      url,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function materializeWorkspace(
  sessionId: string,
  memoId: string,
  supabase: Pick<SupabaseClient, "from">,
  rootDir = DEFAULT_WORKSPACE_ROOT
) {
  const workspaceDir = path.join(rootDir, sessionId);
  const attachmentsDir = path.join(workspaceDir, "attachments");

  await mkdir(attachmentsDir, { recursive: true });

  const { data: memo, error: memoError } = await supabase
    .from("memos")
    .select("id, title, created_at, duration, transcript, audio_url")
    .eq("id", memoId)
    .maybeSingle();

  if (memoError || !memo) {
    throw new Error(`Memo ${memoId} not found for workspace materialization.`);
  }

  const { data: segments, error: segmentError } = await supabase
    .from("memo_transcript_segments")
    .select("start_ms, text")
    .eq("memo_id", memoId)
    .eq("source", "final")
    .order("segment_index", { ascending: true });

  if (segmentError) {
    throw new Error(
      `Failed to load transcript segments for memo ${memoId}: ${segmentError.message}`
    );
  }

  const memoRow = memo as MemoRow;
  const segmentRows = ((segments ?? []) as SegmentRow[]).filter(
    (segment) => typeof segment.text === "string"
  );

  const transcript = buildTranscript(segmentRows, memoRow.transcript);
  const context = [
    "---",
    `memo_id: ${quoteYaml(memoId)}`,
    `title: ${quoteYaml(memoRow.title)}`,
    `created_at: ${quoteYaml(memoRow.created_at)}`,
    `duration_seconds: ${memoRow.duration ?? 0}`,
    `audio_url: ${quoteYaml(memoRow.audio_url ?? null)}`,
    "---",
    "",
  ].join("\n");

  await Promise.all([
    writeFile(path.join(workspaceDir, "transcript.md"), transcript, "utf8"),
    writeFile(path.join(workspaceDir, "context.md"), context, "utf8"),
    touchHeartbeat(path.join(workspaceDir, ".last_active")),
    maybeDownloadAudio(memoRow.audio_url, attachmentsDir),
  ]);

  return { workspaceDir, attachmentsDir };
}

export async function cleanupStaleWorkspaces(
  rootDir = DEFAULT_WORKSPACE_ROOT,
  nowMs = Date.now()
) {
  await mkdir(rootDir, { recursive: true });

  const entries = await readdir(rootDir, { withFileTypes: true });

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const dirPath = path.join(rootDir, entry.name);
        const heartbeatPath = path.join(dirPath, ".last_active");

        let lastTouchedMs = 0;
        try {
          const fileStat = await stat(heartbeatPath);
          lastTouchedMs = fileStat.mtimeMs;
        } catch {
          try {
            const fileContents = await readFile(heartbeatPath, "utf8");
            lastTouchedMs = Date.parse(fileContents.trim());
          } catch {
            const dirStat = await stat(dirPath);
            lastTouchedMs = dirStat.mtimeMs;
          }
        }

        if (Number.isFinite(lastTouchedMs) && nowMs - lastTouchedMs > STALE_WORKSPACE_MS) {
          await rm(dirPath, { recursive: true, force: true });
        }
      })
  );
}
