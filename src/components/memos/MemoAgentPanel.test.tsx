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

  it("shows fractional credit balances with up to four decimal places", async () => {
    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);

      if (url === "/api/memo-agent/memo-1/session") {
        return Promise.resolve(
          jsonResponse({
            sessionId: "session-1",
            creditBalance: 96.205,
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

      throw new Error(`Unexpected fetch ${url}`);
    });

    render(<MemoAgentPanel memoId="memo-1" shareToken="sharetoken1234" />);

    expect(await screen.findByText("96.205 credits")).toBeInTheDocument();
  });

  it("renders assistant history with markdown formatting instead of raw markdown tokens", async () => {
    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "/api/memo-agent/memo-1/session") {
        expect(init?.method).toBe("POST");
        return Promise.resolve(
          jsonResponse({
            sessionId: "session-1",
            creditBalance: 42,
            hasHistory: true,
          })
        );
      }

      if (
        url ===
        "/api/memo-agent/memo-1/history?sessionId=session-1&shareToken=sharetoken1234"
      ) {
        return Promise.resolve(
          jsonResponse({
            messages: [
              { role: "user", text: "What is this transcript about?" },
              {
                role: "assistant",
                text:
                  "This transcript appears to be a **conversation about wedding planning**.\n\n1. **Venues**\n2. **Catering**\n3. **Transportation**",
              },
            ],
            hasHistory: true,
          })
        );
      }

      throw new Error(`Unexpected fetch ${url}`);
    });

    const { container } = render(
      <MemoAgentPanel memoId="memo-1" shareToken="sharetoken1234" />
    );

    expect(await screen.findByText("conversation about wedding planning")).toBeInTheDocument();
    expect(container.querySelector("strong")).toHaveTextContent(
      "conversation about wedding planning"
    );
    expect(screen.getByRole("list")).toHaveTextContent("Venues");
    expect(screen.getByRole("list")).toHaveTextContent("Catering");
    expect(screen.getByRole("list")).toHaveTextContent("Transportation");
    expect(container).not.toHaveTextContent("**conversation about wedding planning**");
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

  it("reloads persisted history when a job finishes without streaming assistant text", async () => {
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

    let historyRequests = 0;
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
        historyRequests += 1;
        if (historyRequests === 1) {
          return Promise.resolve(jsonResponse({ messages: [], hasHistory: false }));
        }

        return Promise.resolve(
          jsonResponse({
            messages: [
              { role: "user", text: "What is this transcript about?" },
              {
                role: "assistant",
                text: "This memo is about wedding planning research and venue requirements.",
              },
            ],
            hasHistory: true,
          })
        );
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
    await userEvent.type(textarea, "What is this transcript about?");
    await userEvent.keyboard("{Enter}");

    await waitFor(() => {
      expect(channel.on).toHaveBeenCalled();
    });

    await act(async () => {
      broadcastHandler?.({
        payload: { type: "tool_start", toolName: "Read" },
      });
      broadcastHandler?.({
        payload: { type: "tool_result", toolName: "Read", isError: false },
      });
      broadcastHandler?.({
        payload: { type: "done", creditCost: 1 },
      });
    });

    expect(
      await screen.findByText(
        "This memo is about wedding planning research and venue requirements."
      )
    ).toBeInTheDocument();
    expect(historyRequests).toBe(2);
    expect(screen.getByText("9 credits")).toBeInTheDocument();
  });
});
