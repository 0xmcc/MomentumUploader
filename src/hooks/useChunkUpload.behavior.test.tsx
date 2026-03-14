import { act, renderHook } from "@testing-library/react";
import { useChunkUpload } from "./useChunkUpload";

async function flushMicrotasks(count = 4) {
    for (let index = 0; index < count; index += 1) {
        await Promise.resolve();
    }
}

function buildAudioChunks(count: number, startIndex = 0) {
    return Array.from(
        { length: count },
        (_, index) => new Blob([`chunk-${startIndex + index}`], { type: "audio/webm" })
    );
}

describe("useChunkUpload retry and pruning behavior", () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    it("prunes uploaded audio while preserving enough buffered chunks to continue from the next true index", async () => {
        Object.defineProperty(global, "fetch", {
            writable: true,
            value: jest.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ ok: true }),
            }),
        });

        const audioChunksRef = {
            current: buildAudioChunks(60),
        };
        const webmHeaderRef = {
            current: new Blob(["header"], { type: "audio/webm" }),
        };
        const mimeTypeRef = { current: "audio/webm" };

        const { result } = renderHook(() =>
            useChunkUpload({
                audioChunksRef,
                webmHeaderRef,
                mimeTypeRef,
                memoId: "memo-prune",
                enabled: true,
            })
        );

        await act(async () => {
            jest.advanceTimersByTime(30_000);
            await flushMicrotasks();
        });

        expect(result.current.chunkPruneOffsetRef.current).toBe(30);
        expect(audioChunksRef.current).toHaveLength(30);

        audioChunksRef.current.push(...buildAudioChunks(5, 60));

        await act(async () => {
            await result.current.flushRemainingChunks();
        });

        const fetchMock = global.fetch as jest.Mock;
        const uploadBodies = fetchMock.mock.calls.map(([, init]) => (init as RequestInit).body as FormData);

        expect(uploadBodies).toHaveLength(2);
        expect(uploadBodies[0]?.get("startIndex")).toBe("0");
        expect(uploadBodies[0]?.get("endIndex")).toBe("60");
        expect(uploadBodies[1]?.get("startIndex")).toBe("60");
        expect(uploadBodies[1]?.get("endIndex")).toBe("65");
    });

    it("keeps the full buffer after an interval upload failure and retries the same range on the next interval", async () => {
        const fetchMock = jest
            .fn()
            .mockRejectedValueOnce(new Error("network down"))
            .mockResolvedValue({
                ok: true,
                json: async () => ({ ok: true }),
            });

        Object.defineProperty(global, "fetch", {
            writable: true,
            value: fetchMock,
        });

        const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
        const audioChunksRef = {
            current: buildAudioChunks(60),
        };
        const webmHeaderRef = {
            current: new Blob(["header"], { type: "audio/webm" }),
        };
        const mimeTypeRef = { current: "audio/webm" };

        const { result } = renderHook(() =>
            useChunkUpload({
                audioChunksRef,
                webmHeaderRef,
                mimeTypeRef,
                memoId: "memo-retry",
                enabled: true,
            })
        );

        await act(async () => {
            jest.advanceTimersByTime(30_000);
            await flushMicrotasks();
        });

        expect(result.current.chunkPruneOffsetRef.current).toBe(0);
        expect(audioChunksRef.current).toHaveLength(60);

        await act(async () => {
            jest.advanceTimersByTime(30_000);
            await flushMicrotasks();
        });

        expect(result.current.chunkPruneOffsetRef.current).toBe(30);
        expect(audioChunksRef.current).toHaveLength(30);

        const firstSuccessBody = fetchMock.mock.calls[1]?.[1]?.body as FormData;
        expect(firstSuccessBody.get("startIndex")).toBe("0");
        expect(firstSuccessBody.get("endIndex")).toBe("60");

        warnSpy.mockRestore();
    });

    it("retries flushRemainingChunks with backoff delays before allowing finalize to continue", async () => {
        const fetchMock = jest
            .fn()
            .mockResolvedValueOnce({
                ok: false,
                status: 500,
                json: async () => ({ ok: false }),
            })
            .mockResolvedValueOnce({
                ok: false,
                status: 500,
                json: async () => ({ ok: false }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ ok: true }),
            });

        Object.defineProperty(global, "fetch", {
            writable: true,
            value: fetchMock,
        });

        const audioChunksRef = {
            current: buildAudioChunks(12),
        };
        const webmHeaderRef = {
            current: new Blob(["header"], { type: "audio/webm" }),
        };
        const mimeTypeRef = { current: "audio/webm" };

        const { result } = renderHook(() =>
            useChunkUpload({
                audioChunksRef,
                webmHeaderRef,
                mimeTypeRef,
                memoId: "memo-flush-retry",
                enabled: true,
            })
        );

        let flushPromise: Promise<void> | undefined;

        await act(async () => {
            flushPromise = result.current.flushRemainingChunks();
            await flushMicrotasks();
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);

        await act(async () => {
            jest.advanceTimersByTime(500);
            await flushMicrotasks();
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);

        await act(async () => {
            jest.advanceTimersByTime(1_000);
            await flushMicrotasks();
        });
        expect(fetchMock).toHaveBeenCalledTimes(3);

        await act(async () => {
            await flushPromise;
        });

        const finalBody = fetchMock.mock.calls[2]?.[1]?.body as FormData;
        expect(finalBody.get("startIndex")).toBe("0");
        expect(finalBody.get("endIndex")).toBe("12");
    });
});
