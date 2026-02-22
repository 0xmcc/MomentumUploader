import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

type Params = { params: Promise<{ id: string }> };
type MemoRow = Record<string, unknown>;

function normalizeTimestamp(raw: unknown): string | null {
    if (raw === null || raw === undefined) {
        return null;
    }

    if (typeof raw === "string") {
        const parsed = Date.parse(raw);
        return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
    }

    if (typeof raw === "number" && Number.isFinite(raw)) {
        const ms = raw > 1_000_000_000_000 ? raw : raw * 1000;
        return new Date(ms).toISOString();
    }

    return null;
}

function isExpired(row: MemoRow): boolean {
    const shareExpiry = normalizeTimestamp(row.share_expires_at);
    const genericExpiry = normalizeTimestamp(row.expires_at);
    const expiresAt = shareExpiry ?? genericExpiry;
    if (!expiresAt) return false;
    return Date.parse(expiresAt) <= Date.now();
}

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
    const { id } = await params;

    const { data: currentMemo, error: currentError } = await supabaseAdmin
        .from("memos")
        .select("*")
        .eq("id", id)
        .maybeSingle();

    if (currentError || !currentMemo) {
        return NextResponse.json({ error: "Memo not found" }, { status: 404, headers: CORS });
    }

    const row = currentMemo as MemoRow;
    const existingToken = readShareToken(row);
    const revokedAt = normalizeTimestamp(row.revoked_at);
    const isShareable = row.is_shareable !== false;

    if (existingToken && !revokedAt && isShareable && !isExpired(row)) {
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
