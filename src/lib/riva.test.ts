import path from "path";

const execFileMock = jest.fn();
const loadSyncMock = jest.fn();
const loadPackageDefinitionMock = jest.fn();

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
                            Recognize: (
                                _request: unknown,
                                _metadata: unknown,
                                callback: (err: Error | null, response?: unknown) => void
                            ) => {
                                callback(null, {
                                    results: [{ alternatives: [{ transcript: "ok" }] }],
                                });
                            },
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

    it("returns { transcript, segments } with correct startMs/endMs derived from audio_processed", async () => {
        loadPackageDefinitionMock.mockReturnValue({
            nvidia: {
                riva: {
                    asr: {
                        RivaSpeechRecognition: jest.fn().mockImplementation(() => ({
                            Recognize: (
                                _request: unknown,
                                _metadata: unknown,
                                callback: (err: Error | null, response?: unknown) => void
                            ) => {
                                callback(null, {
                                    results: [
                                        { alternatives: [{ transcript: "Hello world" }], audio_processed: 2.5 },
                                        { alternatives: [{ transcript: "How are you" }], audio_processed: 5.0 },
                                    ],
                                });
                            },
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
                            Recognize: (
                                _request: unknown,
                                _metadata: unknown,
                                callback: (err: Error | null, response?: unknown) => void
                            ) => {
                                callback(null, {
                                    results: [
                                        // audio_processed missing / 0 on first segment
                                        { alternatives: [{ transcript: "Zero time segment" }] },
                                        { alternatives: [{ transcript: "Normal segment" }], audio_processed: 3.0 },
                                    ],
                                });
                            },
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
