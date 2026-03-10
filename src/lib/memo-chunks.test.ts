/** @jest-environment node */

import { compactLiveChunks } from "./memo-chunks";

type SegmentRow = {
    memo_id: string;
    user_id: string;
    source: "live" | "final";
    segment_index: number;
    start_ms: number;
    end_ms: number;
    text: string;
};

function createSegmentSelect(rows: SegmentRow[]) {
    const orderStart = jest.fn().mockResolvedValue({
        data: rows,
        error: null,
    });
    const orderSegment = jest.fn(() => ({ order: orderStart }));
    const eqSource = jest.fn(() => ({ order: orderSegment }));
    const eqMemo = jest.fn(() => ({ eq: eqSource }));
    return jest.fn(() => ({ eq: eqMemo }));
}

describe("compactLiveChunks", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("compacts adjacent live segments into a single ready chunk", async () => {
        const segmentRows: SegmentRow[] = [
            {
                memo_id: "memo-1",
                user_id: "user-1",
                source: "live",
                segment_index: 0,
                start_ms: 0,
                end_ms: 15000,
                text: "first locked segment",
            },
            {
                memo_id: "memo-1",
                user_id: "user-1",
                source: "live",
                segment_index: 1,
                start_ms: 15000,
                end_ms: 30000,
                text: "second locked segment",
            },
        ];

        const upsert = jest.fn().mockResolvedValue({ data: null, error: null });
        const updateEqSource = jest.fn().mockResolvedValue({ data: null, error: null });
        const updateEqMemo = jest.fn(() => ({ eq: updateEqSource }));
        const update = jest.fn(() => ({ eq: updateEqMemo }));

        const supabase = {
            from: jest.fn((table: string) => {
                if (table === "memo_transcript_segments") {
                    return { select: createSegmentSelect(segmentRows) };
                }
                if (table === "memo_transcript_chunks") {
                    return { upsert, update };
                }
                throw new Error(`Unexpected table: ${table}`);
            }),
        };

        const result = await compactLiveChunks("memo-1", "user-1", supabase as never);

        expect(result).toEqual({ chunkCount: 1, latestChunkIndex: 0 });
        expect(upsert).toHaveBeenCalledWith(
            [
                expect.objectContaining({
                    memo_id: "memo-1",
                    user_id: "user-1",
                    source: "live",
                    chunk_index: 0,
                    segment_start_index: 0,
                    segment_end_index: 1,
                    start_ms: 0,
                    end_ms: 30000,
                    text: "first locked segment second locked segment",
                    status: "ready",
                }),
            ],
            {
                onConflict: "memo_id,source,chunk_index",
            }
        );
        expect(update).toHaveBeenCalledWith(
            expect.objectContaining({
                status: "superseded",
            })
        );
    });

    it("updates an existing chunk in place when the compacted text changes", async () => {
        const segmentRows: SegmentRow[] = [
            {
                memo_id: "memo-1",
                user_id: "user-1",
                source: "live",
                segment_index: 0,
                start_ms: 0,
                end_ms: 15000,
                text: "first locked segment revised",
            },
            {
                memo_id: "memo-1",
                user_id: "user-1",
                source: "live",
                segment_index: 1,
                start_ms: 15000,
                end_ms: 32000,
                text: "second locked segment revised",
            },
        ];

        const upsert = jest.fn().mockResolvedValue({ data: null, error: null });
        const updateEqSource = jest.fn().mockResolvedValue({ data: null, error: null });
        const updateEqMemo = jest.fn(() => ({ eq: updateEqSource }));
        const update = jest.fn(() => ({ eq: updateEqMemo }));

        const supabase = {
            from: jest.fn((table: string) => {
                if (table === "memo_transcript_segments") {
                    return { select: createSegmentSelect(segmentRows) };
                }
                if (table === "memo_transcript_chunks") {
                    return { upsert, update };
                }
                throw new Error(`Unexpected table: ${table}`);
            }),
        };

        await compactLiveChunks("memo-1", "user-1", supabase as never);

        expect(upsert).toHaveBeenCalledWith(
            [
                expect.objectContaining({
                    chunk_index: 0,
                    segment_start_index: 0,
                    segment_end_index: 1,
                    end_ms: 32000,
                    text: "first locked segment revised second locked segment revised",
                    status: "ready",
                }),
            ],
            {
                onConflict: "memo_id,source,chunk_index",
            }
        );
        expect(upsert).toHaveBeenCalledTimes(1);
    });
});
