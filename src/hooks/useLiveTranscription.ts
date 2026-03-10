import {
    useEffect,
    useRef,
    useState,
    type MutableRefObject,
} from "react";
import { copyToClipboard } from "@/lib/memo-ui";
import type { LiveLockedSegment } from "@/lib/live-segments";

const LIVE_INTERVAL_MS = 1500;
const SEGMENT_CHUNK_COUNT = 15;
const LIVE_TAIL_CHUNK_COUNT = SEGMENT_CHUNK_COUNT * 2 - 1;
const CATCHUP_BURST_MAX = 3;

type LockedSegment = LiveLockedSegment;

type CanonicalTranscriptState = {
    lockedSegments: LockedSegment[];
    tailText: string;
};

function joinTranscriptParts(parts: string[]): string {
    return parts
        .map((part) => part.trim())
        .filter(Boolean)
        .join(" ");
}

function buildCanonicalTranscript(lockedSegments: LockedSegment[], tailText: string): string {
    return joinTranscriptParts([
        ...lockedSegments.map((segment) => segment.text),
        tailText,
    ]);
}

function preserveTailAcrossFinalization(finalizedText: string, previousTailText: string): string {
    const lockedText = finalizedText.trim();
    const tailText = previousTailText.trim();

    if (!tailText || !lockedText) return tailText;
    if (tailText === lockedText) return "";
    if (tailText.startsWith(lockedText)) {
        return tailText.slice(lockedText.length).trim();
    }
    return tailText;
}

export type LiveShareState = "idle" | "loading" | "ready" | "copied" | "error";
export type LiveTranscriptionWindowMode =
    | "idle"
    | "segment_finalization"
    | "tail_update";

export type LiveTranscriptionDebugState = {
    tabVisibility: "visible" | "hidden";
    windowMode: LiveTranscriptionWindowMode;
    bufferedChunkCount: number;
    snapshotAudioChunkCount: number;
    snapshotBlobCount: number;
    snapshotByteSize: number;
    snapshotWindowStartIndex: number;
    snapshotWindowChunkCount: number;
    firstChunkRetained: boolean;
    headerIncluded: boolean;
    overflowed: boolean;
    inFlight: boolean;
    lastTickAt: number | null;
    lastResponseAt: number | null;
    lastServerText: string;
    lastTranscriptLength: number;
    lastTranscriptWordCount: number;
};

type UseLiveTranscriptionOptions = {
    audioChunksRef: MutableRefObject<Blob[]>;
    mimeTypeRef: MutableRefObject<string>;
    webmHeaderRef: MutableRefObject<Blob | null>;
};

