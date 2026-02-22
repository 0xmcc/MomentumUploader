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
});
