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

  it("loads bookmarked shared memos alongside owned memos", async () => {
    const mockFetch = jest.fn(async (input: RequestInfo | URL) => {
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

      if (url === "/api/shared-memo-bookmarks") {
        return {
          ok: true,
          json: async () => ({
            bookmarks: [
              {
                memoId: "memo-bookmark-1",
                shareToken: "sharetoken1234",
                title: "Shared product review",
                authorName: "Taylor Jones",
                authorAvatarUrl: "https://img.example.com/taylor.png",
                createdAt: "2026-04-10T12:00:00.000Z",
                bookmarkedAt: "2026-04-11T09:00:00.000Z",
              },
            ],
          }),
        };
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });
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

    expect(result.current.filteredBookmarkedMemos).toEqual([
      {
        memoId: "memo-bookmark-1",
        shareToken: "sharetoken1234",
        title: "Shared product review",
        authorName: "Taylor Jones",
        authorAvatarUrl: "https://img.example.com/taylor.png",
        createdAt: "2026-04-10T12:00:00.000Z",
        bookmarkedAt: "2026-04-11T09:00:00.000Z",
      },
    ]);
  });

  it("clears stale bookmarked shared memos when the bookmark refresh fails", async () => {
    let bookmarkRequestCount = 0;
    const mockFetch = jest.fn(async (input: RequestInfo | URL) => {
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

      if (url === "/api/shared-memo-bookmarks") {
        bookmarkRequestCount += 1;

        if (bookmarkRequestCount === 1) {
          return {
            ok: true,
            json: async () => ({
              bookmarks: [
                {
                  memoId: "memo-bookmark-1",
                  shareToken: "sharetoken1234",
                  title: "Shared product review",
                  authorName: "Taylor Jones",
                  authorAvatarUrl: "https://img.example.com/taylor.png",
                  createdAt: "2026-04-10T12:00:00.000Z",
                  bookmarkedAt: "2026-04-11T09:00:00.000Z",
                },
              ],
            }),
          };
        }

        throw new Error("bookmark refresh failed");
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });
    Object.defineProperty(global, "fetch", { writable: true, value: mockFetch });

    const { result, rerender } = renderHook(
      ({ isLoaded }) =>
        useMemosWorkspace({
          isLoaded,
          isSignedIn: true,
          openSignIn: jest.fn(),
        }),
      {
        initialProps: { isLoaded: true },
      }
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.filteredBookmarkedMemos).toHaveLength(1);

    await act(async () => {
      rerender({ isLoaded: false });
      await Promise.resolve();
    });

    await act(async () => {
      rerender({ isLoaded: true });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(bookmarkRequestCount).toBe(2);
    });

    await waitFor(() => {
      expect(result.current.filteredBookmarkedMemos).toEqual([]);
    });
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

  it("hydrates the selected memo with transcript segments from the detail endpoint", async () => {
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
            json: async () => ({
              memos: [
                {
                  id: "existing-1",
                  title: "Existing memo",
                  transcript: "Fallback flat transcript",
                  createdAt: "2026-03-15T12:00:00.000Z",
                  wordCount: 3,
                  success: true,
                },
              ],
            }),
          };
        }

        if (url === "/api/memos/existing-1") {
          return {
            ok: true,
            json: async () => ({
              memo: {
                id: "existing-1",
                title: "Existing memo",
                transcript: "Fallback flat transcript",
                createdAt: "2026-03-15T12:00:00.000Z",
                wordCount: 3,
                transcriptSegments: [
                  {
                    id: "0",
                    startMs: 0,
                    endMs: 1800,
                    text: "First segment.",
                  },
                  {
                    id: "1",
                    startMs: 1800,
                    endMs: 4200,
                    text: "Second segment.",
                  },
                ],
              },
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
      result.current.setSelectedMemoId("existing-1");
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/memos/existing-1");
    });

    await waitFor(() => {
      const selectedMemo = result.current.selectedMemo as
        | ({ transcriptSegments?: Array<{ text: string }> } & Record<string, unknown>)
        | null;
      expect(selectedMemo?.transcriptSegments).toHaveLength(2);
      expect(selectedMemo?.transcriptSegments?.[0]?.text).toBe("First segment.");
    });
  });

  it("rehydrates a newly recorded memo when final transcript segments arrive after the first detail fetch", async () => {
    let detailFetchCount = 0;
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

        if (url === "/api/memos/recorded-1") {
          detailFetchCount += 1;

          return {
            ok: true,
            json: async () => ({
              memo: {
                id: "recorded-1",
                title: "Recorded memo",
                transcript: "First segment. Second segment.",
                transcriptStatus: "complete",
                createdAt: "2026-03-15T12:00:00.000Z",
                wordCount: 4,
                transcriptSegments:
                  detailFetchCount === 1
                    ? []
                    : [
                        {
                          id: "0",
                          startMs: 0,
                          endMs: 1800,
                          text: "First segment.",
                        },
                        {
                          id: "1",
                          startMs: 1800,
                          endMs: 4200,
                          text: "Second segment.",
                        },
                      ],
              },
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
      result.current.handleUploadComplete({
        id: "recorded-1",
        success: true,
        text: "First segment. Second segment.",
        transcriptStatus: "processing",
        durationSeconds: 4,
      });
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/memos/recorded-1");
    });

    await waitFor(() => {
      expect(
        (result.current.selectedMemo as { transcriptSegments?: unknown[] } | null)
          ?.transcriptSegments
      ).toEqual([]);
    });

    act(() => {
      result.current.handleUploadComplete({
        id: "recorded-1",
        success: true,
        text: "First segment. Second segment.",
        transcriptStatus: "complete",
        durationSeconds: 4,
      });
    });

    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    await waitFor(() => {
      const selectedMemo = result.current.selectedMemo as
        | ({ transcriptSegments?: Array<{ text: string }> } & Record<string, unknown>)
        | null;
      expect(selectedMemo?.transcriptSegments).toHaveLength(2);
      expect(selectedMemo?.transcriptSegments?.[1]?.text).toBe("Second segment.");
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

  it("forwards live memoId during upload so finalization updates the same memo", async () => {
    let uploadedMemoId: string | null = null;
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
          const formData = init.body as FormData;
          const memoId = formData.get("memoId");
          uploadedMemoId = typeof memoId === "string" ? memoId : null;
          return {
            ok: true,
            json: async () => ({
              id: "memo-live-1",
              success: true,
              text: "live transcript finalized",
              url: "http://x/live.webm",
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
        memoId: "memo-live-1",
      });
    });

    await waitFor(() => {
      expect(result.current.isUploading).toBe(false);
    });

    expect(uploadedMemoId).toBe("memo-live-1");
  });
});
