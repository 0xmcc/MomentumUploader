import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { isMissingOpenClawSchemaError } from "@/lib/openclaw-compat";
import { requireOwnedSharedMemo } from "@/lib/share-route";
import { supabaseAdmin } from "@/lib/supabase";

type Params = { params: Promise<{ shareRef: string }> };

const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

function buildInviteText(shareUrl: string, nonce: string | null): string {
    const inviteUrl = nonce ? `${shareUrl}?nonce=${nonce}` : shareUrl;
    return (
        "Please open this link and connect to my memo room:\n" +
        `${inviteUrl}\n\n` +
        "Read the OpenClaw skill instructions you'll discover in the page metadata, then connect using the handoff endpoint."
    );
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

    const shareUrl = new URL(
        `/s/${ownedShare.memo.shareToken}`,
        new URL(req.url).origin
    ).toString();

    const nonce = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
    const { error } = await supabaseAdmin.from("openclaw_invite_nonces").insert({
        share_ref: ownedShare.memo.shareToken,
        owner_user_id: ownedShare.userId,
        nonce,
        status: "active",
        expires_at: expiresAt,
    });

    if (error) {
        if (isMissingOpenClawSchemaError(error)) {
            return Response.json({
                inviteText: buildInviteText(shareUrl, null),
                expiresAt: null,
            });
        }

        return Response.json(
            { error: "Failed to create OpenClaw invite." },
            { status: 500 }
        );
    }

    return Response.json({
        inviteText: buildInviteText(shareUrl, nonce),
        expiresAt,
    });
}
