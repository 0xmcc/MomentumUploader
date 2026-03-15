import { useEffect, useRef, type MutableRefObject } from "react";

const CHUNK_UPLOAD_INTERVAL_MS = 30_000;
const FIRST_UPLOAD_DELAY_MS = 15_000;
const READINESS_POLL_MS = 500; // Poll frequently so late memo IDs still trigger upload as soon as the buffer is ready
const MIN_CHUNKS_TO_UPLOAD = 3;
const INITIAL_CHUNKS_TO_UPLOAD = 2;
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

function logChunkUpload(event: string, payload: Record<string, unknown>) {
    console.log("[chunk-upload]", event, payload);
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
    const firstUploadTimerRef = useRef<NodeJS.Timeout | null>(null);
    const uploadIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const readinessIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const inFlightUploadRef = useRef<Promise<void> | null>(null);
    const audioChunksSourceRef = useRef(audioChunksRef);
    const webmHeaderSourceRef = useRef(webmHeaderRef);
    const mimeTypeSourceRef = useRef(mimeTypeRef);
    const enabledRef = useRef(enabled);
    const memoIdRef = useRef(memoId);
    const lateMemoIdBootstrapRef = useRef(false);

    useEffect(() => {
        audioChunksSourceRef.current = audioChunksRef;
    }, [audioChunksRef]);

    useEffect(() => {
        webmHeaderSourceRef.current = webmHeaderRef;
    }, [webmHeaderRef]);

    useEffect(() => {
        mimeTypeSourceRef.current = mimeTypeRef;
    }, [mimeTypeRef]);

    useEffect(() => {
        enabledRef.current = enabled;
    }, [enabled]);

    useEffect(() => {
        lateMemoIdBootstrapRef.current = memoIdRef.current == null && memoId != null;
        memoIdRef.current = memoId;
    }, [memoId]);

    const clearUploadInterval = () => {
        if (uploadIntervalRef.current) {
            clearInterval(uploadIntervalRef.current);
            uploadIntervalRef.current = null;
        }
    };

    const clearFirstUploadTimer = () => {
        if (firstUploadTimerRef.current) {
            clearTimeout(firstUploadTimerRef.current);
            firstUploadTimerRef.current = null;
        }
    };

    const clearReadinessInterval = () => {
        if (readinessIntervalRef.current) {
            clearInterval(readinessIntervalRef.current);
            readinessIntervalRef.current = null;
        }
    };

    const getMinimumChunkCount = () =>
        lastUploadedIndexRef.current === 0 && lateMemoIdBootstrapRef.current
            ? INITIAL_CHUNKS_TO_UPLOAD
            : MIN_CHUNKS_TO_UPLOAD;

    const uploadChunkRange = async (startIndex: number, endIndex: number) => {
        const nextMemoId = memoIdRef.current;
        if (!enabledRef.current) {
            logChunkUpload("uploadChunkRange:skip", {
                reason: "disabled",
                startIndex,
                endIndex,
            });
            return;
        }

        if (!nextMemoId) {
            logChunkUpload("uploadChunkRange:skip", {
                reason: "missing-memo-id",
                startIndex,
                endIndex,
            });
            return;
        }

        if (endIndex <= startIndex) {
            logChunkUpload("uploadChunkRange:skip", {
                reason: "empty-range",
                startIndex,
                endIndex,
            });
            return;
        }

        const pruneOffset = chunkPruneOffsetRef.current;
        const arrayStart = Math.max(0, startIndex - pruneOffset);
        const arrayEnd = Math.max(arrayStart, endIndex - pruneOffset);
        const chunkBatch = audioChunksSourceRef.current.current.slice(arrayStart, arrayEnd);

        if (chunkBatch.length === 0) {
            logChunkUpload("uploadChunkRange:skip", {
                reason: "empty-batch",
                startIndex,
                endIndex,
                pruneOffset,
                arrayStart,
                arrayEnd,
            });
            return;
        }

        const blobParts =
            startIndex === 0 && webmHeaderSourceRef.current.current
                ? [webmHeaderSourceRef.current.current, ...chunkBatch]
                : chunkBatch;
        const file = new Blob(blobParts, { type: mimeTypeSourceRef.current.current });
        const formData = new FormData();
        formData.append("memoId", nextMemoId);
        formData.append("startIndex", String(startIndex));
        formData.append("endIndex", String(endIndex));
        formData.append("file", file, `${String(startIndex).padStart(7, "0")}-${String(endIndex).padStart(7, "0")}.webm`);

        logChunkUpload("uploadChunkRange:fetch", {
            memoId: nextMemoId,
            startIndex,
            endIndex,
            chunkBatchLength: chunkBatch.length,
            pruneOffset,
        });

        const response = await fetch("/api/transcribe/upload-chunks", {
            method: "POST",
            body: formData,
        });

        if (!response.ok) {
            throw new Error(`Chunk upload failed: ${response.status}`);
        }

        lastUploadedIndexRef.current = endIndex;
        lateMemoIdBootstrapRef.current = false;
    };

    const pruneUploadedChunks = () => {
        const nextPruneOffset = lastUploadedIndexRef.current - PRUNE_SAFETY_BUFFER;
        if (nextPruneOffset <= chunkPruneOffsetRef.current) return;

        const pruneCount = nextPruneOffset - chunkPruneOffsetRef.current;
        audioChunksSourceRef.current.current.splice(0, pruneCount);
        chunkPruneOffsetRef.current = nextPruneOffset;
    };

    const uploadPendingChunks = async (minimumChunkCount: number, shouldPrune: boolean) => {
        if (!enabledRef.current) {
            logChunkUpload("uploadPendingChunks:skip", {
                reason: "disabled",
                minimumChunkCount,
                shouldPrune,
            });
            return;
        }

        if (!memoIdRef.current) {
            logChunkUpload("uploadPendingChunks:skip", {
                reason: "missing-memo-id",
                minimumChunkCount,
                shouldPrune,
            });
            return;
        }

        const totalChunks =
            audioChunksSourceRef.current.current.length + chunkPruneOffsetRef.current;
        const newChunkCount = totalChunks - lastUploadedIndexRef.current;
        if (newChunkCount < minimumChunkCount) {
            logChunkUpload("uploadPendingChunks:skip", {
                reason: "below-minimum",
                minimumChunkCount,
                shouldPrune,
                totalChunks,
                newChunkCount,
                lastUploadedIndex: lastUploadedIndexRef.current,
            });
            return;
        }

        await uploadChunkRange(lastUploadedIndexRef.current, totalChunks);

        if (shouldPrune) {
            pruneUploadedChunks();
        }
    };

    useEffect(() => {
        clearFirstUploadTimer();
        clearUploadInterval();
        clearReadinessInterval();

        const totalChunks =
            audioChunksSourceRef.current.current.length + chunkPruneOffsetRef.current;

        if (!enabled) {
            logChunkUpload("effect:skip", {
                reason: "disabled",
                enabled,
                memoId,
                totalChunks,
                lastUploadedIndex: lastUploadedIndexRef.current,
            });
            return;
        }

        if (!memoId) {
            logChunkUpload("effect:skip", {
                reason: "missing-memo-id",
                enabled,
                memoId,
                totalChunks,
                lastUploadedIndex: lastUploadedIndexRef.current,
            });
            return;
        }

        logChunkUpload("effect:start", {
            enabled,
            memoId,
            totalChunks,
            firstUploadDelayMs: FIRST_UPLOAD_DELAY_MS,
            readinessPollMs: READINESS_POLL_MS,
            intervalMs: CHUNK_UPLOAD_INTERVAL_MS,
            lastUploadedIndex: lastUploadedIndexRef.current,
        });

        const runUpload = () => {
            if (inFlightUploadRef.current) return;
            inFlightUploadRef.current = uploadPendingChunks(getMinimumChunkCount(), true)
                .catch((error) => {
                    console.warn("[chunk-upload]", error);
                })
                .finally(() => {
                    inFlightUploadRef.current = null;
                });
        };

        firstUploadTimerRef.current = setTimeout(runUpload, FIRST_UPLOAD_DELAY_MS);
        uploadIntervalRef.current = setInterval(runUpload, CHUNK_UPLOAD_INTERVAL_MS);

        readinessIntervalRef.current = setInterval(() => {
            const totalChunks =
                audioChunksSourceRef.current.current.length + chunkPruneOffsetRef.current;
            const newChunkCount = totalChunks - lastUploadedIndexRef.current;
            const minimumChunkCount = getMinimumChunkCount();
            if (inFlightUploadRef.current) {
                logChunkUpload("readinessPoll:skip", {
                    reason: "in-flight",
                    totalChunks,
                    newChunkCount,
                    lastUploadedIndex: lastUploadedIndexRef.current,
                });
                return;
            }

            if (newChunkCount < minimumChunkCount) {
                logChunkUpload("readinessPoll:skip", {
                    reason: "below-minimum",
                    totalChunks,
                    newChunkCount,
                    minimumChunkCount,
                    lastUploadedIndex: lastUploadedIndexRef.current,
                });
                return;
            }

            logChunkUpload("readinessPoll:runUpload", {
                totalChunks,
                newChunkCount,
                minimumChunkCount,
                lastUploadedIndex: lastUploadedIndexRef.current,
            });
            clearReadinessInterval();
            runUpload();
        }, READINESS_POLL_MS);

        return () => {
            clearFirstUploadTimer();
            clearUploadInterval();
            clearReadinessInterval();
        };
    }, [enabled, memoId]);

    const flushRemainingChunks = async () => {
        if (!enabledRef.current || !memoIdRef.current) return;

        clearFirstUploadTimer();
        clearUploadInterval();
        clearReadinessInterval();

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
        clearFirstUploadTimer();
        clearUploadInterval();
        clearReadinessInterval();
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
