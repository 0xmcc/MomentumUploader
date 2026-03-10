/**
 * Canonical shape for a single timestamped transcript segment.
 * Produced by the Riva ASR pipeline and stored in memo_transcript_segments.
 */
export type TranscriptSegment = {
    /** Segment index as string: "0", "1", … */
    id: string;
    startMs: number;
    endMs: number;
    text: string;
};
