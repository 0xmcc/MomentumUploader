import { useEffect, useRef, useState } from "react";
import { buildAnimatedTranscriptState } from "./live-transcript-animation";
import { useLiveTranscriptionPersistence } from "./useLiveTranscription.persistence";
import { useLiveTranscriptionSession } from "./useLiveTranscription.session";
import { useLiveTranscriptionShare } from "./useLiveTranscription.share";
import {
    buildCanonicalTranscript,
    createInitialLiveDebugState,
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
            shouldAnimateNewChunks: true,
        });
    const [animatedWords, setAnimatedWords] = useState<string[]>([]);
    const [newWordStartIndex, setNewWordStartIndex] = useState(0);
    const [liveDebug, setLiveDebug] = useState<LiveTranscriptionDebugState>(
        createInitialLiveDebugState
    );
    const lockedSegmentsRef = useRef<LockedSegment[]>([]);
    const tailTextRef = useRef("");
    const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
    const previousTranscriptRef = useRef("");
    const resetOnUnauthorizedRef = useRef<(() => void) | null>(null);

    const { lockedSegments, tailText, shouldAnimateNewChunks } = canonicalTranscriptState;
    const liveTranscript = buildCanonicalTranscript(lockedSegments, tailText);

    useEffect(() => {
        if (transcriptScrollRef.current) {
            transcriptScrollRef.current.scrollTop = transcriptScrollRef.current.scrollHeight;
        }
    }, [liveTranscript]);

    useEffect(() => {
        const { animatedWords: nextAnimatedWords, newWordStartIndex: nextStartIndex } =
            buildAnimatedTranscriptState(previousTranscriptRef.current, liveTranscript);

        setAnimatedWords(nextAnimatedWords);
        setNewWordStartIndex(nextStartIndex);
        previousTranscriptRef.current = liveTranscript.trim();
    }, [liveTranscript]);

    const updateLiveDebug = (patch: Partial<LiveTranscriptionDebugState>) => {
        setLiveDebug((previous) => ({ ...previous, ...patch }));
    };

    const updateCanonicalTranscript = (
        nextLockedSegments: LockedSegment[],
        nextTailText: string,
        nextShouldAnimateNewChunks = true
    ) => {
        lockedSegmentsRef.current = nextLockedSegments;
        tailTextRef.current = nextTailText;
        setCanonicalTranscriptState({
            lockedSegments: nextLockedSegments,
            tailText: nextTailText,
            shouldAnimateNewChunks: nextShouldAnimateNewChunks,
        });

        const transcript = buildCanonicalTranscript(nextLockedSegments, nextTailText);
        updateLiveDebug({
            lastTranscriptLength: transcript.length,
            lastTranscriptWordCount: transcript.split(/\s+/).filter(Boolean).length,
        });
        return transcript;
    };

    const resetTranscriptSession = () => {
        updateCanonicalTranscript([], "", true);
        setAnimatedWords([]);
        setNewWordStartIndex(0);
        previousTranscriptRef.current = "";
        setLiveDebug(createInitialLiveDebugState());
    };

    const liveShare = useLiveTranscriptionShare({
        onUnauthorizedRef: resetOnUnauthorizedRef,
    });
    const persistence = useLiveTranscriptionPersistence({
        liveMemoId: liveShare.liveMemoId,
        liveMemoIdRef: liveShare.liveMemoIdRef,
        lockedSegments,
        tailText,
    });
    const session = useLiveTranscriptionSession({
        audioChunksRef,
        mimeTypeRef,
        webmHeaderRef,
        chunkPruneOffsetRef,
        lockedSegmentsRef,
        tailTextRef,
        updateCanonicalTranscript,
        updateLiveDebug,
        resetTranscriptSession,
        resetLiveShareSession: liveShare.resetLiveShareSession,
        startLiveShareSession: liveShare.startLiveShareSession,
        persistNewLockedSegments: persistence.persistNewLockedSegments,
        finalizePersistenceSession: persistence.finalizePersistenceSession,
        resetPersistenceSession: persistence.resetPersistenceSession,
    });

    resetOnUnauthorizedRef.current = session.resetLiveSession;

    return {
        liveTranscript,
        animatedWords,
        newWordStartIndex,
        shouldAnimateNewChunks,
        liveDebug,
        transcriptScrollRef,
        liveMemoId: liveShare.liveMemoId,
        liveShareUrl: liveShare.liveShareUrl,
        liveShareState: liveShare.liveShareState,
        beginRecordingSession: session.beginRecordingSession,
        endRecordingSession: session.endRecordingSession,
        resetLiveSession: session.resetLiveSession,
        handleRecordedChunkAvailable: session.handleRecordedChunkAvailable,
        runLiveTick: session.runLiveTick,
        runFinalTailTick: session.runFinalTailTick,
        handleCopyLiveShare: liveShare.handleCopyLiveShare,
        getLiveShareLabel: liveShare.getLiveShareLabel,
    };
}
