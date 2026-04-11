import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import LiveTranscriptView from "./LiveTranscriptView";

describe("LiveTranscriptView", () => {
    it("keeps a live transcription label without rendering diagnostics chrome", () => {
        render(
            <LiveTranscriptView
                isRecording
                isUploadActive={false}
                uploadProgressPercent={0}
                liveTranscript="hello world"
                animatedWords={["hello", "world"]}
                newWordStartIndex={0}
                recordingTime={3}
                micError={null}
                transcriptScrollRef={createRef<HTMLDivElement>()}
            />
        );

        expect(screen.getByText("Live transcription")).toBeInTheDocument();
        expect(
            screen.queryByText(/live transcription diagnostics/i)
        ).not.toBeInTheDocument();
        expect(screen.queryByText(/chunk window/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/latest asr hypothesis/i)).not.toBeInTheDocument();
    });
});
