import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import Home from "../page";
import type { RecordingStopPayload } from "@/components/AudioRecorder";

const mockOpenSignIn = jest.fn();

let capturedOnRecordingStop: ((payload: RecordingStopPayload) => void) | undefined;

jest.mock("next/link", () => {
    return {
        __esModule: true,
        default: ({ children, href }: { children: React.ReactNode; href: string }) => (
            <a href={href}>{children}</a>
        ),
    };
});

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

    return { motion };
});

jest.mock("@clerk/nextjs", () => ({
    SignedIn: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    SignedOut: () => null,
    SignInButton: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    UserButton: () => <div data-testid="user-button" />,
    useUser: () => ({ isSignedIn: true, isLoaded: true }),
    useClerk: () => ({ openSignIn: mockOpenSignIn }),
}));

jest.mock("@/components/ThemeToggle", () => ({
    __esModule: true,
    default: () => <div data-testid="theme-toggle" />,
}));

jest.mock("@/components/ThemeProvider", () => ({
    useTheme: () => ({ playbackTheme: "accent" }),
}));

jest.mock("@/components/AudioRecorder", () => ({
    __esModule: true,
    default: ({
        onRecordingStop,
    }: {
        onRecordingStop?: (payload: RecordingStopPayload) => void;
    }) => {
        capturedOnRecordingStop = onRecordingStop;
        return <div data-testid="audio-recorder">AudioRecorder</div>;
    },
}));

describe("Home optimistic ID behavior", () => {
    const transcriptText = "alpha beta gamma delta epsilon zeta eta theta";
    const createdAt = "2026-02-22T10:00:00.000Z";
    const mockFetch = jest.fn();
    let memosSequence: Array<{ memos: Array<Record<string, unknown>> }> = [];

    beforeEach(() => {
        jest.useFakeTimers();
        mockOpenSignIn.mockReset();
        capturedOnRecordingStop = undefined;
        memosSequence = [
            { memos: [] },
            {
                memos: [
                    {
                        id: "real-uuid-123",
                        transcript: transcriptText,
                        createdAt,
                        success: true,
                        wordCount: 8,
                    },
                ],
            },
        ];
        mockFetch.mockReset();

        mockFetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
            const url =
                typeof input === "string"
                    ? input
                    : input instanceof URL
                        ? input.toString()
                        : input.url;

            if (url === "/api/memos") {
                const next = memosSequence.shift() ?? { memos: [] };

                return Promise.resolve({
                    ok: true,
                    json: async () => next,
                });
            }

            if (url === "/api/transcribe" && init?.method === "POST") {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        id: "real-uuid-123",
                        success: true,
                        text: transcriptText,
                        url: "http://x/a.webm",
                        modelUsed: "nvidia/parakeet-rnnt-1.1b",
                    }),
                });
            }

            return Promise.reject(new Error(`Unexpected fetch call: ${url}`));
        });

        Object.defineProperty(global, "fetch", {
            writable: true,
            value: mockFetch,
        });
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.clearAllMocks();
    });

    it("keeps selected transcript visible after refresh fetch", async () => {
        render(<Home />);

        await waitFor(() => {
            expect(capturedOnRecordingStop).toBeDefined();
        });

        act(() => {
            capturedOnRecordingStop?.({
                blob: new Blob(["fake audio"], { type: "audio/webm" }),
                durationSeconds: 3,
                mimeType: "audio/webm",
            });
        });

        await waitFor(() => {
            expect(screen.getByText(transcriptText)).toBeInTheDocument();
        });

        await act(async () => {
            jest.advanceTimersByTime(1500);
            await Promise.resolve();
        });

        await waitFor(() => {
            expect(screen.getByText(transcriptText)).toBeInTheDocument();
        });
    });

    it("keeps transcript view during optimistic-to-persisted reconciliation when one refresh is stale", async () => {
        memosSequence = [
            { memos: [] },
            { memos: [] },
        ];

        render(<Home />);

        await waitFor(() => {
            expect(capturedOnRecordingStop).toBeDefined();
        });

        act(() => {
            capturedOnRecordingStop?.({
                blob: new Blob(["fake audio"], { type: "audio/webm" }),
                durationSeconds: 3,
                mimeType: "audio/webm",
            });
        });

        await waitFor(() => {
            expect(screen.getByText(transcriptText)).toBeInTheDocument();
        });

        await act(async () => {
            jest.advanceTimersByTime(1500);
            await Promise.resolve();
        });

        await waitFor(() => {
            expect(screen.getByText(transcriptText)).toBeInTheDocument();
        });
    });
});
