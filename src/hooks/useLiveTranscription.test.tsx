import { act, renderHook, waitFor } from "@testing-library/react";
import { copyToClipboard } from "@/lib/memo-ui";
import { useLiveTranscription } from "./useLiveTranscription";
import { buildChunkRefs } from "./useLiveTranscription.test-helpers";

jest.mock("@/lib/memo-ui", () => ({
    copyToClipboard: jest.fn(async () => true),
}));

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

function makeTranscribeResponse(text: string) {
    return {
        ok: true,
        json: async () => ({ text }),
    };
}

async function flushMicrotasks(count = 4) {
    for (let i = 0; i < count; i += 1) {
        await Promise.resolve();
    }
}

type FinalizationScenario = {
    memoId: string;
    patchTranscripts: string[];
    patchSegments: Array<{
        segments: Array<{ startIndex: number; endIndex: number; text: string }>;
    }>;
    finalization: Deferred<{ ok: boolean; json: () => Promise<{ text: string }> }>;
    runTailRefresh: () => Promise<void>;
};

async function setupFinalizationScenario(
    tailRefreshResponse:
        | { type: "ok"; text: string }
        | { type: "http_error"; status: number }
        | { type: "reject"; error: unknown }
) {
    const memoId = `memo-live-${Math.random().toString(36).slice(2, 10)}`;
    const patchTranscripts: string[] = [];
    const patchSegments: Array<{
        segments: Array<{ startIndex: number; endIndex: number; text: string }>;
    }> = [];
    const finalization = deferred<{ ok: boolean; json: () => Promise<{ text: string }> }>();
    let liveCallCount = 0;

    Object.defineProperty(global, "fetch", {
        writable: true,
        value: jest.fn((url: string, init?: RequestInit) => {
            if (url === "/api/memos/live") {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({ memoId }),
                });
            }

            if (url === `/api/memos/${memoId}/share`) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({ shareUrl: `https://example.com/s/${memoId}` }),
                });
            }

            if (url === `/api/memos/${memoId}` && init?.method === "PATCH") {
                const body = JSON.parse(String(init.body ?? "{}")) as { transcript?: string };
                patchTranscripts.push(body.transcript ?? "");
                return Promise.resolve({
                    ok: true,
                    json: async () => ({ ok: true }),
                });
            }

            if (url === `/api/memos/${memoId}/segments/live` && init?.method === "PATCH") {
                const body = JSON.parse(String(init.body ?? "{}")) as {
                    segments?: Array<{ startIndex: number; endIndex: number; text: string }>;
                };
                patchSegments.push({
                    segments: body.segments ?? [],
                });
                return Promise.resolve({
                    ok: true,
                    json: async () => ({ ok: true }),
                });
            }

            if (url === "/api/transcribe/live") {
                liveCallCount += 1;
                if (liveCallCount === 1) {
                    return finalization.promise;
                }

                if (tailRefreshResponse.type === "ok") {
                    return Promise.resolve(makeTranscribeResponse(tailRefreshResponse.text));
                }

                if (tailRefreshResponse.type === "http_error") {
                    return Promise.resolve({
                        ok: false,
                        status: tailRefreshResponse.status,
                        json: async () => ({ error: "tail refresh failed" }),
                    });
                }

                return Promise.reject(tailRefreshResponse.error);
            }

            return Promise.resolve({
                ok: true,
                json: async () => ({}),
            });
        }),
    });

    const refs = buildChunkRefs();
    const { result, unmount } = renderHook(() => useLiveTranscription(refs));

    act(() => {
        result.current.beginRecordingSession();
    });

    await waitFor(() => {
        expect(result.current.liveMemoId).toBe(memoId);
    });

    await waitFor(() => {
        expect(result.current.liveShareState).toBe("ready");
    });

    act(() => {
        result.current.runLiveTick();
    });

    await act(async () => {
        finalization.resolve(makeTranscribeResponse("locked segment alpha"));
        await flushMicrotasks();
    });

    async function runTailRefresh() {
        await act(async () => {
            await flushMicrotasks();
        });
    }

    return {
        result,
        unmount,
        memoId,
        patchTranscripts,
        patchSegments,
        finalization,
        runTailRefresh,
    };
}

