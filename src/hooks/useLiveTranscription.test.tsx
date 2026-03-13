import { act, renderHook, waitFor } from "@testing-library/react";
import { useLiveTranscription } from "./useLiveTranscription";

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

function buildChunkRefs(chunkCount = 30) {
    return {
        audioChunksRef: {
            current: Array.from(
                { length: chunkCount },
                () => new Blob(["audio"], { type: "audio/webm" })
            ),
        },
        mimeTypeRef: { current: "audio/webm" },
        webmHeaderRef: {
            current: new Blob(["headr"], { type: "audio/webm" }),
        },
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
});
