/**
 * The transcription job: the slow thing, moved out of the HTTP request.
 *
 * A 1h42m recording sat on "Transcribing…" forever because finalize
 * transcribed inline — one request holding an hours-long job. This runs in the
 * worker instead, and the rule it is held to is the one from
 * docs/PRODUCT-SPEC.md: **`done` means the transcript exists.** Not an exit
 * code, not a call that returned. A transcriber that finishes cleanly having
 * produced nothing fails the job here, loudly, with the memo marked failed
 * rather than left spinning.
 *
 * Resumability is three small decisions, not a framework:
 *   - the assembled audio is written to storage and recorded on the memo
 *     BEFORE transcription starts, so a retry skips reassembly;
 *   - the chunk objects are deleted only after the transcript is safely
 *     written, so a failed attempt never destroys the only copy of the audio;
 *   - the job row is touched only at the very end, so a worker killed
 *     mid-transcription leaves it `running` and un-heartbeated — which
 *     `recover_stale_transcribe_jobs` turns back into `pending`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deliverTranscriptWebhook,
  type TranscriptWebhookEvent,
  type TranscriptWebhookResult,
} from "../../src/lib/transcript-webhook";

const AUDIO_BUCKET = "voice-memos";
const DEFAULT_HEARTBEAT_INTERVAL_MS = 60_000;

export type TranscriptSegmentLike = {
  id?: string;
  startMs: number;
  endMs: number;
  text: string;
};

export type TranscribeJobRow = {
  id: string;
  user_id: string;
  job_type: string;
  entity_type: string;
  entity_id: string;
  status: string;
  params?: {
    chunk_paths?: string[];
    upload_content_type?: string;
    upload_file_extension?: string;
    duration_seconds?: number;
  } | null;
};

export type TranscribeFn = (
  audio: Buffer,
  contentType: string
) => Promise<{ transcript: string; segments: TranscriptSegmentLike[] }>;

export type ProcessTranscribeJobDeps = {
  transcribe?: TranscribeFn;
  deliverWebhook?: (
    event: TranscriptWebhookEvent
  ) => Promise<TranscriptWebhookResult>;
  /** Returns the function that stops it. Injected so tests need no timers. */
  startHeartbeat?: (jobId: string) => () => void;
  heartbeatIntervalMs?: number;
  fetchImpl?: typeof fetch;
};

export type TranscribeJobResult =
  | { ok: true; memoId: string; transcript: string; segmentCount: number }
  | { ok: false; memoId: string; error: string };

type MemoRow = {
  id: string;
  user_id: string;
  audio_url: string | null;
  duration_seconds?: number | null;
};

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "");
  }
  return String(error);
}

/**
 * The real transcriber, resolved late so that a worker with no NVIDIA key
 * fails the job with a clear reason instead of crashing at import time.
 */
async function defaultTranscribe(
  audio: Buffer,
  contentType: string
): Promise<{ transcript: string; segments: TranscriptSegmentLike[] }> {
  const apiKey = process.env.NVIDIA_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "Transcription is not configured: NVIDIA_API_KEY is not set on the worker."
    );
  }

  const { transcribeAudio } = await import("../../src/lib/riva");
  return transcribeAudio(audio, apiKey, contentType, { priority: "final" });
}

function defaultHeartbeat(
  supabase: SupabaseClient,
  intervalMs: number
): (jobId: string) => () => void {
  return (jobId: string) => {
    const beat = () => {
      void supabase
        .rpc("heartbeat_job_run", { p_job_id: jobId })
        .then((result: { error?: unknown }) => {
          if (result?.error) {
            console.error("[memo-transcribe] heartbeat failed", result.error);
          }
        });
    };

    // Beat once immediately: a job claimed and then stuck on a slow download
    // should not look stale just because the first interval has not elapsed.
    beat();
    const timer = setInterval(beat, intervalMs);
    if (typeof timer.unref === "function") timer.unref();

    return () => clearInterval(timer);
  };
}

