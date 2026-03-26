import { act, renderHook } from "@testing-library/react";
import { supabase } from "@/lib/supabase";
import { useChunkUpload } from "./useChunkUpload";

jest.mock("@/lib/supabase", () => ({
    supabase: {
        storage: {
            from: jest.fn(),
        },
    },
}));

function padChunkIndex(index: number) {
    return String(index).padStart(7, "0");
}

function readPrepareRequest(init?: RequestInit) {
    return JSON.parse(String(init?.body ?? "{}")) as {
        memoId: string;
        startIndex: number;
        endIndex: number;
        contentType: string;
    };
}

function signedUploadResponse(init?: RequestInit) {
    const body = readPrepareRequest(init);
    return {
        ok: true,
        json: async () => ({
            ok: true,
            path:
                `audio/chunks/${body.memoId}/` +
                `${padChunkIndex(body.startIndex)}-${padChunkIndex(body.endIndex)}.webm`,
            token: `signed-upload-token-${body.startIndex}-${body.endIndex}`,
        }),
    };
}

describe("useChunkUpload", () => {
    let consoleLogSpy: jest.SpyInstance;
    const uploadToSignedUrl = jest.fn();

    beforeEach(() => {
        jest.useFakeTimers();
        consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
        uploadToSignedUrl.mockReset();
        uploadToSignedUrl.mockResolvedValue({
            data: { path: "audio/chunks/memo-1/0000000-0000035.webm" },
            error: null,
        });
        (supabase.storage.from as jest.Mock).mockReturnValue({
            uploadToSignedUrl,
        });
        Object.defineProperty(global, "fetch", {
            writable: true,
            value: jest.fn().mockImplementation(async (_url: string, init?: RequestInit) => signedUploadResponse(init)),
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
        consoleLogSpy.mockRestore();
        jest.useRealTimers();
    });

    it("requests a signed upload URL and sends pending chunks directly to storage after a successful interval flush", async () => {
        const audioChunksRef = {
            current: Array.from(
                { length: 35 },
                (_, index) => new Blob([`chunk-${index}`], { type: "audio/webm" })
            ),
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
                memoId: "memo-1",
                enabled: true,
            })
        );

        await act(async () => {
            jest.advanceTimersByTime(30_000);
            await Promise.resolve();
        });

        const fetchMock = global.fetch as jest.Mock;
        expect(fetchMock).toHaveBeenCalledWith(
            "/api/transcribe/upload-chunks",
            expect.objectContaining({
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    memoId: "memo-1",
                    startIndex: 0,
                    endIndex: 35,
                    contentType: "audio/webm",
                }),
            })
        );

        expect(uploadToSignedUrl).toHaveBeenCalledWith(
            "audio/chunks/memo-1/0000000-0000035.webm",
            "signed-upload-token-0-35",
            expect.any(Blob),
            expect.objectContaining({
                contentType: "audio/webm",
                upsert: true,
            })
        );

        expect(result.current.chunkPruneOffsetRef.current).toBe(5);
        expect(audioChunksRef.current).toHaveLength(30);
    });

    it("uploads within 2s when memoId is set late and we already have 10+ chunks (readiness poll)", async () => {
        const audioChunksRef = {
            current: Array.from(
                { length: 14 },
                (_, i) => new Blob([`chunk-${i}`], { type: "audio/webm" })
            ),
        };
        const webmHeaderRef = { current: new Blob(["header"], { type: "audio/webm" }) };
        const mimeTypeRef = { current: "audio/webm" };
        const fetchMock = jest.fn().mockImplementation(async (_url: string, init?: RequestInit) => signedUploadResponse(init));
        Object.defineProperty(global, "fetch", { writable: true, value: fetchMock });

        const { result, rerender } = renderHook(
            ({ memoId, enabled }) =>
                useChunkUpload({
                    audioChunksRef,
                    webmHeaderRef,
                    mimeTypeRef,
                    memoId,
                    enabled: enabled ?? true,
                }),
            { initialProps: { memoId: null as string | null, enabled: true } }
        );

        expect(fetchMock).not.toHaveBeenCalled();

        rerender({ memoId: "memo-late", enabled: true });
        await act(async () => {
            jest.advanceTimersByTime(2_000);
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(fetchMock).toHaveBeenCalledWith(
            "/api/transcribe/upload-chunks",
            expect.objectContaining({
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
            })
        );
        expect(readPrepareRequest(fetchMock.mock.calls[0]?.[1])).toEqual({
            memoId: "memo-late",
            startIndex: 0,
            endIndex: 14,
            contentType: "audio/webm",
        });
    });

    it("uploads within 2s when many chunks already exist on the initial render (readiness poll)", async () => {
        const audioChunksRef = {
            current: Array.from(
                { length: 15 },
                (_, i) => new Blob([`chunk-${i}`], { type: "audio/webm" })
            ),
        };
        const webmHeaderRef = { current: new Blob(["header"], { type: "audio/webm" }) };
        const mimeTypeRef = { current: "audio/webm" };
        const fetchMock = jest.fn().mockImplementation(async (_url: string, init?: RequestInit) => signedUploadResponse(init));
        Object.defineProperty(global, "fetch", { writable: true, value: fetchMock });

        renderHook(() =>
            useChunkUpload({
                audioChunksRef,
                webmHeaderRef,
                mimeTypeRef,
                memoId: "memo-initial-ready",
                enabled: true,
            })
        );

        await act(async () => {
            jest.advanceTimersByTime(2_000);
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(fetchMock).toHaveBeenCalledWith(
            "/api/transcribe/upload-chunks",
            expect.objectContaining({
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
            })
        );
        expect(readPrepareRequest(fetchMock.mock.calls[0]?.[1])).toEqual({
            memoId: "memo-initial-ready",
            startIndex: 0,
            endIndex: 15,
            contentType: "audio/webm",
        });
    });

    it("uploads within 2s once 3 chunks are buffered (readiness poll threshold)", async () => {
        const audioChunksRef = {
            current: Array.from(
                { length: 3 },
                (_, i) => new Blob([`chunk-${i}`], { type: "audio/webm" })
            ),
        };
        const webmHeaderRef = { current: new Blob(["header"], { type: "audio/webm" }) };
        const mimeTypeRef = { current: "audio/webm" };
        const fetchMock = jest.fn().mockImplementation(async (_url: string, init?: RequestInit) => signedUploadResponse(init));
        Object.defineProperty(global, "fetch", { writable: true, value: fetchMock });

        renderHook(() =>
            useChunkUpload({
                audioChunksRef,
                webmHeaderRef,
                mimeTypeRef,
                memoId: "memo-short-recording",
                enabled: true,
            })
        );

        await act(async () => {
            jest.advanceTimersByTime(2_000);
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(readPrepareRequest(fetchMock.mock.calls[0]?.[1])).toEqual({
            memoId: "memo-short-recording",
            startIndex: 0,
            endIndex: 3,
            contentType: "audio/webm",
        });
    });

    it("uploads within 2s when enabled is set true after chunks already exist", async () => {
        const audioChunksRef = {
            current: Array.from(
                { length: 14 },
                (_, i) => new Blob([`chunk-${i}`], { type: "audio/webm" })
            ),
        };
        const webmHeaderRef = { current: new Blob(["header"], { type: "audio/webm" }) };
        const mimeTypeRef = { current: "audio/webm" };
        const fetchMock = jest.fn().mockImplementation(async (_url: string, init?: RequestInit) => signedUploadResponse(init));
        Object.defineProperty(global, "fetch", { writable: true, value: fetchMock });

        const { rerender } = renderHook(
            ({ enabled }) =>
                useChunkUpload({
                    audioChunksRef,
                    webmHeaderRef,
                    mimeTypeRef,
                    memoId: "memo-enabled-late",
                    enabled,
                }),
            { initialProps: { enabled: false } }
        );

        await act(async () => {
            jest.advanceTimersByTime(2_000);
            await Promise.resolve();
        });

        expect(fetchMock).not.toHaveBeenCalled();

        rerender({ enabled: true });

        await act(async () => {
            jest.advanceTimersByTime(2_000);
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(readPrepareRequest(fetchMock.mock.calls[0]?.[1])).toEqual({
            memoId: "memo-enabled-late",
            startIndex: 0,
            endIndex: 14,
            contentType: "audio/webm",
        });
    });

    it("bootstraps the first upload promptly when memoId arrives late and chunks are already trickling in", async () => {
        const audioChunksRef = { current: [] as Blob[] };
        const webmHeaderRef = { current: new Blob(["header"], { type: "audio/webm" }) };
        const mimeTypeRef = { current: "audio/webm" };
        const fetchMock = jest.fn().mockImplementation(async (_url: string, init?: RequestInit) => signedUploadResponse(init));
        Object.defineProperty(global, "fetch", { writable: true, value: fetchMock });

        const { rerender } = renderHook(
            ({ memoId }) =>
                useChunkUpload({
                    audioChunksRef,
                    webmHeaderRef,
                    mimeTypeRef,
                    memoId,
                    enabled: true,
                }),
            { initialProps: { memoId: null as string | null } }
        );

        rerender({ memoId: "memo-growing-after-live-id" });

        await act(async () => {
            jest.advanceTimersByTime(1_500);
            audioChunksRef.current.push(
                new Blob(["chunk-0"], { type: "audio/webm" }),
                new Blob(["chunk-1"], { type: "audio/webm" })
            );
            await Promise.resolve();
        });

        expect(fetchMock).not.toHaveBeenCalled();

        await act(async () => {
            jest.advanceTimersByTime(700);
            audioChunksRef.current.push(
                new Blob(["chunk-2"], { type: "audio/webm" }),
                new Blob(["chunk-3"], { type: "audio/webm" })
            );
            await Promise.resolve();
        });

        await act(async () => {
            jest.advanceTimersByTime(300);
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(readPrepareRequest(fetchMock.mock.calls[0]?.[1])).toEqual({
            memoId: "memo-growing-after-live-id",
            startIndex: 0,
            endIndex: 2,
            contentType: "audio/webm",
        });
    });

    it("uploads on a later poll when chunks are appended to the same audioChunksRef after mount", async () => {
        const audioChunksRef = { current: [] as Blob[] };
        const webmHeaderRef = { current: new Blob(["header"], { type: "audio/webm" }) };
        const mimeTypeRef = { current: "audio/webm" };
        const fetchMock = jest.fn().mockImplementation(async (_url: string, init?: RequestInit) => signedUploadResponse(init));
        Object.defineProperty(global, "fetch", { writable: true, value: fetchMock });

        renderHook(() =>
            useChunkUpload({
                audioChunksRef,
                webmHeaderRef,
                mimeTypeRef,
                memoId: "memo-same-ref-growth",
                enabled: true,
            })
        );

        await act(async () => {
            jest.advanceTimersByTime(2_000);
            await Promise.resolve();
        });

        expect(fetchMock).not.toHaveBeenCalled();

        audioChunksRef.current.push(
            ...Array.from(
                { length: 14 },
                (_, i) => new Blob([`chunk-${i}`], { type: "audio/webm" })
            )
        );

        await act(async () => {
            jest.advanceTimersByTime(2_000);
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(readPrepareRequest(fetchMock.mock.calls[0]?.[1])).toEqual({
            memoId: "memo-same-ref-growth",
            startIndex: 0,
            endIndex: 14,
            contentType: "audio/webm",
        });
    });

    it("uploads from a replacement audioChunksRef after a rerender swaps ref identities mid-recording", async () => {
        const initialAudioChunksRef = { current: [] as Blob[] };
        const replacementAudioChunksRef = {
            current: Array.from(
                { length: 14 },
                (_, i) => new Blob([`chunk-${i}`], { type: "audio/webm" })
            ),
        };
        const webmHeaderRef = { current: new Blob(["header"], { type: "audio/webm" }) };
        const mimeTypeRef = { current: "audio/webm" };
        const fetchMock = jest.fn().mockImplementation(async (_url: string, init?: RequestInit) => signedUploadResponse(init));
        Object.defineProperty(global, "fetch", { writable: true, value: fetchMock });

        const { rerender } = renderHook(
            ({ audioChunksRef }) =>
                useChunkUpload({
                    audioChunksRef,
                    webmHeaderRef,
                    mimeTypeRef,
                    memoId: "memo-ref-swap",
                    enabled: true,
                }),
            { initialProps: { audioChunksRef: initialAudioChunksRef } }
        );

        rerender({ audioChunksRef: replacementAudioChunksRef });

        await act(async () => {
            jest.advanceTimersByTime(2_000);
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(readPrepareRequest(fetchMock.mock.calls[0]?.[1])).toEqual({
            memoId: "memo-ref-swap",
            startIndex: 0,
            endIndex: 14,
            contentType: "audio/webm",
        });
    });

    it("logs when the upload effect is skipped before memoId exists and when it later starts", () => {
        const audioChunksRef = {
            current: Array.from(
                { length: 2 },
                (_, index) => new Blob([`chunk-${index}`], { type: "audio/webm" })
            ),
        };
        const webmHeaderRef = { current: new Blob(["header"], { type: "audio/webm" }) };
        const mimeTypeRef = { current: "audio/webm" };

        const { rerender } = renderHook(
            ({ memoId }) =>
                useChunkUpload({
                    audioChunksRef,
                    webmHeaderRef,
                    mimeTypeRef,
                    memoId,
                    enabled: true,
                }),
            { initialProps: { memoId: null as string | null } }
        );

        expect(consoleLogSpy).toHaveBeenCalledWith(
            "[chunk-upload]",
            "effect:skip",
            expect.objectContaining({
                reason: "missing-memo-id",
                enabled: true,
                totalChunks: 2,
            })
        );

        rerender({ memoId: "memo-log-visible" });

        expect(consoleLogSpy).toHaveBeenCalledWith(
            "[chunk-upload]",
            "effect:start",
            expect.objectContaining({
                memoId: "memo-log-visible",
                enabled: true,
                totalChunks: 2,
            })
        );
    });
});
