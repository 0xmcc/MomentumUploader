/** @jest-environment node */

import { auth } from "@clerk/nextjs/server";
import { POST } from "./route";
import { supabaseAdmin } from "@/lib/supabase";
import { LIVE_MEMO_TITLE } from "@/lib/live-memo";
import { issueApiToken } from "@/lib/api-token";
import { NextRequest } from "next/server";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/supabase");

function liveRequest(token?: string) {
  return new NextRequest("https://voice-memos.test/api/memos/live", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

describe("POST /api/memos/live", () => {
  const originalSecret = process.env.MEMOS_API_TOKEN_SECRET;

  beforeAll(() => {
    process.env.MEMOS_API_TOKEN_SECRET = "test-secret";
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.MEMOS_API_TOKEN_SECRET;
    else process.env.MEMOS_API_TOKEN_SECRET = originalSecret;
  });

  it("creates a memo for a device holding a valid token and no browser session", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });
    const single = jest.fn().mockResolvedValue({ data: { id: "memo-phone" }, error: null });
    const insert = jest.fn(() => ({ select: jest.fn(() => ({ single })) }));
    (supabaseAdmin.from as jest.Mock).mockReturnValue({ insert });

    const { token } = issueApiToken({ userId: "user_phone" });
    const res = await POST(liveRequest(token));

    expect(res.status).toBe(201);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "user_phone" }));
  });

  it("refuses a tampered or expired device token", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });
    const { token } = issueApiToken({ userId: "user_phone" });
    const expired = issueApiToken({ userId: "user_phone", ttlSeconds: 1, nowMs: Date.now() - 60_000 });

    expect((await POST(liveRequest(`${token}x`))).status).toBe(401);
    expect((await POST(liveRequest(expired.token))).status).toBe(401);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 when user is not authenticated", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });

    const res = await POST(liveRequest());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("creates an in-progress memo for the authenticated user", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user_live" });

    const single = jest.fn().mockResolvedValue({
      data: { id: "memo-live-1" },
      error: null,
    });
    const select = jest.fn(() => ({ single }));
    const insert = jest.fn(() => ({ select }));
    (supabaseAdmin.from as jest.Mock).mockReturnValue({ insert });

    const res = await POST(liveRequest());
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.memoId).toBe("memo-live-1");
    expect(supabaseAdmin.from).toHaveBeenCalledWith("memos");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        title: LIVE_MEMO_TITLE,
        transcript: "",
        audio_url: "",
        user_id: "user_live",
      })
    );
  });

  it("retries without transcript_status when the active schema does not have that column", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user_live" });

    const legacySingle = jest.fn().mockResolvedValue({
      data: { id: "memo-live-legacy" },
      error: null,
    });
    const legacySelect = jest.fn(() => ({ single: legacySingle }));
    const legacyInsert = jest.fn(() => ({ select: legacySelect }));

    const statusSingle = jest.fn().mockResolvedValue({
      data: null,
      error: {
        code: "PGRST204",
        message: "Could not find the 'transcript_status' column of 'memos' in the schema cache",
      },
    });
    const statusSelect = jest.fn(() => ({ single: statusSingle }));
    const statusInsert = jest.fn(() => ({ select: statusSelect }));

    let fromCallCount = 0;
    (supabaseAdmin.from as jest.Mock).mockImplementation(() => {
      fromCallCount += 1;
      return fromCallCount === 1
        ? { insert: statusInsert }
        : { insert: legacyInsert };
    });

    const res = await POST(liveRequest());
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.memoId).toBe("memo-live-legacy");
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2);
    expect(statusInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        title: LIVE_MEMO_TITLE,
        transcript_status: "processing",
      })
    );
    expect(legacyInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        title: LIVE_MEMO_TITLE,
        transcript: "",
        audio_url: "",
        user_id: "user_live",
      })
    );
    expect(legacyInsert).not.toHaveBeenCalledWith(
      expect.objectContaining({
        transcript_status: "processing",
      })
    );
  });
});
