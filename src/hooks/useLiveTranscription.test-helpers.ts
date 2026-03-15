type BuildChunkRefsOptions =
    | number
    | {
        chunkCount?: number;
        startIndex?: number;
        pruneOffset?: number;
    };

export function buildChunkRefs(options: BuildChunkRefsOptions = 30) {
    const normalized =
        typeof options === "number"
            ? { chunkCount: options, startIndex: 0, pruneOffset: 0 }
            : {
                chunkCount: options.chunkCount ?? 30,
                startIndex: options.startIndex ?? 0,
                pruneOffset: options.pruneOffset ?? 0,
            };

    return {
        audioChunksRef: {
            current: Array.from(
                { length: normalized.chunkCount },
                (_, index) =>
                    new Blob(
                        [`chunk-${normalized.startIndex + index}`],
                        { type: "audio/webm" }
                    )
            ),
        },
        mimeTypeRef: { current: "audio/webm" },
        webmHeaderRef: {
            current: new Blob(["header"], { type: "audio/webm" }),
        },
        chunkPruneOffsetRef: { current: normalized.pruneOffset },
    };
}
