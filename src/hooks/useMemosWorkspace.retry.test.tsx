import { act, renderHook, waitFor } from "@testing-library/react";
import { useMemosWorkspace } from "./useMemosWorkspace";
import { uploadAudioForTranscription } from "@/lib/audio-upload";

jest.mock("@/lib/audio-upload", () => {
    const actual = jest.requireActual("@/lib/audio-upload");
    return {
        ...actual,
        uploadAudioForTranscription: jest.fn(),
    };
});

describe("useMemosWorkspace upload retry flow", () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
        Object.defineProperty(global, "fetch", {
            writable: true,
            value: jest.fn(async (input: RequestInfo | URL) => {
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

                throw new Error(`Unexpected fetch call: ${url}`);
            }),
        });
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it("surfaces the save error state and retries the same pending upload after a failure", async () => {
        const uploadMock = uploadAudioForTranscription as jest.MockedFunction<
            typeof uploadAudioForTranscription
        >;

        uploadMock
            .mockRejectedValueOnce(new Error("network down"))
            .mockResolvedValueOnce({
                id: "memo-retried",
                success: true,
                text: "retried transcript",
                transcriptStatus: "complete",
            });

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

        const payload = {
            blob: new Blob(["failed upload"], { type: "audio/webm" }),
            durationSeconds: 7,
            mimeType: "audio/webm",
            memoId: "memo-live-retry",
        };

        act(() => {
            result.current.handleAudioInput(payload);
        });

        await waitFor(() => {
            expect(result.current.showUploadError).toBe(true);
        });

        expect(result.current.isUploading).toBe(false);
        expect(uploadMock).toHaveBeenCalledTimes(1);

        const firstFormData = uploadMock.mock.calls[0]?.[0] as FormData;
        expect(firstFormData.get("memoId")).toBe("memo-live-retry");
        expect(firstFormData.get("file")).toBeInstanceOf(Blob);

        act(() => {
            result.current.retryUpload();
        });

        await waitFor(() => {
            expect(result.current.showUploadError).toBe(false);
            expect(result.current.selectedMemo?.id).toBe("memo-retried");
        });

        expect(uploadMock).toHaveBeenCalledTimes(2);

        const retriedFormData = uploadMock.mock.calls[1]?.[0] as FormData;
        expect(retriedFormData.get("memoId")).toBe("memo-live-retry");
        expect(retriedFormData.get("file")).toBeInstanceOf(Blob);
    });
});
