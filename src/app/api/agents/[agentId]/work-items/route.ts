import { NextRequest, NextResponse } from "next/server";
import { resolveOptionalAgentContext } from "@/lib/agents";
import { supabaseAdmin } from "@/lib/supabase";

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers":
        "Content-Type, Authorization, x-openclaw-api-key, x-openclaw-internal-key, x-memo-agent-id",
};

type Params = { params: Promise<{ agentId: string }> };

type WorkItem = {
    type: "invocation" | "new_messages" | "new_transcript" | "idle";
    priority: 1 | 2 | 3 | 4;
    roomId: string;
    memoId: string | null;
    invocationId?: string;
};

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest, { params }: Params) {
    const { agentId } = await params;
    const actorContext = await resolveOptionalAgentContext(req, agentId);

    if (!actorContext.ok) {
        return NextResponse.json({ error: actorContext.error }, { status: actorContext.status, headers: CORS });
    }

    const { data: pendingInvocations, error: invocationError } = await supabaseAdmin
        .from("agent_invocations")
        .select("id, agent_id, memo_room_id, memo_id, request_message_id, status, created_at")
        .eq("agent_id", agentId)
        .in("status", ["pending", "processing"])
        .order("created_at", { ascending: true });

    if (invocationError) {
        return NextResponse.json({ error: "Failed to load agent work" }, { status: 500, headers: CORS });
    }

    const { data: participants, error: participantError } = await supabaseAdmin
        .from("memo_room_participants")
        .select("memo_room_id, agent_id, status")
        .eq("agent_id", agentId)
        .eq("status", "active");

    if (participantError) {
        return NextResponse.json({ error: "Failed to load agent work" }, { status: 500, headers: CORS });
    }

    const roomIds = [...new Set((participants ?? []).map((entry) => entry.memo_room_id as string))];
    const { data: states } = roomIds.length
        ? await supabaseAdmin
            .from("agent_room_state")
            .select("agent_id, memo_room_id, last_seen_message_id, last_seen_transcript_segment_id")
            .eq("agent_id", agentId)
            .in("memo_room_id", roomIds)
        : { data: [] };
    const stateByRoom = new Map((states ?? []).map((state) => [state.memo_room_id as string, state]));

    const { data: latestMessages } = roomIds.length
        ? await supabaseAdmin
            .from("memo_messages")
            .select("id, memo_room_id, memo_id, created_at")
            .in("memo_room_id", roomIds)
            .order("created_at", { ascending: false })
        : { data: [] };

    const latestMessageByRoom = new Map<string, { id: string; memo_id: string }>();
    for (const row of latestMessages ?? []) {
        const roomId = row.memo_room_id as string;
        if (!latestMessageByRoom.has(roomId)) {
            latestMessageByRoom.set(roomId, {
                id: row.id as string,
                memo_id: row.memo_id as string,
            });
        }
    }

    const { data: roomMemos } = roomIds.length
        ? await supabaseAdmin
            .from("memo_room_memos")
            .select("memo_room_id, memo_id")
            .in("memo_room_id", roomIds)
        : { data: [] };

    const memoByRoom = new Map<string, string>();
    for (const row of roomMemos ?? []) {
        const roomId = row.memo_room_id as string;
        if (!memoByRoom.has(roomId)) {
            memoByRoom.set(roomId, row.memo_id as string);
        }
    }

    const memoIds = [...new Set((roomMemos ?? []).map((entry) => entry.memo_id as string))];
    const { data: latestSegments } = memoIds.length
        ? await supabaseAdmin
            .from("memo_transcript_segments")
            .select("id, memo_id")
            .in("memo_id", memoIds)
            .order("id", { ascending: false })
        : { data: [] };

    const latestSegmentByMemo = new Map<string, number>();
    for (const row of latestSegments ?? []) {
        const memoId = row.memo_id as string;
        if (!latestSegmentByMemo.has(memoId)) {
            latestSegmentByMemo.set(memoId, row.id as number);
        }
    }

    const workItems: WorkItem[] = [];

    for (const invocation of pendingInvocations ?? []) {
        workItems.push({
            type: "invocation",
            priority: 1,
            roomId: invocation.memo_room_id as string,
            memoId: invocation.memo_id as string,
            invocationId: invocation.id as string,
        });
    }

    for (const roomId of roomIds) {
        const state = stateByRoom.get(roomId);
        const latestMessage = latestMessageByRoom.get(roomId);
        const memoId = memoByRoom.get(roomId) ?? latestMessage?.memo_id ?? null;
        const latestSegmentId = memoId ? latestSegmentByMemo.get(memoId) ?? null : null;

        if (latestMessage && latestMessage.id !== state?.last_seen_message_id) {
            workItems.push({
                type: "new_messages",
                priority: 2,
                roomId,
                memoId,
            });
            continue;
        }

        if (
            latestSegmentId !== null &&
            latestSegmentId !== (state?.last_seen_transcript_segment_id as number | undefined)
        ) {
            workItems.push({
                type: "new_transcript",
                priority: 3,
                roomId,
                memoId,
            });
            continue;
        }

        workItems.push({
            type: "idle",
            priority: 4,
            roomId,
            memoId,
        });
    }

    workItems.sort((left, right) => left.priority - right.priority);

    return NextResponse.json({ workItems }, { headers: CORS });
}
