import { findMemoDiscussion, getOrCreateMemoDiscussion } from "@/lib/memo-discussion";
import { type AgentRow } from "@/lib/agents";
import { supabaseAdmin } from "@/lib/supabase";

type ParticipantLookupRow = {
    id?: string;
    agent_id?: string | null;
    status?: "active" | "removed";
};

const LEGACY_OPENCLAW_DESCRIPTION_PREFIX = "Connected OpenClaw account: ";

export function isMissingOpenClawSchemaError(error: unknown): boolean {
    const maybeError = error as { code?: unknown; message?: unknown } | null;
    return (
        maybeError?.code === "42P01" ||
        maybeError?.code === "42703" ||
        maybeError?.code === "PGRST202"
    );
}

export function buildLegacyOpenClawDescription(
    openclawExternalId: string
): string {
    return `${LEGACY_OPENCLAW_DESCRIPTION_PREFIX}${openclawExternalId}`;
}

function isLegacyOpenClawDescription(
    description: string | null | undefined,
    openclawExternalId?: string
): boolean {
    if (typeof description !== "string") {
        return false;
    }

    if (!description.startsWith(LEGACY_OPENCLAW_DESCRIPTION_PREFIX)) {
        return false;
    }

    if (!openclawExternalId) {
        return true;
    }

    return description === buildLegacyOpenClawDescription(openclawExternalId);
}

async function listOwnerAgents(ownerUserId: string): Promise<AgentRow[] | null> {
    const { data, error } = await supabaseAdmin
        .from("agents")
        .select("id, owner_user_id, name, description, status, created_at")
        .eq("owner_user_id", ownerUserId)
        .order("created_at", { ascending: false });

    if (error || !Array.isArray(data)) {
        return null;
    }

    return data as AgentRow[];
}

async function ensureLegacyOpenClawAgent(
    ownerUserId: string,
    openclawExternalId: string,
    displayName: string | null
): Promise<string | null> {
    const agents = await listOwnerAgents(ownerUserId);
    if (!agents) {
        return null;
    }

    const existingAgent = agents.find((agent) =>
        isLegacyOpenClawDescription(agent.description, openclawExternalId)
    );
    if (existingAgent) {
        if (existingAgent.status !== "active") {
            const { error } = await supabaseAdmin
                .from("agents")
                .update({ status: "active" })
                .eq("id", existingAgent.id);

            if (error) {
                return null;
            }
        }

        return existingAgent.id;
    }

    const { data, error } = await supabaseAdmin
        .from("agents")
        .insert({
            owner_user_id: ownerUserId,
            name: displayName ?? "OpenClaw",
            description: buildLegacyOpenClawDescription(openclawExternalId),
        })
        .select("id, owner_user_id, name, description, status, created_at")
        .single();

    if (error || !data) {
        return null;
    }

    return (data as AgentRow).id;
}

async function ensureAgentParticipant(
    roomId: string,
    agentId: string,
    ownerUserId: string
): Promise<string | null> {
    const { data: existingParticipant } = await supabaseAdmin
        .from("memo_room_participants")
        .select("id, status")
        .eq("memo_room_id", roomId)
        .eq("agent_id", agentId)
        .maybeSingle();

    if (existingParticipant) {
        const participant = existingParticipant as ParticipantLookupRow;
        if (participant.status === "removed") {
            const { data: reactivatedParticipant, error } = await supabaseAdmin
                .from("memo_room_participants")
                .update({
                    status: "active",
                    removed_at: null,
                })
                .eq("memo_room_id", roomId)
                .eq("agent_id", agentId)
                .select("id")
                .single();

            if (error || !reactivatedParticipant) {
                return null;
            }

            return reactivatedParticipant.id as string;
        }

        return participant.id ?? null;
    }

    const { data: participant, error } = await supabaseAdmin
        .from("memo_room_participants")
        .insert({
            memo_room_id: roomId,
            participant_type: "agent",
            user_id: null,
            agent_id: agentId,
            role: "member",
            capability: "comment_only",
            default_visibility: "owner_only",
            status: "active",
            invited_by_user_id: ownerUserId,
        })
        .select("id")
        .single();

    if (error || !participant) {
        return null;
    }

    return participant.id as string;
}

async function ensureAgentRoomState(roomId: string, agentId: string): Promise<boolean> {
    const { error } = await supabaseAdmin.from("agent_room_state").upsert(
        {
            agent_id: agentId,
            memo_room_id: roomId,
            default_visibility: "owner_only",
            updated_at: new Date().toISOString(),
        },
        {
            onConflict: "agent_id,memo_room_id",
        }
    );

    return !error;
}

export async function attachLegacyOpenClawToMemo(params: {
    memoId: string;
    ownerUserId: string;
    title: string;
    openclawExternalId: string;
    displayName: string | null;
}): Promise<{ agentId: string; participantId: string; roomId: string } | null> {
    const discussion = await getOrCreateMemoDiscussion(
        params.memoId,
        params.ownerUserId,
        params.title
    );
    const agentId = await ensureLegacyOpenClawAgent(
        params.ownerUserId,
        params.openclawExternalId,
        params.displayName
    );
    if (!agentId) {
        return null;
    }

    const participantId = await ensureAgentParticipant(
        discussion.roomId,
        agentId,
        params.ownerUserId
    );
    if (!participantId) {
        return null;
    }

    if (!(await ensureAgentRoomState(discussion.roomId, agentId))) {
        return null;
    }

    return {
        agentId,
        participantId,
        roomId: discussion.roomId,
    };
}

export async function findLegacyOpenClawAttachment(
    memoId: string,
    ownerUserId: string
): Promise<{ agentId: string; roomId: string } | null> {
    const discussion = await findMemoDiscussion(memoId, ownerUserId);
    if (!discussion?.roomId) {
        return null;
    }

    const { data: participants, error: participantError } = await supabaseAdmin
        .from("memo_room_participants")
        .select("agent_id, status")
        .eq("memo_room_id", discussion.roomId)
        .eq("participant_type", "agent")
        .eq("status", "active");

    if (participantError || !Array.isArray(participants) || participants.length === 0) {
        return null;
    }

    const activeAgentIds = new Set(
        (participants as ParticipantLookupRow[])
            .map((participant) => participant.agent_id)
            .filter((agentId): agentId is string => typeof agentId === "string")
    );
    if (activeAgentIds.size === 0) {
        return null;
    }

    const ownerAgents = await listOwnerAgents(ownerUserId);
    if (!ownerAgents) {
        return null;
    }

    const legacyAgent = ownerAgents.find(
        (agent) =>
            activeAgentIds.has(agent.id) &&
            agent.status === "active" &&
            isLegacyOpenClawDescription(agent.description)
    );
    if (!legacyAgent) {
        return null;
    }

    return {
        agentId: legacyAgent.id,
        roomId: discussion.roomId,
    };
}
