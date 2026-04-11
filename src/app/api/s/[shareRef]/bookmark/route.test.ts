/** @jest-environment node */

import { auth } from "@clerk/nextjs/server";
import { DELETE, GET, POST } from "./route";
import { resolveSharedMemoForRoute } from "@/lib/share-route";
import { supabaseAdmin } from "@/lib/supabase";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/share-route", () => ({
  resolveSharedMemoForRoute: jest.fn(),
}));

jest.mock("@/lib/supabase");

const sharedMemo = {
  memoId: "memo-shared-1",
  ownerUserId: "owner-1",
  authorName: "Marko Ivanovic",
  authorAvatarUrl: "https://img.example.com/marko.png",
  shareToken: "sharetoken1234",
  title: "Shared planning memo",
  transcript: "Private transcript should not be returned here.",
  transcriptStatus: "complete",
  transcriptSegments: null,
  mediaUrl: "https://cdn.example.com/audio.webm",
  isLiveRecording: false,
  createdAt: "2026-04-10T10:00:00.000Z",
  sharedAt: "2026-04-10T10:05:00.000Z",
  expiresAt: null,
};

describe("shared memo bookmark route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (resolveSharedMemoForRoute as jest.Mock).mockResolvedValue({
      ok: true,
      memo: sharedMemo,
    });
  });

  it("returns signed-out bookmark state without touching Supabase", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });

    const res = await GET({} as Request, {
      params: Promise.resolve({ shareRef: "sharetoken1234" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      isAuthenticated: false,
      isBookmarked: false,
      bookmarkCount: 0,
    });
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("returns bookmarked state for the signed-in viewer", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "viewer-1" });

    const countEq = jest.fn().mockResolvedValue({
      count: 7,
      error: null,
    });
    const countSelect = jest.fn(() => ({ eq: countEq }));
    const maybeSingle = jest.fn().mockResolvedValue({
      data: { created_at: "2026-04-11T10:00:00.000Z" },
      error: null,
    });
    const memoEq = jest.fn(() => ({ maybeSingle }));
    const userEq = jest.fn(() => ({ eq: memoEq }));
    const select = jest
      .fn()
      .mockImplementation((columns?: string, options?: { count?: string; head?: boolean }) => {
        if (options?.count === "exact" && options?.head === true) {
          return { eq: countEq };
        }
        return { eq: userEq };
      });
    (supabaseAdmin.from as jest.Mock).mockReturnValue({ select });

    const res = await GET({} as Request, {
      params: Promise.resolve({ shareRef: "sharetoken1234" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      isAuthenticated: true,
      isBookmarked: true,
      bookmarkCount: 7,
    });
    expect(userEq).toHaveBeenCalledWith("user_id", "viewer-1");
    expect(memoEq).toHaveBeenCalledWith("memo_id", "memo-shared-1");
    expect(countEq).toHaveBeenCalledWith("memo_id", "memo-shared-1");
  });

  it("creates a bookmark and returns only public-safe share fields", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "viewer-1" });

    const single = jest.fn().mockResolvedValue({
      data: { created_at: "2026-04-11T10:00:00.000Z" },
      error: null,
    });
    const select = jest.fn(() => ({ single }));
    const upsert = jest.fn(() => ({ select }));
    (supabaseAdmin.from as jest.Mock).mockReturnValue({ upsert });

    const res = await POST({} as Request, {
      params: Promise.resolve({ shareRef: "sharetoken1234" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      {
        user_id: "viewer-1",
        memo_id: "memo-shared-1",
      },
      { onConflict: "user_id,memo_id" }
    );
    expect(body).toEqual({
      bookmark: {
        memoId: "memo-shared-1",
        shareToken: "sharetoken1234",
        title: "Shared planning memo",
        authorName: "Marko Ivanovic",
        authorAvatarUrl: "https://img.example.com/marko.png",
        createdAt: "2026-04-10T10:00:00.000Z",
        bookmarkedAt: "2026-04-11T10:00:00.000Z",
      },
    });
    expect(body.bookmark).not.toHaveProperty("transcript");
    expect(body.bookmark).not.toHaveProperty("mediaUrl");
  });

  it("deletes the viewer bookmark for that shared memo", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "viewer-1" });

    const deleteMaybeSingle = jest.fn().mockResolvedValue({
      data: { memo_id: "memo-shared-1" },
      error: null,
    });
    const select = jest.fn(() => ({ maybeSingle: deleteMaybeSingle }));
    const memoEq = jest.fn(() => ({ select }));
    const userEq = jest.fn(() => ({ eq: memoEq }));
    const remove = jest.fn(() => ({ eq: userEq }));
    (supabaseAdmin.from as jest.Mock).mockReturnValue({ delete: remove });

    const res = await DELETE({} as Request, {
      params: Promise.resolve({ shareRef: "sharetoken1234" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(userEq).toHaveBeenCalledWith("user_id", "viewer-1");
    expect(memoEq).toHaveBeenCalledWith("memo_id", "memo-shared-1");
  });

  it("treats deleting an already-removed bookmark as a success", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "viewer-1" });

    const deleteMaybeSingle = jest.fn().mockResolvedValue({
      data: null,
      error: null,
    });
    const select = jest.fn(() => ({ maybeSingle: deleteMaybeSingle }));
    const memoEq = jest.fn(() => ({ select }));
    const userEq = jest.fn(() => ({ eq: memoEq }));
    const remove = jest.fn(() => ({ eq: userEq }));
    (supabaseAdmin.from as jest.Mock).mockReturnValue({ delete: remove });

    const res = await DELETE({} as Request, {
      params: Promise.resolve({ shareRef: "sharetoken1234" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true });
  });
});
