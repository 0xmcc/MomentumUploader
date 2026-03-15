import { act, renderHook, waitFor } from "@testing-library/react";
import { useLiveTranscription } from "./useLiveTranscription";
import { buildChunkRefs } from "./useLiveTranscription.test-helpers";

jest.mock("@/lib/memo-ui", () => ({
    copyToClipboard: jest.fn(async () => true),
}));

describe("useLiveTranscription pruned window math", () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it("finalizes the next live segment using true chunk indices after earlier audio has been pruned", async () => {
        const memoId = "memo-window-prune";
        const patchSegments: Array<{
            segments: Array<{ startIndex: number; endIndex: number; text: string }>;
        }> = [];
        let liveCallCount = 0;

        Object.defineProperty(global, "fetch", {
            writable: true,
            value: jest.fn(async (url: string, init?: RequestInit) => {
                if (url === "/api/memos/live") {
                    return {
                        ok: true,
                        json: async () => ({ memoId }),
                    };
                }

                if (url === `/api/memos/${memoId}/share`) {
                    return {
                        ok: true,
                        json: async () => ({ shareUrl: `https://example.com/s/${memoId}` }),
                    };
                }

                if (url === `/api/memos/${memoId}` && init?.method === "PATCH") {
                    return {
                        ok: true,
                        json: async () => ({ ok: true }),
                    };
                }

                if (url === `/api/memos/${memoId}/segments/live` && init?.method === "PATCH") {
                    const body = JSON.parse(String(init.body ?? "{}")) as {
                        segments?: Array<{ startIndex: number; endIndex: number; text: string }>;
                    };
                    patchSegments.push({
                        segments: body.segments ?? [],
                    });
                    return {
                        ok: true,
                        json: async () => ({ ok: true }),
                    };
                }

                if (url === "/api/transcribe/live") {
                    liveCallCount += 1;
                    if (liveCallCount === 1) {
                        return {
                            ok: true,
                            json: async () => ({ text: "locked segment alpha" }),
                        };
                    }
                    if (liveCallCount === 2) {
                        return {
                            ok: true,
                            json: async () => ({ text: "locked segment beta" }),
                        };
                    }
                    return {
                        ok: true,
                        json: async () => ({ text: "tail after prune" }),
                    };
                }

                return {
                    ok: true,
                    json: async () => ({}),
                };
            }),
        });

        const refs = buildChunkRefs({ chunkCount: 40, startIndex: 10, pruneOffset: 10 });
        const { result, unmount } = renderHook(() => useLiveTranscription(refs));

        act(() => {
            result.current.beginRecordingSession();
        });

        await waitFor(() => {
            expect(result.current.liveMemoId).toBe(memoId);
        });

        act(() => {
            result.current.runLiveTick();
        });

        await waitFor(() => {
            expect(patchSegments).toHaveLength(2);
        });

        expect(patchSegments).toEqual([
            {
                segments: [
                    {
                        startIndex: 0,
                        endIndex: 15,
                        text: "locked segment alpha",
                    },
                ],
            },
            {
                segments: [
                    {
                        startIndex: 15,
                        endIndex: 30,
                        text: "locked segment beta",
                    },
                ],
            },
        ]);

        expect(result.current.liveTranscript).toContain("locked segment alpha");
        expect(result.current.liveTranscript).toContain("locked segment beta");

        unmount();
    });

    it("builds the final tail snapshot from the pruned chunk window using true chunk indices", async () => {
        const memoId = "memo-final-tail-window";
        let liveCallCount = 0;

        Object.defineProperty(global, "fetch", {
            writable: true,
            value: jest.fn(async (url: string, init?: RequestInit) => {
                if (url === "/api/memos/live") {
                    return {
                        ok: true,
                        json: async () => ({ memoId }),
                    };
                }

                if (url === `/api/memos/${memoId}/share`) {
                    return {
                        ok: true,
                        json: async () => ({ shareUrl: `https://example.com/s/${memoId}` }),
                    };
                }

                if (url === `/api/memos/${memoId}` && init?.method === "PATCH") {
                    return {
                        ok: true,
                        json: async () => ({ ok: true }),
                    };
                }

                if (url === `/api/memos/${memoId}/segments/live` && init?.method === "PATCH") {
                    return {
                        ok: true,
                        json: async () => ({ ok: true }),
                    };
                }

                if (url === "/api/transcribe/live") {
                    liveCallCount += 1;
                    if (liveCallCount === 1) {
                        return {
                            ok: true,
                            json: async () => ({ text: "locked segment alpha" }),
                        };
                    }
                    if (liveCallCount === 2) {
                        return {
                            ok: true,
                            json: async () => ({ text: "locked segment beta" }),
                        };
                    }
                    return {
                        ok: true,
                        json: async () => ({ text: "tail after prune" }),
                    };
                }

                return {
                    ok: true,
                    json: async () => ({}),
                };
            }),
        });

        const refs = buildChunkRefs({ chunkCount: 40, startIndex: 10, pruneOffset: 10 });
        const sliceSpy = jest.spyOn(refs.audioChunksRef.current, "slice");
        const { result } = renderHook(() => useLiveTranscription(refs));

        act(() => {
            result.current.beginRecordingSession();
        });

        await waitFor(() => {
            expect(result.current.liveMemoId).toBe(memoId);
        });

        act(() => {
            result.current.runLiveTick();
        });

        await waitFor(() => {
            expect(result.current.liveTranscript).toContain("tail after prune");
        });

        expect(result.current.liveDebug.bufferedChunkCount).toBe(50);
        sliceSpy.mockClear();

        let finalTranscript = "";
        await act(async () => {
            finalTranscript = await result.current.runFinalTailTick();
        });

        expect(finalTranscript).toBe(
            "locked segment alpha locked segment beta tail after prune"
        );

        const fetchMock = global.fetch as jest.Mock;
        const liveCall = fetchMock.mock.calls
            .filter(([url]) => url === "/api/transcribe/live")
            .at(-1);
        const formData = liveCall?.[1]?.body as FormData;
        const snapshot = formData.get("file") as Blob;

        expect(sliceSpy).toHaveBeenCalledWith(20);
        expect(snapshot.size).toBe(
            new Blob(
                [refs.webmHeaderRef.current as Blob, ...refs.audioChunksRef.current.slice(20)],
                { type: refs.mimeTypeRef.current }
            ).size
        );
    });
});
