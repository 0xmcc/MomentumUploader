import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { supabase } from "@/lib/supabase";
import AudioRecorder from "./AudioRecorder";

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

    constructor() { }

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

describe("AudioRecorder live transcript cadence", () => {
    const uploadToSignedUrl = jest.fn();

    beforeEach(() => {
        jest.useFakeTimers();
        uploadToSignedUrl.mockReset();
        uploadToSignedUrl.mockResolvedValue({ data: { path: "" }, error: null });
        (supabase.storage.from as jest.Mock).mockReturnValue({
            uploadToSignedUrl,
        });

        Object.defineProperty(global, "fetch", {
            writable: true,
            value: jest.fn().mockImplementation(async (url: string, init?: RequestInit) => {
                if (url === "/api/transcribe/upload-chunks") {
                    return signedUploadResponse(init);
                }
                return {
                    ok: true,
                    json: async () => ({ text: "partial transcript" }),
                };
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

    it("flushes pending chunks and finalizes the memo upon stopping", async () => {
        global.URL.createObjectURL = jest.fn(() => "blob:http://localhost/test");
        const memoId = "memo-stop-finalize";

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
                    json: async () => ({ shareUrl: "https://example.com/s/finalize" }),
                };
            }

            if (url === `/api/memos/${memoId}` && init?.method === "PATCH") {
                return {
                    ok: true,
                    json: async () => ({ ok: true }),
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

        render(<AudioRecorder />);

        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));

        await act(async () => {
            await flushMicrotasks(2);
        });
        expect(await screen.findByText(/open live page/i)).toBeInTheDocument();

        await act(async () => {
            jest.advanceTimersByTime(2000);
        });

        fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));

        await act(async () => {
            await flushMicrotasks(4);
        });

        const fetchMock = global.fetch as jest.Mock;

        await waitFor(() => {
            expect(
                fetchMock.mock.calls.filter(
                    ([url]: [unknown]) => url === "/api/transcribe/upload-chunks"
                ).length
            ).toBeGreaterThanOrEqual(1);
            expect(
                fetchMock.mock.calls.filter(
                    ([url]: [unknown]) => url === "/api/transcribe/finalize"
                )
            ).toHaveLength(1);
            expect(
                fetchMock.mock.calls.filter(
                    ([url]: [unknown]) => url === "/api/transcribe"
                )
            ).toHaveLength(0);
        });

        const chunkUploadCalls = fetchMock.mock.calls.filter(
            ([url]: [unknown]) => url === "/api/transcribe/upload-chunks"
        );
        const finalizeCalls = fetchMock.mock.calls.filter(
            ([url]: [unknown]) => url === "/api/transcribe/finalize"
        );

        expect(readPrepareRequest(chunkUploadCalls[0]?.[1] as RequestInit)).toEqual({
            memoId,
            startIndex: 0,
            endIndex: 2,
            contentType: expect.stringContaining("audio/webm"),
        });
        const [uploadPath, uploadToken, uploadBlob, uploadOptions] = uploadToSignedUrl.mock.calls[0] ?? [];
        expect(uploadPath).toBe("audio/chunks/memo-stop-finalize/0000000-0000002.webm");
        expect(uploadToken).toBe("signed-upload-token-0-2");
        expect(uploadBlob).toBeInstanceOf(Blob);
        expect(uploadOptions).toEqual(
            expect.objectContaining({
                contentType: expect.stringContaining("audio/webm"),
                upsert: true,
            })
        );

        expect(JSON.parse(String(finalizeCalls[0]?.[1]?.body))).toEqual({
            memoId,
            totalChunks: 2,
            provisionalTranscript: "partial transcript",
        });
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
            ([url]: [unknown]) =>
                url === "/api/transcribe" ||
                url === "/api/transcribe/upload-chunks" ||
                url === "/api/transcribe/finalize"
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

        expect(screen.getByText("New Recording")).toBeInTheDocument();
        expect(screen.getByRole("img", { name: "Upload in progress" })).toBeInTheDocument();
        expect(screen.getByRole("img", { name: "Uploading audio at 42%" })).toBeInTheDocument();
        expect(screen.queryByText("Saving...")).not.toBeInTheDocument();
        expect(screen.queryByRole("progressbar", { name: "Upload in progress" })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: /start recording/i })).toBeDisabled();
        expect(screen.getByRole("button", { name: /upload mp3\/m4a/i })).toBeDisabled();
    });

    it("shows a live transcription label without diagnostics chrome while recording", async () => {
        render(<AudioRecorder />);

        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));

        await act(async () => { await Promise.resolve(); });
        await act(async () => { jest.advanceTimersByTime(1500); });
        await act(async () => { await Promise.resolve(); });

        expect(screen.getByText("Live transcription")).toBeInTheDocument();
        expect(screen.queryByText(/live transcription diagnostics/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/chunk window/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/latest asr hypothesis/i)).not.toBeInTheDocument();
    });

    it("keeps the live transcription label visible during longer live sessions", async () => {
        render(<AudioRecorder />);

        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));

        await act(async () => { await Promise.resolve(); });

        for (let i = 0; i < 35; i += 1) {
            await act(async () => { jest.advanceTimersByTime(1500); });
            await act(async () => { await Promise.resolve(); });
        }

        expect(screen.getByText("Live transcription")).toBeInTheDocument();
        expect(screen.queryByText(/live transcription diagnostics/i)).not.toBeInTheDocument();
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
        expect(maxLivePayloadBytes).toBeLessThanOrEqual(150);

        fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));
        await act(async () => {
            await Promise.resolve();
        });
    });

    it("replaces the current tail hypothesis instead of stitching overlapping windows together", async () => {
        const memoId = "memo-tail-replace-overlap";
        const liveTexts = [
            "interface but it's not recommended",
            "it's not recommended because there are debugging messages",
            "because there are debugging messages that come out here and then",
        ];
        let liveCallIndex = 0;
        let latestPatchedTranscript = "";

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
                    json: async () => ({ shareUrl: "https://example.com/s/tail-replace-overlap" }),
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
            if (url === `/api/memos/${memoId}` && init?.method === "PATCH") {
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
        expect(latestPatchedTranscript.toLowerCase()).not.toContain("interface but it's not recommended");

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

    it("persists the latest no-space tail hypothesis without merging earlier windows into it", async () => {
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

        expect(latestPatchedTranscript).toBe(liveTexts[liveTexts.length - 1]);
        expect(latestPatchedTranscript.toLowerCase()).not.toContain("youknow,respectingtheissue.idon'treallyknow");

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

    async function flushMicrotasks(count = 1) {
        for (let i = 0; i < count; i += 1) {
            await Promise.resolve();
        }
    }

    it("continues live polling while the recording tab is hidden", async () => {
        render(<AudioRecorder />);
        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
        await act(async () => { await Promise.resolve(); });

        for (let i = 0; i < 3; i += 1) {
            await act(async () => { jest.advanceTimersByTime(1500); });
            await act(async () => { await Promise.resolve(); });
        }

        const fetchMock = global.fetch as jest.Mock;
        const countBeforeHide = fetchMock.mock.calls.filter(
            ([url]: [unknown]) => url === "/api/transcribe/live"
        ).length;

        await act(async () => { simulateVisibilityChange("hidden"); });

        for (let i = 0; i < 4; i += 1) {
            await act(async () => { jest.advanceTimersByTime(1500); });
            await act(async () => { await Promise.resolve(); });
        }

        const countAfterHidden = fetchMock.mock.calls.filter(
            ([url]: [unknown]) => url === "/api/transcribe/live"
        ).length;

        expect(countAfterHidden).toBeGreaterThan(countBeforeHide);

        fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));
        await act(async () => { await Promise.resolve(); });
    });

    it("keeps live polling monotonic across hidden and visible transitions", async () => {
        render(<AudioRecorder />);
        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
        await act(async () => { await Promise.resolve(); });

        for (let i = 0; i < 2; i += 1) {
            await act(async () => { jest.advanceTimersByTime(1500); });
            await act(async () => { await Promise.resolve(); });
        }

        const fetchMock = global.fetch as jest.Mock;
        const countBeforeHide = fetchMock.mock.calls.filter(
            ([url]: [unknown]) => url === "/api/transcribe/live"
        ).length;

        await act(async () => { simulateVisibilityChange("hidden"); });

        for (let i = 0; i < 3; i += 1) {
            await act(async () => { jest.advanceTimersByTime(1500); });
            await act(async () => { await Promise.resolve(); });
        }

        const countAfterHidden = fetchMock.mock.calls.filter(
            ([url]: [unknown]) => url === "/api/transcribe/live"
        ).length;

        await act(async () => { simulateVisibilityChange("visible"); });
        await act(async () => { await Promise.resolve(); });

        for (let i = 0; i < 2; i += 1) {
            await act(async () => { jest.advanceTimersByTime(1500); });
            await act(async () => { await Promise.resolve(); });
        }

        const countAfterVisible = fetchMock.mock.calls.filter(
            ([url]: [unknown]) => url === "/api/transcribe/live"
        ).length;

        expect(countAfterHidden).toBeGreaterThan(countBeforeHide);
        expect(countAfterVisible).toBeGreaterThan(countAfterHidden);

        fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));
        await act(async () => { await Promise.resolve(); });
    });

    it("publishes deduplicated transcript progress while hidden without waiting for tab return", async () => {
        const memoId = "memo-hidden-progress-test";
        const liveTexts = [
            "Opening statement.",
            "Opening statement. Visible details.",
            "Opening statement. Visible details. Hidden sentence one.",
        ];
        let liveCallIndex = 0;
        let latestPatchedTranscript = "";

        (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
            if (url === "/api/memos/live") {
                return { ok: true, json: async () => ({ memoId }) };
            }
            if (url === `/api/memos/${memoId}/share`) {
                return { ok: true, json: async () => ({ shareUrl: "https://example.com/s/hidden-progress" }) };
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

        for (let i = 0; i < 2; i += 1) {
            await act(async () => { jest.advanceTimersByTime(1500); });
            await act(async () => { await Promise.resolve(); });
        }

        await act(async () => { simulateVisibilityChange("hidden"); });

        for (let i = 0; i < 2; i += 1) {
            await act(async () => { jest.advanceTimersByTime(1500); });
            await act(async () => { await Promise.resolve(); });
        }

        await act(async () => { await Promise.resolve(); });
        await act(async () => { await Promise.resolve(); });

        const openingCount = latestPatchedTranscript.split("Opening statement.").length - 1;
        expect(openingCount).toBe(1);
        expect(latestPatchedTranscript).toContain("Visible details.");
        expect(latestPatchedTranscript).toContain("Hidden sentence one.");

        fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));
        await act(async () => { await Promise.resolve(); });
    });

    it("keeps catch-up requests bounded even when hidden backlog exceeds the immediate burst budget", async () => {
        const returnBlobSizes: number[] = [];

        (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
            if (url === "/api/transcribe/live") {
                const file = (init?.body as FormData | undefined)?.get("file") as File | null;
                returnBlobSizes.push(file?.size ?? 0);
                return { ok: true, json: async () => ({ text: `transcribed-${returnBlobSizes.length}` }) };
            }
            return { ok: true, json: async () => ({}) };
        });

        render(<AudioRecorder />);
        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
        await act(async () => { await Promise.resolve(); });

        for (let i = 0; i < 2; i += 1) {
            await act(async () => { jest.advanceTimersByTime(1500); });
            await act(async () => { await Promise.resolve(); });
        }

        await act(async () => { simulateVisibilityChange("hidden"); });
        await act(async () => { jest.advanceTimersByTime(180_000); });
        await act(async () => { await Promise.resolve(); });

        returnBlobSizes.length = 0;
        await act(async () => { simulateVisibilityChange("visible"); });
        await act(async () => { await flushMicrotasks(8); });

        for (let i = 0; i < 4; i += 1) {
            await act(async () => { jest.advanceTimersByTime(1500); });
            await act(async () => { await flushMicrotasks(4); });
        }

        expect(returnBlobSizes.length).toBeGreaterThanOrEqual(7);
        expect(returnBlobSizes.slice(0, 3)).toEqual([80, 80, 80]);
        expect(Math.max(...returnBlobSizes)).toBeLessThanOrEqual(150);

        fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));
        await act(async () => { await Promise.resolve(); });
    });

    it("persists the latest hidden tail hypothesis verbatim instead of rewriting it locally", async () => {
        const memoId = "memo-hidden-internal-duplicate-test";
        const liveTexts = [
            "Are you recording now? Testing. Testing. Come on, you gotta be working. I need you like God needs the devil on a Sunday soon this do' settle.",
            "Are you recording now? Testing. Testing. Come on, you gotta be working. I need you like God needs the devil on a Sunday soon this do' settle. Okay, I'm wondering if this is gonna still work? We're gonna keep trying and talking.",
            "Are you recording now? Testing. Testing. Come on, you gotta be working. I need you like God needs the devil on a Sunday soon this do' settle. Okay, I'm wondering if this is gonna still work? We're gonna keep trying and talking. Come on, you gotta be working. I need you like God needs the devil on a Sunday soon this do' settle. Okay, I'm wondering if this is gonna still work? We're gonna keep trying and talking. And hopefully this keeps recording.",
        ];
        let liveCallIndex = 0;
        let latestPatchedTranscript = "";

        (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
            if (url === "/api/memos/live") {
                return { ok: true, json: async () => ({ memoId }) };
            }
            if (url === `/api/memos/${memoId}/share`) {
                return { ok: true, json: async () => ({ shareUrl: "https://example.com/s/hidden-internal-duplicate" }) };
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

        for (let i = 0; i < 2; i += 1) {
            await act(async () => { jest.advanceTimersByTime(1500); });
            await act(async () => { await Promise.resolve(); });
        }

        await act(async () => { simulateVisibilityChange("hidden"); });

        for (let i = 0; i < 2; i += 1) {
            await act(async () => { jest.advanceTimersByTime(1500); });
            await act(async () => { await Promise.resolve(); });
        }
        await act(async () => { await Promise.resolve(); });
        await act(async () => { await Promise.resolve(); });
        await act(async () => { await Promise.resolve(); });

        expect(latestPatchedTranscript).toBe(liveTexts[liveTexts.length - 1]);

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

    it("replaces a superseded pre-hide tail when a newer bounded tail arrives after tab return", async () => {
        const memoId = "memo-pre-hide-content-test";
        const liveTexts = [
            "We were talking about the project timeline",
            "We were talking about the project timeline and the Q2 deliverables.",
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

        expect(latestPatchedTranscript).toBe(liveTexts[liveTexts.length - 1]);
        expect(latestPatchedTranscript.toLowerCase()).not.toContain("project timeline");

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

    it("return catch-up always ends with an immediate bounded tail refresh after the capped finalization burst", async () => {
        const returnBlobSizes: number[] = [];
        (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
            if (url === "/api/transcribe/live") {
                const file = (init?.body as FormData | undefined)?.get("file") as File | null;
                returnBlobSizes.push(file?.size ?? 0);
                return { ok: true, json: async () => ({ text: `transcribed-${returnBlobSizes.length}` }) };
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

        // 180 seconds hidden → after 3 finalizations there is still a large backlog remaining.
        await act(async () => { jest.advanceTimersByTime(180_000); });
        await act(async () => { await Promise.resolve(); });

        // Measure only the immediate return catch-up drain, without waiting for the interval timer.
        returnBlobSizes.length = 0;
        await act(async () => { simulateVisibilityChange("visible"); });
        await act(async () => { await flushMicrotasks(8); });

        expect(returnBlobSizes.slice(0, 3)).toEqual([80, 80, 80]);
        expect(returnBlobSizes[3]).toBeLessThanOrEqual(150);
        expect(Math.max(...returnBlobSizes)).toBeLessThanOrEqual(150);

        fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));
        await act(async () => { await Promise.resolve(); });
    });

    it("never persists a shorter transcript during rollover before the replacement tail lands", async () => {
        const memoId = "memo-segment-rollover";
        const patchTranscripts: string[] = [];
        let liveCallCount = 0;
        let resolveFinalization: (() => void) | null = null;
        let resolveReplacementTail: (() => void) | null = null;
        let sawFullTailWindow = false;

        (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
            if (url === "/api/memos/live") {
                return { ok: true, json: async () => ({ memoId }) };
            }
            if (url === `/api/memos/${memoId}/share`) {
                return { ok: true, json: async () => ({ shareUrl: "https://example.com/s/segment-rollover" }) };
            }
            if (url === "/api/transcribe/live") {
                const file = (init?.body as FormData | undefined)?.get("file") as File | null;
                const size = file?.size ?? 0;
                liveCallCount += 1;
                if (size >= 145) {
                    sawFullTailWindow = true;
                }

                if (size === 80 && sawFullTailWindow && !resolveFinalization) {
                    return new Promise((resolve) => {
                        resolveFinalization = () => {
                            resolve({ ok: true, json: async () => ({ text: "locked segment alpha" }) });
                        };
                    });
                }

                if (resolveFinalization) {
                    return new Promise((resolve) => {
                        resolveReplacementTail = () => {
                            resolve({ ok: true, json: async () => ({ text: "tail segment beta" }) });
                        };
                    });
                }

                return { ok: true, json: async () => ({ text: `locked segment alpha draft tail ${liveCallCount}` }) };
            }
            if (url === `/api/memos/${memoId}` && init?.method === "PATCH") {
                const body = JSON.parse(String(init.body ?? "{}")) as { transcript?: string };
                patchTranscripts.push(body.transcript ?? "");
                return { ok: true, json: async () => ({ ok: true }) };
            }
            return { ok: true, json: async () => ({}) };
        });

        render(<AudioRecorder />);
        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));

        await act(async () => { await flushMicrotasks(2); });

        for (let i = 0; i < 20 && !resolveFinalization; i += 1) {
            await act(async () => { jest.advanceTimersByTime(1500); });
            await act(async () => { await flushMicrotasks(3); });
        }

        expect(resolveFinalization).not.toBeNull();
        const patchCountBeforeFinalization = patchTranscripts.length;
        const previousTranscript = patchTranscripts[patchTranscripts.length - 1] ?? "";

        resolveFinalization?.();
        for (
            let i = 0;
            i < 10 && !resolveReplacementTail;
            i += 1
        ) {
            await act(async () => { await flushMicrotasks(4); });
        }

        const intermediateTranscripts = patchTranscripts.slice(patchCountBeforeFinalization);

        for (const transcript of intermediateTranscripts) {
            expect(transcript.length).toBeGreaterThanOrEqual(previousTranscript.length);
        }

        for (
            let i = 0;
            i < 10 && !(patchTranscripts[patchTranscripts.length - 1] ?? "").includes("tail segment beta");
            i += 1
        ) {
            if (resolveReplacementTail) {
                resolveReplacementTail();
                resolveReplacementTail = null;
            } else {
                await act(async () => { jest.advanceTimersByTime(1500); });
            }
            await act(async () => { await flushMicrotasks(4); });
        }

        const nextTranscript = patchTranscripts[patchTranscripts.length - 1] ?? "";
        expect(patchTranscripts.length).toBeGreaterThan(patchCountBeforeFinalization);
        expect(nextTranscript).toBe("locked segment alpha tail segment beta");

        fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));
        await act(async () => { await Promise.resolve(); });
    });

    it("keeps locked segment text at the front of every later tail update", async () => {
        const memoId = "memo-locked-prefix";
        const patchTranscripts: string[] = [];
        let sawFinalization = false;
        let tailUpdateCount = 0;

        (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
            if (url === "/api/memos/live") {
                return { ok: true, json: async () => ({ memoId }) };
            }
            if (url === `/api/memos/${memoId}/share`) {
                return { ok: true, json: async () => ({ shareUrl: "https://example.com/s/locked-prefix" }) };
            }
            if (url === "/api/transcribe/live") {
                const file = (init?.body as FormData | undefined)?.get("file") as File | null;
                const size = file?.size ?? 0;
                if (size === 80) {
                    sawFinalization = true;
                    return { ok: true, json: async () => ({ text: "locked segment alpha" }) };
                }
                if (sawFinalization) {
                    tailUpdateCount += 1;
                    return { ok: true, json: async () => ({ text: `tail update ${tailUpdateCount}` }) };
                }
                return { ok: true, json: async () => ({ text: `warmup ${patchTranscripts.length + 1}` }) };
            }
            if (url === `/api/memos/${memoId}` && init?.method === "PATCH") {
                const body = JSON.parse(String(init.body ?? "{}")) as { transcript?: string };
                patchTranscripts.push(body.transcript ?? "");
                return { ok: true, json: async () => ({ ok: true }) };
            }
            return { ok: true, json: async () => ({}) };
        });

        render(<AudioRecorder />);
        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));

        await act(async () => { await flushMicrotasks(2); });

        for (let i = 0; i < 24; i += 1) {
            await act(async () => { jest.advanceTimersByTime(1500); });
            await act(async () => { await flushMicrotasks(3); });
        }

        const postLockTranscripts = patchTranscripts.filter((transcript) => transcript.startsWith("locked segment alpha"));

        expect(postLockTranscripts.length).toBeGreaterThanOrEqual(5);
        for (const transcript of postLockTranscripts) {
            expect(transcript.startsWith("locked segment alpha")).toBe(true);
        }

        fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));
        await act(async () => { await Promise.resolve(); });
    });

    it("stopping during catch-up aborts safely and persists canonical locked state", async () => {
        const memoId = "memo-stop-during-catchup";
        const liveBlobSizes: number[] = [];
        const patchTranscripts: string[] = [];
        const unhandledRejections: unknown[] = [];
        const abortError = Object.assign(new Error("Aborted"), { name: "AbortError" });

        const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
            unhandledRejections.push(event.reason);
            event.preventDefault();
        };

        window.addEventListener("unhandledrejection", handleUnhandledRejection);

        (global.fetch as jest.Mock).mockImplementation((url: string, init?: RequestInit) => {
            if (url === "/api/memos/live") {
                return Promise.resolve({ ok: true, json: async () => ({ memoId }) });
            }
            if (url === `/api/memos/${memoId}/share`) {
                return Promise.resolve({ ok: true, json: async () => ({ shareUrl: "https://example.com/s/stop-catchup" }) });
            }
            if (url === "/api/transcribe/live") {
                const file = (init?.body as FormData | undefined)?.get("file") as File | null;
                const size = file?.size ?? 0;
                liveBlobSizes.push(size);

                if (liveBlobSizes.length === 1) {
                    return Promise.resolve({ ok: true, json: async () => ({ text: "warmup transcript" }) });
                }

                if (liveBlobSizes.length === 2) {
                    return Promise.resolve({ ok: true, json: async () => ({ text: "locked segment alpha" }) });
                }

                if (liveBlobSizes.length === 3) {
                    return new Promise((_resolve, reject) => {
                        init?.signal?.addEventListener(
                            "abort",
                            () => reject(abortError),
                            { once: true }
                        );
                    });
                }

                return Promise.resolve({
                    ok: true,
                    json: async () => ({ text: "final tail after stop" }),
                });
            }
            if (url === `/api/memos/${memoId}` && init?.method === "PATCH") {
                const body = JSON.parse(String(init.body ?? "{}")) as { transcript?: string };
                patchTranscripts.push(body.transcript ?? "");
                return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        render(<AudioRecorder />);
        fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
        await act(async () => { await flushMicrotasks(2); });

        await act(async () => { jest.advanceTimersByTime(1500); });
        await act(async () => { await flushMicrotasks(3); });

        await act(async () => { simulateVisibilityChange("hidden"); });
        await act(async () => { jest.advanceTimersByTime(60_000); });
        await act(async () => { await flushMicrotasks(2); });

        await act(async () => { simulateVisibilityChange("visible"); });
        for (let i = 0; i < 20 && liveBlobSizes.filter((size) => size === 80).length < 1; i += 1) {
            await act(async () => { await flushMicrotasks(3); });
        }

        expect(liveBlobSizes.filter((size) => size === 80).length).toBeGreaterThanOrEqual(1);
        const liveCallCountAtStop = liveBlobSizes.length;

        fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));
        await act(async () => { await flushMicrotasks(4); });

        window.removeEventListener("unhandledrejection", handleUnhandledRejection);

        expect(unhandledRejections).toHaveLength(0);
        expect(liveBlobSizes.length).toBe(liveCallCountAtStop + 1);
        const latestTranscript = patchTranscripts[patchTranscripts.length - 1] ?? "";
        expect(latestTranscript).toBe("locked segment alpha");
    });
});
