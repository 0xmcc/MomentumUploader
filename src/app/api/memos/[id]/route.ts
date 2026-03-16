import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";
import type { TranscriptSegment } from "@/lib/transcript";

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: CORS });
}

type Params = { params: Promise<{ id: string }> };

async function fetchTranscriptSegments(
    memoId: string,
    source: "final" | "live"
): Promise<TranscriptSegment[]> {
    const { data: segRows } = await supabaseAdmin
        .from("memo_transcript_segments")
        .select("segment_index, start_ms, end_ms, text")
        .eq("memo_id", memoId)
        .eq("source", source)
        .order("segment_index", { ascending: true });

    return (segRows ?? []).map((row) => ({
        id: String(row.segment_index),
        startMs: row.start_ms as number,
        endMs: row.end_ms as number,
        text: row.text as string,
    }));
}

/** GET /api/memos/:id */
export async function GET(_req: NextRequest, { params }: Params) {
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ error: "Memo not found" }, { status: 404, headers: CORS });
    }

    const { id } = await params;

    const { data, error } = await supabaseAdmin
        .from("memos")
        .select("id, title, transcript, audio_url, duration, created_at")
        .eq("id", id)
        .eq("user_id", userId)
        .single();

    if (error || !data) {
        return NextResponse.json({ error: "Memo not found" }, { status: 404, headers: CORS });
    }

    let transcriptSegments = await fetchTranscriptSegments(id, "final");
    if (transcriptSegments.length === 0) {
        transcriptSegments = await fetchTranscriptSegments(id, "live");
    }

    return NextResponse.json(
        {
            memo: {
                id: data.id,
                title: data.title ?? null,
                transcript: data.transcript ?? "",
                transcriptSegments,
                url: data.audio_url ?? null,
                durationSeconds: data.duration ?? null,
                wordCount: data.transcript ? data.transcript.split(/\s+/).filter(Boolean).length : 0,
                createdAt: data.created_at,
                updatedAt: data.created_at,
            },
        },
        { headers: CORS }
    );
}

/** PATCH /api/memos/:id
 * Body (JSON):
 *   title       string - optional
 *   transcript  string - optional
 */
export async function PATCH(req: NextRequest, { params }: Params) {
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ error: "Memo not found" }, { status: 404, headers: CORS });
    }

    const { id } = await params;

    let body: { title?: string; transcript?: string };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
    }

    // Fetch current status to enforce finalization lock.
    // A memo that has been finalized (complete or failed) must not have its
    // transcript overwritten by a late live-sync PATCH.
    if (body.transcript !== undefined) {
        const { data: current } = await supabaseAdmin
            .from("memos")
            .select("transcript_status")
            .eq("id", id)
            .eq("user_id", userId)
            .single();

        if (
            current?.transcript_status === "complete" ||
            current?.transcript_status === "failed"
        ) {
            return NextResponse.json(
                { error: "Memo transcript is already finalized" },
                { status: 409, headers: CORS }
            );
        }
    }

    const updates: Record<string, unknown> = {};
    if (body.title !== undefined) updates.title = body.title;
    if (body.transcript !== undefined) {
        updates.transcript = body.transcript;
    }

    const { data, error } = await supabaseAdmin
        .from("memos")
        .update(updates)
        .eq("id", id)
        .eq("user_id", userId)
        .select()
        .single();

    if (error || !data) {
        return NextResponse.json({ error: "Memo not found or update failed" }, { status: 404, headers: CORS });
    }

    return NextResponse.json(
        {
            memo: {
                id: data.id,
                title: data.title ?? null,
                transcript: data.transcript ?? "",
                url: data.audio_url,
                updatedAt: data.created_at,
            },
        },
        { headers: CORS }
    );
}

/** DELETE /api/memos/:id */
export async function DELETE(_req: NextRequest, { params }: Params) {
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ error: "Memo not found" }, { status: 404, headers: CORS });
    }

    const { id } = await params;

    const { data, error } = await supabaseAdmin
        .from("memos")
        .delete()
        .eq("id", id)
        .eq("user_id", userId)
        .select("id")
        .single();

    if (error || !data) {
        return NextResponse.json({ error: "Memo not found" }, { status: 404, headers: CORS });
    }

    return NextResponse.json({ success: true, deleted: id }, { headers: CORS });
}
