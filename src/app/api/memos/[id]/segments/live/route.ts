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

    await runPendingMemoJobs(memoId, supabaseAdmin);

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
            status: "queued",
        });

    if (jobError) {
        return NextResponse.json(
            { error: jobError.message ?? "Failed to queue memo job" },
            { status: 500, headers: CORS },
        );
    }

    return NextResponse.json({ ok: true }, { headers: CORS });
}
