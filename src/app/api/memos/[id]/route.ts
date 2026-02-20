import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: CORS });
}

type Params = { params: Promise<{ id: string }> };

/** GET /api/memos/:id */
export async function GET(_req: NextRequest, { params }: Params) {
    const { id } = await params;

    const { data, error } = await supabaseAdmin
        .from("items")
        .select("id, title, content, source_url, metadata, created_at, updated_at")
        .eq("id", id)
        .eq("type", "voice")
        .single();

    if (error || !data) {
        return NextResponse.json({ error: "Memo not found" }, { status: 404, headers: CORS });
    }

    return NextResponse.json(
        {
            memo: {
                id: data.id,
                title: data.title ?? null,
                transcript: data.content ?? "",
                audioUrl: data.source_url ?? data.metadata?.file_url ?? null,
                wordCount: data.content ? data.content.split(/\s+/).filter(Boolean).length : 0,
                createdAt: data.created_at,
                updatedAt: data.updated_at,
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
    const { id } = await params;

    let body: { title?: string; transcript?: string };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.title !== undefined) updates.title = body.title;
    if (body.transcript !== undefined) {
        updates.content = body.transcript;
        updates.content_hash = `manual_edit_${Date.now()}`;
    }

    const { data, error } = await supabaseAdmin
        .from("items")
        .update(updates)
        .eq("id", id)
        .eq("type", "voice")
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
                transcript: data.content ?? "",
                audioUrl: data.source_url,
                updatedAt: data.updated_at,
            },
        },
        { headers: CORS }
    );
}

/** DELETE /api/memos/:id */
export async function DELETE(_req: NextRequest, { params }: Params) {
    const { id } = await params;

    const { error } = await supabaseAdmin
        .from("items")
        .delete()
        .eq("id", id)
        .eq("type", "voice");

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
    }

    return NextResponse.json({ success: true, deleted: id }, { headers: CORS });
}
