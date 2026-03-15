import { useEffect, useRef, type MutableRefObject } from "react";
import {
    buildCanonicalTranscript,
    type LockedSegment,
} from "./useLiveTranscription.shared";

type UseLiveTranscriptionPersistenceOptions = {
    liveMemoId: string | null;
    liveMemoIdRef: MutableRefObject<string | null>;
    lockedSegments: LockedSegment[];
    tailText: string;
};

export function useLiveTranscriptionPersistence({
    liveMemoId,
    liveMemoIdRef,
    lockedSegments,
    tailText,
}: UseLiveTranscriptionPersistenceOptions) {
    const liveSyncInFlightRef = useRef(false);
    const pendingLiveTranscriptRef = useRef<string | null>(null);
    const persistedSegmentCountRef = useRef(0);
    const sessionEndedRef = useRef(false);
    const syncedLiveTranscriptRef = useRef("");

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

    const persistNewLockedSegments = (segments: LockedSegment[]) => {
        const memoId = liveMemoIdRef.current;
        if (!memoId || segments.length <= persistedSegmentCountRef.current) {
            return;
        }

        const newSegments = segments.slice(persistedSegmentCountRef.current);
        void persistLiveSegments(memoId, newSegments);
        persistedSegmentCountRef.current = segments.length;
    };

    const finalizePersistenceSession = (transcript: string) => {
        sessionEndedRef.current = true;
        pendingLiveTranscriptRef.current = transcript;
        void persistLiveTranscript();
    };

    const resetPersistenceSession = () => {
        pendingLiveTranscriptRef.current = null;
        syncedLiveTranscriptRef.current = "";
        liveSyncInFlightRef.current = false;
        persistedSegmentCountRef.current = 0;
        sessionEndedRef.current = false;
    };

    return {
        persistNewLockedSegments,
        finalizePersistenceSession,
        resetPersistenceSession,
    };
}
