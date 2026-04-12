import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MemoAgentPanel from "./MemoAgentPanel";
import { supabase } from "@/lib/supabase";

jest.mock("@/lib/supabase", () => ({
  supabase: {
    channel: jest.fn(),
    removeChannel: jest.fn(),
  },
}));

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe("MemoAgentPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    Object.defineProperty(global, "fetch", {
      writable: true,
      value: jest.fn(),
    });
  });

  it("bootstraps the viewer session and loads persisted history", async () => {
    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "/api/memo-agent/memo-1/session") {
        expect(init?.method).toBe("POST");
        expect(init?.body).toBe(JSON.stringify({ shareToken: "share/abc+123" }));
        return Promise.resolve(
          jsonResponse({
            sessionId: "session-1",
            creditBalance: 87,
            hasHistory: true,
          })
        );
      }

      if (
        url ===
        "/api/memo-agent/memo-1/history?sessionId=session-1&shareToken=share%2Fabc%2B123"
      ) {
        return Promise.resolve(
          jsonResponse({
            messages: [
              { role: "user", text: "What are the action items?" },
              { role: "assistant", text: "Follow up with finance and product." },
            ],
            hasHistory: true,
          })
        );
      }

      throw new Error(`Unexpected fetch ${url}`);
    });

    render(<MemoAgentPanel memoId="memo-1" shareToken="share/abc+123" />);

    expect(await screen.findByText("Follow up with finance and product.")).toBeInTheDocument();
    expect(screen.getByText("87 credits")).toBeInTheDocument();
    expect(screen.getByDisplayValue("")).toBeInTheDocument();
  });

  it("streams a new assistant turn over Supabase broadcast and updates the credit balance", async () => {
    let broadcastHandler: ((payload: { payload: unknown }) => void) | null = null;
    const channel = {
      on: jest.fn((_type: string, _filter: unknown, callback: (payload: { payload: unknown }) => void) => {
        broadcastHandler = callback;
        return channel;
      }),
      subscribe: jest.fn((callback?: () => void) => {
        callback?.();
        return channel;
      }),
    };
    (supabase.channel as jest.Mock).mockReturnValue(channel);

    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "/api/memo-agent/memo-1/session") {
        return Promise.resolve(
          jsonResponse({
            sessionId: "session-1",
            creditBalance: 10,
            hasHistory: false,
          })
        );
      }

      if (
        url ===
        "/api/memo-agent/memo-1/history?sessionId=session-1&shareToken=sharetoken1234"
      ) {
        return Promise.resolve(jsonResponse({ messages: [], hasHistory: false }));
      }

      if (url === "/api/memo-agent/memo-1/chat") {
        expect(init?.method).toBe("POST");
        expect(init?.body).toBe(
          JSON.stringify({
            sessionId: "session-1",
            message: "What are the action items?",
            shareToken: "sharetoken1234",
          })
        );

        return Promise.resolve(
          jsonResponse({
            jobId: 123,
            channelName: "memo-agent:job:uuid-1",
          })
        );
      }

      throw new Error(`Unexpected fetch ${url}`);
    });

    render(<MemoAgentPanel memoId="memo-1" shareToken="sharetoken1234" />);

    await screen.findByText("10 credits");

    const textarea = screen.getByPlaceholderText("Ask this memo anything...");
    await userEvent.type(textarea, "What are the action items?");
    await userEvent.keyboard("{Enter}");

    await waitFor(() => {
      expect(channel.on).toHaveBeenCalled();
    });
    expect(textarea).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();

    await act(async () => {
      broadcastHandler?.({
        payload: { type: "text_delta", delta: "Follow up with finance." },
      });
      broadcastHandler?.({
        payload: { type: "text_delta", delta: " Confirm launch plan." },
      });
      broadcastHandler?.({
        payload: { type: "done", creditCost: 1.5 },
      });
    });

    expect(await screen.findByText("Follow up with finance. Confirm launch plan.")).toBeInTheDocument();
    expect(screen.getByText("8.5 credits")).toBeInTheDocument();
    expect(supabase.removeChannel).toHaveBeenCalledWith(channel);
    expect(screen.getByPlaceholderText("Ask this memo anything...")).not.toBeDisabled();
  });

  it("keeps tool status separate from the streamed assistant reply", async () => {
    let broadcastHandler: ((payload: { payload: unknown }) => void) | null = null;
    const channel = {
      on: jest.fn((_type: string, _filter: unknown, callback: (payload: { payload: unknown }) => void) => {
        broadcastHandler = callback;
        return channel;
      }),
      subscribe: jest.fn((callback?: () => void) => {
        callback?.();
        return channel;
      }),
    };
    (supabase.channel as jest.Mock).mockReturnValue(channel);

    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);

      if (url === "/api/memo-agent/memo-1/session") {
        return Promise.resolve(
          jsonResponse({
            sessionId: "session-1",
            creditBalance: 10,
            hasHistory: false,
          })
        );
      }

      if (
        url ===
        "/api/memo-agent/memo-1/history?sessionId=session-1&shareToken=sharetoken1234"
      ) {
        return Promise.resolve(jsonResponse({ messages: [], hasHistory: false }));
      }

      if (url === "/api/memo-agent/memo-1/chat") {
        return Promise.resolve(
          jsonResponse({
            jobId: 123,
            channelName: "memo-agent:job:uuid-1",
          })
        );
      }

      throw new Error(`Unexpected fetch ${url}`);
    });

    render(<MemoAgentPanel memoId="memo-1" shareToken="sharetoken1234" />);

    await screen.findByText("10 credits");

    const textarea = screen.getByPlaceholderText("Ask this memo anything...");
    await userEvent.type(textarea, "Summarize the memo");
    await userEvent.keyboard("{Enter}");

    await waitFor(() => {
      expect(channel.on).toHaveBeenCalled();
    });

    await act(async () => {
      broadcastHandler?.({
        payload: { type: "text_delta", delta: "Action items: " },
      });
      broadcastHandler?.({
        payload: { type: "tool_start", toolName: "Read" },
      });
      broadcastHandler?.({
        payload: { type: "text_delta", delta: "follow up with finance." },
      });
      broadcastHandler?.({
        payload: { type: "done", creditCost: 1 },
      });
    });

    expect(await screen.findByText("Action items: follow up with finance.")).toBeInTheDocument();
    expect(screen.getByText("Using Read...")).toBeInTheDocument();
  });

  it("keeps the streamed assistant message node stable across text deltas", async () => {
    let broadcastHandler: ((payload: { payload: unknown }) => void) | null = null;
    const channel = {
      on: jest.fn((_type: string, _filter: unknown, callback: (payload: { payload: unknown }) => void) => {
        broadcastHandler = callback;
        return channel;
      }),
      subscribe: jest.fn((callback?: () => void) => {
        callback?.();
        return channel;
      }),
    };
    (supabase.channel as jest.Mock).mockReturnValue(channel);

    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);

      if (url === "/api/memo-agent/memo-1/session") {
        return Promise.resolve(
          jsonResponse({
            sessionId: "session-1",
            creditBalance: 10,
            hasHistory: false,
          })
        );
      }

      if (
        url ===
        "/api/memo-agent/memo-1/history?sessionId=session-1&shareToken=sharetoken1234"
      ) {
        return Promise.resolve(jsonResponse({ messages: [], hasHistory: false }));
      }

      if (url === "/api/memo-agent/memo-1/chat") {
        return Promise.resolve(
          jsonResponse({
            jobId: 123,
            channelName: "memo-agent:job:uuid-1",
          })
        );
      }

      throw new Error(`Unexpected fetch ${url}`);
    });

    render(<MemoAgentPanel memoId="memo-1" shareToken="sharetoken1234" />);

    await screen.findByText("10 credits");

    const textarea = screen.getByPlaceholderText("Ask this memo anything...");
    await userEvent.type(textarea, "Summarize the memo");
    await userEvent.keyboard("{Enter}");

    await waitFor(() => {
      expect(channel.on).toHaveBeenCalled();
    });

    await act(async () => {
      broadcastHandler?.({
        payload: { type: "text_delta", delta: "Action items" },
      });
    });

    const initialNode = await screen.findByText("Action items");

    await act(async () => {
      broadcastHandler?.({
        payload: { type: "text_delta", delta: " and decisions" },
      });
      broadcastHandler?.({
        payload: { type: "done", creditCost: 1 },
      });
    });

    const updatedNode = await screen.findByText("Action items and decisions");
    expect(updatedNode).toBe(initialNode);
  });
});
