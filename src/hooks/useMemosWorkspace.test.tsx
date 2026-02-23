import { act, renderHook, waitFor } from "@testing-library/react";
import { useMemosWorkspace } from "./useMemosWorkspace";
import { MEMO_RECONCILE_DELAY_MS } from "@/lib/memo-ui";

describe("useMemosWorkspace", () => {
  const originalXmlHttpRequest = global.XMLHttpRequest;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    Object.defineProperty(global, "XMLHttpRequest", {
      configurable: true,
      writable: true,
      value: undefined,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    Object.defineProperty(global, "XMLHttpRequest", {
      configurable: true,
      writable: true,
      value: originalXmlHttpRequest,
    });
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
      result.current.handleAudioInput({
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

  it("prompts sign-in when audio input is provided while signed out", async () => {
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
      result.current.handleAudioInput({
        blob: new Blob(["fake audio"], { type: "audio/webm" }),
        durationSeconds: 5,
        mimeType: "audio/webm",
      });
    });

    expect(openSignIn).toHaveBeenCalledTimes(1);
  });

  it("surfaces upload-in-progress state and still allows selecting existing memos", async () => {
    const transcriptText = "transcribed upload";
    let resolveTranscribe: (() => void) | null = null;
    const transcribePending = new Promise<void>((resolve) => {
      resolveTranscribe = resolve;
    });

    const mockFetch = jest.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
            ? input.toString()
            : input.url;

        if (url === "/api/memos") {
          return {
            ok: true,
            json: async () => ({
              memos: [
                {
                  id: "existing-1",
                  transcript: "existing transcript",
                  createdAt: "2026-02-23T00:00:00.000Z",
                  url: "http://x/existing.webm",
                  success: true,
                },
              ],
            }),
          };
        }

        if (url === "/api/transcribe" && init?.method === "POST") {
          await transcribePending;
          return {
            ok: true,
            json: async () => ({
              id: "new-1",
              success: true,
              text: transcriptText,
              url: "http://x/new.webm",
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
      result.current.handleAudioInput({
        blob: new Blob(["fake audio"], { type: "audio/webm" }),
        durationSeconds: 3,
        mimeType: "audio/webm",
      });
    });

    await waitFor(() => {
      expect(result.current.isUploading).toBe(true);
    });

    act(() => {
      result.current.setSelectedMemoId("existing-1");
    });

    expect(result.current.selectedMemo?.id).toBe("existing-1");

    act(() => {
      resolveTranscribe?.();
    });

    await waitFor(() => {
      expect(result.current.isUploading).toBe(false);
    });
  });

  it("tracks upload progress percentage while a file is uploading", async () => {
    let resolveTranscribe: (() => void) | null = null;
    const transcribePending = new Promise<void>((resolve) => {
      resolveTranscribe = resolve;
    });

    const mockFetch = jest.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
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

        if (url === "/api/transcribe" && init?.method === "POST") {
          await transcribePending;
          return {
            ok: true,
            json: async () => ({
              id: "new-2",
              success: true,
              text: "progress test transcript",
              url: "http://x/new-2.webm",
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

    expect(result.current.uploadProgressPercent).toBe(0);

    act(() => {
      result.current.handleAudioInput({
        blob: new Blob(["fake audio"], { type: "audio/webm" }),
        durationSeconds: 3,
        mimeType: "audio/webm",
      });
    });

    await waitFor(() => {
      expect(result.current.isUploading).toBe(true);
    });

    expect(result.current.uploadProgressPercent).toBeGreaterThanOrEqual(0);

    act(() => {
      resolveTranscribe?.();
    });

    await waitFor(() => {
      expect(result.current.isUploading).toBe(false);
    });

    expect(result.current.uploadProgressPercent).toBe(100);
  });
});
