import { useEffect, useRef, type MutableRefObject } from "react";
import {
    buildFinalTailSnapshot,
    buildLiveSnapshot,
} from "./useLiveTranscription.windowing";
import {
    buildCanonicalTranscript,
    CATCHUP_BURST_MAX,
    getDocumentVisibilityState,
    LIVE_INTERVAL_MS,
    SEGMENT_CHUNK_COUNT,
    preserveTailAcrossFinalization,
    type LiveTranscriptionDebugState,
    type LockedSegment,
    type UseLiveTranscriptionOptions,
} from "./useLiveTranscription.shared";

type UseLiveTranscriptionSessionOptions = UseLiveTranscriptionOptions & {
    lockedSegmentsRef: MutableRefObject<LockedSegment[]>;
    tailTextRef: MutableRefObject<string>;
    updateCanonicalTranscript: (
        nextLockedSegments: LockedSegment[],
        nextTailText: string
    ) => string;
    updateLiveDebug: (patch: Partial<LiveTranscriptionDebugState>) => void;
    resetTranscriptSession: () => void;
    resetLiveShareSession: () => void;
    startLiveShareSession: () => Promise<void>;
    persistNewLockedSegments: (segments: LockedSegment[]) => void;
    finalizePersistenceSession: (transcript: string) => void;
    resetPersistenceSession: () => void;
};

export function useLiveTranscriptionSession({
    audioChunksRef,
    mimeTypeRef,
    webmHeaderRef,
    chunkPruneOffsetRef,
    lockedSegmentsRef,
    tailTextRef,
    updateCanonicalTranscript,
    updateLiveDebug,
    resetTranscriptSession,
    resetLiveShareSession,
    startLiveShareSession,
    persistNewLockedSegments,
    finalizePersistenceSession,
    resetPersistenceSession,
}: UseLiveTranscriptionSessionOptions) {
    const liveTimerRef = useRef<NodeJS.Timeout | null>(null);
    const liveInFlightRef = useRef(false);
    const catchupBurstCountRef = useRef(0);
    const abortRef = useRef<AbortController | null>(null);
    const isRecordingRef = useRef(false);
    const visibilityHandlerRef = useRef<(() => void) | null>(null);

    const clearRecordingResources = () => {
        if (liveTimerRef.current) {
            clearInterval(liveTimerRef.current);
            liveTimerRef.current = null;
        }
        abortRef.current?.abort();
        abortRef.current = null;
        if (visibilityHandlerRef.current) {
            document.removeEventListener(
                "visibilitychange",
                visibilityHandlerRef.current
            );
            visibilityHandlerRef.current = null;
        }

        isRecordingRef.current = false;
        liveInFlightRef.current = false;
    };

    useEffect(() => () => {
        clearRecordingResources();
    }, []);

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
                    persistNewLockedSegments(nextLockedSegments);
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

    const resetLiveSession = () => {
        clearRecordingResources();
        catchupBurstCountRef.current = 0;
        resetTranscriptSession();
        resetLiveShareSession();
        resetPersistenceSession();
    };

    const beginRecordingSession = () => {
        clearRecordingResources();
        catchupBurstCountRef.current = 0;
        resetTranscriptSession();
        resetLiveShareSession();
        resetPersistenceSession();

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
        liveTimerRef.current = setInterval(runLiveTick, LIVE_INTERVAL_MS);
        void startLiveShareSession();
    };

    const endRecordingSession = () => {
        clearRecordingResources();
        const liveTranscript = buildCanonicalTranscript(
            lockedSegmentsRef.current,
            tailTextRef.current
        );
        finalizePersistenceSession(liveTranscript);
    };

    return {
        beginRecordingSession,
        endRecordingSession,
        resetLiveSession,
        runLiveTick,
        runFinalTailTick,
    };
}
