import { useEffect, useRef, useState } from "react";
import { copyToClipboard } from "@/lib/memo-ui";
import {
    buildFinalTailSnapshot,
    buildLiveSnapshot,
} from "./useLiveTranscription.windowing";
import {
    buildCanonicalTranscript,
    CATCHUP_BURST_MAX,
    createInitialLiveDebugState,
    getDocumentVisibilityState,
    getLiveShareLabel as describeLiveShareLabel,
    LIVE_INTERVAL_MS,
    SEGMENT_CHUNK_COUNT,
    preserveTailAcrossFinalization,
    type CanonicalTranscriptState,
    type LiveTranscriptionDebugState,
    type LockedSegment,
    type UseLiveTranscriptionOptions,
    type UseLiveTranscriptionResult,
} from "./useLiveTranscription.shared";

export type {
    LiveShareState,
    LiveTranscriptionDebugState,
    LiveTranscriptionWindowMode,
} from "./useLiveTranscription.shared";

export function useLiveTranscription({
    audioChunksRef,
    mimeTypeRef,
    webmHeaderRef,
    chunkPruneOffsetRef,
}: UseLiveTranscriptionOptions): UseLiveTranscriptionResult {
    const [canonicalTranscriptState, setCanonicalTranscriptState] =
        useState<CanonicalTranscriptState>({
            lockedSegments: [],
            tailText: "",
        });
    const [animatedWords, setAnimatedWords] = useState<string[]>([]);
    const [newWordStartIndex, setNewWordStartIndex] = useState(0);
    const [liveDebug, setLiveDebug] = useState<LiveTranscriptionDebugState>(
        createInitialLiveDebugState
    );
    const [liveMemoId, setLiveMemoId] = useState<string | null>(null);
    const [liveShareUrl, setLiveShareUrl] = useState<string | null>(null);
    const [liveShareState, setLiveShareState] = useState<
        UseLiveTranscriptionResult["liveShareState"]
    >("idle");

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
        const previousWords = previousText
            ? previousText.split(/\s+/).filter(Boolean)
            : [];
        const isAppendOnly = !!previousText && nextText.startsWith(previousText);

        setNewWordStartIndex(isAppendOnly ? previousWords.length : 0);
        setAnimatedWords(nextWords);
        previousTranscriptRef.current = nextText;
    }, [liveTranscript]);

    useEffect(() => () => {
        if (liveTimerRef.current) clearInterval(liveTimerRef.current);
        if (liveShareResetTimerRef.current) {
            clearTimeout(liveShareResetTimerRef.current);
        }
        abortRef.current?.abort();
        if (visibilityHandlerRef.current) {
            document.removeEventListener(
                "visibilitychange",
                visibilityHandlerRef.current
            );
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
        nextTailText: string
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
        segments: LockedSegment[]
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

            if (hasPendingUpdate && !sessionEndedRef.current) {
                void persistLiveTranscript();
            }
        }
    };

    useEffect(() => {
        if (!liveMemoId) return;
        pendingLiveTranscriptRef.current = buildCanonicalTranscript(
            lockedSegments,
            tailText
        );
        void persistLiveTranscript();
    }, [liveMemoId, lockedSegments, tailText]);

    const requestLiveShareUrl = async (memoId: string): Promise<string> => {
        const response = await fetch(`/api/memos/${memoId}/share`, {
            method: "POST",
        });
        const json = await response.json().catch(() => null);
        const nextShareUrl =
            typeof json?.shareUrl === "string" ? json.shareUrl : null;

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
            const memoId =
                typeof liveMemoJson?.memoId === "string"
                    ? liveMemoJson.memoId
                    : null;

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

        const snapshot = buildLiveSnapshot({
            chunks: audioChunksRef.current,
            mimeType: mimeTypeRef.current,
            header: webmHeaderRef.current,
            pruneOffset: chunkPruneOffsetRef.current,
            lockedSegments: lockedSegmentsRef.current,
            forceTailRefresh,
            tabVisibility: getDocumentVisibilityState(),
            now: Date.now(),
        });

        updateLiveDebug(snapshot.debugPatch);

        const formData = new FormData();
        formData.append("file", snapshot.snapshot, `live_${Date.now()}.webm`);

        fetch("/api/transcribe/live", {
            method: "POST",
            body: formData,
            signal: controller.signal,
        })
            .then((response) =>
                response.ok ? response.json() : Promise.reject(response.status)
            )
            .then(({ text }: { text: string }) => {
                if (snapshot.willFinalize) {
                    const finalizedText = (text ?? "").trim();
                    const nextLockedSegments = [
                        ...lockedSegmentsRef.current,
                        {
                            startIndex: snapshot.requestStart,
                            endIndex: snapshot.requestEnd,
                            text: finalizedText,
                        },
                    ];
                    const nextTailText = preserveTailAcrossFinalization(
                        finalizedText,
                        tailTextRef.current
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
                            persistedSegmentCountRef.current
                        );
                        void persistLiveSegments(memoId, newSegments);
                        persistedSegmentCountRef.current = nextLockedSegments.length;
                    }
                    return;
                }

                updateCanonicalTranscript(lockedSegmentsRef.current, (text ?? "").trim());
                updateLiveDebug({
                    lastResponseAt: Date.now(),
                    lastServerText: text ?? "",
                    inFlight: false,
                });
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

                if (!snapshot.willFinalize) return;

                const afterEnd = lockedSegmentsRef.current.at(-1)?.endIndex ?? 0;
                const remaining =
                    audioChunksRef.current.length +
                    chunkPruneOffsetRef.current -
                    afterEnd;
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

    const runFinalTailTick = async (): Promise<string> => {
        const snapshot = buildFinalTailSnapshot({
            chunks: audioChunksRef.current,
            mimeType: mimeTypeRef.current,
            header: webmHeaderRef.current,
            pruneOffset: chunkPruneOffsetRef.current,
            lockedSegments: lockedSegmentsRef.current,
        });

        if (!snapshot) {
            return buildCanonicalTranscript(
                lockedSegmentsRef.current,
                tailTextRef.current
            );
        }

        const controller = new AbortController();
        const formData = new FormData();
        formData.append("file", snapshot, `final_tail_${Date.now()}.webm`);

        try {
            const response = await fetch("/api/transcribe/live", {
                method: "POST",
                body: formData,
                signal: controller.signal,
            });
            const payload = response.ok
                ? ((await response.json()) as { text?: string })
                : { text: "" };
            const nextTailText = (payload.text ?? "").trim();

            tailTextRef.current = nextTailText;
            return buildCanonicalTranscript(lockedSegmentsRef.current, nextTailText);
        } catch {
            return buildCanonicalTranscript(
                lockedSegmentsRef.current,
                tailTextRef.current
            );
        }
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
        sessionEndedRef.current = true;
        pendingLiveTranscriptRef.current = buildCanonicalTranscript(
            lockedSegmentsRef.current,
            tailTextRef.current
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

    const getLiveShareLabel = () => describeLiveShareLabel(liveShareState);

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
        runFinalTailTick,
        handleCopyLiveShare,
        getLiveShareLabel,
    };
}
