import React, { createRef } from "react";
import { render, screen } from "@testing-library/react";
import LiveTranscriptView from "./LiveTranscriptView";

jest.mock("framer-motion", () => {
    const motion = new Proxy(
        {},
        {
            get: (_target, key) => {
                return ({
                    children,
                    initial,
                    transition,
                    ...props
                }: {
                    children?: React.ReactNode;
                    initial?: false | { opacity?: number; y?: number; filter?: string };
                    transition?: { delay?: number };
                }) =>
                    React.createElement(
                        typeof key === "string" ? key : "div",
                        {
                            ...props,
                            "data-motion-initial": initial === false ? "false" : JSON.stringify(initial),
                            "data-motion-delay": String(transition?.delay ?? 0),
                        },
                        children
                    );
            },
        }
    );

    return { motion };
});

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
                shouldAnimateNewChunks
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

    it("renders catch-up transcript without staggered reveal when chunk animation is suppressed", () => {
        const { container } = render(
            <LiveTranscriptView
                isRecording
                isUploadActive={false}
                uploadProgressPercent={0}
                liveTranscript="Short opening sentence. Catch-up arrives as one chunk."
                animatedWords={[
                    "Short opening sentence. ",
                    "Catch-up arrives as one chunk.",
                ]}
                newWordStartIndex={1}
                shouldAnimateNewChunks={false}
                recordingTime={8}
                micError={null}
                transcriptScrollRef={createRef<HTMLDivElement>()}
            />
        );

        const spans = Array.from(
            container.querySelectorAll('span[data-motion-delay]')
        ).filter((element) => !element.className.includes("w-0.5"));

        expect(spans).toHaveLength(2);
        expect(spans[1]).toHaveAttribute("data-motion-delay", "0");
        expect(spans[1]).toHaveAttribute("data-motion-initial", "false");
    });
});
