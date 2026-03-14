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
});
