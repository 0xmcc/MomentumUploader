import { act, renderHook, waitFor } from "@testing-library/react";
import { useMemosWorkspace } from "./useMemosWorkspace";
import { MEMO_RECONCILE_DELAY_MS } from "@/lib/memo-ui";

describe("useMemosWorkspace", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("keeps selected memo visible during optimistic-to-persisted reconciliation when refresh is stale", async () => {
    const transcriptText = "alpha beta gamma delta epsilon zeta eta theta";
    let memosSequence: Array<{ memos: Array<Record<string, unknown>> }> = [
      { memos: [] },
      { memos: [] },
    ];

    const mockFetch = jest.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
            ? input.toString()
            : input.url;

        if (url === "/api/memos") {
          const next = memosSequence.shift() ?? { memos: [] };
          return {
            ok: true,
            json: async () => next,
          };
        }

        if (url === "/api/transcribe" && init?.method === "POST") {
          return {
            ok: true,
            json: async () => ({
              id: "real-uuid-123",
              success: true,
              text: transcriptText,
              url: "http://x/a.webm",
              modelUsed: "nvidia/parakeet-rnnt-1.1b",
            }),
          };
        }

        throw new Error(`Unexpected fetch call: ${url}`);
      }
    );
    Object.defineProperty(global, "fetch", { writable: true, value: mockFetch });

    const { result } = renderHook(() =>
      useMemosWorkspace({
        isLoaded: true,
        isSignedIn: true,
        openSignIn: jest.fn(),
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.handleRecordingStop({
        blob: new Blob(["fake audio"], { type: "audio/webm" }),
        durationSeconds: 3,
        mimeType: "audio/webm",
      });
    });

    await waitFor(() => {
      expect(result.current.selectedMemo?.transcript).toBe(transcriptText);
    });

    await act(async () => {
      jest.advanceTimersByTime(MEMO_RECONCILE_DELAY_MS);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.selectedMemo?.transcript).toBe(transcriptText);
    });
  });

  it("prompts sign-in on recording stop when signed out", async () => {
    const openSignIn = jest.fn();
    const mockFetch = jest.fn(
      async (input: RequestInfo | URL) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
            ? input.toString()
            : input.url;

        if (url === "/api/memos") {
          return {
            ok: true,
            json: async () => ({ memos: [] }),
          };
        }

        if (url === "/api/transcribe") {
          throw new Error("Should not upload while signed out");
        }

        throw new Error(`Unexpected fetch call: ${url}`);
      }
    );
    Object.defineProperty(global, "fetch", { writable: true, value: mockFetch });

    const { result } = renderHook(() =>
      useMemosWorkspace({
        isLoaded: true,
        isSignedIn: false,
        openSignIn,
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.handleRecordingStop({
        blob: new Blob(["fake audio"], { type: "audio/webm" }),
        durationSeconds: 5,
        mimeType: "audio/webm",
      });
    });

    expect(openSignIn).toHaveBeenCalledTimes(1);
  });
});
