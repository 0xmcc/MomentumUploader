import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";

export const MEMO_ROOM_CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export type ParticipantType = "human" | "agent" | "system";
export type ParticipantCapability = "read_only" | "comment_only" | "full_participation";
export type MessageVisibility = "public" | "owner_only" | "restricted";

export type MemoRoomParticipantRow = {
    id: string;
    memo_room_id: string;
    participant_type: ParticipantType;
    user_id: string | null;
    agent_id?: string | null;
    role: string;
    capability: ParticipantCapability;
    default_visibility?: MessageVisibility | null;
    status: "active" | "removed";
};

type AuthorParticipantRow = {
    id: string;
    participant_type: ParticipantType;
    user_id: string | null;
    agent_id?: string | null;
} | null;

export type MemoMessageRow = {
    id: string;
    memo_room_id: string;
    memo_id: string;
    author_participant_id: string;
    content: string;
    visibility: MessageVisibility;
    restricted_participant_ids: string[] | null;
    reply_to_message_id: string | null;
    root_message_id: string;
    anchor_start_ms: number | null;
    anchor_end_ms: number | null;
    anchor_segment_ids: number[] | null;
    created_at: string;
    author_participant?: AuthorParticipantRow | AuthorParticipantRow[] | null;
};

type TranscriptAnchorInput = {
    memoId: string;
    anchorStartMs?: number | null;
    anchorEndMs?: number | null;
    anchorSegmentIds?: number[] | null;
};

type TranscriptAnchor = {
    anchor_start_ms: number | null;
    anchor_end_ms: number | null;
    anchor_segment_ids: number[] | null;
};

type AttachedMemoResolution =
    | {
          ok: true;
          memoId: string;
      }
    | {
          ok: false;
          reason: "room_not_found" | "memo_id_required";
      };

export function createMessageId(): string {
    return randomUUID();
}

export function isMessageVisibility(value: unknown): value is MessageVisibility {
    return value === "public" || value === "owner_only" || value === "restricted";
}

export function canParticipantPost(participant: MemoRoomParticipantRow): boolean {
    return participant.status === "active" && participant.capability !== "read_only";
}

export async function getActiveHumanParticipant(
    roomId: string,
    userId: string
): Promise<MemoRoomParticipantRow | null> {
    const { data, error } = await supabaseAdmin
        .from("memo_room_participants")
        .select("id, memo_room_id, participant_type, user_id, role, capability, default_visibility, status")
        .eq("memo_room_id", roomId)
        .eq("user_id", userId)
        .eq("status", "active")
        .single();

    if (error || !data) {
        return null;
    }

    return data as MemoRoomParticipantRow;
}

export async function getActiveAgentParticipant(
    roomId: string,
    agentId: string
): Promise<MemoRoomParticipantRow | null> {
    const { data, error } = await supabaseAdmin
        .from("memo_room_participants")
        .select("id, memo_room_id, participant_type, user_id, agent_id, role, capability, default_visibility, status")
        .eq("memo_room_id", roomId)
        .eq("agent_id", agentId)
        .eq("status", "active")
        .single();

    if (error || !data) {
        return null;
    }

    return data as MemoRoomParticipantRow;
}

export async function resolveAttachedMemoId(
    roomId: string,
    requestedMemoId?: string | null
): Promise<AttachedMemoResolution> {
    if (requestedMemoId) {
        const { data, error } = await supabaseAdmin
            .from("memo_room_memos")
            .select("memo_id")
            .eq("memo_room_id", roomId)
            .eq("memo_id", requestedMemoId)
            .single();

        if (error || !data) {
            return { ok: false, reason: "room_not_found" };
        }

        return { ok: true, memoId: data.memo_id as string };
    }

    const { data, error } = await supabaseAdmin
        .from("memo_room_memos")
        .select("memo_id")
        .eq("memo_room_id", roomId);

    if (error || !data || data.length === 0) {
        return { ok: false, reason: "room_not_found" };
    }

    if (data.length > 1) {
        return { ok: false, reason: "memo_id_required" };
    }

    return { ok: true, memoId: data[0].memo_id as string };
}

