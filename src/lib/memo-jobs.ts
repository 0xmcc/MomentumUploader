import type { SupabaseClient } from "@supabase/supabase-js";
import { compactLiveChunks } from "@/lib/memo-chunks";
import {
    enqueueLiveSummaryJobIfNeeded,
    enqueueOutlineJobIfNeeded,
    executeFinalArtifacts,
    executeLiveSummary,
    executeOutline,
} from "@/lib/memo-artifacts";

type JobRunRow = {
    id: number;
    user_id: string;
    entity_id: string;
    job_type: string;
};

async function claimPendingMemoJob(
    memoId: string,
    supabase: SupabaseClient,
): Promise<JobRunRow | null> {
    const { data, error } = await supabase.rpc("claim_pending_memo_job", {
        p_memo_id: memoId,
    });

    if (error) {
        throw error;
    }

    if (!data) return null;
    if (Array.isArray(data)) {
        return (data[0] as JobRunRow | undefined) ?? null;
    }

    return data as JobRunRow;
}

async function finishJobRun(
    jobId: number,
    status: "succeeded" | "failed",
    payload: Record<string, unknown>,
    supabase: SupabaseClient,
) {
    const { error } = await supabase
        .from("job_runs")
        .update({
            status,
            finished_at: new Date().toISOString(),
            ...(status === "succeeded"
                ? { result: payload }
                : { error: String(payload.error ?? "Job failed") }),
        })
        .eq("id", jobId);

    if (error) {
        throw error;
    }
}

export async function runPendingMemoJobs(
    memoId: string,
    supabase: SupabaseClient,
) {
    for (;;) {
        const job = await claimPendingMemoJob(memoId, supabase);
        if (!job) return;

        try {
            console.log("[memo-jobs] started", {
                memoId,
                jobType: job.job_type,
                jobId: job.id,
            });

            switch (job.job_type) {
                case "memo_chunk_compact_live": {
                    const compacted = await compactLiveChunks(memoId, job.user_id, supabase);
                    if (compacted.latestChunkIndex >= 0) {
                        await enqueueLiveSummaryJobIfNeeded(memoId, job.user_id, supabase);
                        await enqueueOutlineJobIfNeeded(memoId, job.user_id, supabase);
                    }
                    await finishJobRun(job.id, "succeeded", compacted, supabase);
                    console.log("[memo-jobs] succeeded", {
                        memoId,
                        jobType: job.job_type,
                        jobId: job.id,
                    });
                    break;
                }
                case "memo_summary_live": {
                    await executeLiveSummary(job.entity_id, job.user_id, supabase);
                    await finishJobRun(job.id, "succeeded", {}, supabase);
                    console.log("[memo-jobs] succeeded", {
                        memoId,
                        jobType: job.job_type,
                        jobId: job.id,
                    });
                    break;
                }
                case "memo_outline_live": {
                    await executeOutline(job.entity_id, "live", supabase);
                    await finishJobRun(job.id, "succeeded", {}, supabase);
                    console.log("[memo-jobs] succeeded", {
                        memoId,
                        jobType: job.job_type,
                        jobId: job.id,
                    });
                    break;
                }
                case "memo_artifact_final": {
                    await executeFinalArtifacts(job.entity_id, job.user_id, supabase);
                    await finishJobRun(job.id, "succeeded", {}, supabase);
                    console.log("[memo-jobs] succeeded", {
                        memoId,
                        jobType: job.job_type,
                        jobId: job.id,
                    });
                    break;
                }
                default:
                    throw new Error(`Unsupported memo job type: ${job.job_type}`);
            }
        } catch (error) {
            await finishJobRun(
                job.id,
                "failed",
                { error: error instanceof Error ? error.message : String(error) },
                supabase,
            );
            console.log("[memo-jobs] failed", {
                memoId,
                jobType: job.job_type,
                jobId: job.id,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
}
