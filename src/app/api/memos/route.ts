import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
    const { searchParams } = req.nextUrl;
    const search = searchParams.get("search") ?? "";
    const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);
    const offset = Number(searchParams.get("offset") ?? 0);

    let query = supabaseAdmin
        .from("items")
        .select("id, title, content, source_url, metadata, created_at, updated_at, source_type", { count: "exact" })
        .eq("type", "voice")
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

    if (search) {
        query = query.ilike("content", `%${search}%`);
    }

    const { data, error, count } = await query;

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
    }

    const memos = (data ?? []).map((row) => ({
        id: row.id,
        title: row.title ?? null,
        transcript: row.content ?? "",
        audioUrl: row.source_url ?? row.metadata?.file_url ?? null,
        wordCount: row.content ? row.content.split(/\s+/).filter(Boolean).length : 0,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
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
    let body: { transcript?: string; title?: string; audioUrl?: string };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
    }

    if (!body.transcript?.trim()) {
        return NextResponse.json({ error: "'transcript' is required" }, { status: 422, headers: CORS });
    }

    const key = `manual_${Date.now()}`;
    const { data, error } = await supabaseAdmin.from("items").insert({
        user_id: "anonymous_user",
        type: "voice",
        source: "manual",
        source_type: "text",
        title: body.title ?? null,
        content: body.transcript,
        source_url: body.audioUrl ?? null,
        metadata: body.audioUrl ? { file_url: body.audioUrl } : {},
        dedupe_key: key,
        content_hash: key,
    }).select().single();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
    }

    return NextResponse.json(
        {
            memo: {
                id: data.id,
                title: data.title,
                transcript: data.content,
                audioUrl: data.source_url,
                createdAt: data.created_at,
            },
        },
        { status: 201, headers: CORS }
    );
}
