import { POST } from "./route";
import { supabaseAdmin, uploadAudio } from "@/lib/supabase";
import { transcribeAudio } from "@/lib/riva";
import { auth } from "@clerk/nextjs/server";
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
    const insertMock = jest.fn(() => ({
        select: jest.fn().mockResolvedValue({ data: [{ id: "1" }], error: null }),
    }));
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
            from: jest.fn(() => ({
                insert: insertMock,
            })),
        },
    };
});

jest.mock("@/lib/riva", () => ({
    transcribeAudio: jest.fn(),
}));

jest.mock("@clerk/nextjs/server", () => ({
    auth: jest.fn(),
}));

describe("POST /api/transcribe", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (supabaseAdmin.from as jest.Mock).mockReset();
        (supabaseAdmin.from as jest.Mock).mockImplementation(() => ({
            insert: jest.fn(() => ({
                select: jest.fn().mockResolvedValue({ data: [{ id: "1" }], error: null }),
            })),
        }));
        (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user_123" });
        // Give transcript
        (transcribeAudio as jest.Mock).mockResolvedValue("hello world");
    });

    it("should process audio, upload as buffer, and save to memos table", async () => {
        const formDataObj = {
            get: (key: string) => {
                if (key === "file") {
                    return {
                        name: "test-memo.webm",
                        type: "audio/webm",
                        size: 10,
                        arrayBuffer: async () => new Uint8Array(Buffer.from("fake-audio")).buffer,
                    };
                }
                return null;
            }
        };

        const req = {
            formData: async () => formDataObj,
        } as unknown as NextRequest;

        const res = await POST(req);
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.id).toBe("1");
        expect(json.text).toBe("hello world");

        // We expect uploadAudio to be called with a Buffer, not a raw File object from FormData
        expect(uploadAudio).toHaveBeenCalled();
        const uploadedFile = (uploadAudio as jest.Mock).mock.calls[0][0];
        expect(Buffer.isBuffer(uploadedFile)).toBe(true);

        // We expect it to save to the 'memos' table, not 'items'
        expect(supabaseAdmin.from).toHaveBeenCalledWith("memos");

        // Ensure the insert payload matches the expected schema
        const insertMockFn = (supabaseAdmin.from as jest.Mock).mock.results[0].value.insert;
        const insertPayload = insertMockFn.mock.calls[0][0];
        expect(insertPayload).toHaveProperty("title");
        expect(insertPayload).toHaveProperty("transcript", "hello world");
        expect(insertPayload).toHaveProperty("audio_url", "https://example.com/audio.webm");
        expect(insertPayload).toHaveProperty("user_id", "user_123");
    });

    it("passes final-priority hint to transcription to avoid live-call contention", async () => {
        const formDataObj = {
            get: (key: string) => {
                if (key === "file") {
                    return {
                        name: "test-memo.webm",
                        type: "audio/webm",
                        size: 10,
                        arrayBuffer: async () => new Uint8Array(Buffer.from("fake-audio")).buffer,
                    };
                }
                return null;
            }
        };

        const req = {
            formData: async () => formDataObj,
        } as unknown as NextRequest;

        await POST(req);

        expect(transcribeAudio).toHaveBeenCalledTimes(1);
        const [audioArg, _apiKeyArg, mimeArg, optionsArg] = (transcribeAudio as jest.Mock).mock.calls[0];
        expect(Buffer.isBuffer(audioArg)).toBe(true);
        expect(mimeArg).toBe("audio/webm");
        expect(optionsArg).toEqual({ priority: "final" });
    });

    it("accepts m4a uploads and forwards the source MIME type to transcription", async () => {
        const formDataObj = {
            get: (key: string) => {
                if (key === "file") {
                    return {
                        name: "iphone-note.m4a",
                        type: "audio/x-m4a",
                        size: 10,
                        arrayBuffer: async () => new Uint8Array(Buffer.from("fake-audio")).buffer,
                    };
                }
                return null;
            }
        };

        const req = {
            formData: async () => formDataObj,
        } as unknown as NextRequest;

        const res = await POST(req);
        expect(res.status).toBe(200);

        expect(transcribeAudio).toHaveBeenCalledTimes(1);
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

        const formDataObj = {
            get: (key: string) => {
                if (key === "file") {
                    return {
                        name: "iphone-note.m4a",
                        type: "audio/x-m4a",
                        size: 10,
                        arrayBuffer: async () => new Uint8Array(Buffer.from("fake-audio")).buffer,
                    };
                }
                return null;
            }
        };

        const req = {
            formData: async () => formDataObj,
        } as unknown as NextRequest;

        const res = await POST(req);

        expect(uploadAudio).toHaveBeenCalledWith(
            expect.any(Buffer),
            expect.stringContaining("iphone-note.m4a"),
            "audio/mp4"
        );
        expect(res.status).toBe(200);
    });

    it("updates an existing memo when memoId is provided", async () => {
        const maybeSingle = jest.fn().mockResolvedValue({
            data: { id: "memo-live-1" },
            error: null,
        });
        const updateQuery = {
            eq: jest.fn(),
            select: jest.fn(() => ({ maybeSingle })),
        };
        updateQuery.eq.mockReturnValue(updateQuery);
        const update = jest.fn(() => updateQuery);
        const insert = jest.fn(() => ({
            select: jest.fn().mockResolvedValue({ data: [{ id: "fallback-1" }], error: null }),
        }));

        (supabaseAdmin.from as jest.Mock).mockReturnValue({
            update,
            insert,
        });

        const formDataObj = {
            get: (key: string) => {
                if (key === "file") {
                    return {
                        name: "live-memo.webm",
                        type: "audio/webm",
                        size: 10,
                        arrayBuffer: async () => new Uint8Array(Buffer.from("fake-audio")).buffer,
                    };
                }
                if (key === "memoId") {
                    return "memo-live-1";
                }
                return null;
            },
        };

        const req = {
            formData: async () => formDataObj,
        } as unknown as NextRequest;

        const res = await POST(req);
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.id).toBe("memo-live-1");
        expect(update).toHaveBeenCalledWith(
            expect.objectContaining({
                title: "live-memo.webm",
                transcript: "hello world",
                audio_url: "https://example.com/audio.webm",
            })
        );
        expect(insert).not.toHaveBeenCalled();
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

        const formDataObj = {
            get: (key: string) => {
                if (key === "file") {
                    return {
                        name: "memo_123.mp4",
                        type: "application/octet-stream",
                        size: 10,
                        arrayBuffer: async () => new Uint8Array(Buffer.from("fake-audio")).buffer,
                    };
                }
                return null;
            }
        };

        const req = {
            formData: async () => formDataObj,
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
        (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });

        const req = {} as NextRequest;
        const res = await POST(req);
        const json = await res.json();

        expect(res.status).toBe(401);
        expect(json.error).toBe("Unauthorized");
    });

    it("returns 500 when memo DB insert fails", async () => {
        const insertMockFn = (supabaseAdmin.from as jest.Mock).mock.results[0]?.value?.insert as jest.Mock | undefined;
        if (!insertMockFn) {
            (supabaseAdmin.from as jest.Mock).mockReturnValue({
                insert: jest.fn(() => ({
                    select: jest.fn().mockResolvedValue({
                        data: null,
                        error: { message: 'column "user_id" of relation "memos" does not exist' },
                    }),
                })),
            });
        } else {
            insertMockFn.mockReturnValue({
                select: jest.fn().mockResolvedValue({
                    data: null,
                    error: { message: 'column "user_id" of relation "memos" does not exist' },
                }),
            });
        }

        const formDataObj = {
            get: (key: string) => {
                if (key === "file") {
                    return {
                        name: "test-memo.webm",
                        type: "audio/webm",
                        size: 10,
                        arrayBuffer: async () => new Uint8Array(Buffer.from("fake-audio")).buffer,
                    };
                }
                return null;
            }
        };

        const req = {
            formData: async () => formDataObj,
        } as unknown as NextRequest;

        const res = await POST(req);
        const json = await res.json();

        expect(res.status).toBe(500);
        expect(json.error).toBe("Failed to save memo");
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
        (supabaseAdmin.from as jest.Mock).mockReturnValue({
            insert: jest.fn(() => ({
                select: jest.fn().mockResolvedValue({
                    data: [{ id: "big-1" }],
                    error: null,
                }),
            })),
        });

        const formDataObj = {
            get: (key: string) => {
                if (key === "file") {
                    return {
                        name: "big-memo.m4a",
                        type: "audio/mp4",
                        size: 55 * 1024 * 1024,
                        arrayBuffer: async () => new Uint8Array(Buffer.from("fake-audio")).buffer,
                    };
                }
                return null;
            }
        };

        const req = {
            formData: async () => formDataObj,
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

        const formDataObj = {
            get: (key: string) => {
                if (key === "file") {
                    return {
                        name: "memo_1771832019333.mp4",
                        type: "audio/x-m4a",
                        size: 55_089_770,
                        arrayBuffer: async () => new Uint8Array(Buffer.from("fake-audio")).buffer,
                    };
                }
                return null;
            }
        };

        const req = {
            formData: async () => formDataObj,
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

        const formDataObj = {
            get: (key: string) => {
                if (key === "file") {
                    return {
                        name: "memo_1771832233112.mp4",
                        type: "audio/x-m4a",
                        size: 55_089_770,
                        arrayBuffer: async () => new Uint8Array(Buffer.from("fake-audio")).buffer,
                    };
                }
                return null;
            },
        };

        const req = {
            formData: async () => formDataObj,
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

        const formDataObj = {
            get: (key: string) => {
                if (key === "file") {
                    return {
                        name: "memo_1771832588640.mp4",
                        type: "audio/x-m4a",
                        size: 55_089_770,
                        arrayBuffer: async () => new Uint8Array(Buffer.from("fake-audio")).buffer,
                    };
                }
                return null;
            },
        };

        const req = {
            formData: async () => formDataObj,
        } as unknown as NextRequest;

        const res = await POST(req);
        const json = await res.json();

        expect(res.status).toBe(413);
        expect(json.error).toBe("Audio file too large for storage");
        expect(json.detail).toContain("spend cap");
    });
});
