export const RECORDER_TIMESLICE_MS = 1000;
export const LIVE_LOCKED_SEGMENT_CHUNK_COUNT = 15;

export type LiveLockedSegment = {
    startIndex: number;
    endIndex: number;
    text: string;
};

type LockedSegmentRowArgs = {
    memoId: string;
    userId: string;
    segment: LiveLockedSegment;
};

export function lockedSegmentToDbRow({
    memoId,
    userId,
    segment,
}: LockedSegmentRowArgs) {
    return {
        memo_id: memoId,
        user_id: userId,
        segment_index: Math.floor(segment.startIndex / LIVE_LOCKED_SEGMENT_CHUNK_COUNT),
        start_ms: segment.startIndex * RECORDER_TIMESLICE_MS,
        end_ms: segment.endIndex * RECORDER_TIMESLICE_MS,
        text: segment.text.trim(),
        source: "live" as const,
    };
}
