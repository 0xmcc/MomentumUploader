import type { MutableRefObject } from "react";
import type { LiveLockedSegment } from "@/lib/live-segments";

export const LIVE_INTERVAL_MS = 1500;
export const SEGMENT_CHUNK_COUNT = 15;
export const LIVE_TAIL_CHUNK_COUNT = SEGMENT_CHUNK_COUNT * 2 - 1;
export const CATCHUP_BURST_MAX = 3;

export type LockedSegment = LiveLockedSegment;

export type CanonicalTranscriptState = {
    lockedSegments: LockedSegment[];
    tailText: string;
};

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

export type UseLiveTranscriptionOptions = {
    audioChunksRef: MutableRefObject<Blob[]>;
    mimeTypeRef: MutableRefObject<string>;
    webmHeaderRef: MutableRefObject<Blob | null>;
    chunkPruneOffsetRef: MutableRefObject<number>;
};

export type UseLiveTranscriptionResult = {
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
    runFinalTailTick: () => Promise<string>;
    handleCopyLiveShare: () => Promise<void>;
    getLiveShareLabel: () => string;
};

export function joinTranscriptParts(parts: string[]): string {
    return parts
        .map((part) => part.trim())
        .filter(Boolean)
        .join(" ");
}

export function buildCanonicalTranscript(
    lockedSegments: LockedSegment[],
    tailText: string
): string {
    return joinTranscriptParts([
        ...lockedSegments.map((segment) => segment.text),
        tailText,
    ]);
}

export function preserveTailAcrossFinalization(
    finalizedText: string,
    previousTailText: string
): string {
    const lockedText = finalizedText.trim();
    const tailText = previousTailText.trim();

    if (!tailText || !lockedText) return tailText;
    if (tailText === lockedText) return "";
    if (tailText.startsWith(lockedText)) {
        return tailText.slice(lockedText.length).trim();
    }
    return tailText;
}

export function getDocumentVisibilityState(): "visible" | "hidden" {
    if (typeof document === "undefined") return "visible";
    return document.hidden ? "hidden" : "visible";
}

export function createInitialLiveDebugState(
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

export function getLiveShareLabel(liveShareState: LiveShareState): string {
    if (liveShareState === "loading") return "Preparing link...";
    if (liveShareState === "copied") return "Copied";
    if (liveShareState === "error") return "Retry live link";
    return "Copy live link";
}