async function loadMemo(
  supabase: SupabaseClient,
  memoId: string,
  userId: string
): Promise<MemoRow | null> {
  const { data, error } = await supabase
    .from("memos")
    .select("id, user_id, audio_url")
    .eq("id", memoId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return (data as MemoRow | null) ?? null;
}

async function downloadAssembledAudio(
  audioUrl: string,
  fetchImpl: typeof fetch
): Promise<Buffer> {
  const response = await fetchImpl(audioUrl);
  if (!response.ok) {
    throw new Error(`Could not download assembled audio (HTTP ${response.status}).`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Join the uploaded chunks into the one object the memo points at. This is the
 * part that used to happen inside the finalize request, where hundreds of
 * megabytes could not fit.
 */
async function assembleChunks(
  supabase: SupabaseClient,
  chunkPaths: string[],
  memoId: string,
  contentType: string,
  extension: string
): Promise<{ audio: Buffer; audioUrl: string }> {
  const storage = supabase.storage.from(AUDIO_BUCKET);
  const buffers: Buffer[] = [];

  for (const chunkPath of chunkPaths) {
    const { data, error } = await storage.download(chunkPath);
    if (error || !data) {
      throw new Error(
        `Could not download audio chunk ${chunkPath}: ${readErrorMessage(error)}`
      );
    }
    buffers.push(Buffer.from(await data.arrayBuffer()));
  }

  const audio = Buffer.concat(buffers);
  const objectPath = `audio/${Date.now()}_${memoId}.${extension}`;
  const { error: uploadError } = await storage.upload(objectPath, audio, {
    contentType,
    upsert: true,
  });

  if (uploadError) {
    throw new Error(`Could not store assembled audio: ${readErrorMessage(uploadError)}`);
  }

  const { data: publicUrlData } = storage.getPublicUrl(objectPath);
  return { audio, audioUrl: publicUrlData.publicUrl };
}

async function writeTranscript(
  supabase: SupabaseClient,
  memo: MemoRow,
  transcript: string,
  segments: TranscriptSegmentLike[]
): Promise<void> {
  const { error } = await supabase
    .from("memos")
    .update({ transcript, transcript_status: "complete" })
    .eq("id", memo.id)
    .eq("user_id", memo.user_id);

  if (error) {
    // The transcript is the artifact. If it did not land, the job did not
    // succeed, whatever the transcriber said.
    throw new Error(`Could not save the transcript: ${readErrorMessage(error)}`);
  }

  if (segments.length === 0) return;

  const { error: deleteError } = await supabase
    .from("memo_transcript_segments")
    .delete()
    .eq("memo_id", memo.id)
    .eq("source", "final");

  if (deleteError) {
    throw new Error(`Could not clear old segments: ${readErrorMessage(deleteError)}`);
  }

  const rows = segments.map((segment, index) => ({
    memo_id: memo.id,
    user_id: memo.user_id,
    segment_index: index,
    start_ms: segment.startMs,
    end_ms: segment.endMs,
    text: segment.text,
    source: "final" as const,
  }));

  const { error: insertError } = await supabase
    .from("memo_transcript_segments")
    .insert(rows);

  if (insertError) {
    throw new Error(`Could not save segments: ${readErrorMessage(insertError)}`);
  }
}

async function finishJob(
  supabase: SupabaseClient,
  jobId: string,
  status: "succeeded" | "failed",
  payload: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase
    .from("job_runs")
    .update({
      status,
      finished_at: new Date().toISOString(),
      ...(status === "succeeded"
        ? { result: payload }
        : { error: String(payload.error ?? "Transcription failed") }),
    })
    .eq("id", jobId);

  if (error) {
    console.error("[memo-transcribe] could not finish job row", { jobId, error });
  }
}

export async function processTranscribeJob(
  job: TranscribeJobRow,
  supabase: SupabaseClient,
  deps: ProcessTranscribeJobDeps = {}
): Promise<TranscribeJobResult> {
  const transcribe = deps.transcribe ?? defaultTranscribe;
  const deliverWebhook = deps.deliverWebhook ?? deliverTranscriptWebhook;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const startHeartbeat =
    deps.startHeartbeat ??
    defaultHeartbeat(supabase, deps.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS);

  const memoId = job.entity_id;
  const params = job.params ?? {};
  const contentType = params.upload_content_type ?? "audio/webm";
  const extension = params.upload_file_extension ?? "webm";
  const chunkPaths = params.chunk_paths ?? [];

  const stopHeartbeat = startHeartbeat(job.id);
  let audioUrl: string | null = null;

  try {
    const memo = await loadMemo(supabase, memoId, job.user_id);
    if (!memo) {
      throw new Error(`Memo ${memoId} not found for user ${job.user_id}.`);
    }

    audioUrl = memo.audio_url;
    let audio: Buffer;
    let assembledNow = false;

    if (memo.audio_url) {
      // A previous attempt already joined the chunks. Resume from that.
      audio = await downloadAssembledAudio(memo.audio_url, fetchImpl);
    } else if (chunkPaths.length > 0) {
      const assembled = await assembleChunks(
        supabase,
        chunkPaths,
        memoId,
        contentType,
        extension
      );
      audio = assembled.audio;
      audioUrl = assembled.audioUrl;
      assembledNow = true;
    } else {
      throw new Error(`Job ${job.id} has neither assembled audio nor chunks to join.`);
    }

    if (assembledNow) {
      // Record the audio before the slow part, so a retry resumes here.
      const { error } = await supabase
        .from("memos")
        .update({ audio_url: audioUrl })
        .eq("id", memoId)
        .eq("user_id", job.user_id);

      if (error) {
        throw new Error(`Could not record the assembled audio: ${readErrorMessage(error)}`);
      }
    }

    const transcription = await transcribe(audio, contentType);
    const transcript = (transcription?.transcript ?? "").trim();

    if (!transcript) {
      // The scenario that matters: a clean return with nothing in it.
      throw new Error(
        "The transcriber returned no transcript — treating the job as failed."
      );
    }

    const segments = transcription.segments ?? [];
    await writeTranscript(supabase, memo, transcript, segments);

    await finishJob(supabase, job.id, "succeeded", {
      memo_id: memoId,
      characters: transcript.length,
      segments: segments.length,
      audio_url: audioUrl,
    });

    if (chunkPaths.length > 0) {
      const { error: removeError } = await supabase.storage
        .from(AUDIO_BUCKET)
        .remove(chunkPaths);
      if (removeError) {
        console.error("[memo-transcribe] chunk cleanup failed", removeError);
      }
    }

    await deliverWebhook({
      event: "transcript.ready",
      memoId,
      userId: job.user_id,
      transcript,
      transcriptStatus: "complete",
      durationSeconds: params.duration_seconds,
      segmentCount: segments.length,
      audioUrl,
    });

    console.log("[memo-transcribe] done", {
      memoId,
      jobId: job.id,
      characters: transcript.length,
    });

    return { ok: true, memoId, transcript, segmentCount: segments.length };
  } catch (error) {
    const message = readErrorMessage(error) || "Transcription failed";

    // A memo left on "processing" is the original bug. Mark it, always.
    const { error: memoError } = await supabase
      .from("memos")
      .update({ transcript_status: "failed" })
      .eq("id", memoId)
      .eq("user_id", job.user_id);

    if (memoError) {
      console.error("[memo-transcribe] could not mark the memo failed", memoError);
    }

    await finishJob(supabase, job.id, "failed", { error: message });

    await deliverWebhook({
      event: "transcript.failed",
      memoId,
      userId: job.user_id,
      transcriptStatus: "failed",
      error: message,
      audioUrl,
    });

    console.error("[memo-transcribe] failed", { memoId, jobId: job.id, error: message });

    return { ok: false, memoId, error: message };
  } finally {
    stopHeartbeat();
  }
}
