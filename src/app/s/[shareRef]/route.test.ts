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
    user_id?: string | null;
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
    // Memos chain: .select().eq().maybeSingle()
    const maybeSingle = jest.fn().mockResolvedValue(result);
    const memoEq = jest.fn(() => ({ maybeSingle }));
    const memoSelect = jest.fn(() => ({ eq: memoEq }));

    // Segment chain: .select().eq().eq().order() → resolves to empty segments (no anchors for test memos)
    const segmentOrder = jest.fn(() => Promise.resolve({ data: [], error: null }));
    const segmentEq2 = jest.fn(() => ({ order: segmentOrder }));
    const segmentEq1 = jest.fn(() => ({ eq: segmentEq2 }));
    const segmentSelect = jest.fn(() => ({ eq: segmentEq1 }));

    // Artifact chain: .select().eq().eq().eq() → resolves to no ready artifacts by default
    const artifactEqStatus = jest.fn().mockResolvedValue({ data: [], error: null });
    const artifactEqSource = jest.fn(() => ({ eq: artifactEqStatus }));
    const artifactEqMemo = jest.fn(() => ({ eq: artifactEqSource }));
    const artifactSelect = jest.fn(() => ({ eq: artifactEqMemo }));

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === "memo_transcript_segments") return { select: segmentSelect };
        if (table === "memo_artifacts") return { select: artifactSelect };
        return { select: memoSelect };
    });
}

const activeMemo: SharedMemoRow = {
    id: "memo-1",
    user_id: "user-owner-1",
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

    it("falls back when expires_at is missing from the active memo schema", async () => {
        const legacyMemoSelect = jest.fn(() => ({
            eq: jest.fn(() => ({
                maybeSingle: jest.fn().mockResolvedValue({ data: activeMemo, error: null }),
            })),
        }));

        const legacySegmentSelect = jest.fn(() => ({
            eq: jest.fn(() => ({
                eq: jest.fn(() => ({
                    order: jest.fn().mockResolvedValue({ data: [], error: null }),
                })),
            })),
        }));
        const legacyArtifactSelect = jest.fn(() => ({
            eq: jest.fn(() => ({
                eq: jest.fn(() => ({
                    eq: jest.fn().mockResolvedValue({ data: [], error: null }),
                })),
            })),
        }));

        let memoSelectCallCount = 0;
        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "memo_transcript_segments") {
                return { select: legacySegmentSelect };
            }
            if (table === "memo_artifacts") {
                return { select: legacyArtifactSelect };
            }

            return {
                select: jest.fn(() => {
                    memoSelectCallCount += 1;
                    if (memoSelectCallCount === 1) {
                        return {
                            eq: jest.fn(() => ({
                                maybeSingle: jest.fn().mockResolvedValue({
                                    data: null,
                                    error: {
                                        code: "42703",
                                        message: 'column "expires_at" does not exist',
                                    },
                                }),
                            })),
                        };
                    }

                    return legacyMemoSelect();
                }),
            };
        });

        const res = await GET(
            makeReq("https://example.com/s/token123"),
            { params: Promise.resolve({ shareRef: "token123" }) }
        );

        const body = await res.text();
        expect(res.status).toBe(200);
        expect(body).toContain("<h1>Weekly Sync</h1>");
        expect(supabaseAdmin.from).toHaveBeenCalledWith("memos");
        expect(memoSelectCallCount).toBe(2);
    });

    it("serves shares from minimal memo schemas without optional share columns", async () => {
        const minimalMemo = {
            id: "memo-legacy",
            title: "Legacy Share",
            transcript: "This memo came from an older schema.",
            audio_url: "https://example.com/legacy.webm",
            created_at: "2026-02-21T18:00:00.000Z",
            share_token: "token123",
        };

        const segmentSelect = jest.fn(() => ({
            eq: jest.fn(() => ({
                eq: jest.fn(() => ({
                    order: jest.fn().mockResolvedValue({ data: [], error: null }),
                })),
            })),
        }));
        const artifactSelect = jest.fn(() => ({
            eq: jest.fn(() => ({
                eq: jest.fn(() => ({
                    eq: jest.fn().mockResolvedValue({ data: [], error: null }),
                })),
            })),
        }));

        const memoSelect = jest.fn((columns: string) => ({
            eq: jest.fn(() => ({
                maybeSingle: jest.fn().mockResolvedValue(
                    columns === "*"
                        ? { data: minimalMemo, error: null }
                        : {
                              data: null,
                              error: {
                                  code: "42703",
                                  message: 'column "shared_at" does not exist',
                              },
                          }
                ),
            })),
        }));

        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "memo_transcript_segments") {
                return { select: segmentSelect };
            }
            if (table === "memo_artifacts") {
                return { select: artifactSelect };
            }

            return { select: memoSelect };
        });

        const res = await GET(
            makeReq("https://example.com/s/token123"),
            { params: Promise.resolve({ shareRef: "token123" }) }
        );

        const body = await res.text();
        expect(res.status).toBe(200);
        expect(body).toContain("<h1>Legacy Share</h1>");
        expect(body).toContain("This memo came from an older schema.");
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
        expect(body).toContain("Share");
    });

    it("renders transcript-only live refresh behavior for in-progress shares", async () => {
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
        expect(body).not.toContain('http-equiv="refresh"');
        expect(body).toContain("Live recording in progress.");
        expect(body).toContain("setInterval");
        expect(body).toContain(".json");
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
