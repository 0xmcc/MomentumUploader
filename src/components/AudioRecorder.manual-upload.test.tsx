/**
 * Manual file upload must never fail silently.
 *
 * Reported 2026-09-18: a 49MB .m4a exported from Voice Memos was picked with
 * "Upload audio" and nothing happened — no spinner end state, no message, no
 * row. The failure only existed in the browser console, so from the outside the
 * app looked like it had ignored the click.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import AudioRecorder from "@/components/AudioRecorder";
import { MAX_AUDIO_UPLOAD_MB } from "@/app/api/transcribe/workflow.shared";

const setMicError = jest.fn();
let micError: string | null = null;

jest.mock("@/components/ThemeProvider", () => ({
    useTheme: () => ({ playbackTheme: {} }),
}));

jest.mock("@/hooks/useAudioRecording", () => ({
    useAudioRecording: () => ({
        isRecording: false,
        recordingTime: 0,
        recordingTimeRef: { current: 0 },
        micError,
        setMicError: (value: string | null) => {
            micError = value;
            setMicError(value);
        },
        audioChunksRef: { current: [] },
        mimeTypeRef: { current: "audio/webm" },
        webmHeaderRef: { current: null },
        startRecording: jest.fn(),
        stopRecording: jest.fn(),
        resetRecording: jest.fn(),
    }),
}));

jest.mock("@/hooks/useArtifacts", () => ({
    useArtifacts: () => ({ artifacts: [], isLoading: false }),
}));

jest.mock("@/hooks/useChunkUpload", () => ({
    useChunkUpload: () => ({
        chunkPruneOffsetRef: { current: 0 },
        flushRemainingChunks: jest.fn(),
        resetChunkUpload: jest.fn(),
    }),
}));

jest.mock("@/hooks/useLiveTranscription", () => ({
    useLiveTranscription: () => ({
        liveTranscript: "",
        animatedWords: [],
        newWordStartIndex: 0,
        shouldAnimateNewChunks: false,
        liveDebug: null,
        transcriptScrollRef: { current: null },
        liveMemoId: null,
        liveShareUrl: null,
        liveShareState: "idle",
        beginRecordingSession: jest.fn(),
        endRecordingSession: jest.fn(),
        resetLiveSession: jest.fn(),
        handleRecordedChunkAvailable: jest.fn(),
        runLiveTick: jest.fn(),
        runFinalTailTick: jest.fn(),
        handleCopyLiveShare: jest.fn(),
        getLiveShareLabel: () => "",
    }),
}));

const uploadManualAudioBySignedUrl = jest.fn();

jest.mock("@/lib/audio-upload", () => {
    const actual = jest.requireActual("@/lib/audio-upload");
    return {
        ...actual,
        uploadManualAudioBySignedUrl: (...args: unknown[]) =>
            uploadManualAudioBySignedUrl(...args),
    };
});

function makeFile(name: string, type: string, sizeBytes: number) {
    const file = new File(["x"], name, { type });
    Object.defineProperty(file, "size", { value: sizeBytes });
    return file;
}

function selectFile(file: File) {
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("no file input rendered");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);
}

beforeEach(() => {
    micError = null;
    setMicError.mockClear();
    uploadManualAudioBySignedUrl.mockReset();
});

describe("manual audio upload failures", () => {
    it("tells the user when the upload fails instead of only logging it", async () => {
        uploadManualAudioBySignedUrl.mockRejectedValue(new Error("Upload failed"));

        render(<AudioRecorder />);
        selectFile(makeFile("Mohammed 1.m4a", "audio/x-m4a", 51_842_670));

        await waitFor(() => {
            expect(uploadManualAudioBySignedUrl).toHaveBeenCalled();
        });

        await waitFor(() => {
            expect(setMicError).toHaveBeenCalledWith(
                expect.stringMatching(/upload/i)
            );
        });
    });

    it("renders that failure where the user can see it", async () => {
        uploadManualAudioBySignedUrl.mockRejectedValue(new Error("Upload failed"));

        render(<AudioRecorder />);
        selectFile(makeFile("Mohammed 1.m4a", "audio/x-m4a", 51_842_670));

        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent(/upload/i);
    });

    it("refuses a file over the server limit before attempting the upload", async () => {
        render(<AudioRecorder />);
        selectFile(
            makeFile("huge.m4a", "audio/x-m4a", (MAX_AUDIO_UPLOAD_MB + 10) * 1024 * 1024)
        );

        await waitFor(() => {
            expect(setMicError).toHaveBeenCalledWith(
                expect.stringContaining(`${MAX_AUDIO_UPLOAD_MB}MB`)
            );
        });
        expect(uploadManualAudioBySignedUrl).not.toHaveBeenCalled();
    });
});
