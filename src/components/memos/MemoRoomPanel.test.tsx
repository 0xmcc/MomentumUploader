import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoRoomPanel } from "./MemoRoomPanel";
import type { Memo } from "@/lib/memo-ui";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

const memo: Memo = {
  id: "memo-1",
  title: "Memo Room Test",
  transcript: "Transcript",
  createdAt: "2026-03-16T10:00:00.000Z",
  wordCount: 1,
};

describe("MemoRoomPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    Object.defineProperty(global, "fetch", {
      writable: true,
      value: jest.fn(),
    });
  });

  it("does not create the same memo room more than once during repeated bootstrap on mount", async () => {
    const pendingCreateRoom = deferred<Response>();

    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "/api/memos/memo-1/room") {
        return Promise.resolve(jsonResponse({ room: null }));
      }

      if (url === "/api/memo-rooms" && init?.method === "POST") {
        return pendingCreateRoom.promise;
      }

      throw new Error(`Unexpected fetch ${url}`);
    });

    render(
      <React.StrictMode>
        <MemoRoomPanel
          memo={memo}
          selectedAnchorSegments={[]}
          onClearSelectedAnchors={() => {}}
        />
      </React.StrictMode>
    );

    await waitFor(() => {
      const postCalls = (global.fetch as jest.Mock).mock.calls.filter(
        ([url, init]) => url === "/api/memo-rooms" && init?.method === "POST"
      );

      expect(postCalls).toHaveLength(1);
    });
  });

  it("does not create a room when room lookup fails with a server error", async () => {
    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "/api/memos/memo-1/room") {
        return Promise.resolve(jsonResponse({ error: "Failed to load memo room." }, false));
      }

      if (url === "/api/memo-rooms" && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ room: { id: "room-new" } }));
      }

      if (url === "/api/memo-rooms/room-new/context") {
        return Promise.resolve(
          jsonResponse({
            room: {
              id: "room-new",
              title: "Memo Room Test",
              description: null,
              participants: [
                {
                  id: "participant-owner",
                  participantType: "human",
                  userId: "user-owner",
                  agentId: null,
                  role: "owner",
                  capability: "full_participation",
                  defaultVisibility: "public",
                  status: "active",
                },
              ],
            },
            viewerParticipant: {
              id: "participant-owner",
              participantType: "human",
              userId: "user-owner",
              agentId: null,
              role: "owner",
              capability: "full_participation",
              defaultVisibility: "public",
              status: "active",
            },
          })
        );
      }

      if (url === "/api/memo-rooms/room-new/messages") {
        return Promise.resolve(jsonResponse({ messages: [] }));
      }

      if (url === "/api/agents") {
        return Promise.resolve(jsonResponse({ agents: [] }));
      }

      throw new Error(`Unexpected fetch ${url}`);
    });

    render(
      <MemoRoomPanel
        memo={memo}
        selectedAnchorSegments={[]}
        onClearSelectedAnchors={() => {}}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Failed to load memo room.")).toBeInTheDocument();
    });

    const postCalls = (global.fetch as jest.Mock).mock.calls.filter(
      ([url, init]) => url === "/api/memo-rooms" && init?.method === "POST"
    );
    expect(postCalls).toHaveLength(0);
  });
});
