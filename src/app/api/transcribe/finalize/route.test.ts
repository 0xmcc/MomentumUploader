import { NextRequest } from "next/server";
import { POST } from "./route";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { supabaseAdmin, uploadAudio } from "@/lib/supabase";
import { enqueueTranscriptionJob } from "@/lib/transcription-queue";
import {
    persistMemoProvisional,
    promoteLiveSegmentsToFinal,
    transcribeUploadedAudio,
    updateMemoFailed,
    updateMemoFinal,
} from "../workflow";

function makeResponse(body: unknown, init?: { status?: number }) {
    return {
        status: init?.status ?? 200,
        headers: {
            set: jest.fn(),
        },
        json: async () => body,
    };
}

jest.mock("next/server", () => ({
    NextRequest: jest.fn(),
    NextResponse: Object.assign(
        jest.fn().mockImplementation((_body, init) => makeResponse(null, init)),
        {
            json: jest.fn((body, init) => makeResponse(body, init)),
        }
    ),
}));

jest.mock("@/lib/memo-api-auth", () => ({
    resolveMemoUserId: jest.fn(),
}));

jest.mock("@/lib/supabase", () => ({
    uploadAudio: jest.fn(),
    supabase: {
        storage: {
            from: jest.fn(() => ({
                getPublicUrl: jest.fn(() => ({
                    data: { publicUrl: "https://example.com/audio/finalized.webm" },
                })),
            })),
        },
    },
    supabaseAdmin: {
        storage: {
            from: jest.fn(),
        },
    },
}));

jest.mock("@/lib/transcription-queue", () => {
    const actual = jest.requireActual("@/lib/transcription-queue");
    return {
        ...actual,
        enqueueTranscriptionJob: jest.fn(),
    };
});

jest.mock("../workflow", () => ({
    ERR: jest.fn(),
    LOG: jest.fn(),
    persistMemoProvisional: jest.fn(),
    promoteLiveSegmentsToFinal: jest.fn(),
    transcribeUploadedAudio: jest.fn(),
    updateMemoFailed: jest.fn(),
    updateMemoFinal: jest.fn(),
}));

