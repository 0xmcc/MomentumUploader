/** @jest-environment node */

import { auth } from "@clerk/nextjs/server";
import { GET } from "./route";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveOwnerIdentity } from "@/lib/user-identity";
import { NextRequest } from "next/server";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/supabase");

jest.mock("@/lib/user-identity", () => ({
  resolveOwnerIdentity: jest.fn(),
}));

describe("GET /api/shared-memo-bookmarks", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns an empty bookmark list when signed out", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });

    const res = await GET({} as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ bookmarks: [] });
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("returns active bookmarked shared memos with public-safe creator metadata", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "viewer-1" });
    (resolveOwnerIdentity as jest.Mock).mockResolvedValue({
      displayName: "Taylor Jones",
      avatarUrl: "https://img.example.com/taylor.png",
    });

    const bookmarkOrder = jest.fn().mockResolvedValue({
      data: [
        {
          memo_id: "memo-1",
          created_at: "2026-04-11T11:00:00.000Z",
        },
      ],
      error: null,
    });
    const bookmarkUserEq = jest.fn(() => ({ order: bookmarkOrder }));
    const bookmarkSelect = jest.fn(() => ({ eq: bookmarkUserEq }));

    const memoIn = jest.fn().mockResolvedValue({
      data: [
        {
          id: "memo-1",
          user_id: "owner-1",
          title: "Shared design review",
          created_at: "2026-04-10T12:00:00.000Z",
          share_token: "sharetoken1234",
          shared_at: "2026-04-10T12:05:00.000Z",
          revoked_at: null,
          is_shareable: true,
          share_expires_at: null,
          expires_at: null,
        },
      ],
      error: null,
    });
    const memoSelect = jest.fn(() => ({ in: memoIn }));

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === "shared_memo_bookmarks") {
        return { select: bookmarkSelect };
      }

      if (table === "memos") {
        return { select: memoSelect };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    const res = await GET({} as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      bookmarks: [
        {
          memoId: "memo-1",
          shareToken: "sharetoken1234",
          title: "Shared design review",
          authorName: "Taylor Jones",
          authorAvatarUrl: "https://img.example.com/taylor.png",
          createdAt: "2026-04-10T12:00:00.000Z",
          bookmarkedAt: "2026-04-11T11:00:00.000Z",
        },
      ],
    });
    expect(body.bookmarks[0]).not.toHaveProperty("transcript");
    expect(body.bookmarks[0]).not.toHaveProperty("ownerUserId");
  });

  it("falls back to the anonymous public-share name when creator identity is unavailable", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "viewer-1" });
    (resolveOwnerIdentity as jest.Mock).mockResolvedValue(null);

    const bookmarkOrder = jest.fn().mockResolvedValue({
      data: [
        {
          memo_id: "memo-2",
          created_at: "2026-04-11T11:00:00.000Z",
        },
      ],
      error: null,
    });
    const bookmarkUserEq = jest.fn(() => ({ order: bookmarkOrder }));
    const bookmarkSelect = jest.fn(() => ({ eq: bookmarkUserEq }));

    const memoIn = jest.fn().mockResolvedValue({
      data: [
        {
          id: "memo-2",
          user_id: "owner-2",
          title: "Anonymous share",
          created_at: "2026-04-10T12:00:00.000Z",
          share_token: "sharetoken5678",
          shared_at: "2026-04-10T12:05:00.000Z",
          revoked_at: null,
          is_shareable: true,
          share_expires_at: null,
          expires_at: null,
        },
      ],
      error: null,
    });
    const memoSelect = jest.fn(() => ({ in: memoIn }));

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === "shared_memo_bookmarks") {
        return { select: bookmarkSelect };
      }

      if (table === "memos") {
        return { select: memoSelect };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    const res = await GET({} as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.bookmarks).toEqual([
      expect.objectContaining({
        authorName: "MomentumUploader User",
        authorAvatarUrl: null,
      }),
    ]);
  });
});
