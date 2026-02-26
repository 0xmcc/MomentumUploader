/** @jest-environment node */

import { DELETE, GET, PATCH, POST, PUT } from "./route";
import { supabaseAdmin } from "@/lib/supabase";
import { LIVE_MEMO_TITLE } from "@/lib/live-memo";

jest.mock("@/lib/supabase", () => ({
    supabaseAdmin: {
        from: jest.fn(),
    },
}));

type SharedMemoRow = {
    id: string;
    title: string | null;
    transcript: string | null;
    audio_url: string | null;
    created_at: string;
    share_token: string;
    shared_at: string | null;
    revoked_at: string | null;
    is_shareable: boolean;
    share_expires_at?: string | null;
    expires_at?: string | null;
};

function mockShareLookup(result: { data: SharedMemoRow | null; error: { message: string } | null }) {
    const maybeSingle = jest.fn().mockResolvedValue(result);
    const eq = jest.fn(() => ({ maybeSingle }));
    const select = jest.fn(() => ({ eq }));
    (supabaseAdmin.from as jest.Mock).mockReturnValue({ select });
}

const activeMemo: SharedMemoRow = {
    id: "memo-1",
    title: "Weekly Sync",
    transcript: "We shipped the new share links and added tests.",
    audio_url: "https://example.com/audio.webm",
    created_at: "2026-02-21T18:00:00.000Z",
    share_token: "token123",
    shared_at: "2026-02-21T18:01:00.000Z",
    revoked_at: null,
    is_shareable: true,
};

function makeReq(url: string): Request {
    return { url } as Request;
}

describe("share route /s/[shareRef]", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("serves html by default at the canonical share URL", async () => {
        mockShareLookup({ data: activeMemo, error: null });

        const res = await GET(
            makeReq("https://example.com/s/token123"),
            { params: Promise.resolve({ shareRef: "token123" }) }
        );

        const body = await res.text();
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("text/html");
        expect(body).toContain("<h1>Weekly Sync</h1>");
        expect(body).toContain("/s/token123");
        expect(body).toContain("Export transcript");
    });

    it("adds auto-refresh hints for live in-progress shares", async () => {
        mockShareLookup({
            data: {
                ...activeMemo,
                title: LIVE_MEMO_TITLE,
                audio_url: null,
            },
            error: null,
        });

        const res = await GET(
            makeReq("https://example.com/s/token123"),
            { params: Promise.resolve({ shareRef: "token123" }) }
        );

        const body = await res.text();
        expect(res.status).toBe(200);
        expect(body).toContain('http-equiv="refresh" content="3"');
        expect(body).toContain("Live recording in progress.");
    });

    it("serves markdown on deterministic .md path", async () => {
        mockShareLookup({ data: activeMemo, error: null });

        const res = await GET(
            makeReq("https://example.com/s/token123.md"),
            { params: Promise.resolve({ shareRef: "token123.md" }) }
        );

        const body = await res.text();
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("text/markdown");
        expect(body).toContain("canonical_url: https://example.com/s/token123");
        expect(body).toContain("## Transcript");
        expect(body).toContain("We shipped the new share links and added tests.");
    });

    it("serves json when format=json query is requested", async () => {
        mockShareLookup({ data: activeMemo, error: null });

        const res = await GET(
            makeReq("https://example.com/s/token123?format=json"),
            { params: Promise.resolve({ shareRef: "token123" }) }
        );

        const body = await res.json();
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("application/json");
        expect(body.artifact.id).toBe("memo-1");
        expect(body.artifact.type).toBe("memo");
        expect(body.artifact.canonicalUrl).toBe("https://example.com/s/token123");
        expect(body.artifact.transcript).toBe("We shipped the new share links and added tests.");
    });

    it("fails closed for revoked shares", async () => {
        mockShareLookup({
            data: {
                ...activeMemo,
                revoked_at: "2026-02-22T00:00:00.000Z",
            },
            error: null,
        });

        const res = await GET(
            makeReq("https://example.com/s/token123"),
            { params: Promise.resolve({ shareRef: "token123" }) }
        );

        const body = await res.text();
        expect(res.status).toBe(410);
        expect(body).toContain("This share link is no longer active.");
    });

    it("fails closed for expired shares", async () => {
        mockShareLookup({
            data: {
                ...activeMemo,
                share_expires_at: "2026-02-20T00:00:00.000Z",
            },
            error: null,
        });

        const res = await GET(
            makeReq("https://example.com/s/token123"),
            { params: Promise.resolve({ shareRef: "token123" }) }
        );

        const body = await res.text();
        expect(res.status).toBe(410);
        expect(body).toContain("This share link has expired.");
    });

    it("rejects mutation methods for non-owners on share routes", async () => {
        const postRes = await POST();
        const putRes = await PUT();
        const patchRes = await PATCH();
        const deleteRes = await DELETE();

        expect(postRes.status).toBe(405);
        expect(putRes.status).toBe(405);
        expect(patchRes.status).toBe(405);
        expect(deleteRes.status).toBe(405);
    });
});
