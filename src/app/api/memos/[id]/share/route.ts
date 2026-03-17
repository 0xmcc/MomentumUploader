import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isExpired, isRevoked, resolveExpiration } from "@/lib/share-access";
import { supabaseAdmin } from "@/lib/supabase";

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

type Params = { params: Promise<{ id: string }> };
type MemoRow = Record<string, unknown>;

function readShareToken(row: MemoRow): string | null {
    const token = row.share_token;
    return typeof token === "string" && token.length > 0 ? token : null;
}

function buildShareUrl(origin: string, token: string): string {
    return `${origin}/s/${token}`;
}

function makeToken(): string {
    return randomBytes(16).toString("hex");
}

function hasColumn(row: MemoRow, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(row, key);
}

function buildResharedUpdates(row: MemoRow): Record<string, unknown> {
    const updates: Record<string, unknown> = {
        share_token: makeToken(),
    };

    if (hasColumn(row, "shared_at")) {
        updates.shared_at = new Date().toISOString();
    }
    if (hasColumn(row, "revoked_at")) {
        updates.revoked_at = null;
    }
    if (hasColumn(row, "is_shareable")) {
        updates.is_shareable = true;
    }

    return updates;
}

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: CORS });
}

/** POST /api/memos/:id/share
 * Returns a canonical share URL for this memo.
 */
export async function POST(req: NextRequest, { params }: Params) {
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ error: "Memo not found" }, { status: 404, headers: CORS });
    }

    const { id } = await params;

    const { data: currentMemo, error: currentError } = await supabaseAdmin
        .from("memos")
        .select("*")
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle();

    if (currentError || !currentMemo) {
        return NextResponse.json({ error: "Memo not found" }, { status: 404, headers: CORS });
    }

    const row = currentMemo as MemoRow;
    const existingToken = readShareToken(row);
    const expiresAt = resolveExpiration(row);

    if (existingToken && !isRevoked(row) && !isExpired(expiresAt)) {
        return NextResponse.json(
            {
                memoId: id,
                shareToken: existingToken,
                shareUrl: buildShareUrl(req.nextUrl.origin, existingToken),
            },
            { headers: CORS }
        );
    }

    const updates = buildResharedUpdates(row);
    if (hasColumn(row, "share_expires_at")) {
        updates.share_expires_at = null;
    }
    if (hasColumn(row, "expires_at")) {
        updates.expires_at = null;
    }

    const { data: updatedMemo, error: updateError } = await supabaseAdmin
        .from("memos")
        .update(updates)
        .eq("id", id)
        .eq("user_id", userId)
        .select("id, share_token")
        .single();

    const shareToken = typeof updatedMemo?.share_token === "string" ? updatedMemo.share_token : null;
    if (updateError || !updatedMemo || !shareToken) {
        return NextResponse.json(
            { error: updateError?.message || "Unable to create share link" },
            { status: 500, headers: CORS }
        );
    }

    return NextResponse.json(
        {
            memoId: updatedMemo.id,
            shareToken,
            shareUrl: buildShareUrl(req.nextUrl.origin, shareToken),
        },
        { headers: CORS }
    );
}
