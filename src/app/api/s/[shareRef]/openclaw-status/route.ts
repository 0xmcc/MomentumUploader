import { NextRequest } from "next/server";
import { findLegacyOpenClawAttachment } from "@/lib/openclaw-compat";
import { findMemoDiscussion } from "@/lib/memo-discussion";
import { getCurrentOpenClawClaimState } from "@/lib/openclaw-claims";
import { requireOwnedSharedMemo } from "@/lib/share-route";

type Params = { params: Promise<{ shareRef: string }> };

export async function GET(
    req: NextRequest,
    { params }: Params
): Promise<Response> {
    const { shareRef } = await params;
    const ownedShare = await requireOwnedSharedMemo(req, shareRef);
    if (!ownedShare.ok) {
        return ownedShare.response;
    }

    const currentClaimState = await getCurrentOpenClawClaimState(
        ownedShare.memo.shareToken
    );
    if (currentClaimState.missingSchema) {
        const attachment = await findLegacyOpenClawAttachment(
            ownedShare.memo.memoId,
            ownedShare.userId
        );
        if (!attachment) {
            return Response.json({
                state: "none",
                agentId: null,
                roomId: null,
            });
        }

        return Response.json({
            state: "claimed",
            agentId: attachment.agentId,
            roomId: attachment.roomId,
        });
    }

    const currentClaim = currentClaimState.claim;
    if (!currentClaim) {
        return Response.json({
            state: "none",
            agentId: null,
            roomId: null,
        });
    }

    if (currentClaim.status === "pending") {
        return Response.json({
            state: "pending_claim",
            agentId: null,
            roomId: null,
        });
    }

    const discussion = await findMemoDiscussion(
        ownedShare.memo.memoId,
        ownedShare.userId
    );
    if (!discussion?.roomId || !currentClaim.agent_id) {
        return Response.json(
            { error: "Failed to resolve OpenClaw discussion." },
            { status: 500 }
        );
    }

    return Response.json({
        state: "claimed",
        agentId: currentClaim.agent_id,
        roomId: discussion.roomId,
    });
}