describe("useLiveTranscription finalization fallback", () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it("keeps the finalized transcript visible when the replacement tail request rejects", async () => {
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
        const scenario = await setupFinalizationScenario({
            type: "reject",
            error: new Error("network down"),
        });

        await scenario.runTailRefresh();

        expect(scenario.result.current.liveTranscript).toBe("locked segment alpha");

        consoleErrorSpy.mockRestore();
        scenario.unmount();
    });

    it("keeps the finalized transcript visible when the replacement tail request returns an HTTP error", async () => {
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
        const scenario = await setupFinalizationScenario({
            type: "http_error",
            status: 503,
        });

        await scenario.runTailRefresh();

        expect(scenario.result.current.liveTranscript).toBe("locked segment alpha");

        consoleErrorSpy.mockRestore();
        scenario.unmount();
    });

    it("keeps the finalized transcript visible when the replacement tail request aborts", async () => {
        const scenario = await setupFinalizationScenario({
            type: "reject",
            error: Object.assign(new Error("Aborted"), { name: "AbortError" }),
        });

        await scenario.runTailRefresh();

        expect(scenario.result.current.liveTranscript).toBe("locked segment alpha");

        scenario.unmount();
    });

    it("persists the finalized transcript when the replacement tail request rejects", async () => {
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
        const scenario = await setupFinalizationScenario({
            type: "reject",
            error: new Error("network down"),
        });

        await scenario.runTailRefresh();

        expect(scenario.patchTranscripts).toContain("locked segment alpha");

        consoleErrorSpy.mockRestore();
        scenario.unmount();
    });

    it("persists the finalized transcript when the replacement tail request returns an HTTP error", async () => {
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
        const scenario = await setupFinalizationScenario({
            type: "http_error",
            status: 503,
        });

        await scenario.runTailRefresh();

        expect(scenario.patchTranscripts).toContain("locked segment alpha");

        consoleErrorSpy.mockRestore();
        scenario.unmount();
    });

    it("persists the finalized transcript when the replacement tail request aborts", async () => {
        const scenario = await setupFinalizationScenario({
            type: "reject",
            error: Object.assign(new Error("Aborted"), { name: "AbortError" }),
        });

        await scenario.runTailRefresh();

        expect(scenario.patchTranscripts).toContain("locked segment alpha");

        scenario.unmount();
    });

    it("persists only newly locked segments after a finalization tick", async () => {
        const scenario = await setupFinalizationScenario({
            type: "ok",
            text: "tail text that stays ephemeral",
        });

        await scenario.runTailRefresh();

        expect(scenario.patchSegments).toEqual([
            {
                segments: [
                    {
                        startIndex: 0,
                        endIndex: 15,
                        text: "locked segment alpha",
                    },
                ],
            },
        ]);

        scenario.unmount();
    });

    it("does not persist live segments on a tail-only tick", async () => {
        const memoId = `memo-live-${Math.random().toString(36).slice(2, 10)}`;
        const patchSegments: Array<{
            segments: Array<{ startIndex: number; endIndex: number; text: string }>;
        }> = [];

        Object.defineProperty(global, "fetch", {
            writable: true,
            value: jest.fn((url: string, init?: RequestInit) => {
                if (url === "/api/memos/live") {
                    return Promise.resolve({
                        ok: true,
                        json: async () => ({ memoId }),
                    });
                }

                if (url === `/api/memos/${memoId}/share`) {
                    return Promise.resolve({
                        ok: true,
                        json: async () => ({ shareUrl: `https://example.com/s/${memoId}` }),
                    });
                }

                if (url === `/api/memos/${memoId}` && init?.method === "PATCH") {
                    return Promise.resolve({
                        ok: true,
                        json: async () => ({ ok: true }),
                    });
                }

                if (url === `/api/memos/${memoId}/segments/live` && init?.method === "PATCH") {
                    const body = JSON.parse(String(init.body ?? "{}")) as {
                        segments?: Array<{ startIndex: number; endIndex: number; text: string }>;
                    };
                    patchSegments.push({
                        segments: body.segments ?? [],
                    });
                    return Promise.resolve({
                        ok: true,
                        json: async () => ({ ok: true }),
                    });
                }

                if (url === "/api/transcribe/live") {
                    return Promise.resolve(makeTranscribeResponse("tail text only"));
                }

                return Promise.resolve({
                    ok: true,
                    json: async () => ({}),
                });
            }),
        });

        const refs = buildChunkRefs(20);
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

        await act(async () => {
            await flushMicrotasks();
        });

        expect(result.current.liveTranscript).toBe("tail text only");
        expect(patchSegments).toEqual([]);

        unmount();
    });

    it("resets the live-segment persistence cursor between recording sessions", async () => {
        const firstSession = await setupFinalizationScenario({
            type: "ok",
            text: "tail text that stays ephemeral",
        });

        await firstSession.runTailRefresh();
        expect(firstSession.patchSegments).toHaveLength(1);

        act(() => {
            firstSession.result.current.resetLiveSession();
        });
        firstSession.unmount();

        const secondSession = await setupFinalizationScenario({
            type: "ok",
            text: "another tail",
        });

        await secondSession.runTailRefresh();

        expect(secondSession.patchSegments).toEqual([
            {
                segments: [
                    {
                        startIndex: 0,
                        endIndex: 15,
                        text: "locked segment alpha",
                    },
                ],
            },
        ]);

        secondSession.unmount();
    });

    it("runFinalTailTick returns the final locked-plus-tail transcript and only hits /api/transcribe/live after stop", async () => {
        const memoId = `memo-live-${Math.random().toString(36).slice(2, 10)}`;
        const patchTranscripts: string[] = [];
        let liveCallCount = 0;

        Object.defineProperty(global, "fetch", {
            writable: true,
            value: jest.fn((url: string, init?: RequestInit) => {
                if (url === "/api/memos/live") {
                    return Promise.resolve({
                        ok: true,
                        json: async () => ({ memoId }),
                    });
                }

                if (url === `/api/memos/${memoId}/share`) {
                    return Promise.resolve({
                        ok: true,
                        json: async () => ({ shareUrl: `https://example.com/s/${memoId}` }),
                    });
                }

                if (url === `/api/memos/${memoId}` && init?.method === "PATCH") {
                    const body = JSON.parse(String(init.body ?? "{}")) as { transcript?: string };
                    patchTranscripts.push(body.transcript ?? "");
                    return Promise.resolve({
                        ok: true,
                        json: async () => ({ ok: true }),
                    });
                }

                if (url === "/api/transcribe/live") {
                    liveCallCount += 1;

                    if (liveCallCount === 1) {
                        return Promise.resolve(makeTranscribeResponse("locked segment alpha"));
                    }

                    if (liveCallCount === 2) {
                        return Promise.resolve(
                            makeTranscribeResponse("draft tail before stop")
                        );
                    }

                    return Promise.resolve(makeTranscribeResponse("final second words"));
                }

                if (url === `/api/memos/${memoId}/segments/live`) {
                    return Promise.resolve({
                        ok: true,
                        json: async () => ({ ok: true }),
                    });
                }

                return Promise.resolve({
                    ok: true,
                    json: async () => ({}),
                });
            }),
        });

        const refs = buildChunkRefs(30);
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
            expect(result.current.liveTranscript).toBe(
                "locked segment alpha draft tail before stop"
            );
        });

        act(() => {
            result.current.endRecordingSession();
        });

        await act(async () => {
            await flushMicrotasks();
        });

        const patchCountAfterStop = patchTranscripts.length;
        const fetchCallCountAfterStop = (global.fetch as jest.Mock).mock.calls.length;

        let finalTranscript = "";
        await act(async () => {
            finalTranscript = await result.current.runFinalTailTick();
            await flushMicrotasks();
        });

        expect(finalTranscript).toBe("locked segment alpha final second words");
        expect(result.current.liveTranscript).toBe("locked segment alpha draft tail before stop");
        expect(patchTranscripts).toHaveLength(patchCountAfterStop);

        const postStopCalls = (global.fetch as jest.Mock).mock.calls.slice(fetchCallCountAfterStop);
        expect(postStopCalls).toHaveLength(1);
        expect(postStopCalls[0]?.[0]).toBe("/api/transcribe/live");
        expect(postStopCalls.some(([url, init]) =>
            url === `/api/memos/${memoId}` &&
            (init as RequestInit | undefined)?.method === "PATCH"
        )).toBe(false);

        unmount();
    });

    it("runFinalTailTick still requests the remaining true tail after earlier chunks were pruned from memory", async () => {
        const memoId = `memo-live-${Math.random().toString(36).slice(2, 10)}`;
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

                if (url === `/api/memos/${memoId}/segments/live`) {
                    return {
                        ok: true,
                        json: async () => ({ ok: true }),
                    };
                }

                if (url === "/api/transcribe/live") {
                    liveCallCount += 1;

                    if (liveCallCount === 1) {
                        return makeTranscribeResponse("locked segment alpha");
                    }
                    if (liveCallCount === 2) {
                        return makeTranscribeResponse("locked segment beta");
                    }
                    if (liveCallCount === 3) {
                        return makeTranscribeResponse("draft tail before stop");
                    }
                    return makeTranscribeResponse("final tail after prune");
                }

                return {
                    ok: true,
                    json: async () => ({}),
                };
            }),
        });

        const refs = buildChunkRefs({ chunkCount: 50 });
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
            expect(result.current.liveTranscript).toBe(
                "locked segment alpha locked segment beta draft tail before stop"
            );
        });

        refs.audioChunksRef.current = refs.audioChunksRef.current.slice(20);
        refs.chunkPruneOffsetRef.current = 20;

        act(() => {
            result.current.endRecordingSession();
        });

        let finalTranscript = "";
        await act(async () => {
            finalTranscript = await result.current.runFinalTailTick();
            await flushMicrotasks();
        });

        expect(finalTranscript).toBe(
            "locked segment alpha locked segment beta final tail after prune"
        );
        expect(liveCallCount).toBe(4);

        unmount();
    });
});

