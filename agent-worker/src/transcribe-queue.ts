/**
 * Taking transcription jobs off the queue, and putting back the ones whose
 * worker died.
 *
 * Kept apart from index.ts so it can be tested without booting the worker or
 * loading the agent SDK, and apart from transcribe.ts so the job and the
 * plumbing around it fail independently.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { processTranscribeJob, type TranscribeJobRow } from "./transcribe";

/**
 * Jobs are worked one at a time — a transcription is not a cheap thing to
 * double up — so this is a cap on how many one drain pass will take before
 * handing control back, not a concurrency level.
 */
export const MAX_TRANSCRIBE_JOBS_PER_DRAIN = 25;

/**
 * How long without a heartbeat before a running job is presumed dead. The
 * heartbeat is once a minute, so this is five missed beats — long enough that
 * a slow worker is not robbed, short enough that a killed one is not waited on
 * for hours.
 */
export const STALE_TRANSCRIBE_JOB_SECONDS = 300;

function normalizeClaimedJob(data: unknown): TranscribeJobRow | null {
  if (!data) return null;
  if (Array.isArray(data)) {
    return (data[0] as TranscribeJobRow | undefined) ?? null;
  }
  return data as TranscribeJobRow;
}

export async function claimPendingTranscribeJob(
  client: Pick<SupabaseClient, "rpc">
): Promise<TranscribeJobRow | null> {
  const { data, error } = await client.rpc("claim_pending_transcribe_job");

  if (error) {
    // Not the same as an empty queue, and must never be mistaken for one.
    throw error instanceof Error
      ? error
      : new Error(
          typeof error === "object" && error && "message" in error
            ? String((error as { message?: unknown }).message)
            : String(error)
        );
  }

  return normalizeClaimedJob(data);
}

export async function recoverStaleTranscribeJobs(
  client: Pick<SupabaseClient, "rpc">,
  staleSeconds: number = STALE_TRANSCRIBE_JOB_SECONDS
): Promise<number> {
  const { data, error } = await client.rpc("recover_stale_transcribe_jobs", {
    p_stale_seconds: staleSeconds,
  });

  if (error) {
    console.error("[memo-transcribe] could not recover stale jobs", error);
    return 0;
  }

  const reclaimed = Array.isArray(data) ? data.length : data ? 1 : 0;
  if (reclaimed > 0) {
    console.log("[memo-transcribe] reclaimed stale jobs", { count: reclaimed });
  }

  return reclaimed;
}

export type DrainTranscribeQueueOptions = {
  maxJobs?: number;
  process?: (job: TranscribeJobRow) => Promise<unknown>;
};

export async function drainTranscribeQueue(
  client: SupabaseClient | Pick<SupabaseClient, "rpc">,
  options: DrainTranscribeQueueOptions = {}
): Promise<number> {
  const maxJobs = options.maxJobs ?? MAX_TRANSCRIBE_JOBS_PER_DRAIN;
  const run =
    options.process ??
    ((job: TranscribeJobRow) => processTranscribeJob(job, client as SupabaseClient));

  let handled = 0;

  while (handled < maxJobs) {
    let job: TranscribeJobRow | null;
    try {
      job = await claimPendingTranscribeJob(client);
    } catch (error) {
      console.error("[memo-transcribe] claim failed", error);
      break;
    }

    if (!job) break;
    handled += 1;

    try {
      await run(job);
    } catch (error) {
      // processTranscribeJob already marks its own failures; this is the last
      // resort, and it must not stop the jobs queued behind this one.
      console.error("[memo-transcribe] job threw", { jobId: job.id, error });
    }
  }

  return handled;
}
