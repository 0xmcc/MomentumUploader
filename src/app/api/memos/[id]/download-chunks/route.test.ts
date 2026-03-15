/** @jest-environment node */

import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";
import { GET } from "./route";

jest.mock("@clerk/nextjs/server", () => ({
    auth: jest.fn(),
}));

jest.mock("@/lib/supabase", () => ({
    supabaseAdmin: {
        storage: {
            from: jest.fn(),
        },
    },
}));

describe("GET /api/memos/:id/download-chunks", () => {
    const list = jest.fn();
    const download = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        (auth as jest.Mock).mockResolvedValue({ userId: "user-1" });
        (supabaseAdmin.storage.from as jest.Mock).mockReturnValue({
            list,
            download,
        });
        list.mockResolvedValue({
            data: [
                { name: "0000000-0001000.webm" },
                { name: "0001000-0002000.webm" },
                { name: "0002000-0003000.webm" },
            ],
            error: null,
        });
        download.mockResolvedValue({
            data: new Blob([Buffer.from("chunk")], { type: "audio/webm" }),
            error: null,
        });
    });

    it("returns 200 with concatenated WebM body", async () => {
        const response = await GET(new Request("http://localhost/api/memos/memo-abc/download-chunks"), {
            params: Promise.resolve({ id: "memo-abc" }),
        });

        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toContain("audio/webm");
        expect(response.headers.get("Content-Disposition")).toContain("recording-memo-abc.webm");

        const body = Buffer.from(await response.arrayBuffer());
        const expected = Buffer.concat([
            Buffer.from("chunk"),
            Buffer.from("chunk"),
            Buffer.from("chunk"),
        ]);

        expect(body.length).toBe(15);
        expect(body.equals(expected)).toBe(true);
    });

    it("returns 401 when not authenticated", async () => {
        (auth as jest.Mock).mockResolvedValue({ userId: null });

        const response = await GET(new Request("http://localhost/api/memos/memo-abc/download-chunks"), {
            params: Promise.resolve({ id: "memo-abc" }),
        });

        expect(response.status).toBe(401);
    });

    it("returns 404 when no chunks found", async () => {
        list.mockResolvedValue({ data: [], error: null });

        const response = await GET(new Request("http://localhost/api/memos/memo-abc/download-chunks"), {
            params: Promise.resolve({ id: "memo-abc" }),
        });

        expect(response.status).toBe(404);
    });
});
