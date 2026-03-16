import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import {
    ARTIFACT_TYPES,
    buildArtifactMap,
    createEmptyArtifactMap,
    type ArtifactType,
} from "@/lib/artifact-types";
import { supabaseAdmin } from "@/lib/supabase";

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

type Params = { params: Promise<{ id: string }> };

function isArtifactSource(value: string | null): value is "live" | "final" {
    return value === "live" || value === "final";
}

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest, { params }: Params) {
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
    }

    const source = req.nextUrl.searchParams.get("source");
    if (!source) {
        return NextResponse.json(
            { error: "Missing required source query parameter." },
            { status: 400, headers: CORS }
        );
    }

    if (!isArtifactSource(source)) {
        return NextResponse.json(
            { error: "Invalid source query parameter." },
            { status: 400, headers: CORS }
        );
    }

    const { id: memoId } = await params;
    const { data: memo, error: memoError } = await supabaseAdmin
        .from("memos")
        .select("id")
        .eq("id", memoId)
        .eq("user_id", userId)
        .maybeSingle();

    if (memoError || !memo) {
        return NextResponse.json({ error: "Memo not found" }, { status: 404, headers: CORS });
    }

    const { data, error } = await supabaseAdmin
        .from("memo_artifacts")
        .select(
            "artifact_type, payload, based_on_chunk_start, based_on_chunk_end, version, updated_at"
        )
        .eq("memo_id", memoId)
        .eq("source", source)
        .eq("status", "ready");

    if (error) {
        return NextResponse.json(
            { error: error.message ?? "Failed to load memo artifacts" },
            { status: 500, headers: CORS }
        );
    }

    const readyRows = (data ?? []).filter((row) =>
        ARTIFACT_TYPES.includes(row.artifact_type as ArtifactType)
    ) as Array<{
        artifact_type: ArtifactType;
        payload: unknown;
        based_on_chunk_start: number | null;
        based_on_chunk_end: number | null;
        version: number | null;
        updated_at: string | null;
    }>;

    const artifactMap =
        readyRows.length > 0 ? buildArtifactMap(readyRows) : createEmptyArtifactMap();

    return NextResponse.json(artifactMap, { headers: CORS });
}
