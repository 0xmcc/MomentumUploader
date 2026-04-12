/** @jest-environment node */

import { NextRequest } from "next/server";
import { POST } from "./route";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { resolveMemoShare } from "@/lib/memo-share";
import { isValidShareToken } from "@/lib/share-access";
import { supabaseAdmin } from "@/lib/supabase";

jest.mock("@/lib/memo-api-auth", () => ({
  resolveMemoUserId: jest.fn(),
}));

jest.mock("@/lib/memo-share", () => ({
  resolveMemoShare: jest.fn(),
}));

jest.mock("@/lib/share-access", () => ({
  isValidShareToken: jest.fn(),
}));

jest.mock("@/lib/supabase");

function makeRequest(body: Record<string, unknown>) {
  return {
    json: jest.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

describe("POST /api/memo-agent/:memoId/session", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (resolveMemoUserId as jest.Mock).mockResolvedValue("viewer-1");
    (isValidShareToken as jest.Mock).mockReturnValue(true);
    (resolveMemoShare as jest.Mock).mockResolvedValue({
      status: "ok",
      memo: { memoId: "memo-1" },
    });
  });

  it("creates or resumes the viewer-scoped session and returns current credits", async () => {
    const single = jest.fn().mockResolvedValue({
      data: { id: "session-1", provider_session_id: "provider-session-1" },
      error: null,
    });
    const sessionSelect = jest.fn(() => ({ single }));
    const upsert = jest.fn(() => ({ select: sessionSelect }));

    const creditsMaybeSingle = jest.fn().mockResolvedValue({
      data: { balance: 73.5 },
      error: null,
    });
    const creditsEq = jest.fn(() => ({ maybeSingle: creditsMaybeSingle }));
    const creditsSelect = jest.fn(() => ({ eq: creditsEq }));

    (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({ data: null, error: null });
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === "memo_agent_sessions") {
        return { upsert };
      }
      if (table === "user_credits") {
        return { select: creditsSelect };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const response = await POST(makeRequest({ shareToken: "sharetoken1234" }), {
      params: Promise.resolve({ memoId: "memo-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "reset_monthly_credits_if_needed",
      { p_user_id: "viewer-1" }
    );
    expect(upsert).toHaveBeenCalledWith(
      { user_id: "viewer-1", memo_id: "memo-1" },
      { onConflict: "user_id,memo_id" }
    );
    expect(creditsEq).toHaveBeenCalledWith("user_id", "viewer-1");
    expect(body).toEqual({
      sessionId: "session-1",
      creditBalance: 73.5,
      hasHistory: true,
    });
  });

  it("returns 401 when the viewer is not authenticated", async () => {
    (resolveMemoUserId as jest.Mock).mockResolvedValue(null);

    const response = await POST(makeRequest({ shareToken: "sharetoken1234" }), {
      params: Promise.resolve({ memoId: "memo-1" }),
    });

    expect(response.status).toBe(401);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("returns 404 when the share token is invalid or does not match the memo", async () => {
    (isValidShareToken as jest.Mock).mockReturnValue(false);

    const response = await POST(makeRequest({ shareToken: "bad token" }), {
      params: Promise.resolve({ memoId: "memo-1" }),
    });

    expect(response.status).toBe(404);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });
});
