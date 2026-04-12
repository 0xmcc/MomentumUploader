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

describe("POST /api/memo-agent/:memoId/chat", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(crypto, "randomUUID").mockReturnValue("uuid-1");
    (resolveMemoUserId as jest.Mock).mockResolvedValue("viewer-1");
    (isValidShareToken as jest.Mock).mockReturnValue(true);
    (resolveMemoShare as jest.Mock).mockResolvedValue({
      status: "ok",
      memo: { memoId: "memo-1" },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("queues a memo_agent_chat job for the viewer session", async () => {
    const sessionSingle = jest.fn().mockResolvedValue({
      data: { id: "session-1" },
      error: null,
    });
    const sessionMemoEq = jest.fn(() => ({ single: sessionSingle }));
    const sessionUserEq = jest.fn(() => ({ eq: sessionMemoEq }));
    const sessionIdEq = jest.fn(() => ({ eq: sessionUserEq }));
    const sessionSelect = jest.fn(() => ({ eq: sessionIdEq }));

    const creditsMaybeSingle = jest.fn().mockResolvedValue({
      data: { balance: 42 },
      error: null,
    });
    const creditsEq = jest.fn(() => ({ maybeSingle: creditsMaybeSingle }));
    const creditsSelect = jest.fn(() => ({ eq: creditsEq }));

    const jobSingle = jest.fn().mockResolvedValue({
      data: { id: 123 },
      error: null,
    });
    const jobSelect = jest.fn(() => ({ single: jobSingle }));
    const insert = jest.fn(() => ({ select: jobSelect }));

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === "memo_agent_sessions") {
        return { select: sessionSelect };
      }
      if (table === "user_credits") {
        return { select: creditsSelect };
      }
      if (table === "job_runs") {
        return { insert };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const response = await POST(
      makeRequest({
        sessionId: "session-1",
        message: "What are the action items?",
        shareToken: "sharetoken1234",
      }),
      { params: Promise.resolve({ memoId: "memo-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(insert).toHaveBeenCalledWith({
      user_id: "viewer-1",
      job_type: "memo_agent_chat",
      entity_type: "memo_agent_session",
      entity_id: "session-1",
      status: "pending",
      params: {
        user_message: "What are the action items?",
        channel_name: "memo-agent:job:uuid-1",
        memo_id: "memo-1",
      },
    });
    expect(body).toEqual({
      jobId: 123,
      channelName: "memo-agent:job:uuid-1",
    });
  });

  it("returns 402 when the viewer has insufficient credits", async () => {
    const sessionSingle = jest.fn().mockResolvedValue({
      data: { id: "session-1" },
      error: null,
    });
    const sessionMemoEq = jest.fn(() => ({ single: sessionSingle }));
    const sessionUserEq = jest.fn(() => ({ eq: sessionMemoEq }));
    const sessionIdEq = jest.fn(() => ({ eq: sessionUserEq }));
    const sessionSelect = jest.fn(() => ({ eq: sessionIdEq }));

    const creditsMaybeSingle = jest.fn().mockResolvedValue({
      data: { balance: 0.5 },
      error: null,
    });
    const creditsEq = jest.fn(() => ({ maybeSingle: creditsMaybeSingle }));
    const creditsSelect = jest.fn(() => ({ eq: creditsEq }));

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === "memo_agent_sessions") {
        return { select: sessionSelect };
      }
      if (table === "user_credits") {
        return { select: creditsSelect };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const response = await POST(
      makeRequest({
        sessionId: "session-1",
        message: "What are the action items?",
        shareToken: "sharetoken1234",
      }),
      { params: Promise.resolve({ memoId: "memo-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(402);
    expect(body).toEqual({ error: "insufficient_credits" });
  });

  it("returns 409 when another active job already exists for the session", async () => {
    const sessionSingle = jest.fn().mockResolvedValue({
      data: { id: "session-1" },
      error: null,
    });
    const sessionMemoEq = jest.fn(() => ({ single: sessionSingle }));
    const sessionUserEq = jest.fn(() => ({ eq: sessionMemoEq }));
    const sessionIdEq = jest.fn(() => ({ eq: sessionUserEq }));
    const sessionSelect = jest.fn(() => ({ eq: sessionIdEq }));

    const creditsMaybeSingle = jest.fn().mockResolvedValue({
      data: { balance: 5 },
      error: null,
    });
    const creditsEq = jest.fn(() => ({ maybeSingle: creditsMaybeSingle }));
    const creditsSelect = jest.fn(() => ({ eq: creditsEq }));

    const jobSingle = jest.fn().mockResolvedValue({
      data: null,
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });
    const jobSelect = jest.fn(() => ({ single: jobSingle }));
    const insert = jest.fn(() => ({ select: jobSelect }));

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === "memo_agent_sessions") {
        return { select: sessionSelect };
      }
      if (table === "user_credits") {
        return { select: creditsSelect };
      }
      if (table === "job_runs") {
        return { insert };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const response = await POST(
      makeRequest({
        sessionId: "session-1",
        message: "What are the action items?",
        shareToken: "sharetoken1234",
      }),
      { params: Promise.resolve({ memoId: "memo-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: "job_in_progress" });
  });

  it("returns 404 when the session belongs to a different memo", async () => {
    const sessionSingle = jest.fn().mockResolvedValue({
      data: null,
      error: { message: "Row not found" },
    });
    const sessionMemoEq = jest.fn(() => ({ single: sessionSingle }));
    const sessionUserEq = jest.fn(() => ({ eq: sessionMemoEq }));
    const sessionIdEq = jest.fn(() => ({ eq: sessionUserEq }));
    const sessionSelect = jest.fn(() => ({ eq: sessionIdEq }));

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === "memo_agent_sessions") {
        return { select: sessionSelect };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const response = await POST(
      makeRequest({
        sessionId: "session-1",
        message: "What are the action items?",
        shareToken: "sharetoken1234",
      }),
      { params: Promise.resolve({ memoId: "memo-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(sessionMemoEq).toHaveBeenCalledWith("memo_id", "memo-1");
    expect(body).toEqual({ error: "Not found." });
  });
});
