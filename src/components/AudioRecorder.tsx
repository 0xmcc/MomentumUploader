"use client";

import { useState, useRef, useEffect } from "react";
import { Mic, Square, Loader2 } from "lucide-react";
import { motion } from "framer-motion";

const RECORDER_TIMESLICE_MS = 1000;
const LIVE_INTERVAL_MS = 1500;

export type UploadCompletePayload = {
    success?: boolean;
    text?: string;
    url?: string;
    modelUsed?: string;
    durationSeconds?: number;
};

import { useTheme } from "./ThemeProvider";

export default function AudioRecorder({
    onUploadComplete,
}: {
    onUploadComplete?: (data: UploadCompletePayload) => void;
}) {
    const [isRecording, setIsRecording] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const [isUploading, setIsUploading] = useState(false);
    const [liveTranscript, setLiveTranscript] = useState("");
    const [animatedWords, setAnimatedWords] = useState<string[]>([]);
    const [newWordStartIndex, setNewWordStartIndex] = useState(0);
    const { playbackTheme } = useTheme();

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const mimeTypeRef = useRef("audio/webm");
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const liveTimerRef = useRef<NodeJS.Timeout | null>(null);
    const liveInFlightRef = useRef(false);        // ref-based guard avoids stale closure
    const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const recordingTimeRef = useRef(0);
    const previousTranscriptRef = useRef("");

    // Keep ref in sync with state for use inside closures
    useEffect(() => { recordingTimeRef.current = recordingTime; }, [recordingTime]);

    // Auto-scroll to bottom whenever liveTranscript updates
    useEffect(() => {
        if (transcriptScrollRef.current) {
            transcriptScrollRef.current.scrollTop = transcriptScrollRef.current.scrollHeight;
        }
    }, [liveTranscript]);

    // Animate freshly-added words so transcript growth feels smooth.
    useEffect(() => {
        const nextText = liveTranscript.trim();
        if (!nextText) {
            previousTranscriptRef.current = "";
            setAnimatedWords([]);
            setNewWordStartIndex(0);
            return;
        }

        const previousText = previousTranscriptRef.current.trim();
        const nextWords = nextText.split(/\s+/).filter(Boolean);
        const previousWords = previousText ? previousText.split(/\s+/).filter(Boolean) : [];

        const isAppendOnly = !!previousText && nextText.startsWith(previousText);
        setNewWordStartIndex(isAppendOnly ? previousWords.length : 0);
        setAnimatedWords(nextWords);
        previousTranscriptRef.current = nextText;
    }, [liveTranscript]);

    // Cleanup on unmount
    useEffect(() => () => {
        if (timerRef.current) clearInterval(timerRef.current);
        if (liveTimerRef.current) clearInterval(liveTimerRef.current);
        abortRef.current?.abort();
    }, []);

    const formatTime = (s: number) => {
        const m = Math.floor(s / 60);
        return `${m.toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
    };

    /** Runs on every LIVE_INTERVAL_MS tick — sends accumulated audio for a partial transcript */
    const runLiveTick = () => {
        // Guard via ref so we never run concurrent requests
        if (liveInFlightRef.current) return;
        if (audioChunksRef.current.length === 0) return;

        liveInFlightRef.current = true;

        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        // Chunk 0 always contains the WebM container header, so
        // concatenating [0..N] always produces a valid decodable file
        const snapshot = new Blob([...audioChunksRef.current], { type: mimeTypeRef.current });

        const fd = new FormData();
        fd.append("file", snapshot, `live_${Date.now()}.webm`);

        fetch("/api/transcribe/live", { method: "POST", body: fd, signal: controller.signal })
            .then((r) => r.ok ? r.json() : Promise.reject(r.status))
            .then(({ text }: { text: string }) => {
                if (text) setLiveTranscript(text);
            })
            .catch((err) => {
                if (err?.name !== "AbortError") console.error("[live]", err);
            })
            .finally(() => {
                liveInFlightRef.current = false;
            });
    };

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: { ideal: 48000 },
                    sampleSize: { ideal: 16 },
                    channelCount: { ideal: 1 },
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                },
            });

            const mimeType = [
                "audio/webm;codecs=opus",
                "audio/webm",
                "audio/ogg;codecs=opus",
            ].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";

            mimeTypeRef.current = mimeType || "audio/webm";

            const mr = new MediaRecorder(stream, {
                ...(mimeType ? { mimeType } : {}),
                audioBitsPerSecond: 128_000,
            });

            mediaRecorderRef.current = mr;
            audioChunksRef.current = [];
            liveInFlightRef.current = false;

            mr.ondataavailable = (e) => {
                if (e.data.size <= 0) return;
                audioChunksRef.current.push(e.data);

                // Start live transcription as soon as we have the first valid chunk.
                if (audioChunksRef.current.length === 1) {
                    runLiveTick();
                }
            };

            mr.onstop = () => {
                const blob = new Blob(audioChunksRef.current, { type: mimeTypeRef.current });
                stream.getTracks().forEach((t) => t.stop());
                void handleUpload(blob);
            };

            mr.start(RECORDER_TIMESLICE_MS);
            setIsRecording(true);
            setRecordingTime(0);
            setLiveTranscript("");
            setAnimatedWords([]);
            setNewWordStartIndex(0);
            previousTranscriptRef.current = "";

            timerRef.current = setInterval(() => {
                setRecordingTime((p) => p + 1);
            }, 1000);

            // Continue fast live updates while recording.
            liveTimerRef.current = setInterval(runLiveTick, LIVE_INTERVAL_MS);

        } catch (err) {
            console.error("Mic error:", err);
        }
    };

    const stopRecording = () => {
        if (!mediaRecorderRef.current || !isRecording) return;
        if (liveTimerRef.current) clearInterval(liveTimerRef.current);
        if (timerRef.current) clearInterval(timerRef.current);
        abortRef.current?.abort();
        mediaRecorderRef.current.stop();
        setIsRecording(false);
    };

    const resetRecording = () => {
        setRecordingTime(0);
        setLiveTranscript("");
        setAnimatedWords([]);
        setNewWordStartIndex(0);
        previousTranscriptRef.current = "";
    };

    const handleUpload = async (blob: Blob) => {
        if (!blob) return;
        setIsUploading(true);
        try {
            const fd = new FormData();
            fd.append("file", blob, `memo_${Date.now()}.webm`);
            const res = await fetch("/api/transcribe", { method: "POST", body: fd });
            if (!res.ok) throw new Error("Upload failed");
            const data = (await res.json()) as Omit<UploadCompletePayload, "durationSeconds">;
            resetRecording();
            onUploadComplete?.({ ...data, durationSeconds: recordingTimeRef.current });
        } catch (err) {
            console.error("Upload error:", err);
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <div className="flex flex-col h-full w-full bg-[#121212]">
            {/* Header / Status */}
            <div className="flex justify-between items-center pl-8 pr-40 py-6 border-b border-white/5 bg-[#121212]/50 backdrop-blur-md z-10">
                <div className="flex flex-col">
                    <h2 className="text-xl font-semibold text-white/90">
                        {isRecording ? "Listening..." : (isUploading ? "Saving..." : "New Recording")}
                    </h2>
                    <p className="text-white/40 text-[10px] font-mono tracking-widest mt-1 uppercase">
                        {isRecording ? formatTime(recordingTime) : (isUploading ? "Transcribing with NVIDIA..." : "Ready to record")}
                    </p>
                </div>
                {isRecording && (
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1 h-4">
                            {Array.from({ length: 8 }).map((_, i) => (
                                <motion.div
                                    key={i}
                                    className="w-0.5 rounded-full bg-red-500/50"
                                    animate={{ height: ["4px", `${Math.random() * 12 + 4}px`, "4px"] }}
                                    transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.05 }}
                                />
                            ))}
                        </div>
                    </div>
                )}
                {isUploading && (
                    <div className="flex items-center gap-2">
                        <Loader2 size={14} className="animate-spin text-accent" />
                        <span className="text-[10px] text-accent/80 font-mono uppercase tracking-tight">Processing</span>
                    </div>
                )}
            </div>

            {/* Maximized Live Transcript Area */}
            <div className="flex-1 overflow-y-auto px-8 py-10 relative">
                <div className="max-w-3xl mx-auto">
                    {isRecording || isUploading ? (
                        <div
                            ref={transcriptScrollRef}
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
                                    {recordingTime < 1 ? "Start speaking..." : "Waiting for transcript..."}
                                </p>
                            )}
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-white/10 select-none">
                            <Mic size={80} strokeWidth={1} />
                            <p className="mt-6 text-sm font-mono uppercase tracking-[0.2em]">Tap the button below to start</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Bottom Controls */}
            <div className="bg-[#161616] border-t border-white/10 px-8 py-10 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] z-10 transition-all duration-500">
                <div className="max-w-3xl mx-auto flex flex-col items-center justify-center gap-10">
                    {/* Recording Button Shell */}
                    <div className="relative flex items-center justify-center w-28 h-28">
                        <button
                            onClick={isRecording ? stopRecording : startRecording}
                            disabled={isUploading}
                            className={`group relative flex items-center justify-center w-full h-full rounded-full transition-all duration-500 ${(isRecording || isUploading) ? "scale-110" : "hover:scale-105 active:scale-95"} ${isUploading ? "opacity-50 cursor-not-allowed" : ""}`}
                        >
                            {/* Outer Glow/Ring */}
                            <div className={`absolute inset-0 rounded-full blur-2xl transition-all duration-700 ${isRecording
                                ? "bg-red-500/40 animate-pulse"
                                : (playbackTheme === "accent" ? "bg-accent/20 group-hover:bg-accent/30" : "bg-white/5 group-hover:bg-white/10")
                                }`} />

                            {/* Background Layers */}
                            <div className="absolute inset-0 rounded-full bg-[#121212] border border-white/5 shadow-2xl" />
                            <div className={`absolute inset-2 rounded-full border border-white/5 transition-colors duration-500 ${isRecording ? "bg-red-500/10 border-red-500/20" : "bg-white/[0.02]"
                                }`} />

                            {/* Inner Ring */}
                            <div className={`absolute inset-5 rounded-full border transition-all duration-500 ${isRecording
                                ? "border-red-500/40 bg-red-500/20"
                                : (playbackTheme === "accent" ? "border-accent/20 bg-accent/10" : "border-white/10 bg-white/5")
                                }`} />

                            {/* Core Button Component */}
                            <div className={`absolute inset-[24%] rounded-full flex items-center justify-center shadow-2xl transition-all duration-500 ${isRecording
                                ? "bg-red-500 text-white shadow-red-500/40"
                                : (playbackTheme === "accent" ? "bg-white text-black group-hover:bg-accent group-hover:text-white" : "bg-white/10 text-white group-hover:bg-white group-hover:text-black")
                                }`}>
                                {isRecording ? (
                                    <Square fill="currentColor" size={28} className="animate-in zoom-in duration-300" />
                                ) : (
                                    <div className="w-6 h-6 rounded-full bg-red-600 transition-transform group-hover:scale-110" />
                                )}
                            </div>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
