/** @jest-environment node */

import {
    persistMemoProvisional,
    promoteLiveSegmentsToFinal,
    updateMemoFailed,
    updateMemoFinal,
} from "./workflow";
import { supabaseAdmin } from "@/lib/supabase";
import {
    compactFinalChunks,
} from "@/lib/memo-chunks";
import {
    generateFinalArtifacts,
    supersedeMemoArtifacts,
} from "@/lib/memo-artifacts";
import { runPendingMemoJobs } from "@/lib/memo-jobs";

jest.mock("@/lib/supabase", () => ({
    supabaseAdmin: {
        from: jest.fn(),
    },
    supabase: {
        storage: {
            from: jest.fn(() => ({
                getPublicUrl: jest.fn(() => ({ data: { publicUrl: "https://example.com/audio.webm" } })),
            })),
        },
    },
    uploadAudio: jest.fn(),
}));

jest.mock("@/lib/memo-chunks", () => ({
    compactFinalChunks: jest.fn(),
}));

jest.mock("@/lib/memo-artifacts", () => ({
    generateFinalArtifacts: jest.fn(),
    supersedeMemoArtifacts: jest.fn(),
}));

jest.mock("@/lib/memo-jobs", () => ({
    runPendingMemoJobs: jest.fn(),
}));

function makeLegacyUpdateChain(resolvedValue: unknown) {
    const selectResult = {
        maybeSingle: jest.fn().mockResolvedValue(resolvedValue),
        single: jest.fn().mockResolvedValue(resolvedValue),
    };
    const eqFn = jest.fn();
    const selectFn = jest.fn().mockReturnValue(selectResult);
    const thenFn = (onfulfilled: (value: unknown) => unknown) =>
        Promise.resolve(resolvedValue).then(onfulfilled);

    const chain: Record<string, unknown> = {
        eq: eqFn,
        select: selectFn,
        then: thenFn,
    };
    eqFn.mockReturnValue(chain);
    return chain;
}

