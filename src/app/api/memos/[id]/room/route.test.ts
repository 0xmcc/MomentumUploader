/** @jest-environment node */

import { NextRequest } from "next/server";
import { GET } from "./route";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { findMemoDiscussion } from "@/lib/memo-discussion";
import { supabaseAdmin } from "@/lib/supabase";

jest.mock("@/lib/memo-api-auth", () => ({
  resolveMemoUserId: jest.fn(),
}));

jest.mock("@/lib/memo-discussion", () => ({
  findMemoDiscussion: jest.fn(),
}));

jest.mock("@/lib/supabase");

describe("GET /api/memos/:id/room", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns null when the memo has no linked discussion", async () => {
    (resolveMemoUserId as jest.Mock).mockResolvedValue("user_owner");
    (findMemoDiscussion as jest.Mock).mockResolvedValue(null);

    const memoSingle = jest.fn().mockResolvedValue({
      data: { id: "memo-1" },
      error: null,
    });
    const memoUserEq = jest.fn(() => ({ single: memoSingle }));
    const memoIdEq = jest.fn(() => ({ eq: memoUserEq }));
    const memoSelect = jest.fn(() => ({ eq: memoIdEq }));

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === "memos") {
        return { select: memoSelect };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    const req = {} as NextRequest;

    const res = await GET(req, { params: Promise.resolve({ id: "memo-1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ room: null });
  });

  it("returns the linked discussion room for an owned memo", async () => {
    (resolveMemoUserId as jest.Mock).mockResolvedValue("user_owner");
    (findMemoDiscussion as jest.Mock).mockResolvedValue({
      roomId: "room-live",
      ownerParticipantId: null,
    });

    const memoSingle = jest.fn().mockResolvedValue({
      data: { id: "memo-1" },
      error: null,
    });
    const memoUserEq = jest.fn(() => ({ single: memoSingle }));
    const memoIdEq = jest.fn(() => ({ eq: memoUserEq }));
    const memoSelect = jest.fn(() => ({ eq: memoIdEq }));

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === "memos") {
        return { select: memoSelect };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    const req = {} as NextRequest;

    const res = await GET(req, { params: Promise.resolve({ id: "memo-1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ room: { roomId: "room-live" } });
  });

  it("returns a 500 error when discussion lookup throws", async () => {
    (resolveMemoUserId as jest.Mock).mockResolvedValue("user_owner");
    (findMemoDiscussion as jest.Mock).mockRejectedValue(
      new Error("Invariant violation: memo memo-1 has multiple linked rooms")
    );

    const memoSingle = jest.fn().mockResolvedValue({
      data: { id: "memo-1" },
      error: null,
    });
    const memoUserEq = jest.fn(() => ({ single: memoSingle }));
    const memoIdEq = jest.fn(() => ({ eq: memoUserEq }));
    const memoSelect = jest.fn(() => ({ eq: memoIdEq }));

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === "memos") {
        return { select: memoSelect };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    const req = {} as NextRequest;

    const res = await GET(req, { params: Promise.resolve({ id: "memo-1" }) });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: "Failed to load memo room." });
  });
});
