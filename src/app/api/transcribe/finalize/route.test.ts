import { NextRequest } from "next/server";
import { POST } from "./route";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { supabaseAdmin, uploadAudio } from "@/lib/supabase";
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
                { name: "0000000-0000015.webm" },
                { name: "0000015-0000030.webm" },
            ],
            error: null,
        });
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

    it("uploads the concatenated audio and finalizes from the provisional transcript when provided", async () => {
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
            url: "https://example.com/audio/finalized.webm",
            transcriptStatus: "complete",
        });
        expect(uploadAudio).toHaveBeenCalledWith(
            Buffer.from("header-and-chunks-0-14chunks-15-29"),
            expect.stringContaining("memo-1.webm"),
            "audio/webm"
        );
        expect(persistMemoProvisional).toHaveBeenCalledWith(
            "memo-1",
            "https://example.com/audio/finalized.webm",
            "user-1"
        );
        expect(promoteLiveSegmentsToFinal).toHaveBeenCalledWith("memo-1", "user-1");
        expect(updateMemoFinal).toHaveBeenCalledWith(
            "memo-1",
            "live transcript",
            [],
            "https://example.com/audio/finalized.webm",
            "user-1",
            expect.any(Number)
        );
        expect(transcribeUploadedAudio).not.toHaveBeenCalled();
        expect(remove).toHaveBeenCalledWith([
            "audio/chunks/memo-1/0000000-0000015.webm",
            "audio/chunks/memo-1/0000015-0000030.webm",
        ]);
    });

    it("returns 409 when the uploaded chunk ranges contain a gap", async () => {
        list.mockResolvedValue({
            data: [
                { name: "0000000-0000015.webm" },
                { name: "0000020-0000030.webm" },
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
        expect(uploadAudio).not.toHaveBeenCalled();
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
        expect(uploadAudio).not.toHaveBeenCalled();
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
                data: [{ name: "0000000-0000001.webm" }],
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
});
