import { useEffect, useRef, type MutableRefObject } from "react";

const CHUNK_UPLOAD_INTERVAL_MS = 30_000;
const MIN_CHUNKS_TO_UPLOAD = 10;
const PRUNE_SAFETY_BUFFER = 30;
const FLUSH_MAX_RETRIES = 3;
const FLUSH_RETRY_DELAYS_MS = [500, 1000, 2000] as const;

type UseChunkUploadOptions = {
    audioChunksRef: MutableRefObject<Blob[]>;
    webmHeaderRef: MutableRefObject<Blob | null>;
    mimeTypeRef: MutableRefObject<string>;
    memoId: string | null;
    enabled: boolean;
    chunkPruneOffsetRef?: MutableRefObject<number>;
};

type UseChunkUploadResult = {
    chunkPruneOffsetRef: MutableRefObject<number>;
    flushRemainingChunks: () => Promise<void>;
    resetChunkUpload: () => void;
};

function delay(ms: number) {
    return new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
    });
}

export function useChunkUpload({
    audioChunksRef,
    webmHeaderRef,
    mimeTypeRef,
    memoId,
    enabled,
    chunkPruneOffsetRef: externalChunkPruneOffsetRef,
}: UseChunkUploadOptions): UseChunkUploadResult {
    const internalChunkPruneOffsetRef = useRef(0);
    const chunkPruneOffsetRef = externalChunkPruneOffsetRef ?? internalChunkPruneOffsetRef;
    const lastUploadedIndexRef = useRef(0);
    const uploadIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const inFlightUploadRef = useRef<Promise<void> | null>(null);
    const enabledRef = useRef(enabled);
    const memoIdRef = useRef(memoId);

    useEffect(() => {
        enabledRef.current = enabled;
    }, [enabled]);

    useEffect(() => {
        memoIdRef.current = memoId;
    }, [memoId]);

    const clearUploadInterval = () => {
        if (uploadIntervalRef.current) {
            clearInterval(uploadIntervalRef.current);
            uploadIntervalRef.current = null;
        }
    };

    const uploadChunkRange = async (startIndex: number, endIndex: number) => {
        const nextMemoId = memoIdRef.current;
        if (!enabledRef.current || !nextMemoId || endIndex <= startIndex) return;

        const pruneOffset = chunkPruneOffsetRef.current;
        const arrayStart = Math.max(0, startIndex - pruneOffset);
        const arrayEnd = Math.max(arrayStart, endIndex - pruneOffset);
        const chunkBatch = audioChunksRef.current.slice(arrayStart, arrayEnd);

        if (chunkBatch.length === 0) return;

        const blobParts =
            startIndex === 0 && webmHeaderRef.current
                ? [webmHeaderRef.current, ...chunkBatch]
                : chunkBatch;
        const file = new Blob(blobParts, { type: mimeTypeRef.current });
        const formData = new FormData();
        formData.append("memoId", nextMemoId);
        formData.append("startIndex", String(startIndex));
        formData.append("endIndex", String(endIndex));
        formData.append("file", file, `${String(startIndex).padStart(7, "0")}-${String(endIndex).padStart(7, "0")}.webm`);

        const response = await fetch("/api/transcribe/upload-chunks", {
            method: "POST",
            body: formData,
        });

        if (!response.ok) {
            throw new Error(`Chunk upload failed: ${response.status}`);
        }

        lastUploadedIndexRef.current = endIndex;
    };

    const pruneUploadedChunks = () => {
        const nextPruneOffset = lastUploadedIndexRef.current - PRUNE_SAFETY_BUFFER;
        if (nextPruneOffset <= chunkPruneOffsetRef.current) return;

        const pruneCount = nextPruneOffset - chunkPruneOffsetRef.current;
        audioChunksRef.current.splice(0, pruneCount);
        chunkPruneOffsetRef.current = nextPruneOffset;
    };

    const uploadPendingChunks = async (minimumChunkCount: number, shouldPrune: boolean) => {
        if (!enabledRef.current || !memoIdRef.current) return;

        const totalChunks = audioChunksRef.current.length + chunkPruneOffsetRef.current;
        const newChunkCount = totalChunks - lastUploadedIndexRef.current;
        if (newChunkCount < minimumChunkCount) return;

        await uploadChunkRange(lastUploadedIndexRef.current, totalChunks);

        if (shouldPrune) {
            pruneUploadedChunks();
        }
    };

    useEffect(() => {
        clearUploadInterval();

        if (!enabled || !memoId) {
            return;
        }

        uploadIntervalRef.current = setInterval(() => {
            if (inFlightUploadRef.current) return;

            inFlightUploadRef.current = uploadPendingChunks(MIN_CHUNKS_TO_UPLOAD, true)
                .catch((error) => {
                    console.warn("[chunk-upload]", error);
                })
                .finally(() => {
                    inFlightUploadRef.current = null;
                });
        }, CHUNK_UPLOAD_INTERVAL_MS);

        return clearUploadInterval;
    }, [enabled, memoId]);

    const flushRemainingChunks = async () => {
        if (!enabledRef.current || !memoIdRef.current) return;

        try {
            await inFlightUploadRef.current;
        } catch {
            // The interval path already logs its own failure; final flush retries below.
        }

        for (let attempt = 0; attempt < FLUSH_MAX_RETRIES; attempt += 1) {
            try {
                await uploadPendingChunks(1, false);
                return;
            } catch (error) {
                if (attempt === FLUSH_MAX_RETRIES - 1) {
                    throw error;
                }
                await delay(FLUSH_RETRY_DELAYS_MS[attempt] ?? FLUSH_RETRY_DELAYS_MS.at(-1)!);
            }
        }
    };

    const resetChunkUpload = () => {
        clearUploadInterval();
        lastUploadedIndexRef.current = 0;
        chunkPruneOffsetRef.current = 0;
        inFlightUploadRef.current = null;
    };

    return {
        chunkPruneOffsetRef,
        flushRemainingChunks,
        resetChunkUpload,
    };
}
