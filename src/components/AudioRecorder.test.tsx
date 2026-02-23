import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import AudioRecorder from "./AudioRecorder";

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
    onstop: (() => void) | null = null;
    private intervalId: NodeJS.Timeout | null = null;

    constructor() { }

    start(timeslice?: number) {
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

describe("AudioRecorder live transcript cadence", () => {
    beforeEach(() => {
        jest.useFakeTimers();

        Object.defineProperty(global, "fetch", {
            writable: true,
            value: jest.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ text: "partial transcript" }),
            }),
        });

        Object.defineProperty(global, "MediaRecorder", {
            writable: true,
            value: MockMediaRecorder,
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

    it("starts live transcription within ~2 seconds of recording", async () => {
        render(<AudioRecorder />);

        fireEvent.click(screen.getByRole("button"));

        await act(async () => {
            await Promise.resolve();
        });
        await act(async () => {
            jest.advanceTimersByTime(2200);
        });

        const fetchMock = global.fetch as jest.Mock;
        const liveCalls = fetchMock.mock.calls.filter(
            ([url]: [unknown]) => url === "/api/transcribe/live"
        );

        expect(liveCalls.length).toBeGreaterThan(0);
    });

    it("should auto-upload upon stopping", async () => {
        global.URL.createObjectURL = jest.fn(() => "blob:http://localhost/test");

        render(<AudioRecorder />);

        // Start recording
        fireEvent.click(screen.getByRole("button"));

        await act(async () => {
            await Promise.resolve();
        });

        // Simulate recording time
        await act(async () => {
            jest.advanceTimersByTime(2000);
        });

        // Stop recording
        const stopButton = screen.getByRole("button"); // The record button toggles
        fireEvent.click(stopButton);

        await act(async () => {
            await Promise.resolve();
        });

        // Verify that the upload fetch WAS called
        const fetchMock = global.fetch as jest.Mock;
        const uploadCalls = fetchMock.mock.calls.filter(
            ([url]: [unknown]) => url === "/api/transcribe"
        );

        expect(uploadCalls.length).toBe(1);
    });

    it("calls onRecordingStop and does not auto-upload when callback is provided", async () => {
        const onRecordingStop = jest.fn();
        render(<AudioRecorder onRecordingStop={onRecordingStop} />);

        fireEvent.click(screen.getByRole("button"));

        await act(async () => {
            await Promise.resolve();
        });
        await act(async () => {
            jest.advanceTimersByTime(2000);
        });

        fireEvent.click(screen.getByRole("button"));

        await act(async () => {
            await Promise.resolve();
        });

        expect(onRecordingStop).toHaveBeenCalledTimes(1);
        expect(onRecordingStop).toHaveBeenCalledWith(
            expect.objectContaining({
                blob: expect.any(Blob),
                durationSeconds: expect.any(Number),
                mimeType: expect.stringContaining("audio/"),
            })
        );

        const fetchMock = global.fetch as jest.Mock;
        const uploadCalls = fetchMock.mock.calls.filter(
            ([url]: [unknown]) => url === "/api/transcribe"
        );
        expect(uploadCalls.length).toBe(0);
    });

    it("keeps live payload size bounded during long recordings", async () => {
        let maxLivePayloadBytes = 0;
        let liveCallCount = 0;

        (global.fetch as jest.Mock).mockImplementation(
            async (url: string, init?: { body?: unknown }) => {
                if (url === "/api/transcribe/live") {
                    const formData = init?.body as FormData;
                    const file = formData.get("file") as Blob | null;
                    const size = file?.size ?? 0;
                    maxLivePayloadBytes = Math.max(maxLivePayloadBytes, size);
                    liveCallCount += 1;

                    return {
                        ok: true,
                        json: async () => ({ text: `partial-${liveCallCount}` }),
                    };
                }

                return {
                    ok: true,
                    json: async () => ({ text: "final transcript" }),
                };
            }
        );

        render(<AudioRecorder />);
        fireEvent.click(screen.getByRole("button"));

        await act(async () => {
            await Promise.resolve();
        });

        for (let i = 0; i < 50; i += 1) {
            await act(async () => {
                jest.advanceTimersByTime(1500);
            });
            await act(async () => {
                await Promise.resolve();
            });
        }

        expect(liveCallCount).toBeGreaterThan(10);
        expect(maxLivePayloadBytes).toBeLessThanOrEqual(180);

        fireEvent.click(screen.getByRole("button"));
        await act(async () => {
            await Promise.resolve();
        });
    });

    it("appends overlapping live transcript windows instead of overwriting earlier text", async () => {
        const liveTexts = [
            "interface but it's not recommended",
            "it's not recommended because there are debugging messages",
            "because there are debugging messages that come out here and then",
        ];
        let liveCallIndex = 0;

        (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
            if (url === "/api/transcribe/live") {
                const text = liveTexts[Math.min(liveCallIndex, liveTexts.length - 1)];
                liveCallIndex += 1;
                return {
                    ok: true,
                    json: async () => ({ text }),
                };
            }

            return {
                ok: true,
                json: async () => ({ text: "final transcript" }),
            };
        });

        render(<AudioRecorder />);
        fireEvent.click(screen.getByRole("button"));

        await act(async () => {
            await Promise.resolve();
        });

        for (let i = 0; i < 6; i += 1) {
            await act(async () => {
                jest.advanceTimersByTime(1500);
            });
            await act(async () => {
                await Promise.resolve();
            });
        }

        const normalizedText = (document.body.textContent ?? "")
            .replace(/\s+/g, "")
            .toLowerCase();
        const expectedCombinedTranscript = "interface but it's not recommended because there are debugging messages that come out here and then"
            .replace(/\s+/g, "")
            .toLowerCase();

        expect(normalizedText).toContain(expectedCombinedTranscript);

        fireEvent.click(screen.getByRole("button"));
        await act(async () => {
            await Promise.resolve();
        });
    });

    it("shows an actionable user-facing error when microphone APIs are unavailable on non-secure origins", async () => {
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => { });
        const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => { });
        Object.defineProperty(navigator, "mediaDevices", {
            writable: true,
            value: undefined,
        });
        Object.defineProperty(window, "isSecureContext", {
            configurable: true,
            value: false,
        });

        render(<AudioRecorder />);

        fireEvent.click(screen.getByRole("button"));

        await act(async () => {
            await Promise.resolve();
        });

        expect(screen.getByText("Microphone access requires HTTPS (or localhost). Open this page over a secure origin and try again.")).toBeInTheDocument();
        expect(screen.getByText("New Recording")).toBeInTheDocument();
        expect(screen.queryByText("Listening...")).not.toBeInTheDocument();
        expect(consoleErrorSpy).not.toHaveBeenCalled();
        expect(consoleWarnSpy).toHaveBeenCalled();

        consoleErrorSpy.mockRestore();
        consoleWarnSpy.mockRestore();
    });
});
