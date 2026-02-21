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

    it("should allow audio playback and not auto-upload upon stopping", async () => {
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

        // Verify that the upload fetch was NOT called
        const fetchMock = global.fetch as jest.Mock;
        const uploadCalls = fetchMock.mock.calls.filter(
            ([url]: [unknown]) => url === "/api/transcribe"
        );

        expect(uploadCalls.length).toBe(0);

        // Verify the play button is present and not disabled
        const playButton = screen.getByRole("button", { name: /play/i });
        expect(playButton).not.toBeDisabled();
    });
});

