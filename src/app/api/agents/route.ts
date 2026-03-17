import { NextRequest, NextResponse } from "next/server";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { serializeAgent, type AgentRow } from "@/lib/agents";
import { supabaseAdmin } from "@/lib/supabase";

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest) {
    const userId = await resolveMemoUserId(req);
    if (!userId) {
        return NextResponse.json({ agents: [] }, { headers: CORS });
    }

    const { data, error } = await supabaseAdmin
        .from("agents")
        .select("id, owner_user_id, name, description, status, created_at")
        .eq("owner_user_id", userId)
        .order("created_at", { ascending: false });

    if (error) {
        return NextResponse.json({ error: "Failed to load agents" }, { status: 500, headers: CORS });
    }

    return NextResponse.json(
        { agents: ((data ?? []) as AgentRow[]).map(serializeAgent) },
        { headers: CORS }
    );
}

export async function POST(req: NextRequest) {
    const userId = await resolveMemoUserId(req);
    if (!userId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
    }

    let body: { name?: string; description?: string };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
    }

    const name = body.name?.trim();
    if (!name) {
        return NextResponse.json({ error: "'name' is required" }, { status: 422, headers: CORS });
    }

    const description = body.description?.trim() || null;
    const { data, error } = await supabaseAdmin
        .from("agents")
        .insert({
            owner_user_id: userId,
            name,
            description,
        })
        .select("id, owner_user_id, name, description, status, created_at")
        .single();

    if (error || !data) {
        return NextResponse.json({ error: "Failed to create agent" }, { status: 500, headers: CORS });
    }

    return NextResponse.json({ agent: serializeAgent(data as AgentRow) }, { status: 201, headers: CORS });
}
