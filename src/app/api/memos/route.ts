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

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: CORS });
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
        wordCount: row.transcript ? row.transcript.split(/\s+/).filter(Boolean).length : 0,
        createdAt: row.created_at,
        updatedAt: row.created_at, // No updated_at in schema, fallback to created_at
        transcriptStatus: (row.transcript_status ?? "complete") as "processing" | "complete" | "failed",
    }));

    return NextResponse.json(
        { memos, total: count ?? memos.length, limit, offset },
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