describe("useLiveTranscription session controls", () => {
    afterEach(() => {
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    it("resets transcript, share state, and debug counters when the live session is reset", async () => {
        const memoId = "memo-reset-state";

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

                if (url === "/api/transcribe/live") {
                    return makeTranscribeResponse("tail text only");
                }

                return {
                    ok: true,
                    json: async () => ({ ok: true }),
                };
            }),
        });

        const refs = buildChunkRefs(20);
        const { result, unmount } = renderHook(() => useLiveTranscription(refs));

        act(() => {
            result.current.beginRecordingSession();
        });

        await waitFor(() => {
            expect(result.current.liveShareState).toBe("ready");
        });

        act(() => {
            result.current.runLiveTick();
        });

        await waitFor(() => {
            expect(result.current.liveTranscript).toBe("tail text only");
        });

        act(() => {
            result.current.resetLiveSession();
        });

        expect(result.current.liveTranscript).toBe("");
        expect(result.current.animatedWords).toEqual([]);
        expect(result.current.newWordStartIndex).toBe(0);
        expect(result.current.liveMemoId).toBeNull();
        expect(result.current.liveShareUrl).toBeNull();
        expect(result.current.liveShareState).toBe("idle");
        expect(result.current.liveDebug.windowMode).toBe("idle");
        expect(result.current.liveDebug.bufferedChunkCount).toBe(0);
        expect(result.current.liveDebug.lastServerText).toBe("");
        expect(result.current.liveDebug.lastTranscriptLength).toBe(0);
        expect(result.current.liveDebug.lastTranscriptWordCount).toBe(0);

        unmount();
    });

    it("keeps live transcription running when live memo setup is unauthorized", async () => {
        const fetchMock = jest.fn(async (url: string) => {
            if (url === "/api/memos/live") {
                return {
                    ok: false,
                    status: 401,
                    json: async () => ({ error: "Unauthorized" }),
                };
            }

            if (url === "/api/transcribe/live") {
                return makeTranscribeResponse("signed out live transcript");
            }

            return {
                ok: true,
                json: async () => ({ ok: true }),
            };
        });

        Object.defineProperty(global, "fetch", {
            writable: true,
            value: fetchMock,
        });

        const refs = buildChunkRefs(20);
        const { result, unmount } = renderHook(() => useLiveTranscription(refs));

        act(() => {
            result.current.beginRecordingSession();
        });

        await act(async () => {
            await flushMicrotasks();
        });

        act(() => {
            result.current.runLiveTick();
        });

        await waitFor(() => {
            expect(result.current.liveTranscript).toBe("signed out live transcript");
        });

        expect(result.current.liveMemoId).toBeNull();
        expect(result.current.liveShareState).toBe("idle");
        expect(fetchMock).not.toHaveBeenCalledWith(
            expect.stringMatching(/^\/api\/memos\/.+\/share$/),
            expect.anything()
        );

        unmount();
    });

    it("copies the live share URL and restores the ready state after the timeout", async () => {
        jest.useFakeTimers();
        const memoId = "memo-live-share";

        Object.defineProperty(global, "fetch", {
            writable: true,
            value: jest.fn(async (url: string) => {
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

                return {
                    ok: true,
                    json: async () => ({ ok: true }),
                };
            }),
        });

        const refs = buildChunkRefs(5);
        const { result, unmount } = renderHook(() => useLiveTranscription(refs));

        act(() => {
            result.current.beginRecordingSession();
        });

        await waitFor(() => {
            expect(result.current.liveShareState).toBe("ready");
        });

        await act(async () => {
            await result.current.handleCopyLiveShare();
        });

        expect(copyToClipboard).toHaveBeenCalledWith(`https://example.com/s/${memoId}`);
        expect(result.current.liveShareState).toBe("copied");
        expect(result.current.getLiveShareLabel()).toBe("Copied");

        await act(async () => {
            jest.advanceTimersByTime(3000);
            await flushMicrotasks();
        });

        expect(result.current.liveShareState).toBe("ready");
        expect(result.current.getLiveShareLabel()).toBe("Copy live link");

        unmount();
    });

    it("starts a hidden live transcription tick from incoming audio chunks when interval polling is throttled", async () => {
        const previousVisibilityState = document.visibilityState;
        const previousHidden = document.hidden;

        Object.defineProperty(document, "visibilityState", {
            configurable: true,
            value: "hidden",
        });
        Object.defineProperty(document, "hidden", {
            configurable: true,
            value: true,
        });

        Object.defineProperty(global, "fetch", {
            writable: true,
            value: jest.fn(async (url: string) => {
                if (url === "/api/memos/live") {
                    return {
                        ok: true,
                        json: async () => ({ memoId: "memo-hidden-chunk-driven" }),
                    };
                }

                if (url === "/api/memos/memo-hidden-chunk-driven/share") {
                    return {
                        ok: true,
                        json: async () => ({
                            shareUrl: "https://example.com/s/memo-hidden-chunk-driven",
                        }),
                    };
                }

                if (url === "/api/transcribe/live") {
                    return makeTranscribeResponse("hidden chunk transcript");
                }

                return {
                    ok: true,
                    json: async () => ({ ok: true }),
                };
            }),
        });

        const refs = buildChunkRefs(0);
        const { result, unmount } = renderHook(() => useLiveTranscription(refs));

        act(() => {
            result.current.beginRecordingSession();
        });

        await waitFor(() => {
            expect(result.current.liveShareState).toBe("ready");
        });

        act(() => {
            refs.audioChunksRef.current.push(new Blob(["chunk-0"], { type: "audio/webm" }));
            result.current.handleRecordedChunkAvailable();
        });

        await waitFor(() => {
            expect(result.current.liveTranscript).toBe("hidden chunk transcript");
        });

        Object.defineProperty(document, "visibilityState", {
            configurable: true,
            value: previousVisibilityState,
        });
        Object.defineProperty(document, "hidden", {
            configurable: true,
            value: previousHidden,
        });

        unmount();
    });

    it("suppresses staggered chunk animation for the first catch-up update after returning from a hidden tab", async () => {
        const previousVisibilityState = document.visibilityState;
        const previousHidden = document.hidden;
        const responses = [
            "Short opening sentence.",
            "Short opening sentence. Catch-up arrives as one chunk.",
        ];
        let responseIndex = 0;

        Object.defineProperty(document, "visibilityState", {
            configurable: true,
            value: "visible",
        });
        Object.defineProperty(document, "hidden", {
            configurable: true,
            value: false,
        });

        Object.defineProperty(global, "fetch", {
            writable: true,
            value: jest.fn(async (url: string) => {
                if (url === "/api/memos/live") {
                    return {
                        ok: true,
                        json: async () => ({ memoId: "memo-visible-catchup" }),
                    };
                }

                if (url === "/api/memos/memo-visible-catchup/share") {
                    return {
                        ok: true,
                        json: async () => ({
                            shareUrl: "https://example.com/s/memo-visible-catchup",
                        }),
                    };
                }

                if (url === "/api/transcribe/live") {
                    const text = responses[Math.min(responseIndex, responses.length - 1)];
                    responseIndex += 1;
                    return makeTranscribeResponse(text);
                }

                return {
                    ok: true,
                    json: async () => ({ ok: true }),
                };
            }),
        });

        const refs = buildChunkRefs(20);
        const { result, unmount } = renderHook(() => useLiveTranscription(refs));

        act(() => {
            result.current.beginRecordingSession();
        });

        await waitFor(() => {
            expect(result.current.liveShareState).toBe("ready");
        });

        act(() => {
            result.current.runLiveTick();
        });

        await waitFor(() => {
            expect(result.current.liveTranscript).toBe("Short opening sentence.");
        });

        expect(result.current.shouldAnimateNewChunks).toBe(true);

        Object.defineProperty(document, "visibilityState", {
            configurable: true,
            value: "hidden",
        });
        Object.defineProperty(document, "hidden", {
            configurable: true,
            value: true,
        });

        act(() => {
            document.dispatchEvent(new Event("visibilitychange"));
        });

        refs.audioChunksRef.current.push(new Blob(["chunk-20"], { type: "audio/webm" }));

        Object.defineProperty(document, "visibilityState", {
            configurable: true,
            value: "visible",
        });
        Object.defineProperty(document, "hidden", {
            configurable: true,
            value: false,
        });

        act(() => {
            document.dispatchEvent(new Event("visibilitychange"));
        });

        await waitFor(() => {
            expect(result.current.liveTranscript).toBe(
                "Short opening sentence. Catch-up arrives as one chunk."
            );
        });

        expect(result.current.newWordStartIndex).toBe(1);
        expect(result.current.shouldAnimateNewChunks).toBe(false);

        Object.defineProperty(document, "visibilityState", {
            configurable: true,
            value: previousVisibilityState,
        });
        Object.defineProperty(document, "hidden", {
            configurable: true,
            value: previousHidden,
        });

        unmount();
    });

    it("reveals append-only catch-up text in larger chunks instead of per word", async () => {
        const responses = [
            "Short opening sentence.",
            "Short opening sentence. Catch-up arrives as one chunk.",
        ];
        let responseIndex = 0;

        Object.defineProperty(global, "fetch", {
            writable: true,
            value: jest.fn(async (url: string) => {
                if (url === "/api/memos/live") {
                    return {
                        ok: true,
                        json: async () => ({ memoId: "memo-catchup-chunks" }),
                    };
                }

                if (url === "/api/memos/memo-catchup-chunks/share") {
                    return {
                        ok: true,
                        json: async () => ({
                            shareUrl: "https://example.com/s/memo-catchup-chunks",
                        }),
                    };
                }

                if (url === "/api/transcribe/live") {
                    const text = responses[Math.min(responseIndex, responses.length - 1)];
                    responseIndex += 1;
                    return makeTranscribeResponse(text);
                }

                return {
                    ok: true,
                    json: async () => ({ ok: true }),
                };
            }),
        });

        const refs = buildChunkRefs(20);
        const { result, unmount } = renderHook(() => useLiveTranscription(refs));

        act(() => {
            result.current.beginRecordingSession();
        });

        await waitFor(() => {
            expect(result.current.liveShareState).toBe("ready");
        });

        act(() => {
            result.current.runLiveTick();
        });

        await waitFor(() => {
            expect(result.current.liveTranscript).toBe("Short opening sentence.");
        });

        expect(result.current.animatedWords).toEqual(["Short opening sentence."]);
        expect(result.current.newWordStartIndex).toBe(0);

        refs.audioChunksRef.current.push(new Blob(["chunk-20"], { type: "audio/webm" }));

        act(() => {
            result.current.runLiveTick();
        });

        await waitFor(() => {
            expect(result.current.liveTranscript).toBe(
                "Short opening sentence. Catch-up arrives as one chunk."
            );
        });

        expect(result.current.animatedWords.map((chunk) => chunk.trim())).toEqual([
            "Short opening sentence.",
            "Catch-up arrives as one chunk.",
        ]);
        expect(result.current.newWordStartIndex).toBe(1);

        unmount();
    });
});

