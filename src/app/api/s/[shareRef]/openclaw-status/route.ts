import { NextRequest } from "next/server";
import { validateOpenClawGateway } from "@/lib/agents";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { findLegacyOpenClawAttachment } from "@/lib/openclaw-compat";
import { getOrCreateMemoDiscussion } from "@/lib/memo-discussion";
import { getCurrentOpenClawClaimState } from "@/lib/openclaw-claims";
import { resolveSharedMemoForRoute } from "@/lib/share-route";
import type { ResolvedMemoShare } from "@/lib/share-domain";

type Params = { params: Promise<{ shareRef: string }> };

type OpenClawStatusAccess =
    | {
          ok: true;
          memo: ResolvedMemoShare;
          ownerUserId: string;
          openclawExternalId: string | null;
      }
    | {
          ok: false;
          response: Response;
      };

async function resolveOpenClawStatusAccess(
    req: NextRequest,
    shareRef: string
): Promise<OpenClawStatusAccess> {
    const shared = await resolveSharedMemoForRoute(shareRef);
    if (!shared.ok) {
        return shared;
    }

    if (!shared.memo.ownerUserId) {
        return {
            ok: false,
            response: Response.json(
                { error: "Share ownership is not available." },
                { status: 500 }
            ),
        };
    }

    const userId = await resolveMemoUserId(req);
    if (userId === shared.memo.ownerUserId) {
        return {
            ok: true,
            memo: shared.memo,
            ownerUserId: shared.memo.ownerUserId,
            openclawExternalId: null,
        };
    }

    const gateway = await validateOpenClawGateway(req);
    if (!gateway.ok) {
        if (userId) {
            return {
                ok: false,
                response: Response.json(
                    { error: "Only the memo owner can access this route." },
                    { status: 403 }
                ),
            };
        }

        return {
            ok: false,
            response: Response.json(
                { error: "Authentication required." },
                { status: 401 }
            ),
        };
    }

    return {
        ok: true,
        memo: shared.memo,
        ownerUserId: shared.memo.ownerUserId,
        openclawExternalId: gateway.openclawExternalId,
    };
}

export async function GET(
    req: NextRequest,
    { params }: Params
): Promise<Response> {
    const { shareRef } = await params;
    const access = await resolveOpenClawStatusAccess(req, shareRef);
    if (!access.ok) {
        return access.response;
    }

    const currentClaimState = await getCurrentOpenClawClaimState(access.memo.shareToken);
    if (currentClaimState.missingSchema) {
        if (access.openclawExternalId) {
            return Response.json(
                { error: "OpenClaw status is unavailable for this share." },
                { status: 404 }
            );
        }

        const attachment = await findLegacyOpenClawAttachment(
            access.memo.memoId,
            access.ownerUserId
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

    if (
        access.openclawExternalId &&
        currentClaim.openclaw_external_id !== access.openclawExternalId
    ) {
        return Response.json(
            { error: "This share is already linked to a different OpenClaw." },
            { status: 409 }
        );
    }

    if (currentClaim.status === "pending") {
        return Response.json({
            state: "pending_claim",
            agentId: null,
            roomId: null,
        });
    }

    if (!currentClaim.agent_id) {
        return Response.json(
            { error: "Failed to resolve OpenClaw discussion." },
            { status: 500 }
        );
    }

    const discussion = await getOrCreateMemoDiscussion(
        access.memo.memoId,
        access.ownerUserId,
        access.memo.title
    );

    return Response.json({
        state: "claimed",
        agentId: currentClaim.agent_id,
        roomId: discussion.roomId,
    });
}
