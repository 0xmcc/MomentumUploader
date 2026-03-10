import { POST } from "./route";
import { supabaseAdmin, uploadAudio } from "@/lib/supabase";
import { transcribeAudio } from "@/lib/riva";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { NextRequest } from "next/server";

jest.mock("next/server", () => {
    return {
        NextRequest: jest.fn(),
        NextResponse: {
            json: jest.fn((body, init) => ({
                status: init?.status || 200,
                json: async () => body,
            })),
        },
    };
});


jest.mock("@/lib/supabase", () => {
    return {
        uploadAudio: jest.fn(),
        supabase: {
            storage: {
                from: jest.fn(() => ({
                    getPublicUrl: jest.fn(() => ({ data: { publicUrl: "https://example.com/audio.webm" } })),
                })),
            },
        },
        supabaseAdmin: {
            from: jest.fn(),
        },
    };
});

jest.mock("@/lib/riva", () => ({
    transcribeAudio: jest.fn(),
}));

jest.mock("@/lib/memo-api-auth", () => ({
    resolveMemoUserId: jest.fn(),
}));

/**
 * Build a chainable Supabase update query mock.
 * Supports: .update().eq().eq() (thenable) and .update().eq().eq().select().maybeSingle()
 */
function makeUpdateChain(resolvedValue: unknown) {
    const selectResult = {
        maybeSingle: jest.fn().mockResolvedValue(resolvedValue),
        single: jest.fn().mockResolvedValue(resolvedValue),
    };
    const eqFn = jest.fn();
    const selectFn = jest.fn().mockReturnValue(selectResult);
    const thenFn = (onfulfilled: (v: unknown) => unknown) =>
        Promise.resolve(resolvedValue).then(onfulfilled);

    const chain: Record<string, unknown> = { eq: eqFn, select: selectFn, then: thenFn };
    eqFn.mockReturnValue(chain);
    return chain;
}

/**
 * Default two-stage pipeline mock:
 * - provisional: insert → select → single → { data: { id: "1" }, error: null }
 * - final:       update → eq → eq → { data: null, error: null }
 */
function makeDefaultMock() {
    return {
        insert: jest.fn(() => ({
            select: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({ data: { id: "1" }, error: null }),
                maybeSingle: jest.fn().mockResolvedValue({ data: { id: "1" }, error: null }),
            }),
        })),
        update: jest.fn(() => makeUpdateChain({ data: null, error: null })),
    };
}

function makeAudioFormData(overrides?: { name?: string; type?: string; size?: number; memoId?: string }) {
    const name = overrides?.name ?? "test-memo.webm";
    const type = overrides?.type ?? "audio/webm";
    const size = overrides?.size ?? 10;
    return {
        get: (key: string) => {
            if (key === "file") {
                return {
                    name,
                    type,
                    size,
                    arrayBuffer: async () => new Uint8Array(Buffer.from("fake-audio")).buffer,
                };
            }
            if (key === "memoId") return overrides?.memoId ?? null;
            return null;
        },
    };
}

