import { NextResponse } from "next/server";
import { FAILED_TRANSCRIPT } from "@/lib/memo-ui";
import { compactFinalChunks } from "@/lib/memo-chunks";
import { enqueueFinalArtifactsJob } from "@/lib/memo-artifacts";
import { runPendingMemoJobs } from "@/lib/memo-jobs";
import { generateMemoTitle } from "@/lib/memo-title";
import { supabaseAdmin } from "@/lib/supabase";
import { isMissingColumnError } from "@/lib/supabase-compat";
import type { TranscriptSegment } from "@/lib/transcript";
import {
    ERR,
    fail,
    LOG,
    ok,
    PROVISIONAL_MEMO_TITLE,
    readErrorMessage,
    TRANSCRIBE_MODEL,
    type JsonResponse,
    type StepResult,
} from "./workflow.shared";

function isMissingClaimPendingMemoJobError(error: unknown): boolean {
    const errorRecord =
        error && typeof error === "object"
            ? (error as Record<string, unknown>)
            : null;
    const code = typeof errorRecord?.code === "string" ? errorRecord.code : undefined;
    const message = readErrorMessage(error);

    return code === "PGRST202" && message.includes("claim_pending_memo_job");
}

function successResponse(
    id: string,
    text: string,
    url: string,
    transcriptStatus: "complete" | "failed" = "complete"
): JsonResponse {
    return NextResponse.json({
        success: true,
        id,
        text,
        url,
        modelUsed: TRANSCRIBE_MODEL,
        transcriptStatus,
    });
}

export async function promoteLiveSegmentsToFinal(
    memoId: string,
    userId: string
): Promise<void> {
    try {
        const { data: liveSegments, error: selectError } = await supabaseAdmin
            .from("memo_transcript_segments")
            .select("memo_id, user_id, segment_index, start_ms, end_ms, text, source")
            .eq("memo_id", memoId)
            .eq("source", "live")
            .order("segment_index", { ascending: true })
            .order("start_ms", { ascending: true });

        if (selectError) {
            throw selectError;
        }
        if (!liveSegments || liveSegments.length === 0) {
            return;
        }

        const { error: deleteError } = await supabaseAdmin
            .from("memo_transcript_segments")
            .delete()
            .eq("memo_id", memoId)
            .eq("source", "final");

        if (deleteError) {
            throw deleteError;
        }

        const promotedRows = liveSegments.map((segment) => ({
            memo_id: memoId,
            user_id: userId,
            segment_index: segment.segment_index,
            start_ms: segment.start_ms,
            end_ms: segment.end_ms,
            text: segment.text,
            source: "final" as const,
        }));

        const { error: insertError } = await supabaseAdmin
            .from("memo_transcript_segments")
            .insert(promotedRows);

        if (insertError) {
            throw insertError;
        }
    } catch (error) {
        ERR("db", "Promoting live segments to final failed", {
            memoId,
            userId,
            error: readErrorMessage(error) || String(error),
        });
    }
}

export async function persistMemoProvisional(
    memoId: string | null,
    audioUrl: string,
    userId: string
): Promise<StepResult<{ memoId: string }>> {
    LOG(
        "db",
        memoId
            ? "Provisional update of existing memo..."
            : "Provisional insert into memos..."
    );

    const tryUpsert = async (): Promise<StepResult<{ memoId: string }>> => {
        const updateExistingMemo = (includeTranscriptStatus: boolean) => {
            const payload: Record<string, unknown> = { audio_url: audioUrl };
            if (includeTranscriptStatus) {
                payload.transcript_status = "processing";
            }

            return supabaseAdmin
                .from("memos")
                .update(payload)
                .eq("id", memoId)
                .eq("user_id", userId)
                .select("id")
                .maybeSingle();
        };

        const insertMemo = (includeTranscriptStatus: boolean) => {
            const payload: Record<string, unknown> = {
                title: PROVISIONAL_MEMO_TITLE,
                transcript: "",
                audio_url: audioUrl,
                user_id: userId,
            };
            if (includeTranscriptStatus) {
                payload.transcript_status = "processing";
            }

            return supabaseAdmin
                .from("memos")
                .insert(payload)
                .select("id")
                .single();
        };

        if (memoId) {
            let { data: updatedMemo, error: updateError } = await updateExistingMemo(true);

            if (isMissingColumnError(updateError, "memos", "transcript_status")) {
                const legacyResult = await updateExistingMemo(false);
                updatedMemo = legacyResult.data;
                updateError = legacyResult.error;
            }

            if (!updateError && updatedMemo?.id) {
                LOG("db", "Provisional update succeeded", { id: updatedMemo.id });
                return ok({ memoId: updatedMemo.id });
            }

            LOG("db", "Provisional update found no row, falling back to insert", {
                memoId,
                error: updateError?.message ?? "memo not found",
            });
        }

        let { data: insertData, error: insertError } = await insertMemo(true);

        if (isMissingColumnError(insertError, "memos", "transcript_status")) {
            const legacyResult = await insertMemo(false);
            insertData = legacyResult.data;
            insertError = legacyResult.error;
        }

        if (insertError || !insertData?.id) {
            ERR("db", "Provisional insert failed", insertError);
            return fail(
                NextResponse.json(
                    {
                        error: "Failed to save memo",
                        detail: insertError?.message ?? "No ID returned",
                    },
                    { status: 500 }
                )
            );
        }

        LOG("db", "Provisional insert succeeded", { id: insertData.id });
        return ok({ memoId: insertData.id });
    };

    try {
        const result = await tryUpsert();
        if (!result.ok) {
            LOG("db", "Provisional persist failed, retrying once...");
            return await tryUpsert();
        }
        return result;
    } catch (dbError) {
        ERR("db", "Provisional persist threw, retrying once...", dbError);
        try {
            return await tryUpsert();
        } catch (retryError) {
            ERR("db", "Provisional persist retry also threw", retryError);
            return fail(
                NextResponse.json(
                    { error: "Failed to save memo", detail: String(retryError) },
                    { status: 500 }
                )
            );
        }
    }
}

