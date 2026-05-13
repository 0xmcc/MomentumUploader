import path from "path";

const execFileMock = jest.fn();
const loadSyncMock = jest.fn();
const loadPackageDefinitionMock = jest.fn();

type MockStreamingCall = {
    write: jest.Mock;
    end: jest.Mock;
    on: jest.Mock;
};

jest.mock("ffmpeg-static", () => "/opt/ffmpeg-static/ffmpeg", { virtual: true });

jest.mock("child_process", () => ({
    execFile: (...args: unknown[]) => execFileMock(...args),
}));

jest.mock("@grpc/proto-loader", () => ({
    loadSync: (...args: unknown[]) => loadSyncMock(...args),
}));

jest.mock("@grpc/grpc-js", () => {
    class MockMetadata {
        public set() {
            // no-op for tests
        }
    }

    return {
        Metadata: MockMetadata,
        credentials: {
            createSsl: jest.fn(() => ({})),
        },
        loadPackageDefinition: (...args: unknown[]) => loadPackageDefinitionMock(...args),
    };
});

function makeStreamingCall(responses: unknown[]): MockStreamingCall {
    const handlers: Record<string, Array<(value?: unknown) => void>> = {};
    const call: MockStreamingCall = {
        write: jest.fn(),
        end: jest.fn(() => {
            for (const response of responses) {
                for (const handler of handlers.data ?? []) handler(response);
            }
            for (const handler of handlers.end ?? []) handler();
        }),
        on: jest.fn((event: string, handler: (value?: unknown) => void) => {
            handlers[event] = handlers[event] ?? [];
            handlers[event].push(handler);
            return call;
        }),
    };
    return call;
}

