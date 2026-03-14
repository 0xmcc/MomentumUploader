import { NextRequest } from "next/server";
import { POST } from "./route";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { supabaseAdmin } from "@/lib/supabase";

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
    supabaseAdmin: {
        storage: {
            from: jest.fn(),
        },
    },
}));

describe("POST /api/transcribe/upload-chunks", () => {
    const upload = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        (resolveMemoUserId as jest.Mock).mockResolvedValue("user-1");
        (supabaseAdmin.storage.from as jest.Mock).mockReturnValue({
            upload,
        });
        upload.mockResolvedValue({ error: null });
    });

    it("rejects unauthorized chunk uploads", async () => {
        (resolveMemoUserId as jest.Mock).mockResolvedValue(null);

        const req = {} as NextRequest;
        const res = await POST(req);

        expect(res.status).toBe(401);
        expect(upload).not.toHaveBeenCalled();
    });

    it("stores a chunk batch using the padded start and end indices", async () => {
        const file = new File(["chunk-audio"], "chunk.webm", { type: "audio/webm" });
        const req = {
            formData: async () => ({
                get: (key: string) => {
                    if (key === "memoId") return "memo-1";
                    if (key === "startIndex") return "30";
                    if (key === "endIndex") return "60";
                    if (key === "file") return file;
                    return null;
                },
            }),
        } as unknown as NextRequest;

        const res = await POST(req);
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json).toEqual({ ok: true });
        expect(upload).toHaveBeenCalledWith(
            "audio/chunks/memo-1/0000030-0000060.webm",
            file,
            {
                upsert: true,
                contentType: "audio/webm",
            }
        );
    });

    it("rejects invalid chunk upload payloads before writing to storage", async () => {
        const file = new File(["chunk-audio"], "chunk.webm", { type: "audio/webm" });
        const req = {
            formData: async () => ({
                get: (key: string) => {
                    if (key === "memoId") return "memo-1";
                    if (key === "startIndex") return "60";
                    if (key === "endIndex") return "60";
                    if (key === "file") return file;
                    return null;
                },
            }),
        } as unknown as NextRequest;

        const res = await POST(req);
        const json = await res.json();

        expect(res.status).toBe(400);
        expect(json).toEqual({ error: "Invalid chunk upload payload" });
        expect(upload).not.toHaveBeenCalled();
    });
});
