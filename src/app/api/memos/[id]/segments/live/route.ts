import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { lockedSegmentToDbRow, type LiveLockedSegment } from "@/lib/live-segments";
import { runPendingMemoJobs } from "@/lib/memo-jobs";

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

type Params = { params: Promise<{ id: string }> };

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: CORS });
}

export async function PATCH(req: NextRequest, { params }: Params) {
    const userId = await resolveMemoUserId(req);
    if (!userId) {
        return NextResponse.json({ error: "Memo not found" }, { status: 404, headers: CORS });
    }

    const { id: memoId } = await params;
    const { data: memo, error: memoError } = await supabaseAdmin
        .from("memos")
        .select("id")
        .eq("id", memoId)
        .eq("user_id", userId)
        .single();

    if (memoError || !memo) {
        return NextResponse.json({ error: "Memo not found" }, { status: 404, headers: CORS });
    }

    try {
        await runPendingMemoJobs(memoId, supabaseAdmin);
    } catch (jobError) {
        const err = jobError as { code?: string; message?: string };
        if (err?.code === "PGRST202") {
            console.warn(
                "[segments/live] runPendingMemoJobs skipped: claim_pending_memo_job not in schema.",
                { memoId },
            );
        } else {
            console.error("[segments/live] runPendingMemoJobs failed", { memoId, error: err });
        }
    }

    let body: { segments?: LiveLockedSegment[] };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
    }

    const segments = Array.isArray(body.segments) ? body.segments : [];
    if (segments.length === 0) {
        return NextResponse.json({ ok: true }, { headers: CORS });
    }

    const rows = segments.map((segment) =>
        lockedSegmentToDbRow({
            memoId,
            userId,
            segment,
        })
    );

    const { error: upsertError } = await supabaseAdmin
        .from("memo_transcript_segments")
        .upsert(rows, {
            onConflict: "memo_id,segment_index,source",
        });

    if (upsertError) {
        console.error("[segments/live] memo_transcript_segments upsert failed", {
            memoId,
            userId,
            segmentCount: rows.length,
            error: upsertError.message,
            code: upsertError.code,
            details: upsertError.details,
        });
        return NextResponse.json(
            { error: upsertError.message ?? "Failed to persist live segments" },
            { status: 500, headers: CORS },
        );
    }

    const { error: jobError } = await supabaseAdmin
        .from("job_runs")
        .insert({
            user_id: userId,
            job_type: "memo_chunk_compact_live",
            entity_type: "memo",
            entity_id: memoId,
            status: "pending",
        });

    if (jobError) {
        const isCheckConstraint = jobError.code === "23514";
        const isDuplicateActiveJob = jobError.code === "23505";
        if (isCheckConstraint) {
            console.warn("[segments/live] job_runs insert skipped: status check constraint (e.g. 'queued' not allowed).", {
                memoId,
                code: jobError.code,
            });
        } else if (isDuplicateActiveJob) {
            console.log("[memo-jobs] queued", {
                memoId,
                jobType: "memo_chunk_compact_live",
                duplicate: true,
            });
        } else {
            console.error("[segments/live] job_runs insert failed", {
                memoId,
                userId,
                error: jobError.message,
                code: jobError.code,
                details: jobError.details,
            });
            return NextResponse.json(
                { error: jobError.message ?? "Failed to queue memo job" },
                { status: 500, headers: CORS },
            );
        }
    } else {
        console.log("[memo-jobs] queued", {
            memoId,
            jobType: "memo_chunk_compact_live",
        });
    }

    return NextResponse.json({ ok: true }, { headers: CORS });
}
