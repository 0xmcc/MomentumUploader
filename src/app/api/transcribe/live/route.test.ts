import { POST } from "./route";
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

jest.mock("@/lib/riva", () => ({
    transcribeAudio: jest.fn(),
}));

jest.mock("@/lib/memo-api-auth", () => ({
    resolveMemoUserId: jest.fn(),
}));

describe("POST /api/transcribe/live", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (transcribeAudio as jest.Mock).mockResolvedValue("partial transcript");
        (resolveMemoUserId as jest.Mock).mockResolvedValue("user_abc");
    });

    it("returns 401 when the caller is not authenticated", async () => {
        (resolveMemoUserId as jest.Mock).mockResolvedValue(null);

        const req = {
            formData: async () => ({
                get: (key: string) =>
                    key === "file"
                        ? {
                            type: "audio/webm",
                            size: 2048,
                            arrayBuffer: async () => new Uint8Array(Buffer.from("fake-live-audio")).buffer,
                        }
                        : null,
            }),
        } as unknown as NextRequest;

        const res = await POST(req);
        const body = await res.json();

        expect(res.status).toBe(401);
        expect(body).toEqual({ error: "Unauthorized" });
        expect(transcribeAudio).not.toHaveBeenCalled();
    });

    it("passes live-priority hint so live ticks cannot block final transcription", async () => {
        const req = {
            formData: async () => ({
                get: (key: string) =>
                    key === "file"
                        ? {
                            type: "audio/webm",
                            size: 2048,
                            arrayBuffer: async () => new Uint8Array(Buffer.from("fake-live-audio")).buffer,
                        }
                        : null,
            }),
        } as unknown as NextRequest;

        await POST(req);

        expect(transcribeAudio).toHaveBeenCalledTimes(1);
        const [audioArg, _apiKeyArg, mimeArg, optionsArg] = (transcribeAudio as jest.Mock).mock.calls[0];
        expect(Buffer.isBuffer(audioArg)).toBe(true);
        expect(mimeArg).toBe("audio/webm");
        expect(optionsArg).toEqual({ priority: "live" });
    });
});
