import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Transcription as a queued job rather than work done inside a request.
 *
 * The queue, the worker, atomic claim and stale-job recovery already exist for
 * artifacts and agent chat. Transcription — the one genuinely slow thing this
 * app does — ran inline, which is why an hours-long recording could never
 * finish. These are the pieces that let it join the queue.
 */

export const TRANSCRIBE_JOB_TYPE = "memo_transcribe" as const;

/**
 * Above either of these, a transcribe cannot be trusted to finish inside a
 * request, so it goes to the worker. Both are deliberately conservative: a
 * queued short memo is a small delay, an inline long one is a memo that never
 * completes.
 */
export const INLINE_TRANSCRIPTION_MAX_SECONDS = 5 * 60;
export const INLINE_TRANSCRIPTION_MAX_BYTES = 8 * 1024 * 1024;

type RecordingSize = {
    /** 0 when unknown — manual uploads do not carry a duration. */
    durationSeconds: number;
    /** 0 when unknown. */
    fileSizeBytes: number;
};

/**
 * Queue unless the recording is known to be small. An unknown length is not
 * evidence of a short recording, so silence sends it to the worker.
 */
export function shouldQueueTranscription({
    durationSeconds,
    fileSizeBytes,
}: RecordingSize): boolean {
    const knownShortDuration =
        durationSeconds > 0 && durationSeconds <= INLINE_TRANSCRIPTION_MAX_SECONDS;
    const knownSmallFile =
        fileSizeBytes > 0 && fileSizeBytes <= INLINE_TRANSCRIPTION_MAX_BYTES;

    return !(knownShortDuration || knownSmallFile);
}

/**
 * Write a pending job the existing worker can claim. Throws rather than
 * returning a flag: a caller that cannot queue must not report success.
 */
export type TranscriptionJobParams = {
    /** Where the uploaded chunks are, for the worker to join. */
    chunk_paths?: string[];
    upload_content_type?: string;
    upload_file_extension?: string;
    duration_seconds?: number;
};

export async function enqueueTranscriptionJob(
    memoId: string,
    userId: string,
    supabase: SupabaseClient,
    params: TranscriptionJobParams = {}
): Promise<void> {
    const { error } = await supabase.from("job_runs").insert({
        user_id: userId,
        job_type: TRANSCRIBE_JOB_TYPE,
        entity_type: "memo",
        entity_id: memoId,
        status: "pending",
        params,
    });

    if (error) {
        const message =
            typeof error === "object" && error && "message" in error
                ? String((error as { message: unknown }).message)
                : "could not queue transcription";
        throw new Error(message);
    }

    console.log("[transcription-queue] queued", { memoId });
}
