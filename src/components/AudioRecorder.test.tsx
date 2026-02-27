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
        // Restore visibility defaults so tab-switch tests don't bleed into each other
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
        Object.defineProperty(document, "hidden", { configurable: true, value: false });
    });

    it("starts live transcription within ~2 seconds of recording", async () => {
        render(<AudioRecorder />);

        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));

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

    it("creates a live memo share link when recording starts", async () => {
        (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
            if (url === "/api/memos/live") {
                return {
                    ok: true,
                    json: async () => ({ memoId: "memo-live-1" }),
                };
            }
            if (url === "/api/memos/memo-live-1/share") {
                return {
                    ok: true,
                    json: async () => ({ shareUrl: "https://example.com/s/live-token" }),
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
                json: async () => ({ text: "final transcript" }),
            };
        });

        render(<AudioRecorder />);

        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));

        await act(async () => {
            await Promise.resolve();
        });

        await act(async () => {
            jest.advanceTimersByTime(2200);
        });

        expect(global.fetch).toHaveBeenCalledWith("/api/memos/live", { method: "POST" });
        expect(global.fetch).toHaveBeenCalledWith(
            "/api/memos/memo-live-1/share",
            { method: "POST" }
        );
        expect(screen.getByText(/open live page/i)).toBeInTheDocument();
    });

    it("should auto-upload upon stopping", async () => {
        global.URL.createObjectURL = jest.fn(() => "blob:http://localhost/test");

        render(<AudioRecorder />);

        // Start recording
        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));

        await act(async () => {
            await Promise.resolve();
        });

        // Simulate recording time
        await act(async () => {
            jest.advanceTimersByTime(2000);
        });

        // Stop recording
        const stopButton = screen.getByRole("button", { name: /stop recording/i });
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

    it("calls onAudioInput and does not auto-upload when callback is provided", async () => {
        const onAudioInput = jest.fn();
        render(<AudioRecorder onAudioInput={onAudioInput} />);

        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));

        await act(async () => {
            await Promise.resolve();
        });
        await act(async () => {
            jest.advanceTimersByTime(2000);
        });

        fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));

        await act(async () => {
            await Promise.resolve();
        });

        expect(onAudioInput).toHaveBeenCalledTimes(1);
        expect(onAudioInput).toHaveBeenCalledWith(
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

    it("calls onAudioInput for manual MP3 uploads via the same callback flow", async () => {
        const onAudioInput = jest.fn();
        render(<AudioRecorder onAudioInput={onAudioInput} />);

        const uploadInput = screen.getByTestId("manual-audio-upload");
        const mp3 = new File(["fake mp3"], "manual.mp3", { type: "audio/mpeg" });
        fireEvent.change(uploadInput, { target: { files: [mp3] } });

        await act(async () => {
            await Promise.resolve();
        });

        expect(onAudioInput).toHaveBeenCalledWith(
            expect.objectContaining({
                blob: mp3,
                durationSeconds: 0,
                mimeType: "audio/mpeg",
            })
        );

        const fetchMock = global.fetch as jest.Mock;
        const uploadCalls = fetchMock.mock.calls.filter(
            ([url]: [unknown]) => url === "/api/transcribe"
        );
        expect(uploadCalls.length).toBe(0);
    });

    it("shows upload activity UI when parent-managed upload is in progress", () => {
        render(
            <AudioRecorder
                onAudioInput={jest.fn()}
                isUploadInProgress
                uploadProgressPercent={42}
            />
        );

        expect(screen.getByText("Saving...")).toBeInTheDocument();
        expect(screen.getByRole("progressbar", { name: "Upload in progress" })).toHaveAttribute("aria-valuenow", "42");
        expect(screen.getByText("Uploading... 42%")).toBeInTheDocument();
        expect(screen.getByText("42% uploaded")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /start recording/i })).toBeDisabled();
        expect(screen.getByRole("button", { name: /upload mp3\/m4a/i })).toBeDisabled();
    });

    it("accepts m4a files even when browser MIME type is empty", async () => {
        const onAudioInput = jest.fn();
        render(<AudioRecorder onAudioInput={onAudioInput} />);

        const uploadInput = screen.getByTestId("manual-audio-upload");
        const m4a = new File(["fake m4a"], "manual.m4a", { type: "" });
        fireEvent.change(uploadInput, { target: { files: [m4a] } });

        await act(async () => {
            await Promise.resolve();
        });

        expect(onAudioInput).toHaveBeenCalledWith(
            expect.objectContaining({
                blob: m4a,
                durationSeconds: 0,
                mimeType: "audio/mp4",
            })
        );
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
        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));

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

        fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));
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
        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));

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

        fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));
        await act(async () => {
            await Promise.resolve();
        });
    });

    it("replaces near-identical prefix revisions instead of duplicating the whole transcript", async () => {
        const liveTexts = [
            "This is a voice and I hope it actually does work.",
            "This is a voice and I hope it actually does work, but you have to talk to the microphone.",
            "This is a voice and I hope it actually does work, but you have to talk to the microphone because it's really good at noise cancellation.",
        ];
        let liveCallIndex = 0;
        let latestPatchedTranscript = "";

        (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
            if (url === "/api/memos/live") {
                return {
                    ok: true,
                    json: async () => ({ memoId: "memo-live-dup-test" }),
                };
            }
            if (url === "/api/memos/memo-live-dup-test/share") {
                return {
                    ok: true,
                    json: async () => ({ shareUrl: "https://example.com/s/live-dup-test" }),
                };
            }
            if (url === "/api/transcribe/live") {
                const text = liveTexts[Math.min(liveCallIndex, liveTexts.length - 1)];
                liveCallIndex += 1;
                return {
                    ok: true,
                    json: async () => ({ text }),
                };
            }
            if (url === "/api/memos/memo-live-dup-test" && init?.method === "PATCH") {
                const body = JSON.parse(String(init.body ?? "{}")) as { transcript?: string };
                latestPatchedTranscript = body.transcript ?? "";
                return {
                    ok: true,
                    json: async () => ({ ok: true }),
                };
            }

            return {
                ok: true,
                json: async () => ({ text: "final transcript" }),
            };
        });

        render(<AudioRecorder />);
        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));

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

        expect(latestPatchedTranscript).toBe(liveTexts[liveTexts.length - 1]);

        fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));
        await act(async () => {
            await Promise.resolve();
        });
    });

    it("does not duplicate when interim ASR revises earlier words and resends a longer full hypothesis", async () => {
        const liveTexts = [
            "Testing testing 123 working is this working I think this is working if I just try talking really fast maybe just reading",
            "Testing testing 123 working is this working I think this is working if I just started talking really fast maybe just reading a tweet we will say the whole thing",
            "Testing testing 123 working is this working I think this is working if I just started talking really fast maybe just reading a tweet we will say the whole thing there is a pretty notable overlap",
        ];
        let liveCallIndex = 0;
        let latestPatchedTranscript = "";

        (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
            if (url === "/api/memos/live") {
                return {
                    ok: true,
                    json: async () => ({ memoId: "memo-live-early-revise-test" }),
                };
            }
            if (url === "/api/memos/memo-live-early-revise-test/share") {
                return {
                    ok: true,
                    json: async () => ({ shareUrl: "https://example.com/s/live-early-revise-test" }),
                };
            }
            if (url === "/api/transcribe/live") {
                const text = liveTexts[Math.min(liveCallIndex, liveTexts.length - 1)];
                liveCallIndex += 1;
                return {
                    ok: true,
                    json: async () => ({ text }),
                };
            }
            if (url === "/api/memos/memo-live-early-revise-test" && init?.method === "PATCH") {
                const body = JSON.parse(String(init.body ?? "{}")) as { transcript?: string };
                latestPatchedTranscript = body.transcript ?? "";
                return {
                    ok: true,
                    json: async () => ({ ok: true }),
                };
            }

            return {
                ok: true,
                json: async () => ({ text: "final transcript" }),
            };
        });

        render(<AudioRecorder />);
        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));

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

        const normalizedTranscript = latestPatchedTranscript
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        const repeatedPrefix = "testing testing 123 working is this working i think this is working";
        const occurrences = normalizedTranscript.split(repeatedPrefix).length - 1;

        expect(occurrences).toBe(1);

        fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));
        await act(async () => {
            await Promise.resolve();
        });
    });

    it("does not duplicate no-space punctuated resend transcripts", async () => {
        const liveTexts = [
            "Testing.testing.Isthisgonnaworknow?Idon'tevenknow.I'mjustgonnafuckingballoutandI'mgonnareadsomeshit.Okay.Whymostofyoudon'tsucceedwithAi.You'reafraidtoaskthequestion.You'reafraidtogivetheprompt.LastyearwhenIdidthisworkshop",
            "No.I'mjustgonnafuckingballoutandI'mgonnareadsomeshit.Okay.Whymostofyoudon'tsucceedwithAi.You'reafraidtoaskthequestion.You'reafraidtogivetheprompt.LastyearwhenIdidthisworkshop,therewasanelementofskillsyouhadtoteachtogetpeoplebycoding.Specifically,Aiwasn'tverygoodatfixingbugsormakingchangestocomplexcodebases.",
            "Whymostofyoudon'tsucceedwithAi.You'reafraidtoaskthequestion.You'reafraidtogivetheprompt.LastyearwhenIdidthisworkshop,therewasanelementofskillsyouhadtoteachtogetpeoplelivecodingspecifically.Aihasn'twasn'tverygoodatfixingbugsormakingchangestocomplexcodebases.That'sallbeenfixednow.youjustsimplydon'tneedtobe.",
        ];
        let liveCallIndex = 0;
        let latestPatchedTranscript = "";

        (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
            if (url === "/api/memos/live") {
                return {
                    ok: true,
                    json: async () => ({ memoId: "memo-live-no-space-dup-test" }),
                };
            }
            if (url === "/api/memos/memo-live-no-space-dup-test/share") {
                return {
                    ok: true,
                    json: async () => ({ shareUrl: "https://example.com/s/live-no-space-dup-test" }),
                };
            }
            if (url === "/api/transcribe/live") {
                const text = liveTexts[Math.min(liveCallIndex, liveTexts.length - 1)];
                liveCallIndex += 1;
                return {
                    ok: true,
                    json: async () => ({ text }),
                };
            }
            if (url === "/api/memos/memo-live-no-space-dup-test" && init?.method === "PATCH") {
                const body = JSON.parse(String(init.body ?? "{}")) as { transcript?: string };
                latestPatchedTranscript = body.transcript ?? "";
                return {
                    ok: true,
                    json: async () => ({ ok: true }),
                };
            }

            return {
                ok: true,
                json: async () => ({ text: "final transcript" }),
            };
        });

        render(<AudioRecorder />);
        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));

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

        const repeatedPrefix = "Whymostofyoudon'tsucceedwithAi.You'reafraidtoaskthequestion.You'reafraidtogivetheprompt.LastyearwhenIdidthisworkshop";
        const occurrences = latestPatchedTranscript.split(repeatedPrefix).length - 1;

        expect(occurrences).toBe(1);

        fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));
        await act(async () => {
            await Promise.resolve();
        });
    });

    it("does not duplicate when long continuous speech gets shorter revised tail windows", async () => {
        const liveTexts = [
            "I am speaking continuously for a longer stretch so the transcript grows without stopping and we can see how updates behave when context is very long and short updates arrive near the tail of this stream",
            "short update arrives near the tail of this stream while I keep talking through a brief pause",
            "short update arrives near the tail of this stream while I keep talking through a brief pause and continue with one more thought",
        ];
        let liveCallIndex = 0;
        let latestPatchedTranscript = "";

        (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
            if (url === "/api/memos/live") {
                return {
                    ok: true,
                    json: async () => ({ memoId: "memo-live-short-tail-window-test" }),
                };
            }
            if (url === "/api/memos/memo-live-short-tail-window-test/share") {
                return {
                    ok: true,
                    json: async () => ({ shareUrl: "https://example.com/s/live-short-tail-window-test" }),
                };
            }
            if (url === "/api/transcribe/live") {
                const text = liveTexts[Math.min(liveCallIndex, liveTexts.length - 1)];
                liveCallIndex += 1;
                return {
                    ok: true,
                    json: async () => ({ text }),
                };
            }
            if (url === "/api/memos/memo-live-short-tail-window-test" && init?.method === "PATCH") {
                const body = JSON.parse(String(init.body ?? "{}")) as { transcript?: string };
                latestPatchedTranscript = body.transcript ?? "";
                return {
                    ok: true,
                    json: async () => ({ ok: true }),
                };
            }

            return {
                ok: true,
                json: async () => ({ text: "final transcript" }),
            };
        });

        render(<AudioRecorder />);
        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));

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

        const normalizedTranscript = latestPatchedTranscript.toLowerCase();
        const repeatedTail = "near the tail of this stream";
        const occurrences = normalizedTranscript.split(repeatedTail).length - 1;

        expect(occurrences).toBe(1);

        fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));
        await act(async () => {
            await Promise.resolve();
        });
    });

    it("reproduces user bug: corrected no-space resend does not replace earlier long hypothesis", async () => {
        const liveTexts = [
            "steadof,youknow,respectingtheissue.Idon'treallyknow.IwanttosayisthatevenifIkeeptalking,thelongerIgothemorethehigherlikelihoodthatitwilljustduplicatethetranscripts.",
            "Insteadof,youknow,respectingtheissue.Idon'treallyknow.WhatImeantosayisthatwhenItalkextended.TheduplicationscomebackifItalkforashortamount.oftime.Idon'tthinkthere'smuchduplication.butifIjustkeeptalkingwithoutstopping,thentheduplicationshappen.",
        ];
        let liveCallIndex = 0;
        let latestPatchedTranscript = "";

        (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
            if (url === "/api/memos/live") {
                return {
                    ok: true,
                    json: async () => ({ memoId: "memo-live-user-sample-repro-1" }),
                };
            }
            if (url === "/api/memos/memo-live-user-sample-repro-1/share") {
                return {
                    ok: true,
                    json: async () => ({ shareUrl: "https://example.com/s/live-user-sample-repro-1" }),
                };
            }
            if (url === "/api/transcribe/live") {
                const text = liveTexts[Math.min(liveCallIndex, liveTexts.length - 1)];
                liveCallIndex += 1;
                return {
                    ok: true,
                    json: async () => ({ text }),
                };
            }
            if (url === "/api/memos/memo-live-user-sample-repro-1" && init?.method === "PATCH") {
                const body = JSON.parse(String(init.body ?? "{}")) as { transcript?: string };
                latestPatchedTranscript = body.transcript ?? "";
                return {
                    ok: true,
                    json: async () => ({ ok: true }),
                };
            }

            return {
                ok: true,
                json: async () => ({ text: "final transcript" }),
            };
        });

        render(<AudioRecorder />);
        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));

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

        expect(latestPatchedTranscript.startsWith("Insteadof,youknow,respectingtheissue.")).toBe(true);

        fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));
        await act(async () => {
            await Promise.resolve();
        });
    });

    it("reproduces user bug: long continuous no-space stream duplicates shared clause", async () => {
        const liveTexts = [
            "steadof,youknow,respectingtheissue.Idon'treallyknow.IwanttosayisthatevenifIkeeptalking,thelongerIgothemorethehigherlikelihoodthatitwilljustduplicatethetranscripts.",
            "Insteadof,youknow,respectingtheissue.Idon'treallyknow.WhatImeantosayisthatwhenItalkextended.TheduplicationscomebackifItalkforashortamount.oftime.Idon'tthinkthere'smuchduplication.butifIjustkeeptalkingwithoutstopping,thentheduplicationshappen.",
            "Iwantyoutowriteyourfeeling.Iwantyoutowritefailingtest.Teststhattrytoreproducethebug.Iwantyoutowritefailingtests.Testthattrytoreproducethebug.Iwantyoutowritefailingtests.Teststhattrytoreproducethebug.",
        ];
        let liveCallIndex = 0;
        let latestPatchedTranscript = "";

        (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
            if (url === "/api/memos/live") {
                return {
                    ok: true,
                    json: async () => ({ memoId: "memo-live-user-sample-repro-2" }),
                };
            }
            if (url === "/api/memos/memo-live-user-sample-repro-2/share") {
                return {
                    ok: true,
                    json: async () => ({ shareUrl: "https://example.com/s/live-user-sample-repro-2" }),
                };
            }
            if (url === "/api/transcribe/live") {
                const text = liveTexts[Math.min(liveCallIndex, liveTexts.length - 1)];
                liveCallIndex += 1;
                return {
                    ok: true,
                    json: async () => ({ text }),
                };
            }
            if (url === "/api/memos/memo-live-user-sample-repro-2" && init?.method === "PATCH") {
                const body = JSON.parse(String(init.body ?? "{}")) as { transcript?: string };
                latestPatchedTranscript = body.transcript ?? "";
                return {
                    ok: true,
                    json: async () => ({ ok: true }),
                };
            }

            return {
                ok: true,
                json: async () => ({ text: "final transcript" }),
            };
        });

        render(<AudioRecorder />);
        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));

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

        const repeatedClause = "youknow,respectingtheissue.idon'treallyknow";
        const occurrences = latestPatchedTranscript.toLowerCase().split(repeatedClause).length - 1;

        expect(occurrences).toBe(1);

        fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));
        await act(async () => {
            await Promise.resolve();
        });
    });

    it("reproduces user bug: cut-off food order windows create repeated no-space phrases", async () => {
        const liveTexts = [
            "ug.Hamburger",
            "HamburgerPi",
            "HamburgerHamburgerpizza",
            ".Pineapplehouse",
            ".F",
            "Hamburgerpizza.Pineapplehouse",
            ".Frenchfriedmilkshake.",
            "Pineapplehouse.Frenchfriedmilk.AppleHouse.Frenchfriedmilkshake.",
        ];
        let liveCallIndex = 0;
        let latestPatchedTranscript = "";

        (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
            if (url === "/api/memos/live") {
                return {
                    ok: true,
                    json: async () => ({ memoId: "memo-live-food-cutoff-repro" }),
                };
            }
            if (url === "/api/memos/memo-live-food-cutoff-repro/share") {
                return {
                    ok: true,
                    json: async () => ({ shareUrl: "https://example.com/s/live-food-cutoff-repro" }),
                };
            }
            if (url === "/api/transcribe/live") {
                const text = liveTexts[Math.min(liveCallIndex, liveTexts.length - 1)];
                liveCallIndex += 1;
                return {
                    ok: true,
                    json: async () => ({ text }),
                };
            }
            if (url === "/api/memos/memo-live-food-cutoff-repro" && init?.method === "PATCH") {
                const body = JSON.parse(String(init.body ?? "{}")) as { transcript?: string };
                latestPatchedTranscript = body.transcript ?? "";
                return {
                    ok: true,
                    json: async () => ({ ok: true }),
                };
            }

            return {
                ok: true,
                json: async () => ({ text: "final transcript" }),
            };
        });

        render(<AudioRecorder />);
        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));

        await act(async () => {
            await Promise.resolve();
        });

        for (let i = 0; i < 10; i += 1) {
            await act(async () => {
                jest.advanceTimersByTime(1500);
            });
            await act(async () => {
                await Promise.resolve();
            });
        }

        const normalizedTranscript = latestPatchedTranscript.toLowerCase();
        const pineappleOccurrences = normalizedTranscript.split("pineapplehouse").length - 1;
        const friesOccurrences = normalizedTranscript.split("frenchfriedmilkshake").length - 1;

        expect(pineappleOccurrences).toBe(1);
        expect(friesOccurrences).toBe(1);

        fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));
        await act(async () => {
            await Promise.resolve();
        });
    });

    it("does not duplicate opening phrase when gapped-window overflow resends beginning + new tail (>30 chunk scenario)", async () => {
        // Simulates a 35+ second recording where audioChunksRef exceeds LIVE_MAX_CHUNKS.
        // RIVA receives [header] + [last 29 chunks] — a gapped snapshot that starts from
        // the beginning of speech. The mock returns "opening + new tail not yet in prev",
        // which the guardrail in mergeLiveTranscript must prevent from being appended wholesale.
        const memoId = "memo-live-overflow-gap-test";

        const liveTexts = [
            "Hello everyone. Today we will cover three main topics.",
            "Hello everyone. Today we will cover three main topics. First we discuss architecture.",
            "Hello everyone. Today we will cover three main topics. First we discuss architecture. Then implementation details.",
            "Hello everyone. Today we will cover three main topics. First we discuss architecture. Then implementation details. Finally testing strategy.",
            // Overflow ticks: gapped snapshot → RIVA returns opening + genuinely new tail
            "Hello everyone. Wrap up and questions.",
            "Hello everyone. Wrap up and questions. Thank you for attending.",
        ];
        let liveCallIndex = 0;
        let latestPatchedTranscript = "";

        (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
            if (url === "/api/memos/live") {
                return { ok: true, json: async () => ({ memoId }) };
            }
            if (url === `/api/memos/${memoId}/share`) {
                return { ok: true, json: async () => ({ shareUrl: "https://example.com/s/overflow-gap-test" }) };
            }
            if (url === "/api/transcribe/live") {
                const text = liveTexts[Math.min(liveCallIndex, liveTexts.length - 1)];
                liveCallIndex += 1;
                return { ok: true, json: async () => ({ text }) };
            }
            if (url === `/api/memos/${memoId}` && (init as RequestInit | undefined)?.method === "PATCH") {
                const body = JSON.parse(String((init as RequestInit).body ?? "{}")) as { transcript?: string };
                latestPatchedTranscript = body.transcript ?? "";
                return { ok: true, json: async () => ({ ok: true }) };
            }
            return { ok: true, json: async () => ({ text: "final transcript" }) };
        });

        render(<AudioRecorder />);
        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));

        await act(async () => { await Promise.resolve(); });

        for (let i = 0; i < 12; i += 1) {
            await act(async () => { jest.advanceTimersByTime(1500); });
            await act(async () => { await Promise.resolve(); });
        }

        const openingCount = latestPatchedTranscript.split("Hello everyone.").length - 1;
        expect(openingCount).toBe(1);
        expect(latestPatchedTranscript.toLowerCase()).toContain("wrap up and questions");
        expect(latestPatchedTranscript.toLowerCase()).toContain("thank you for attending");

        fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));
        await act(async () => { await Promise.resolve(); });
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

        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));

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

    // ── Tab visibility tests ──────────────────────────────────────────────────────

    function simulateVisibilityChange(state: "hidden" | "visible") {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
        Object.defineProperty(document, "hidden", { configurable: true, value: state === "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
    }

    it("pauses live polling when tab becomes hidden", async () => {
        render(<AudioRecorder />);
        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
        await act(async () => { await Promise.resolve(); });

        // Let 3 ticks fire
        for (let i = 0; i < 3; i += 1) {
            await act(async () => { jest.advanceTimersByTime(1500); });
            await act(async () => { await Promise.resolve(); });
        }

        const fetchMock = global.fetch as jest.Mock;
        const countAfterRecording = fetchMock.mock.calls.filter(
            ([url]: [unknown]) => url === "/api/transcribe/live"
        ).length;

        // Simulate switching to another tab
        await act(async () => { simulateVisibilityChange("hidden"); });

        // Advance 5 more timer periods while "hidden"
        for (let i = 0; i < 5; i += 1) {
            await act(async () => { jest.advanceTimersByTime(1500); });
            await act(async () => { await Promise.resolve(); });
        }

        const countAfterHidden = fetchMock.mock.calls.filter(
            ([url]: [unknown]) => url === "/api/transcribe/live"
        ).length;

        // No new ticks should have fired while the tab was hidden
        expect(countAfterHidden).toBe(countAfterRecording);

        fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));
        await act(async () => { await Promise.resolve(); });
    });

    it("resumes live polling when tab becomes visible again", async () => {
        render(<AudioRecorder />);
        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
        await act(async () => { await Promise.resolve(); });

        // Baseline ticks
        for (let i = 0; i < 2; i += 1) {
            await act(async () => { jest.advanceTimersByTime(1500); });
            await act(async () => { await Promise.resolve(); });
        }

        const fetchMock = global.fetch as jest.Mock;
        const countBeforeHide = fetchMock.mock.calls.filter(
            ([url]: [unknown]) => url === "/api/transcribe/live"
        ).length;

        await act(async () => { simulateVisibilityChange("hidden"); });

        // 3 timer periods while hidden — should fire 0 ticks with the fix
        for (let i = 0; i < 3; i += 1) {
            await act(async () => { jest.advanceTimersByTime(1500); });
            await act(async () => { await Promise.resolve(); });
        }

        const countAfterHidden = fetchMock.mock.calls.filter(
            ([url]: [unknown]) => url === "/api/transcribe/live"
        ).length;

        // Return to tab
        await act(async () => { simulateVisibilityChange("visible"); });
        await act(async () => { await Promise.resolve(); }); // flush immediate tick on show

        // 3 more timer periods after becoming visible
        for (let i = 0; i < 3; i += 1) {
            await act(async () => { jest.advanceTimersByTime(1500); });
            await act(async () => { await Promise.resolve(); });
        }

        const countAfterVisible = fetchMock.mock.calls.filter(
            ([url]: [unknown]) => url === "/api/transcribe/live"
        ).length;

        // No new ticks fired while the tab was hidden
        expect(countAfterHidden).toBe(countBeforeHide);
        // Polling resumed after returning to tab
        expect(countAfterVisible).toBeGreaterThan(countAfterHidden);

        fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));
        await act(async () => { await Promise.resolve(); });
    });

    it("does not duplicate transcript when returning to tab after recording while hidden", async () => {
        const memoId = "memo-tab-switch-dup-test";
        // Sequence simulates the real-world pattern:
        //   Ticks 1-2 (visible): transcript grows
        //   Ticks while hidden: without the fix, the interval keeps firing and consumes
        //     mock responses, shifting which response the visible-return tick receives.
        //   Tick on return (visible): RIVA re-transcribes full accumulated audio —
        //     returns opening phrase + new tail, must not duplicate the opening.
        const liveTexts = [
            "Hello, this is the recording intro.",
            "Hello, this is the recording intro. I kept speaking here.",
            // Return tick — RIVA gets full audio, resends opening + new tail
            "Hello, this is the recording intro. I kept speaking here. New content after returning to the tab.",
        ];
        let liveCallIndex = 0;
        let latestPatchedTranscript = "";

        (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
            if (url === "/api/memos/live") {
                return { ok: true, json: async () => ({ memoId }) };
            }
            if (url === `/api/memos/${memoId}/share`) {
                return { ok: true, json: async () => ({ shareUrl: "https://example.com/s/tab-switch" }) };
            }
            if (url === "/api/transcribe/live") {
                const text = liveTexts[Math.min(liveCallIndex, liveTexts.length - 1)];
                liveCallIndex += 1;
                return { ok: true, json: async () => ({ text }) };
            }
            if (url === `/api/memos/${memoId}` && (init as RequestInit | undefined)?.method === "PATCH") {
                const body = JSON.parse(String((init as RequestInit).body ?? "{}")) as { transcript?: string };
                latestPatchedTranscript = body.transcript ?? "";
                return { ok: true, json: async () => ({ ok: true }) };
            }
            return { ok: true, json: async () => ({ text: "final" }) };
        });

        render(<AudioRecorder />);
        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
        await act(async () => { await Promise.resolve(); });

        // Phase 1: 2 visible ticks
        for (let i = 0; i < 2; i += 1) {
            await act(async () => { jest.advanceTimersByTime(1500); });
            await act(async () => { await Promise.resolve(); });
        }

        await act(async () => { simulateVisibilityChange("hidden"); });

        // Phase 2: 4 timer periods while hidden
        for (let i = 0; i < 4; i += 1) {
            await act(async () => { jest.advanceTimersByTime(1500); });
            await act(async () => { await Promise.resolve(); });
        }

        // Phase 3: return to tab
        await act(async () => { simulateVisibilityChange("visible"); });
        await act(async () => { await Promise.resolve(); }); // flush immediate tick

        for (let i = 0; i < 2; i += 1) {
            await act(async () => { jest.advanceTimersByTime(1500); });
            await act(async () => { await Promise.resolve(); });
        }

        // Opening phrase must appear exactly once
        const openingCount = latestPatchedTranscript.split("Hello, this is the recording intro.").length - 1;
        expect(openingCount).toBe(1);

        // Full transcript must end with the new content (confirms correct progression)
        expect(latestPatchedTranscript.toLowerCase()).toContain("new content after returning to the tab");

        // Deterministic full-string assertion
        expect(latestPatchedTranscript).toBe(
            "Hello, this is the recording intro. I kept speaking here. New content after returning to the tab."
        );

        fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));
        await act(async () => { await Promise.resolve(); });
    });

    it("does not multiply polling intervals or listeners across repeated hide/show cycles", async () => {
        render(<AudioRecorder />);
        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
        await act(async () => { await Promise.resolve(); });

        // Baseline: 2 ticks
        for (let i = 0; i < 2; i += 1) {
            await act(async () => { jest.advanceTimersByTime(1500); });
            await act(async () => { await Promise.resolve(); });
        }

        const fetchMock = global.fetch as jest.Mock;

        // 3 hide/show cycles
        for (let cycle = 0; cycle < 3; cycle += 1) {
            await act(async () => { simulateVisibilityChange("hidden"); });
            for (let i = 0; i < 2; i += 1) {
                await act(async () => { jest.advanceTimersByTime(1500); });
                await act(async () => { await Promise.resolve(); });
            }

            await act(async () => { simulateVisibilityChange("visible"); });
            await act(async () => { await Promise.resolve(); }); // flush immediate tick

            for (let i = 0; i < 2; i += 1) {
                await act(async () => { jest.advanceTimersByTime(1500); });
                await act(async () => { await Promise.resolve(); });
            }
        }

        const totalLiveCalls = fetchMock.mock.calls.filter(
            ([url]: [unknown]) => url === "/api/transcribe/live"
        ).length;

        // With multiplied listeners/intervals, calls would grow exponentially (e.g. 2^3 × 3 = 24+
        // visible-phase ticks in the last cycle alone). A correct linear implementation produces
        // 2 baseline + 3 cycles × ~3 visible ticks (immediate + 2 interval) ≈ 11.
        // We assert a generous upper bound to catch any multiplication.
        expect(totalLiveCalls).toBeLessThanOrEqual(20);

        // After stop, visibility changes must NOT restart polling
        fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));
        await act(async () => { await Promise.resolve(); });

        const countBeforePostStopVisibility = fetchMock.mock.calls.filter(
            ([url]: [unknown]) => url === "/api/transcribe/live"
        ).length;

        await act(async () => { simulateVisibilityChange("visible"); });
        await act(async () => { await Promise.resolve(); });

        for (let i = 0; i < 3; i += 1) {
            await act(async () => { jest.advanceTimersByTime(1500); });
            await act(async () => { await Promise.resolve(); });
        }

        const countAfterPostStopVisibility = fetchMock.mock.calls.filter(
            ([url]: [unknown]) => url === "/api/transcribe/live"
        ).length;

        expect(countAfterPostStopVisibility).toBe(countBeforePostStopVisibility);
    });

    it("removes visibilitychange listener on recording stop and session reset", async () => {
        render(<AudioRecorder />);
        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
        await act(async () => { await Promise.resolve(); });

        // Let 2 ticks establish a session
        for (let i = 0; i < 2; i += 1) {
            await act(async () => { jest.advanceTimersByTime(1500); });
            await act(async () => { await Promise.resolve(); });
        }

        // Stop recording — should deregister the visibilitychange listener
        fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));
        await act(async () => { await Promise.resolve(); });

        const fetchMock = global.fetch as jest.Mock;
        const countAfterStop = fetchMock.mock.calls.filter(
            ([url]: [unknown]) => url === "/api/transcribe/live"
        ).length;

        // Simulate hide + show after stopping — listener must be gone, no new ticks
        await act(async () => { simulateVisibilityChange("hidden"); });
        await act(async () => { simulateVisibilityChange("visible"); });
        await act(async () => { await Promise.resolve(); });

        for (let i = 0; i < 3; i += 1) {
            await act(async () => { jest.advanceTimersByTime(1500); });
            await act(async () => { await Promise.resolve(); });
        }

        const countAfterPostStopShow = fetchMock.mock.calls.filter(
            ([url]: [unknown]) => url === "/api/transcribe/live"
        ).length;

        expect(countAfterPostStopShow).toBe(countAfterStop);
    });

    it("preserves pre-hide transcript content when returning from a tab switch", async () => {
        const memoId = "memo-pre-hide-content-test";
        // Key design: liveTexts[2] contains ONLY post-hide content with no shared prefix
        // with the pre-hide text. This forces a real merge against non-empty state.
        // Bug scenario: if liveTranscript state is wiped on hide, mergeLiveTranscript
        // receives ("", liveTexts[2]) and returns only liveTexts[2] — all pre-hide
        // content disappears from the live display.
        const liveTexts = [
            "We were talking about the project timeline",
            "We were talking about the project timeline and the Q2 deliverables.",
            // Return tick: post-hide content only, no overlap with pre-hide phrases
            "After the break we covered the budget and the staffing plan.",
        ];
        let liveCallIndex = 0;
        let latestPatchedTranscript = "";

        (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
            if (url === "/api/memos/live") {
                return { ok: true, json: async () => ({ memoId }) };
            }
            if (url === `/api/memos/${memoId}/share`) {
                return { ok: true, json: async () => ({ shareUrl: "https://example.com/s/pre-hide" }) };
            }
            if (url === "/api/transcribe/live") {
                const text = liveTexts[Math.min(liveCallIndex, liveTexts.length - 1)];
                liveCallIndex += 1;
                return { ok: true, json: async () => ({ text }) };
            }
            if (url === `/api/memos/${memoId}` && (init as RequestInit | undefined)?.method === "PATCH") {
                const body = JSON.parse(String((init as RequestInit).body ?? "{}")) as { transcript?: string };
                latestPatchedTranscript = body.transcript ?? "";
                return { ok: true, json: async () => ({ ok: true }) };
            }
            return { ok: true, json: async () => ({ text: "final" }) };
        });

        render(<AudioRecorder />);
        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
        await act(async () => { await Promise.resolve(); });

        // Phase 1: 2 visible ticks establish the pre-hide transcript state
        for (let i = 0; i < 2; i += 1) {
            await act(async () => { jest.advanceTimersByTime(1500); });
            await act(async () => { await Promise.resolve(); });
        }

        // Phase 2: hide tab — interval clears, polling pauses, audio chunks keep accumulating
        await act(async () => { simulateVisibilityChange("hidden"); });

        for (let i = 0; i < 4; i += 1) {
            await act(async () => { jest.advanceTimersByTime(1500); });
            await act(async () => { await Promise.resolve(); });
        }

        // Phase 3: return to visible, immediate tick fires with accumulated chunks
        await act(async () => { simulateVisibilityChange("visible"); });
        await act(async () => { await Promise.resolve(); }); // flush immediate tick fetch

        for (let i = 0; i < 2; i += 1) {
            await act(async () => { jest.advanceTimersByTime(1500); });
            await act(async () => { await Promise.resolve(); });
        }

        // Both pre-hide and post-return content must appear in the persisted transcript.
        // latestPatchedTranscript mirrors liveTranscriptRef.current and preserves spaces,
        // making it the primary signal for multi-word phrase assertions.
        expect(latestPatchedTranscript.toLowerCase()).toContain("project timeline");
        expect(latestPatchedTranscript.toLowerCase()).toContain("q2 deliverables");
        expect(latestPatchedTranscript.toLowerCase()).toContain("after the break we covered the budget");

        fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));
        await act(async () => { await Promise.resolve(); });
    });

    it("fires an immediate transcript tick on tab return without waiting for the next interval", async () => {
        const memoId = "memo-immediate-tick-test";
        const liveTexts = [
            "We started recording before switching tabs.",
            // Return tick content — must appear WITHOUT advancing the 1500ms timer
            "We started recording before switching tabs. Content transcribed on immediate resume.",
        ];
        let liveCallIndex = 0;

        (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
            if (url === "/api/memos/live") {
                return { ok: true, json: async () => ({ memoId }) };
            }
            if (url === `/api/memos/${memoId}/share`) {
                return { ok: true, json: async () => ({ shareUrl: "https://example.com/s/immediate-tick" }) };
            }
            if (url === "/api/transcribe/live") {
                const text = liveTexts[Math.min(liveCallIndex, liveTexts.length - 1)];
                liveCallIndex += 1;
                return { ok: true, json: async () => ({ text }) };
            }
            if (url === `/api/memos/${memoId}` && (init as RequestInit | undefined)?.method === "PATCH") {
                return { ok: true, json: async () => ({ ok: true }) };
            }
            return { ok: true, json: async () => ({ text: "final" }) };
        });

        render(<AudioRecorder />);
        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
        await act(async () => { await Promise.resolve(); });

        // One visible tick to establish initial transcript and consume liveTexts[0]
        await act(async () => { jest.advanceTimersByTime(1500); });
        await act(async () => { await Promise.resolve(); });

        // Hide the tab — chunks continue to accumulate in audioChunksRef via MockMediaRecorder
        await act(async () => { simulateVisibilityChange("hidden"); });

        // Advance time while hidden so audio chunks accumulate (no live ticks)
        await act(async () => { jest.advanceTimersByTime(3000); });
        await act(async () => { await Promise.resolve(); });

        // Return to visible
        await act(async () => { simulateVisibilityChange("visible"); });

        // Flush promise queue only — do NOT advance the timer.
        // The immediate tick must have fired synchronously in the visibilitychange handler.
        await act(async () => { await Promise.resolve(); });
        await act(async () => { await Promise.resolve(); });

        // The return-tick content must appear without needing to wait 1500ms.
        // Words render as adjacent <span> elements with no whitespace between them in
        // textContent, so strip all whitespace before comparing.
        const bodyText = (document.body.textContent ?? "").replace(/\s/g, "").toLowerCase();
        expect(bodyText).toContain("contenttranscribedonimmediateresume");

        fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));
        await act(async () => { await Promise.resolve(); });
    });

    it("return tick sends full accumulated audio when hidden period exceeds LIVE_MAX_CHUNKS", async () => {
        // Each mock chunk is new Blob(["audio"]) = 5 bytes.
        // Snapshot of N chunks → N × 5 bytes.
        // Current overflow cap: header(5) + 29 chunks(145) = 150 bytes → fails assertion.
        // After fix (all chunks on return): header(5) + ~47 chunks(235) = ~240 bytes → passes.
        const CHUNK_BYTE_SIZE = 5;

        const returnBlobSizes: number[] = [];
        (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
            if (url === "/api/transcribe/live") {
                const file = (init?.body as FormData | undefined)?.get("file") as File | null;
                returnBlobSizes.push(file?.size ?? 0);
                return { ok: true, json: async () => ({ text: "transcribed" }) };
            }
            return { ok: true, json: async () => ({}) };
        });

        render(<AudioRecorder />);
        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
        await act(async () => { await Promise.resolve(); });

        // 2 visible ticks — populates audioChunksRef with ~2 chunks before hiding
        for (let i = 0; i < 2; i += 1) {
            await act(async () => { jest.advanceTimersByTime(1500); });
            await act(async () => { await Promise.resolve(); });
        }

        await act(async () => { simulateVisibilityChange("hidden"); });

        // 45 seconds hidden → 45 more chunks accumulate (total >> LIVE_MAX_CHUNKS = 30)
        await act(async () => { jest.advanceTimersByTime(45_000); });
        await act(async () => { await Promise.resolve(); });

        // Measure only the return tick
        returnBlobSizes.length = 0;
        await act(async () => { simulateVisibilityChange("visible"); });
        await act(async () => { await Promise.resolve(); }); // flush immediate tick fetch

        // The return tick must have sent more data than the 30-chunk overflow cap.
        // 30 chunks × 5 bytes = 150 bytes. With the fix, all ~47 chunks are included (>150).
        const LIVE_MAX_CHUNKS = 30;
        expect(returnBlobSizes.length).toBeGreaterThanOrEqual(1);
        expect(returnBlobSizes[0]).toBeGreaterThan(LIVE_MAX_CHUNKS * CHUNK_BYTE_SIZE);

        fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));
        await act(async () => { await Promise.resolve(); });
    });
});
