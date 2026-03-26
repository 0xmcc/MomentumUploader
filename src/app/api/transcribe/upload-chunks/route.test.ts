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
        from: jest.fn(),
        storage: {
            from: jest.fn(),
        },
    },
}));

describe("POST /api/transcribe/upload-chunks", () => {
    const createSignedUploadUrl = jest.fn();
    const upload = jest.fn();

    function mockOwnedMemoLookup(result: { data: unknown; error: unknown } = { data: { id: "memo-1" }, error: null }) {
        const maybeSingle = jest.fn().mockResolvedValue(result);
        const single = jest.fn().mockResolvedValue(result);
        const eqUserId = jest.fn(() => ({ maybeSingle, single }));
        const eqMemoId = jest.fn(() => ({ eq: eqUserId }));
        const select = jest.fn(() => ({ eq: eqMemoId }));

        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "memos") {
                return { select };
            }
            throw new Error(`Unexpected table: ${table}`);
        });

        return { select, eqMemoId, eqUserId, maybeSingle, single };
    }

    beforeEach(() => {
        jest.clearAllMocks();
        (resolveMemoUserId as jest.Mock).mockResolvedValue("user-1");
        mockOwnedMemoLookup();
        (supabaseAdmin.storage.from as jest.Mock).mockReturnValue({
            createSignedUploadUrl,
            upload,
        });
        createSignedUploadUrl.mockResolvedValue({
            data: {
                path: "audio/chunks/memo-1/0000030-0000060.webm",
                token: "signed-upload-token",
            },
            error: null,
        });
        upload.mockResolvedValue({ error: null });
    });

    it("rejects unauthorized chunk uploads", async () => {
        (resolveMemoUserId as jest.Mock).mockResolvedValue(null);

        const req = {} as NextRequest;
        const res = await POST(req);

        expect(res.status).toBe(401);
        expect(createSignedUploadUrl).not.toHaveBeenCalled();
    });

    it("returns 404 when the memo is not owned by the authenticated user", async () => {
        mockOwnedMemoLookup({ data: null, error: null });

        const req = {
            json: async () => ({
                memoId: "memo-1",
                startIndex: 30,
                endIndex: 60,
                contentType: "audio/webm",
            }),
        } as unknown as NextRequest;

        const res = await POST(req);
        const json = await res.json();

        expect(res.status).toBe(404);
        expect(json).toEqual({ error: "Memo not found" });
        expect(createSignedUploadUrl).not.toHaveBeenCalled();
        expect(upload).not.toHaveBeenCalled();
    });

    it("returns a signed upload token using the padded start and end indices", async () => {
        const req = {
            json: async () => ({
                memoId: "memo-1",
                startIndex: 30,
                endIndex: 60,
                contentType: "audio/webm",
            }),
        } as unknown as NextRequest;

        const res = await POST(req);
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json).toEqual({
            ok: true,
            path: "audio/chunks/memo-1/0000030-0000060.webm",
            token: "signed-upload-token",
        });
        expect(createSignedUploadUrl).toHaveBeenCalledWith(
            "audio/chunks/memo-1/0000030-0000060.webm",
            {
                upsert: true,
            }
        );
    });

    it("accepts legacy multipart chunk uploads during rollout", async () => {
        const file = new File(["chunk-audio"], "chunk.webm", { type: "audio/webm" });
        const formData = new FormData();
        formData.set("memoId", "memo-1");
        formData.set("startIndex", "30");
        formData.set("endIndex", "60");
        formData.set("file", file);

        const req = {
            headers: {
                get: (key: string) =>
                    key.toLowerCase() === "content-type"
                        ? "multipart/form-data; boundary=test"
                        : null,
            },
            json: async () => {
                throw new Error("Expected multipart fallback");
            },
            formData: async () => formData,
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
        expect(createSignedUploadUrl).not.toHaveBeenCalled();
    });

    it("rejects invalid chunk upload payloads before writing to storage", async () => {
        const req = {
            json: async () => ({
                memoId: "memo-1",
                startIndex: 60,
                endIndex: 60,
                contentType: "audio/webm",
            }),
        } as unknown as NextRequest;

        const res = await POST(req);
        const json = await res.json();

        expect(res.status).toBe(400);
        expect(json).toEqual({ error: "Invalid chunk upload payload" });
        expect(createSignedUploadUrl).not.toHaveBeenCalled();
    });
});
