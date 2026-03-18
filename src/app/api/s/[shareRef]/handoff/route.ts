import { NextRequest } from "next/server";
import { validateOpenClawGateway } from "@/lib/agents";
import { attachLegacyOpenClawToMemo } from "@/lib/openclaw-compat";
import { getCurrentOpenClawClaimState } from "@/lib/openclaw-claims";
import { resolveSharedMemoForRoute } from "@/lib/share-route";
import { supabaseAdmin } from "@/lib/supabase";

type Params = { params: Promise<{ shareRef: string }> };

type HandoffBody = {
    nonce?: string;
    display_name?: string;
    context?: string;
};

export async function POST(
    req: NextRequest,
    { params }: Params
): Promise<Response> {
    const { shareRef } = await params;
    const shared = await resolveSharedMemoForRoute(shareRef);
    if (!shared.ok) {
        return shared.response;
    }

    if (!shared.memo.ownerUserId) {
        return Response.json(
            { error: "Share ownership is not available." },
            { status: 500 }
        );
    }

    const gateway = await validateOpenClawGateway(req);
    if (!gateway.ok) {
        return Response.json(
            { error: gateway.error },
            { status: gateway.status }
        );
    }

    let body: HandoffBody;
    try {
        body = (await req.json()) as HandoffBody;
    } catch {
        return Response.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const currentClaimState = await getCurrentOpenClawClaimState(
        shared.memo.shareToken
    );
    const currentClaim = currentClaimState.claim;
    if (currentClaim) {
        if (currentClaim.openclaw_external_id !== gateway.openclawExternalId) {
            return Response.json(
                { error: "This share is already linked to a different OpenClaw." },
                { status: 409 }
            );
        }

        if (currentClaim.status === "claimed") {
            return Response.json({
                status: "already_claimed",
                shareRef: shared.memo.shareToken,
            });
        }

        return Response.json(
            {
                status: "pending_claim",
                shareRef: shared.memo.shareToken,
            },
            { status: 202 }
        );
    }

    const nonce = body.nonce?.trim();
    if (!nonce && !currentClaimState.missingSchema) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const displayName = body.display_name?.trim() || null;
    const context = body.context?.trim() || null;
    if (currentClaimState.missingSchema) {
        const attachment = await attachLegacyOpenClawToMemo({
            memoId: shared.memo.memoId,
            ownerUserId: shared.memo.ownerUserId,
            title: shared.memo.title,
            openclawExternalId: gateway.openclawExternalId,
            displayName,
        });
        if (!attachment) {
            return Response.json(
                { error: "Failed to create OpenClaw claim." },
                { status: 500 }
            );
        }

        return Response.json(
            {
                status: "pending_claim",
                shareRef: shared.memo.shareToken,
            },
            { status: 202 }
        );
    }

    const { data, error } = await supabaseAdmin.rpc(
        "claim_openclaw_invite_nonce",
        {
            p_share_ref: shared.memo.shareToken,
            p_memo_id: shared.memo.memoId,
            p_owner_user_id: shared.memo.ownerUserId,
            p_openclaw_external_id: gateway.openclawExternalId,
            p_openclaw_display_name: displayName,
            p_openclaw_context: context,
            p_nonce: nonce,
        }
    );

    if (error) {
        return Response.json(
            { error: "Failed to create OpenClaw claim." },
            { status: 500 }
        );
    }

    if (!Array.isArray(data) || data.length === 0) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    return Response.json(
        {
            status: "pending_claim",
            shareRef: shared.memo.shareToken,
        },
        { status: 202 }
    );
}