export async function updateMemoFinal(
    memoId: string,
    transcript: string,
    segments: TranscriptSegment[],
    audioUrl: string,
    userId: string,
    startedAtMs: number
): Promise<JsonResponse> {
    LOG("db", "Finalizing memo with transcript...");

    try {
        const updateFinalMemo = (includeTranscriptStatus: boolean) => {
            const payload: Record<string, unknown> = { transcript };
            if (includeTranscriptStatus) {
                payload.transcript_status = "complete";
            }

            return supabaseAdmin
                .from("memos")
                .update(payload)
                .eq("id", memoId)
                .eq("user_id", userId);
        };

        let { error } = await updateFinalMemo(true);

        if (isMissingColumnError(error, "memos", "transcript_status")) {
            const legacyResult = await updateFinalMemo(false);
            error = legacyResult.error;
        }

        if (error) {
            ERR("db", "Final transcript update failed", error);
            return NextResponse.json(
                { error: "Failed to save transcript", detail: error.message },
                { status: 500 }
            );
        }

        LOG("db", "Memo finalized", { id: memoId });

        try {
            const aiTitle = await generateMemoTitle(transcript, userId, supabaseAdmin);
            const { error: titleError } = await supabaseAdmin
                .from("memos")
                .update({ title: aiTitle })
                .eq("id", memoId)
                .eq("user_id", userId);

            if (titleError) {
                ERR("db", "Failed to save AI title", titleError);
            } else {
                LOG("db", "AI title saved", { id: memoId, title: aiTitle });
            }
        } catch (titleErr) {
            ERR("db", "AI title generation threw", titleErr);
        }

        let finalSegmentsPersisted = segments.length === 0;

        if (segments.length > 0) {
            try {
                const { error: deleteErr } = await supabaseAdmin
                    .from("memo_transcript_segments")
                    .delete()
                    .eq("memo_id", memoId)
                    .eq("source", "final");

                if (deleteErr) {
                    throw deleteErr;
                }

                const rows = segments.map((seg, index) => ({
                    memo_id: memoId,
                    user_id: userId,
                    segment_index: index,
                    start_ms: seg.startMs,
                    end_ms: seg.endMs,
                    text: seg.text,
                    source: "final" as const,
                }));

                const { error: segErr } = await supabaseAdmin
                    .from("memo_transcript_segments")
                    .insert(rows);

                if (segErr) {
                    throw segErr;
                }

                finalSegmentsPersisted = true;
            } catch (segmentError) {
                ERR(
                    "db",
                    "Segment persistence failed — anchor timestamps unavailable for this memo",
                    {
                        memoId,
                        segmentCount: segments.length,
                        error: readErrorMessage(segmentError) || String(segmentError),
                    }
                );
            }
        }

        if (finalSegmentsPersisted) {
            try {
                await runPendingMemoJobs(memoId, supabaseAdmin);
            } catch (jobError) {
                if (isMissingClaimPendingMemoJobError(jobError)) {
                    console.warn(
                        "[transcribe/db] runPendingMemoJobs skipped: claim_pending_memo_job not in schema.",
                        { memoId }
                    );
                } else {
                    ERR("db", "runPendingMemoJobs failed before final artifact upgrade", {
                        memoId,
                        error: readErrorMessage(jobError) || String(jobError),
                    });
                }
            }

            try {
                await compactFinalChunks(memoId, userId, supabaseAdmin);
                await enqueueFinalArtifactsJob(memoId, userId, supabaseAdmin);
                await runPendingMemoJobs(memoId, supabaseAdmin);
            } catch (artifactError) {
                ERR("db", "Final chunk/artifact upgrade failed", {
                    memoId,
                    error: readErrorMessage(artifactError) || String(artifactError),
                });
            }
        }

        LOG("timing", "Total request ms", Date.now() - startedAtMs);
        LOG("done", "Returning success response");
        return successResponse(memoId, transcript, audioUrl);
    } catch (dbError) {
        ERR("db", "Unexpected error finalizing memo", dbError);
        return NextResponse.json(
            { error: "Failed to save transcript", detail: String(dbError) },
            { status: 500 }
        );
    }
}

export async function updateMemoFailed(
    memoId: string,
    audioUrl: string,
    userId: string,
    startedAtMs: number
): Promise<JsonResponse> {
    LOG("db", "Marking memo as transcription-failed...");

    try {
        const updateFailedMemo = (includeTranscriptStatus: boolean) => {
            const payload: Record<string, unknown> = {
                transcript: FAILED_TRANSCRIPT,
            };
            if (includeTranscriptStatus) {
                payload.transcript_status = "failed";
            }

            return supabaseAdmin
                .from("memos")
                .update(payload)
                .eq("id", memoId)
                .eq("user_id", userId);
        };

        let { error } = await updateFailedMemo(true);

        if (isMissingColumnError(error, "memos", "transcript_status")) {
            const legacyResult = await updateFailedMemo(false);
            error = legacyResult.error;
        }

        if (error) {
            throw error;
        }
    } catch (dbError) {
        ERR("db", "Failed to mark memo as failed", dbError);
    }

    LOG("timing", "Total request ms", Date.now() - startedAtMs);
    return successResponse(memoId, FAILED_TRANSCRIPT, audioUrl, "failed");
}
