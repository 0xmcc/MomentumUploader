import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { supabase } from "@/lib/supabase";
import AudioRecorder, {
    type AudioInputPayload,
    type UploadCompletePayload,
} from "./AudioRecorder";

jest.mock("@/lib/supabase");

jest.mock("framer-motion", () => {
    const motion = new Proxy(
        {},
        {
            get: (_target, key) => {
                return ({ children, ...props }: { children?: React.ReactNode }) =>
                    React.createElement(typeof key === "string" ? key : "div", props, children);
            },
        }
    );

    return {
        motion,
        AnimatePresence: ({ children }: { children?: React.ReactNode }) =>
            React.createElement(React.Fragment, null, children),
    };
});

class MockMediaRecorder {
    static isTypeSupported() {
        return true;
    }

    ondataavailable: ((event: BlobEvent) => void) | null = null;
    onstart: (() => void) | null = null;
    onstop: (() => void) | null = null;
    private intervalId: NodeJS.Timeout | null = null;

    requestData() {
        const blob = new Blob(["headr"], { type: "audio/webm" });
        this.ondataavailable?.({ data: blob } as BlobEvent);
    }

    start(timeslice?: number) {
        this.onstart?.();
        const interval = timeslice ?? 1000;
        this.intervalId = setInterval(() => {
            const blob = new Blob(["audio"], { type: "audio/webm" });
            this.ondataavailable?.({ data: blob } as BlobEvent);
        }, interval);
    }

    stop() {
        if (this.intervalId) clearInterval(this.intervalId);
        this.onstop?.();
    }
}

async function flushMicrotasks(count = 4) {
    for (let index = 0; index < count; index += 1) {
        await Promise.resolve();
    }
}

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

function uploadCalls(fetchMock: jest.Mock) {
    return fetchMock.mock.calls.filter(
        ([url]: [unknown]) => url === "/api/transcribe/upload-chunks"
    );
}

function finalizeCalls(fetchMock: jest.Mock) {
    return fetchMock.mock.calls.filter(
        ([url]: [unknown]) => url === "/api/transcribe/finalize"
    );
}

function directTranscribeCalls(fetchMock: jest.Mock) {
    return fetchMock.mock.calls.filter(
        ([url]: [unknown]) => url === "/api/transcribe"
    );
}

