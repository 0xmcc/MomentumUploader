import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { isMissingColumnError } from "@/lib/supabase-compat";

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const MEMO_SELECT_WITH_STATUS =
    "id, title, transcript, audio_url, duration, created_at, transcript_status";
const MEMO_SELECT_LEGACY =
    "id, title, transcript, audio_url, duration, created_at";

type MemoRow = {
    id: string;
    title: string | null;
    transcript: string | null;
    audio_url: string | null;
    duration: number | null;
    created_at: string;
    transcript_status?: "processing" | "complete" | "failed" | null;
};

type MemoArtifactRow = {
    memo_id: string | null;
    source: "live" | "final" | string | null;
    payload: unknown;
};

type MemoListItem = {
    id: string;
    transcriptStatus: "processing" | "complete" | "failed";
};

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: CORS });
}

function readSummaryPayload(payload: unknown) {
    if (!payload || typeof payload !== "object") {
        return null;
    }

    const summary = (payload as { summary?: unknown }).summary;
    return typeof summary === "string" && summary.trim() ? summary.trim() : null;
}

async function loadMemoFeedSummaries(memos: MemoListItem[]) {
    const memoIds = memos.map((memo) => memo.id);
    if (memoIds.length === 0) {
        return new Map<string, string>();
    }

    try {
        const { data, error } = await supabaseAdmin
            .from("memo_artifacts")
            .select("memo_id, source, payload, updated_at, version")
            .in("memo_id", memoIds)
            .eq("artifact_type", "rolling_summary")
            .eq("status", "ready")
            .order("updated_at", { ascending: false });

        if (error || !Array.isArray(data)) {
            return new Map<string, string>();
        }

        const desiredSourceByMemo = new Map(
            memos.map((memo) => [
                memo.id,
                memo.transcriptStatus === "processing" ? "live" : "final",
            ])
        );
        const summaryByMemo = new Map<string, string>();
        const sourceByMemo = new Map<string, string | null>();

        for (const row of data as MemoArtifactRow[]) {
            if (!row.memo_id || !memoIds.includes(row.memo_id)) {
                continue;
            }

            const summary = readSummaryPayload(row.payload);
            if (!summary) {
                continue;
            }

            const desiredSource = desiredSourceByMemo.get(row.memo_id) ?? "final";
            const existingSource = sourceByMemo.get(row.memo_id);
            if (
                !summaryByMemo.has(row.memo_id) ||
                (row.source === desiredSource && existingSource !== desiredSource)
            ) {
                summaryByMemo.set(row.memo_id, summary);
                sourceByMemo.set(row.memo_id, row.source);
            }
        }

        return summaryByMemo;
    } catch {
        return new Map<string, string>();
    }
}

/** GET /api/memos
 * Query params:
 *   search   - filter by transcript content
 *   limit    - max results (default 50, max 200)
 *   offset   - pagination offset (default 0)
 */
export async function GET(req: NextRequest) {
    const userId = await resolveMemoUserId(req);
    if (!userId) {
        return NextResponse.json(
            { memos: [], total: 0, limit: 50, offset: 0 },
            { headers: CORS }
        );
    }

    const { searchParams } = req.nextUrl;
    const search = searchParams.get("search") ?? "";
    const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);
    const offset = Number(searchParams.get("offset") ?? 0);

    const buildQuery = (selectClause: string) => supabaseAdmin
        .from("memos")
        .select(selectClause, { count: "exact" })
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

    let query = buildQuery(MEMO_SELECT_WITH_STATUS);

    if (search) {
        query = query.ilike("transcript", `%${search}%`);
    }

    let { data, error, count } = await query;

    if (isMissingColumnError(error, "memos", "transcript_status")) {
        let legacyQuery = buildQuery(MEMO_SELECT_LEGACY);
        if (search) {
            legacyQuery = legacyQuery.ilike("transcript", `%${search}%`);
        }

        const legacyResult = await legacyQuery;
        data = legacyResult.data;
        error = legacyResult.error;
        count = legacyResult.count;
    }

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
    }

    const rows = (data ?? []) as unknown as MemoRow[];

    const memos = rows.map((row) => ({
        id: row.id,
        title: row.title ?? null,
        transcript: row.transcript ?? "",
        url: row.audio_url ?? null,
        durationSeconds: row.duration ?? null,
        wordCount: row.transcript ? row.transcript.split(/\s+/).filter(Boolean).length : 0,
        createdAt: row.created_at,
        updatedAt: row.created_at, // No updated_at in schema, fallback to created_at
        transcriptStatus: (row.transcript_status ?? "complete") as "processing" | "complete" | "failed",
    }));
    const summaryByMemo = await loadMemoFeedSummaries(memos);

    return NextResponse.json(
        {
            memos: memos.map((memo) => ({
                ...memo,
                summary: summaryByMemo.get(memo.id) ?? null,
            })),
            total: count ?? memos.length,
            limit,
            offset,
        },
        { headers: CORS }
    );
}

/** POST /api/memos
 * Body (JSON):
 *   transcript  string  - required, the text content
 *   title       string  - optional
 *   audioUrl    string  - optional, link to existing audio file
 */
export async function POST(req: NextRequest) {
    const userId = await resolveMemoUserId(req);

    let body: { transcript?: string; title?: string; audioUrl?: string };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
    }

    if (!body.transcript?.trim()) {
        return NextResponse.json({ error: "'transcript' is required" }, { status: 422, headers: CORS });
    }

    const { data, error } = await supabaseAdmin.from("memos").insert({
        title: body.title ?? "Manual Voice Memo",
        transcript: body.transcript,
        audio_url: body.audioUrl ?? "",
        user_id: userId ?? null,
    }).select().single();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
    }

    return NextResponse.json(
        {
            memo: {
                id: data.id,
                title: data.title,
                transcript: data.transcript,
                audioUrl: data.audio_url,
                createdAt: data.created_at,
            },
        },
        { status: 201, headers: CORS }
    );
}