describe("POST /api/transcribe/finalize", () => {
    const list = jest.fn();
    const download = jest.fn();
    const remove = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        (resolveMemoUserId as jest.Mock).mockResolvedValue("user-1");
        (supabaseAdmin.storage.from as jest.Mock).mockReturnValue({
            list,
            download,
            remove,
        });
        list.mockResolvedValue({
            data: [
                { name: "0000000-0000015.webm", metadata: { size: 400_000 } },
                { name: "0000015-0000030.webm", metadata: { size: 400_000 } },
            ],
            error: null,
        });
        (enqueueTranscriptionJob as jest.Mock).mockResolvedValue(undefined);
        download
            .mockResolvedValueOnce({
                data: {
                    arrayBuffer: async () =>
                        Uint8Array.from(Buffer.from("header-and-chunks-0-14")).buffer,
                },
                error: null,
            })
            .mockResolvedValueOnce({
                data: {
                    arrayBuffer: async () =>
                        Uint8Array.from(Buffer.from("chunks-15-29")).buffer,
                },
                error: null,
            });
        remove.mockResolvedValue({ error: null });
        (uploadAudio as jest.Mock).mockResolvedValue({ path: "audio/finalized.webm" });
        (persistMemoProvisional as jest.Mock).mockResolvedValue({
            ok: true,
            data: { memoId: "memo-1" },
        });
        (promoteLiveSegmentsToFinal as jest.Mock).mockResolvedValue(undefined);
        (transcribeUploadedAudio as jest.Mock).mockResolvedValue({
            ok: true,
            data: { transcript: "transcribed text", segments: [] },
        });
        (updateMemoFailed as jest.Mock).mockResolvedValue(makeResponse({
            success: true,
            transcriptStatus: "failed",
        }));
        (updateMemoFinal as jest.Mock).mockResolvedValue(makeResponse({
            success: true,
            id: "memo-1",
            text: "final text",
            url: "https://example.com/audio/finalized.webm",
            transcriptStatus: "complete",
        }));
    });

    it("finalizes from the provisional transcript without rebuilding canonical audio", async () => {
        (updateMemoFinal as jest.Mock).mockResolvedValueOnce(makeResponse({
            success: true,
            id: "memo-1",
            text: "final text",
            transcriptStatus: "complete",
        }));
        const req = {
            json: async () => ({
                memoId: "memo-1",
                totalChunks: 30,
                provisionalTranscript: "live transcript",
            }),
        } as unknown as NextRequest;

        const res = await POST(req);
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json).toEqual({
            success: true,
            id: "memo-1",
            text: "final text",
            transcriptStatus: "complete",
        });
        expect(list).not.toHaveBeenCalled();
        expect(download).not.toHaveBeenCalled();
        expect(persistMemoProvisional).not.toHaveBeenCalled();
        expect(promoteLiveSegmentsToFinal).toHaveBeenCalledWith("memo-1", "user-1");
        expect(updateMemoFinal).toHaveBeenCalledWith(
            "memo-1",
            "live transcript",
            [],
            null,
            "user-1",
            expect.any(Number)
        );
        expect(transcribeUploadedAudio).not.toHaveBeenCalled();
        expect(remove).not.toHaveBeenCalled();
    });

    it("returns 409 when the uploaded chunk ranges contain a gap", async () => {
        list.mockResolvedValue({
            data: [
                { name: "0000000-0000015.webm", metadata: { size: 400_000 } },
                { name: "0000020-0000030.webm", metadata: { size: 400_000 } },
            ],
            error: null,
        });

        const req = {
            json: async () => ({
                memoId: "memo-1",
                totalChunks: 30,
            }),
        } as unknown as NextRequest;

        const res = await POST(req);
        const json = await res.json();

        expect(res.status).toBe(409);
        expect(json).toEqual({
            error: "Chunk upload has a gap between 15 and 20.",
        });
        expect(updateMemoFinal).not.toHaveBeenCalled();
    });

    it("transcribes the uploaded audio when no provisional transcript is provided", async () => {
        const originalApiKey = process.env.NVIDIA_API_KEY;
        process.env.NVIDIA_API_KEY = "nvidia-test-key";

        try {
            const req = {
                json: async () => ({
                    memoId: "memo-1",
                    totalChunks: 30,
                }),
            } as unknown as NextRequest;

            const res = await POST(req);
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json).toEqual({
                success: true,
                id: "memo-1",
                text: "final text",
                url: "https://example.com/audio/finalized.webm",
                transcriptStatus: "complete",
            });
            expect(transcribeUploadedAudio).toHaveBeenCalledWith(
                expect.objectContaining({
                    memoId: "memo-1",
                    provisionalTranscript: null,
                    fileName: expect.stringContaining("memo-1.webm"),
                    audioBuffer: Buffer.from("header-and-chunks-0-14chunks-15-29"),
                    uploadContentType: "audio/webm",
                    fileUrl: "https://example.com/audio/finalized.webm",
                }),
                "nvidia-test-key"
            );
            expect(updateMemoFinal).toHaveBeenCalledWith(
                "memo-1",
                "transcribed text",
                [],
                "https://example.com/audio/finalized.webm",
                "user-1",
                expect.any(Number)
            );
            expect(promoteLiveSegmentsToFinal).not.toHaveBeenCalled();
        } finally {
            process.env.NVIDIA_API_KEY = originalApiKey;
        }
    });

    it("returns 409 when uploaded chunks end at a different total than the finalize request", async () => {
        const req = {
            json: async () => ({
                memoId: "memo-1",
                totalChunks: 25,
            }),
        } as unknown as NextRequest;

        const res = await POST(req);
        const json = await res.json();

        expect(res.status).toBe(409);
        expect(json).toEqual({
            error: "Chunk upload ended at 30, expected 25.",
        });
        expect(transcribeUploadedAudio).not.toHaveBeenCalled();
        expect(updateMemoFinal).not.toHaveBeenCalled();
    });

    it("preserves the uploaded audio content type and extension for single-file manual uploads", async () => {
        const originalApiKey = process.env.NVIDIA_API_KEY;
        process.env.NVIDIA_API_KEY = "nvidia-test-key";

        try {
            download.mockReset();
            remove.mockReset();
            list.mockResolvedValue({
                data: [{ name: "0000000-0000001.webm", metadata: { size: 100_000 } }],
                error: null,
            });
            download.mockResolvedValueOnce({
                data: {
                    arrayBuffer: async () =>
                        Uint8Array.from(Buffer.from("manual-mp3-audio")).buffer,
                },
                error: null,
            });
            remove.mockResolvedValue({ error: null });

            const req = {
                json: async () => ({
                    memoId: "memo-1",
                    totalChunks: 1,
                    uploadContentType: "audio/mpeg",
                    uploadFileExtension: "mp3",
                }),
            } as unknown as NextRequest;

            const res = await POST(req);

            expect(res.status).toBe(200);
            expect(uploadAudio).toHaveBeenCalledWith(
                Buffer.from("manual-mp3-audio"),
                expect.stringMatching(/memo-1\.mp3$/),
                "audio/mpeg"
            );
            expect(transcribeUploadedAudio).toHaveBeenCalledWith(
                expect.objectContaining({
                    fileName: expect.stringMatching(/memo-1\.mp3$/),
                    uploadContentType: "audio/mpeg",
                    file: expect.objectContaining({
                        type: "audio/mpeg",
                    }),
                }),
                "nvidia-test-key"
            );
        } finally {
            process.env.NVIDIA_API_KEY = originalApiKey;
        }
    });

    describe("a recording too long to transcribe inside the request", () => {
        function longChunkListing() {
            list.mockResolvedValue({
                data: [
                    { name: "0000000-0000015.webm", metadata: { size: 40 * 1024 * 1024 } },
                    { name: "0000015-0000030.webm", metadata: { size: 40 * 1024 * 1024 } },
                ],
                error: null,
            });
        }

        it("queues it for the worker instead of transcribing it here", async () => {
            // The 1h42m failure: this request used to hold the whole
            // transcription and could never finish.
            longChunkListing();

            const req = {
                json: async () => ({
                    memoId: "memo-1",
                    totalChunks: 30,
                    durationSeconds: 6117,
                }),
            } as unknown as NextRequest;

            const res = await POST(req);
            const json = await res.json();

            expect(transcribeUploadedAudio).not.toHaveBeenCalled();
            expect(download).not.toHaveBeenCalled();
            expect(uploadAudio).not.toHaveBeenCalled();

            expect(enqueueTranscriptionJob).toHaveBeenCalledWith(
                "memo-1",
                "user-1",
                expect.anything(),
                expect.objectContaining({
                    chunk_paths: [
                        "audio/chunks/memo-1/0000000-0000015.webm",
                        "audio/chunks/memo-1/0000015-0000030.webm",
                    ],
                    upload_content_type: "audio/webm",
                    upload_file_extension: "webm",
                    duration_seconds: 6117,
                })
            );

            // The client has to be able to tell "queued" from "done".
            expect(json).toMatchObject({
                success: true,
                id: "memo-1",
                queued: true,
                transcriptStatus: "processing",
            });
            expect(res.status).toBe(202);
        });

        it("leaves the chunks in place — the worker still needs the audio", async () => {
            longChunkListing();

            await POST({
                json: async () => ({ memoId: "memo-1", totalChunks: 30, durationSeconds: 6117 }),
            } as unknown as NextRequest);

            expect(remove).not.toHaveBeenCalled();
        });

        it("queues an upload whose duration nobody knows, rather than gambling", async () => {
            longChunkListing();

            await POST({
                json: async () => ({ memoId: "memo-1", totalChunks: 30 }),
            } as unknown as NextRequest);

            expect(enqueueTranscriptionJob).toHaveBeenCalled();
            expect(transcribeUploadedAudio).not.toHaveBeenCalled();
        });

        it("treats an already-queued memo as queued, not as an error", async () => {
            longChunkListing();
            (enqueueTranscriptionJob as jest.Mock).mockRejectedValueOnce(
                Object.assign(new Error("duplicate key value violates unique constraint"), {
                    code: "23505",
                })
            );

            const res = await POST({
                json: async () => ({ memoId: "memo-1", totalChunks: 30, durationSeconds: 6117 }),
            } as unknown as NextRequest);
            const json = await res.json();

            expect(json).toMatchObject({ success: true, queued: true });
        });

        it("does not claim it was queued when queueing failed", async () => {
            longChunkListing();
            (enqueueTranscriptionJob as jest.Mock).mockRejectedValueOnce(
                new Error("job_runs is on fire")
            );

            const res = await POST({
                json: async () => ({ memoId: "memo-1", totalChunks: 30, durationSeconds: 6117 }),
            } as unknown as NextRequest);
            const json = await res.json();

            expect(res.status).toBe(500);
            expect(json.error).toMatch(/queue/i);
        });

        it("still finalizes instantly from a live transcript, queue or no queue", async () => {
            longChunkListing();
            (updateMemoFinal as jest.Mock).mockResolvedValueOnce(makeResponse({
                success: true,
                id: "memo-1",
                text: "live transcript",
                transcriptStatus: "complete",
            }));

            await POST({
                json: async () => ({
                    memoId: "memo-1",
                    totalChunks: 30,
                    durationSeconds: 6117,
                    provisionalTranscript: "live transcript",
                }),
            } as unknown as NextRequest);

            expect(enqueueTranscriptionJob).not.toHaveBeenCalled();
            expect(updateMemoFinal).toHaveBeenCalled();
        });
    });
});
