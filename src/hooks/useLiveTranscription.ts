import {
    useEffect,
    useRef,
    useState,
    type MutableRefObject,
} from "react";
import { copyToClipboard } from "@/lib/memo-ui";
import { mergeLiveTranscript } from "@/components/audio-recorder/live-transcript";

const LIVE_INTERVAL_MS = 1500;
const LIVE_MAX_CHUNKS = 30;

export type LiveShareState = "idle" | "loading" | "ready" | "copied" | "error";

type UseLiveTranscriptionOptions = {
    audioChunksRef: MutableRefObject<Blob[]>;
    mimeTypeRef: MutableRefObject<string>;
    webmHeaderRef: MutableRefObject<Blob | null>;
};

type UseLiveTranscriptionResult = {
    liveTranscript: string;
    animatedWords: string[];
    newWordStartIndex: number;
    transcriptScrollRef: MutableRefObject<HTMLDivElement | null>;
    liveMemoId: string | null;
    liveShareUrl: string | null;
    liveShareState: LiveShareState;
    beginRecordingSession: () => void;
    endRecordingSession: () => void;
    resetLiveSession: () => void;
    runLiveTick: () => void;
    handleCopyLiveShare: () => Promise<void>;
    getLiveShareLabel: () => string;
};

export function useLiveTranscription({
    audioChunksRef,
    mimeTypeRef,
    webmHeaderRef,
}: UseLiveTranscriptionOptions): UseLiveTranscriptionResult {
    const [liveTranscript, setLiveTranscript] = useState("");
    const [animatedWords, setAnimatedWords] = useState<string[]>([]);
    const [newWordStartIndex, setNewWordStartIndex] = useState(0);
    const [liveMemoId, setLiveMemoId] = useState<string | null>(null);
    const [liveShareUrl, setLiveShareUrl] = useState<string | null>(null);
    const [liveShareState, setLiveShareState] = useState<LiveShareState>("idle");

    const liveTimerRef = useRef<NodeJS.Timeout | null>(null);
    const liveInFlightRef = useRef(false);
    const isFirstReturnTickRef = useRef(false);
    const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const previousTranscriptRef = useRef("");
    const liveMemoIdRef = useRef<string | null>(null);
    const liveSyncInFlightRef = useRef(false);
    const pendingLiveTranscriptRef = useRef<string | null>(null);
    const syncedLiveTranscriptRef = useRef("");
    const liveShareResetTimerRef = useRef<NodeJS.Timeout | null>(null);
    const liveTranscriptRef = useRef("");
    const isRecordingRef = useRef(false);
    const visibilityHandlerRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        liveMemoIdRef.current = liveMemoId;
    }, [liveMemoId]);

    useEffect(() => {
        liveTranscriptRef.current = liveTranscript;
    }, [liveTranscript]);

    useEffect(() => {
        if (transcriptScrollRef.current) {
            transcriptScrollRef.current.scrollTop = transcriptScrollRef.current.scrollHeight;
        }
    }, [liveTranscript]);

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

    useEffect(() => () => {
        if (liveTimerRef.current) clearInterval(liveTimerRef.current);
        if (liveShareResetTimerRef.current) clearTimeout(liveShareResetTimerRef.current);
        abortRef.current?.abort();
        if (visibilityHandlerRef.current) {
            document.removeEventListener("visibilitychange", visibilityHandlerRef.current);
            visibilityHandlerRef.current = null;
        }
    }, []);

    const clearLiveShareResetTimer = () => {
        if (liveShareResetTimerRef.current) {
            clearTimeout(liveShareResetTimerRef.current);
            liveShareResetTimerRef.current = null;
        }
    };

    const resetLiveSession = () => {
        clearLiveShareResetTimer();
        if (liveTimerRef.current) clearInterval(liveTimerRef.current);
        abortRef.current?.abort();
        if (visibilityHandlerRef.current) {
            document.removeEventListener("visibilitychange", visibilityHandlerRef.current);
            visibilityHandlerRef.current = null;
        }
        isRecordingRef.current = false;
        setLiveTranscript("");
        setAnimatedWords([]);
        setNewWordStartIndex(0);
        previousTranscriptRef.current = "";
        setLiveMemoId(null);
        setLiveShareUrl(null);
        setLiveShareState("idle");
        liveMemoIdRef.current = null;
        liveInFlightRef.current = false;
        isFirstReturnTickRef.current = false;
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
            const response = await fetch(`/api/memos/${memoId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ transcript: normalizedTranscript }),
            });
            if (!response.ok) {
                throw new Error(`Live transcript update failed: ${response.status}`);
            }
            syncedLiveTranscriptRef.current = normalizedTranscript;
        } catch (error) {
            console.error("[live-sync]", error);
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
        const response = await fetch(`/api/memos/${memoId}/share`, { method: "POST" });
        const json = await response.json().catch(() => null);
        const nextShareUrl = typeof json?.shareUrl === "string" ? json.shareUrl : null;
        if (!response.ok || !nextShareUrl) {
            throw new Error("Unable to create live share link.");
        }
        return nextShareUrl;
    };

    const startLiveShareSession = async () => {
        setLiveShareState("loading");
        try {
            const liveMemoResponse = await fetch("/api/memos/live", { method: "POST" });
            if (liveMemoResponse.status === 401) {
                resetLiveSession();
                return;
            }

            const liveMemoJson = await liveMemoResponse.json().catch(() => null);
            const memoId = typeof liveMemoJson?.memoId === "string" ? liveMemoJson.memoId : null;
            if (!liveMemoResponse.ok || !memoId) {
                throw new Error("Unable to initialize live memo.");
            }

            setLiveMemoId(memoId);
            const nextShareUrl = await requestLiveShareUrl(memoId);
            setLiveShareUrl(nextShareUrl);
            setLiveShareState("ready");
        } catch (error) {
            console.error("[live-share]", error);
            setLiveShareState("error");
        }
    };

    const runLiveTick = () => {
        if (liveInFlightRef.current) return;
        if (audioChunksRef.current.length === 0) return;

        liveInFlightRef.current = true;

        // On the first tick after returning from a hidden tab, send ALL accumulated chunks
        // so RIVA can transcribe the full recording rather than just the last 30 seconds.
        // Reset the flag immediately so subsequent interval ticks use the normal cap.
        const isReturnTick = isFirstReturnTickRef.current;
        isFirstReturnTickRef.current = false;

        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        const chunks = audioChunksRef.current;
        const header = webmHeaderRef.current;
        // `header` is the WebM EBML/init blob captured at recording start (no audio data).
        // `chunks` are the subsequent audio-only clusters from audioChunksRef.
        //
        // When `header` is available, ALWAYS prepend it so RIVA can decode the audio:
        //   • Return tick or non-overflow: [header, ...all-audio-chunks]
        //   • Normal ongoing overflow: [header, ...last-(LIVE_MAX_CHUNKS-1)-audio-chunks]
        //
        // When `header` is null (browser skipped the onstart requestData() call),
        // fall back to the old behavior where chunk[0] carries both headers and first
        // second of audio — the guardrail in mergeLiveTranscript still protects against
        // duplications in that edge case.
        const snapshotChunks = header
            ? isReturnTick || chunks.length <= LIVE_MAX_CHUNKS
                ? [header, ...chunks]
                : [header, ...chunks.slice(-(LIVE_MAX_CHUNKS - 1))]
            : isReturnTick || chunks.length <= LIVE_MAX_CHUNKS
                ? [...chunks]
                : [chunks[0], ...chunks.slice(-(LIVE_MAX_CHUNKS - 1))];
        const snapshot = new Blob(snapshotChunks, { type: mimeTypeRef.current });

        const formData = new FormData();
        formData.append("file", snapshot, `live_${Date.now()}.webm`);

        fetch("/api/transcribe/live", { method: "POST", body: formData, signal: controller.signal })
            .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
            .then(({ text }: { text: string }) => {
                if (text) {
                    setLiveTranscript((previous) => mergeLiveTranscript(previous, text));
                }
            })
            .catch((error) => {
                if (error?.name !== "AbortError") console.error("[live]", error);
            })
            .finally(() => {
                liveInFlightRef.current = false;
            });
    };

    const beginRecordingSession = () => {
        setLiveTranscript("");
        setAnimatedWords([]);
        setNewWordStartIndex(0);
        previousTranscriptRef.current = "";
        clearLiveShareResetTimer();
        setLiveMemoId(null);
        setLiveShareUrl(null);
        setLiveShareState("idle");
        liveMemoIdRef.current = null;
        pendingLiveTranscriptRef.current = null;
        syncedLiveTranscriptRef.current = "";
        liveSyncInFlightRef.current = false;
        liveInFlightRef.current = false;
        isFirstReturnTickRef.current = false;

        // Clean up any leftover handler from a previous session before registering a new one
        if (visibilityHandlerRef.current) {
            document.removeEventListener("visibilitychange", visibilityHandlerRef.current);
        }

        const handleVisibilityChange = () => {
            if (!isRecordingRef.current) return;
            if (document.hidden) {
                if (liveTimerRef.current) clearInterval(liveTimerRef.current);
                liveTimerRef.current = null;
            } else {
                if (liveTimerRef.current) clearInterval(liveTimerRef.current);
                // Mark the next tick as a return tick so runLiveTick sends all accumulated
                // chunks instead of the normal overflow cap (covers long hidden periods).
                isFirstReturnTickRef.current = true;
                // Fire an immediate tick on return only if nothing is already in-flight
                if (!liveInFlightRef.current) runLiveTick();
                liveTimerRef.current = setInterval(runLiveTick, LIVE_INTERVAL_MS);
            }
        };

        visibilityHandlerRef.current = handleVisibilityChange;
        document.addEventListener("visibilitychange", visibilityHandlerRef.current);
        isRecordingRef.current = true;

        if (liveTimerRef.current) clearInterval(liveTimerRef.current);
        liveTimerRef.current = setInterval(runLiveTick, LIVE_INTERVAL_MS);
        void startLiveShareSession();
    };

    const endRecordingSession = () => {
        if (liveTimerRef.current) clearInterval(liveTimerRef.current);
        abortRef.current?.abort();
        if (visibilityHandlerRef.current) {
            document.removeEventListener("visibilitychange", visibilityHandlerRef.current);
            visibilityHandlerRef.current = null;
        }
        isRecordingRef.current = false;
        pendingLiveTranscriptRef.current = liveTranscriptRef.current;
        void persistLiveTranscript();
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
        } catch (error) {
            console.error("[live-share-copy]", error);
            setLiveShareState("error");
        }
    };

    const getLiveShareLabel = () => {
        if (liveShareState === "loading") return "Preparing link...";
        if (liveShareState === "copied") return "Copied";
        if (liveShareState === "error") return "Retry live link";
        return "Copy live link";
    };

    return {
        liveTranscript,
        animatedWords,
        newWordStartIndex,
        transcriptScrollRef,
        liveMemoId,
        liveShareUrl,
        liveShareState,
        beginRecordingSession,
        endRecordingSession,
        resetLiveSession,
        runLiveTick,
        handleCopyLiveShare,
        getLiveShareLabel,
    };
}
