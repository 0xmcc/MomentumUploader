import {
    LIVE_TAIL_CHUNK_COUNT,
    SEGMENT_CHUNK_COUNT,
    type LiveTranscriptionDebugState,
    type LockedSegment,
} from "./useLiveTranscription.shared";

type BuildLiveSnapshotInput = {
    chunks: Blob[];
    mimeType: string;
    header: Blob | null;
    pruneOffset: number;
    lockedSegments: LockedSegment[];
    forceTailRefresh: boolean;
    tabVisibility: "visible" | "hidden";
    now: number;
};

export type LiveSnapshot = {
    snapshot: Blob;
    requestStart: number;
    requestEnd: number;
    trueTotal: number;
    willFinalize: boolean;
    debugPatch: Partial<LiveTranscriptionDebugState>;
};

type BuildFinalTailSnapshotInput = {
    chunks: Blob[];
    mimeType: string;
    header: Blob | null;
    pruneOffset: number;
    lockedSegments: LockedSegment[];
};

export function buildLiveSnapshot({
    chunks,
    mimeType,
    header,
    pruneOffset,
    lockedSegments,
    forceTailRefresh,
    tabVisibility,
    now,
}: BuildLiveSnapshotInput): LiveSnapshot {
    const trueTotal = chunks.length + pruneOffset;
    const finalizedEnd = lockedSegments.length > 0
        ? lockedSegments[lockedSegments.length - 1].endIndex
        : 0;
    const pendingCount = trueTotal - finalizedEnd;
    const willFinalize = !forceTailRefresh && pendingCount >= SEGMENT_CHUNK_COUNT * 2;
    const requestStart = finalizedEnd;
    const requestEnd = willFinalize
        ? finalizedEnd + SEGMENT_CHUNK_COUNT
        : Math.min(trueTotal, finalizedEnd + LIVE_TAIL_CHUNK_COUNT);
    const arrayStart = Math.max(0, requestStart - pruneOffset);
    const arrayEnd = Math.max(arrayStart, requestEnd - pruneOffset);
    const blobParts = header
        ? [header, ...chunks.slice(arrayStart, arrayEnd)]
        : [...chunks.slice(arrayStart, arrayEnd)];
    const snapshot = new Blob(blobParts, { type: mimeType });
    const snapshotAudioChunkCount = arrayEnd - arrayStart;

    return {
        snapshot,
        requestStart,
        requestEnd,
        trueTotal,
        willFinalize,
        debugPatch: {
            tabVisibility,
            windowMode: willFinalize ? "segment_finalization" : "tail_update",
            bufferedChunkCount: trueTotal,
            snapshotAudioChunkCount,
            snapshotBlobCount: blobParts.length,
            snapshotByteSize: snapshot.size,
            snapshotWindowStartIndex: requestStart,
            snapshotWindowChunkCount: requestEnd - requestStart,
            firstChunkRetained: false,
            headerIncluded: Boolean(header),
            overflowed: lockedSegments.length > 0,
            inFlight: true,
            lastTickAt: now,
        },
    };
}

export function buildFinalTailSnapshot({
    chunks,
    mimeType,
    header,
    pruneOffset,
    lockedSegments,
}: BuildFinalTailSnapshotInput): Blob | null {
    const startIndex = lockedSegments.at(-1)?.endIndex ?? 0;
    const trueTotal = chunks.length + pruneOffset;

    if (trueTotal <= startIndex) {
        return null;
    }

    const arrayStart = Math.max(0, startIndex - pruneOffset);
    const blobParts = header
        ? [header, ...chunks.slice(arrayStart)]
        : chunks.slice(arrayStart);

    return new Blob(blobParts, { type: mimeType });
}
