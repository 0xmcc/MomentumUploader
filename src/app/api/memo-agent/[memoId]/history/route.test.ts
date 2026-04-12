/** @jest-environment node */

import { GET } from "./route";
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

describe("GET /api/memo-agent/:memoId/history", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (resolveMemoUserId as jest.Mock).mockResolvedValue("viewer-1");
    (isValidShareToken as jest.Mock).mockReturnValue(true);
    (resolveMemoShare as jest.Mock).mockResolvedValue({
      status: "ok",
      memo: { memoId: "memo-1" },
    });
  });

  it("returns persisted UI messages for the viewer session", async () => {
    const single = jest.fn().mockResolvedValue({
      data: {
        ui_messages: [
          { role: "user", text: "What are the action items?" },
          { role: "assistant", text: "Follow up with finance and product." },
        ],
        provider_session_id: "provider-session-1",
      },
      error: null,
    });
    const memoEq = jest.fn(() => ({ single }));
    const userEq = jest.fn(() => ({ eq: memoEq }));
    const idEq = jest.fn(() => ({ eq: userEq }));
    const select = jest.fn(() => ({ eq: idEq }));

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === "memo_agent_sessions") {
        return { select };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const request = new Request(
      "https://example.com/api/memo-agent/memo-1/history?sessionId=session-1&shareToken=sharetoken1234"
    );
    const response = await GET(request, {
      params: Promise.resolve({ memoId: "memo-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(idEq).toHaveBeenCalledWith("id", "session-1");
    expect(userEq).toHaveBeenCalledWith("user_id", "viewer-1");
    expect(memoEq).toHaveBeenCalledWith("memo_id", "memo-1");
    expect(body).toEqual({
      messages: [
        { role: "user", text: "What are the action items?" },
        { role: "assistant", text: "Follow up with finance and product." },
      ],
      hasHistory: true,
    });
  });

  it("returns 401 when the viewer is not authenticated", async () => {
    (resolveMemoUserId as jest.Mock).mockResolvedValue(null);

    const request = new Request(
      "https://example.com/api/memo-agent/memo-1/history?sessionId=session-1&shareToken=sharetoken1234"
    );
    const response = await GET(request, {
      params: Promise.resolve({ memoId: "memo-1" }),
    });

    expect(response.status).toBe(401);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });
});
