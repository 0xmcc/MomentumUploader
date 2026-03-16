import { act, renderHook } from "@testing-library/react";
import { useArtifacts } from "./useArtifacts";

describe("useArtifacts", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.spyOn(console, "error").mockImplementation(() => {});
        Object.defineProperty(global, "fetch", {
            writable: true,
            value: jest.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    rolling_summary: null,
                    outline: null,
                    title_candidates: null,
                    title: null,
                    key_topics: null,
                    action_items: null,
                }),
            }),
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.useRealTimers();
        (console.error as jest.Mock).mockRestore();
    });

    it("does not fetch when recording is inactive", () => {
        renderHook(() => useArtifacts("memo-1", false));
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it("polls every five seconds while recording", async () => {
        renderHook(() => useArtifacts("memo-1", true));

        await act(async () => {
            await Promise.resolve();
        });

        expect(global.fetch).toHaveBeenCalledTimes(1);

        await act(async () => {
            jest.advanceTimersByTime(5000);
            await Promise.resolve();
        });

        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it("keeps the last known state when a later poll fails", async () => {
        const fetchMock = global.fetch as jest.Mock;
        fetchMock
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    rolling_summary: {
                        payload: { summary: "Known summary" },
                        basedOnChunkStart: 0,
                        basedOnChunkEnd: 1,
                        version: 1,
                        updatedAt: "2026-03-15T10:00:00.000Z",
                    },
                    outline: null,
                    title_candidates: null,
                    title: null,
                    key_topics: null,
                    action_items: null,
                }),
            })
            .mockRejectedValueOnce(new Error("network down"));

        const { result } = renderHook(() => useArtifacts("memo-1", true));

        await act(async () => {
            await Promise.resolve();
        });

        expect(result.current?.rolling_summary?.payload).toEqual({
            summary: "Known summary",
        });

        await act(async () => {
            jest.advanceTimersByTime(5000);
            await Promise.resolve();
        });

        expect(result.current?.rolling_summary?.payload).toEqual({
            summary: "Known summary",
        });
    });
});
