import path from "path";

const execFileMock = jest.fn();
const loadSyncMock = jest.fn();
const loadPackageDefinitionMock = jest.fn();

jest.mock("ffmpeg-static", () => "/ROOT/node_modules/ffmpeg-static/ffmpeg", { virtual: true });

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

describe("riva ffmpeg path resolution on Vercel", () => {
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

    it("maps /ROOT ffmpeg-static paths to the runtime working directory", async () => {
        const { transcribeAudio } = await import("./riva");

        await transcribeAudio(Buffer.from("fake-audio"), "test-api-key", "audio/webm");

        expect(execFileMock).toHaveBeenCalled();
        const [ffmpegCommand] = execFileMock.mock.calls[0] as [string, string[]];
        expect(ffmpegCommand).toBe(path.join(process.cwd(), "node_modules/ffmpeg-static/ffmpeg"));
    });
});
