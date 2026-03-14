import { act, renderHook } from "@testing-library/react";
import { useChunkUpload } from "./useChunkUpload";

describe("useChunkUpload", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        Object.defineProperty(global, "fetch", {
            writable: true,
            value: jest.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ ok: true }),
            }),
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    it("uploads pending chunks and prunes older audio from memory after a successful interval flush", async () => {
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
                body: expect.any(FormData),
            })
        );

        const formData = fetchMock.mock.calls[0]?.[1]?.body as FormData;
        expect(formData.get("memoId")).toBe("memo-1");
        expect(formData.get("startIndex")).toBe("0");
        expect(formData.get("endIndex")).toBe("35");
        expect(formData.get("file")).toBeInstanceOf(Blob);

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
        const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
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
            expect.objectContaining({ method: "POST", body: expect.any(FormData) })
        );
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
        const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
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
            expect.objectContaining({ method: "POST", body: expect.any(FormData) })
        );

        const formData = fetchMock.mock.calls[0]?.[1]?.body as FormData;
        expect(formData.get("memoId")).toBe("memo-initial-ready");
        expect(formData.get("startIndex")).toBe("0");
        expect(formData.get("endIndex")).toBe("15");
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
        const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
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

        expect(fetchMock).toHaveBeenCalledWith(
            "/api/transcribe/upload-chunks",
            expect.objectContaining({ method: "POST", body: expect.any(FormData) })
        );
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
        const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
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

        expect(fetchMock).toHaveBeenCalledWith(
            "/api/transcribe/upload-chunks",
            expect.objectContaining({ method: "POST", body: expect.any(FormData) })
        );

        const formData = fetchMock.mock.calls[0]?.[1]?.body as FormData;
        expect(formData.get("memoId")).toBe("memo-enabled-late");
        expect(formData.get("startIndex")).toBe("0");
        expect(formData.get("endIndex")).toBe("14");
    });

    it("uploads on a later poll when chunks are appended to the same audioChunksRef after mount", async () => {
        const audioChunksRef = { current: [] as Blob[] };
        const webmHeaderRef = { current: new Blob(["header"], { type: "audio/webm" }) };
        const mimeTypeRef = { current: "audio/webm" };
        const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
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

        expect(fetchMock).toHaveBeenCalledWith(
            "/api/transcribe/upload-chunks",
            expect.objectContaining({ method: "POST", body: expect.any(FormData) })
        );

        const formData = fetchMock.mock.calls[0]?.[1]?.body as FormData;
        expect(formData.get("memoId")).toBe("memo-same-ref-growth");
        expect(formData.get("startIndex")).toBe("0");
        expect(formData.get("endIndex")).toBe("14");
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
        const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
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

        expect(fetchMock).toHaveBeenCalledWith(
            "/api/transcribe/upload-chunks",
            expect.objectContaining({ method: "POST", body: expect.any(FormData) })
        );

        const formData = fetchMock.mock.calls[0]?.[1]?.body as FormData;
        expect(formData.get("memoId")).toBe("memo-ref-swap");
        expect(formData.get("startIndex")).toBe("0");
        expect(formData.get("endIndex")).toBe("14");
    });
});
