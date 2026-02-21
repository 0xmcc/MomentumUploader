"use client";

import { useState, useRef, useEffect } from "react";
import { Mic, Square, Loader2, Play, Pause, Trash2, Sparkles, UploadCloud } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const RECORDER_TIMESLICE_MS = 1000;
const LIVE_INTERVAL_MS = 1500;

export type UploadCompletePayload = {
    success?: boolean;
    text?: string;
    url?: string;
    modelUsed?: string;
    durationSeconds?: number;
};

export default function AudioRecorder({
    onUploadComplete,
}: {
    onUploadComplete?: (data: UploadCompletePayload) => void;
}) {
    const [isRecording, setIsRecording] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [liveTranscript, setLiveTranscript] = useState("");
    const [animatedWords, setAnimatedWords] = useState<string[]>([]);
    const [newWordStartIndex, setNewWordStartIndex] = useState(0);
    const [liveStatus, setLiveStatus] = useState<"idle" | "pending" | "ok">("idle");

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
    const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

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
        setLiveStatus("pending");

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
                setLiveStatus("ok");
            })
            .catch((err) => {
                if (err?.name !== "AbortError") console.error("[live]", err);
                setLiveStatus("idle");
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
                setAudioBlob(blob);
                setAudioUrl(URL.createObjectURL(blob));
                stream.getTracks().forEach((t) => t.stop());
            };

            mr.start(RECORDER_TIMESLICE_MS);
            setIsRecording(true);
            setRecordingTime(0);
            setLiveTranscript("");
            setAnimatedWords([]);
            setNewWordStartIndex(0);
            previousTranscriptRef.current = "";
            setLiveStatus("idle");

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
        setLiveStatus("idle");
    };

    const resetRecording = () => {
        setAudioUrl(null);
        setAudioBlob(null);
        setRecordingTime(0);
        setIsPlaying(false);
        setLiveTranscript("");
        setAnimatedWords([]);
        setNewWordStartIndex(0);
        previousTranscriptRef.current = "";
        setLiveStatus("idle");
    };

    const handleUpload = async (blobToUpload?: Blob) => {
        const blob = blobToUpload || audioBlob;
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

    const togglePlayback = () => {
        if (!audioPlayerRef.current) return;
        if (isPlaying) {
            audioPlayerRef.current.pause();
        } else {
            void audioPlayerRef.current.play();
        }
        setIsPlaying(!isPlaying);
    };

    // Waveform bars shown while recording
    const WaveformBars = () => (
        <div className="flex items-center gap-1 h-8">
            {Array.from({ length: 12 }).map((_, i) => (
                <motion.div
                    key={i}
                    className="w-1 rounded-full bg-red-400/70"
                    animate={{ height: isRecording ? ["6px", `${Math.random() * 24 + 6}px`, "6px"] : "6px" }}
                    transition={{ duration: 0.6 + i * 0.05, repeat: Infinity, ease: "easeInOut", delay: i * 0.04 }}
                />
            ))}
        </div>
    );

    return (
        <div className="flex flex-col h-full w-full bg-[#121212]">
            {/* Header / Status */}
            <div className="flex justify-between items-center px-8 py-6 border-b border-white/5 bg-[#121212]/50 backdrop-blur-md z-10">
                <div className="flex flex-col">
                    <h2 className="text-xl font-semibold text-white/90">
                        {isRecording ? "Listening..." : (audioUrl ? "Review Recording" : "New Recording")}
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
                    ) : !audioUrl ? (
                        <div className="h-full flex flex-col items-center justify-center text-white/10 select-none">
                            <Mic size={80} strokeWidth={1} />
                            <p className="mt-6 text-sm font-mono uppercase tracking-[0.2em]">Tap the button below to start</p>
                        </div>
                    ) : (
                        <div className="text-lg text-white/40 italic">
                            Recording finished. You can review it before saving.
                        </div>
                    )}
                </div>
            </div>

            {/* Bottom Controls */}
            <div className="bg-[#161616] border-t border-white/10 px-8 py-10 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] z-10">
                <div className="max-w-3xl mx-auto flex flex-col items-center justify-center">

                    {!audioUrl ? (
                        <button
                            onClick={isRecording ? stopRecording : startRecording}
                            className={`relative flex items-center justify-center w-20 h-20 rounded-full transition-all duration-300 shadow-2xl ${isRecording
                                ? "bg-red-500 text-white scale-110"
                                : "bg-white text-black hover:scale-105 active:scale-95"
                                }`}
                        >
                            {isRecording ? <Square fill="currentColor" size={24} /> : <div className="w-6 h-6 rounded-full bg-red-600 active:scale-90" />}
                        </button>
                    ) : (
                        <div className="flex items-center gap-8">
                            <button
                                onClick={resetRecording}
                                disabled={isUploading}
                                className="w-12 h-12 rounded-full bg-white/5 text-white/40 hover:text-white hover:bg-white/10 transition flex items-center justify-center disabled:opacity-20"
                                title="Discard"
                            >
                                <Trash2 size={20} />
                            </button>

                            <button
                                onClick={togglePlayback}
                                disabled={isUploading}
                                className="w-20 h-20 rounded-full bg-white text-black hover:scale-105 active:scale-95 shadow-2xl flex items-center justify-center transition-all disabled:opacity-50"
                                title="Play"
                            >
                                {isPlaying ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" className="translate-x-0.5" />}
                            </button>

                            <button
                                onClick={() => handleUpload()}
                                disabled={isUploading}
                                className="w-12 h-12 rounded-full bg-accent text-white hover:scale-105 active:scale-95 shadow-lg flex items-center justify-center transition-all disabled:opacity-50 group"
                                title="Save to Cloud"
                            >
                                {isUploading ? <Loader2 size={20} className="animate-spin" /> : <UploadCloud size={20} />}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
