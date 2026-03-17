import { supabaseAdmin } from "@/lib/supabase";

export type TranscriptSource = "final" | "live";

type MemoTranscriptSegmentRow = {
    id: number;
    segment_index: number;
    start_ms: number;
    end_ms: number;
    text: string;
};

export type MemoTranscriptSegment = {
    segmentId: number;
    segmentIndex: number;
    startMs: number;
    endMs: number;
    text: string;
};

export type TranscriptBounds = {
    startMs?: number | null;
    endMs?: number | null;
    startSegmentIndex?: number | null;
    endSegmentIndex?: number | null;
};

export type TranscriptWindowBounds = TranscriptBounds & {
    contextBeforeMs?: number;
    contextAfterMs?: number;
};

export type TranscriptWindowResult = {
    windowStartMs: number | null;
    windowEndMs: number | null;
    hasMoreBefore: boolean;
    hasMoreAfter: boolean;
    segments: MemoTranscriptSegment[];
};

export type TranscriptSearchHit = {
    snippet: string;
    startMs: number;
    endMs: number;
    segmentIds: number[];
    score: number;
};

function mapSegment(row: MemoTranscriptSegmentRow): MemoTranscriptSegment {
    return {
        segmentId: row.id,
        segmentIndex: row.segment_index,
        startMs: row.start_ms,
        endMs: row.end_ms,
        text: row.text,
    };
}

async function loadTranscriptSegmentsBySource(
    memoId: string,
    source: TranscriptSource
): Promise<MemoTranscriptSegment[]> {
    const { data, error } = await supabaseAdmin
        .from("memo_transcript_segments")
        .select("id, segment_index, start_ms, end_ms, text")
        .eq("memo_id", memoId)
        .eq("source", source)
        .order("segment_index", { ascending: true });

    if (error || !data) {
        return [];
    }

    return (data as MemoTranscriptSegmentRow[]).map(mapSegment);
}

export async function getOwnedMemoDurationMs(
    memoId: string,
    userId: string
): Promise<number | null | undefined> {
    const { data, error } = await supabaseAdmin
        .from("memos")
        .select("id, duration")
        .eq("id", memoId)
        .eq("user_id", userId)
        .single();

    if (error || !data) {
        return undefined;
    }

    return typeof data.duration === "number" ? data.duration * 1000 : null;
}

export async function loadPreferredTranscriptSegments(
    memoId: string
): Promise<{ source: TranscriptSource | null; segments: MemoTranscriptSegment[] }> {
    const finalSegments = await loadTranscriptSegmentsBySource(memoId, "final");
    if (finalSegments.length > 0) {
        return { source: "final", segments: finalSegments };
    }

    const liveSegments = await loadTranscriptSegmentsBySource(memoId, "live");
    if (liveSegments.length > 0) {
        return { source: "live", segments: liveSegments };
    }

    return { source: null, segments: [] };
}

function resolveBaseWindow(
    segments: MemoTranscriptSegment[],
    bounds: TranscriptBounds
): { startMs: number | null; endMs: number | null } {
    const hasTimeBounds = bounds.startMs !== null && bounds.startMs !== undefined;
    const hasSegmentBounds =
        bounds.startSegmentIndex !== null && bounds.startSegmentIndex !== undefined;

    if (hasTimeBounds && bounds.endMs !== null && bounds.endMs !== undefined) {
        return {
            startMs: bounds.startMs ?? null,
            endMs: bounds.endMs ?? null,
        };
    }

    if (
        hasSegmentBounds &&
        bounds.endSegmentIndex !== null &&
        bounds.endSegmentIndex !== undefined
    ) {
        const matchingSegments = segments.filter(
            (segment) =>
                segment.segmentIndex >= (bounds.startSegmentIndex as number) &&
                segment.segmentIndex <= (bounds.endSegmentIndex as number)
        );

        if (matchingSegments.length === 0) {
            return { startMs: null, endMs: null };
        }

        return {
            startMs: matchingSegments[0].startMs,
            endMs: matchingSegments[matchingSegments.length - 1].endMs,
        };
    }

    if (segments.length === 0) {
        return { startMs: null, endMs: null };
    }

    return {
        startMs: segments[0].startMs,
        endMs: segments[segments.length - 1].endMs,
    };
}

export function buildTranscriptWindow(
    segments: MemoTranscriptSegment[],
    bounds: TranscriptWindowBounds
): TranscriptWindowResult {
    const baseWindow = resolveBaseWindow(segments, bounds);
    if (baseWindow.startMs === null || baseWindow.endMs === null) {
        return {
            windowStartMs: null,
            windowEndMs: null,
            hasMoreBefore: false,
            hasMoreAfter: false,
            segments: [],
        };
    }

    const windowStartMs = Math.max(0, baseWindow.startMs - (bounds.contextBeforeMs ?? 0));
    const windowEndMs = baseWindow.endMs + (bounds.contextAfterMs ?? 0);
    const windowSegments = segments.filter(
        (segment) => segment.endMs > windowStartMs && segment.startMs < windowEndMs
    );

    return {
        windowStartMs,
        windowEndMs,
        hasMoreBefore: segments.some((segment) => segment.endMs <= windowStartMs),
        hasMoreAfter: segments.some((segment) => segment.startMs >= windowEndMs),
        segments: windowSegments,
    };
}

function segmentMatchesQuery(segment: MemoTranscriptSegment, terms: string[]): number {
    const normalizedText = segment.text.toLowerCase();

    return terms.reduce((score, term) => {
        return normalizedText.includes(term) ? score + 1 : score;
    }, 0);
}

export function searchTranscriptSegments(
    segments: MemoTranscriptSegment[],
    query: string,
    bounds: TranscriptBounds,
    limit: number
): TranscriptSearchHit[] {
    const window = buildTranscriptWindow(segments, {
        ...bounds,
        contextBeforeMs: 0,
        contextAfterMs: 0,
    });
    const normalizedTerms = [...new Set(query.toLowerCase().trim().split(/\s+/).filter(Boolean))];

    if (normalizedTerms.length === 0) {
        return [];
    }

    return window.segments
        .map((segment) => ({
            segment,
            score: segmentMatchesQuery(segment, normalizedTerms),
        }))
        .filter((entry) => entry.score > 0)
        .sort((left, right) => {
            if (right.score !== left.score) {
                return right.score - left.score;
            }

            return left.segment.startMs - right.segment.startMs;
        })
        .slice(0, limit)
        .map(({ segment, score }) => ({
            snippet: segment.text,
            startMs: segment.startMs,
            endMs: segment.endMs,
            segmentIds: [segment.segmentId],
            score,
        }));
}
