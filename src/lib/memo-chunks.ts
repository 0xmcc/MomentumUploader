import type { SupabaseClient } from "@supabase/supabase-js";

export const CHUNK_TARGET_TOKENS = 800;
export const CHUNK_MAX_TOKENS = 1200;

type MemoChunkSource = "live" | "final";

type SegmentRow = {
    segment_index: number;
    start_ms: number;
    end_ms: number;
    text: string;
};

type ChunkRow = {
    memo_id: string;
    user_id: string;
    source: MemoChunkSource;
    chunk_index: number;
    segment_start_index: number;
    segment_end_index: number;
    start_ms: number;
    end_ms: number;
    text: string;
    token_estimate: number;
    status: "ready";
    updated_at: string;
};

export function estimateTokenCount(text: string): number {
    return Math.ceil(text.length / 4);
}

function joinChunkText(parts: string[]): string {
    return parts
        .map((part) => part.trim())
        .filter(Boolean)
        .join(" ");
}

function buildChunkRows(
    memoId: string,
    userId: string,
    source: MemoChunkSource,
    segments: SegmentRow[],
): ChunkRow[] {
    const rows: ChunkRow[] = [];
    const now = new Date().toISOString();

    let currentSegments: SegmentRow[] = [];
    let currentParts: string[] = [];
    let currentTokens = 0;

    const flush = () => {
        if (currentSegments.length === 0) return;

        const text = joinChunkText(currentParts);
        rows.push({
            memo_id: memoId,
            user_id: userId,
            source,
            chunk_index: rows.length,
            segment_start_index: currentSegments[0].segment_index,
            segment_end_index: currentSegments[currentSegments.length - 1].segment_index,
            start_ms: currentSegments[0].start_ms,
            end_ms: currentSegments[currentSegments.length - 1].end_ms,
            text,
            token_estimate: estimateTokenCount(text),
            status: "ready",
            updated_at: now,
        });

        currentSegments = [];
        currentParts = [];
        currentTokens = 0;
    };

    for (const segment of segments) {
        const normalizedText = segment.text.trim();
        if (!normalizedText) continue;

        const nextTokens = estimateTokenCount(normalizedText);
        const wouldExceedTarget =
            currentSegments.length > 0 &&
            currentTokens + nextTokens > CHUNK_TARGET_TOKENS;
        const wouldExceedMax =
            currentSegments.length > 0 &&
            currentTokens + nextTokens > CHUNK_MAX_TOKENS;

        if (wouldExceedTarget || wouldExceedMax) {
            flush();
        }

        currentSegments.push(segment);
        currentParts.push(normalizedText);
        currentTokens += nextTokens;
    }

    flush();
    return rows;
}

async function compactChunksForSource(
    memoId: string,
    userId: string,
    source: MemoChunkSource,
    supabase: SupabaseClient,
) {
    const { data, error } = await supabase
        .from("memo_transcript_segments")
        .select("segment_index, start_ms, end_ms, text")
        .eq("memo_id", memoId)
        .eq("source", source)
        .order("segment_index", { ascending: true })
        .order("start_ms", { ascending: true });

    if (error) {
        throw error;
    }

    const segments = (data ?? []) as SegmentRow[];
    const chunkRows = buildChunkRows(memoId, userId, source, segments);
    const now = new Date().toISOString();

    const { error: supersedeError } = await supabase
        .from("memo_transcript_chunks")
        .update({ status: "superseded", updated_at: now })
        .eq("memo_id", memoId)
        .eq("source", source);

    if (supersedeError) {
        throw supersedeError;
    }

    if (chunkRows.length > 0) {
        const { error: upsertError } = await supabase
            .from("memo_transcript_chunks")
            .upsert(chunkRows, {
                onConflict: "memo_id,source,chunk_index",
            });

        if (upsertError) {
            throw upsertError;
        }
    }

    return {
        chunkCount: chunkRows.length,
        latestChunkIndex: chunkRows.length > 0 ? chunkRows[chunkRows.length - 1].chunk_index : -1,
    };
}

export async function compactLiveChunks(
    memoId: string,
    userId: string,
    supabase: SupabaseClient,
) {
    return compactChunksForSource(memoId, userId, "live", supabase);
}

export async function compactFinalChunks(
    memoId: string,
    userId: string,
    supabase: SupabaseClient,
) {
    return compactChunksForSource(memoId, userId, "final", supabase);
}
