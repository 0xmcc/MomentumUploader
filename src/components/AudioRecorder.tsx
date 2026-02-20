"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Mic, Square, UploadCloud, Loader2, Play, Pause, Trash2, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const LIVE_TRANSCRIBE_INTERVAL_MS = 5000; // Poll Riva every 5 seconds

export default function AudioRecorder({ onUploadComplete }: { onUploadComplete?: (data: any) => void }) {
    const [isRecording, setIsRecording] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isUploading, setIsUploading] = useState(false);

    // Live transcript state
    const [liveTranscript, setLiveTranscript] = useState("");
    const [isLiveTranscribing, setIsLiveTranscribing] = useState(false);
    const liveTranscriptAbortRef = useRef<AbortController | null>(null);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const mimeTypeRef = useRef<string>("audio/webm");
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const liveTimerRef = useRef<NodeJS.Timeout | null>(null);
    const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
    const recordingTimeRef = useRef(0); // keep in sync for use in closures

    useEffect(() => {
        recordingTimeRef.current = recordingTime;
    }, [recordingTime]);

    useEffect(() => {
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
            if (liveTimerRef.current) clearInterval(liveTimerRef.current);
            liveTranscriptAbortRef.current?.abort();
        };
    }, []);

    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    };

    /** Send all audio accumulated so far to /api/transcribe/live */
    const runLiveTranscription = useCallback(async () => {
        if (audioChunksRef.current.length === 0) return;
        if (isLiveTranscribing) return; // skip if previous request still in flight

        // Abort any pending request
        liveTranscriptAbortRef.current?.abort();
        const controller = new AbortController();
        liveTranscriptAbortRef.current = controller;

        setIsLiveTranscribing(true);

        try {
            // Concatenate chunks 0..N — always valid WebM because chunk 0 has the container header
            const blob = new Blob([...audioChunksRef.current], { type: mimeTypeRef.current });
            const fd = new FormData();
            fd.append("file", blob, `live_${Date.now()}.webm`);

            const res = await fetch("/api/transcribe/live", {
                method: "POST",
                body: fd,
                signal: controller.signal,
            });

            if (res.ok) {
                const { text } = await res.json();
                if (text) setLiveTranscript(text);
            }
        } catch (err: any) {
            if (err?.name !== "AbortError") console.error("[live transcribe]", err);
        } finally {
            setIsLiveTranscribing(false);
        }
    }, [isLiveTranscribing]);

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

            const mediaRecorder = new MediaRecorder(stream, {
                ...(mimeType ? { mimeType } : {}),
                audioBitsPerSecond: 128_000,
            });

            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    audioChunksRef.current.push(e.data);
                }
            };

            mediaRecorder.onstop = () => {
                const blob = new Blob(audioChunksRef.current, { type: mimeTypeRef.current });
                setAudioBlob(blob);
                const url = URL.createObjectURL(blob);
                setAudioUrl(url);
                stream.getTracks().forEach((t) => t.stop());
                handleUpload(blob);
            };

            // Use timeslice so ondataavailable fires frequently and we always have fresh chunks
            mediaRecorder.start(1000); // collect a chunk every 1s
            setIsRecording(true);
            setRecordingTime(0);
            setLiveTranscript("");

            // Tick the clock every second
            timerRef.current = setInterval(() => {
                setRecordingTime((prev) => prev + 1);
            }, 1000);

            // Live transcription every LIVE_TRANSCRIBE_INTERVAL_MS ms
            // Wait at least one interval before first call so we have enough audio
            liveTimerRef.current = setInterval(() => {
                runLiveTranscription();
            }, LIVE_TRANSCRIBE_INTERVAL_MS);

        } catch (err) {
            console.error("Error accessing microphone", err);
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            if (timerRef.current) clearInterval(timerRef.current);
            if (liveTimerRef.current) clearInterval(liveTimerRef.current);
            liveTranscriptAbortRef.current?.abort();
            setIsLiveTranscribing(false);
        }
    };

    const togglePlayback = () => {
        if (!audioPlayerRef.current) return;
        if (isPlaying) {
            audioPlayerRef.current.pause();
        } else {
            audioPlayerRef.current.play();
        }
        setIsPlaying(!isPlaying);
    };

    const resetRecording = () => {
        setAudioUrl(null);
        setAudioBlob(null);
        setRecordingTime(0);
        setIsPlaying(false);
        setLiveTranscript("");
    };

    const handleUpload = async (blobToUpload?: Blob) => {
        const uploadBlob = blobToUpload || audioBlob;
        if (!uploadBlob) return;

        setIsUploading(true);

        try {
            const formData = new FormData();
            formData.append("file", uploadBlob, `memo_${Date.now()}.webm`);

            const response = await fetch("/api/transcribe", {
                method: "POST",
                body: formData,
            });

            if (!response.ok) throw new Error("Upload failed");

            const data = await response.json();
            console.log("Transcription result:", data);

            resetRecording();
            if (onUploadComplete) onUploadComplete({ ...data, durationSeconds: recordingTimeRef.current });
        } catch (error) {
            console.error("Error uploading:", error);
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <div className="w-full max-w-md mx-auto bg-surface/50 border border-white/5 rounded-3xl p-8 backdrop-blur-xl shadow-2xl">
            <div className="flex flex-col items-center justify-center space-y-6">

                {/* Recording state */}
                {!audioUrl && (
                    <div className="flex flex-col items-center w-full">
                        <h2 className="text-2xl font-semibold mb-2">
                            {isRecording ? "Listening..." : "Record Memo"}
                        </h2>
                        <p className="text-white/50 text-sm font-mono tracking-widest mb-8">
                            {formatTime(recordingTime)}
                        </p>

                        <button
                            onClick={isRecording ? stopRecording : startRecording}
                            className={`relative flex items-center justify-center w-24 h-24 rounded-full transition-all duration-300 ${isRecording
                                    ? "bg-red-500/20 text-red-500 recording-pulse"
                                    : "bg-accent/20 text-accent hover:bg-accent/30 hover:scale-105"
                                }`}
                        >
                            <div className={`absolute inset-0 rounded-full border border-current ${isRecording ? "opacity-30" : "opacity-10"}`} />
                            {isRecording ? <Square fill="currentColor" size={32} /> : <Mic size={36} />}
                        </button>

                        {/* Live transcript panel */}
                        <AnimatePresence>
                            {isRecording && (
                                <motion.div
                                    initial={{ opacity: 0, y: 8, height: 0 }}
                                    animate={{ opacity: 1, y: 0, height: "auto" }}
                                    exit={{ opacity: 0, y: 8, height: 0 }}
                                    className="w-full mt-8 overflow-hidden"
                                >
                                    <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-5">
                                        {/* Header */}
                                        <div className="flex items-center gap-2 mb-3">
                                            <Sparkles size={12} className="text-accent" />
                                            <span className="text-xs font-semibold text-accent/80 uppercase tracking-widest">Live Transcript</span>
                                            {isLiveTranscribing && (
                                                <span className="ml-auto flex items-center gap-1.5 text-xs text-white/30">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                                                    Transcribing...
                                                </span>
                                            )}
                                            {!isLiveTranscribing && liveTranscript && (
                                                <span className="ml-auto text-xs text-white/20">
                                                    updates every 5s
                                                </span>
                                            )}
                                        </div>

                                        {/* Transcript text */}
                                        <div className="min-h-[60px]">
                                            {liveTranscript ? (
                                                <p className="text-white/80 text-sm leading-relaxed">
                                                    {liveTranscript}
                                                    <span className="inline-block w-0.5 h-4 bg-accent ml-0.5 animate-pulse align-middle" />
                                                </p>
                                            ) : (
                                                <p className="text-white/20 text-sm italic">
                                                    {recordingTime < 5
                                                        ? "Start speaking — first update in ~5s"
                                                        : "Waiting for first transcript..."}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                )}

                {/* Review & upload state */}
                {audioUrl && (
                    <AnimatePresence>
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="flex flex-col items-center w-full"
                        >
                            <h2 className="text-xl font-medium mb-2">Processing Recording</h2>
                            <p className="text-white/40 text-sm mb-6">Uploading and transcribing with NVIDIA Parakeet...</p>

                            <audio
                                ref={audioPlayerRef}
                                src={audioUrl}
                                onEnded={() => setIsPlaying(false)}
                                className="hidden"
                            />

                            <div className="flex items-center space-x-6 mb-8 w-full justify-center">
                                <button
                                    onClick={resetRecording}
                                    disabled={isUploading}
                                    className="p-4 rounded-full bg-white/5 text-white/60 hover:text-white hover:bg-white/10 transition disabled:opacity-50"
                                    aria-label="Delete recording"
                                >
                                    <Trash2 size={24} />
                                </button>

                                <button
                                    onClick={togglePlayback}
                                    disabled={isUploading}
                                    className="p-6 rounded-full bg-white/10 text-white hover:bg-white/15 transition shadow-lg disabled:opacity-50"
                                    aria-label="Play or Pause"
                                >
                                    {isPlaying ? <Pause size={28} /> : <Play size={28} className="translate-x-0.5" />}
                                </button>

                                <button
                                    onClick={() => handleUpload()}
                                    disabled={isUploading}
                                    className="p-4 rounded-full bg-accent/20 text-accent hover:bg-accent hover:text-white transition shadow-[0_0_20px_rgba(139,92,246,0.2)] disabled:opacity-50"
                                    aria-label="Upload to Cloud"
                                >
                                    {isUploading ? <Loader2 className="animate-spin" size={24} /> : <UploadCloud size={24} />}
                                </button>
                            </div>

                            {isUploading && (
                                <div className="flex items-center gap-2 text-sm text-accent animate-pulse">
                                    <Loader2 size={14} className="animate-spin" />
                                    Uploading and transcribing...
                                </div>
                            )}
                        </motion.div>
                    </AnimatePresence>
                )}
            </div>
        </div>
    );
}
