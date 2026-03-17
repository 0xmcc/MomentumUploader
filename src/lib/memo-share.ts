import { supabaseAdmin } from "@/lib/supabase";
import { LIVE_MEMO_TITLE } from "@/lib/live-memo";
import type { ResolvedMemoShare } from "@/lib/share-domain";
import { isExpired, isRevoked, normalizeTimestamp, resolveExpiration } from "@/lib/share-access";
import type { TranscriptSegment } from "@/lib/transcript";

type MemoShareState =
    | { status: "ok"; memo: ResolvedMemoShare }
    | { status: "not_found" | "revoked" | "expired" };

type MemoShareRow = Record<string, unknown>;

const MEMO_SHARE_SELECT = "id, title, transcript, transcript_status, audio_url, duration, created_at, share_token, shared_at, share_expires_at, expires_at, revoked_at, is_shareable";

function readString(raw: unknown): string | null {
    return typeof raw === "string" ? raw : null;
}

function isMissingColumnError(error: unknown): boolean {
    const maybeError = error as { code?: unknown; message?: unknown } | null;
    return (
        maybeError?.code === "42703" &&
        typeof maybeError.message === "string"
    );
}

function buildResolvedMemo(
    row: MemoShareRow,
    shareToken: string,
    transcriptSegments: TranscriptSegment[] | null
): ResolvedMemoShare {
    const createdAt = normalizeTimestamp(row.created_at) ?? new Date().toISOString();
    const sharedAt = normalizeTimestamp(row.shared_at);
    const expiresAt = resolveExpiration(row);
    const mediaUrl = readString(row.audio_url);
    const title = readString(row.title) ?? "Shared Voice Memo";
    const isLiveRecording = !mediaUrl && title === LIVE_MEMO_TITLE;

    return {
        memoId: readString(row.id) ?? "",
        shareToken,
        title,
        transcript: readString(row.transcript) ?? "",
        mediaUrl,
        createdAt,
        sharedAt,
        expiresAt,
        isLiveRecording,
        transcriptStatus: readString(row.transcript_status),
        transcriptSegments,
    };
}

export async function resolveMemoShare(shareToken: string): Promise<MemoShareState> {
    let { data, error } = await supabaseAdmin
        .from("memos")
        .select(MEMO_SHARE_SELECT)
        .eq("share_token", shareToken)
        .maybeSingle();

    if (isMissingColumnError(error)) {
        ({ data, error } = await supabaseAdmin
            .from("memos")
            .select("*")
            .eq("share_token", shareToken)
            .maybeSingle());
    }

    if (error) {
        return { status: "not_found" };
    }

    if (!data) {
        return { status: "not_found" };
    }

    const row = data as MemoShareRow;
    if (isRevoked(row)) {
        return { status: "revoked" };
    }

    const expiresAt = resolveExpiration(row);
    if (isExpired(expiresAt)) {
        return { status: "expired" };
    }

    // Fetch timestamped segments separately — never fetched in list/search paths.
    const { data: segRows } = await supabaseAdmin
        .from("memo_transcript_segments")
        .select("segment_index, start_ms, end_ms, text")
        .eq("memo_id", row.id)
        .eq("source", "final")
        .order("segment_index", { ascending: true });

    const transcriptSegments: TranscriptSegment[] | null =
        segRows && segRows.length > 0
            ? segRows.map((r) => ({
                  id: String(r.segment_index),
                  startMs: r.start_ms as number,
                  endMs: r.end_ms as number,
                  text: r.text as string,
              }))
            : null;

    return {
        status: "ok",
        memo: buildResolvedMemo(row, shareToken, transcriptSegments),
    };
}
