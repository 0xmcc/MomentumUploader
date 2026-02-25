const execFileMock = jest.fn();
const loadSyncMock = jest.fn();
const loadPackageDefinitionMock = jest.fn();
const metadataSetMock = jest.fn();

jest.mock("ffmpeg-static", () => "/ROOT/node_modules/ffmpeg-static/ffmpeg", { virtual: true });

jest.mock("child_process", () => ({
    execFile: (...args: unknown[]) => execFileMock(...args),
}));

jest.mock("@grpc/proto-loader", () => ({
    loadSync: (...args: unknown[]) => loadSyncMock(...args),
}));

jest.mock("@grpc/grpc-js", () => {
    class MockMetadata {
        public set(...args: unknown[]) {
            metadataSetMock(...args);
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

describe("riva metadata auth header", () => {
    beforeEach(() => {
        jest.resetModules();
        execFileMock.mockReset();
        loadSyncMock.mockReset();
        loadPackageDefinitionMock.mockReset();
        metadataSetMock.mockReset();

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

    it("trims API key whitespace before setting authorization metadata", async () => {
        const { transcribeAudio } = await import("./riva");

        await transcribeAudio(Buffer.from("fake-audio"), "test-api-key\n", "audio/webm");

        expect(metadataSetMock).toHaveBeenCalledWith("authorization", "Bearer test-api-key");
    });
});
