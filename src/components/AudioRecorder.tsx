"use client";

import { useState, useRef, useEffect, type ChangeEvent } from "react";
import { Mic, Square, Loader2, Link2, Check } from "lucide-react";
import { motion } from "framer-motion";
import { useTheme } from "./ThemeProvider";
import {
    DEFAULT_PENDING_MIME_TYPE,
    MANUAL_UPLOAD_ACCEPT,
    getFileExtensionFromMime,
    resolveUploadMimeType,
} from "@/lib/audio-upload";
import { copyToClipboard } from "@/lib/memo-ui";

const RECORDER_TIMESLICE_MS = 1000;
const LIVE_INTERVAL_MS = 1500;
const LIVE_MAX_CHUNKS = 30;

function mergeLiveTranscript(previous: string, incoming: string): string {
    const normalize = (text: string) => text.trim().replace(/\s+/g, " ");

    const prev = normalize(previous);
    const next = normalize(incoming);

    if (!next) return prev;
    if (!prev) return next;
    if (next.startsWith(prev)) return next;
    if (prev.includes(next)) return prev;

    const prevWords = prev.split(" ");
    const nextWords = next.split(" ");
    const maxOverlap = Math.min(prevWords.length, nextWords.length);

    for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
        const prevSuffix = prevWords.slice(-overlap).join(" ").toLowerCase();
        const nextPrefix = nextWords.slice(0, overlap).join(" ").toLowerCase();
        if (prevSuffix === nextPrefix) {
            const appendedTail = nextWords.slice(overlap).join(" ");
            return appendedTail ? `${prev} ${appendedTail}` : prev;
        }
    }

    return `${prev} ${next}`;
}

export type UploadCompletePayload = {
    id?: string;
    success?: boolean;
    text?: string;
    url?: string;
    modelUsed?: string;
    durationSeconds?: number;
};

export type AudioInputPayload = {
    blob: Blob;
    durationSeconds: number;
    mimeType: string;
    memoId?: string;
};

type LiveShareState = "idle" | "loading" | "ready" | "copied" | "error";

