/** @jest-environment node */

import {
    parseUploadRequest,
    persistMemoProvisional,
    promoteLiveSegmentsToFinal,
    transcribeUploadedAudio,
    updateMemoFailed,
    updateMemoFinal,
    uploadAudioToStorage,
} from "./workflow";
import { supabase, supabaseAdmin, uploadAudio } from "@/lib/supabase";
import {
    compactFinalChunks,
} from "@/lib/memo-chunks";
import {
    enqueueFinalArtifactsJob,
} from "@/lib/memo-artifacts";
import { runPendingMemoJobs } from "@/lib/memo-jobs";

jest.mock("@/lib/supabase", () => ({
    uploadAudio: jest.fn(),
    supabase: {
        storage: {
            from: jest.fn(() => ({
                getPublicUrl: jest.fn(() => ({
                    data: { publicUrl: "https://example.com/audio.webm" },
                })),
            })),
        },
    },
    supabaseAdmin: {
        from: jest.fn(),
    },
}));

jest.mock("@/lib/memo-chunks", () => ({
    compactFinalChunks: jest.fn(),
}));

jest.mock("@/lib/memo-artifacts", () => ({
    enqueueFinalArtifactsJob: jest.fn(),
}));

jest.mock("@/lib/memo-jobs", () => ({
    runPendingMemoJobs: jest.fn(),
}));

jest.mock("@/lib/riva", () => ({
    transcribeAudio: jest.fn(),
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
        (uploadAudio as jest.Mock).mockReset();
        (supabase.storage.from as jest.Mock).mockReset();
        (supabase.storage.from as jest.Mock).mockReturnValue({
            getPublicUrl: jest.fn(() => ({
                data: { publicUrl: "https://example.com/audio.webm" },
            })),
        });
    });

    it("parses upload form data, trims memo metadata, and normalizes storage content type", async () => {
        const req = {
            formData: async () => {
                const formData = new FormData();
                formData.set("memoId", " memo-live-1 ");
                formData.set("provisionalTranscript", " provisional text ");
                formData.set(
                    "file",
                    new File([Buffer.from("audio-data")], "iphone-note.m4a", {
                        type: "audio/x-m4a",
                    })
                );
                return formData;
            },
        };

        const result = await parseUploadRequest(req as never, Date.now());

        expect(result.ok).toBe(true);
        if (!result.ok) {
            throw new Error("Expected parsed upload to succeed");
        }

        expect(result.data.memoId).toBe("memo-live-1");
        expect(result.data.provisionalTranscript).toBe("provisional text");
        expect(result.data.fileName).toEqual(expect.stringContaining("iphone-note.m4a"));
        expect(result.data.uploadContentType).toBe("audio/mp4");
        expect(Buffer.isBuffer(result.data.audioBuffer)).toBe(true);
    });

    it("returns a 413 response when storage rejects the upload as too large", async () => {
        (uploadAudio as jest.Mock).mockRejectedValue({
            namespace: "storage",
            status: 413,
            message: "maximum allowed size exceeded",
        });

        const result = await uploadAudioToStorage(
            {
                memoId: null,
                provisionalTranscript: null,
                file: new File([Buffer.from("audio-data")], "large.webm", {
                    type: "audio/webm",
                }),
                fileName: "large.webm",
                audioBuffer: Buffer.from("audio-data"),
                uploadContentType: "audio/webm",
            },
            Date.now()
        );

        expect(result.ok).toBe(false);
        if (result.ok) {
            throw new Error("Expected upload to fail");
        }

        expect(result.response.status).toBe(413);
        await expect(result.response.json()).resolves.toMatchObject({
            error: "Audio file too large for storage",
        });
    });

    it("returns a 502 response when the transcription provider throws", async () => {
        const upstreamError = new Error("provider unavailable");
        (uploadAudio as jest.Mock).mockResolvedValue({ path: "audio/test.webm" });
        const { transcribeAudio } = jest.requireMock("@/lib/riva") as {
            transcribeAudio: jest.Mock;
        };
        transcribeAudio.mockRejectedValue(upstreamError);

        const result = await transcribeUploadedAudio(
            {
                memoId: null,
                provisionalTranscript: null,
                file: new File([Buffer.from("audio-data")], "memo.webm", {
                    type: "audio/webm",
                }),
                fileName: "memo.webm",
                audioBuffer: Buffer.from("audio-data"),
                uploadContentType: "audio/webm",
                fileUrl: "https://example.com/audio.webm",
            },
            "nvidia-key"
        );

        expect(result.ok).toBe(false);
        if (result.ok) {
            throw new Error("Expected transcription to fail");
        }

        expect(result.response.status).toBe(502);
        await expect(result.response.json()).resolves.toMatchObject({
            error: "Failed to transcribe audio with NVIDIA",
            detail: "provider unavailable",
        });
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
        (enqueueFinalArtifactsJob as jest.Mock).mockResolvedValue(undefined);

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
        expect(enqueueFinalArtifactsJob).toHaveBeenCalledWith("memo-1", "user-1", supabaseAdmin);
        expect(runPendingMemoJobs).toHaveBeenCalledTimes(2);
    });

    it("continues final compaction and artifact generation when claim_pending_memo_job is missing from schema cache", async () => {
        const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => { });
        const missingFunctionError = Object.assign(
            new Error("Could not find the function public.claim_pending_memo_job(p_memo_id) in the schema cache"),
            {
                code: "PGRST202",
                details:
                    "Searched for the function public.claim_pending_memo_job with parameter p_memo_id or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.",
            }
        );
        (runPendingMemoJobs as jest.Mock).mockRejectedValue(missingFunctionError);
        (compactFinalChunks as jest.Mock).mockResolvedValue({
            chunkCount: 1,
            latestChunkIndex: 0,
        });
        (enqueueFinalArtifactsJob as jest.Mock).mockResolvedValue(undefined);

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
        expect(enqueueFinalArtifactsJob).toHaveBeenCalledWith("memo-1", "user-1", supabaseAdmin);
        expect(runPendingMemoJobs).toHaveBeenCalledTimes(2);
        expect(consoleWarnSpy).toHaveBeenCalledWith(
            "[transcribe/db] runPendingMemoJobs skipped: claim_pending_memo_job not in schema.",
            { memoId: "memo-1" }
        );

        consoleWarnSpy.mockRestore();
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