describe("useLiveTranscription tail regression guard", () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    function makeFetchForTailGuard(memoId: string, responses: string[]) {
        let responseIndex = 0;

        Object.defineProperty(global, "fetch", {
            writable: true,
            value: jest.fn(async (url: string) => {
                if (url === "/api/memos/live") {
                    return { ok: true, json: async () => ({ memoId }) };
                }
                if (url === `/api/memos/${memoId}/share`) {
                    return { ok: true, json: async () => ({ shareUrl: `https://example.com/s/${memoId}` }) };
                }
                if (url === "/api/transcribe/live") {
                    const text = responses[Math.min(responseIndex, responses.length - 1)];
                    responseIndex += 1;
                    return { ok: true, json: async () => ({ text }) };
                }
                return { ok: true, json: async () => ({ ok: true }) };
            }),
        });
    }

    it("does not overwrite a longer tail when the server returns a regressed (shorter prefix) response", async () => {
        makeFetchForTailGuard("memo-tail-regression", [
            "To me it was a wonderful experience speaking here today",
            "To me",
        ]);

        const refs = buildChunkRefs(20);
        const { result, unmount } = renderHook(() => useLiveTranscription(refs));

        act(() => { result.current.beginRecordingSession(); });
        await waitFor(() => { expect(result.current.liveShareState).toBe("ready"); });

        act(() => { result.current.runLiveTick(); });
        await waitFor(() => {
            expect(result.current.liveTranscript).toBe(
                "To me it was a wonderful experience speaking here today"
            );
        });

        act(() => { result.current.runLiveTick(); });
        await act(async () => { await flushMicrotasks(); });
        await act(async () => { await flushMicrotasks(); });

        expect(result.current.liveTranscript).toBe(
            "To me it was a wonderful experience speaking here today"
        );

        unmount();
    });

    it("replaces the tail when the server returns a new sliding-window response (not a subset of previous)", async () => {
        // Simulates RIVA's sliding-window hypothesis: each tick covers newer audio
        // that doesn't overlap with the old tail — so we REPLACE, not merge.
        makeFetchForTailGuard("memo-tail-slide", [
            "interface but it is not recommended",
            "something completely different here",
        ]);

        const refs = buildChunkRefs(20);
        const { result, unmount } = renderHook(() => useLiveTranscription(refs));

        act(() => { result.current.beginRecordingSession(); });
        await waitFor(() => { expect(result.current.liveShareState).toBe("ready"); });

        act(() => { result.current.runLiveTick(); });
        await waitFor(() => {
            expect(result.current.liveTranscript).toBe("interface but it is not recommended");
        });

        act(() => { result.current.runLiveTick(); });
        await waitFor(() => {
            expect(result.current.liveTranscript).toBe("something completely different here");
        });

        unmount();
    });

    it("does not clear the tail when the server returns an empty response", async () => {
        makeFetchForTailGuard("memo-tail-empty", [
            "Hello this is a long sentence",
            "",
        ]);

        const refs = buildChunkRefs(20);
        const { result, unmount } = renderHook(() => useLiveTranscription(refs));

        act(() => { result.current.beginRecordingSession(); });
        await waitFor(() => { expect(result.current.liveShareState).toBe("ready"); });

        act(() => { result.current.runLiveTick(); });
        await waitFor(() => {
            expect(result.current.liveTranscript).toBe("Hello this is a long sentence");
        });

        act(() => { result.current.runLiveTick(); });
        await act(async () => { await flushMicrotasks(); });
        await act(async () => { await flushMicrotasks(); });

        expect(result.current.liveTranscript).toBe("Hello this is a long sentence");

        unmount();
    });

    it("extends the tail when the server returns a longer response for newer audio", async () => {
        makeFetchForTailGuard("memo-tail-extend", [
            "Hello world",
            "Hello world how are you doing today",
        ]);

        const refs = buildChunkRefs(20);
        const { result, unmount } = renderHook(() => useLiveTranscription(refs));

        act(() => { result.current.beginRecordingSession(); });
        await waitFor(() => { expect(result.current.liveShareState).toBe("ready"); });

        act(() => { result.current.runLiveTick(); });
        await waitFor(() => {
            expect(result.current.liveTranscript).toBe("Hello world");
        });

        act(() => { result.current.runLiveTick(); });
        await waitFor(() => {
            expect(result.current.liveTranscript).toBe(
                "Hello world how are you doing today"
            );
        });

        unmount();
    });
});