describe("AudioRecorder pipeline coverage", () => {
    const uploadToSignedUrl = jest.fn();

    beforeEach(() => {
        jest.useFakeTimers();
        uploadToSignedUrl.mockReset();
        uploadToSignedUrl.mockResolvedValue({ data: { path: "" }, error: null });
        (supabase.storage.from as jest.Mock).mockReturnValue({
            uploadToSignedUrl,
        });

        Object.defineProperty(global, "MediaRecorder", {
            writable: true,
            value: MockMediaRecorder,
        });

        Object.defineProperty(global, "fetch", {
            writable: true,
            value: jest.fn(async (url: string) => {
                if (url === "/api/memos/live") {
                    return {
                        ok: true,
                        json: async () => ({ memoId: "memo-default" }),
                    };
                }

                if (url === "/api/memos/memo-default/share") {
                    return {
                        ok: true,
                        json: async () => ({ shareUrl: "https://example.com/s/memo-default" }),
                    };
                }

                if (url === "/api/transcribe/live") {
                    return {
                        ok: true,
                        json: async () => ({ text: "partial transcript" }),
                    };
                }

                return {
                    ok: true,
                    json: async () => ({}),
                };
            }),
        });

        Object.defineProperty(navigator, "mediaDevices", {
            writable: true,
            value: {
                getUserMedia: jest.fn().mockResolvedValue({
                    getTracks: () => [{ stop: jest.fn() }],
                }),
            },
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    it("streams a long recording through chunk uploads, finalizes once, and never falls back to single POST transcription", async () => {
        const memoId = "memo-long-recording";
        const onUploadComplete = jest.fn<(payload: UploadCompletePayload) => void>();

        (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
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

            if (url === "/api/transcribe/live") {
                return {
                    ok: true,
                    json: async () => ({ text: "partial transcript" }),
                };
            }

            if (url === "/api/transcribe/upload-chunks") {
                return signedUploadResponse(init);
            }

            if (url === "/api/transcribe/finalize") {
                return {
                    ok: true,
                    json: async () => ({
                        id: memoId,
                        success: true,
                        text: "final transcript",
                        transcriptStatus: "complete",
                    }),
                };
            }

            return {
                ok: true,
                json: async () => ({}),
            };
        });

        render(<AudioRecorder onUploadComplete={onUploadComplete} />);

        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));

        await act(async () => {
            await flushMicrotasks(3);
        });

        await act(async () => {
            jest.advanceTimersByTime(65_000);
        });
        await act(async () => {
            await flushMicrotasks(6);
        });

        fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));

        await waitFor(() => {
            expect(finalizeCalls(global.fetch as jest.Mock)).toHaveLength(1);
        });

        const fetchMock = global.fetch as jest.Mock;
        const chunkCalls = uploadCalls(fetchMock);
        const finalizeBody = JSON.parse(
            String(finalizeCalls(fetchMock)[0]?.[1]?.body)
        ) as {
            memoId: string;
            totalChunks: number;
            provisionalTranscript: string;
        };

        expect(chunkCalls.length).toBeGreaterThanOrEqual(2);

        const ranges = chunkCalls.map(([, init]) => readPrepareRequest(init as RequestInit));

        expect(ranges[0]?.startIndex).toBe(0);
        for (let index = 1; index < ranges.length; index += 1) {
            expect(ranges[index]?.startIndex).toBe(ranges[index - 1]?.endIndex);
        }

        expect(ranges.every((range) => range.memoId === memoId)).toBe(true);
        expect(finalizeBody).toEqual({
            memoId,
            totalChunks: ranges[ranges.length - 1]?.endIndex ?? 0,
            provisionalTranscript: "partial transcript",
        });
        expect(directTranscribeCalls(fetchMock)).toHaveLength(0);
        expect(uploadToSignedUrl).toHaveBeenCalledTimes(chunkCalls.length);

        await waitFor(() => {
            expect(onUploadComplete).toHaveBeenCalledWith({
                id: memoId,
                success: true,
                text: "final transcript",
                transcriptStatus: "complete",
                durationSeconds: 65,
            });
        });
    });

    it("uploads a short recording during capture and flushes the remaining chunks on stop", async () => {
        const memoId = "memo-short-recording";
        const onUploadComplete = jest.fn<(payload: UploadCompletePayload) => void>();

        (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
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

            if (url === "/api/transcribe/live") {
                return {
                    ok: true,
                    json: async () => ({ text: "partial transcript" }),
                };
            }

            if (url === "/api/transcribe/upload-chunks") {
                return signedUploadResponse(init);
            }

            if (url === "/api/transcribe/finalize") {
                return {
                    ok: true,
                    json: async () => ({
                        id: memoId,
                        success: true,
                        text: "final transcript",
                        transcriptStatus: "complete",
                    }),
                };
            }

            return {
                ok: true,
                json: async () => ({}),
            };
        });

        render(<AudioRecorder onUploadComplete={onUploadComplete} />);

        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));

        await act(async () => {
            await flushMicrotasks(3);
        });

        await act(async () => {
            jest.advanceTimersByTime(10_000);
            await flushMicrotasks(4);
        });

        fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));

        await waitFor(() => {
            expect(finalizeCalls(global.fetch as jest.Mock)).toHaveLength(1);
        });

        const fetchMock = global.fetch as jest.Mock;
        const chunkCalls = uploadCalls(fetchMock);
        const finalizeBody = JSON.parse(
            String(finalizeCalls(fetchMock)[0]?.[1]?.body)
        ) as {
            memoId: string;
            totalChunks: number;
            provisionalTranscript: string;
        };
        const firstUploadedBatch = readPrepareRequest(chunkCalls[0]?.[1] as RequestInit);
        const secondUploadedBatch = readPrepareRequest(chunkCalls[1]?.[1] as RequestInit);
        const firstUploadedEndIndex = firstUploadedBatch.endIndex;
        const finalUploadedEndIndex = secondUploadedBatch.endIndex;

        expect(chunkCalls).toHaveLength(2);
        expect(directTranscribeCalls(fetchMock)).toHaveLength(0);
        expect(firstUploadedBatch.startIndex).toBe(0);
        expect(firstUploadedEndIndex).toBeGreaterThanOrEqual(1);
        expect(firstUploadedEndIndex).toBeLessThan(finalUploadedEndIndex);
        expect(secondUploadedBatch.startIndex).toBe(firstUploadedEndIndex);
        expect(finalizeBody).toEqual({
            memoId,
            totalChunks: finalUploadedEndIndex,
            provisionalTranscript: "partial transcript",
        });

        await waitFor(() => {
            expect(onUploadComplete).toHaveBeenCalledWith({
                id: memoId,
                success: true,
                text: "final transcript",
                transcriptStatus: "complete",
                durationSeconds: 10,
            });
        });
    });

    it("posts upload-chunks within 2s after memos/live resolves late once chunks already exist", async () => {
        const memoId = "memo-late-live";
        let resolveLive: (value: { ok: boolean; json: () => Promise<{ memoId: string }> }) => void;
        const livePromise = new Promise<{ ok: boolean; json: () => Promise<{ memoId: string }> }>((resolve) => {
            resolveLive = resolve;
        });

        (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
            if (url === "/api/memos/live") {
                return livePromise;
            }
            if (url === `/api/memos/${memoId}/share`) {
                return { ok: true, json: async () => ({ shareUrl: `https://example.com/s/${memoId}` }) };
            }
            if (url === "/api/transcribe/live") {
                return { ok: true, json: async () => ({ text: "partial" }) };
            }
            if (url === "/api/transcribe/upload-chunks") {
                return signedUploadResponse(init);
            }
            if (url === "/api/transcribe/finalize") {
                return {
                    ok: true,
                    json: async () => ({ id: memoId, success: true, text: "final", transcriptStatus: "complete" }),
                };
            }
            return { ok: true, json: async () => ({}) };
        });

        render(<AudioRecorder />);
        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));

        await act(async () => {
            jest.advanceTimersByTime(3_000);
        });
        resolveLive!({
            ok: true,
            json: async () => ({ memoId }),
        });
        await act(async () => {
            await flushMicrotasks(12);
        });
        await waitFor(() => {
            expect(screen.getByTitle(/open live share page/i)).toHaveAttribute(
                "href",
                expect.stringContaining(memoId)
            );
        });
        await act(async () => {
            jest.advanceTimersByTime(2_500);
        });
        await act(async () => {
            await flushMicrotasks(12);
        });

        const fetchMock = global.fetch as jest.Mock;
        expect(uploadCalls(fetchMock)).toHaveLength(1);
        expect(uploadCalls(fetchMock)[0]?.[0]).toBe("/api/transcribe/upload-chunks");
    });

    it("falls back to a single transcribe POST when recording stops before the live memo id exists", async () => {
        const pendingLiveMemo = new Promise<never>(() => {});

        (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
            if (url === "/api/memos/live") {
                return pendingLiveMemo;
            }

            if (url === "/api/transcribe/live") {
                return {
                    ok: true,
                    json: async () => ({ text: "fallback transcript" }),
                };
            }

            if (url === "/api/transcribe") {
                return {
                    ok: true,
                    json: async () => ({
                        id: "memo-fallback",
                        success: true,
                        text: "fallback transcript",
                        transcriptStatus: "complete",
                    }),
                };
            }

            return {
                ok: true,
                json: async () => ({}),
            };
        });

        render(<AudioRecorder />);

        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));

        await act(async () => {
            await flushMicrotasks(2);
        });
        await act(async () => {
            jest.advanceTimersByTime(2_000);
        });

        fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));

        await waitFor(() => {
            expect(directTranscribeCalls(global.fetch as jest.Mock)).toHaveLength(1);
        });

        const fetchMock = global.fetch as jest.Mock;
        expect(uploadCalls(fetchMock)).toHaveLength(0);
        expect(finalizeCalls(fetchMock)).toHaveLength(0);

        const formData = directTranscribeCalls(fetchMock)[0]?.[1]?.body as FormData;
        expect(formData.get("file")).toBeInstanceOf(Blob);
        expect(formData.get("memoId")).toBeNull();
        expect(formData.get("provisionalTranscript")).toBe("fallback transcript");
    });

    it("surfaces a provisional processing memo before finalize completes", async () => {
        const memoId = "memo-background-finalize";
        const onUploadComplete = jest.fn<(payload: UploadCompletePayload) => void>();
        let resolveFinalize:
            | ((value: {
                ok: boolean;
                json: () => Promise<{
                    id: string;
                    success: boolean;
                    text: string;
                    transcriptStatus: "complete";
                }>;
            }) => void)
            | undefined;

        const finalizePromise = new Promise<{
            ok: boolean;
            json: () => Promise<{
                id: string;
                success: boolean;
                text: string;
                transcriptStatus: "complete";
            }>;
        }>((resolve) => {
            resolveFinalize = resolve;
        });

        (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
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

            if (url === "/api/transcribe/live") {
                return {
                    ok: true,
                    json: async () => ({ text: "draft transcript" }),
                };
            }

            if (url === "/api/transcribe/upload-chunks") {
                return signedUploadResponse(init);
            }

            if (url === "/api/transcribe/finalize") {
                return finalizePromise;
            }

            return {
                ok: true,
                json: async () => ({}),
            };
        });

        render(<AudioRecorder onUploadComplete={onUploadComplete} />);

        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));

        await act(async () => {
            await flushMicrotasks(3);
        });
        await act(async () => {
            jest.advanceTimersByTime(4_000);
        });

        fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));

        await waitFor(() => {
            expect(finalizeCalls(global.fetch as jest.Mock)).toHaveLength(1);
        });

        await waitFor(() => {
            expect(onUploadComplete).toHaveBeenCalledWith({
                id: memoId,
                text: "draft transcript",
                transcriptStatus: "processing",
                durationSeconds: 4,
            });
        });

        expect(onUploadComplete).toHaveBeenCalledTimes(1);

        resolveFinalize?.({
            ok: true,
            json: async () => ({
                id: memoId,
                success: true,
                text: "final transcript",
                transcriptStatus: "complete",
            }),
        });

        await waitFor(() => {
            expect(onUploadComplete).toHaveBeenCalledWith({
                id: memoId,
                success: true,
                text: "final transcript",
                transcriptStatus: "complete",
                durationSeconds: 4,
            });
        });
        expect(onUploadComplete).toHaveBeenCalledTimes(2);
    });

    it("hands the full recorded blob to onAudioInput without invoking upload or finalize endpoints", async () => {
        const memoId = "memo-external-consumer";
        const onAudioInput = jest.fn<(payload: AudioInputPayload) => void>();

        (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
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

            if (url === "/api/transcribe/live") {
                return {
                    ok: true,
                    json: async () => ({ text: "live draft" }),
                };
            }

            return {
                ok: true,
                json: async () => ({}),
            };
        });

        render(<AudioRecorder onAudioInput={onAudioInput} />);

        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));

        await act(async () => {
            await flushMicrotasks(3);
        });
        await act(async () => {
            jest.advanceTimersByTime(4_000);
        });

        fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));

        await waitFor(() => {
            expect(onAudioInput).toHaveBeenCalledTimes(1);
        });

        const payload = onAudioInput.mock.calls[0]?.[0];
        expect(payload).toEqual(
            expect.objectContaining({
                durationSeconds: 4,
                memoId,
                mimeType: expect.stringContaining("audio/"),
                provisionalTranscript: "live draft",
            })
        );
        expect(payload?.blob).toBeInstanceOf(Blob);
        expect(payload?.blob.size).toBe(25);

        const fetchMock = global.fetch as jest.Mock;
        expect(uploadCalls(fetchMock)).toHaveLength(0);
        expect(finalizeCalls(fetchMock)).toHaveLength(0);
        expect(directTranscribeCalls(fetchMock)).toHaveLength(0);
    });

    it("keeps manual file uploads on the single POST /api/transcribe path", async () => {
        const onUploadComplete = jest.fn<(payload: UploadCompletePayload) => void>();

        (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
            if (url === "/api/transcribe") {
                return {
                    ok: true,
                    json: async () => ({
                        id: "manual-upload-1",
                        success: true,
                        text: "manual transcript",
                        transcriptStatus: "complete",
                    }),
                };
            }

            return {
                ok: true,
                json: async () => ({}),
            };
        });

        render(<AudioRecorder onUploadComplete={onUploadComplete} />);

        const uploadInput = screen.getByTestId("manual-audio-upload");
        const mp3 = new File(["manual audio"], "manual.mp3", { type: "audio/mpeg" });

        fireEvent.change(uploadInput, { target: { files: [mp3] } });

        await waitFor(() => {
            expect(directTranscribeCalls(global.fetch as jest.Mock)).toHaveLength(1);
        });

        const fetchMock = global.fetch as jest.Mock;
        expect(uploadCalls(fetchMock)).toHaveLength(0);
        expect(finalizeCalls(fetchMock)).toHaveLength(0);

        const formData = directTranscribeCalls(fetchMock)[0]?.[1]?.body as FormData;
        const uploadedFile = formData.get("file");
        expect(uploadedFile).toBeInstanceOf(Blob);
        expect((uploadedFile as Blob).size).toBe(mp3.size);

        await waitFor(() => {
            expect(onUploadComplete).toHaveBeenCalledWith({
                id: "manual-upload-1",
                success: true,
                text: "manual transcript",
                transcriptStatus: "complete",
                durationSeconds: 0,
            });
        });
    });
});