export default function AudioRecorder({
    isUploadInProgress = false,
    uploadProgressPercent = 0,
    onUploadComplete,
    onAudioInput,
}: {
    isUploadInProgress?: boolean;
    uploadProgressPercent?: number;
    onUploadComplete?: (data: UploadCompletePayload) => void;
    onAudioInput?: (payload: AudioInputPayload) => void;
}) {
    const [isRecording, setIsRecording] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const [isUploading, setIsUploading] = useState(false);
    const [micError, setMicError] = useState<string | null>(null);
    const [liveTranscript, setLiveTranscript] = useState("");
    const [animatedWords, setAnimatedWords] = useState<string[]>([]);
    const [newWordStartIndex, setNewWordStartIndex] = useState(0);
    const [liveMemoId, setLiveMemoId] = useState<string | null>(null);
    const [liveShareUrl, setLiveShareUrl] = useState<string | null>(null);
    const [liveShareState, setLiveShareState] = useState<LiveShareState>("idle");
    const { playbackTheme } = useTheme();
    const isUploadActive = isUploading || isUploadInProgress;

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const mimeTypeRef = useRef(DEFAULT_PENDING_MIME_TYPE);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const liveTimerRef = useRef<NodeJS.Timeout | null>(null);
    const liveInFlightRef = useRef(false);        // ref-based guard avoids stale closure
    const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const recordingTimeRef = useRef(0);
    const previousTranscriptRef = useRef("");
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const liveMemoIdRef = useRef<string | null>(null);
    const liveSyncInFlightRef = useRef(false);
    const pendingLiveTranscriptRef = useRef<string | null>(null);
    const syncedLiveTranscriptRef = useRef("");
    const liveShareResetTimerRef = useRef<NodeJS.Timeout | null>(null);

    // Keep ref in sync with state for use inside closures
    useEffect(() => { recordingTimeRef.current = recordingTime; }, [recordingTime]);
    useEffect(() => { liveMemoIdRef.current = liveMemoId; }, [liveMemoId]);

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
        if (liveShareResetTimerRef.current) clearTimeout(liveShareResetTimerRef.current);
        abortRef.current?.abort();
    }, []);

    const clearLiveShareResetTimer = () => {
        if (liveShareResetTimerRef.current) {
            clearTimeout(liveShareResetTimerRef.current);
            liveShareResetTimerRef.current = null;
        }
    };

    const resetLiveShareSession = () => {
        clearLiveShareResetTimer();
        setLiveMemoId(null);
        setLiveShareUrl(null);
        setLiveShareState("idle");
        liveMemoIdRef.current = null;
        pendingLiveTranscriptRef.current = null;
        syncedLiveTranscriptRef.current = "";
        liveSyncInFlightRef.current = false;
    };

    const persistLiveTranscript = async () => {
        if (liveSyncInFlightRef.current) return;
        const memoId = liveMemoIdRef.current;
        const transcript = pendingLiveTranscriptRef.current;
        if (!memoId || transcript == null) return;

        const normalizedTranscript = transcript.trim();
        if (!normalizedTranscript) {
            pendingLiveTranscriptRef.current = null;
            return;
        }
        if (normalizedTranscript === syncedLiveTranscriptRef.current.trim()) {
            pendingLiveTranscriptRef.current = null;
            return;
        }

        liveSyncInFlightRef.current = true;
        pendingLiveTranscriptRef.current = null;

        try {
            const res = await fetch(`/api/memos/${memoId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ transcript: normalizedTranscript }),
            });
            if (!res.ok) {
                throw new Error(`Live transcript update failed: ${res.status}`);
            }
            syncedLiveTranscriptRef.current = normalizedTranscript;
        } catch (err) {
            console.error("[live-sync]", err);
        } finally {
            liveSyncInFlightRef.current = false;
            const pendingTranscript = pendingLiveTranscriptRef.current as string | null;
            const hasPendingUpdate =
                typeof pendingTranscript === "string" &&
                pendingTranscript.trim() !== syncedLiveTranscriptRef.current.trim();
            if (hasPendingUpdate) {
                void persistLiveTranscript();
            }
        }
    };

    useEffect(() => {
        if (!liveMemoId || !liveTranscript.trim()) return;
        pendingLiveTranscriptRef.current = liveTranscript;
        void persistLiveTranscript();
    }, [liveMemoId, liveTranscript]);

    const requestLiveShareUrl = async (memoId: string): Promise<string> => {
        const shareRes = await fetch(`/api/memos/${memoId}/share`, { method: "POST" });
        const shareJson = await shareRes.json().catch(() => null);
        const nextShareUrl = typeof shareJson?.shareUrl === "string" ? shareJson.shareUrl : null;
        if (!shareRes.ok || !nextShareUrl) {
            throw new Error("Unable to create live share link.");
        }
        return nextShareUrl;
    };

    const startLiveShareSession = async () => {
        setLiveShareState("loading");
        try {
            const liveMemoRes = await fetch("/api/memos/live", { method: "POST" });
            if (liveMemoRes.status === 401) {
                resetLiveShareSession();
                return;
            }

            const liveMemoJson = await liveMemoRes.json().catch(() => null);
            const memoId = typeof liveMemoJson?.memoId === "string" ? liveMemoJson.memoId : null;
            if (!liveMemoRes.ok || !memoId) {
                throw new Error("Unable to initialize live memo.");
            }

            setLiveMemoId(memoId);
            const nextShareUrl = await requestLiveShareUrl(memoId);
            setLiveShareUrl(nextShareUrl);
            setLiveShareState("ready");
        } catch (err) {
            console.error("[live-share]", err);
            setLiveShareState("error");
        }
    };

    const handleCopyLiveShare = async () => {
        clearLiveShareResetTimer();

        try {
            let nextUrl = liveShareUrl;
            if (!nextUrl) {
                const memoId = liveMemoIdRef.current;
                if (!memoId) return;
                setLiveShareState("loading");
                nextUrl = await requestLiveShareUrl(memoId);
                setLiveShareUrl(nextUrl);
            }

            const copied = await copyToClipboard(nextUrl);
            if (!copied) {
                setLiveShareState("error");
                return;
            }

            setLiveShareState("copied");
            liveShareResetTimerRef.current = setTimeout(() => {
                setLiveShareState("ready");
                liveShareResetTimerRef.current = null;
            }, 3000);
        } catch (err) {
            console.error("[live-share-copy]", err);
            setLiveShareState("error");
        }
    };

    const getLiveShareLabel = () => {
        if (liveShareState === "loading") return "Preparing link...";
        if (liveShareState === "copied") return "Copied";
        if (liveShareState === "error") return "Retry live link";
        return "Copy live link";
    };

    const shouldShowLiveShare = (isRecording || isUploadActive) && liveShareState !== "idle";

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

        // Keep live payload bounded so per-tick transcription latency does not
        // grow with recording length. Preserve chunk[0] for container header.
        const chunks = audioChunksRef.current;
        const snapshotChunks = chunks.length <= LIVE_MAX_CHUNKS
            ? [...chunks]
            : [chunks[0], ...chunks.slice(-(LIVE_MAX_CHUNKS - 1))];
        const snapshot = new Blob(snapshotChunks, { type: mimeTypeRef.current });

        const fd = new FormData();
        fd.append("file", snapshot, `live_${Date.now()}.webm`);

        fetch("/api/transcribe/live", { method: "POST", body: fd, signal: controller.signal })
            .then((r) => r.ok ? r.json() : Promise.reject(r.status))
            .then(({ text }: { text: string }) => {
                if (text) {
                    setLiveTranscript((previous) => mergeLiveTranscript(previous, text));
                }
            })
            .catch((err) => {
                if (err?.name !== "AbortError") console.error("[live]", err);
            })
            .finally(() => {
                liveInFlightRef.current = false;
            });
    };

    const startRecording = async () => {
        setMicError(null);

        if (!navigator.mediaDevices?.getUserMedia) {
            const secureContext = window.isSecureContext;
            setMicError(
                secureContext
                    ? "Microphone access is not available in this browser."
                    : "Microphone access requires HTTPS (or localhost). Open this page over a secure origin and try again."
            );
            console.warn("Mic unavailable: navigator.mediaDevices.getUserMedia is unavailable", {
                isSecureContext: secureContext,
                origin: window.location.origin,
            });
            return;
        }

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

            mimeTypeRef.current = mimeType || DEFAULT_PENDING_MIME_TYPE;

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
                if (onAudioInput) {
                    onAudioInput({
                        blob,
                        durationSeconds: recordingTimeRef.current,
                        mimeType: mimeTypeRef.current,
                        memoId: liveMemoIdRef.current ?? undefined,
                    });
                } else {
                    void handleUpload(blob, mimeTypeRef.current, undefined, liveMemoIdRef.current);
                }
            };

            mr.start(RECORDER_TIMESLICE_MS);
            setIsRecording(true);
            setRecordingTime(0);
            setLiveTranscript("");
            setAnimatedWords([]);
            setNewWordStartIndex(0);
            previousTranscriptRef.current = "";
            resetLiveShareSession();

            timerRef.current = setInterval(() => {
                setRecordingTime((p) => p + 1);
            }, 1000);

            // Continue fast live updates while recording.
            liveTimerRef.current = setInterval(runLiveTick, LIVE_INTERVAL_MS);
            void startLiveShareSession();

        } catch (err) {
            console.error("Mic error:", err);
            if (err instanceof DOMException && err.name === "NotAllowedError") {
                setMicError("Microphone permission was denied. Please allow access and try again.");
            } else {
                setMicError("Unable to access microphone. Check your browser settings and try again.");
            }
        }
    };

    const stopRecording = () => {
        if (!mediaRecorderRef.current || !isRecording) return;
        if (liveTimerRef.current) clearInterval(liveTimerRef.current);
        if (timerRef.current) clearInterval(timerRef.current);
        abortRef.current?.abort();
        pendingLiveTranscriptRef.current = liveTranscript;
        void persistLiveTranscript();
        mediaRecorderRef.current.stop();
        setIsRecording(false);
    };

    const resetRecording = () => {
        setRecordingTime(0);
        setLiveTranscript("");
        setAnimatedWords([]);
        setNewWordStartIndex(0);
        previousTranscriptRef.current = "";
        resetLiveShareSession();
    };

    const handleUpload = async (
        blob: Blob,
        mimeType: string = mimeTypeRef.current,
        fileName?: string,
        memoId?: string | null
    ) => {
        if (!blob) return;
        setIsUploading(true);
        try {
            const fd = new FormData();
            const uploadFileName =
                fileName ?? `memo_${Date.now()}.${getFileExtensionFromMime(mimeType)}`;
            fd.append("file", blob, uploadFileName);
            if (memoId) {
                fd.append("memoId", memoId);
            }
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

    const handleManualFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;

        const mimeType = resolveUploadMimeType(file);
        if (!mimeType) {
            setMicError("Only MP3 and M4A files are supported for manual uploads.");
            return;
        }

        setMicError(null);
        if (onAudioInput) {
            onAudioInput({
                blob: file,
                durationSeconds: 0,
                mimeType,
            });
            return;
        }

        void handleUpload(file, mimeType, file.name);
    };

    return (
        <div className="flex flex-col h-full w-full bg-[#121212]">
            {/* Header / Status */}
            <div className="flex justify-between items-center pl-8 pr-40 py-6 border-b border-white/5 bg-[#121212]/50 backdrop-blur-md z-10">
                <div className="flex flex-col">
                    <h2 className="text-xl font-semibold text-white/90">
                        {isRecording ? "Listening..." : (isUploadActive ? "Saving..." : "New Recording")}
                    </h2>
                    <p className="text-white/40 text-[10px] font-mono tracking-widest mt-1 uppercase">
                        {isRecording
                            ? formatTime(recordingTime)
                            : isUploadActive
                                ? uploadProgressPercent >= 100
                                    ? "Upload complete. Transcribing with NVIDIA..."
                                    : `Uploading file... ${uploadProgressPercent}%`
                                : "Ready to record"}
                    </p>
                    {isUploadActive && (
                        <div
                            role="progressbar"
                            aria-label="Upload in progress"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={uploadProgressPercent}
                            className="mt-2 h-1 w-48 overflow-hidden rounded-full bg-white/10"
                        >
                            <div
                            className="h-full bg-accent/80 transition-[width] duration-300"
                            style={{ width: `${uploadProgressPercent}%` }}
                        />
                    </div>
                )}
                {shouldShowLiveShare && (
                    <div className="mt-2 flex items-center gap-2">
                        <button
                            type="button"
                            onClick={handleCopyLiveShare}
                            disabled={liveShareState === "loading"}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-mono uppercase tracking-wide transition-colors ${
                                liveShareState === "copied"
                                    ? "border-emerald-500/40 text-emerald-300"
                                    : "border-white/15 text-white/60 hover:border-accent/40 hover:text-accent"
                            } ${liveShareState === "loading" ? "cursor-wait opacity-75" : ""}`}
                        >
                            {liveShareState === "loading" ? (
                                <Loader2 size={12} className="animate-spin" />
                            ) : liveShareState === "copied" ? (
                                <Check size={12} />
                            ) : (
                                <Link2 size={12} />
                            )}
                            {getLiveShareLabel()}
                        </button>
                        {liveShareUrl && (
                            <a
                                href={liveShareUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] font-mono uppercase tracking-tight text-emerald-300/85 hover:text-emerald-200"
                                title="Open live share page"
                            >
                                Open live page
                            </a>
                        )}
                    </div>
                )}
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
                {isUploadActive && (
                    <div className="flex items-center gap-2">
                        <Loader2 size={14} className="animate-spin text-accent" />
                        <span className="text-[10px] text-accent/80 font-mono uppercase tracking-tight">
                            {uploadProgressPercent >= 100
                                ? "Processing"
                                : `${uploadProgressPercent}% uploaded`}
                        </span>
                    </div>
                )}
            </div>

            {/* Maximized Live Transcript Area */}
            <div className="flex-1 overflow-y-auto px-8 py-10 relative">
                <div className="max-w-3xl mx-auto">
                    {isRecording || isUploadActive ? (
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
                        <div className="h-full flex flex-col items-center justify-center text-white/10 select-none">
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

            {/* Bottom Controls */}
            <div className="bg-[#161616] border-t border-white/10 px-8 py-10 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] z-10 transition-all duration-500">
                <div className="max-w-3xl mx-auto flex flex-col items-center justify-center gap-10">
                    {/* Recording Button Shell */}
                    <div className="relative flex items-center justify-center w-28 h-28">
                        <button
                            onClick={isRecording ? stopRecording : startRecording}
                            aria-label={isRecording ? "Stop recording" : "Start recording"}
                            disabled={isUploadActive}
                            className={`group relative flex items-center justify-center w-full h-full rounded-full transition-all duration-500 ${(isRecording || isUploadActive) ? "scale-110" : "hover:scale-105 active:scale-95"} ${isUploadActive ? "opacity-50 cursor-not-allowed" : ""}`}
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
                    <input
                        ref={fileInputRef}
                        data-testid="manual-audio-upload"
                        type="file"
                        accept={MANUAL_UPLOAD_ACCEPT}
                        className="hidden"
                        onChange={handleManualFileSelect}
                    />
                    <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isRecording || isUploadActive}
                        className="rounded-lg border border-white/20 px-4 py-2 text-xs font-mono uppercase tracking-widest text-white/70 transition-colors hover:border-white/35 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        Upload MP3/M4A
                    </button>
                </div>
            </div>
        </div>
    );
}
