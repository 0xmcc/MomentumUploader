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
        <div className="w-full max-w-md mx-auto bg-surface/50 border border-white/5 rounded-3xl p-8 backdrop-blur-xl shadow-2xl">
            <div className="flex flex-col items-center space-y-6">

                {/* ── Recording state ── */}
                {!audioUrl && (
                    <div className="flex flex-col items-center w-full">
                        <h2 className="text-2xl font-semibold mb-1">
                            {isRecording ? "Listening..." : "Record Memo"}
                        </h2>
                        <p className="text-white/40 text-sm font-mono tracking-widest mb-6">
                            {formatTime(recordingTime)}
                        </p>

                        {isRecording && (
                            <div className="mb-6">
                                <WaveformBars />
                            </div>
                        )}

                        {/* Mic / Stop button */}
                        <button
                            onClick={isRecording ? stopRecording : startRecording}
                            className={`relative flex items-center justify-center w-24 h-24 rounded-full transition-all duration-300 ${isRecording
                                ? "bg-red-500/20 text-red-500"
                                : "bg-accent/20 text-accent hover:bg-accent/30 hover:scale-105"
                                }`}
                        >
                            <div className={`absolute inset-0 rounded-full border border-current ${isRecording ? "opacity-40 animate-ping" : "opacity-10"}`} />
                            <div className="absolute inset-0 rounded-full border border-current opacity-20" />
                            {isRecording ? <Square fill="currentColor" size={32} /> : <Mic size={36} />}
                        </button>

                        {/* ── Live transcript panel ── */}
                        <AnimatePresence>
                            {isRecording && (
                                <motion.div
                                    initial={{ opacity: 0, y: 10, height: 0 }}
                                    animate={{ opacity: 1, y: 0, height: "auto" }}
                                    exit={{ opacity: 0, y: 10, height: 0 }}
                                    transition={{ duration: 0.25 }}
                                    className="w-full mt-8 overflow-hidden"
                                >
                                    <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-5">
                                        {/* Panel header */}
                                        <div className="flex items-center gap-2 mb-3">
                                            <Sparkles size={12} className="text-accent" />
                                            <span className="text-xs font-bold text-accent/80 uppercase tracking-widest">
                                                Live Transcript
                                            </span>

                                            {liveStatus === "pending" && (
                                                <span className="ml-auto flex items-center gap-1.5 text-xs text-white/30">
                                                    <Loader2 size={10} className="animate-spin" />
                                                    Transcribing…
                                                </span>
                                            )}
                                            {liveStatus === "ok" && (
                                                <span className="ml-auto text-xs text-white/20">
                                                    updating live
                                                </span>
                                            )}
                                            {liveStatus === "idle" && recordingTime >= RECORDER_TIMESLICE_MS / 1000 && (
                                                <span className="ml-auto text-xs text-white/20">
                                                    listening…
                                                </span>
                                            )}
                                        </div>

                                        {/* Transcript text — scrollable, auto-scrolls to bottom */}
                                        <div
                                            ref={transcriptScrollRef}
                                            className="max-h-40 overflow-y-auto pr-1 scrollbar-thin"
                                            style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(139,92,246,0.3) transparent" }}
                                        >
                                            {liveTranscript ? (
                                                <p className="text-white/80 text-sm leading-relaxed min-h-[40px]">
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
                                                    <motion.span
                                                        className="inline-block w-0.5 h-[1em] bg-accent/80 ml-0.5 align-middle"
                                                        animate={{ opacity: [1, 0, 1] }}
                                                        transition={{ duration: 1, repeat: Infinity }}
                                                    />
                                                </p>
                                            ) : (
                                                <p className="text-white/25 text-sm italic min-h-[40px]">
                                                    {recordingTime < RECORDER_TIMESLICE_MS / 1000
                                                        ? "First update in ~1s — start speaking"
                                                        : "Waiting for transcript…"}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                )}

                {/* ── Post-record / uploading state ── */}
                {audioUrl && (
                    <AnimatePresence>
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="flex flex-col items-center w-full"
                        >
                            <h2 className="text-xl font-medium mb-1">
                                {isUploading ? "Transcribing…" : "Review Recording"}
                            </h2>
                            <p className="text-white/35 text-sm mb-8">
                                {isUploading ? "Uploading to Supabase · Running NVIDIA Parakeet" : "Play it back or upload to save"}
                            </p>

                            <audio
                                ref={audioPlayerRef}
                                src={audioUrl}
                                onEnded={() => setIsPlaying(false)}
                                className="hidden"
                            />

                            <div className="flex items-center space-x-6 w-full justify-center">
                                <button
                                    onClick={resetRecording}
                                    disabled={isUploading}
                                    className="p-4 rounded-full bg-white/5 text-white/60 hover:text-white hover:bg-white/10 transition disabled:opacity-40"
                                    aria-label="Discard"
                                >
                                    <Trash2 size={22} />
                                </button>

                                <button
                                    onClick={togglePlayback}
                                    disabled={isUploading}
                                    className="p-6 rounded-full bg-white/10 text-white hover:bg-white/15 transition shadow-lg disabled:opacity-40"
                                    aria-label="Play"
                                >
                                    {isPlaying ? <Pause size={26} /> : <Play size={26} className="translate-x-0.5" />}
                                </button>

                                <button
                                    onClick={() => handleUpload()}
                                    disabled={isUploading}
                                    className="p-4 rounded-full bg-accent/20 text-accent hover:bg-accent hover:text-white transition shadow-[0_0_20px_rgba(139,92,246,0.3)] disabled:opacity-40"
                                    aria-label="Save"
                                >
                                    {isUploading
                                        ? <Loader2 className="animate-spin" size={22} />
                                        : <UploadCloud size={22} />}
                                </button>
                            </div>

                            {isUploading && (
                                <div className="mt-6 flex items-center gap-2 text-sm text-accent/70">
                                    <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                                    Running full transcription…
                                </div>
                            )}

                            {/* Show last live transcript as a preview while uploading */}
                            {liveTranscript && isUploading && (
                                <div className="mt-4 w-full bg-white/[0.02] border border-white/5 rounded-xl p-4">
                                    <p className="text-xs text-white/30 mb-1 font-mono uppercase tracking-widest">Last live preview</p>
                                    <p className="text-white/50 text-sm leading-relaxed">{liveTranscript}</p>
                                </div>
                            )}
                        </motion.div>
                    </AnimatePresence>
                )}
            </div>
        </div>
    );
}