describe("POST /api/transcribe", () => {
    const originalNvidiaApiKey = process.env.NVIDIA_API_KEY;

    beforeEach(() => {
        jest.clearAllMocks();
        (supabaseAdmin.from as jest.Mock).mockReset();
        (supabaseAdmin.from as jest.Mock).mockImplementation(() => makeDefaultMock());
        process.env.NVIDIA_API_KEY = "test-nvidia-key";
        (resolveMemoUserId as jest.Mock).mockResolvedValue("user_123");
        (transcribeAudio as jest.Mock).mockResolvedValue("hello world");
    });

    afterAll(() => {
        if (originalNvidiaApiKey === undefined) {
            delete process.env.NVIDIA_API_KEY;
            return;
        }
        process.env.NVIDIA_API_KEY = originalNvidiaApiKey;
    });

    it("should process audio, upload as buffer, and persist a memo row", async () => {
        const req = {
            formData: async () => makeAudioFormData(),
        } as unknown as NextRequest;

        const res = await POST(req);
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.id).toBe("1");
        expect(json.text).toBe("hello world");

        // Upload must be called with a Buffer
        expect(uploadAudio).toHaveBeenCalled();
        const uploadedFile = (uploadAudio as jest.Mock).mock.calls[0][0];
        expect(Buffer.isBuffer(uploadedFile)).toBe(true);

        // Two calls to from("memos"): provisional insert + final update
        const allCalls = (supabaseAdmin.from as jest.Mock).mock.calls;
        expect(allCalls.length).toBeGreaterThanOrEqual(2);

        // First call: provisional insert with transcript_status = 'processing'
        const provisionalResult = (supabaseAdmin.from as jest.Mock).mock.results[0].value;
        const insertPayload = provisionalResult.insert.mock.calls[0][0];
        expect(insertPayload).toHaveProperty("transcript_status", "processing");
        expect(insertPayload).toHaveProperty("audio_url", "https://example.com/audio.webm");
        expect(insertPayload).toHaveProperty("user_id", "user_123");

        // Second call: final update with full transcript + complete status
        const finalResult = (supabaseAdmin.from as jest.Mock).mock.results[1].value;
        const updatePayload = finalResult.update.mock.calls[0][0];
        expect(updatePayload).toHaveProperty("transcript", "hello world");
        expect(updatePayload).toHaveProperty("transcript_status", "complete");
    });

    it("passes final-priority hint to transcription to avoid live-call contention", async () => {
        const req = {
            formData: async () => makeAudioFormData(),
        } as unknown as NextRequest;

        await POST(req);

        expect(transcribeAudio).toHaveBeenCalledTimes(1);
        const [audioArg, _apiKeyArg, mimeArg, optionsArg] = (transcribeAudio as jest.Mock).mock.calls[0];
        expect(Buffer.isBuffer(audioArg)).toBe(true);
        expect(mimeArg).toBe("audio/webm");
        expect(optionsArg).toEqual({ priority: "final" });
    });

    it("accepts m4a uploads and forwards the source MIME type to transcription", async () => {
        const req = {
            formData: async () => makeAudioFormData({ name: "iphone-note.m4a", type: "audio/x-m4a" }),
        } as unknown as NextRequest;

        const res = await POST(req);
        expect(res.status).toBe(200);

        const [_audioArg, _apiKeyArg, mimeArg, optionsArg] = (transcribeAudio as jest.Mock).mock.calls[0];
        expect(mimeArg).toBe("audio/x-m4a");
        expect(optionsArg).toEqual({ priority: "final" });
    });

    it("normalizes audio/x-m4a uploads to audio/mp4 before storage upload", async () => {
        (uploadAudio as jest.Mock).mockImplementation(
            async (_file: Buffer, _fileName: string, contentType?: string) => {
                if (contentType === "audio/x-m4a") {
                    throw new Error("Unsupported content type audio/x-m4a");
                }
                return { path: "audio/iphone-note.m4a" };
            }
        );

        const req = {
            formData: async () => makeAudioFormData({ name: "iphone-note.m4a", type: "audio/x-m4a" }),
        } as unknown as NextRequest;

        const res = await POST(req);

        expect(uploadAudio).toHaveBeenCalledWith(
            expect.any(Buffer),
            expect.stringContaining("iphone-note.m4a"),
            "audio/mp4"
        );
        expect(res.status).toBe(200);
    });

    it("updates an existing live memo when memoId is provided", async () => {
        let callCount = 0;
        (supabaseAdmin.from as jest.Mock).mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
                // provisional persist: update existing memo by memoId
                return {
                    update: jest.fn(() => makeUpdateChain({ data: { id: "memo-live-1" }, error: null })),
                    insert: jest.fn(),
                };
            }
            // final update
            return {
                update: jest.fn(() => makeUpdateChain({ data: null, error: null })),
                insert: jest.fn(),
            };
        });

        const req = {
            formData: async () => makeAudioFormData({ name: "live-memo.webm", memoId: "memo-live-1" }),
        } as unknown as NextRequest;

        const res = await POST(req);
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.id).toBe("memo-live-1");

        // Provisional: sets audio_url + transcript_status = 'processing', NOT transcript
        const provisionalUpdateFn = (supabaseAdmin.from as jest.Mock).mock.results[0].value.update;
        const provisionalPayload = provisionalUpdateFn.mock.calls[0][0];
        expect(provisionalPayload).toHaveProperty("audio_url", "https://example.com/audio.webm");
        expect(provisionalPayload).toHaveProperty("transcript_status", "processing");
        expect(provisionalPayload).not.toHaveProperty("transcript");

        // Final: sets transcript + transcript_status = 'complete'
        const finalUpdateFn = (supabaseAdmin.from as jest.Mock).mock.results[1].value.update;
        const finalPayload = finalUpdateFn.mock.calls[0][0];
        expect(finalPayload).toHaveProperty("transcript", "hello world");
        expect(finalPayload).toHaveProperty("transcript_status", "complete");
    });

    it("normalizes octet-stream uploads to audio/mp4 when filename indicates mp4", async () => {
        (uploadAudio as jest.Mock).mockImplementation(
            async (_file: Buffer, _fileName: string, contentType?: string) => {
                if (contentType === "application/octet-stream") {
                    throw new Error("Unsupported content type application/octet-stream");
                }
                return { path: "audio/memo_123.mp4" };
            }
        );

        const req = {
            formData: async () => makeAudioFormData({ name: "memo_123.mp4", type: "application/octet-stream" }),
        } as unknown as NextRequest;

        const res = await POST(req);

        expect(uploadAudio).toHaveBeenCalledWith(
            expect.any(Buffer),
            expect.stringContaining("memo_123.mp4"),
            "audio/mp4"
        );
        expect(res.status).toBe(200);
    });

    it("returns 401 when user is unauthenticated", async () => {
        (resolveMemoUserId as jest.Mock).mockResolvedValue(null);

        const req = {} as NextRequest;
        const res = await POST(req);
        const json = await res.json();

        expect(res.status).toBe(401);
        expect(json.error).toBe("Unauthorized");
    });

    it("persists uploads for bearer-authenticated callers", async () => {
        (resolveMemoUserId as jest.Mock).mockResolvedValue("user_bearer_456");

        const req = {
            formData: async () => makeAudioFormData({ name: "bearer-memo.webm" }),
            headers: {
                get: (name: string) =>
                    name.toLowerCase() == "authorization" ? "Bearer vm1.fake.fake" : null,
            },
        } as unknown as NextRequest;

        const res = await POST(req);
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.success).toBe(true);

        // Provisional insert should carry the resolved user_id
        const provisionalResult = (supabaseAdmin.from as jest.Mock).mock.results[0].value;
        const insertPayload = provisionalResult.insert.mock.calls[0][0];
        expect(insertPayload.user_id).toBe("user_bearer_456");
        expect(resolveMemoUserId).toHaveBeenCalledWith(req);
    });

    it("returns 500 when provisional memo DB insert fails after retry", async () => {
        (supabaseAdmin.from as jest.Mock).mockImplementation(() => ({
            insert: jest.fn(() => ({
                select: jest.fn().mockReturnValue({
                    single: jest.fn().mockResolvedValue({
                        data: null,
                        error: { message: 'column "user_id" does not exist' },
                    }),
                }),
            })),
            update: jest.fn(() => makeUpdateChain({ data: null, error: null })),
        }));

        const req = {
            formData: async () => makeAudioFormData(),
        } as unknown as NextRequest;

        const res = await POST(req);
        const json = await res.json();

        // Audio was uploaded but DB row creation failed — no storage rollback
        expect(uploadAudio).toHaveBeenCalled();
        expect(res.status).toBe(500);
        expect(json.error).toBe("Failed to save memo");
    });

    it("returns 500 when NVIDIA_API_KEY is missing", async () => {
        delete process.env.NVIDIA_API_KEY;

        const req = {
            formData: async () => makeAudioFormData(),
        } as unknown as NextRequest;

        const res = await POST(req);
        const json = await res.json();

        expect(res.status).toBe(500);
        expect(json.error).toBe("Transcription is not configured");
        expect(uploadAudio).not.toHaveBeenCalled();
    });

    it("transcription failure saves memo as failed and returns 200 with degraded payload", async () => {
        (transcribeAudio as jest.Mock).mockRejectedValue(new Error("spawn ffmpeg ENOENT"));

        const req = {
            formData: async () => makeAudioFormData({ name: "prod-memo.webm" }),
        } as unknown as NextRequest;

        const res = await POST(req);
        const json = await res.json();

        // Audio is uploaded and memo is preserved — not a total failure
        expect(uploadAudio).toHaveBeenCalled();
        expect(res.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.transcriptStatus).toBe("failed");
        expect(json.text).toBe("[Transcription failed]");
        expect(json.url).toBe("https://example.com/audio.webm");
        expect(json.id).toBeDefined();

        // Provisional memo was created, then marked failed
        const provisionalCall = (supabaseAdmin.from as jest.Mock).mock.results[0].value;
        expect(provisionalCall.insert).toHaveBeenCalled();

        const failedCall = (supabaseAdmin.from as jest.Mock).mock.results[1].value;
        const failedUpdatePayload = failedCall.update.mock.calls[0][0];
        expect(failedUpdatePayload).toHaveProperty("transcript_status", "failed");
        expect(failedUpdatePayload).toHaveProperty("transcript", "[Transcription failed]");
    });

    it("returns 413 when multipart payload exceeds body-size limits", async () => {
        const req = {
            formData: async () => {
                throw new Error("Body exceeded 1mb limit");
            },
        } as unknown as NextRequest;

        const res = await POST(req);
        const json = await res.json();

        expect(res.status).toBe(413);
        expect(json.error).toBe("Audio file too large");
    });

    it("accepts uploads larger than 50MB when file size is within updated limit", async () => {
        (uploadAudio as jest.Mock).mockResolvedValue({ path: "audio/big-memo.m4a" });

        const req = {
            formData: async () => makeAudioFormData({ name: "big-memo.m4a", type: "audio/mp4", size: 55 * 1024 * 1024 }),
        } as unknown as NextRequest;

        const res = await POST(req);
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.success).toBe(true);
        expect(uploadAudio).toHaveBeenCalled();
    });

    it("logs structured storage diagnostics for large-upload transport failures like EPIPE", async () => {
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => { });
        const transportCause = Object.assign(new Error("write EPIPE"), {
            errno: -32,
            code: "EPIPE",
            syscall: "write",
        });
        const originalError = Object.assign(new TypeError("fetch failed"), {
            cause: transportCause,
        });
        const uploadFailure = Object.assign(new Error("fetch failed"), {
            name: "StorageUnknownError",
            __isStorageError: true,
            namespace: "storage",
            status: undefined,
            statusCode: undefined,
            originalError,
        });

        (uploadAudio as jest.Mock).mockRejectedValue(uploadFailure);

        const req = {
            formData: async () => makeAudioFormData({ name: "memo_1771832019333.mp4", type: "audio/x-m4a", size: 55_089_770 }),
        } as unknown as NextRequest;

        const res = await POST(req);
        expect(res.status).toBe(500);

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            "[transcribe/storage] ❌ Upload diagnostics",
            expect.objectContaining({
                fileName: "memo_1771832019333.mp4",
                fileSizeBytes: 55_089_770,
                fileType: "audio/x-m4a",
                uploadContentType: "audio/mp4",
                errorName: "StorageUnknownError",
                errorMessage: "fetch failed",
                errorCode: "EPIPE",
                errorErrno: -32,
                errorSyscall: "write",
            })
        );

        consoleErrorSpy.mockRestore();
    });

    it("returns 413 when Supabase storage rejects object size with statusCode 413", async () => {
        const uploadFailure = Object.assign(
            new Error("The object exceeded the maximum allowed size"),
            {
                name: "StorageApiError",
                __isStorageError: true,
                namespace: "storage",
                status: 400,
                statusCode: "413",
            }
        );
        (uploadAudio as jest.Mock).mockRejectedValue(uploadFailure);

        const req = {
            formData: async () => makeAudioFormData({ name: "memo_1771832233112.mp4", type: "audio/x-m4a", size: 55_089_770 }),
        } as unknown as NextRequest;

        const res = await POST(req);
        const json = await res.json();

        expect(res.status).toBe(413);
        expect(json.error).toBe("Audio file too large for storage");
        expect(json.detail).toContain("Supabase upload cap");
    });

    it("returns 413 when Supabase closes upload socket with UND_ERR_SOCKET near file-size boundary", async () => {
        const uploadFailure = Object.assign(new Error("fetch failed"), {
            name: "StorageUnknownError",
            __isStorageError: true,
            namespace: "storage",
            status: undefined,
            statusCode: undefined,
            originalError: Object.assign(new TypeError("fetch failed"), {
                cause: Object.assign(new Error("other side closed"), {
                    code: "UND_ERR_SOCKET",
                    socket: {
                        bytesWritten: 55_095_203,
                        bytesRead: 17_865,
                    },
                }),
            }),
        });
        (uploadAudio as jest.Mock).mockRejectedValue(uploadFailure);

        const req = {
            formData: async () => makeAudioFormData({ name: "memo_1771832588640.mp4", type: "audio/x-m4a", size: 55_089_770 }),
        } as unknown as NextRequest;

        const res = await POST(req);
        const json = await res.json();

        expect(res.status).toBe(413);
        expect(json.error).toBe("Audio file too large for storage");
        expect(json.detail).toContain("spend cap");
    });
});
