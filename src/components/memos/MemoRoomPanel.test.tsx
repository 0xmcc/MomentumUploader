import React from "react";
import { render, waitFor } from "@testing-library/react";
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

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
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
});