export async function validateRestrictedParticipantIds(
    roomId: string,
    restrictedParticipantIds: string[] | null
): Promise<boolean> {
    if (!restrictedParticipantIds || restrictedParticipantIds.length === 0) {
        return false;
    }

    const uniqueIds = [...new Set(restrictedParticipantIds)];
    const { data, error } = await supabaseAdmin
        .from("memo_room_participants")
        .select("id")
        .eq("memo_room_id", roomId)
        .eq("status", "active")
        .in("id", uniqueIds);

    if (error) {
        return false;
    }

    return (data ?? []).length === uniqueIds.length;
}

export async function validateTranscriptAnchor({
    memoId,
    anchorStartMs,
    anchorEndMs,
    anchorSegmentIds,
}: TranscriptAnchorInput): Promise<TranscriptAnchor | null> {
    const normalizedStart = anchorStartMs ?? null;
    const normalizedEnd = anchorEndMs ?? null;
    const normalizedSegmentIds = anchorSegmentIds?.length ? anchorSegmentIds : null;

    if (normalizedStart === null && normalizedEnd === null && normalizedSegmentIds === null) {
        return {
            anchor_start_ms: null,
            anchor_end_ms: null,
            anchor_segment_ids: null,
        };
    }

    if (normalizedStart === null || normalizedEnd === null) {
        return null;
    }

    if (normalizedStart < 0 || normalizedEnd <= normalizedStart) {
        return null;
    }

    const { data: memo, error: memoError } = await supabaseAdmin
        .from("memos")
        .select("id, duration")
        .eq("id", memoId)
        .single();

    if (memoError || !memo) {
        return null;
    }

    if (typeof memo.duration === "number" && normalizedEnd > memo.duration * 1000) {
        return null;
    }

    if (normalizedSegmentIds) {
        const { data: segments, error: segmentError } = await supabaseAdmin
            .from("memo_transcript_segments")
            .select("id, start_ms, end_ms")
            .eq("memo_id", memoId)
            .in("id", normalizedSegmentIds);

        if (segmentError || !segments || segments.length !== normalizedSegmentIds.length) {
            return null;
        }
    }

    return {
        anchor_start_ms: normalizedStart,
        anchor_end_ms: normalizedEnd,
        anchor_segment_ids: normalizedSegmentIds,
    };
}

export function isMessageVisibleToParticipant(
    message: MemoMessageRow,
    viewer: MemoRoomParticipantRow
): boolean {
    if (viewer.id === message.author_participant_id) {
        return true;
    }

    if (message.visibility === "public") {
        return true;
    }

    const author = Array.isArray(message.author_participant)
        ? message.author_participant[0] ?? null
        : message.author_participant ?? null;

    if (message.visibility === "owner_only") {
        if (!author) {
            return false;
        }

        if (author.participant_type === "human") {
            return author.user_id === viewer.user_id;
        }

        return viewer.participant_type === "human" && viewer.role === "owner";
    }

    return (message.restricted_participant_ids ?? []).includes(viewer.id);
}

export function serializeParticipant(participant: MemoRoomParticipantRow) {
    return {
        id: participant.id,
        participantType: participant.participant_type,
        userId: participant.user_id,
        agentId: participant.agent_id ?? null,
        role: participant.role,
        capability: participant.capability,
        defaultVisibility: participant.default_visibility ?? null,
        status: participant.status,
    };
}

export function serializeMessage(message: MemoMessageRow) {
    return {
        id: message.id,
        memoId: message.memo_id,
        authorParticipantId: message.author_participant_id,
        content: message.content,
        visibility: message.visibility,
        restrictedParticipantIds: message.restricted_participant_ids ?? [],
        replyToMessageId: message.reply_to_message_id,
        rootMessageId: message.root_message_id,
        anchorStartMs: message.anchor_start_ms,
        anchorEndMs: message.anchor_end_ms,
        anchorSegmentIds: message.anchor_segment_ids ?? [],
        createdAt: message.created_at,
    };
}
