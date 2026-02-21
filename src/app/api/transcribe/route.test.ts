import { POST } from "./route";
import { supabaseAdmin, uploadAudio } from "@/lib/supabase";
import { transcribeAudio } from "@/lib/riva";

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
        __insertMock: insertMock,
    };
});

jest.mock("@/lib/riva", () => ({
    transcribeAudio: jest.fn(),
}));

describe("POST /api/transcribe", () => {
    beforeEach(() => {
        jest.clearAllMocks();
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
        } as any;

        const res = await POST(req);
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.text).toBe("hello world");

        // We expect uploadAudio to be called with a Buffer, not a raw File object from FormData
        expect(uploadAudio).toHaveBeenCalled();
        const uploadedFile = (uploadAudio as jest.Mock).mock.calls[0][0];
        expect(Buffer.isBuffer(uploadedFile)).toBe(true);

        // We expect it to save to the 'memos' table, not 'items'
        expect(supabaseAdmin.from).toHaveBeenCalledWith("memos");

        // Ensure the insert payload matches the expected schema
        const supabaseMod = require("@/lib/supabase");
        const insertPayload = supabaseMod.__insertMock.mock.calls[0][0];
        expect(insertPayload).toHaveProperty("title");
        expect(insertPayload).toHaveProperty("transcript", "hello world");
        expect(insertPayload).toHaveProperty("audio_url", "https://example.com/audio.webm");
    });
});