describe("riva transcription runtime dependencies", () => {
    beforeEach(() => {
        jest.resetModules();
        execFileMock.mockReset();
        loadSyncMock.mockReset();
        loadPackageDefinitionMock.mockReset();

        loadSyncMock.mockReturnValue({});
        loadPackageDefinitionMock.mockReturnValue({
            nvidia: {
                riva: {
                    asr: {
                        RivaSpeechRecognition: jest.fn().mockImplementation(() => ({
                            StreamingRecognize: jest.fn(() =>
                                makeStreamingCall([
                                    {
                                        results: [
                                            {
                                                alternatives: [{ transcript: "ok" }],
                                                is_final: true,
                                            },
                                        ],
                                    },
                                ])
                            ),
                        })),
                    },
                },
            },
        });

        execFileMock.mockImplementation(
            (
                _command: string,
                args: string[],
                callback: (err: Error | null, stdout: string, stderr: string) => void
            ) => {
                const fs = require("fs");
                const outputPath = args[args.length - 1];
                fs.writeFileSync(outputPath, Buffer.from([0, 1, 2, 3]));
                callback(null, "", "");
            }
        );
    });

    it("uses a bundled ffmpeg binary path instead of relying on plain 'ffmpeg' in PATH", async () => {
        const { transcribeAudio } = await import("./riva");

        await transcribeAudio(Buffer.from("fake-audio"), "test-api-key", "audio/webm");

        expect(execFileMock).toHaveBeenCalled();
        const [ffmpegCommand] = execFileMock.mock.calls[0] as [string, string[]];
        expect(ffmpegCommand).not.toBe("ffmpeg");
        expect(ffmpegCommand).toBe(path.join(process.cwd(), "node_modules/ffmpeg-static/ffmpeg"));
    });

    it("uses StreamingRecognize for NVIDIA NVCF because unary Recognize rejects hosted Parakeet requests", async () => {
        execFileMock.mockImplementation(
            (
                _command: string,
                args: string[],
                callback: (err: Error | null, stdout: string, stderr: string) => void
            ) => {
                const fs = require("fs");
                const outputPath = args[args.length - 1];
                const format = args[args.indexOf("-f") + 1];
                const output =
                    format === "wav"
                        ? Buffer.from("RIFF....WAVEfmt ", "ascii")
                        : Buffer.from([0, 1, 2, 3]);
                fs.writeFileSync(outputPath, output);
                callback(null, "", "");
            }
        );
        const streamingCall = makeStreamingCall([
            {
                results: [
                    {
                        alternatives: [{ transcript: "streamed ok" }],
                        is_final: true,
                        audio_processed: 1.9,
                    },
                ],
            },
        ]);
        const recognizeMock = jest.fn(
            (
                _request: unknown,
                _metadata: unknown,
                callback: (err: Error | null, response?: unknown) => void
            ) => {
                callback(Object.assign(new Error("3 INVALID_ARGUMENT"), { code: 3 }));
            }
        );
        loadPackageDefinitionMock.mockReturnValue({
            nvidia: {
                riva: {
                    asr: {
                        RivaSpeechRecognition: jest.fn().mockImplementation(() => ({
                            Recognize: recognizeMock,
                            StreamingRecognize: jest.fn(() => streamingCall),
                        })),
                    },
                },
            },
        });

        const { transcribeAudio } = await import("./riva");

        await expect(transcribeAudio(Buffer.from("fake-audio"), "test-api-key", "audio/webm")).resolves.toMatchObject({
            transcript: "streamed ok",
            segments: [{ startMs: 0, endMs: 1900, text: "streamed ok" }],
        });
        expect(recognizeMock).not.toHaveBeenCalled();
        expect(streamingCall.write).toHaveBeenNthCalledWith(1, {
            streaming_config: {
                config: {
                    language_code: "en-US",
                    max_alternatives: 1,
                    enable_automatic_punctuation: true,
                },
                interim_results: true,
            },
        });
        expect(streamingCall.write).toHaveBeenNthCalledWith(2, {
            audio_content: Buffer.from("RIFF....WAVEfmt ", "ascii"),
        });
    });

    it("returns { transcript, segments } with correct startMs/endMs derived from audio_processed", async () => {
        loadPackageDefinitionMock.mockReturnValue({
            nvidia: {
                riva: {
                    asr: {
                        RivaSpeechRecognition: jest.fn().mockImplementation(() => ({
                            StreamingRecognize: jest.fn(() =>
                                makeStreamingCall([
                                    {
                                        results: [
                                            { alternatives: [{ transcript: "Hello world" }], is_final: true, audio_processed: 2.5 },
                                            { alternatives: [{ transcript: "How are you" }], is_final: true, audio_processed: 5.0 },
                                        ],
                                    },
                                ])
                            ),
                        })),
                    },
                },
            },
        });

        const { transcribeAudio } = await import("./riva");
        const result = await transcribeAudio(Buffer.from("fake-audio"), "test-api-key", "audio/webm");

        expect(result.transcript).toBe("Hello world How are you");
        expect(result.segments).toHaveLength(2);

        expect(result.segments[0]).toMatchObject({ id: "0", startMs: 0, endMs: 2500, text: "Hello world" });
        expect(result.segments[1]).toMatchObject({ id: "1", startMs: 2500, endMs: 5000, text: "How are you" });
    });

    it("guards against audio_processed=0: segment endMs is always strictly greater than startMs", async () => {
        loadPackageDefinitionMock.mockReturnValue({
            nvidia: {
                riva: {
                    asr: {
                        RivaSpeechRecognition: jest.fn().mockImplementation(() => ({
                            StreamingRecognize: jest.fn(() =>
                                makeStreamingCall([
                                    {
                                        results: [
                                            // audio_processed missing / 0 on first segment
                                            { alternatives: [{ transcript: "Zero time segment" }], is_final: true },
                                            { alternatives: [{ transcript: "Normal segment" }], is_final: true, audio_processed: 3.0 },
                                        ],
                                    },
                                ])
                            ),
                        })),
                    },
                },
            },
        });

        const { transcribeAudio } = await import("./riva");
        const result = await transcribeAudio(Buffer.from("fake-audio"), "test-api-key", "audio/webm");

        expect(result.segments).toHaveLength(2);
        expect(result.segments[0].endMs).toBeGreaterThan(result.segments[0].startMs);
        expect(result.segments[1].startMs).toBe(result.segments[0].endMs);
    });
});