describe("transcribe workflow legacy transcript_status fallback", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (runPendingMemoJobs as jest.Mock).mockResolvedValue(undefined);
    });

    it("retries provisional live-memo update without transcript_status instead of inserting a duplicate memo", async () => {
        const missingStatusUpdate = jest.fn(() =>
            makeLegacyUpdateChain({
                data: null,
                error: {
                    code: "42703",
                    message: "column memos.transcript_status does not exist",
                },
            })
        );
        const legacyUpdate = jest.fn(() =>
            makeLegacyUpdateChain({
                data: { id: "memo-live-1" },
                error: null,
            })
        );
        const insert = jest.fn();

        let fromCallCount = 0;
        (supabaseAdmin.from as jest.Mock).mockImplementation(() => {
            fromCallCount += 1;
            return fromCallCount === 1
                ? { update: missingStatusUpdate, insert }
                : { update: legacyUpdate, insert };
        });

        const result = await persistMemoProvisional(
            "memo-live-1",
            "https://example.com/audio.webm",
            "user-1"
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.memoId).toBe("memo-live-1");
        }
        expect(supabaseAdmin.from).toHaveBeenCalledTimes(2);
        expect(missingStatusUpdate).toHaveBeenCalledWith({
            audio_url: "https://example.com/audio.webm",
            transcript_status: "processing",
        });
        expect(legacyUpdate).toHaveBeenCalledWith({
            audio_url: "https://example.com/audio.webm",
        });
        expect(insert).not.toHaveBeenCalled();
    });

    it("retries provisional insert without transcript_status on a legacy schema", async () => {
        const missingStatusInsert = jest.fn(() => ({
            select: jest.fn(() => ({
                single: jest.fn().mockResolvedValue({
                    data: null,
                    error: {
                        code: "PGRST204",
                        message:
                            "Could not find the 'transcript_status' column of 'memos' in the schema cache",
                    },
                }),
            })),
        }));
        const legacyInsert = jest.fn(() => ({
            select: jest.fn(() => ({
                single: jest.fn().mockResolvedValue({
                    data: { id: "memo-legacy-1" },
                    error: null,
                }),
            })),
        }));

        let fromCallCount = 0;
        (supabaseAdmin.from as jest.Mock).mockImplementation(() => {
            fromCallCount += 1;
            return fromCallCount === 1
                ? { insert: missingStatusInsert }
                : { insert: legacyInsert };
        });

        const result = await persistMemoProvisional(
            null,
            "https://example.com/audio.webm",
            "user-1"
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.memoId).toBe("memo-legacy-1");
        }
        expect(missingStatusInsert).toHaveBeenCalledWith(
            expect.objectContaining({
                title: "Voice Memo",
                transcript_status: "processing",
            })
        );
        expect(legacyInsert).toHaveBeenCalledWith({
            title: "Voice Memo",
            transcript: "",
            audio_url: "https://example.com/audio.webm",
            user_id: "user-1",
        });
    });

    it("retries final transcript update without transcript_status on a legacy schema", async () => {
        const missingStatusUpdate = jest.fn(() =>
            makeLegacyUpdateChain({
                data: null,
                error: {
                    code: "42703",
                    message: "column memos.transcript_status does not exist",
                },
            })
        );
        const legacyUpdate = jest.fn(() =>
            makeLegacyUpdateChain({
                data: null,
                error: null,
            })
        );

        let fromCallCount = 0;
        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "memo_transcript_segments") {
                return {
                    delete: jest.fn(() => ({
                        eq: jest.fn(() => ({ eq: jest.fn().mockResolvedValue({ data: null, error: null }) })),
                    })),
                    insert: jest.fn().mockResolvedValue({ data: null, error: null }),
                };
            }

            fromCallCount += 1;
            return fromCallCount === 1
                ? { update: missingStatusUpdate }
                : { update: legacyUpdate };
        });

        const response = await updateMemoFinal(
            "memo-1",
            "final transcript",
            [],
            "https://example.com/audio.webm",
            "user-1",
            Date.now()
        );
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(missingStatusUpdate).toHaveBeenCalledWith({
            transcript: "final transcript",
            transcript_status: "complete",
        });
        expect(legacyUpdate).toHaveBeenCalledWith({
            transcript: "final transcript",
        });
    });

    it("retries failed-transcript update without transcript_status on a legacy schema", async () => {
        const missingStatusUpdate = jest.fn(() =>
            makeLegacyUpdateChain({
                data: null,
                error: {
                    code: "42703",
                    message: "column memos.transcript_status does not exist",
                },
            })
        );
        const legacyUpdate = jest.fn(() =>
            makeLegacyUpdateChain({
                data: null,
                error: null,
            })
        );

        let fromCallCount = 0;
        (supabaseAdmin.from as jest.Mock).mockImplementation(() => {
            fromCallCount += 1;
            return fromCallCount === 1
                ? { update: missingStatusUpdate }
                : { update: legacyUpdate };
        });

        const response = await updateMemoFailed(
            "memo-1",
            "https://example.com/audio.webm",
            "user-1",
            Date.now()
        );
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(missingStatusUpdate).toHaveBeenCalledWith({
            transcript: "[Transcription failed]",
            transcript_status: "failed",
        });
        expect(legacyUpdate).toHaveBeenCalledWith({
            transcript: "[Transcription failed]",
        });
    });

    it("keeps the upload successful when transcript segment persistence throws after final memo update", async () => {
        const finalizeMemoUpdate = jest.fn(() =>
            makeLegacyUpdateChain({
                data: null,
                error: null,
            })
        );
        const deleteSegments = jest.fn(() => ({
            eq: jest.fn(() => ({
                eq: jest.fn().mockRejectedValue(
                    Object.assign(new Error('relation "memo_transcript_segments" does not exist'), {
                        code: "42P01",
                    })
                ),
            })),
        }));

        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "memo_transcript_segments") {
                return {
                    delete: deleteSegments,
                    insert: jest.fn(),
                };
            }

            return {
                update: finalizeMemoUpdate,
            };
        });

        const response = await updateMemoFinal(
            "memo-1",
            "final transcript",
            [
                {
                    id: "0",
                    startMs: 0,
                    endMs: 1000,
                    text: "final transcript",
                },
            ],
            "https://example.com/audio.webm",
            "user-1",
            Date.now()
        );
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(finalizeMemoUpdate).toHaveBeenCalledWith({
            transcript: "final transcript",
            transcript_status: "complete",
        });
        expect(deleteSegments).toHaveBeenCalled();
    });

    it("runs final chunk compaction, final artifact generation, and supersedes live artifacts after final segments are written", async () => {
        (compactFinalChunks as jest.Mock).mockResolvedValue({
            chunkCount: 1,
            latestChunkIndex: 0,
        });
        (generateFinalArtifacts as jest.Mock).mockResolvedValue(undefined);
        (supersedeMemoArtifacts as jest.Mock).mockResolvedValue(undefined);

        const finalizeMemoUpdate = jest.fn(() =>
            makeLegacyUpdateChain({
                data: null,
                error: null,
            })
        );
        const deleteSegments = jest.fn(() => ({
            eq: jest.fn(() => ({
                eq: jest.fn().mockResolvedValue({ data: null, error: null }),
            })),
        }));
        const insertSegments = jest.fn().mockResolvedValue({ data: null, error: null });

        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "memo_transcript_segments") {
                return {
                    delete: deleteSegments,
                    insert: insertSegments,
                };
            }

            return {
                update: finalizeMemoUpdate,
            };
        });

        const response = await updateMemoFinal(
            "memo-1",
            "final transcript",
            [
                {
                    id: "0",
                    startMs: 0,
                    endMs: 1000,
                    text: "final transcript",
                },
            ],
            "https://example.com/audio.webm",
            "user-1",
            Date.now()
        );

        expect(response.status).toBe(200);
        expect(compactFinalChunks).toHaveBeenCalledWith("memo-1", "user-1", supabaseAdmin);
        expect(generateFinalArtifacts).toHaveBeenCalledWith("memo-1", "user-1", supabaseAdmin);
        expect(supersedeMemoArtifacts).toHaveBeenCalledWith(
            "memo-1",
            "live",
            undefined,
            supabaseAdmin
        );
    });

    it("promotes persisted live segments to final segments before final compaction", async () => {
        const liveRows = [
            {
                memo_id: "memo-1",
                user_id: "user-1",
                segment_index: 0,
                start_ms: 0,
                end_ms: 1000,
                text: "hello",
                source: "live",
            },
        ];

        const selectOrderStart = jest.fn().mockResolvedValue({
            data: liveRows,
            error: null,
        });
        const selectOrderSegment = jest.fn(() => ({ order: selectOrderStart }));
        const selectEqSource = jest.fn(() => ({ order: selectOrderSegment }));
        const selectEqMemo = jest.fn(() => ({ eq: selectEqSource }));
        const deleteEqSource = jest.fn().mockResolvedValue({ data: null, error: null });
        const deleteEqMemo = jest.fn(() => ({ eq: deleteEqSource }));
        const deleteRows = jest.fn(() => ({ eq: deleteEqMemo }));
        const insertRows = jest.fn().mockResolvedValue({ data: null, error: null });

        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table !== "memo_transcript_segments") {
                throw new Error(`Unexpected table ${table}`);
            }

            return {
                select: jest.fn(() => ({ eq: selectEqMemo })),
                delete: deleteRows,
                insert: insertRows,
            };
        });

        await promoteLiveSegmentsToFinal("memo-1", "user-1");

        expect(deleteRows).toHaveBeenCalled();
        expect(insertRows).toHaveBeenCalledWith([
            {
                memo_id: "memo-1",
                user_id: "user-1",
                segment_index: 0,
                start_ms: 0,
                end_ms: 1000,
                text: "hello",
                source: "final",
            },
        ]);
    });
});
