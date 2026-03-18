import { NextRequest } from "next/server";
import { findMemoDiscussion, getOrCreateMemoDiscussion } from "@/lib/memo-discussion";
import { getCurrentOpenClawClaim, getPendingOpenClawClaim } from "@/lib/openclaw-claims";
import { requireOwnedSharedMemo } from "@/lib/share-route";
import { supabaseAdmin } from "@/lib/supabase";

type Params = { params: Promise<{ shareRef: string }> };

type AgentLookupRow = {
    id: string;
    owner_user_id: string;
    name: string;
    description: string | null;
    status: "active" | "disabled";
    created_at: string;
    openclaw_display_name?: string | null;
    openclaw_context?: string | null;
};

type ParticipantLookupRow = {
    id: string;
    status: "active" | "removed";
};

async function resolveAgentForClaim(
    ownerUserId: string,
    claim: NonNullable<Awaited<ReturnType<typeof getPendingOpenClawClaim>>>
): Promise<string | null> {
    const { data: existingAgent } = await supabaseAdmin
        .from("agents")
        .select(
            "id, owner_user_id, name, description, status, created_at, openclaw_display_name, openclaw_context"
        )
        .eq("owner_user_id", ownerUserId)
        .eq("openclaw_external_id", claim.openclaw_external_id)
        .maybeSingle();

    if (existingAgent) {
        const updates: Record<string, unknown> = {};
        if (existingAgent.status !== "active") {
            updates.status = "active";
        }
        if (!existingAgent.openclaw_display_name && claim.openclaw_display_name) {
            updates.openclaw_display_name = claim.openclaw_display_name;
        }
        if (!existingAgent.openclaw_context && claim.openclaw_context) {
            updates.openclaw_context = claim.openclaw_context;
        }

        if (Object.keys(updates).length > 0) {
            const { error } = await supabaseAdmin
                .from("agents")
                .update(updates)
                .eq("id", existingAgent.id);

            if (error) {
                return null;
            }
        }

        return (existingAgent as AgentLookupRow).id;
    }

    const { data: newAgent, error } = await supabaseAdmin
        .from("agents")
        .insert({
            owner_user_id: ownerUserId,
            name: claim.openclaw_display_name ?? "OpenClaw",
            description: null,
            openclaw_external_id: claim.openclaw_external_id,
            openclaw_display_name: claim.openclaw_display_name,
            openclaw_context: claim.openclaw_context,
        })
        .select(
            "id, owner_user_id, name, description, status, created_at, openclaw_display_name, openclaw_context"
        )
        .single();

    if (error || !newAgent) {
        return null;
    }

    return (newAgent as AgentLookupRow).id;
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

        return participant.id;
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

export async function POST(
    req: NextRequest,
    { params }: Params
): Promise<Response> {
    const { shareRef } = await params;
    const ownedShare = await requireOwnedSharedMemo(req, shareRef);
    if (!ownedShare.ok) {
        return ownedShare.response;
    }

    const pendingClaim = await getPendingOpenClawClaim(ownedShare.memo.shareToken);
    if (!pendingClaim) {
        return Response.json(
            { error: "No pending OpenClaw claim exists." },
            { status: 404 }
        );
    }

    const agentId = await resolveAgentForClaim(ownedShare.userId, pendingClaim);
    if (!agentId) {
        return Response.json(
            { error: "Failed to resolve OpenClaw agent." },
            { status: 500 }
        );
    }

    const discussion = await getOrCreateMemoDiscussion(
        ownedShare.memo.memoId,
        ownedShare.userId,
        ownedShare.memo.title
    );
    const participantId = await ensureAgentParticipant(
        discussion.roomId,
        agentId,
        ownedShare.userId
    );
    if (!participantId) {
        return Response.json(
            { error: "Failed to attach OpenClaw to the memo discussion." },
            { status: 500 }
        );
    }

    if (!(await ensureAgentRoomState(discussion.roomId, agentId))) {
        return Response.json(
            { error: "Failed to prepare OpenClaw room state." },
            { status: 500 }
        );
    }

    const { error: claimError } = await supabaseAdmin
        .from("openclaw_claim_requests")
        .update({
            status: "claimed",
            agent_id: agentId,
            claimed_at: new Date().toISOString(),
        })
        .eq("id", pendingClaim.id);

    if (claimError) {
        return Response.json(
            { error: "Failed to finalize the OpenClaw claim." },
            { status: 500 }
        );
    }

    return Response.json({
        agentId,
        participantId,
    });
}

export async function DELETE(
    req: NextRequest,
    { params }: Params
): Promise<Response> {
    const { shareRef } = await params;
    const ownedShare = await requireOwnedSharedMemo(req, shareRef);
    if (!ownedShare.ok) {
        return ownedShare.response;
    }

    const currentClaim = await getCurrentOpenClawClaim(ownedShare.memo.shareToken);
    if (!currentClaim) {
        return Response.json(
            { error: "No OpenClaw claim exists for this share." },
            { status: 404 }
        );
    }

    if (currentClaim.agent_id) {
        const discussion = await findMemoDiscussion(
            ownedShare.memo.memoId,
            ownedShare.userId
        );

        if (discussion?.roomId) {
            const { data: participant } = await supabaseAdmin
                .from("memo_room_participants")
                .select("id")
                .eq("memo_room_id", discussion.roomId)
                .eq("agent_id", currentClaim.agent_id)
                .maybeSingle();

            if (participant?.id) {
                await supabaseAdmin
                    .from("memo_room_participants")
                    .update({
                        status: "removed",
                        removed_at: new Date().toISOString(),
                    })
                    .eq("memo_room_id", discussion.roomId)
                    .eq("agent_id", currentClaim.agent_id);
            }
        }
    }

    const { error } = await supabaseAdmin
        .from("openclaw_claim_requests")
        .update({
            status: "rejected",
        })
        .eq("id", currentClaim.id);

    if (error) {
        return Response.json(
            { error: "Failed to disconnect OpenClaw." },
            { status: 500 }
        );
    }

    return new Response(null, { status: 204 });
}