type UseLiveTranscriptionResult = {
    liveTranscript: string;
    animatedWords: string[];
    newWordStartIndex: number;
    liveDebug: LiveTranscriptionDebugState;
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

function getDocumentVisibilityState(): "visible" | "hidden" {
    if (typeof document === "undefined") return "visible";
    return document.hidden ? "hidden" : "visible";
}

function createInitialLiveDebugState(
    tabVisibility: "visible" | "hidden" = getDocumentVisibilityState()
): LiveTranscriptionDebugState {
    return {
        tabVisibility,
        windowMode: "idle",
        bufferedChunkCount: 0,
        snapshotAudioChunkCount: 0,
        snapshotBlobCount: 0,
        snapshotByteSize: 0,
        snapshotWindowStartIndex: 0,
        snapshotWindowChunkCount: 0,
        firstChunkRetained: false,
        headerIncluded: false,
        overflowed: false,
        inFlight: false,
        lastTickAt: null,
        lastResponseAt: null,
        lastServerText: "",
        lastTranscriptLength: 0,
        lastTranscriptWordCount: 0,
    };
}

export function useLiveTranscription({
    audioChunksRef,
    mimeTypeRef,
    webmHeaderRef,
}: UseLiveTranscriptionOptions): UseLiveTranscriptionResult {
    const [canonicalTranscriptState, setCanonicalTranscriptState] = useState<CanonicalTranscriptState>({
        lockedSegments: [],
        tailText: "",
    });
    const [animatedWords, setAnimatedWords] = useState<string[]>([]);
    const [newWordStartIndex, setNewWordStartIndex] = useState(0);
    const [liveDebug, setLiveDebug] = useState<LiveTranscriptionDebugState>(createInitialLiveDebugState);
    const [liveMemoId, setLiveMemoId] = useState<string | null>(null);
    const [liveShareUrl, setLiveShareUrl] = useState<string | null>(null);
    const [liveShareState, setLiveShareState] = useState<LiveShareState>("idle");

    const liveTimerRef = useRef<NodeJS.Timeout | null>(null);
    const liveInFlightRef = useRef(false);
    const lockedSegmentsRef = useRef<LockedSegment[]>([]);
    const tailTextRef = useRef("");
    const catchupBurstCountRef = useRef(0);
    const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const previousTranscriptRef = useRef("");
    const liveMemoIdRef = useRef<string | null>(null);
    const liveSyncInFlightRef = useRef(false);
    const pendingLiveTranscriptRef = useRef<string | null>(null);
    const persistedSegmentCountRef = useRef(0);
    // Set when recording ends; blocks retry syncs to prevent a late PATCH from
    // overwriting the final transcript written by the upload pipeline.
    const sessionEndedRef = useRef(false);
    const syncedLiveTranscriptRef = useRef("");
    const liveShareResetTimerRef = useRef<NodeJS.Timeout | null>(null);
    const isRecordingRef = useRef(false);
    const visibilityHandlerRef = useRef<(() => void) | null>(null);

    const { lockedSegments, tailText } = canonicalTranscriptState;
    const liveTranscript = buildCanonicalTranscript(lockedSegments, tailText);

    useEffect(() => {
        liveMemoIdRef.current = liveMemoId;
    }, [liveMemoId]);

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

    const updateLiveDebug = (patch: Partial<LiveTranscriptionDebugState>) => {
        setLiveDebug((previous) => ({ ...previous, ...patch }));
    };

    const updateCanonicalTranscript = (
        nextLockedSegments: LockedSegment[],
        nextTailText: string,
    ) => {
        lockedSegmentsRef.current = nextLockedSegments;
        tailTextRef.current = nextTailText;
        setCanonicalTranscriptState({
            lockedSegments: nextLockedSegments,
            tailText: nextTailText,
        });

        const transcript = buildCanonicalTranscript(nextLockedSegments, nextTailText);
        updateLiveDebug({
            lastTranscriptLength: transcript.length,
            lastTranscriptWordCount: transcript.split(/\s+/).filter(Boolean).length,
        });
        return transcript;
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
        updateCanonicalTranscript([], "");
        setAnimatedWords([]);
        setNewWordStartIndex(0);
        previousTranscriptRef.current = "";
        setLiveMemoId(null);
        setLiveShareUrl(null);
        setLiveShareState("idle");
        liveMemoIdRef.current = null;
        liveInFlightRef.current = false;
        catchupBurstCountRef.current = 0;
        pendingLiveTranscriptRef.current = null;
        syncedLiveTranscriptRef.current = "";
        liveSyncInFlightRef.current = false;
        persistedSegmentCountRef.current = 0;
        sessionEndedRef.current = false;
        setLiveDebug(createInitialLiveDebugState());
    };

    const persistLiveSegments = async (
        memoId: string,
        segments: LockedSegment[],
    ) => {
        if (segments.length === 0) return;

        try {
            const response = await fetch(`/api/memos/${memoId}/segments/live`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ segments }),
            });

            if (!response.ok) {
                throw new Error(`Live segment update failed: ${response.status}`);
            }
        } catch (error) {
            console.error("[live-segments]", error);
        }
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
            if (response.status === 409) {
                // Memo has been finalized by the upload pipeline; this sync is a no-op.
                return;
            }
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
            // Do not retry after the session has ended — finalization is imminent or done.
            if (hasPendingUpdate && !sessionEndedRef.current) {
                void persistLiveTranscript();
            }
        }
    };

    useEffect(() => {
        if (!liveMemoId) return;
        pendingLiveTranscriptRef.current = buildCanonicalTranscript(lockedSegments, tailText);
        void persistLiveTranscript();
    }, [liveMemoId, lockedSegments, tailText]);

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

    const runLiveTick = (forceTailRefresh = false) => {
        if (liveInFlightRef.current) return;
        if (!isRecordingRef.current) return;
        if (audioChunksRef.current.length === 0) return;

        liveInFlightRef.current = true;

        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        const chunks = audioChunksRef.current;
        const header = webmHeaderRef.current;
        const locked = lockedSegmentsRef.current;
        const finalizedEnd = locked.length > 0 ? locked[locked.length - 1].endIndex : 0;
        const pendingCount = chunks.length - finalizedEnd;
        const willFinalize = !forceTailRefresh && pendingCount >= SEGMENT_CHUNK_COUNT * 2;
        const requestStart = finalizedEnd;
        const requestEnd = willFinalize
            ? finalizedEnd + SEGMENT_CHUNK_COUNT
            : Math.min(chunks.length, finalizedEnd + LIVE_TAIL_CHUNK_COUNT);

        const blobParts = header
            ? [header, ...chunks.slice(requestStart, requestEnd)]
            : [...chunks.slice(requestStart, requestEnd)];
        const snapshot = new Blob(blobParts, { type: mimeTypeRef.current });
        const snapshotAudioChunkCount = requestEnd - requestStart;

        updateLiveDebug({
            tabVisibility: getDocumentVisibilityState(),
            windowMode: willFinalize ? "segment_finalization" : "tail_update",
            bufferedChunkCount: chunks.length,
            snapshotAudioChunkCount,
            snapshotBlobCount: blobParts.length,
            snapshotByteSize: snapshot.size,
            snapshotWindowStartIndex: requestStart,
            snapshotWindowChunkCount: requestEnd - requestStart,
            firstChunkRetained: false,
            headerIncluded: Boolean(header),
            overflowed: locked.length > 0,
            inFlight: true,
            lastTickAt: Date.now(),
        });

        const formData = new FormData();
        formData.append("file", snapshot, `live_${Date.now()}.webm`);

        fetch("/api/transcribe/live", { method: "POST", body: formData, signal: controller.signal })
            .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
            .then(({ text }: { text: string }) => {
                if (willFinalize) {
                    const finalizedText = (text ?? "").trim();
                    const nextLockedSegments = [
                        ...lockedSegmentsRef.current,
                        { startIndex: requestStart, endIndex: requestEnd, text: finalizedText },
                    ];
                    const nextTailText = preserveTailAcrossFinalization(
                        finalizedText,
                        tailTextRef.current,
                    );
                    updateCanonicalTranscript(nextLockedSegments, nextTailText);
                    updateLiveDebug({
                        lastResponseAt: Date.now(),
                        lastServerText: finalizedText,
                        inFlight: false,
                    });

                    const memoId = liveMemoIdRef.current;
                    if (
                        memoId &&
                        nextLockedSegments.length > persistedSegmentCountRef.current
                    ) {
                        const newSegments = nextLockedSegments.slice(
                            persistedSegmentCountRef.current,
                        );
                        void persistLiveSegments(memoId, newSegments);
                        persistedSegmentCountRef.current = nextLockedSegments.length;
                    }
                } else {
                    const nextTailText = (text ?? "").trim();
                    updateCanonicalTranscript(lockedSegmentsRef.current, nextTailText);
                    updateLiveDebug({
                        lastResponseAt: Date.now(),
                        lastServerText: text ?? "",
                        inFlight: false,
                    });
                }
            })
            .catch((error) => {
                if (error?.name !== "AbortError") console.error("[live]", error);
                updateLiveDebug({
                    lastResponseAt: Date.now(),
                    inFlight: false,
                });
            })
            .finally(() => {
                liveInFlightRef.current = false;
                updateLiveDebug({ inFlight: false });

                if (!willFinalize) return;

                const afterEnd = lockedSegmentsRef.current.at(-1)?.endIndex ?? 0;
                const remaining = audioChunksRef.current.length - afterEnd;
                catchupBurstCountRef.current += 1;

                const canDrainMore =
                    remaining >= SEGMENT_CHUNK_COUNT * 2 &&
                    catchupBurstCountRef.current < CATCHUP_BURST_MAX;
                const shouldRefreshTail = remaining > 0;

                if (canDrainMore) {
                    runLiveTick();
                } else if (shouldRefreshTail) {
                    runLiveTick(true);
                }
            });
    };

    const beginRecordingSession = () => {
        updateCanonicalTranscript([], "");
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
        persistedSegmentCountRef.current = 0;
        sessionEndedRef.current = false;
        liveInFlightRef.current = false;
        catchupBurstCountRef.current = 0;
        setLiveDebug(createInitialLiveDebugState());

        // Clean up any leftover handler from a previous session before registering a new one
        if (visibilityHandlerRef.current) {
            document.removeEventListener("visibilitychange", visibilityHandlerRef.current);
        }

        const handleVisibilityChange = () => {
            if (!isRecordingRef.current) return;
            updateLiveDebug({ tabVisibility: getDocumentVisibilityState() });
            if (document.hidden) {
                return;
            }

            if (liveTimerRef.current) clearInterval(liveTimerRef.current);
            catchupBurstCountRef.current = 0;
            if (!liveInFlightRef.current) runLiveTick();
            liveTimerRef.current = setInterval(runLiveTick, LIVE_INTERVAL_MS);
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
        // Mark session ended so no retry syncs fire after this final one.
        // The flag is checked in persistLiveTranscript's retry guard.
        sessionEndedRef.current = true;
        pendingLiveTranscriptRef.current = buildCanonicalTranscript(
            lockedSegmentsRef.current,
            tailTextRef.current,
        );
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
        liveDebug,
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
