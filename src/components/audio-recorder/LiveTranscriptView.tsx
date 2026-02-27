import { Mic } from "lucide-react";
import { motion } from "framer-motion";
import type { MutableRefObject } from "react";

type LiveTranscriptViewProps = {
    isRecording: boolean;
    isUploadActive: boolean;
    uploadProgressPercent: number;
    liveTranscript: string;
    animatedWords: string[];
    newWordStartIndex: number;
    recordingTime: number;
    micError: string | null;
    transcriptScrollRef: MutableRefObject<HTMLDivElement | null>;
};

export default function LiveTranscriptView({
    isRecording,
    isUploadActive,
    uploadProgressPercent,
    liveTranscript,
    animatedWords,
    newWordStartIndex,
    recordingTime,
    micError,
    transcriptScrollRef,
}: LiveTranscriptViewProps) {
    return (
        <div ref={transcriptScrollRef} className="flex-1 overflow-y-auto flex flex-col">
            <div className={`flex-1 max-w-3xl mx-auto w-full px-8 py-10 flex flex-col ${(isRecording || isUploadActive) ? "justify-end" : "justify-center items-center"}`}>
                {isRecording || isUploadActive ? (
                    <div
                        className="text-lg leading-relaxed"
                    >
                        {liveTranscript ? (
                            <p className="text-white/80 whitespace-pre-wrap">
                                {animatedWords.map((word, index) => {
                                    const isNewWord = index >= newWordStartIndex;
                                    return (
                                        <motion.span
                                            key={`${index}-${word}`}
                                            className="inline-block mr-1"
                                            initial={
                                                isNewWord
                                                    ? { opacity: 0, y: 8, filter: "blur(6px)" }
                                                    : false
                                            }
                                            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                                            transition={{
                                                duration: 0.32,
                                                ease: [0.22, 1, 0.36, 1],
                                                delay: isNewWord ? (index - newWordStartIndex) * 0.03 : 0,
                                            }}
                                        >
                                            {word}
                                        </motion.span>
                                    );
                                })}
                                {isRecording && (
                                    <motion.span
                                        className="inline-block w-0.5 h-[1em] bg-accent/80 ml-0.5 align-middle"
                                        animate={{ opacity: [1, 0, 1] }}
                                        transition={{ duration: 1, repeat: Infinity }}
                                    />
                                )}
                            </p>
                        ) : (
                            <p className="text-white/20 text-lg italic italic">
                                {isUploadActive
                                    ? uploadProgressPercent >= 100
                                        ? "Upload complete. Transcribing..."
                                        : `Uploading... ${uploadProgressPercent}%`
                                    : recordingTime < 1
                                        ? "Start speaking..."
                                        : "Waiting for transcript..."}
                            </p>
                        )}
                    </div>
                ) : (
                    <div className="flex flex-col items-center text-white/10 select-none">
                        {micError && (
                            <p
                                role="alert"
                                className="mb-4 max-w-md text-center text-xs font-medium tracking-wide text-red-400"
                            >
                                {micError}
                            </p>
                        )}
                        <Mic size={80} strokeWidth={1} />
                        <p className="mt-6 text-sm font-mono uppercase tracking-[0.2em]">Tap the button below to start</p>
                    </div>
                )}
            </div>
        </div>
    );
}
