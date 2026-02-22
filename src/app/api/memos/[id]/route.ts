import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
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

    return NextResponse.json(
        {
            memo: {
                id: data.id,
                title: data.title ?? null,
                transcript: data.transcript ?? "",
                url: data.audio_url ?? null,
                duration: data.duration ?? null,
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
